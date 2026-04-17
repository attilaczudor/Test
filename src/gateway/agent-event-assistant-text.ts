/**
 * @module agent-event-assistant-text
 *
 * Utility for extracting the text content from an agent assistant stream event.
 * Handles both delta-style and full-text event payloads, returning an empty
 * string when neither is available.
 */

import type { AgentEventPayload } from "../infra/agent-events.js";

/**
 * Extracts the assistant's text from an agent event payload.
 *
 * Agent events may deliver text in two forms:
 * - `delta`: an incremental chunk of text (used during streaming).
 * - `text`: the complete text snapshot.
 *
 * This function prefers `delta` when available and falls back to `text`.
 *
 * @param evt - The agent event payload to extract text from.
 * @returns The resolved text string, or an empty string if neither field is present.
 */
export function resolveAssistantStreamDeltaText(evt: AgentEventPayload): string {
  const delta = evt.data.delta;
  const text = evt.data.text;
  // Prefer incremental delta text; fall back to full text; default to empty string
  return typeof delta === "string" ? delta : typeof text === "string" ? text : "";
}
