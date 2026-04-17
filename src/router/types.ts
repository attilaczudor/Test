/**
 * Smart Router Types — Council-Gated LLM Escalation
 *
 * The router implements a three-phase decision pipeline:
 *
 *   Phase 1: LOCAL FIRST
 *     Always try the local Ollama model first.
 *     Fast, free, private. Most conversations stay here.
 *
 *   Phase 2: CONFIDENCE EVALUATION
 *     Assess the local response quality. If confidence is
 *     below threshold, or the task is flagged as complex,
 *     escalate to the council for a decision.
 *
 *   Phase 3: COUNCIL-GATED ESCALATION
 *     The council director evaluates whether cloud LLMs
 *     are needed. Only proceeds to cloud with explicit
 *     council approval + reasoning.
 *
 * This ensures cloud spend is intentional, reasoned, and auditable.
 */

import { AgentMessage, LlmResponse } from "../agent/types";

// ─── Routing Decision ────────────────────────────────────────

export type RoutingPhase = "local" | "council_eval" | "cloud_escalation";

export type EscalationReason =
  | "low_confidence"       // Local model returned low-confidence answer
  | "task_complexity"      // Task detected as too complex for local
  | "local_failure"        // Local model failed/timed out
  | "explicit_request"     // User or agent explicitly requested cloud
  | "council_decision"     // Council decided cloud is needed
  | "domain_mismatch";     // Task outside local model's training domain

export interface RoutingDecision {
  id: string;
  timestamp: number;
  phase: RoutingPhase;
  provider: string;           // Which provider was used
  providerType: "local" | "cloud";
  escalated: boolean;         // Did it go to cloud?
  escalationReason?: EscalationReason;
  councilApproved?: boolean;
  councilReasoning?: string;
  confidenceScore: number;    // 0-1 confidence of the response
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;            // Estimated cost (0 for local)
}

// ─── Router Configuration ────────────────────────────────────

export interface SmartRouterConfig {
  /** Confidence threshold below which council evaluation is triggered (default: 0.6) */
  confidenceThreshold: number;

  /** Maximum tokens in a local response before considering escalation (default: 0) */
  maxLocalTokens: number;

  /** Whether to allow automatic escalation or always require council approval (default: false) */
  autoEscalate: boolean;

  /** Maximum cost per request in USD before blocking (default: 0.50) */
  maxCostPerRequest: number;

  /** Maximum daily cloud spend in USD (default: 10.00) */
  maxDailySpend: number;

  /** Keywords that trigger complexity detection */
  complexityKeywords: string[];

  /** Whether to log all routing decisions (default: true) */
  logDecisions: boolean;

  /** Number of recent decisions to keep in memory (default: 1000) */
  maxDecisionHistory: number;
}

export const DEFAULT_ROUTER_CONFIG: SmartRouterConfig = {
  confidenceThreshold: 0.6,
  maxLocalTokens: 0,
  autoEscalate: false,
  maxCostPerRequest: 0.50,
  maxDailySpend: 10.00,
  complexityKeywords: [
    "analyze", "compare", "evaluate", "synthesize", "design",
    "architecture", "security audit", "optimize", "refactor",
    "multi-step", "complex", "advanced", "production",
  ],
  logDecisions: true,
  maxDecisionHistory: 1000,
};

// ─── Cost Tracking ──────────────────────────────────────────

export interface CostEntry {
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  routingDecisionId: string;
}

export interface CostSummary {
  totalCostUsd: number;
  todayCostUsd: number;
  requestCount: number;
  todayRequestCount: number;
  byProvider: Record<string, {
    totalCostUsd: number;
    requestCount: number;
    avgLatencyMs: number;
    totalTokens: number;
  }>;
  dailyBudgetRemaining: number;
  dailyBudgetUsedPercent: number;
}

// ─── Escalation Evaluation ──────────────────────────────────

export interface EscalationRequest {
  taskId: string;
  originalQuestion: string;
  localResponse: string;
  localConfidence: number;
  localProvider: string;
  detectedComplexity: number;  // 0-1
  reason: EscalationReason;
}

export interface EscalationVerdict {
  shouldEscalate: boolean;
  reason: string;
  suggestedProvider?: string;
  suggestedModel?: string;
  confidence: number;
  durationMs: number;
}

// ─── Router Stats ───────────────────────────────────────────

export interface RouterStats {
  totalRequests: number;
  localRequests: number;
  escalatedRequests: number;
  councilEvaluations: number;
  councilApprovals: number;
  councilDenials: number;
  avgLocalConfidence: number;
  avgCloudConfidence: number;
  avgLocalLatencyMs: number;
  avgCloudLatencyMs: number;
  costSummary: CostSummary;
  recentDecisions: RoutingDecision[];
}
