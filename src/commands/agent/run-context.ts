/**
 * @module commands/agent/run-context
 * @description Resolves and merges agent run context from command options.
 */

import { normalizeAccountId } from "../../utils/account-id.js";
import { resolveMessageChannel } from "../../utils/message-channel.js";
import type { AgentCommandOpts, AgentRunContext } from "./types.js";

/**
 * Resolves and merges agent run context fields from command options.
 * Normalizes channel, account, group, and thread identifiers.
 * @param opts - The agent command options to derive context from.
 * @returns A merged AgentRunContext with normalized values.
 */
export function resolveAgentRunContext(opts: AgentCommandOpts): AgentRunContext {
  const merged: AgentRunContext = opts.runContext ? { ...opts.runContext } : {};

  const normalizedChannel = resolveMessageChannel(
    merged.messageChannel ?? opts.messageChannel,
    opts.replyChannel ?? opts.channel,
  );
  if (normalizedChannel) {
    merged.messageChannel = normalizedChannel;
  }

  const normalizedAccountId = normalizeAccountId(merged.accountId ?? opts.accountId);
  if (normalizedAccountId) {
    merged.accountId = normalizedAccountId;
  }

  const groupId = (merged.groupId ?? opts.groupId)?.toString().trim();
  if (groupId) {
    merged.groupId = groupId;
  }

  const groupChannel = (merged.groupChannel ?? opts.groupChannel)?.toString().trim();
  if (groupChannel) {
    merged.groupChannel = groupChannel;
  }

  const groupSpace = (merged.groupSpace ?? opts.groupSpace)?.toString().trim();
  if (groupSpace) {
    merged.groupSpace = groupSpace;
  }

  if (
    merged.currentThreadTs == null &&
    opts.threadId != null &&
    opts.threadId !== "" &&
    opts.threadId !== null
  ) {
    merged.currentThreadTs = String(opts.threadId);
  }

  // Populate currentChannelId from the outbound target so that
  // resolveTelegramAutoThreadId can match the originating chat.
  if (!merged.currentChannelId && opts.to) {
    const trimmedTo = opts.to.trim();
    if (trimmedTo) {
      merged.currentChannelId = trimmedTo;
    }
  }

  return merged;
}
