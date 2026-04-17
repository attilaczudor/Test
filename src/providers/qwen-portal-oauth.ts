/**
 * @module providers/qwen-portal-oauth
 *
 * Handles OAuth 2.0 credential refresh for the Qwen Portal LLM provider.
 *
 * Qwen Portal uses a standard OAuth 2.0 refresh token grant (RFC 6749 Section 6)
 * to rotate access tokens. This module sends the refresh request to Qwen's
 * token endpoint and returns updated credentials with a new access token,
 * optional new refresh token, and computed expiry timestamp.
 */

import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { formatCliCommand } from "../cli/command-format.js";

/** Base URL for the Qwen OAuth service. */
const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";

/** Full URL of the Qwen OAuth 2.0 token endpoint used for refresh grants. */
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;

/** OAuth client ID registered for this application with the Qwen Portal. */
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";

/**
 * Refreshes Qwen Portal OAuth credentials by exchanging the current refresh token
 * for a new access token (and optionally a new refresh token).
 *
 * Per RFC 6749 Section 6, the authorization server may issue a new refresh token
 * along with the new access token. If a new refresh token is returned, it replaces
 * the old one; otherwise the existing refresh token is preserved.
 *
 * @param credentials - The current OAuth credentials containing at least a refresh token.
 * @returns A promise resolving to updated {@link OAuthCredentials} with a fresh access
 *          token, updated expiry, and (optionally) a new refresh token.
 * @throws {Error} If the refresh token is missing or empty.
 * @throws {Error} If the Qwen API returns a 400 status (token expired/invalid),
 *         with instructions to re-authenticate.
 * @throws {Error} If the response is missing the access_token or has an invalid expires_in.
 */
export async function refreshQwenPortalCredentials(
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const refreshToken = credentials.refresh?.trim();
  if (!refreshToken) {
    throw new Error("Qwen OAuth refresh token missing; re-authenticate.");
  }

  // Send the refresh token grant request to the Qwen OAuth endpoint
  const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: QWEN_OAUTH_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    // A 400 response typically means the refresh token has expired or been revoked
    if (response.status === 400) {
      throw new Error(
        `Qwen OAuth refresh token expired or invalid. Re-authenticate with \`${formatCliCommand("openclaw models auth login --provider qwen-portal")}\`.`,
      );
    }
    throw new Error(`Qwen OAuth refresh failed: ${text || response.statusText}`);
  }

  // Parse the token response payload
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const accessToken = payload.access_token?.trim();
  const newRefreshToken = payload.refresh_token?.trim();
  const expiresIn = payload.expires_in;

  // Validate required fields in the response
  if (!accessToken) {
    throw new Error("Qwen OAuth refresh response missing access token.");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Qwen OAuth refresh response missing or invalid expires_in.");
  }

  return {
    ...credentials,
    access: accessToken,
    // RFC 6749 section 6: new refresh token is optional; if present, replace old.
    refresh: newRefreshToken || refreshToken,
    // Convert expires_in (seconds) to an absolute timestamp (milliseconds)
    expires: Date.now() + expiresIn * 1000,
  };
}
