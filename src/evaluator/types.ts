/**
 * Model Evaluator & Reinforcement Learning Types
 *
 * Evaluates LLM models by running benchmark prompts, scoring their
 * outputs on multiple quality dimensions, and tracking performance
 * over time. Uses an exploration/exploitation strategy (Thompson sampling)
 * to discover the best model for each task category.
 *
 * Models that consistently underperform are flagged for removal.
 * Top performers are promoted and retained.
 */

export interface EvalConfig {
  /** Directory to persist evaluation scores across sessions */
  persistPath: string;
  /** Minimum evaluations before a model can be promoted/demoted */
  minEvaluations: number;
  /** Score below which a model is flagged for removal (0.0-1.0) */
  demotionThreshold: number;
  /** Score above which a model is promoted to preferred (0.0-1.0) */
  promotionThreshold: number;
  /** How much to weight recent evaluations vs historical (0.0-1.0, higher = more recency) */
  recencyBias: number;
  /** Number of benchmark prompts per evaluation run */
  benchmarkSize: number;
}

export interface EvalPrompt {
  id: string;
  category: EvalCategory;
  prompt: string;
  /** Expected characteristics of a good answer */
  rubric: string;
  /** Optional: known-good reference answer for comparison */
  referenceAnswer?: string;
  difficulty: "easy" | "medium" | "hard";
}

export type EvalCategory =
  | "code_generation"
  | "code_review"
  | "reasoning"
  | "creative_writing"
  | "math"
  | "summarization"
  | "instruction_following"
  | "general_knowledge"
  | "conversation";

export interface EvalResult {
  modelId: string;
  modelName: string;
  promptId: string;
  category: EvalCategory;
  /** Individual dimension scores (0.0-1.0) */
  scores: {
    accuracy: number;
    coherence: number;
    completeness: number;
    relevance: number;
    speed: number;
  };
  /** Weighted overall score (0.0-1.0) */
  overallScore: number;
  /** Raw response from the model */
  response: string;
  /** Response latency in ms */
  latencyMs: number;
  timestamp: number;
}

export interface ModelScore {
  modelId: string;
  modelName: string;
  /** Running weighted average per category */
  categoryScores: Record<EvalCategory, {
    average: number;
    count: number;
    trend: "improving" | "stable" | "declining";
    recentScores: number[];
  }>;
  /** Overall weighted score across all categories */
  overallScore: number;
  totalEvaluations: number;
  /** Thompson sampling parameters (Beta distribution) */
  alpha: number;
  beta: number;
  /** Status based on performance */
  status: "new" | "evaluating" | "preferred" | "adequate" | "flagged" | "removed";
  firstEvaluatedAt: number;
  lastEvaluatedAt: number;
}

export interface ModelRanking {
  category: EvalCategory;
  rankings: Array<{
    modelId: string;
    modelName: string;
    score: number;
    evaluations: number;
    status: ModelScore["status"];
  }>;
}

export interface EvalHistory {
  /** All model scores keyed by modelId */
  scores: Record<string, ModelScore>;
  /** Recent evaluation results (last N) */
  recentResults: EvalResult[];
  /** Models that were removed due to poor performance */
  removedModels: Array<{
    modelId: string;
    modelName: string;
    reason: string;
    removedAt: number;
    finalScore: number;
  }>;
  lastUpdated: number;
}
