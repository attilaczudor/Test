import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LoraPipeline } from "./lora-pipeline";
import { LoraConfig } from "./types";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("LoraPipeline", () => {
  let pipeline: LoraPipeline;
  let persistPath: string;

  const baseConfig: LoraConfig = {
    persistPath: "", // set in beforeEach
    ollamaEndpoint: "http://127.0.0.1:11434",
    baseModel: "dolphin-mistral:7b",
    rank: 16,
    alpha: 32,
    qualityThreshold: 0.7,
    minTrainingExamples: 3,
    maxTrainingExamples: 50,
    trainingCheckInterval: 60000,
  };

  beforeEach(() => {
    mockFetch.mockReset();
    persistPath = path.join(os.tmpdir(), `lora-test-${Date.now()}`);
    fs.mkdirSync(persistPath, { recursive: true });
    pipeline = new LoraPipeline({ ...baseConfig, persistPath });
  });

  afterEach(() => {
    pipeline.dispose();
    fs.rmSync(persistPath, { recursive: true, force: true });
  });

  // ─── Data Collection ────────────────────────────────────────

  it("should collect high-quality training examples", () => {
    const example = pipeline.addTrainingExample({
      prompt: "What is TypeScript?",
      response: "TypeScript is a typed superset of JavaScript.",
      score: 0.9,
      category: "coding",
      sourceModel: "dolphin-mistral:7b",
      timestamp: Date.now(),
    });

    expect(example).not.toBeNull();
    expect(example!.id).toMatch(/^train-/);
    expect(example!.score).toBe(0.9);
  });

  it("should reject low-quality examples below threshold", () => {
    const example = pipeline.addTrainingExample({
      prompt: "What?",
      response: "I don't know",
      score: 0.3, // below 0.7 threshold
      category: "general",
      sourceModel: "dolphin-mistral:7b",
      timestamp: Date.now(),
    });

    expect(example).toBeNull();
  });

  it("should deduplicate examples with same prompt and model", () => {
    const first = pipeline.addTrainingExample({
      prompt: "Hello",
      response: "Hi there!",
      score: 0.8,
      category: "general",
      sourceModel: "model-a",
      timestamp: Date.now(),
    });

    const duplicate = pipeline.addTrainingExample({
      prompt: "Hello",
      response: "Hey!",
      score: 0.9,
      category: "general",
      sourceModel: "model-a",
      timestamp: Date.now(),
    });

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
  });

  it("should allow same prompt from different models", () => {
    const first = pipeline.addTrainingExample({
      prompt: "Hello",
      response: "Hi there!",
      score: 0.8,
      category: "general",
      sourceModel: "model-a",
      timestamp: Date.now(),
    });

    const second = pipeline.addTrainingExample({
      prompt: "Hello",
      response: "Hey!",
      score: 0.9,
      category: "general",
      sourceModel: "model-b",
      timestamp: Date.now(),
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });

  it("should emit event on example collection", () => {
    const handler = vi.fn();
    pipeline.on("exampleCollected", handler);

    pipeline.addTrainingExample({
      prompt: "Test",
      response: "Response",
      score: 0.8,
      category: "test",
      sourceModel: "model",
      timestamp: Date.now(),
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toHaveProperty("id");
    expect(handler.mock.calls[0][0]).toHaveProperty("total", 1);
  });

  // ─── Import from Evaluator ──────────────────────────────────

  it("should import high-quality results from evaluator", () => {
    const benchmarkPrompts = new Map([
      ["p1", "What is Rust?"],
      ["p2", "Explain Docker"],
      ["p3", "Unknown prompt"],
    ]);

    const evalResults = [
      { promptId: "p1", response: "Rust is a systems language.", overallScore: 0.85, category: "coding", modelName: "model-a", timestamp: Date.now() },
      { promptId: "p2", response: "Docker is a container platform.", overallScore: 0.5, category: "devops", modelName: "model-a", timestamp: Date.now() }, // below threshold
      { promptId: "p3", response: "Unknown", overallScore: 0.9, category: "general", modelName: "model-a", timestamp: Date.now() }, // prompt exists in map
    ];

    const imported = pipeline.importFromEvaluator(evalResults, benchmarkPrompts);

    // p1 is above threshold and has a prompt match → imported
    // p2 is below threshold → skipped
    // p3 is above threshold and has a prompt match → imported
    expect(imported).toBe(2);
  });

  // ─── Dataset Building ───────────────────────────────────────

  it("should return null if not enough examples", () => {
    pipeline.addTrainingExample({
      prompt: "Only one",
      response: "Example",
      score: 0.8,
      category: "test",
      sourceModel: "model",
      timestamp: Date.now(),
    });

    const dataset = pipeline.buildDataset();
    expect(dataset).toBeNull();
  });

  it("should build balanced dataset from collected examples", () => {
    // Add enough examples (minTrainingExamples = 3)
    for (let i = 0; i < 5; i++) {
      pipeline.addTrainingExample({
        prompt: `Question ${i}`,
        response: `Answer ${i}`,
        score: 0.7 + i * 0.05,
        category: i % 2 === 0 ? "coding" : "general",
        sourceModel: "model",
        timestamp: Date.now(),
      });
    }

    const dataset = pipeline.buildDataset();

    expect(dataset).not.toBeNull();
    expect(dataset!.size).toBeGreaterThanOrEqual(3);
    expect(dataset!.id).toMatch(/^ds-/);
    expect(dataset!.categories).toContain("coding");
    expect(dataset!.categories).toContain("general");

    // Verify JSONL file was created
    expect(fs.existsSync(dataset!.filePath)).toBe(true);

    // Verify JSONL content format
    const lines = fs.readFileSync(dataset!.filePath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(dataset!.size);

    const firstLine = JSON.parse(lines[0]);
    expect(firstLine.messages).toBeDefined();
    expect(firstLine.messages[0].role).toBe("user");
    expect(firstLine.messages[1].role).toBe("assistant");
  });

  it("should include system prompt in JSONL if present", () => {
    for (let i = 0; i < 3; i++) {
      pipeline.addTrainingExample({
        prompt: `Q${i}`,
        response: `A${i}`,
        systemPrompt: "You are a helpful assistant.",
        score: 0.9,
        category: "test",
        sourceModel: "model",
        timestamp: Date.now() + i, // unique timestamps to avoid dedup
      });
    }

    const dataset = pipeline.buildDataset();
    const lines = fs.readFileSync(dataset!.filePath, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]);

    expect(entry.messages[0].role).toBe("system");
    expect(entry.messages[0].content).toBe("You are a helpful assistant.");
    expect(entry.messages[1].role).toBe("user");
    expect(entry.messages[2].role).toBe("assistant");
  });

  // ─── Training ───────────────────────────────────────────────

  it("should create Ollama model on successful training", async () => {
    // Add enough examples
    for (let i = 0; i < 5; i++) {
      pipeline.addTrainingExample({
        prompt: `Q${i}`,
        response: `A${i}`,
        score: 0.8 + i * 0.02,
        category: "test",
        sourceModel: "model",
        timestamp: Date.now() + i,
      });
    }

    // Mock Ollama create API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "success" }),
    });

    const adapter = await pipeline.train();

    expect(adapter).not.toBeNull();
    expect(adapter!.status).toBe("ready");
    expect(adapter!.ollamaName).toMatch(/^openclaw-lora-v/);
    expect(adapter!.version).toBe(1);
    expect(adapter!.baseModel).toBe("dolphin-mistral:7b");

    // Verify Modelfile was written
    const modelfilePath = path.join(persistPath, "modelfiles", `${adapter!.ollamaName}.modelfile`);
    expect(fs.existsSync(modelfilePath)).toBe(true);

    const content = fs.readFileSync(modelfilePath, "utf-8");
    expect(content).toContain("FROM dolphin-mistral:7b");
    expect(content).toContain("PARAMETER temperature");
  });

  it("should handle training failure gracefully", async () => {
    for (let i = 0; i < 5; i++) {
      pipeline.addTrainingExample({
        prompt: `Q${i}`,
        response: `A${i}`,
        score: 0.8,
        category: "test",
        sourceModel: "model",
        timestamp: Date.now() + i,
      });
    }

    // Mock Ollama create API failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "Internal Server Error",
    });

    const failHandler = vi.fn();
    pipeline.on("trainingFailed", failHandler);

    const adapter = await pipeline.train();

    expect(adapter).not.toBeNull();
    expect(adapter!.status).toBe("failed");
    expect(failHandler).toHaveBeenCalledOnce();
  });

  it("should skip training if insufficient data", async () => {
    const skipHandler = vi.fn();
    pipeline.on("trainingSkipped", skipHandler);

    const adapter = await pipeline.train();

    expect(adapter).toBeNull();
    expect(skipHandler).toHaveBeenCalledOnce();
    expect(skipHandler.mock.calls[0][0].reason).toBe("insufficient_data");
  });

  // ─── Adapter Activation ─────────────────────────────────────

  it("should activate a trained adapter", async () => {
    for (let i = 0; i < 5; i++) {
      pipeline.addTrainingExample({
        prompt: `Q${i}`, response: `A${i}`, score: 0.8,
        category: "test", sourceModel: "model", timestamp: Date.now() + i,
      });
    }

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const adapter = await pipeline.train();
    expect(adapter!.status).toBe("ready");

    const activated = pipeline.activateAdapter(adapter!.id);
    expect(activated).toBe(true);
    expect(pipeline.getActiveModelName()).toBe(adapter!.ollamaName);
  });

  it("should return base model name when no adapter active", () => {
    expect(pipeline.getActiveModelName()).toBe("dolphin-mistral:7b");
  });

  it("should supersede previous adapter on new activation", async () => {
    // Train first adapter
    for (let i = 0; i < 5; i++) {
      pipeline.addTrainingExample({
        prompt: `Q${i}`, response: `A${i}`, score: 0.8,
        category: "test", sourceModel: "model", timestamp: Date.now() + i,
      });
    }
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const adapter1 = await pipeline.train();
    pipeline.activateAdapter(adapter1!.id);

    // Train second adapter (need new examples)
    for (let i = 5; i < 10; i++) {
      pipeline.addTrainingExample({
        prompt: `Q${i}`, response: `A${i}`, score: 0.85,
        category: "test", sourceModel: "model", timestamp: Date.now() + i,
      });
    }
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const adapter2 = await pipeline.train();
    pipeline.activateAdapter(adapter2!.id);

    // First adapter should be superseded
    expect(pipeline.getAdapter(adapter1!.id)!.status).toBe("superseded");
    expect(pipeline.getAdapter(adapter2!.id)!.status).toBe("active");
    expect(pipeline.getActiveModelName()).toBe(adapter2!.ollamaName);
  });

  it("should not activate a failed adapter", async () => {
    for (let i = 0; i < 5; i++) {
      pipeline.addTrainingExample({
        prompt: `Q${i}`, response: `A${i}`, score: 0.8,
        category: "test", sourceModel: "model", timestamp: Date.now() + i,
      });
    }
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const adapter = await pipeline.train();

    const activated = pipeline.activateAdapter(adapter!.id);
    expect(activated).toBe(false);
  });

  // ─── Statistics ─────────────────────────────────────────────

  it("should report accurate stats", () => {
    pipeline.addTrainingExample({
      prompt: "Q1", response: "A1", score: 0.8,
      category: "coding", sourceModel: "model", timestamp: Date.now(),
    });
    pipeline.addTrainingExample({
      prompt: "Q2", response: "A2", score: 0.9,
      category: "general", sourceModel: "model", timestamp: Date.now(),
    });

    const stats = pipeline.getStats();

    expect(stats.totalExamples).toBe(2);
    expect(stats.categoryCounts.coding).toBe(1);
    expect(stats.categoryCounts.general).toBe(1);
    expect(stats.avgScore).toBeCloseTo(0.85);
    expect(stats.totalDatasets).toBe(0);
    expect(stats.totalAdapters).toBe(0);
    expect(stats.activeAdapter).toBeNull();
  });

  // ─── Persistence ────────────────────────────────────────────

  it("should persist and reload history", () => {
    pipeline.addTrainingExample({
      prompt: "Persistent Q", response: "Persistent A", score: 0.9,
      category: "test", sourceModel: "model", timestamp: Date.now(),
    });
    pipeline.dispose();

    // Create new pipeline from same path
    const pipeline2 = new LoraPipeline({ ...baseConfig, persistPath });
    const stats = pipeline2.getStats();

    expect(stats.totalExamples).toBe(1);
    pipeline2.dispose();
  });

  it("should start fresh if history file is corrupted", () => {
    // Write garbage to history file
    const historyPath = path.join(persistPath, "lora-history.json");
    fs.writeFileSync(historyPath, "not valid json{{{");

    const pipeline2 = new LoraPipeline({ ...baseConfig, persistPath });
    const stats = pipeline2.getStats();

    expect(stats.totalExamples).toBe(0);
    pipeline2.dispose();
  });

  // ─── Auto-Training Loop ─────────────────────────────────────

  it("should start and stop auto-training without errors", () => {
    pipeline.startAutoTraining();
    pipeline.startAutoTraining(); // double start should be idempotent
    pipeline.stopAutoTraining();
    pipeline.stopAutoTraining(); // double stop should be idempotent
  });

  // ─── History Access ─────────────────────────────────────────

  it("should provide full history access", () => {
    const history = pipeline.getHistory();
    expect(history.examples).toEqual([]);
    expect(history.datasets).toEqual([]);
    expect(history.adapters).toEqual([]);
    expect(history.activeAdapterId).toBeNull();
    expect(history.totalTrainingRuns).toBe(0);
  });
});
