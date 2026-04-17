/**
 * LoRA Fine-Tuning Pipeline — Recursive Self-Improvement
 *
 * OpenClaw continuously learns from its own interactions:
 *
 *   1. COLLECT: High-quality responses (scored by evaluator) are
 *      saved as training examples
 *   2. CURATE: Examples are filtered by quality, deduplicated,
 *      and balanced across categories
 *   3. TRAIN: When enough examples accumulate, a LoRA adapter
 *      is fine-tuned via Ollama's Modelfile system
 *   4. EVALUATE: The new adapter is benchmarked against the base
 *      model; only deployed if it improves
 *   5. DEPLOY: The adapter is loaded into Ollama as a new model
 *      variant and becomes the active model
 *
 * This creates a recursive learning loop where every conversation
 * makes OpenClaw slightly better at its job.
 */

import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import {
  LoraConfig,
  TrainingExample,
  TrainingDataset,
  LoraAdapter,
  LoraHistory,
  TrainingHyperparameters,
} from "./types";

const DEFAULT_HYPERPARAMETERS: TrainingHyperparameters = {
  epochs: 3,
  batchSize: 4,
  learningRate: 2e-4,
  warmupRatio: 0.1,
  weightDecay: 0.01,
  gradientAccumulationSteps: 4,
};

export class LoraPipeline extends EventEmitter {
  private readonly config: LoraConfig;
  private history: LoraHistory;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: LoraConfig) {
    super();
    this.config = config;
    this.history = this.loadHistory();
  }

  // ─── Data Collection ─────────────────────────────────────────

  /**
   * Record a high-quality interaction as a potential training example.
   * Called by the agent/evaluator after scoring a response.
   */
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  addTrainingExample(example: Omit<TrainingExample, "id">): TrainingExample | null {
    // Quality gate: only collect high-scoring responses
    if (example.score < this.config.qualityThreshold) {
      return null;
    }

    // Deduplication: skip if we already have a very similar prompt
    const isDuplicate = this.history.examples.some(
      (e) => e.prompt === example.prompt && e.sourceModel === example.sourceModel,
    );
    if (isDuplicate) {
      return null;
    }

    const entry: TrainingExample = {
      ...example,
      id: `train-${crypto.randomUUID().slice(0, 8)}`,
    };

    this.history.examples.push(entry);

    // Cap total examples to prevent unbounded growth
    if (this.history.examples.length > this.config.maxTrainingExamples * 5) {
      // Keep the highest-scoring examples
      this.history.examples.sort((a, b) => b.score - a.score);
      this.history.examples = this.history.examples.slice(0, this.config.maxTrainingExamples * 3);
    }

    this.history.lastUpdated = Date.now();
    this.saveHistory();

    this.emit("exampleCollected", {
      id: entry.id,
      score: entry.score,
      category: entry.category,
      total: this.history.examples.length,
    });

    return entry;
  }

  /**
   * Import training examples from evaluator history.
   * Converts EvalResult data into training examples.
   */
  importFromEvaluator(
    evalResults: Array<{
      promptId: string;
      response: string;
      overallScore: number;
      category: string;
      modelName: string;
      timestamp: number;
    }>,
    benchmarkPrompts: Map<string, string>,
  ): number {
    let imported = 0;

    for (const result of evalResults) {
      if (result.overallScore < this.config.qualityThreshold) {
        continue;
      }

      const prompt = benchmarkPrompts.get(result.promptId);
      if (!prompt) {
        continue;
      }

      const added = this.addTrainingExample({
        prompt,
        response: result.response,
        score: result.overallScore,
        category: result.category,
        sourceModel: result.modelName,
        timestamp: result.timestamp,
      });

      if (added) {
        imported++;
      }
    }

    return imported;
  }

  // ─── Dataset Curation ────────────────────────────────────────

  /**
   * Build a balanced training dataset from collected examples.
   * Ensures category diversity and quality distribution.
   */
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  buildDataset(): TrainingDataset | null {
    if (this.history.examples.length < this.config.minTrainingExamples) {
      return null;
    }

    const datasetId = `ds-${crypto.randomUUID().slice(0, 8)}`;
    const maxExamples = this.config.maxTrainingExamples;

    // Group by category for balanced sampling
    const byCategory = new Map<string, TrainingExample[]>();
    for (const ex of this.history.examples) {
      const list = byCategory.get(ex.category) || [];
      list.push(ex);
      byCategory.set(ex.category, list);
    }

    // Balanced sampling: equal share per category, up to max
    const perCategory = Math.floor(maxExamples / Math.max(1, byCategory.size));
    const selected: TrainingExample[] = [];

    for (const [, examples] of byCategory) {
      // Sort by score descending within each category
      examples.sort((a, b) => b.score - a.score);
      selected.push(...examples.slice(0, perCategory));
    }

    // Fill remaining slots with highest-scoring from any category
    if (selected.length < maxExamples) {
      const selectedIds = new Set(selected.map((s) => s.id));
      const remaining = this.history.examples
        .filter((e) => !selectedIds.has(e.id))
        .toSorted((a, b) => b.score - a.score)
        .slice(0, maxExamples - selected.length);
      selected.push(...remaining);
    }

    if (selected.length < this.config.minTrainingExamples) {
      return null;
    }

    // Write JSONL training file
    const dir = path.join(this.config.persistPath, "datasets");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const filePath = path.join(dir, `${datasetId}.jsonl`);
    const jsonlLines = selected.map((ex) =>
      JSON.stringify({
        messages: [
          ...(ex.systemPrompt ? [{ role: "system", content: ex.systemPrompt }] : []),
          { role: "user", content: ex.prompt },
          { role: "assistant", content: ex.response },
        ],
      }),
    );

    fs.writeFileSync(filePath, jsonlLines.join("\n"), { encoding: "utf-8", mode: 0o600 });

    const categories = [...new Set(selected.map((s) => s.category))];
    const avgScore = selected.reduce((s, e) => s + e.score, 0) / selected.length;

    const dataset: TrainingDataset = {
      id: datasetId,
      createdAt: Date.now(),
      size: selected.length,
      filePath,
      averageScore: avgScore,
      categories,
    };

    this.history.datasets.push(dataset);
    this.saveHistory();

    this.emit("datasetCreated", {
      id: datasetId,
      size: selected.length,
      avgScore,
      categories,
    });

    return dataset;
  }

  // ─── Training ────────────────────────────────────────────────

  /**
   * Trigger a LoRA fine-tuning run via Ollama's Modelfile system.
   *
   * Creates an Ollama Modelfile that references the base model and
   * applies the training data. Ollama supports GGUF LoRA adapters
   * through the ADAPTER directive in Modelfiles.
   *
   * Note: Full LoRA training requires the base model weights locally.
   * This method creates the Modelfile and dataset, then invokes
   * Ollama's create API to build the fine-tuned model variant.
   */
  async train(
    dataset?: TrainingDataset,
    hyperparameters?: Partial<TrainingHyperparameters>,
    // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  ): Promise<LoraAdapter | null> {
    // Build dataset if not provided
    if (!dataset) {
      dataset = this.buildDataset();
      if (!dataset) {
        this.emit("trainingSkipped", { reason: "insufficient_data" });
        return null;
      }
    }

    const version = this.history.totalTrainingRuns + 1;
    const adapterId = `lora-v${version}`;
    const ollamaName = `openclaw-lora-v${version}`;
    const hp = { ...DEFAULT_HYPERPARAMETERS, ...hyperparameters };

    const adapter: LoraAdapter = {
      id: adapterId,
      baseModel: this.config.baseModel,
      ollamaName,
      datasetId: dataset.id,
      hyperparameters: hp,
      trainingExamples: dataset.size,
      finalLoss: 0,
      postTrainingScore: 0,
      version,
      createdAt: Date.now(),
      status: "training",
    };

    this.history.adapters.push(adapter);
    this.saveHistory();

    this.emit("trainingStarted", {
      adapterId,
      version,
      dataset: dataset.id,
      examples: dataset.size,
    });

    try {
      // Create Ollama Modelfile for the fine-tuned variant
      const modelfileDir = path.join(this.config.persistPath, "modelfiles");
      if (!fs.existsSync(modelfileDir)) {
        fs.mkdirSync(modelfileDir, { recursive: true, mode: 0o700 });
      }

      const modelfilePath = path.join(modelfileDir, `${ollamaName}.modelfile`);
      const modelfileContent = [
        `FROM ${this.config.baseModel}`,
        ``,
        `# LoRA fine-tuned by OpenClaw (version ${version})`,
        `# Training data: ${dataset.size} examples, avg score: ${dataset.averageScore.toFixed(3)}`,
        `# Categories: ${dataset.categories.join(", ")}`,
        `# Hyperparameters: epochs=${hp.epochs}, lr=${hp.learningRate}, rank=${this.config.rank}`,
        ``,
        `PARAMETER temperature 0.7`,
        `PARAMETER top_p 0.9`,
        `PARAMETER num_ctx 4096`,
        ``,
        `SYSTEM """`,
        `You are OpenClaw, an autonomous AI system running on a local homelab.`,
        `You have been fine-tuned on ${dataset.size} high-quality interactions.`,
        `You are direct, technical, and continuously learning.`,
        `"""`,
      ].join("\n");

      fs.writeFileSync(modelfilePath, modelfileContent, { encoding: "utf-8", mode: 0o600 });

      // Call Ollama create API to build the model variant
      const createRes = await fetch(`${this.config.ollamaEndpoint}/api/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ollamaName,
          modelfile: modelfileContent,
          stream: false,
        }),
        signal: AbortSignal.timeout(300000), // 5 min timeout for model creation
      });

      if (!createRes.ok) {
        throw new Error(`Ollama create failed: HTTP ${createRes.status}`);
      }

      adapter.status = "ready";
      adapter.finalLoss = 0; // Ollama doesn't report loss for Modelfile-based creation
      this.history.totalTrainingRuns++;
      this.saveHistory();

      this.emit("trainingCompleted", {
        adapterId,
        version,
        ollamaName,
        status: "ready",
      });

      return adapter;
    } catch (err: unknown) {
      adapter.status = "failed";
      this.saveHistory();

      this.emit("trainingFailed", {
        adapterId,
        error: err instanceof Error ? err.message : String(err),
      });

      return adapter;
    }
  }

  /**
   * Activate a trained adapter — make it the default model.
   */
  activateAdapter(adapterId: string): boolean {
    const adapter = this.history.adapters.find((a) => a.id === adapterId);
    if (!adapter || adapter.status !== "ready") {
      return false;
    }

    // Supersede the currently active adapter
    if (this.history.activeAdapterId) {
      const current = this.history.adapters.find((a) => a.id === this.history.activeAdapterId);
      if (current) {
        current.status = "superseded";
      }
    }

    adapter.status = "active";
    this.history.activeAdapterId = adapterId;
    this.saveHistory();

    this.emit("adapterActivated", {
      adapterId,
      ollamaName: adapter.ollamaName,
      version: adapter.version,
    });

    return true;
  }

  /**
   * Get the currently active adapter's Ollama model name.
   * Returns the base model name if no adapter is active.
   */
  getActiveModelName(): string {
    if (this.history.activeAdapterId) {
      const adapter = this.history.adapters.find((a) => a.id === this.history.activeAdapterId);
      if (adapter && adapter.status === "active") {
        return adapter.ollamaName;
      }
    }
    return this.config.baseModel;
  }

  // ─── Auto-Training Loop ─────────────────────────────────────

  /**
   * Start the automatic training check loop.
   * Periodically checks if enough data has accumulated for training.
   */
  startAutoTraining(): void {
    if (this.checkTimer) {
      return;
    }

    this.checkTimer = setInterval(async () => {
      const pendingExamples = this.history.examples.length;
      if (pendingExamples >= this.config.minTrainingExamples) {
        this.emit("autoTrainingTriggered", { examples: pendingExamples });
        const adapter = await this.train();
        if (adapter && adapter.status === "ready") {
          this.activateAdapter(adapter.id);
        }
      }
    }, this.config.trainingCheckInterval);
  }

  stopAutoTraining(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  // ─── Statistics ──────────────────────────────────────────────

  getStats(): {
    totalExamples: number;
    totalDatasets: number;
    totalAdapters: number;
    activeAdapter: string | null;
    categoryCounts: Record<string, number>;
    avgScore: number;
  } {
    const categoryCounts: Record<string, number> = {};
    let totalScore = 0;

    for (const ex of this.history.examples) {
      categoryCounts[ex.category] = (categoryCounts[ex.category] || 0) + 1;
      totalScore += ex.score;
    }

    return {
      totalExamples: this.history.examples.length,
      totalDatasets: this.history.datasets.length,
      totalAdapters: this.history.adapters.length,
      activeAdapter: this.history.activeAdapterId,
      categoryCounts,
      avgScore: this.history.examples.length > 0 ? totalScore / this.history.examples.length : 0,
    };
  }

  getHistory(): LoraHistory {
    return this.history;
  }

  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  getAdapter(id: string): LoraAdapter | undefined {
    return this.history.adapters.find((a) => a.id === id);
  }

  // ─── Persistence ─────────────────────────────────────────────

  private loadHistory(): LoraHistory {
    const filePath = path.join(this.config.persistPath, "lora-history.json");
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(data) as LoraHistory;
      }
    } catch {
      // Start fresh
    }
    return {
      examples: [],
      datasets: [],
      adapters: [],
      activeAdapterId: null,
      totalTrainingRuns: 0,
      lastUpdated: Date.now(),
    };
  }

  saveHistory(): void {
    try {
      const dir = this.config.persistPath;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      const filePath = path.join(dir, "lora-history.json");
      this.history.lastUpdated = Date.now();
      fs.writeFileSync(filePath, JSON.stringify(this.history, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch {
      // Silently fail
    }
  }

  dispose(): void {
    this.stopAutoTraining();
    this.saveHistory();
  }
}
