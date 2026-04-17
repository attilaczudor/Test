import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import {
  EvalConfig,
  EvalPrompt,
  EvalResult,
  EvalCategory,
  ModelScore,
  ModelRanking,
  EvalHistory,
} from "./types";

/**
 * Model Evaluator — Test, Score, and Select LLMs
 *
 * Reinforcement learning approach:
 *   - Exploration: New/under-tested models get sampled more often
 *   - Exploitation: Proven high-scorers are preferred for production
 *   - Thompson Sampling: Beta distribution for explore/exploit balance
 *
 * Models are evaluated on benchmark prompts across multiple categories.
 * Scores persist across sessions. Underperformers are flagged for removal.
 */
export class ModelEvaluator extends EventEmitter {
  private readonly config: EvalConfig;
  private history: EvalHistory;
  private readonly benchmarks: EvalPrompt[] = [];

  constructor(config: EvalConfig) {
    super();
    this.config = config;
    this.history = this.loadHistory();
    this.initBenchmarks();
  }

  // ─── Evaluation ────────────────────────────────────────────

  /**
   * Evaluate a model by sending benchmark prompts and scoring responses.
   * The evaluator calls the model's endpoint via Ollama-compatible API.
   */
  async evaluateModel(
    modelId: string,
    modelName: string,
    endpoint: string,
    categories?: EvalCategory[],
  ): Promise<EvalResult[]> {
    const results: EvalResult[] = [];

    // Select benchmarks for requested categories
    let prompts = [...this.benchmarks];
    if (categories) {
      prompts = prompts.filter((p) => categories.includes(p.category));
    }
    prompts = prompts.slice(0, this.config.benchmarkSize);

    this.emit("evaluationStart", { modelId, modelName, promptCount: prompts.length });

    for (const prompt of prompts) {
      const result = await this.runSingleEval(modelId, modelName, endpoint, prompt);
      results.push(result);
      this.recordResult(result);
    }

    // Update model status based on accumulated scores
    this.updateModelStatus(modelId);
    this.saveHistory();

    this.emit("evaluationComplete", {
      modelId,
      modelName,
      results: results.length,
      overallScore: this.getModelScore(modelId)?.overallScore ?? 0,
    });

    return results;
  }

  /**
   * Quick evaluation — single prompt, returns score immediately.
   * Useful for inline evaluation during council deliberation.
   */
  async quickEval(
    modelId: string,
    modelName: string,
    endpoint: string,
    prompt: string,
    category: EvalCategory = "general_knowledge",
  ): Promise<EvalResult> {
    const evalPrompt: EvalPrompt = {
      id: `quick-${crypto.randomUUID().slice(0, 8)}`,
      category,
      prompt,
      rubric: "Evaluate for accuracy, coherence, completeness, and relevance.",
      difficulty: "medium",
    };

    const result = await this.runSingleEval(modelId, modelName, endpoint, evalPrompt);
    this.recordResult(result);
    this.updateModelStatus(modelId);
    this.saveHistory();

    return result;
  }

  private async runSingleEval(
    modelId: string,
    modelName: string,
    endpoint: string,
    prompt: EvalPrompt,
  ): Promise<EvalResult> {
    const startTime = Date.now();

    let response = "";
    try {
      const url = `${endpoint}/api/chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: "Answer concisely and accurately." },
            { role: "user", content: prompt.prompt },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      response = data.message?.content || "";
    } catch (err: unknown) {
      response = `[Error: ${err instanceof Error ? err.message : String(err)}]`;
    }

    const latencyMs = Date.now() - startTime;

    // Score the response
    const scores = this.scoreResponse(response, prompt, latencyMs);

    return {
      modelId,
      modelName,
      promptId: prompt.id,
      category: prompt.category,
      scores,
      overallScore: this.calculateOverallScore(scores),
      response: response.slice(0, 1000),
      latencyMs,
      timestamp: Date.now(),
    };
  }

  /**
   * Score a response based on heuristics (no external judge model needed).
   * For more sophisticated evaluation, a judge model can be used later.
   */
  private scoreResponse(
    response: string,
    prompt: EvalPrompt,
    latencyMs: number,
  ): EvalResult["scores"] {
    const isError = response.startsWith("[Error:");
    if (isError) {
      return { accuracy: 0, coherence: 0, completeness: 0, relevance: 0, speed: 0 };
    }

    // Coherence: based on response structure
    const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const coherence = Math.min(
      1,
      sentences.length > 0 ? 0.5 + Math.min(sentences.length, 10) / 20 : 0,
    );

    // Completeness: response length relative to prompt complexity
    const expectedLength =
      prompt.difficulty === "hard" ? 500 : prompt.difficulty === "medium" ? 200 : 100;
    const completeness = Math.min(1, response.length / expectedLength);

    // Relevance: keyword overlap with prompt
    const promptWords = new Set(
      prompt.prompt
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
    const responseWords = new Set(
      response
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
    const overlap = [...promptWords].filter((w) => responseWords.has(w)).length;
    const relevance =
      promptWords.size > 0 ? Math.min(1, overlap / Math.min(promptWords.size, 5)) : 0.5;

    // Accuracy: if reference answer is provided, compare; otherwise heuristic
    let accuracy = 0.5;
    if (prompt.referenceAnswer) {
      const refWords = new Set(
        prompt.referenceAnswer
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3),
      );
      const refOverlap = [...refWords].filter((w) => responseWords.has(w)).length;
      accuracy = refWords.size > 0 ? Math.min(1, refOverlap / refWords.size) : 0.5;
    }

    // Speed: faster is better (normalize: <2s = 1.0, >30s = 0.0)
    const speed = Math.max(0, Math.min(1, 1 - (latencyMs - 2000) / 28000));

    return { accuracy, coherence, completeness, relevance, speed };
  }

  private calculateOverallScore(scores: EvalResult["scores"]): number {
    // Weighted average: accuracy and relevance matter most
    return (
      scores.accuracy * 0.3 +
      scores.coherence * 0.15 +
      scores.completeness * 0.2 +
      scores.relevance * 0.25 +
      scores.speed * 0.1
    );
  }

  // ─── Score Tracking ────────────────────────────────────────

  private recordResult(result: EvalResult): void {
    const { modelId, modelName, category, overallScore } = result;

    // Initialize model score if new
    if (!this.history.scores[modelId]) {
      this.history.scores[modelId] = {
        modelId,
        modelName,
        categoryScores: {} as ModelScore["categoryScores"],
        overallScore: 0,
        totalEvaluations: 0,
        alpha: 1, // Beta distribution prior
        beta: 1,
        status: "new",
        firstEvaluatedAt: Date.now(),
        lastEvaluatedAt: Date.now(),
      };
    }

    const score = this.history.scores[modelId];
    score.lastEvaluatedAt = Date.now();
    score.totalEvaluations++;

    // Update category score
    if (!score.categoryScores[category]) {
      score.categoryScores[category] = {
        average: 0,
        count: 0,
        trend: "stable",
        recentScores: [],
      };
    }

    const catScore = score.categoryScores[category];
    catScore.count++;
    catScore.recentScores.push(overallScore);
    if (catScore.recentScores.length > 20) {
      catScore.recentScores.shift();
    }

    // Exponential moving average with recency bias
    const alpha = this.config.recencyBias;
    catScore.average = alpha * overallScore + (1 - alpha) * catScore.average;

    // Detect trend
    if (catScore.recentScores.length >= 5) {
      const recent = catScore.recentScores.slice(-5);
      const older = catScore.recentScores.slice(-10, -5);
      if (older.length > 0) {
        const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
        const olderAvg = older.reduce((s, v) => s + v, 0) / older.length;
        if (recentAvg > olderAvg + 0.05) {
          catScore.trend = "improving";
        } else if (recentAvg < olderAvg - 0.05) {
          catScore.trend = "declining";
        } else {
          catScore.trend = "stable";
        }
      }
    }

    // Update Thompson sampling parameters (Beta distribution)
    if (overallScore >= 0.5) {
      score.alpha += overallScore;
    } else {
      score.beta += 1 - overallScore;
    }

    // Recalculate overall score across all categories
    const categories = Object.values(score.categoryScores);
    if (categories.length > 0) {
      score.overallScore = categories.reduce((s, c) => s + c.average, 0) / categories.length;
    }

    // Keep recent results (capped)
    this.history.recentResults.push(result);
    if (this.history.recentResults.length > 500) {
      this.history.recentResults = this.history.recentResults.slice(-200);
    }

    this.history.lastUpdated = Date.now();
  }

  private updateModelStatus(modelId: string): void {
    const score = this.history.scores[modelId];
    if (!score) {
      return;
    }

    if (score.totalEvaluations < this.config.minEvaluations) {
      score.status = "evaluating";
      return;
    }

    if (score.overallScore >= this.config.promotionThreshold) {
      score.status = "preferred";
    } else if (score.overallScore <= this.config.demotionThreshold) {
      score.status = "flagged";
    } else {
      score.status = "adequate";
    }
  }

  // ─── Model Selection (RL) ─────────────────────────────────

  /**
   * Select the best model for a given category using Thompson sampling.
   * Balances exploration (under-tested models) with exploitation (known good models).
   */
  selectModel(
    availableModels: Array<{ id: string; name: string }>,
    category?: EvalCategory,
  ): { id: string; name: string; expectedScore: number } | null {
    if (availableModels.length === 0) {
      return null;
    }

    const candidates = availableModels.map((model) => {
      const score = this.history.scores[model.id];

      if (!score || score.totalEvaluations < 2) {
        // Unexplored model: high uncertainty = explore it
        return { ...model, sample: 0.5 + Math.random() * 0.3 };
      }

      // Thompson sampling: draw from Beta(alpha, beta) distribution
      const sample = this.sampleBeta(score.alpha, score.beta);

      // Boost if category-specific score is high
      if (category && score.categoryScores[category]) {
        const catAvg = score.categoryScores[category].average;
        return { ...model, sample: sample * 0.6 + catAvg * 0.4 };
      }

      return { ...model, sample };
    });

    candidates.sort((a, b) => b.sample - a.sample);
    return {
      id: candidates[0].id,
      name: candidates[0].name,
      expectedScore: candidates[0].sample,
    };
  }

  /**
   * Get models flagged for removal (consistently underperforming).
   */
  getFlaggedModels(): Array<{ modelId: string; modelName: string; score: number }> {
    return Object.values(this.history.scores)
      .filter((s) => s.status === "flagged")
      .map((s) => ({ modelId: s.modelId, modelName: s.modelName, score: s.overallScore }));
  }

  /**
   * Mark a model as removed and record the removal reason.
   */
  removeModel(modelId: string, reason: string = "Underperforming"): boolean {
    const score = this.history.scores[modelId];
    if (!score) {
      return false;
    }

    this.history.removedModels.push({
      modelId,
      modelName: score.modelName,
      reason,
      removedAt: Date.now(),
      finalScore: score.overallScore,
    });

    score.status = "removed";
    this.saveHistory();
    this.emit("modelRemoved", { modelId, modelName: score.modelName, reason });
    return true;
  }

  /**
   * Get rankings for a specific category.
   */
  getRankings(category: EvalCategory): ModelRanking {
    const rankings = Object.values(this.history.scores)
      .filter((s) => s.status !== "removed" && s.categoryScores[category])
      .map((s) => ({
        modelId: s.modelId,
        modelName: s.modelName,
        score: s.categoryScores[category].average,
        evaluations: s.categoryScores[category].count,
        status: s.status,
      }))
      .toSorted((a, b) => b.score - a.score);

    return { category, rankings };
  }

  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  getModelScore(modelId: string): ModelScore | undefined {
    return this.history.scores[modelId];
  }

  getAllScores(): Record<string, ModelScore> {
    return { ...this.history.scores };
  }

  getHistory(): EvalHistory {
    return this.history;
  }

  // ─── Persistence ───────────────────────────────────────────

  private loadHistory(): EvalHistory {
    const filePath = path.join(this.config.persistPath, "eval-history.json");
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(data) as EvalHistory;
      }
    } catch {
      // Start fresh on parse errors
    }
    return { scores: {}, recentResults: [], removedModels: [], lastUpdated: Date.now() };
  }

  saveHistory(): void {
    try {
      const dir = this.config.persistPath;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, "eval-history.json");
      fs.writeFileSync(filePath, JSON.stringify(this.history, null, 2), "utf-8");
    } catch {
      // Silently fail on write errors
    }
  }

  // ─── Thompson Sampling ─────────────────────────────────────

  /**
   * Sample from Beta distribution using the Jöhnk algorithm.
   */
  private sampleBeta(alpha: number, beta: number): number {
    // Simple approximation using the mean + noise
    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const stddev = Math.sqrt(variance);

    // Box-Muller transform for Gaussian noise
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    return Math.max(0, Math.min(1, mean + z * stddev));
  }

  // ─── Built-in Benchmarks ──────────────────────────────────

  private initBenchmarks(): void {
    this.benchmarks.push(
      // Code generation
      {
        id: "bench-code-1",
        category: "code_generation",
        prompt:
          "Write a TypeScript function that finds the longest common subsequence of two strings. Include type annotations.",
        rubric: "Correct algorithm, proper TypeScript types, handles edge cases",
        difficulty: "medium",
      },
      {
        id: "bench-code-2",
        category: "code_generation",
        prompt: "Implement a simple LRU cache class in TypeScript with get() and put() methods.",
        rubric: "O(1) operations, proper eviction, handles capacity",
        difficulty: "medium",
      },
      // Code review
      {
        id: "bench-review-1",
        category: "code_review",
        prompt: "Review this code for bugs: function divide(a, b) { return a / b; }",
        rubric: "Identifies division by zero, suggests type checking, mentions NaN/Infinity",
        referenceAnswer:
          "Division by zero is not handled. Should check if b === 0. Also missing type annotations.",
        difficulty: "easy",
      },
      // Reasoning
      {
        id: "bench-reason-1",
        category: "reasoning",
        prompt:
          "If all roses are flowers, and some flowers fade quickly, can we conclude that some roses fade quickly?",
        rubric: "Correctly identifies the logical fallacy (undistributed middle)",
        referenceAnswer:
          "No. The premise only states some flowers fade quickly, not that this subset includes roses.",
        difficulty: "medium",
      },
      // Creative writing
      {
        id: "bench-creative-1",
        category: "creative_writing",
        prompt: "Write a 3-sentence story about a robot discovering music for the first time.",
        rubric: "Creative, evocative, coherent narrative in exactly 3 sentences",
        difficulty: "easy",
      },
      // Math
      {
        id: "bench-math-1",
        category: "math",
        prompt: "What is the derivative of f(x) = x^3 * sin(x)?",
        rubric: "Correct application of product rule: 3x^2*sin(x) + x^3*cos(x)",
        referenceAnswer: "f'(x) = 3x²sin(x) + x³cos(x)",
        difficulty: "medium",
      },
      // Summarization
      {
        id: "bench-summary-1",
        category: "summarization",
        prompt:
          "Summarize in one sentence: Machine learning is a subset of artificial intelligence that focuses on developing algorithms that can learn from and make predictions based on data. Unlike traditional programming where rules are explicitly coded, ML algorithms improve through experience.",
        rubric: "Captures both key points: ML learns from data, improves through experience",
        difficulty: "easy",
      },
      // Instruction following
      {
        id: "bench-instruct-1",
        category: "instruction_following",
        prompt:
          "List exactly 5 programming languages that start with the letter P. Format each as a numbered list.",
        rubric: "Exactly 5 items, all start with P, properly numbered",
        difficulty: "easy",
      },
      // General knowledge
      {
        id: "bench-knowledge-1",
        category: "general_knowledge",
        prompt: "What is the difference between TCP and UDP protocols?",
        rubric: "Mentions connection-oriented vs connectionless, reliability, ordering, use cases",
        difficulty: "medium",
      },
      // Conversation
      {
        id: "bench-convo-1",
        category: "conversation",
        prompt: "I'm feeling overwhelmed with my project deadlines. What would you suggest?",
        rubric: "Empathetic, practical advice, appropriate tone",
        difficulty: "easy",
      },
    );
  }
}
