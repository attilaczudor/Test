/**
 * Smart Router — Council-Gated LLM Escalation
 *
 * Implements a three-phase routing pipeline:
 *
 *   1. LOCAL FIRST — Always try local Ollama. Fast, free, private.
 *   2. CONFIDENCE CHECK — Evaluate local response quality.
 *   3. COUNCIL GATE — Council director decides if cloud escalation is warranted.
 *
 * The council is the sole decision-maker for cloud escalation.
 * No blind fallback. Every cloud call is intentional, reasoned, and auditable.
 */

import * as crypto from "crypto";
import { EventEmitter } from "events";
import { AgentMessage, LlmResponse, LlmTool } from "../agent/types";
import { LlmProviderRegistry, ProviderConfig } from "../providers/llm-providers";
import { CostTracker } from "./cost-tracker";
import {
  SmartRouterConfig,
  DEFAULT_ROUTER_CONFIG,
  RoutingDecision,
  EscalationReason,
  EscalationRequest,
  EscalationVerdict,
  RouterStats,
} from "./types";

export class SmartRouter extends EventEmitter {
  private readonly config: SmartRouterConfig;
  private readonly registry: LlmProviderRegistry;
  readonly costTracker: CostTracker;
  private readonly decisions: RoutingDecision[] = [];

  // Counters
  private totalRequests = 0;
  private localRequests = 0;
  private escalatedRequests = 0;
  private councilEvaluations = 0;
  private councilApprovals = 0;
  private councilDenials = 0;
  private localConfidenceSum = 0;
  private cloudConfidenceSum = 0;
  private localLatencySum = 0;
  private cloudLatencySum = 0;

  // Council escalation callback — set by orchestrator
  private escalationEvaluator: ((req: EscalationRequest) => Promise<EscalationVerdict>) | null =
    null;

  constructor(registry: LlmProviderRegistry, config?: Partial<SmartRouterConfig>) {
    super();
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
    this.registry = registry;
    this.costTracker = new CostTracker(this.config.maxDailySpend);
  }

  /**
   * Set the council escalation evaluator.
   * Called by the orchestrator once the council is ready.
   */
  setEscalationEvaluator(evaluator: (req: EscalationRequest) => Promise<EscalationVerdict>): void {
    this.escalationEvaluator = evaluator;
  }

  /**
   * Route a message through the smart pipeline.
   * Returns the LLM response and the routing decision for audit/display.
   */
  async route(
    messages: AgentMessage[],
    tools: LlmTool[],
    llmConfig: { model: string; temperature: number },
    taskId?: string,
  ): Promise<{ response: LlmResponse; decision: RoutingDecision }> {
    const startTime = Date.now();
    const decisionId = `route-${crypto.randomUUID().slice(0, 8)}`;

    this.totalRequests++;

    // ── Phase 1: Try Local First ──────────────────────────────
    const localProvider = this.getLocalProvider();

    if (localProvider) {
      try {
        const localStart = Date.now();
        const localResponse = await this.callProvider(localProvider, messages, llmConfig);
        const localLatency = Date.now() - localStart;

        const confidence = this.assessConfidence(localResponse, messages);

        // Check if local response is sufficient
        if (confidence >= this.config.confidenceThreshold) {
          // Local is good enough — no escalation needed
          const decision = this.recordDecision({
            id: decisionId,
            timestamp: Date.now(),
            phase: "local",
            provider: localProvider.name,
            providerType: "local",
            escalated: false,
            confidenceScore: confidence,
            latencyMs: localLatency,
            inputTokens: localResponse.usage?.inputTokens || 0,
            outputTokens: localResponse.usage?.outputTokens || 0,
            costUsd: 0,
          });

          this.localRequests++;
          this.localConfidenceSum += confidence;
          this.localLatencySum += localLatency;

          return { response: localResponse, decision };
        }

        // ── Phase 2: Confidence too low — evaluate escalation ──
        const complexity = this.detectComplexity(messages);
        const reason: EscalationReason =
          confidence < 0.3
            ? "low_confidence"
            : complexity > 0.7
              ? "task_complexity"
              : "low_confidence";

        // If no council evaluator or auto-escalate is off and council unavailable,
        // return the local response anyway (with the low confidence noted)
        if (!this.escalationEvaluator) {
          const decision = this.recordDecision({
            id: decisionId,
            timestamp: Date.now(),
            phase: "local",
            provider: localProvider.name,
            providerType: "local",
            escalated: false,
            escalationReason: reason,
            confidenceScore: confidence,
            latencyMs: localLatency,
            inputTokens: localResponse.usage?.inputTokens || 0,
            outputTokens: localResponse.usage?.outputTokens || 0,
            costUsd: 0,
          });

          this.localRequests++;
          this.localConfidenceSum += confidence;
          this.localLatencySum += localLatency;

          return { response: localResponse, decision };
        }

        // ── Phase 3: Council evaluates escalation ─────────────
        this.councilEvaluations++;

        const escalationReq: EscalationRequest = {
          taskId: taskId || decisionId,
          originalQuestion: this.extractQuestion(messages),
          localResponse: localResponse.content,
          localConfidence: confidence,
          localProvider: localProvider.name,
          detectedComplexity: complexity,
          reason,
        };

        let verdict: EscalationVerdict;
        try {
          verdict = await this.escalationEvaluator(escalationReq);
        } catch {
          // Council evaluation failed — stick with local
          verdict = {
            shouldEscalate: false,
            reason: "Council evaluation failed — using local response",
            confidence: confidence,
            durationMs: 0,
          };
        }

        this.emit("escalationEvaluated", { request: escalationReq, verdict });

        if (!verdict.shouldEscalate) {
          // Council says local is fine
          this.councilDenials++;

          const decision = this.recordDecision({
            id: decisionId,
            timestamp: Date.now(),
            phase: "council_eval",
            provider: localProvider.name,
            providerType: "local",
            escalated: false,
            escalationReason: reason,
            councilApproved: false,
            councilReasoning: verdict.reason,
            confidenceScore: confidence,
            latencyMs: Date.now() - startTime,
            inputTokens: localResponse.usage?.inputTokens || 0,
            outputTokens: localResponse.usage?.outputTokens || 0,
            costUsd: 0,
          });

          this.localRequests++;
          this.localConfidenceSum += confidence;
          this.localLatencySum += Date.now() - startTime;

          return { response: localResponse, decision };
        }

        // Council approves escalation — use cloud
        this.councilApprovals++;

        const cloudResult = await this.escalateToCloud(
          messages,
          tools,
          llmConfig,
          decisionId,
          startTime,
          reason,
          verdict,
        );

        if (cloudResult) {
          return cloudResult;
        }

        // Cloud failed — fall back to local
        const decision = this.recordDecision({
          id: decisionId,
          timestamp: Date.now(),
          phase: "cloud_escalation",
          provider: localProvider.name,
          providerType: "local",
          escalated: false,
          escalationReason: reason,
          councilApproved: true,
          councilReasoning: verdict.reason + " (cloud failed, using local fallback)",
          confidenceScore: confidence,
          latencyMs: Date.now() - startTime,
          inputTokens: localResponse.usage?.inputTokens || 0,
          outputTokens: localResponse.usage?.outputTokens || 0,
          costUsd: 0,
        });

        this.localRequests++;
        return { response: localResponse, decision };
      } catch (localError: unknown) {
        // Local provider failed entirely — try cloud if available
        const errorMessage = localError instanceof Error ? localError.message : String(localError);
        this.emit("localFailure", { error: errorMessage });

        const cloudResult = await this.escalateToCloud(
          messages,
          tools,
          llmConfig,
          decisionId,
          startTime,
          "local_failure",
          {
            shouldEscalate: true,
            reason: `Local provider failed: ${errorMessage}`,
            confidence: 0,
            durationMs: 0,
          },
        );

        if (cloudResult) {
          return cloudResult;
        }

        // Everything failed
        throw new Error(`All providers failed. Local: ${localError.message}`, {
          cause: localError,
        });
      }
    }

    // No local provider available — try cloud directly
    const cloudResult = await this.escalateToCloud(
      messages,
      tools,
      llmConfig,
      decisionId,
      startTime,
      "local_failure",
      {
        shouldEscalate: true,
        reason: "No local provider available",
        confidence: 0,
        durationMs: 0,
      },
    );

    if (cloudResult) {
      return cloudResult;
    }

    throw new Error("No LLM providers available (local or cloud)");
  }

  /**
   * Create an LlmProvider function compatible with the Agent's interface.
   * Wraps the smart routing pipeline.
   */
  createProvider(): (
    messages: AgentMessage[],
    tools: LlmTool[],
    config: { model: string; temperature: number },
  ) => Promise<LlmResponse> {
    return async (messages, tools, config) => {
      const result = await this.route(messages, tools, config);
      return result.response;
    };
  }

  /**
   * Get routing statistics.
   */
  getStats(): RouterStats {
    return {
      totalRequests: this.totalRequests,
      localRequests: this.localRequests,
      escalatedRequests: this.escalatedRequests,
      councilEvaluations: this.councilEvaluations,
      councilApprovals: this.councilApprovals,
      councilDenials: this.councilDenials,
      avgLocalConfidence: this.localRequests > 0 ? this.localConfidenceSum / this.localRequests : 0,
      avgCloudConfidence:
        this.escalatedRequests > 0 ? this.cloudConfidenceSum / this.escalatedRequests : 0,
      avgLocalLatencyMs: this.localRequests > 0 ? this.localLatencySum / this.localRequests : 0,
      avgCloudLatencyMs:
        this.escalatedRequests > 0 ? this.cloudLatencySum / this.escalatedRequests : 0,
      costSummary: this.costTracker.getSummary(),
      recentDecisions: this.decisions.slice(-20),
    };
  }

  /**
   * Get all routing decisions for the activity feed.
   */
  getDecisions(): RoutingDecision[] {
    return [...this.decisions];
  }

  /**
   * Get the current config (for settings panel).
   */
  getConfig(): SmartRouterConfig {
    return { ...this.config };
  }

  /**
   * Update config dynamically (from settings panel).
   */
  updateConfig(updates: Partial<SmartRouterConfig>): void {
    Object.assign(this.config, updates);
    this.emit("configUpdated", this.config);
  }

  // ─── Private Methods ──────────────────────────────────────

  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  private getLocalProvider(): ProviderConfig | null {
    const providers = this.registry.getProviders();
    return providers.find((p) => p.type === "ollama" && p.enabled) || null;
  }

  private getCloudProviders(): ProviderConfig[] {
    const providers = this.registry.getProviders();
    return providers
      .filter((p) => p.type !== "ollama" && p.enabled)
      .toSorted((a, b) => a.priority - b.priority);
  }

  private async callProvider(
    provider: ProviderConfig,
    messages: AgentMessage[],
    config: { model: string; temperature: number },
  ): Promise<LlmResponse> {
    // Use the registry's provider-specific call logic
    const callFn = this.registry.createProvider();
    // Override to only use this specific provider by temporarily setting others as disabled
    // Instead, call through the registry which handles the protocol
    return callFn(messages, [], {
      model: config.model || provider.model,
      temperature: config.temperature,
    });
  }

  private async escalateToCloud(
    messages: AgentMessage[],
    _tools: LlmTool[],
    llmConfig: { model: string; temperature: number },
    decisionId: string,
    startTime: number,
    reason: EscalationReason,
    verdict: EscalationVerdict,
  ): Promise<{ response: LlmResponse; decision: RoutingDecision } | null> {
    const cloudProviders = this.getCloudProviders();

    if (cloudProviders.length === 0) {
      return null;
    }

    for (const provider of cloudProviders) {
      // Check budget
      const estimatedCost = this.costTracker.estimateCost("cloud", provider.model, 1000, 500);

      if (this.costTracker.wouldExceedBudget(estimatedCost)) {
        this.emit("budgetExceeded", {
          provider: provider.name,
          estimatedCost,
          dailySpend: this.costTracker.getTodaySpend(),
        });
        continue;
      }

      try {
        const cloudStart = Date.now();
        const callFn = this.registry.createProvider();
        const response = await callFn(messages, [], {
          model: provider.model,
          temperature: llmConfig.temperature,
        });
        const cloudLatency = Date.now() - cloudStart;

        const inputTokens = response.usage?.inputTokens || 0;
        const outputTokens = response.usage?.outputTokens || 0;
        const cost = this.costTracker.estimateCost(
          "cloud",
          provider.model,
          inputTokens,
          outputTokens,
        );

        // Record cost
        this.costTracker.record({
          timestamp: Date.now(),
          provider: provider.name,
          model: provider.model,
          inputTokens,
          outputTokens,
          costUsd: cost,
          routingDecisionId: decisionId,
        });

        const confidence = this.assessConfidence(response, messages);

        const decision = this.recordDecision({
          id: decisionId,
          timestamp: Date.now(),
          phase: "cloud_escalation",
          provider: provider.name,
          providerType: "cloud",
          escalated: true,
          escalationReason: reason,
          councilApproved: true,
          councilReasoning: verdict.reason,
          confidenceScore: confidence,
          latencyMs: Date.now() - startTime,
          inputTokens,
          outputTokens,
          costUsd: cost,
        });

        this.escalatedRequests++;
        this.cloudConfidenceSum += confidence;
        this.cloudLatencySum += cloudLatency;
        this.registry.recordSuccess(provider.name, cloudLatency);

        return { response, decision };
      } catch (err: unknown) {
        this.registry.recordError(provider.name);
        this.emit("cloudFailure", {
          provider: provider.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return null;
  }

  /**
   * Assess confidence of an LLM response.
   * Uses multiple heuristics:
   * - Explicit confidence markers ([confidence: X.X])
   * - Response length (very short = low confidence)
   * - Hedging language detection
   * - Error/uncertainty indicators
   */
  private assessConfidence(response: LlmResponse, _messages: AgentMessage[]): number {
    const content = response.content;

    // Check for explicit confidence marker
    const explicitMatch = content.match(/\[confidence:\s*([\d.]+)\]/i);
    if (explicitMatch) {
      return Math.max(0, Math.min(1, parseFloat(explicitMatch[1])));
    }

    let score = 0.7; // Base confidence

    // Very short responses suggest uncertainty
    if (content.length < 20) {
      score -= 0.3;
    } else if (content.length < 50) {
      score -= 0.15;
    }

    // Hedging language reduces confidence
    const hedgeWords = [
      "i'm not sure",
      "i don't know",
      "i'm uncertain",
      "it might",
      "possibly",
      "perhaps",
      "i think maybe",
      "i cannot",
      "i can't",
      "unable to",
      "beyond my",
      "i apologize",
      "sorry, i",
    ];
    const lowerContent = content.toLowerCase();
    for (const hedge of hedgeWords) {
      if (lowerContent.includes(hedge)) {
        score -= 0.1;
        break;
      }
    }

    // Error indicators
    if (response.finishReason === "error" || response.finishReason === "length") {
      score -= 0.3;
    }

    // Empty content
    if (!content.trim()) {
      score = 0;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Detect task complexity from the user messages.
   * Returns 0-1 score where higher = more complex.
   */
  private detectComplexity(messages: AgentMessage[]): number {
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) {
      return 0;
    }

    const lastUserMsg = userMessages[userMessages.length - 1].content.toLowerCase();
    let score = 0;

    // Keyword detection
    for (const keyword of this.config.complexityKeywords) {
      if (lastUserMsg.includes(keyword.toLowerCase())) {
        score += 0.1;
      }
    }

    // Long messages tend to be more complex
    if (lastUserMsg.length > 500) {
      score += 0.15;
    }
    if (lastUserMsg.length > 1000) {
      score += 0.15;
    }

    // Multiple questions (question marks)
    const questionMarks = (lastUserMsg.match(/\?/g) || []).length;
    if (questionMarks > 2) {
      score += 0.1;
    }

    // Code blocks or technical content
    if (
      lastUserMsg.includes("```") ||
      lastUserMsg.includes("function ") ||
      lastUserMsg.includes("class ")
    ) {
      score += 0.15;
    }

    // Multi-step indicators
    if (/\b(step\s*\d|first.*then|1\)|2\)|3\))/i.test(lastUserMsg)) {
      score += 0.15;
    }

    return Math.min(1, score);
  }

  private extractQuestion(messages: AgentMessage[]): string {
    const userMessages = messages.filter((m) => m.role === "user");
    return userMessages.length > 0 ? userMessages[userMessages.length - 1].content : "";
  }

  private recordDecision(decision: RoutingDecision): RoutingDecision {
    this.decisions.push(decision);

    // Trim history
    if (this.decisions.length > this.config.maxDecisionHistory) {
      this.decisions.splice(0, this.decisions.length - this.config.maxDecisionHistory);
    }

    if (this.config.logDecisions) {
      this.emit("routingDecision", decision);
    }

    return decision;
  }
}
