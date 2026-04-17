/**
 * @module agent-prompt
 *
 * Builds a formatted agent prompt message from a sequence of conversation entries.
 * Combines conversation history with the current user/tool message so the agent
 * can generate a contextually aware response.
 */

import { buildHistoryContextFromEntries, type HistoryEntry } from "../auto-reply/reply/history.js";

/**
 * Represents a single entry in a conversation, annotated with its role.
 */
export type ConversationEntry = {
  /** The role of the participant who produced this entry. */
  role: "user" | "assistant" | "tool";
  /** The underlying history entry containing sender and body text. */
  entry: HistoryEntry;
};

/**
 * Constructs a formatted message string from an array of conversation entries
 * suitable for feeding into an agent.
 *
 * The function identifies the most recent user or tool entry as the "current
 * message" that the agent should respond to, and treats all preceding entries
 * as conversation history. If no user/tool entry is found, the last entry
 * (regardless of role) is used as the current message.
 *
 * @param entries - An ordered array of conversation entries (oldest first).
 * @returns A formatted string combining history context and the current message,
 *          or an empty string if the entries array is empty.
 */
export function buildAgentMessageFromConversationEntries(entries: ConversationEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  // Prefer the last user/tool entry as "current message" so the agent responds to
  // the latest user input or tool output, not the assistant's previous message.
  let currentIndex = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const role = entries[i]?.role;
    if (role === "user" || role === "tool") {
      currentIndex = i;
      break;
    }
  }
  // Fallback: if no user/tool entry exists, use the very last entry
  if (currentIndex < 0) {
    currentIndex = entries.length - 1;
  }

  const currentEntry = entries[currentIndex]?.entry;
  if (!currentEntry) {
    return "";
  }

  // Everything before the current entry is treated as history context
  const historyEntries = entries.slice(0, currentIndex).map((e) => e.entry);
  if (historyEntries.length === 0) {
    // No history — just return the body of the current entry directly
    return currentEntry.body;
  }

  /** Formats a history entry as "sender: body" for display in the prompt. */
  const formatEntry = (entry: HistoryEntry) => `${entry.sender}: ${entry.body}`;
  return buildHistoryContextFromEntries({
    entries: [...historyEntries, currentEntry],
    currentMessage: formatEntry(currentEntry),
    formatEntry,
  });
}
