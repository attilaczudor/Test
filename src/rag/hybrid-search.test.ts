import { describe, it, expect, beforeEach } from "vitest";
import { Bm25Index, fuseScores } from "./hybrid-search";

describe("Bm25Index", () => {
  let index: Bm25Index;

  beforeEach(() => {
    index = new Bm25Index();
  });

  it("should add and search documents", () => {
    index.add("1", "TypeScript is a typed superset of JavaScript", "docs");
    index.add("2", "Python is great for data science and machine learning", "docs");
    index.add("3", "JavaScript runs in the browser and on Node.js", "docs");

    const results = index.search("TypeScript JavaScript");

    expect(results.length).toBeGreaterThan(0);
    // TypeScript doc should rank highest (matches both terms)
    expect(results[0].id).toBe("1");
  });

  it("should return empty results for no matches", () => {
    index.add("1", "Docker containers and Kubernetes", "docs");

    const results = index.search("quantum physics");
    expect(results).toHaveLength(0);
  });

  it("should handle single-word queries", () => {
    index.add("1", "Proxmox virtualization platform", "docs");
    index.add("2", "Docker container runtime", "docs");

    const results = index.search("Proxmox");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("should rank by BM25 score (frequent terms in shorter docs rank higher)", () => {
    index.add("1", "Rust Rust Rust programming", "docs");
    index.add("2", "Rust is a systems programming language developed by Mozilla with memory safety features and zero-cost abstractions for building reliable software", "docs");

    const results = index.search("Rust");
    expect(results.length).toBe(2);
    // Shorter doc with higher term frequency density should rank higher
    expect(results[0].id).toBe("1");
  });

  it("should remove documents", () => {
    index.add("1", "first document", "docs");
    index.add("2", "second document", "docs");

    expect(index.remove("1")).toBe(true);
    expect(index.remove("nonexistent")).toBe(false);
    expect(index.size()).toBe(1);

    const results = index.search("first");
    expect(results).toHaveLength(0);
  });

  it("should clear all documents", () => {
    index.add("1", "doc one", "src");
    index.add("2", "doc two", "src");
    index.clear();

    expect(index.size()).toBe(0);
    expect(index.search("doc")).toHaveLength(0);
  });

  it("should ignore stopwords", () => {
    index.add("1", "the quick brown fox", "docs");

    // "the" is a stopword — searching for it alone should return nothing
    const results = index.search("the");
    expect(results).toHaveLength(0);

    // "fox" is not a stopword
    const foxResults = index.search("fox");
    expect(foxResults).toHaveLength(1);
  });

  it("should be case-insensitive", () => {
    index.add("1", "OpenClaw AI Framework", "docs");

    const results = index.search("openclaw");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("should limit results to topK", () => {
    for (let i = 0; i < 20; i++) {
      index.add(`doc-${i}`, `document about testing number ${i}`, "docs");
    }

    const results = index.search("testing", 5);
    expect(results).toHaveLength(5);
  });

  it("should get a document by ID", () => {
    index.add("1", "test content", "test-source", { key: "value" });

    const doc = index.get("1");
    expect(doc).toBeDefined();
    expect(doc!.content).toBe("test content");
    expect(doc!.source).toBe("test-source");
    expect(doc!.metadata).toEqual({ key: "value" });
  });
});

describe("fuseScores", () => {
  it("should fuse vector and BM25 scores with configurable weights", () => {
    const vectorResults = [
      { id: "a", score: 0.95 },
      { id: "b", score: 0.7 },
      { id: "c", score: 0.3 },
    ];

    const bm25Results = [
      { id: "b", score: 5.2 },
      { id: "d", score: 3.1 },
      { id: "a", score: 1.0 },
    ];

    const fused = fuseScores(vectorResults, bm25Results, 0.6, 10);

    // All 4 unique IDs should be present
    expect(fused).toHaveLength(4);

    // Each result should have all three scores
    for (const result of fused) {
      expect(result).toHaveProperty("vectorScore");
      expect(result).toHaveProperty("bm25Score");
      expect(result).toHaveProperty("fusedScore");
    }

    // Results should be sorted by fusedScore descending
    for (let i = 1; i < fused.length; i++) {
      expect(fused[i].fusedScore).toBeLessThanOrEqual(fused[i - 1].fusedScore);
    }
  });

  it("should handle empty vector results", () => {
    const fused = fuseScores(
      [],
      [{ id: "a", score: 1.0 }],
      0.6
    );

    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe("a");
    expect(fused[0].vectorScore).toBe(0);
  });

  it("should handle empty BM25 results", () => {
    const fused = fuseScores(
      [{ id: "a", score: 0.9 }],
      [],
      0.6
    );

    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe("a");
    expect(fused[0].bm25Score).toBe(0);
  });

  it("should respect topK limit", () => {
    const vectorResults = Array.from({ length: 20 }, (_, i) => ({
      id: `v-${i}`,
      score: 1 - i * 0.05,
    }));

    const fused = fuseScores(vectorResults, [], 0.6, 5);
    expect(fused).toHaveLength(5);
  });

  it("should normalize scores to 0-1 before fusion", () => {
    const vectorResults = [
      { id: "a", score: 0.95 },
      { id: "b", score: 0.5 },
    ];

    const bm25Results = [
      { id: "a", score: 100 },  // BM25 scores can be large
      { id: "b", score: 50 },
    ];

    const fused = fuseScores(vectorResults, bm25Results, 0.5);

    // After normalization, both scores should be in [0, 1]
    for (const result of fused) {
      expect(result.vectorScore).toBeGreaterThanOrEqual(0);
      expect(result.vectorScore).toBeLessThanOrEqual(1);
      expect(result.bm25Score).toBeGreaterThanOrEqual(0);
      expect(result.bm25Score).toBeLessThanOrEqual(1);
    }
  });
});
