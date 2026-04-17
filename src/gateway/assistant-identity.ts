/**
 * @module assistant-identity
 *
 * Resolves the visual identity (name, avatar, emoji) for an AI assistant
 * displayed in the UI. Identity values are sourced from multiple layers
 * (config file, agent identity, workspace file) with a defined precedence,
 * and each value is validated and truncated to safe limits.
 */

import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveAgentIdentity } from "../agents/identity.js";
import { loadAgentIdentity } from "../commands/agents.config.js";
import type { OpenClawConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";

/** Maximum allowed length for the assistant's display name. */
const MAX_ASSISTANT_NAME = 50;

/** Maximum allowed length for the assistant's avatar value (URL, path, or short string). */
const MAX_ASSISTANT_AVATAR = 200;

/** Maximum allowed length for the assistant's emoji string. */
const MAX_ASSISTANT_EMOJI = 16;

/**
 * The fallback identity used when no custom identity is configured.
 */
export const DEFAULT_ASSISTANT_IDENTITY: AssistantIdentity = {
  agentId: "main",
  name: "Assistant",
  avatar: "A",
};

/**
 * Describes the visual identity of an AI assistant as shown in the UI.
 */
export type AssistantIdentity = {
  /** The normalized agent identifier. */
  agentId: string;
  /** The display name shown in the chat UI. */
  name: string;
  /** The avatar value — can be a URL, file path, short text, or single character. */
  avatar: string;
  /** An optional emoji used alongside or instead of the avatar. */
  emoji?: string;
};

/**
 * Trims and truncates a string value to the given maximum length.
 * Returns `undefined` for empty, blank, or non-string inputs.
 *
 * @param value - The raw string value to coerce.
 * @param maxLength - The maximum allowed character length.
 * @returns The coerced string, or `undefined` if invalid/empty.
 * @internal
 */
function coerceIdentityValue(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  // Truncate to the maximum allowed length
  return trimmed.slice(0, maxLength);
}

/**
 * Checks whether a value looks like an avatar URL (http/https or data URI).
 *
 * @param value - The string to test.
 * @returns `true` if the value matches an HTTP(S) or data:image URL pattern.
 * @internal
 */
function isAvatarUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

/**
 * Checks whether a value looks like a file-system path to an image.
 * Detects path separators or common image file extensions.
 *
 * @param value - The string to test.
 * @returns `true` if the value appears to be a file path.
 * @internal
 */
function looksLikeAvatarPath(value: string): boolean {
  // Contains forward or back slashes — likely a path
  if (/[\\/]/.test(value)) {
    return true;
  }
  // Ends with a common image extension
  return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(value);
}

/**
 * Normalizes a raw avatar string into a usable avatar value.
 *
 * Accepted formats (in order of preference):
 * 1. HTTP(S) or data-URI URLs
 * 2. File-system paths to image files
 * 3. Short strings (up to 4 characters, no whitespace) — e.g., single emoji or initials
 *
 * @param value - The raw avatar string to normalize.
 * @returns The normalized avatar string, or `undefined` if invalid.
 * @internal
 */
function normalizeAvatarValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (isAvatarUrl(trimmed)) {
    return trimmed;
  }
  if (looksLikeAvatarPath(trimmed)) {
    return trimmed;
  }
  // Accept short strings without whitespace (e.g., single emoji or initials)
  if (!/\s/.test(trimmed) && trimmed.length <= 4) {
    return trimmed;
  }
  return undefined;
}

/**
 * Normalizes a raw emoji string, ensuring it actually contains non-ASCII
 * characters (i.e., likely emoji) and is not a URL or file path.
 *
 * @param value - The raw emoji string to normalize.
 * @returns The validated emoji string, or `undefined` if invalid.
 * @internal
 */
function normalizeEmojiValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > MAX_ASSISTANT_EMOJI) {
    return undefined;
  }
  // Check that the string contains at least one non-ASCII character (likely emoji)
  let hasNonAscii = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  // Reject pure-ASCII strings — they aren't emoji
  if (!hasNonAscii) {
    return undefined;
  }
  // Reject URLs and file paths that happen to contain non-ASCII characters
  if (isAvatarUrl(trimmed) || looksLikeAvatarPath(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Resolves the full assistant identity by merging values from multiple sources
 * with the following precedence (highest to lowest):
 *
 * 1. `cfg.ui.assistant` — explicit UI configuration
 * 2. Agent identity from the agent registry
 * 3. Agent identity loaded from the workspace directory
 * 4. {@link DEFAULT_ASSISTANT_IDENTITY} — built-in defaults
 *
 * Each field (name, avatar, emoji) is independently resolved from the first
 * source that provides a valid value.
 *
 * @param params - Resolution parameters.
 * @param params.cfg - The application configuration object.
 * @param params.agentId - Optional explicit agent ID override.
 * @param params.workspaceDir - Optional explicit workspace directory override.
 * @returns The fully resolved {@link AssistantIdentity}.
 */
export function resolveAssistantIdentity(params: {
  cfg: OpenClawConfig;
  agentId?: string | null;
  workspaceDir?: string | null;
}): AssistantIdentity {
  // Normalize the agent ID, falling back to the configured default
  const agentId = normalizeAgentId(params.agentId ?? resolveDefaultAgentId(params.cfg));
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  const configAssistant = params.cfg.ui?.assistant;
  const agentIdentity = resolveAgentIdentity(params.cfg, agentId);
  const fileIdentity = workspaceDir ? loadAgentIdentity(workspaceDir) : null;

  // Resolve name: config > agent identity > file identity > default
  const name =
    coerceIdentityValue(configAssistant?.name, MAX_ASSISTANT_NAME) ??
    coerceIdentityValue(agentIdentity?.name, MAX_ASSISTANT_NAME) ??
    coerceIdentityValue(fileIdentity?.name, MAX_ASSISTANT_NAME) ??
    DEFAULT_ASSISTANT_IDENTITY.name;

  // Resolve avatar: try config, agent avatar, agent emoji, file avatar, file emoji
  const avatarCandidates = [
    coerceIdentityValue(configAssistant?.avatar, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(agentIdentity?.avatar, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(agentIdentity?.emoji, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(fileIdentity?.avatar, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(fileIdentity?.emoji, MAX_ASSISTANT_AVATAR),
  ];
  const avatar =
    avatarCandidates.map((candidate) => normalizeAvatarValue(candidate)).find(Boolean) ??
    DEFAULT_ASSISTANT_IDENTITY.avatar;

  // Resolve emoji: try agent emoji, file emoji, then agent avatar, file avatar
  const emojiCandidates = [
    coerceIdentityValue(agentIdentity?.emoji, MAX_ASSISTANT_EMOJI),
    coerceIdentityValue(fileIdentity?.emoji, MAX_ASSISTANT_EMOJI),
    coerceIdentityValue(agentIdentity?.avatar, MAX_ASSISTANT_EMOJI),
    coerceIdentityValue(fileIdentity?.avatar, MAX_ASSISTANT_EMOJI),
  ];
  const emoji = emojiCandidates.map((candidate) => normalizeEmojiValue(candidate)).find(Boolean);

  return { agentId, name, avatar, emoji };
}
