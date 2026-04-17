/**
 * @module agent/types
 *
 * Core type definitions for the Agent framework.
 *
 * This module defines the fundamental interfaces and types used throughout
 * the agent system, including configuration, messaging, tool interaction,
 * task management, and LLM provider contracts. All other agent modules
 * depend on these shared type definitions.
 */

/**
 * Configuration object that governs Agent behavior.
 *
 * @property defaultModel   - The identifier of the LLM model to use (e.g. "claude-opus-4-6").
 * @property maxTurns       - The maximum number of agentic loop iterations before the agent
 *                            forcibly stops, preventing runaway conversations.
 * @property temperature    - Sampling temperature passed to the LLM provider; higher values
 *                            yield more creative/random outputs.
 * @property systemPrompt   - Optional custom system prompt. When omitted the Agent class
 *                            falls back to a built-in default prompt.
 */
export interface AgentConfig {
  defaultModel: string;
  maxTurns: number;
  temperature: number;
  systemPrompt?: string;
}

/**
 * A single message within an agent conversation.
 *
 * Messages are appended to the conversation history in chronological order
 * and are forwarded to the LLM on every turn so the model retains context.
 *
 * @property role       - The participant role: "system" for system prompts,
 *                        "user" for human input, "assistant" for LLM output,
 *                        and "tool" for tool-call results.
 * @property content    - The textual content of the message.
 * @property toolCall   - An optional reference to the tool call that produced
 *                        this message (present when role is "assistant" and
 *                        the LLM requested a tool invocation).
 * @property toolResult - An optional tool result payload (present when
 *                        role is "tool").
 * @property timestamp  - Unix epoch millisecond timestamp when the message
 *                        was created.
 */
export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
}

/**
 * Represents a single tool invocation request from the LLM.
 *
 * When the LLM decides to use a tool it emits one or more ToolCall objects.
 * Each call carries a unique id so that the corresponding ToolResult can be
 * correlated back.
 *
 * @property id        - A unique identifier for this tool call, used to match
 *                       the result back to the request.
 * @property name      - The name of the tool being invoked (e.g. "shell_exec",
 *                       "memory_search").
 * @property arguments - A key-value map of arguments passed to the tool.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * The outcome of executing a single tool call.
 *
 * @property callId  - Corresponds to the originating {@link ToolCall.id}.
 * @property success - Whether the tool executed without error.
 * @property output  - The tool's return value; structure varies per tool.
 * @property error   - An optional human-readable error message when
 *                     `success` is false.
 */
export interface ToolResult {
  callId: string;
  success: boolean;
  output: unknown;
  error?: string;
}

/**
 * Describes a task (unit of work) that the Agent should execute.
 *
 * A task is the top-level input to {@link Agent.executeTask}. It bundles the
 * user's instruction with metadata such as role-based access control (RBAC)
 * role and optional supplementary context.
 *
 * @property id          - Unique identifier for the task, also used as the
 *                         conversation ID.
 * @property instruction - The natural-language instruction the agent should
 *                         carry out.
 * @property context     - Optional additional context injected into the system
 *                         prompt (sanitized before use to prevent prompt injection).
 * @property role        - The RBAC role of the caller, used to gate tool access.
 * @property createdAt   - Unix epoch millisecond timestamp when the task was created.
 */
export interface AgentTask {
  id: string;
  instruction: string;
  context?: string;
  role: string; // RBAC role
  createdAt: number;
}

/**
 * The result of a single turn within the agentic loop.
 *
 * Each call to the LLM produces one AgentTurnResult. The full task execution
 * returns an array of these results — one per turn.
 *
 * @property turn      - Zero-based index of the turn within the loop.
 * @property message   - The assistant's response message for this turn.
 * @property toolCalls - Any tool calls the LLM requested on this turn
 *                       (empty array when the response was text-only).
 * @property finished  - Whether this turn caused the agentic loop to stop.
 * @property reason    - The reason the loop stopped, when `finished` is true.
 *                       "completed" means the task finished normally,
 *                       "max_turns" means the turn limit was hit,
 *                       "error" means an LLM or tool error occurred, and
 *                       "user_cancel" means the user aborted the task.
 */
export interface AgentTurnResult {
  turn: number;
  message: AgentMessage;
  toolCalls: ToolCall[];
  finished: boolean;
  reason?: "completed" | "max_turns" | "error" | "user_cancel";
}

/**
 * Function signature for an LLM provider.
 *
 * The Agent class is provider-agnostic; any function matching this signature
 * can serve as the underlying language model. The provider receives the full
 * conversation history, the available tool definitions, and model
 * configuration, and must return a promise resolving to an {@link LlmResponse}.
 *
 * @param messages - The ordered conversation history.
 * @param tools    - The set of tools the LLM is allowed to invoke.
 * @param config   - Model selection and sampling parameters.
 * @returns A promise that resolves to the LLM's response.
 */
export type LlmProvider = (
  messages: AgentMessage[],
  tools: LlmTool[],
  config: { model: string; temperature: number },
) => Promise<LlmResponse>;

/**
 * Schema describing a single tool that the LLM may invoke.
 *
 * This is a simplified representation of a JSON-Schema-based tool
 * definition, compatible with most LLM provider APIs.
 *
 * @property name        - The unique tool name.
 * @property description - A human-readable description shown to the LLM so it
 *                         knows when and how to use the tool.
 * @property parameters  - A JSON-Schema-like object describing the tool's
 *                         accepted input parameters.
 */
export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * The structured response returned by an {@link LlmProvider}.
 *
 * @property content      - The textual content of the LLM's reply.
 * @property toolCalls    - Zero or more tool calls the LLM wants executed.
 * @property finishReason - Why the LLM stopped generating:
 *                          "stop" = natural end of response,
 *                          "tool_use" = waiting for tool results,
 *                          "length" = max token limit reached,
 *                          "error" = an error occurred.
 * @property usage        - Optional token usage statistics for monitoring
 *                          and billing purposes.
 */
export interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_use" | "length" | "error";
  usage?: { inputTokens: number; outputTokens: number };
}
