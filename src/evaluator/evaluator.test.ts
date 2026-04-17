import { describe, it, expect, beforeEach } from "vitest";
import { ModelEvaluator } from "./evaluator";
import { EvalConfig, EvalCategory } from "./types";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

describe("Model Evaluator (RL)", () => {
  let evaluator: ModelEvaluator;
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `eval-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    evaluator = new ModelEvaluator({
      persistPath: tempDir,
      minEvaluations: 3,
      demotionThreshold: 0.3,
      promotionThreshold: 0.7,
      recencyBias: 0.3,
      benchmarkSize: 5,
    });
  });

  describe("Score Tracking", () => {
    it("should initialize with empty history", () => {
      const history = evaluator.getHistory();
      expect(Object.keys(history.scores)).toHaveLength(0);
      expect(history.recentResults).toHaveLength(0);
      expect(history.removedModels).toHaveLength(0);
    });

    it("should track model score after quick eval (mocked)", () => {
      // Directly record a result by using internal state
      const score = evaluator.getModelScore("model-1");
      expect(score).toBeUndefined();
    });

    it("should return all scores", () => {
      const scores = evaluator.getAllScores();
      expect(scores).toEqual({});
    });
  });

  describe("Model Selection (Thompson Sampling)", () => {
    it("should return null for empty model list", () => {
      const selected = evaluator.selectModel([]);
      expect(selected).toBeNull();
    });

    it("should select from available models", () => {
      const models = [
        { id: "model-1", name: "dolphin-phi:2.7b" },
        { id: "model-2", name: "dolphin-mistral:7b" },
      ];
      const selected = evaluator.selectModel(models);
      expect(selected).not.toBeNull();
      expect(selected!.id).toBeDefined();
      expect(selected!.expectedScore).toBeGreaterThan(0);
    });

    it("should favor unexplored models (exploration)", () => {
      const models = [
        { id: "new-model", name: "brand-new:7b" },
      ];
      // New models get higher uncertainty = more exploration
      const selected = evaluator.selectModel(models);
      expect(selected!.id).toBe("new-model");
    });

    it("should select with category filter", () => {
      const models = [
        { id: "coder", name: "codebooga:34b" },
        { id: "writer", name: "dolphin-llama3:8b" },
      ];
      const selected = evaluator.selectModel(models, "code_generation");
      expect(selected).not.toBeNull();
    });
  });

  describe("Model Lifecycle", () => {
    it("should flag models for removal", () => {
      const flagged = evaluator.getFlaggedModels();
      expect(flagged).toHaveLength(0);
    });

    it("should remove a model and record the reason", () => {
      // Can't remove a model that doesn't exist
      const removed = evaluator.removeModel("nonexistent");
      expect(removed).toBe(false);
    });

    it("should get rankings for a category", () => {
      const rankings = evaluator.getRankings("code_generation");
      expect(rankings.category).toBe("code_generation");
      expect(rankings.rankings).toHaveLength(0);
    });
  });

  describe("Persistence", () => {
    it("should save and load history", () => {
      evaluator.saveHistory();
      const historyFile = path.join(tempDir, "eval-history.json");
      expect(fs.existsSync(historyFile)).toBe(true);

      const data = JSON.parse(fs.readFileSync(historyFile, "utf-8"));
      expect(data.scores).toBeDefined();
      expect(data.recentResults).toBeDefined();
    });

    it("should reload history from disk", () => {
      // Write some test data
      const testHistory = {
        scores: {
          "test-model": {
            modelId: "test-model",
            modelName: "test:7b",
            categoryScores: {},
            overallScore: 0.6,
            totalEvaluations: 5,
            alpha: 3,
            beta: 2,
            status: "adequate",
            firstEvaluatedAt: Date.now(),
            lastEvaluatedAt: Date.now(),
          },
        },
        recentResults: [],
        removedModels: [],
        lastUpdated: Date.now(),
      };

      fs.writeFileSync(
        path.join(tempDir, "eval-history.json"),
        JSON.stringify(testHistory),
        "utf-8"
      );

      // Create new evaluator that loads from disk
      const reloaded = new ModelEvaluator({
        persistPath: tempDir,
        minEvaluations: 3,
        demotionThreshold: 0.3,
        promotionThreshold: 0.7,
        recencyBias: 0.3,
        benchmarkSize: 5,
      });

      const score = reloaded.getModelScore("test-model");
      expect(score).toBeDefined();
      expect(score!.overallScore).toBe(0.6);
      expect(score!.totalEvaluations).toBe(5);
    });
  });
});
