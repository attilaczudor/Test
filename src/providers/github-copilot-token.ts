/**
 * @module providers/github-copilot-token
 *
 * Manages the Copilot API token lifecycle: exchanging a GitHub OAuth access token
 * for a short-lived Copilot API token, caching the result on disk, and deriving
 * the correct API base URL from the token payload.
 *
 * The Copilot API token is distinct from the GitHub OAuth token obtained during
 * login. It is issued by GitHub's internal Copilot token endpoint and contains
 * embedded metadata (e.g., a proxy endpoint URL) encoded as semicolon-delimited
 * key=value pairs.
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";

/** GitHub internal endpoint that exchanges a GitHub token for a Copilot API token. */
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

/**
 * Represents a cached Copilot API token stored on disk.
 * Includes the token string, its expiry, and the time it was last refreshed.
 */
export type CachedCopilotToken = {
  /** The Copilot API token string. */
  token: string;
  /** Expiry time as milliseconds since epoch. */
  expiresAt: number;
  /** Timestamp (ms since epoch) when this cache entry was last written. */
  updatedAt: number;
};

/**
 * Resolves the file system path where the cached Copilot token is stored.
 * The path is derived from the application's state directory.
 *
 * @param env - Process environment variables (defaults to `process.env`).
 * @returns Absolute path to the cached token JSON file.
 */
function resolveCopilotTokenCachePath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveStateDir(env), "credentials", "github-copilot.token.json");
}

/**
 * Checks whether a cached Copilot token is still usable, applying a 5-minute
 * safety margin to avoid using a token that is about to expire.
 *
 * @param cache - The cached token entry to check.
 * @param now - Current timestamp in ms (defaults to `Date.now()`).
 * @returns `true` if the token has more than 5 minutes of remaining validity.
 */
function isTokenUsable(cache: CachedCopilotToken, now = Date.now()): boolean {
  // Keep a small safety margin when checking expiry.
  return cache.expiresAt - now > 5 * 60 * 1000;
}

/**
 * Parses and validates the raw JSON response from the Copilot token endpoint.
 * Handles both numeric (unix seconds or ms) and string-encoded expiry values.
 *
 * @param value - The raw JSON-parsed response body.
 * @returns An object with the token string and expiry time in milliseconds.
 * @throws {Error} If the response is not an object, or if the token or expires_at
 *         fields are missing or invalid.
 */
function parseCopilotTokenResponse(value: unknown): {
  token: string;
  expiresAt: number;
} {
  if (!value || typeof value !== "object") {
    throw new Error("Unexpected response from GitHub Copilot token endpoint");
  }
  const asRecord = value as Record<string, unknown>;
  const token = asRecord.token;
  const expiresAt = asRecord.expires_at;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Copilot token response missing token");
  }

  // GitHub returns a unix timestamp (seconds), but we defensively accept ms too.
  // The heuristic: if the value is > 10 billion it's already in milliseconds,
  // otherwise multiply by 1000 to convert from seconds.
  let expiresAtMs: number;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    expiresAtMs = expiresAt > 10_000_000_000 ? expiresAt : expiresAt * 1000;
  } else if (typeof expiresAt === "string" && expiresAt.trim().length > 0) {
    const parsed = Number.parseInt(expiresAt, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("Copilot token response has invalid expires_at");
    }
    expiresAtMs = parsed > 10_000_000_000 ? parsed : parsed * 1000;
  } else {
    throw new Error("Copilot token response missing expires_at");
  }

  return { token, expiresAt: expiresAtMs };
}

/** Default Copilot API base URL used when no proxy endpoint is found in the token. */
export const DEFAULT_COPILOT_API_BASE_URL = "https://api.individual.githubcopilot.com";

/**
 * Extracts and transforms the Copilot API base URL from the token payload.
 *
 * Copilot tokens are semicolon-delimited key=value strings. This function
 * looks for the `proxy-ep` key, extracts its value, and converts the
 * "proxy." hostname prefix to "api." (matching the upstream convention used
 * by the GitHub Copilot VS Code extension).
 *
 * @param token - The raw Copilot API token string.
 * @returns The derived HTTPS base URL, or `null` if the token does not contain
 *          a recognizable `proxy-ep` field.
 *
 * @example
 * ```ts
 * deriveCopilotApiBaseUrlFromToken("tid=abc;proxy-ep=proxy.example.com;exp=123")
 * // => "https://api.example.com"
 * ```
 */
export function deriveCopilotApiBaseUrlFromToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  // The token returned from the Copilot token endpoint is a semicolon-delimited
  // set of key/value pairs. One of them is `proxy-ep=...`.
  const match = trimmed.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) {
    return null;
  }

  // pi-ai expects converting proxy.* -> api.*
  // (see upstream getGitHubCopilotBaseUrl).
  const host = proxyEp.replace(/^https?:\/\//, "").replace(/^proxy\./i, "api.");
  if (!host) {
    return null;
  }

  return `https://${host}`;
}

/**
 * Resolves a valid Copilot API token, using a cached version when available
 * or fetching a fresh one from GitHub's Copilot token endpoint.
 *
 * The resolution strategy is:
 * 1. Attempt to load a cached token from disk.
 * 2. If the cached token exists and has more than 5 minutes of remaining validity,
 *    return it immediately.
 * 3. Otherwise, exchange the GitHub OAuth token for a new Copilot API token.
 * 4. Cache the new token to disk for future use.
 *
 * @param params - Configuration for token resolution.
 * @param params.githubToken - The GitHub OAuth access token to exchange.
 * @param params.env - Process environment (defaults to `process.env`).
 * @param params.fetchImpl - Custom fetch implementation for testing (defaults to global `fetch`).
 * @param params.cachePath - Override path for the token cache file.
 * @param params.loadJsonFileImpl - Custom JSON file loader for testing.
 * @param params.saveJsonFileImpl - Custom JSON file saver for testing.
 * @returns An object containing the token, its expiry, its source (cache or fetched),
 *          and the derived API base URL.
 * @throws {Error} If the token exchange HTTP request fails.
 */
export async function resolveCopilotApiToken(params: {
  githubToken: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  cachePath?: string;
  loadJsonFileImpl?: (path: string) => unknown;
  saveJsonFileImpl?: (path: string, value: CachedCopilotToken) => void;
}): Promise<{
  token: string;
  expiresAt: number;
  source: string;
  baseUrl: string;
}> {
  const env = params.env ?? process.env;
  const cachePath = params.cachePath?.trim() || resolveCopilotTokenCachePath(env);
  const loadJsonFileFn = params.loadJsonFileImpl ?? loadJsonFile;
  const saveJsonFileFn = params.saveJsonFileImpl ?? saveJsonFile;

  // Attempt to use a cached token if it exists and is still valid
  const cached = loadJsonFileFn(cachePath) as CachedCopilotToken | undefined;
  if (cached && typeof cached.token === "string" && typeof cached.expiresAt === "number") {
    if (isTokenUsable(cached)) {
      return {
        token: cached.token,
        expiresAt: cached.expiresAt,
        source: `cache:${cachePath}`,
        baseUrl: deriveCopilotApiBaseUrlFromToken(cached.token) ?? DEFAULT_COPILOT_API_BASE_URL,
      };
    }
  }

  // No usable cached token; exchange the GitHub OAuth token for a Copilot API token
  const fetchImpl = params.fetchImpl ?? fetch;
  const res = await fetchImpl(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.githubToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Copilot token exchange failed: HTTP ${res.status}`);
  }

  // Parse and validate the response
  const json = parseCopilotTokenResponse(await res.json());

  // Persist the token to disk for future use
  const payload: CachedCopilotToken = {
    token: json.token,
    expiresAt: json.expiresAt,
    updatedAt: Date.now(),
  };
  saveJsonFileFn(cachePath, payload);

  return {
    token: payload.token,
    expiresAt: payload.expiresAt,
    source: `fetched:${COPILOT_TOKEN_URL}`,
    baseUrl: deriveCopilotApiBaseUrlFromToken(payload.token) ?? DEFAULT_COPILOT_API_BASE_URL,
  };
}
