/**
 * Cloud LLM Cost Tracker
 *
 * Tracks API spend per provider with daily budgets and per-request limits.
 * All local (Ollama) calls are $0. Cloud costs are estimated from token counts
 * using published pricing.
 */

import { CostEntry, CostSummary } from "./types";

// ─── Pricing (per 1M tokens, USD) ────────────────────────────

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.00 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4-turbo": { inputPer1M: 10.00, outputPer1M: 30.00 },
  // Anthropic
  "claude-opus-4-6": { inputPer1M: 15.00, outputPer1M: 75.00 },
  "claude-sonnet-4-5-20250929": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-haiku-4-5-20251001": { inputPer1M: 0.80, outputPer1M: 4.00 },
  // Google
  "gemini-2.0-flash": { inputPer1M: 0.075, outputPer1M: 0.30 },
  "gemini-2.0-pro": { inputPer1M: 1.25, outputPer1M: 10.00 },
  // Together / Groq (common open models via API)
  "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo": { inputPer1M: 0.88, outputPer1M: 0.88 },
  "mixtral-8x7b-32768": { inputPer1M: 0.24, outputPer1M: 0.24 },
};

// Default fallback for unknown models
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 1.00, outputPer1M: 3.00 };

export class CostTracker {
  private readonly entries: CostEntry[] = [];
  private readonly maxEntries: number;
  private readonly maxDailySpend: number;

  constructor(maxDailySpend: number = 10.00, maxEntries: number = 10000) {
    this.maxDailySpend = maxDailySpend;
    this.maxEntries = maxEntries;
  }

  /**
   * Estimate cost for a given model and token count.
   * Returns 0 for local/Ollama models.
   */
  estimateCost(
    providerType: "local" | "cloud",
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    if (providerType === "local") return 0;

    const pricing = PRICING[model] || DEFAULT_PRICING;
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal precision
  }

  /**
   * Record a completed request's cost.
   */
  record(entry: CostEntry): void {
    this.entries.push(entry);

    // Trim old entries
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  /**
   * Check if a request would exceed the daily budget.
   */
  wouldExceedBudget(estimatedCost: number): boolean {
    return this.getTodaySpend() + estimatedCost > this.maxDailySpend;
  }

  /**
   * Get today's total spend.
   */
  getTodaySpend(): number {
    const todayStart = this.getTodayStart();
    return this.entries
      .filter((e) => e.timestamp >= todayStart)
      .reduce((sum, e) => sum + e.costUsd, 0);
  }

  /**
   * Get comprehensive cost summary.
   */
  getSummary(): CostSummary {
    const todayStart = this.getTodayStart();
    const todayEntries = this.entries.filter((e) => e.timestamp >= todayStart);

    const byProvider: CostSummary["byProvider"] = {};

    for (const entry of this.entries) {
      if (!byProvider[entry.provider]) {
        byProvider[entry.provider] = {
          totalCostUsd: 0,
          requestCount: 0,
          avgLatencyMs: 0,
          totalTokens: 0,
        };
      }
      const p = byProvider[entry.provider];
      p.totalCostUsd += entry.costUsd;
      p.requestCount++;
      p.totalTokens += entry.inputTokens + entry.outputTokens;
    }

    const totalCost = this.entries.reduce((s, e) => s + e.costUsd, 0);
    const todayCost = todayEntries.reduce((s, e) => s + e.costUsd, 0);

    return {
      totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      todayCostUsd: Math.round(todayCost * 1_000_000) / 1_000_000,
      requestCount: this.entries.length,
      todayRequestCount: todayEntries.length,
      byProvider,
      dailyBudgetRemaining: Math.max(0, this.maxDailySpend - todayCost),
      dailyBudgetUsedPercent: this.maxDailySpend > 0
        ? Math.min(100, (todayCost / this.maxDailySpend) * 100)
        : 0,
    };
  }

  /**
   * Get all entries (for export/display).
   */
  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * Get recent entries.
   */
  getRecent(count: number = 50): CostEntry[] {
    return this.entries.slice(-count);
  }

  private getTodayStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
}
