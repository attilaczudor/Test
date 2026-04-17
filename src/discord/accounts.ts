/**
 * @module discord/accounts
 *
 * Discord account resolution and configuration module.
 *
 * Provides utilities for resolving Discord bot accounts from the OpenClaw
 * configuration, including multi-account support, token resolution, and
 * per-account action gating. Each account can be independently enabled/disabled
 * and configured with its own token, guild settings, and action permissions.
 */

import { createAccountActionGate } from "../channels/plugins/account-action-gate.js";
import { createAccountListHelpers } from "../channels/plugins/account-helpers.js";
import type { OpenClawConfig } from "../config/config.js";
import type { DiscordAccountConfig, DiscordActionConfig } from "../config/types.js";
import { normalizeAccountId } from "../routing/session-key.js";
import { resolveDiscordToken } from "./token.js";

/**
 * Represents a fully resolved Discord bot account with its configuration,
 * authentication token, and enabled state merged from base and per-account settings.
 */
export type ResolvedDiscordAccount = {
  /** Normalized account identifier */
  accountId: string;
  /** Whether this account is enabled (combines base and per-account enabled flags) */
  enabled: boolean;
  /** Optional display name for the account */
  name?: string;
  /** Bot authentication token (empty string if not configured) */
  token: string;
  /** Where the token was sourced from: environment variable, config file, or missing */
  tokenSource: "env" | "config" | "none";
  /** Merged account configuration (base config overlaid with per-account overrides) */
  config: DiscordAccountConfig;
};

// Create reusable account list helpers scoped to the "discord" channel
const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("discord");

/** Lists all configured Discord account IDs from the OpenClaw config. */
export const listDiscordAccountIds = listAccountIds;

/** Resolves the default Discord account ID (falls back to the global default). */
export const resolveDefaultDiscordAccountId = resolveDefaultAccountId;

/**
 * Looks up the per-account configuration block for a specific Discord account.
 *
 * @param cfg - The full OpenClaw configuration
 * @param accountId - The account identifier to look up
 * @returns The account-specific config, or undefined if not found
 */
function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): DiscordAccountConfig | undefined {
  const accounts = cfg.channels?.discord?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as DiscordAccountConfig | undefined;
}

/**
 * Merges the base Discord channel configuration with account-specific overrides.
 * The base config (everything except the `accounts` key) is used as defaults,
 * then the per-account config is spread on top.
 *
 * @param cfg - The full OpenClaw configuration
 * @param accountId - The account whose config to merge
 * @returns Merged configuration with account overrides applied
 */
function mergeDiscordAccountConfig(cfg: OpenClawConfig, accountId: string): DiscordAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.discord ?? {}) as DiscordAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function createDiscordActionGate(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): (key: keyof DiscordActionConfig, defaultValue?: boolean) => boolean {
  const accountId = normalizeAccountId(params.accountId);
  return createAccountActionGate({
    baseActions: params.cfg.channels?.discord?.actions,
    accountActions: resolveAccountConfig(params.cfg, accountId)?.actions,
  });
}

export function resolveDiscordAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedDiscordAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.discord?.enabled !== false;
  const merged = mergeDiscordAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const tokenResolution = resolveDiscordToken(params.cfg, { accountId });
  return {
    accountId,
    enabled,
    name: merged.name?.trim() || undefined,
    token: tokenResolution.token,
    tokenSource: tokenResolution.source,
    config: merged,
  };
}

export function listEnabledDiscordAccounts(cfg: OpenClawConfig): ResolvedDiscordAccount[] {
  return listDiscordAccountIds(cfg)
    .map((accountId) => resolveDiscordAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
