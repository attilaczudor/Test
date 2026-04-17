/**
 * @module providers/github-copilot-auth
 *
 * Implements GitHub Copilot authentication via the OAuth 2.0 Device Authorization
 * Grant flow (RFC 8628). This module handles the interactive login process where
 * a user is presented with a verification URL and a one-time user code, then polls
 * GitHub's token endpoint until the user completes authorization in their browser.
 *
 * The resulting access token is persisted as an auth profile so that downstream
 * Copilot API calls (model listing, completions, etc.) can use it without
 * re-authenticating.
 */

import { intro, note, outro, spinner } from "@clack/prompts";
import { ensureAuthProfileStore, upsertAuthProfile } from "../agents/auth-profiles.js";
import { updateConfig } from "../commands/models/shared.js";
import { applyAuthProfileConfig } from "../commands/onboard-auth.js";
import { logConfigUpdated } from "../config/logging.js";
import type { RuntimeEnv } from "../runtime.js";
import { stylePromptTitle } from "../terminal/prompt-style.js";

/** GitHub OAuth application client ID used for the device flow. */
const CLIENT_ID = "Iv1.b507a08c87ecfe98";

/** GitHub endpoint that issues a device code + user code pair. */
const DEVICE_CODE_URL = "https://github.com/login/device/code";

/** GitHub endpoint that exchanges a device code for an access token. */
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Shape of the response returned by GitHub's device code endpoint.
 * Contains the device code (for polling) and user code (for display).
 */
type DeviceCodeResponse = {
  /** Opaque identifier used when polling for the access token. */
  device_code: string;
  /** Short alphanumeric code the user enters at the verification URL. */
  user_code: string;
  /** URL where the user should enter their user code. */
  verification_uri: string;
  /** Number of seconds before the device code expires. */
  expires_in: number;
  /** Minimum polling interval in seconds that the client should respect. */
  interval: number;
};

/**
 * Union type representing the two possible shapes of a device token response:
 * either a successful token grant or an error payload.
 */
type DeviceTokenResponse =
  | {
      /** The OAuth access token granted upon successful authorization. */
      access_token: string;
      /** Token type, typically "bearer". */
      token_type: string;
      /** Granted scopes (if any). */
      scope?: string;
    }
  | {
      /** Error code string (e.g. "authorization_pending", "slow_down"). */
      error: string;
      /** Human-readable error description. */
      error_description?: string;
      /** URL with more information about the error. */
      error_uri?: string;
    };

/**
 * Safely casts an unknown JSON-parsed value to the expected type.
 * Throws if the value is not a non-null object.
 *
 * @template T - The expected shape of the JSON response.
 * @param value - The raw parsed JSON value.
 * @returns The value cast to type T.
 * @throws {Error} If value is falsy or not an object.
 */
function parseJsonResponse<T>(value: unknown): T {
  if (!value || typeof value !== "object") {
    throw new Error("Unexpected response from GitHub");
  }
  return value as T;
}

/**
 * Initiates the GitHub OAuth device authorization flow by requesting a
 * device code and user code from GitHub's device code endpoint.
 *
 * @param params - Parameters for the request.
 * @param params.scope - The OAuth scope(s) to request (e.g. "read:user").
 * @returns A promise resolving to the device code response containing
 *          the device_code, user_code, verification_uri, and timing fields.
 * @throws {Error} If the HTTP request fails or the response is missing required fields.
 */
async function requestDeviceCode(params: { scope: string }): Promise<DeviceCodeResponse> {
  // Build URL-encoded form body with client ID and requested scope
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: params.scope,
  });

  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`GitHub device code failed: HTTP ${res.status}`);
  }

  const json = parseJsonResponse<DeviceCodeResponse>(await res.json());
  // Validate that all required fields are present in the response
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("GitHub device code response missing fields");
  }
  return json;
}

/**
 * Polls GitHub's access token endpoint at the specified interval until the user
 * authorizes the device, the device code expires, or the user denies access.
 *
 * This implements the polling loop described in RFC 8628 Section 3.4, including
 * handling of "authorization_pending" (keep polling), "slow_down" (increase
 * interval), "expired_token", and "access_denied" error codes.
 *
 * @param params - Polling configuration.
 * @param params.deviceCode - The device code obtained from {@link requestDeviceCode}.
 * @param params.intervalMs - The polling interval in milliseconds.
 * @param params.expiresAt - Absolute timestamp (ms since epoch) when the code expires.
 * @returns A promise resolving to the OAuth access token string.
 * @throws {Error} If the code expires, access is denied, or an unexpected error occurs.
 */
async function pollForAccessToken(params: {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}): Promise<string> {
  // Pre-build the form body since client_id, device_code, and grant_type are constant
  const bodyBase = new URLSearchParams({
    client_id: CLIENT_ID,
    device_code: params.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  // Keep polling until the device code expires
  while (Date.now() < params.expiresAt) {
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyBase,
    });

    if (!res.ok) {
      throw new Error(`GitHub device token failed: HTTP ${res.status}`);
    }

    const json = parseJsonResponse<DeviceTokenResponse>(await res.json());
    // If we received an access_token, authorization succeeded
    if ("access_token" in json && typeof json.access_token === "string") {
      return json.access_token;
    }

    // Extract error code from the response for flow control
    const err = "error" in json ? json.error : "unknown";
    if (err === "authorization_pending") {
      // User hasn't authorized yet; wait and try again
      await new Promise((r) => setTimeout(r, params.intervalMs));
      continue;
    }
    if (err === "slow_down") {
      // GitHub is asking us to back off; add 2 seconds to the interval
      await new Promise((r) => setTimeout(r, params.intervalMs + 2000));
      continue;
    }
    if (err === "expired_token") {
      throw new Error("GitHub device code expired; run login again");
    }
    if (err === "access_denied") {
      throw new Error("GitHub login cancelled");
    }
    throw new Error(`GitHub device flow error: ${err}`);
  }

  throw new Error("GitHub device code expired; run login again");
}

/**
 * Executes the full interactive GitHub Copilot login command.
 *
 * This function orchestrates the complete device authorization flow:
 * 1. Requests a device code from GitHub.
 * 2. Displays the verification URL and user code for the user.
 * 3. Polls for the access token until the user authorizes.
 * 4. Persists the token as an auth profile in the local credential store.
 * 5. Updates the application configuration to use the new profile.
 *
 * @param opts - Command options.
 * @param opts.profileId - Optional custom profile ID (defaults to "github-copilot:github").
 * @param opts.yes - If true, skip the confirmation prompt when overwriting an existing profile.
 * @param runtime - The runtime environment, used for logging.
 * @throws {Error} If stdin is not a TTY (non-interactive mode is not supported).
 */
export async function githubCopilotLoginCommand(
  opts: { profileId?: string; yes?: boolean },
  runtime: RuntimeEnv,
) {
  // The device flow requires user interaction; reject non-interactive sessions
  if (!process.stdin.isTTY) {
    throw new Error("github-copilot login requires an interactive TTY.");
  }

  intro(stylePromptTitle("GitHub Copilot login"));

  // Default profile ID follows the "provider:source" naming convention
  const profileId = opts.profileId?.trim() || "github-copilot:github";
  const store = ensureAuthProfileStore(undefined, {
    allowKeychainPrompt: false,
  });

  // Warn the user if a profile with this ID already exists
  if (store.profiles[profileId] && !opts.yes) {
    note(
      `Auth profile already exists: ${profileId}\nRe-running will overwrite it.`,
      stylePromptTitle("Existing credentials"),
    );
  }

  // Step 1: Request a device code from GitHub
  const spin = spinner();
  spin.start("Requesting device code from GitHub...");
  const device = await requestDeviceCode({ scope: "read:user" });
  spin.stop("Device code ready");

  // Step 2: Display the verification URL and user code
  note(
    [`Visit: ${device.verification_uri}`, `Code: ${device.user_code}`].join("\n"),
    stylePromptTitle("Authorize"),
  );

  // Calculate absolute expiry timestamp and enforce a minimum 1-second polling interval
  const expiresAt = Date.now() + device.expires_in * 1000;
  const intervalMs = Math.max(1000, device.interval * 1000);

  // Step 3: Poll until the user authorizes in their browser
  const polling = spinner();
  polling.start("Waiting for GitHub authorization...");
  const accessToken = await pollForAccessToken({
    deviceCode: device.device_code,
    intervalMs,
    expiresAt,
  });
  polling.stop("GitHub access token acquired");

  // Step 4: Persist the access token as a local auth profile
  upsertAuthProfile({
    profileId,
    credential: {
      type: "token",
      provider: "github-copilot",
      token: accessToken,
      // GitHub device flow token doesn't reliably include expiry here.
      // Leave expires unset; we'll exchange into Copilot token plus expiry later.
    },
  });

  // Step 5: Update the global configuration to reference the new auth profile
  await updateConfig((cfg) =>
    applyAuthProfileConfig(cfg, {
      provider: "github-copilot",
      profileId,
      mode: "token",
    }),
  );

  logConfigUpdated(runtime);
  runtime.log(`Auth profile: ${profileId} (github-copilot/token)`);

  outro("Done");
}
