/**
 * @module agent/agent
 *
 * Core Agent implementation for the OpenClaw autonomous AI agent framework.
 *
 * This module contains the primary {@link Agent} class which orchestrates the
 * agentic loop: it accepts a task, builds a system prompt enriched with
 * memory and RBAC context, repeatedly calls the LLM, processes tool calls
 * (memory search/store, shell execution, skill invocations), and collects
 * turn-by-turn results until the task is completed, an error occurs, or the
 * maximum number of turns is reached.
 *
 * The Agent extends Node.js EventEmitter so callers can subscribe to
 * lifecycle events such as "turnStart", "turnEnd", and "taskComplete".
 */

import { EventEmitter } from "events";
import { LaneQueue } from "../lane-queue";
import { GraphMemory, MemoryNode } from "../memory";
import { RbacEngine } from "../rbac";
import { Sandbox } from "../sandbox";
import { SkillRunner } from "../skills";
import {
  AgentConfig,
  AgentMessage,
  AgentTask,
  AgentTurnResult,
  LlmProvider,
  ToolCall,
  ToolResult,
} from "./types";

/**
 * The main autonomous agent class.
 *
 * Orchestrates task execution through an agentic loop that alternates between
 * LLM inference and tool execution. The agent is provider-agnostic — any
 * function conforming to the {@link LlmProvider} signature can power it.
 *
 * **Key capabilities:**
 * - Builds context-aware system prompts using memory graph and RBAC roles
 * - Manages a bounded set of concurrent conversations (up to {@link MAX_CONVERSATIONS})
 * - Supports built-in tools: `memory_search`, `memory_store`, `shell_exec`, `task_complete`
 * - Delegates unknown tool calls to the {@link SkillRunner} for extensible skill execution
 * - Emits events: `turnStart`, `turnEnd`, `taskComplete`
 *
 * @extends EventEmitter
 */
export class Agent extends EventEmitter {
  /** Agent-level configuration (model, temperature, max turns, system prompt). */
  private readonly config: AgentConfig;

  /** Graph-based memory store for persisting facts, tasks, and experiences across turns. */
  private readonly memory: GraphMemory;

  /** Skill runner that provides MCP-compatible tool definitions and invocation. */
  private readonly skills: SkillRunner;

  /** Sandboxed execution environment for shell commands. */
  private readonly sandbox: Sandbox;

  /** Role-based access control engine used to gate tool permissions. */
  private readonly rbac: RbacEngine;

  /** Lane-based queue for scheduling work (reserved for future use / downstream consumers). */
  private readonly queue: LaneQueue;

  /** The LLM provider function. Must be set via {@link setLlmProvider} before executing tasks. */
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  private llmProvider: LlmProvider | null = null;

  /** Upper bound on the number of conversations held in memory to prevent unbounded growth. */
  private static readonly MAX_CONVERSATIONS = 100;

  /** In-memory map of conversation histories keyed by task/conversation ID. */
  private readonly conversations = new Map<string, AgentMessage[]>();

  /**
   * Creates a new Agent instance.
   *
   * @param config  - Agent configuration (model, turns, temperature, system prompt).
   * @param memory  - The graph memory store for context persistence.
   * @param skills  - The skill runner providing tool definitions and invocation.
   * @param sandbox - The sandboxed shell execution environment.
   * @param rbac    - The RBAC engine for permission checks.
   * @param queue   - The lane queue for work scheduling.
   */
  constructor(
    config: AgentConfig,
    memory: GraphMemory,
    skills: SkillRunner,
    sandbox: Sandbox,
    rbac: RbacEngine,
    queue: LaneQueue,
  ) {
    super();
    this.config = config;
    this.memory = memory;
    this.skills = skills;
    this.sandbox = sandbox;
    this.rbac = rbac;
    this.queue = queue;
  }

  /**
   * Assigns an LLM provider to this agent.
   *
   * Must be called before {@link executeTask}, otherwise the agent will throw.
   *
   * @param provider - A function matching the {@link LlmProvider} signature.
   */
  setLlmProvider(provider: LlmProvider): void {
    this.llmProvider = provider;
  }

  /**
   * Checks whether an LLM provider has been configured.
   *
   * @returns `true` if {@link setLlmProvider} has been called with a non-null provider.
   */
  hasLlmProvider(): boolean {
    return this.llmProvider !== null;
  }

  /**
   * Executes an agent task through the agentic loop.
   *
   * The loop proceeds as follows for each turn (up to `config.maxTurns`):
   * 1. Emit "turnStart" event and record the turn in the memory graph.
   * 2. Collect available tools (skills + built-in tools).
   * 3. Call the LLM with the full conversation history and tool definitions.
   * 4. If the LLM requests tool calls, execute them and append results to the conversation.
   * 5. If the LLM calls `task_complete` or finishes with reason "stop", end the loop.
   * 6. If max turns are reached, mark the last result with reason "max_turns".
   *
   * @param task - The task to execute, containing instruction, role, and optional context.
   * @returns An array of {@link AgentTurnResult} objects, one per turn executed.
   * @throws Error if no LLM provider has been configured.
   */
  async executeTask(task: AgentTask): Promise<AgentTurnResult[]> {
    if (!this.llmProvider) {
      throw new Error("No LLM provider configured. Call setLlmProvider() first.");
    }

    const conversationId = task.id;
    const results: AgentTurnResult[] = [];

    // Initialize conversation with system prompt and memory context
    const messages: AgentMessage[] = [];

    // System prompt
    const systemPrompt = this.buildSystemPrompt(task);
    messages.push({
      role: "system",
      content: systemPrompt,
      timestamp: Date.now(),
    });

    // User instruction
    messages.push({
      role: "user",
      content: task.instruction,
      timestamp: Date.now(),
    });

    this.conversations.set(conversationId, messages);

    // Evict oldest conversation if over limit
    if (this.conversations.size > Agent.MAX_CONVERSATIONS) {
      const oldest = this.conversations.keys().next().value;
      if (oldest) {
        this.conversations.delete(oldest);
      }
    }

    // Store the task in memory graph
    const _taskNode = this.memory.addNode(
      "task",
      task.instruction,
      {
        taskId: task.id,
        role: task.role,
      },
      0.8,
    );

    // Agentic loop
    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      this.emit("turnStart", { taskId: task.id, turn });
      this.memory.recordTurn();

      const tools = this.skills.toMcpTools().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      }));

      // Add built-in tools
      tools.push(
        {
          name: "memory_search",
          description: "Search the agent's memory graph for relevant information",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              types: {
                type: "array",
                items: { type: "string" },
                description: "Filter by memory types",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "memory_store",
          description: "Store a new fact or observation in memory",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "Content to store" },
              type: {
                type: "string",
                enum: ["fact", "task", "contact", "file", "experience"],
                description: "Type of memory",
              },
              importance: {
                type: "number",
                description: "Importance score 0-1",
              },
            },
            required: ["content"],
          },
        },
        {
          name: "shell_exec",
          description: "Execute a shell command in the sandbox",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Command to execute" },
              args: {
                type: "array",
                items: { type: "string" },
                description: "Command arguments",
              },
            },
            required: ["command"],
          },
        },
        {
          name: "task_complete",
          description: "Signal that the task is complete",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string", description: "Summary of what was accomplished" },
            },
            required: ["summary"],
          },
        },
      );

      let response;
      try {
        response = await this.llmProvider(messages, tools, {
          model: this.config.defaultModel,
          temperature: this.config.temperature,
        });
      } catch (err: unknown) {
        const turnResult: AgentTurnResult = {
          turn,
          message: {
            role: "assistant",
            content: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now(),
          },
          toolCalls: [],
          finished: true,
          reason: "error",
        };
        results.push(turnResult);
        this.emit("turnEnd", turnResult);
        break;
      }

      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: response.content,
        timestamp: Date.now(),
      };
      messages.push(assistantMessage);

      // Handle tool calls
      if (response.toolCalls.length > 0) {
        const toolResults = await this.processToolCalls(response.toolCalls, task.role);

        for (const result of toolResults) {
          messages.push({
            role: "tool",
            content: JSON.stringify(result.output),
            toolResult: result,
            timestamp: Date.now(),
          });
        }

        // Check if task_complete was called
        const completed = response.toolCalls.some((tc) => tc.name === "task_complete");

        const turnResult: AgentTurnResult = {
          turn,
          message: assistantMessage,
          toolCalls: response.toolCalls,
          finished: completed,
          reason: completed ? "completed" : undefined,
        };
        results.push(turnResult);
        this.emit("turnEnd", turnResult);

        if (completed) {
          // Store completion in memory
          this.memory.addNode(
            "experience",
            `Completed task: ${task.instruction}`,
            { taskId: task.id, turns: turn + 1 },
            0.7,
          );
          break;
        }
      } else {
        // No tool calls — the LLM responded with just text
        const turnResult: AgentTurnResult = {
          turn,
          message: assistantMessage,
          toolCalls: [],
          finished: response.finishReason === "stop",
          reason: response.finishReason === "stop" ? "completed" : undefined,
        };
        results.push(turnResult);
        this.emit("turnEnd", turnResult);

        if (response.finishReason === "stop") {
          break;
        }
      }
    }

    // Check if we hit max turns
    if (results.length > 0 && !results[results.length - 1].finished) {
      const lastResult = results[results.length - 1];
      lastResult.finished = true;
      lastResult.reason = "max_turns";
    }

    this.emit("taskComplete", {
      taskId: task.id,
      turns: results.length,
      reason: results[results.length - 1]?.reason,
    });

    return results;
  }

  /**
   * Retrieves the conversation history for a given task.
   *
   * @param taskId - The unique task/conversation identifier.
   * @returns The array of messages in the conversation, or an empty array if not found.
   */
  getConversation(taskId: string): AgentMessage[] {
    return this.conversations.get(taskId) || [];
  }

  /**
   * Constructs the system prompt for a task.
   *
   * The prompt is assembled from several pieces:
   * 1. The custom system prompt from config, or a sensible default.
   * 2. Relevant memories retrieved from the graph memory store.
   * 3. Sanitized additional context provided in the task.
   * 4. The caller's RBAC role name and permissions.
   *
   * @param task - The task whose instruction is used to query relevant memories.
   * @returns The fully assembled system prompt string.
   */
  private buildSystemPrompt(task: AgentTask): string {
    const parts: string[] = [];

    if (this.config.systemPrompt) {
      parts.push(this.config.systemPrompt);
    } else {
      parts.push(
        "You are OpenClaw, an autonomous AI agent. You can use tools to accomplish tasks. " +
          "Always explain your reasoning before taking actions. " +
          "Use memory_search to recall relevant context and memory_store to save important facts.",
      );
    }

    // Inject relevant memories
    const relevantMemories = this.memory.query({
      text: task.instruction,
      limit: 5,
      minImportance: 0.3,
    });

    if (relevantMemories.nodes.length > 0) {
      parts.push("\n## Relevant Memories");
      for (const node of relevantMemories.nodes) {
        parts.push(`- [${node.type}] ${node.content}`);
      }
    }

    // Inject context if provided — sanitize to prevent prompt injection
    if (task.context) {
      const sanitized = this.sanitizePromptInput(task.context);
      parts.push(`\n## Additional Context\n${sanitized}`);
    }

    // Inject role info
    const role = this.rbac.getRole(task.role);
    if (role) {
      parts.push(`\n## Your Role: ${role.name}\nPermissions: ${role.permissions.join(", ")}`);
    }

    return parts.join("\n");
  }

  /**
   * Processes an array of tool calls sequentially.
   *
   * Each tool call is dispatched to the appropriate handler based on its name.
   * Results are collected in order and returned.
   *
   * @param toolCalls  - The tool calls requested by the LLM.
   * @param callerRole - The RBAC role of the task's caller, forwarded to permission checks.
   * @returns An array of {@link ToolResult} objects, one per tool call.
   */
  private async processToolCalls(toolCalls: ToolCall[], callerRole: string): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const result = await this.executeSingleToolCall(call, callerRole);
      results.push(result);
    }

    return results;
  }

  /**
   * Dispatches a single tool call to the appropriate handler.
   *
   * Built-in tools (`memory_search`, `memory_store`, `shell_exec`, `task_complete`)
   * are handled directly. All other tool names are forwarded to the
   * {@link SkillRunner} via {@link handleSkillCall}.
   *
   * @param call       - The tool call to execute.
   * @param callerRole - The RBAC role used for permission checks.
   * @returns The result of executing the tool.
   */
  private async executeSingleToolCall(call: ToolCall, callerRole: string): Promise<ToolResult> {
    switch (call.name) {
      case "memory_search":
        return this.handleMemorySearch(call);
      case "memory_store":
        return this.handleMemoryStore(call);
      case "shell_exec":
        return this.handleShellExec(call, callerRole);
      case "task_complete":
        return {
          callId: call.id,
          success: true,
          output: { completed: true, summary: call.arguments.summary },
        };
      default:
        return this.handleSkillCall(call, callerRole);
    }
  }

  /**
   * Sanitize user-supplied text before injecting into system prompts.
   * Strips common prompt injection patterns.
   */
  private sanitizePromptInput(input: string): string {
    return (
      input
        // Strip system/assistant role injection attempts
        .replace(/\b(system|assistant)\s*:/gi, "[role]:")
        // Strip common injection delimiters
        .replace(/<\/?(?:system|instruction|prompt|im_start|im_end)[^>]*>/gi, "")
        // Limit length to prevent context stuffing
        .slice(0, 4096)
    );
  }

  /**
   * Handles the built-in `memory_search` tool call.
   *
   * Queries the graph memory store with the provided search text and optional
   * type filters, returning up to 10 matching nodes with their metadata.
   *
   * @param call - The tool call containing `query` and optional `types` arguments.
   * @returns A {@link ToolResult} with matching memory nodes and total match count.
   */
  private handleMemorySearch(call: ToolCall): ToolResult {
    const query = (call.arguments.query as string).slice(0, 1024);
    const types = call.arguments.types as string[] | undefined;

    const results = this.memory.query({
      text: query,
      types: types as MemoryNode["type"][] | undefined,
      limit: 10,
      includeEdges: true,
    });

    return {
      callId: call.id,
      success: true,
      output: {
        nodes: results.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          content: n.content,
          importance: n.importance,
        })),
        totalMatched: results.totalMatched,
      },
    };
  }

  /**
   * Handles the built-in `memory_store` tool call.
   *
   * Adds a new node to the graph memory with the specified content, type,
   * and importance score. Defaults to type "fact" and importance 0.5 when
   * not provided.
   *
   * @param call - The tool call containing `content`, optional `type`, and optional `importance`.
   * @returns A {@link ToolResult} with the created node's ID and confirmation.
   */
  private handleMemoryStore(call: ToolCall): ToolResult {
    const content = call.arguments.content as string;
    const type = (call.arguments.type as string) || "fact";
    const importance = (call.arguments.importance as number) || 0.5;

    const node = this.memory.addNode(type as MemoryNode["type"], content, {}, importance);

    return {
      callId: call.id,
      success: true,
      output: { nodeId: node.id, stored: true },
    };
  }

  /**
   * Handles the built-in `shell_exec` tool call.
   *
   * First performs an RBAC permission check to ensure the caller's role is
   * allowed to execute shell commands. If permitted, delegates execution to
   * the sandboxed environment and returns stdout/stderr/exit code.
   *
   * @param call       - The tool call containing `command` and optional `args`.
   * @param callerRole - The RBAC role to check permissions against.
   * @returns A {@link ToolResult} with execution output or a permission-denied error.
   */
  private async handleShellExec(call: ToolCall, callerRole: string): Promise<ToolResult> {
    // RBAC check
    const accessCheck = this.rbac.check({
      role: callerRole,
      resourceType: "shell",
      resourcePath: call.arguments.command as string,
      action: "SHELL_EXEC",
    });

    if (!accessCheck.allowed) {
      return {
        callId: call.id,
        success: false,
        output: null,
        error: `Permission denied: ${accessCheck.reason}`,
      };
    }

    const execResult = await this.sandbox.execute({
      id: call.id,
      command: call.arguments.command as string,
      args: (call.arguments.args as string[]) || [],
    });

    return {
      callId: call.id,
      success: execResult.exitCode === 0,
      output: {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        durationMs: execResult.durationMs,
      },
      error: execResult.exitCode !== 0 ? execResult.stderr : undefined,
    };
  }

  /**
   * Handles tool calls that do not match any built-in tool.
   *
   * Delegates to the {@link SkillRunner} which looks up the skill by name,
   * validates inputs, and executes it with the caller's RBAC role.
   *
   * @param call       - The tool call to forward to the skill runner.
   * @param callerRole - The RBAC role of the caller.
   * @returns A {@link ToolResult} with the skill's output or error.
   */
  private async handleSkillCall(call: ToolCall, callerRole: string): Promise<ToolResult> {
    const result = await this.skills.invoke({
      id: call.id,
      skillName: call.name,
      inputs: call.arguments,
      callerRole,
      timestamp: Date.now(),
    });

    return {
      callId: call.id,
      success: result.success,
      output: result.outputs,
      error: result.error,
    };
  }
}
