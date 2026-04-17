/**
 * Model-to-resource sizing — auto-calculates memory, CPU, and disk
 * for an LLM container based on the model's parameter count and quantization.
 *
 * Rule of thumb (GGUF Q4_K_M):
 *   RAM ≈ (params_billions × 0.6 GB) + 1.5 GB overhead
 *   Disk ≈ (params_billions × 0.55 GB) + 5 GB (OS + runtime)
 *
 * Higher quantizations (Q5, Q8, FP16) need proportionally more.
 */

import { ModelParams, ModelSizing } from "./types";

// ─── Known model sizes (parameter count in billions) ──────────

const KNOWN_MODELS: Record<string, number> = {
  // TinyLlama
  "tinyllama:1.1b": 1.1,
  "tinyllama": 1.1,

  // Phi
  "phi:2.7b": 2.7,
  "phi:3.8b": 3.8,
  "phi": 3.8,
  "phi3:3.8b": 3.8,
  "phi3:mini": 3.8,

  // Gemma
  "gemma:2b": 2.0,
  "gemma:7b": 7.0,

  // Llama 2/3
  "llama2:7b": 7.0,
  "llama2:13b": 13.0,
  "llama2:70b": 70.0,
  "llama3:8b": 8.0,
  "llama3:70b": 70.0,

  // CodeLlama
  "codellama:7b": 7.0,
  "codellama:7b-instruct": 7.0,
  "codellama:13b": 13.0,
  "codellama:34b": 34.0,

  // Mistral
  "mistral:7b": 7.0,
  "mistral:7b-instruct": 7.0,

  // Mixtral (MoE — active params ~13B but weights are 47B)
  "mixtral:8x7b": 47.0,
  "mixtral:8x7b-instruct": 47.0,

  // DeepSeek
  "deepseek-coder:1.3b": 1.3,
  "deepseek-coder:6.7b": 6.7,
  "deepseek-coder:33b": 33.0,

  // Neural-Chat
  "neural-chat:7b": 7.0,

  // Solar
  "solar:10.7b": 10.7,
  "solar:10.7b-instruct": 10.7,

  // Qwen
  "qwen:1.8b": 1.8,
  "qwen:7b": 7.0,
  "qwen:14b": 14.0,
  "qwen:72b": 72.0,
  "qwen2:0.5b": 0.5,
  "qwen2:1.5b": 1.5,
  "qwen2:7b": 7.0,

  // StarCoder
  "starcoder:1b": 1.0,
  "starcoder:3b": 3.0,
  "starcoder:7b": 7.0,
  "starcoder2:3b": 3.0,
  "starcoder2:7b": 7.0,

  // Yi
  "yi:6b": 6.0,
  "yi:34b": 34.0,

  // Orca
  "orca-mini:3b": 3.0,
  "orca-mini:7b": 7.0,

  // Stable-LM
  "stablelm:1.6b": 1.6,
  "stablelm2:1.6b": 1.6,

  // Dolphin (uncensored variants)
  "dolphin-mixtral:8x7b": 47.0,
  "dolphin-mixtral:8x7b-v2.6": 47.0,
  "dolphin-llama3:8b": 8.0,
  "dolphin-llama3:70b": 70.0,
  "dolphin-phi:2.7b": 2.7,
  "dolphin-mistral:7b": 7.0,

  // Nous Hermes (uncensored)
  "nous-hermes2:34b": 34.0,
  "nous-hermes2-mixtral:8x7b": 47.0,
  "nous-hermes2:10.7b": 10.7,
  "nous-hermes:7b": 7.0,

  // OpenHermes (uncensored)
  "openhermes:7b": 7.0,

  // Wizard Vicuna (uncensored)
  "wizard-vicuna-uncensored:7b": 7.0,
  "wizard-vicuna-uncensored:13b": 13.0,
  "wizard-vicuna-uncensored:30b": 30.0,

  // CodeBooga (uncensored code)
  "codebooga:34b": 34.0,

  // WizardCoder
  "wizardcoder:33b": 33.0,
  "wizardcoder:15b": 15.0,

  // LLaVA (vision models)
  "llava:7b": 7.0,
  "llava:13b": 13.0,
  "llava-llama3:8b": 8.0,
  "bakllava:7b": 7.0,

  // Embedding models
  "nomic-embed-text": 0.137,
  "all-minilm": 0.033,
  "mxbai-embed-large": 0.335,

  // Whisper (STT — sizing is different but tracked for container allocation)
  "whisper-large-v3": 1.55,
  "whisper-medium": 0.769,
  "whisper-small": 0.244,
  "whisper-base": 0.074,
};

// ─── Quantization multipliers relative to Q4_K_M baseline ─────

const QUANT_MULTIPLIERS: Record<string, number> = {
  "Q2_K": 0.7,
  "Q3_K_S": 0.8,
  "Q3_K_M": 0.85,
  "Q4_0": 0.95,
  "Q4_K_S": 0.95,
  "Q4_K_M": 1.0,    // Baseline
  "Q5_0": 1.15,
  "Q5_K_S": 1.15,
  "Q5_K_M": 1.2,
  "Q6_K": 1.35,
  "Q8_0": 1.7,
  "FP16": 2.0,
  "FP32": 4.0,
};

/**
 * Parse parameter count from a model name string.
 * Handles patterns like "model:7b", "model-7B-instruct", etc.
 */
export function parseModelParams(model: string): number | null {
  // Check known models first
  const lower = model.toLowerCase();
  if (KNOWN_MODELS[lower] !== undefined) {
    return KNOWN_MODELS[lower];
  }

  // Try to extract from name: look for patterns like "7b", "13B", "6.7b", "8x7b"
  const moeMatch = lower.match(/(\d+)x(\d+\.?\d*)b/);
  if (moeMatch) {
    // MoE: total weight count = num_experts × params_per_expert
    return parseInt(moeMatch[1]) * parseFloat(moeMatch[2]);
  }

  const paramMatch = lower.match(/(\d+\.?\d*)b/);
  if (paramMatch) {
    return parseFloat(paramMatch[1]);
  }

  return null;
}

/**
 * Calculate container resources needed for a given model.
 * Returns memory (MB), CPU cores, and disk (GB).
 */
export function sizeForModel(
  model: string,
  quantization: string = "Q4_K_M"
): ModelSizing {
  const params = parseModelParams(model);

  if (params === null) {
    // Unknown model — conservative defaults
    return { memoryMb: 8192, cores: 4, diskGb: 20 };
  }

  const quantMul = QUANT_MULTIPLIERS[quantization] || 1.0;

  // RAM: (params × 0.6 GB × quant_multiplier) + 1.5 GB overhead
  const ramGb = (params * 0.6 * quantMul) + 1.5;
  // Round up to nearest 512 MB
  const memoryMb = Math.ceil(ramGb * 1024 / 512) * 512;

  // CPU cores: based on model size (capped at 8 for 16-core host)
  let cores: number;
  if (params <= 2) cores = 2;
  else if (params <= 8) cores = 4;
  else if (params <= 15) cores = 6;
  else cores = 8;

  // Disk: model weights + OS/runtime overhead
  const modelDiskGb = params * 0.55 * quantMul;
  const diskGb = Math.ceil(modelDiskGb + 5);

  return { memoryMb, cores, diskGb };
}

/**
 * Recommended tier-1 (director) sizing — runs in a VM, needs more headroom.
 */
export function sizeForDirector(model: string, quantization: string = "Q4_K_M"): ModelSizing {
  const base = sizeForModel(model, quantization);
  return {
    memoryMb: base.memoryMb + 2048, // Extra 2GB for VM overhead
    cores: Math.max(base.cores, 4),
    diskGb: base.diskGb + 5,        // Extra disk for VM image
  };
}

/**
 * Calculate total resources for an entire 3-tier council config.
 * Explicit `cores`/`memoryMb`/`diskGb` overrides in the preset take
 * precedence over the auto-calculated values from model parameters.
 */
export function calculateTieredResources(config: {
  director: { model: string; cores?: number; memoryMb?: number; diskGb?: number };
  branches: Record<string, {
    coordinator: { model: string; cores?: number; memoryMb?: number; diskGb?: number };
    specialists: Array<{ model: string; cores?: number; memoryMb?: number; diskGb?: number }>;
  }>;
}): {
  tier1: ModelSizing;
  tier2: Record<string, ModelSizing>;
  tier3: ModelSizing[];
  total: { memoryMb: number; cores: number; diskGb: number; containerCount: number };
} {
  const applyOverrides = (
    auto: ModelSizing,
    spec: { cores?: number; memoryMb?: number; diskGb?: number },
  ): ModelSizing => ({
    memoryMb: spec.memoryMb ?? auto.memoryMb,
    cores: spec.cores ?? auto.cores,
    diskGb: spec.diskGb ?? auto.diskGb,
  });

  const tier1 = applyOverrides(sizeForDirector(config.director.model), config.director);

  const tier2: Record<string, ModelSizing> = {};
  const tier3Sizes: ModelSizing[] = [];

  for (const [branchName, branchConfig] of Object.entries(config.branches)) {
    tier2[branchName] = applyOverrides(
      sizeForModel(branchConfig.coordinator.model),
      branchConfig.coordinator,
    );

    for (const spec of branchConfig.specialists) {
      tier3Sizes.push(applyOverrides(sizeForModel(spec.model), spec));
    }
  }

  const allSizes = [tier1, ...Object.values(tier2), ...tier3Sizes];

  return {
    tier1,
    tier2,
    tier3: tier3Sizes,
    total: {
      memoryMb: allSizes.reduce((s, r) => s + r.memoryMb, 0),
      cores: allSizes.reduce((s, r) => s + r.cores, 0),
      diskGb: allSizes.reduce((s, r) => s + r.diskGb, 0),
      containerCount: allSizes.length,
    },
  };
}
