/**
 * Hardware resource auto-detection.
 *
 * Detects available RAM, CPU cores, and GPU via /proc and OS APIs.
 * Calculates a resource budget capped at maxUtilization (default 80%).
 * Recommends the best council tier for the detected hardware.
 */

import * as os from "os";
import * as fs from "fs";
import { HardwareProfile, ResourceBudget, CouncilTier, ScalingDecision } from "./types";

/**
 * Detect hardware by reading OS info.
 * Works on Linux (reads /proc/meminfo for accuracy), falls back to os module.
 */
export function detectHardware(): HardwareProfile {
  let totalMemoryMb: number;

  // On Linux, read /proc/meminfo for accurate total
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
    const match = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    if (match) {
      totalMemoryMb = Math.floor(parseInt(match[1], 10) / 1024);
    } else {
      totalMemoryMb = Math.floor(os.totalmem() / (1024 * 1024));
    }
  } catch {
    totalMemoryMb = Math.floor(os.totalmem() / (1024 * 1024));
  }

  const totalCores = os.cpus().length;

  // GPU detection — check for AMD ROCm or NVIDIA
  let gpuMemoryMb = 0;
  let gpuType: "nvidia" | "amd" | "none" = "none";

  // Check AMD ROCm
  try {
    const rocmPath = "/sys/class/drm";
    if (fs.existsSync(rocmPath)) {
      const cards = fs.readdirSync(rocmPath).filter(d => d.startsWith("card") && !d.includes("-"));
      for (const card of cards) {
        const memPath = `${rocmPath}/${card}/device/mem_info_vram_total`;
        if (fs.existsSync(memPath)) {
          const vram = parseInt(fs.readFileSync(memPath, "utf-8").trim(), 10);
          if (vram > 0) {
            gpuType = "amd";
            gpuMemoryMb = Math.floor(vram / (1024 * 1024));
          }
        }
      }
    }
  } catch { /* no AMD GPU */ }

  // Check NVIDIA (nvidia-smi)
  if (gpuType === "none") {
    try {
      if (fs.existsSync("/proc/driver/nvidia/gpus")) {
        gpuType = "nvidia";
        // Try reading GPU memory from sysfs
        const nvidiaPath = "/proc/driver/nvidia/gpus";
        const gpuDirs = fs.readdirSync(nvidiaPath);
        if (gpuDirs.length > 0) {
          const infoPath = `${nvidiaPath}/${gpuDirs[0]}/information`;
          if (fs.existsSync(infoPath)) {
            const info = fs.readFileSync(infoPath, "utf-8");
            const memMatch = info.match(/Video Memory:\s+(\d+)\s+MB/i);
            if (memMatch) {
              gpuMemoryMb = parseInt(memMatch[1], 10);
            }
          }
        }
      }
    } catch { /* no NVIDIA GPU */ }
  }

  return {
    totalMemoryMb,
    totalCores,
    gpuMemoryMb,
    gpuType,
    hostname: os.hostname(),
  };
}

/**
 * Calculate resource budget from hardware profile.
 */
export function calculateBudget(
  hardware: HardwareProfile,
  maxUtilization: number = 0.8,
  reservedMemoryMb: number = 4096,
  reservedCores: number = 2
): ResourceBudget {
  const availableMemoryMb = hardware.totalMemoryMb - reservedMemoryMb;
  const availableCores = hardware.totalCores - reservedCores;

  return {
    availableMemoryMb: Math.max(availableMemoryMb, 0),
    availableCores: Math.max(availableCores, 0),
    maxUtilization,
    budgetMemoryMb: Math.floor(Math.max(availableMemoryMb, 0) * maxUtilization),
    budgetCores: Math.floor(Math.max(availableCores, 0) * maxUtilization),
  };
}

/**
 * Recommend a council tier based on available memory budget.
 *
 * Reference system: 16-core / 128 GB RAM Proxmox host
 *   Budget: (128 - 4 reserve) * 0.8 = ~99 GB → "homelab"
 *
 * - homelab:  >= 80GB budget  (~128GB total with default reserves)
 * - compact:  >= 32GB budget  (~64GB total range)
 * - minimal:  < 32GB budget   (32GB total range or lower)
 */
export function recommendTier(budget: ResourceBudget): CouncilTier {
  const budgetGb = budget.budgetMemoryMb / 1024;

  if (budgetGb >= 80) return "homelab";
  if (budgetGb >= 32) return "compact";
  return "minimal";
}

/**
 * Full auto-scaling decision: detect hardware, calculate budget, recommend tier.
 */
export function autoScale(
  maxUtilization: number = 0.8,
  reservedMemoryMb: number = 4096,
  reservedCores: number = 2
): ScalingDecision {
  const hardware = detectHardware();
  const budget = calculateBudget(hardware, maxUtilization, reservedMemoryMb, reservedCores);
  const recommendedTier = recommendTier(budget);

  // Scale ancillary systems based on budget
  const budgetGb = budget.budgetMemoryMb / 1024;

  let laneQueueParallel: number;
  let vectorStoreMaxEntries: number;
  let memoryMaxNodes: number;

  if (recommendedTier === "homelab") {
    laneQueueParallel = Math.min(8, budget.budgetCores);
    vectorStoreMaxEntries = 100000;
    memoryMaxNodes = 50000;
  } else if (recommendedTier === "compact") {
    laneQueueParallel = Math.min(4, budget.budgetCores);
    vectorStoreMaxEntries = 50000;
    memoryMaxNodes = 20000;
  } else {
    laneQueueParallel = Math.min(2, budget.budgetCores);
    vectorStoreMaxEntries = 20000;
    memoryMaxNodes = 10000;
  }

  return {
    hardware,
    budget,
    recommendedTier,
    laneQueueParallel,
    vectorStoreMaxEntries,
    memoryMaxNodes,
  };
}
