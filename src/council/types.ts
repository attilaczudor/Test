/**
 * @module council/types
 *
 * LLM Council Types — Flexible 3-Tier Hierarchical Architecture
 *
 * This module defines every TypeScript type, interface, and factory function
 * used by the council subsystem. It serves as the single source of truth for
 * the data structures exchanged between the {@link Council} deliberation
 * engine, the {@link CouncilMemoryManager}, the provisioning layer, and the
 * preset configurations.
 *
 * The council represents a "thinking person" — an individual with
 * expertise that can change dynamically based on model evaluation.
 *
 * Tier 1 (Director): One LLM (3–70B), smart and fast. Has its own
 *         vector DB, LoRA, graph, and RAG for persistent memory and
 *         personality — memory survives model swaps.
 *
 * Tier 2 (Branches): 2–5 coordinators (2–20B). Any expertise type —
 *         not limited to "logical" and "creative". Each branch is
 *         defined by a personality/job description.
 *
 * Tier 3 (Specialists): Up to 10 per Tier 2 parent (0.5–7B). Small,
 *         focused models — each an expert in its field.
 *
 * All tiers use LoRA, vector DB, graph, and RAG for long-term memory
 * that persists regardless of which model is loaded.
 *
 * Deliberation flow:
 *   Prompt → Tier 1 decomposes → Tier 2 branches dispatch → Tier 3 answers
 *   → Tier 2 consolidates → Tier 1 synthesizes final answer
 */

// ─── Tier definitions ─────────────────────────────────────────

/**
 * Numeric tier identifier for the three-level council hierarchy.
 * - `1` = Director (single top-level orchestrator)
 * - `2` = Branch coordinator
 * - `3` = Specialist worker
 */
export type Tier = 1 | 2 | 3;

/**
 * Flexible branch type identifier.
 *
 * Unlike earlier versions that hard-coded "logical" and "creative", any
 * arbitrary string can serve as a branch name (e.g. "security", "devops").
 */
export type BranchType = string;

/**
 * Model size and member-count constraints enforced per tier.
 *
 * These guard-rails prevent over- or under-provisioning resources.
 * For example, Tier 3 specialists should not run a 70B model, and
 * there must be exactly one Director at Tier 1.
 */
export interface TierConstraints {
  /** Which tier this constraint set applies to. */
  tier: Tier;
  /** Minimum model size in billions of parameters. */
  minModelSizeB: number;
  /** Maximum model size in billions of parameters. */
  maxModelSizeB: number;
  /** Minimum number of members allowed at this tier. */
  minMembers: number;
  /** Maximum number of members allowed at this tier. */
  maxMembers: number;
}

/**
 * Default constraints for each tier, keyed by tier number.
 *
 * | Tier | Models        | Members |
 * |------|---------------|---------|
 * | 1    | 3 B – 70 B    | 1       |
 * | 2    | 2 B – 20 B    | 2 – 5   |
 * | 3    | 0.5 B – 7 B   | 1 – 10  |
 */
export const TIER_CONSTRAINTS: Record<number, TierConstraints> = {
  1: { tier: 1, minModelSizeB: 3, maxModelSizeB: 70, minMembers: 1, maxMembers: 1 },
  2: { tier: 2, minModelSizeB: 2, maxModelSizeB: 20, minMembers: 2, maxMembers: 5 },
  3: { tier: 3, minModelSizeB: 0.5, maxModelSizeB: 7, minMembers: 1, maxMembers: 10 },
};

// ─── Personality & Expertise ──────────────────────────────────

/**
 * Each council member has a personality that defines their expertise
 * and behavior. This is independent of the model — swap the model,
 * keep the personality and all accumulated memory.
 */
export interface MemberPersonality {
  title: string; // e.g. "Senior Backend Engineer", "Security Analyst"
  expertise: string[]; // e.g. ["Python", "distributed systems", "API design"]
  description: string; // Free-form job description / persona
  traits: PersonalityTraits;
}

/**
 * Quantitative personality trait knobs that steer a member's
 * communication style, output length, inventiveness, and rigour.
 */
export interface PersonalityTraits {
  /** Descriptive communication style (e.g. "analytical", "creative", "pragmatic"). */
  style: string;
  /** How verbose the member's output should be (0 = terse, 1 = very detailed). */
  verbosity: number; // 0-1
  /** Tendency towards novel / non-obvious solutions (0 = conservative, 1 = highly creative). */
  creativity: number; // 0-1
  /** Emphasis on correctness, thoroughness, and formal reasoning (0 = relaxed, 1 = strict). */
  rigor: number; // 0-1
}

// ─── Per-Member Memory ────────────────────────────────────────

/**
 * Memory references for a council member — survives model swaps.
 * Each member has its own namespaced vector collection, graph tag,
 * RAG namespace, and LoRA adapter tracking.
 */
export interface MemberMemory {
  vectorCollection: string; // Qdrant collection or in-memory namespace
  graphTag: string; // Tag for graph memory nodes belonging to this member
  loraAdapterId?: string; // Active LoRA adapter for this member
  ragNamespace: string; // RAG chunk namespace
  conversationCount: number;
  totalInteractions: number;
  lastActiveAt: number;
}

// ─── Per-Member Metrics ───────────────────────────────────────

/**
 * Performance metrics per council member — used for automatic
 * model swapping decisions and evaluation.
 *
 * These metrics are updated incrementally after every query via
 * {@link CouncilMemoryManager.recordQuery} and are consulted when
 * the system considers whether a model swap is warranted.
 */
export interface MemberMetrics {
  /** Total number of queries processed by this member. */
  totalQueries: number;
  /** Exponentially-weighted moving average of response time in milliseconds. */
  avgResponseTimeMs: number;
  /** Exponentially-weighted moving average of confidence scores (0-1). */
  avgConfidence: number;
  /** Absolute count of errors encountered. */
  errorCount: number;
  /** Ratio of errors to total queries (0-1). */
  errorRate: number;
  /** Most recent evaluation confidence score. */
  lastEvaluationScore: number;
  /** Ring buffer of the last N confidence scores for trend analysis. */
  evaluationHistory: number[];
}

/**
 * Factory that creates a zeroed-out {@link MemberMetrics} object.
 *
 * Called whenever a new council member is registered or when metrics
 * are reset after a model swap.
 *
 * @returns A fresh MemberMetrics instance with all counters at zero.
 */
export function createDefaultMetrics(): MemberMetrics {
  return {
    totalQueries: 0,
    avgResponseTimeMs: 0,
    avgConfidence: 0,
    errorCount: 0,
    errorRate: 0,
    lastEvaluationScore: 0,
    evaluationHistory: [],
  };
}

/**
 * Factory that creates a default {@link MemberMemory} for a newly
 * registered council member.
 *
 * Namespaces are derived from the member's ID so that each member
 * has its own isolated vector collection, graph tag, and RAG namespace.
 *
 * @param memberId - Unique identifier for the council member.
 * @returns A MemberMemory instance with namespaces derived from the ID.
 */
export function createDefaultMemory(memberId: string): MemberMemory {
  return {
    vectorCollection: `council-${memberId}`,
    graphTag: `council:${memberId}`,
    loraAdapterId: undefined,
    ragNamespace: `council-${memberId}`,
    conversationCount: 0,
    totalInteractions: 0,
    lastActiveAt: Date.now(),
  };
}

// ─── Member ───────────────────────────────────────────────────

/**
 * Full runtime representation of a single council member.
 *
 * This is the mutable, in-process record created during provisioning.
 * It tracks everything about a member: which model is loaded, its
 * current status, performance metrics, memory references, and its
 * place in the tier hierarchy.
 */
export interface CouncilMember {
  /** Unique runtime identifier (generated during provisioning). */
  id: string;
  /** Human-readable name (e.g. "coder", "logical-lead"). */
  name: string;
  /** Primary role identifier (e.g. "director", "coder"). */
  role: CouncilRole;
  /** Personality and expertise profile governing this member's behaviour. */
  personality: MemberPersonality;
  /** Hierarchical tier: 1 = director, 2 = coordinator, 3 = specialist. */
  tier: Tier;
  /** Branch name this member belongs to (Tier 2 and 3 only). */
  branch?: BranchType;
  /** Parent member ID. Tier 2 -> director, Tier 3 -> branch coordinator. */
  parentId?: string;
  /** Current Ollama model tag or HuggingFace model ID. */
  model: string;
  /** History of all models previously assigned to this seat (preserved across swaps). */
  previousModels: string[];
  /** Parsed parameter count and quantization of the current model. */
  modelParams?: ModelParams;
  /** Inference backend powering this member's endpoint. */
  backend: "ollama" | "llamacpp" | "vllm";
  /** HTTP endpoint for the member's inference server (set after provisioning). */
  endpoint: string;
  /** Proxmox container / VM ID (set after provisioning). */
  containerId?: string;
  /** Whether this member runs inside a full VM or a lightweight LXC container. */
  containerType: "vm" | "lxc";
  /** Current lifecycle status of this member. */
  status: "provisioning" | "ready" | "busy" | "offline" | "error";
  /** Voting weight in consensus calculations (higher = more influence). */
  weight: number;
  /** IDs of child members (director -> coordinators, coordinator -> specialists). */
  children: string[];
  /** Persistent memory references (vector DB, graph, RAG, LoRA). */
  memory: MemberMemory;
  /** Live performance metrics used for swap recommendations. */
  metrics: MemberMetrics;
}

/**
 * Well-known council role identifiers.
 *
 * The union includes common built-in roles for IDE autocompletion,
 * but the trailing `(string & {})` allows any custom role string to
 * be used without a type error — handy when defining bespoke council
 * configurations.
 */
export type CouncilRole =
  | "director"
  | "logical"
  | "creative"
  | "coder"
  | "reviewer"
  | "mathematician"
  | "researcher"
  | "writer"
  | "brainstormer"
  | "critic"
  | "generalist"
  | (string & {}); // Any custom role (preserves autocomplete)

// ─── Model sizing ─────────────────────────────────────────────

/**
 * Parsed model metadata extracted from a model name string.
 *
 * Used by the sizing functions to determine how much RAM, CPU, and disk
 * a model requires.
 */
export interface ModelParams {
  /** Parameter count in billions (e.g. 7 for a 7B model). */
  parameterCount: number;
  /** Quantization format string (e.g. "Q4_K_M", "Q5_K_S", "FP16"). */
  quantization: string;
}

/**
 * Computed resource requirements for running a specific model configuration.
 *
 * Values are derived from {@link ModelParams} by the sizing algorithm.
 */
export interface ModelSizing {
  /** Estimated RAM usage in megabytes. */
  memoryMb: number;
  /** Minimum CPU cores recommended for acceptable inference speed. */
  cores: number;
  /** Disk space required for the model weights in gigabytes. */
  diskGb: number;
}

// ─── Council configuration ────────────────────────────────────

/**
 * Top-level configuration for a hierarchical council.
 *
 * Defines the director, branches, consensus rules, and optional
 * cloud-escalation and memory settings.
 */
export interface CouncilConfig {
  /** Human-readable council name (used in logs and UI). */
  name: string;
  /** The director member who synthesises branch results. */
  director: CouncilMemberSpec;
  /** Named branches, each with a coordinator and specialists. */
  branches: Record<string, BranchConfig>;
  /** Maximum deliberation rounds before forcing a result. */
  maxRounds: number;
  /** Confidence threshold (0–1) at which consensus is reached. */
  consensusThreshold: number;
  /** Hard timeout for the entire deliberation in milliseconds. */
  timeoutMs: number;
  /** When true, the user must approve before cloud models are invoked. */
  requireCloudApproval?: boolean;
  /** Per-member persistent memory configuration. */
  memoryConfig?: CouncilMemoryConfig;
}

/** Configuration for the per-member memory system */
export interface CouncilMemoryConfig {
  vectorBackend: "memory" | "qdrant";
  graphBackend: "memory" | "neo4j";
  persistPath: string;
  sharedEmbeddingEndpoint: string;
  sharedEmbeddingModel: string;
}

/** Configuration for a single deliberation branch (e.g. "safety", "creative"). */
export interface BranchConfig {
  /** The coordinator who manages this branch's specialists. */
  coordinator: CouncilMemberSpec;
  /** Fixed specialist members assigned to this branch. */
  specialists: CouncilMemberSpec[];
  /** Optional dynamic pool for auto-scaling specialists. */
  pool?: SpecialistPool;
}

/** Dynamic specialist pool that can spawn additional members on demand. */
export interface SpecialistPool {
  /** Template specs from which new specialist instances are cloned. */
  templates: CouncilMemberSpec[];
  /** Maximum number of concurrent specialist instances allowed. */
  maxInstances: number;
  /** Policy governing when new instances are spawned. */
  scalePolicy: "manual" | "per-task" | "preemptive";
}

/**
 * Specification for a single council member (director, coordinator, or specialist).
 *
 * Describes the model, backend, role, and optional resource overrides.
 */
export interface CouncilMemberSpec {
  /** Display name for this member. */
  name: string;
  /** Functional role within the council hierarchy. */
  role: CouncilRole;
  /** Model identifier (e.g. "llama3:8b-instruct-q4_K_M"). */
  model: string;
  /** Inference backend used to serve this member's model. */
  backend: "ollama" | "llamacpp" | "vllm";
  /** Free-text description of the member's domain expertise. */
  speciality: string;
  /** Voting weight in consensus calculations (default 1). */
  weight?: number;
  /** Explicit personality override for this member. */
  personality?: MemberPersonality;
  /** CPU core allocation override. */
  cores?: number;
  /** RAM allocation override in megabytes. */
  memoryMb?: number;
  /** Disk allocation override in gigabytes. */
  diskGb?: number;
}

// ─── Deliberation ─────────────────────────────────────────────

/** A question submitted to the council for deliberation. */
export interface CouncilPrompt {
  /** Unique prompt identifier used to correlate results. */
  id: string;
  /** The question or task to deliberate on. */
  question: string;
  /** Optional context appended to each member's system prompt. */
  context?: string;
  /** Optional system prompt override for all members. */
  systemPrompt?: string;
  /** If set, only this branch participates in deliberation. */
  requiredBranch?: BranchType;
}

/** A single member's response during one round of deliberation. */
export interface MemberResponse {
  /** Unique identifier of the responding member. */
  memberId: string;
  /** Display name of the responding member. */
  memberName: string;
  /** The member's role in the council. */
  role: CouncilRole;
  /** Inference tier used for this response. */
  tier: Tier;
  /** Branch this member belongs to, if any. */
  branch?: BranchType;
  /** The member's textual answer. */
  content: string;
  /** Self-reported confidence score (0–1). */
  confidence: number;
  /** Optional chain-of-thought reasoning. */
  reasoning?: string;
  /** Deliberation round number (1-indexed). */
  round: number;
  /** Wall-clock inference time in milliseconds. */
  durationMs: number;
}

/** Aggregated result from a single deliberation branch. */
export interface BranchResult {
  /** Which branch produced this result. */
  branch: BranchType;
  /** The coordinator's synthesised response. */
  coordinatorResponse: MemberResponse;
  /** Individual specialist responses feeding into the coordinator. */
  specialistResponses: MemberResponse[];
  /** Branch-level consolidated answer text. */
  consolidatedAnswer: string;
  /** Branch-level confidence score (0–1). */
  confidence: number;
}

/** Final result of a full hierarchical council deliberation. */
export interface CouncilResult {
  /** Identifier of the prompt that triggered this deliberation. */
  promptId: string;
  /** The director's final synthesised answer. */
  directorSynthesis: string;
  /** Per-branch results. */
  branches: BranchResult[];
  /** All member responses grouped by round. */
  rounds: MemberResponse[][];
  /** Overall confidence score (0–1). */
  confidence: number;
  /** Total number of members that participated. */
  participantCount: number;
  /** Total wall-clock deliberation time in milliseconds. */
  totalDurationMs: number;
  /** Breakdown of time spent at each inference tier. */
  tierBreakdown: {
    tier1DurationMs: number;
    tier2DurationMs: number;
    tier3DurationMs: number;
  };
  /** Dissenting opinions that could not be reconciled. */
  dissent?: string[];
  /** Set when the director recommends cloud escalation. */
  cloudApprovalRequired?: boolean;
}

// ─── Cloud Escalation Approval ────────────────────────────────

/** Request sent to the user when the council wants to escalate to a cloud model. */
export interface CloudApprovalRequest {
  /** Unique identifier for this approval flow. */
  requestId: string;
  /** The original question being deliberated. */
  question: string;
  /** Best local answer so far. */
  localResponse: string;
  /** Confidence of the local answer (0–1). */
  localConfidence: number;
  /** Director's explanation of why cloud escalation is needed. */
  directorReason: string;
  /** Recommended cloud provider (e.g. "openai", "anthropic"). */
  suggestedProvider?: string;
  /** Recommended cloud model identifier. */
  suggestedModel?: string;
  /** Estimated cost of the cloud call in USD. */
  estimatedCostUsd?: number;
}

/** User's response to a {@link CloudApprovalRequest}. */
export interface CloudApprovalResponse {
  /** Must match the corresponding request's identifier. */
  requestId: string;
  /** Whether the user approved the cloud escalation. */
  approved: boolean;
  /** Optional user-supplied reason for the decision. */
  reason?: string;
}

// ─── Model Swap ───────────────────────────────────────────────

/** Request to hot-swap a council member's model at runtime. */
export interface ModelSwapRequest {
  /** Identifier of the member whose model should be swapped. */
  memberId: string;
  /** New model identifier to load. */
  newModel: string;
  /** New inference backend (defaults to the member's current backend). */
  newBackend?: "ollama" | "llamacpp" | "vllm";
  /** Human-readable reason for the swap (logged for audit). */
  reason: string;
}

/** Outcome of a {@link ModelSwapRequest}. */
export interface ModelSwapResult {
  /** Identifier of the member that was swapped. */
  memberId: string;
  /** Model identifier before the swap. */
  oldModel: string;
  /** Model identifier after the swap. */
  newModel: string;
  /** Whether the member's conversation memory was preserved. */
  memoryPreserved: boolean;
  /** Whether the swap completed without error. */
  success: boolean;
  /** Error message if the swap failed. */
  error?: string;
}

// ─── Legacy flat strategy (still supported for simple setups) ─

/**
 * Deliberation strategy for a flat (non-hierarchical) council.
 *
 * - `hierarchical` — director ➜ coordinators ➜ specialists
 * - `debate` — members argue in rounds until consensus
 * - `parallel` — all members respond independently, results merged
 * - `chain` — sequential pipeline where each member refines the previous answer
 * - `judge` — one member evaluates all others' responses
 * - `majority_vote` — simple majority wins
 */
export type CouncilStrategy =
  | "hierarchical"
  | "debate"
  | "parallel"
  | "chain"
  | "judge"
  | "majority_vote";

/** Configuration for a legacy flat (non-hierarchical) council. */
export interface FlatCouncilConfig {
  /** All participating members (no branch/coordinator distinction). */
  members: CouncilMemberSpec[];
  /** Deliberation strategy to use. */
  strategy: CouncilStrategy;
  /** Maximum deliberation rounds. */
  maxRounds: number;
  /** Confidence threshold (0–1) for consensus. */
  consensusThreshold: number;
  /** Hard timeout in milliseconds. */
  timeoutMs: number;
}

/** A single member's vote in a majority-vote or judge strategy. */
export interface CouncilVote {
  /** Identifier of the voting member. */
  memberId: string;
  /** Identifier of the response this member voted for. */
  selectedResponseId: string;
  /** Explanation for why this response was selected. */
  reason: string;
}

/** Final result of a flat council deliberation. */
export interface FlatCouncilResult {
  /** Identifier of the prompt that triggered this deliberation. */
  promptId: string;
  /** Strategy that was used. */
  strategy: CouncilStrategy;
  /** All member responses grouped by round. */
  rounds: MemberResponse[][];
  /** Member votes (present only for vote-based strategies). */
  votes?: CouncilVote[];
  /** Final synthesised answer. */
  synthesis: string;
  /** Overall confidence score (0–1). */
  confidence: number;
  /** Total number of members that participated. */
  participantCount: number;
  /** Total wall-clock deliberation time in milliseconds. */
  totalDurationMs: number;
  /** Dissenting opinions that could not be reconciled. */
  dissent?: string[];
}
