/**
 * @module agents/agent-paths
 *
 * Resolves the filesystem path for the OpenClaw agent directory.
 *
 * The agent directory is where agent-specific state is persisted on disk.
 * The path can be overridden via the `OPENCLAW_AGENT_DIR` or
 * `PI_CODING_AGENT_DIR` environment variables; otherwise it defaults to
 * `<stateDir>/agents/<defaultAgentId>/agent`.
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { DEFAULT_AGENT_ID } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";

/**
 * Resolves the directory path for the OpenClaw agent.
 *
 * Checks `OPENCLAW_AGENT_DIR` and `PI_CODING_AGENT_DIR` environment
 * variables first (in that order). Falls back to the default state
 * directory if neither is set.
 *
 * @returns The absolute path to the agent directory.
 */
export function resolveOpenClawAgentDir(): string {
  const override =
    process.env.OPENCLAW_AGENT_DIR?.trim() || process.env.PI_CODING_AGENT_DIR?.trim();
  if (override) {
    return resolveUserPath(override);
  }
  const defaultAgentDir = path.join(resolveStateDir(), "agents", DEFAULT_AGENT_ID, "agent");
  return resolveUserPath(defaultAgentDir);
}

/**
 * Ensures both `OPENCLAW_AGENT_DIR` and `PI_CODING_AGENT_DIR` environment
 * variables are set, populating them with the resolved agent directory if
 * they are not already defined.
 *
 * @returns The resolved agent directory path.
 */
export function ensureOpenClawAgentEnv(): string {
  const dir = resolveOpenClawAgentDir();
  if (!process.env.OPENCLAW_AGENT_DIR) {
    process.env.OPENCLAW_AGENT_DIR = dir;
  }
  if (!process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = dir;
  }
  return dir;
}
