import { describe, it, expect, beforeEach, vi } from "vitest";
import { SmartRouter } from "./smart-router";
import { CostTracker } from "./cost-tracker";
import { LlmProviderRegistry } from "../providers/llm-providers";
import { DEFAULT_ROUTER_CONFIG } from "./types";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
});

// ─── CostTracker Tests ──────────────────────────────────────

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker(10.0);
  });

  it("should return 0 cost for local providers", () => {
    expect(tracker.estimateCost("local", "dolphin-mistral:7b", 1000, 500)).toBe(0);
  });

  it("should estimate cost for known cloud models", () => {
    // GPT-4o: input $2.50/1M, output $10.00/1M
    const cost = tracker.estimateCost("cloud", "gpt-4o", 1000, 500);
    const expected = (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it("should use default pricing for unknown models", () => {
    // Default: input $1.00/1M, output $3.00/1M
    const cost = tracker.estimateCost("cloud", "unknown-model", 1000, 500);
    const expected = (1000 / 1_000_000) * 1.0 + (500 / 1_000_000) * 3.0;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it("should record entries and track spend", () => {
    tracker.record({
      timestamp: Date.now(),
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0075,
      routingDecisionId: "r-1",
    });

    expect(tracker.getTodaySpend()).toBeCloseTo(0.0075, 4);
    expect(tracker.getEntries()).toHaveLength(1);
  });

  it("should check budget limits correctly", () => {
    // Budget is 10.00, add spend of 9.95
    tracker.record({
      timestamp: Date.now(),
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 9.95,
      routingDecisionId: "r-1",
    });

    expect(tracker.wouldExceedBudget(0.04)).toBe(false);
    expect(tracker.wouldExceedBudget(0.06)).toBe(true);
  });

  it("should return comprehensive summary", () => {
    tracker.record({
      timestamp: Date.now(),
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.01,
      routingDecisionId: "r-1",
    });

    tracker.record({
      timestamp: Date.now(),
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 2000,
      outputTokens: 1000,
      costUsd: 0.02,
      routingDecisionId: "r-2",
    });

    const summary = tracker.getSummary();
    expect(summary.requestCount).toBe(2);
    expect(summary.todayRequestCount).toBe(2);
    expect(summary.totalCostUsd).toBeCloseTo(0.03, 4);
    expect(summary.byProvider.openai.requestCount).toBe(1);
    expect(summary.byProvider.anthropic.requestCount).toBe(1);
    expect(summary.dailyBudgetRemaining).toBeCloseTo(9.97, 2);
    expect(summary.dailyBudgetUsedPercent).toBeCloseTo(0.3, 1);
  });

  it("should trim old entries when exceeding max", () => {
    const small = new CostTracker(10.0, 5);
    for (let i = 0; i < 8; i++) {
      small.record({
        timestamp: Date.now(),
        provider: "test",
        model: "test",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
        routingDecisionId: `r-${i}`,
      });
    }
    expect(small.getEntries()).toHaveLength(5);
  });

  it("should return recent entries", () => {
    for (let i = 0; i < 10; i++) {
      tracker.record({
        timestamp: Date.now() + i,
        provider: "test",
        model: "test",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
        routingDecisionId: `r-${i}`,
      });
    }
    expect(tracker.getRecent(3)).toHaveLength(3);
  });
});

// ─── SmartRouter Tests ──────────────────────────────────────

describe("SmartRouter", () => {
  let registry: LlmProviderRegistry;
  let router: SmartRouter;

  beforeEach(() => {
    mockFetch.mockReset();
    registry = new LlmProviderRegistry();
    registry.addProvider({
      type: "ollama",
      name: "ollama-local",
      baseUrl: "http://127.0.0.1:11434",
      model: "dolphin-mistral:7b",
      priority: 0,
      enabled: true,
    });
    router = new SmartRouter(registry, {
      confidenceThreshold: 0.6,
      maxDailySpend: 10.0,
    });
  });

  it("should route to local provider when confidence is high", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Here is a comprehensive answer about TypeScript generics. [confidence: 0.9]" },
        eval_count: 100,
        prompt_eval_count: 50,
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "What are TypeScript generics?", timestamp: Date.now() }],
      [],
      { model: "dolphin-mistral:7b", temperature: 0.7 }
    );

    expect(result.response.content).toContain("TypeScript generics");
    expect(result.decision.phase).toBe("local");
    expect(result.decision.escalated).toBe(false);
    expect(result.decision.providerType).toBe("local");
    expect(result.decision.costUsd).toBe(0);
  });

  it("should stay local when confidence is below threshold but no council evaluator", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "I'm not sure about that. [confidence: 0.3]" },
        eval_count: 20,
        prompt_eval_count: 30,
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "Explain quantum computing", timestamp: Date.now() }],
      [],
      { model: "dolphin-mistral:7b", temperature: 0.7 }
    );

    expect(result.decision.phase).toBe("local");
    expect(result.decision.escalated).toBe(false);
    expect(result.decision.escalationReason).toBe("low_confidence");
  });

  it("should respect council denial when evaluator says no escalation", async () => {
    // Local response with low confidence
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Maybe this is the answer. [confidence: 0.4]" },
        eval_count: 30,
        prompt_eval_count: 20,
      }),
    });

    // Set council evaluator that denies escalation
    router.setEscalationEvaluator(async () => ({
      shouldEscalate: false,
      reason: "Local response is adequate for this question",
      confidence: 0.5,
      durationMs: 100,
    }));

    const result = await router.route(
      [{ role: "user", content: "What is 2+2?", timestamp: Date.now() }],
      [],
      { model: "dolphin-mistral:7b", temperature: 0.7 }
    );

    expect(result.decision.phase).toBe("council_eval");
    expect(result.decision.escalated).toBe(false);
    expect(result.decision.councilApproved).toBe(false);
    expect(result.decision.councilReasoning).toContain("adequate");
  });

  it("should escalate to cloud when council approves", async () => {
    // Add a cloud provider
    registry.addProvider({
      type: "openai",
      name: "openai",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      model: "gpt-4o",
      priority: 10,
      enabled: true,
    });

    // Local response with low confidence
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "I'm uncertain. [confidence: 0.2]" },
        eval_count: 10,
        prompt_eval_count: 20,
      }),
    });

    // Cloud response after escalation (uses registry.createProvider which calls fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Cloud answer from Ollama" },
        eval_count: 200,
        prompt_eval_count: 100,
      }),
    });

    // Set council evaluator that approves escalation
    router.setEscalationEvaluator(async () => ({
      shouldEscalate: true,
      reason: "Question requires advanced reasoning",
      confidence: 0.3,
      durationMs: 200,
    }));

    const result = await router.route(
      [{ role: "user", content: "Explain the implications of Godel's incompleteness theorems on AI", timestamp: Date.now() }],
      [],
      { model: "dolphin-mistral:7b", temperature: 0.7 }
    );

    expect(result.decision.escalated).toBe(true);
    expect(result.decision.councilApproved).toBe(true);
  });

  it("should handle local provider failure gracefully", async () => {
    // Add a cloud provider
    registry.addProvider({
      type: "openai",
      name: "openai-backup",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      model: "gpt-4o",
      priority: 10,
      enabled: true,
    });

    // callProvider uses registry.createProvider() which tries all providers in order.
    // Ollama fails, OpenAI succeeds (this is the "local" call that falls through
    // the registry fallback chain)
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Fallback response from cloud with good quality answer [confidence: 0.8]" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "Hello", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    // The registry's fallback chain handled the failure transparently
    expect(result.response.content).toContain("Fallback response");
  });

  it("should throw when all providers fail", async () => {
    // Only local provider, which fails
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    // The escalateToCloud path calls registry.createProvider() which also fails
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(
      router.route(
        [{ role: "user", content: "Hello", timestamp: Date.now() }],
        [],
        { model: "test", temperature: 0.7 }
      )
    ).rejects.toThrow();
  });

  it("should create a compatible provider function", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Hello [confidence: 0.8]" },
        eval_count: 20,
        prompt_eval_count: 10,
      }),
    });

    const providerFn = router.createProvider();
    const response = await providerFn(
      [{ role: "user", content: "Hi", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    expect(response.content).toContain("Hello");
  });

  it("should track routing statistics", async () => {
    // Two successful local calls
    for (let i = 0; i < 2; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: "Good answer [confidence: 0.8]" },
          eval_count: 50,
          prompt_eval_count: 30,
        }),
      });

      await router.route(
        [{ role: "user", content: `Question ${i}`, timestamp: Date.now() }],
        [],
        { model: "test", temperature: 0.7 }
      );
    }

    const stats = router.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.localRequests).toBe(2);
    expect(stats.escalatedRequests).toBe(0);
    expect(stats.avgLocalConfidence).toBeGreaterThan(0);
  });

  it("should record decisions in history", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Answer [confidence: 0.9]" },
        eval_count: 50,
        prompt_eval_count: 30,
      }),
    });

    await router.route(
      [{ role: "user", content: "Test", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    const decisions = router.getDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].phase).toBe("local");
  });

  it("should return and update config", () => {
    const config = router.getConfig();
    expect(config.confidenceThreshold).toBe(0.6);

    router.updateConfig({ confidenceThreshold: 0.8 });
    expect(router.getConfig().confidenceThreshold).toBe(0.8);
  });

  it("should emit routing decision events", async () => {
    const listener = vi.fn();
    router.on("routingDecision", listener);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Answer [confidence: 0.9]" },
        eval_count: 50,
        prompt_eval_count: 30,
      }),
    });

    await router.route(
      [{ role: "user", content: "Test", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].phase).toBe("local");
  });

  it("should emit escalation evaluated events when council decides", async () => {
    const listener = vi.fn();
    router.on("escalationEvaluated", listener);

    router.setEscalationEvaluator(async () => ({
      shouldEscalate: false,
      reason: "Local is fine",
      confidence: 0.5,
      durationMs: 50,
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Maybe [confidence: 0.3]" },
        eval_count: 10,
        prompt_eval_count: 20,
      }),
    });

    await router.route(
      [{ role: "user", content: "Complex question", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].verdict.shouldEscalate).toBe(false);
  });

  it("should handle council evaluator failure gracefully", async () => {
    router.setEscalationEvaluator(async () => {
      throw new Error("Council unavailable");
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Uncertain answer [confidence: 0.3]" },
        eval_count: 10,
        prompt_eval_count: 20,
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "Test", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    // Should fall back to local response (council_eval phase since evaluator was called)
    expect(result.decision.escalated).toBe(false);
  });

  // ─── Confidence Assessment Tests ─────────────────────────

  it("should detect explicit confidence markers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Answer [confidence: 0.95]" },
        eval_count: 50,
        prompt_eval_count: 30,
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "Test", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    expect(result.decision.confidenceScore).toBeCloseTo(0.95, 1);
  });

  it("should lower confidence for very short responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Yes" },
        eval_count: 1,
        prompt_eval_count: 10,
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "Test", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    // Short response should have lower confidence (base 0.7 - 0.3 = 0.4)
    expect(result.decision.confidenceScore).toBeLessThan(0.5);
  });

  it("should lower confidence for hedging language", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "I'm not sure but I think the answer might be related to quantum mechanics somehow" },
        eval_count: 30,
        prompt_eval_count: 10,
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "Test", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    expect(result.decision.confidenceScore).toBeLessThan(0.7);
  });

  it("should set confidence to 0 for empty responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "" },
        eval_count: 0,
        prompt_eval_count: 10,
      }),
    });

    const result = await router.route(
      [{ role: "user", content: "Test", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    expect(result.decision.confidenceScore).toBe(0);
  });
});

// ─── Default Config Tests ────────────────────────────────────

describe("DEFAULT_ROUTER_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_ROUTER_CONFIG.confidenceThreshold).toBe(0.6);
    expect(DEFAULT_ROUTER_CONFIG.autoEscalate).toBe(false);
    expect(DEFAULT_ROUTER_CONFIG.maxDailySpend).toBe(10.0);
    expect(DEFAULT_ROUTER_CONFIG.maxCostPerRequest).toBe(0.5);
    expect(DEFAULT_ROUTER_CONFIG.logDecisions).toBe(true);
    expect(DEFAULT_ROUTER_CONFIG.complexityKeywords.length).toBeGreaterThan(0);
  });
});
