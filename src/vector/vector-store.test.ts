import { describe, it, expect, beforeEach } from "vitest";
import { VectorStore } from "./vector-store";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

describe("VectorStore", () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore({
      dimensions: 4,
      maxEntries: 100,
      similarityThreshold: 0.0,
    });
  });

  it("should add and retrieve entries", () => {
    const entry = store.add("1", "hello world", [1, 0, 0, 0]);
    expect(entry.id).toBe("1");
    expect(entry.content).toBe("hello world");

    const retrieved = store.get("1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.content).toBe("hello world");
  });

  it("should reject wrong-dimension embeddings", () => {
    expect(() => store.add("1", "test", [1, 0, 0])).toThrow(
      "dimension mismatch"
    );
  });

  it("should find similar vectors", () => {
    store.add("1", "cat", [1, 0, 0, 0]);
    store.add("2", "dog", [0.9, 0.1, 0, 0]);
    store.add("3", "car", [0, 0, 1, 0]);

    const results = store.search([1, 0, 0, 0], 2);
    expect(results).toHaveLength(2);
    // "cat" should be the closest
    expect(results[0].entry.content).toBe("cat");
    expect(results[0].score).toBeCloseTo(1.0, 1);
    // "dog" should be second
    expect(results[1].entry.content).toBe("dog");
  });

  it("should respect similarity threshold", () => {
    const thresholdStore = new VectorStore({
      dimensions: 4,
      maxEntries: 100,
      similarityThreshold: 0.9,
    });

    thresholdStore.add("1", "close", [1, 0, 0, 0]);
    thresholdStore.add("2", "far", [0, 1, 0, 0]);

    const results = thresholdStore.search([1, 0, 0, 0]);
    expect(results).toHaveLength(1);
    expect(results[0].entry.content).toBe("close");
  });

  it("should remove entries", () => {
    store.add("1", "test", [1, 0, 0, 0]);
    expect(store.remove("1")).toBe(true);
    expect(store.get("1")).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("should evict oldest when over limit", () => {
    const smallStore = new VectorStore({
      dimensions: 4,
      maxEntries: 3,
      similarityThreshold: 0.0,
    });

    smallStore.add("1", "first", [1, 0, 0, 0]);
    smallStore.add("2", "second", [0, 1, 0, 0]);
    smallStore.add("3", "third", [0, 0, 1, 0]);
    smallStore.add("4", "fourth", [0, 0, 0, 1]);

    expect(smallStore.size()).toBe(3);
    expect(smallStore.get("1")).toBeUndefined(); // oldest evicted
    expect(smallStore.get("4")).toBeDefined(); // newest kept
  });

  it("should batch add entries", () => {
    const count = store.batchAdd([
      { id: "1", content: "a", embedding: [1, 0, 0, 0] },
      { id: "2", content: "b", embedding: [0, 1, 0, 0] },
      { id: "3", content: "c", embedding: [0, 0, 1, 0] },
    ]);

    expect(count).toBe(3);
    expect(store.size()).toBe(3);
  });

  it("should filter results", () => {
    store.add("1", "public doc", [1, 0, 0, 0], { public: true });
    store.add("2", "private doc", [0.95, 0.05, 0, 0], { public: false });

    const results = store.search(
      [1, 0, 0, 0],
      10,
      (e) => e.metadata.public === true
    );
    expect(results).toHaveLength(1);
    expect(results[0].entry.content).toBe("public doc");
  });

  it("should report stats", () => {
    store.add("1", "test", [1, 0, 0, 0]);
    const stats = store.stats();
    expect(stats.size).toBe(1);
    expect(stats.dimensions).toBe(4);
    expect(stats.maxEntries).toBe(100);
  });

  it("should clear all entries", () => {
    store.add("1", "a", [1, 0, 0, 0]);
    store.add("2", "b", [0, 1, 0, 0]);
    store.clear();
    expect(store.size()).toBe(0);
  });

  describe("persistence", () => {
    it("should save and load vector entries from disk", () => {
      const persistPath = path.join(os.tmpdir(), `vector-test-${Date.now()}.json`);

      const store1 = new VectorStore({
        dimensions: 4,
        maxEntries: 100,
        similarityThreshold: 0.0,
        persistPath,
      });

      store1.add("v1", "persistent vector", [1, 0, 0, 0]);
      store1.add("v2", "another vector", [0, 1, 0, 0], { source: "test" });
      store1.saveToDisk();
      store1.dispose();

      // Load into fresh instance
      const store2 = new VectorStore({
        dimensions: 4,
        maxEntries: 100,
        similarityThreshold: 0.0,
        persistPath,
      });

      expect(store2.size()).toBe(2);
      expect(store2.get("v1")).toBeDefined();
      expect(store2.get("v1")!.content).toBe("persistent vector");

      // Verify search still works after reload
      const results = store2.search([1, 0, 0, 0], 1);
      expect(results).toHaveLength(1);
      expect(results[0].entry.content).toBe("persistent vector");

      store2.dispose();

      if (fs.existsSync(persistPath)) fs.unlinkSync(persistPath);
    });

    it("should skip loading if dimension mismatch", () => {
      const persistPath = path.join(os.tmpdir(), `vector-dim-test-${Date.now()}.json`);

      const store1 = new VectorStore({
        dimensions: 4,
        maxEntries: 100,
        similarityThreshold: 0.0,
        persistPath,
      });
      store1.add("v1", "test", [1, 0, 0, 0]);
      store1.saveToDisk();
      store1.dispose();

      // Load with different dimensions — should start empty
      const store2 = new VectorStore({
        dimensions: 8,
        maxEntries: 100,
        similarityThreshold: 0.0,
        persistPath,
      });
      expect(store2.size()).toBe(0);
      store2.dispose();

      if (fs.existsSync(persistPath)) fs.unlinkSync(persistPath);
    });
  });
});
