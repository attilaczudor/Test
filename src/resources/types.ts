/**
 * Resource Auto-Detection and Scaling Types
 *
 * Used by the resource detector to probe host hardware and
 * recommend an appropriate council tier, queue parallelism,
 * and store sizes.
 */

/** Snapshot of the host's hardware capabilities. */
export interface HardwareProfile {
  /** Total system RAM in megabytes. */
  totalMemoryMb: number;
  /** Total logical CPU cores. */
  totalCores: number;
  /** GPU VRAM in megabytes (0 if no GPU). */
  gpuMemoryMb: number;
  /** Detected GPU vendor. */
  gpuType: "nvidia" | "amd" | "none";
  /** Machine hostname (used for logging and multi-node identification). */
  hostname: string;
}

/** Available resources after reserving headroom for the OS and other processes. */
export interface ResourceBudget {
  /** Free memory available for OpenClaw in megabytes. */
  availableMemoryMb: number;
  /** Free cores available for OpenClaw. */
  availableCores: number;
  /** Target utilisation ceiling (0–1). */
  maxUtilization: number;
  /** Memory budget after applying utilisation ceiling. */
  budgetMemoryMb: number;
  /** Core budget after applying utilisation ceiling. */
  budgetCores: number;
}

/**
 * Council deployment tier.
 *
 * - `minimal` — single small model, 1–2 cores, ≤ 4 GB RAM
 * - `compact` — 2–3 models, 4–8 cores, ≤ 16 GB RAM
 * - `homelab` — full council with specialists, 8+ cores, 16+ GB RAM
 */
export type CouncilTier = "minimal" | "compact" | "homelab";

/** Outcome of the resource detection and scaling algorithm. */
export interface ScalingDecision {
  /** Detected hardware profile. */
  hardware: HardwareProfile;
  /** Computed resource budget. */
  budget: ResourceBudget;
  /** Recommended council tier based on available resources. */
  recommendedTier: CouncilTier;
  /** How many lane-queue workers to run in parallel. */
  laneQueueParallel: number;
  /** Maximum entries the vector store should hold. */
  vectorStoreMaxEntries: number;
  /** Maximum nodes the graph memory should hold. */
  memoryMaxNodes: number;
}
