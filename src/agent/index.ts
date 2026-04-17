/**
 * @module agent
 *
 * Public barrel export for the Agent module.
 *
 * Re-exports the {@link Agent} class and all core type definitions so that
 * consumers can import everything they need from a single entry point:
 *
 * ```ts
 * import { Agent, AgentConfig, AgentTask } from "./agent";
 * ```
 */

export { Agent } from "./agent";
export {
  AgentConfig,
  AgentMessage,
  AgentTask,
  AgentTurnResult,
  LlmProvider,
  LlmResponse,
  LlmTool,
  ToolCall,
  ToolResult,
} from "./types";
