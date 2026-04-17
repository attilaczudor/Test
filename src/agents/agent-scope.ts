/**
 * @module agents/agent-scope
 *
 * Agent scoping and configuration resolution.
 *
 * This module provides helpers for resolving multi-agent configurations from
 * the OpenClaw config file. It handles:
 * - Listing, deduplicating, and normalizing agent IDs
 * - Resolving the default agent and per-session agent IDs
 * - Extracting per-agent settings (model, workspace, skills, sandbox, etc.)
 * - Computing effective model fallback chains
 * - Resolving workspace and agent directories on disk
 */

import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { normalizeSkillFilter } from "./skills/filter.js";
import { resolveDefaultAgentWorkspaceDir } from "./workspace.js";

export { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

/** A single agent entry as declared in the OpenClaw config `agents.list` array. */
type AgentEntry = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

/**
 * The fully resolved configuration for a single agent, derived from the
 * raw {@link AgentEntry}. Fields are normalized and type-narrowed.
 */
type ResolvedAgentConfig = {
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: AgentEntry["model"];
  skills?: AgentEntry["skills"];
  memorySearch?: AgentEntry["memorySearch"];
  humanDelay?: AgentEntry["humanDelay"];
  heartbeat?: AgentEntry["heartbeat"];
  identity?: AgentEntry["identity"];
  groupChat?: AgentEntry["groupChat"];
  subagents?: AgentEntry["subagents"];
  sandbox?: AgentEntry["sandbox"];
  tools?: AgentEntry["tools"];
};

/** Guard flag to suppress duplicate warnings about multiple default agents. */
let defaultAgentWarned = false;

/**
 * Extracts the list of agent entries from the OpenClaw config.
 *
 * @param cfg - The OpenClaw configuration object.
 * @returns An array of valid agent entry objects, or an empty array if none are configured.
 */
export function listAgentEntries(cfg: OpenClawConfig): AgentEntry[] {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry): entry is AgentEntry => Boolean(entry && typeof entry === "object"));
}

/**
 * Returns deduplicated, normalized agent IDs from the config.
 *
 * Falls back to a single-element array containing {@link DEFAULT_AGENT_ID}
 * when no agents are configured.
 *
 * @param cfg - The OpenClaw configuration object.
 * @returns An array of unique, normalized agent ID strings.
 */
export function listAgentIds(cfg: OpenClawConfig): string[] {
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) {
    return [DEFAULT_AGENT_ID];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of agents) {
    const id = normalizeAgentId(entry?.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [DEFAULT_AGENT_ID];
}

/**
 * Determines the default agent ID from the configuration.
 *
 * If multiple agents are marked `default: true`, a console warning is emitted
 * (once) and the first one found is used. If no agents are marked as default,
 * the first entry in the list is used.
 *
 * @param cfg - The OpenClaw configuration object.
 * @returns The normalized default agent ID.
 */
export function resolveDefaultAgentId(cfg: OpenClawConfig): string {
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) {
    return DEFAULT_AGENT_ID;
  }
  const defaults = agents.filter((agent) => agent?.default);
  if (defaults.length > 1 && !defaultAgentWarned) {
    defaultAgentWarned = true;
    console.warn("Multiple agents marked default=true; using the first entry as default.");
  }
  const chosen = (defaults[0] ?? agents[0])?.id?.trim();
  return normalizeAgentId(chosen || DEFAULT_AGENT_ID);
}

/**
 * Resolves both the default agent ID and the session-specific agent ID.
 *
 * The session agent ID is extracted from the session key if it contains an
 * embedded agent identifier; otherwise it falls back to the default.
 *
 * @param params - Object containing an optional session key and config.
 * @returns An object with `defaultAgentId` and `sessionAgentId`.
 */
export function resolveSessionAgentIds(params: { sessionKey?: string; config?: OpenClawConfig }): {
  defaultAgentId: string;
  sessionAgentId: string;
} {
  const defaultAgentId = resolveDefaultAgentId(params.config ?? {});
  const sessionKey = params.sessionKey?.trim();
  const normalizedSessionKey = sessionKey ? sessionKey.toLowerCase() : undefined;
  const parsed = normalizedSessionKey ? parseAgentSessionKey(normalizedSessionKey) : null;
  const sessionAgentId = parsed?.agentId ? normalizeAgentId(parsed.agentId) : defaultAgentId;
  return { defaultAgentId, sessionAgentId };
}

/**
 * Convenience wrapper that returns only the session-specific agent ID.
 *
 * @param params - Object containing an optional session key and config.
 * @returns The resolved session agent ID string.
 */
export function resolveSessionAgentId(params: {
  sessionKey?: string;
  config?: OpenClawConfig;
}): string {
  return resolveSessionAgentIds(params).sessionAgentId;
}

/**
 * Finds the raw agent entry in the config that matches the given agent ID.
 *
 * @param cfg     - The OpenClaw configuration object.
 * @param agentId - The agent ID to look up (will be normalized).
 * @returns The matching {@link AgentEntry}, or `undefined` if not found.
 */
function resolveAgentEntry(cfg: OpenClawConfig, agentId: string): AgentEntry | undefined {
  const id = normalizeAgentId(agentId);
  return listAgentEntries(cfg).find((entry) => normalizeAgentId(entry.id) === id);
}

/**
 * Resolves the full agent configuration for the specified agent ID.
 *
 * Normalizes and type-narrows the raw config entry fields (name, workspace,
 * model, skills, sandbox, etc.) into a {@link ResolvedAgentConfig}.
 *
 * @param cfg     - The OpenClaw configuration object.
 * @param agentId - The agent ID to resolve.
 * @returns The resolved config, or `undefined` if the agent is not found.
 */
export function resolveAgentConfig(
  cfg: OpenClawConfig,
  agentId: string,
): ResolvedAgentConfig | undefined {
  const id = normalizeAgentId(agentId);
  const entry = resolveAgentEntry(cfg, id);
  if (!entry) {
    return undefined;
  }
  return {
    name: typeof entry.name === "string" ? entry.name : undefined,
    workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
    agentDir: typeof entry.agentDir === "string" ? entry.agentDir : undefined,
    model:
      typeof entry.model === "string" || (entry.model && typeof entry.model === "object")
        ? entry.model
        : undefined,
    skills: Array.isArray(entry.skills) ? entry.skills : undefined,
    memorySearch: entry.memorySearch,
    humanDelay: entry.humanDelay,
    heartbeat: entry.heartbeat,
    identity: entry.identity,
    groupChat: entry.groupChat,
    subagents: typeof entry.subagents === "object" && entry.subagents ? entry.subagents : undefined,
    sandbox: entry.sandbox,
    tools: entry.tools,
  };
}

/**
 * Resolves the skills filter list for the given agent.
 *
 * @param cfg     - The OpenClaw configuration object.
 * @param agentId - The agent ID to resolve skills for.
 * @returns An array of normalized skill filter strings, or `undefined` if unset.
 */
export function resolveAgentSkillsFilter(
  cfg: OpenClawConfig,
  agentId: string,
): string[] | undefined {
  return normalizeSkillFilter(resolveAgentConfig(cfg, agentId)?.skills);
}

/**
 * Resolves the primary model identifier for the given agent.
 *
 * The model can be specified as a plain string or an object with a `primary` field.
 *
 * @param cfg     - The OpenClaw configuration object.
 * @param agentId - The agent ID.
 * @returns The trimmed primary model string, or `undefined` if not configured.
 */
export function resolveAgentModelPrimary(cfg: OpenClawConfig, agentId: string): string | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw) {
    return undefined;
  }
  if (typeof raw === "string") {
    return raw.trim() || undefined;
  }
  const primary = raw.primary?.trim();
  return primary || undefined;
}

/**
 * Resolves the per-agent model fallback overrides.
 *
 * An explicitly provided empty array disables global fallbacks for this agent.
 * Returns `undefined` when no per-agent fallback override is configured.
 *
 * @param cfg     - The OpenClaw configuration object.
 * @param agentId - The agent ID.
 * @returns An array of fallback model strings, or `undefined`.
 */
export function resolveAgentModelFallbacksOverride(
  cfg: OpenClawConfig,
  agentId: string,
): string[] | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw || typeof raw === "string") {
    return undefined;
  }
  // Important: treat an explicitly provided empty array as an override to disable global fallbacks.
  if (!Object.hasOwn(raw, "fallbacks")) {
    return undefined;
  }
  return Array.isArray(raw.fallbacks) ? raw.fallbacks : undefined;
}

/**
 * Computes the effective model fallback list, considering both agent-level
 * overrides and session-level model overrides.
 *
 * When a session-level model override exists, global default fallbacks may
 * still apply unless the agent explicitly overrides them.
 *
 * @param params - Configuration, agent ID, and whether a session model override exists.
 * @returns The effective fallback model list, or `undefined`.
 */
export function resolveEffectiveModelFallbacks(params: {
  cfg: OpenClawConfig;
  agentId: string;
  hasSessionModelOverride: boolean;
}): string[] | undefined {
  const agentFallbacksOverride = resolveAgentModelFallbacksOverride(params.cfg, params.agentId);
  if (!params.hasSessionModelOverride) {
    return agentFallbacksOverride;
  }
  const defaultFallbacks =
    typeof params.cfg.agents?.defaults?.model === "object"
      ? (params.cfg.agents.defaults.model.fallbacks ?? [])
      : [];
  return agentFallbacksOverride ?? defaultFallbacks;
}

/**
 * Resolves the workspace directory for a given agent.
 *
 * Priority:
 * 1. Per-agent `workspace` field in config.
 * 2. For the default agent: `agents.defaults.workspace`, then the
 *    default workspace derived from environment variables.
 * 3. For non-default agents: `<stateDir>/workspace-<agentId>`.
 *
 * @param cfg     - The OpenClaw configuration object.
 * @param agentId - The agent ID.
 * @returns The absolute path to the agent's workspace directory.
 */
export function resolveAgentWorkspaceDir(cfg: OpenClawConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  if (id === defaultAgentId) {
    const fallback = cfg.agents?.defaults?.workspace?.trim();
    if (fallback) {
      return resolveUserPath(fallback);
    }
    return resolveDefaultAgentWorkspaceDir(process.env);
  }
  const stateDir = resolveStateDir(process.env);
  return path.join(stateDir, `workspace-${id}`);
}

/**
 * Resolves the agent state directory (for agent-specific persistent data).
 *
 * Uses the per-agent `agentDir` config field if set, otherwise defaults to
 * `<stateDir>/agents/<agentId>/agent`.
 *
 * @param cfg     - The OpenClaw configuration object.
 * @param agentId - The agent ID.
 * @returns The absolute path to the agent directory.
 */
export function resolveAgentDir(cfg: OpenClawConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.agentDir?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const root = resolveStateDir(process.env);
  return path.join(root, "agents", id, "agent");
}
