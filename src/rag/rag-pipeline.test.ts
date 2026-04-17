import { describe, it, expect, beforeEach } from "vitest";
import { RagPipeline } from "./rag-pipeline";
import { VectorStore } from "../vector";
import { GraphMemory } from "../memory";
import { RagConfig } from "./types";

describe("RAG Pipeline", () => {
  let pipeline: RagPipeline;
  let vectorStore: VectorStore;
  let memory: GraphMemory;
  const mockConfig: RagConfig = {
    embeddingEndpoint: "http://localhost:11434",
    embeddingModel: "nomic-embed-text",
    dimensions: 4,
    topK: 5,
    similarityThreshold: 0.3,
    chunkSize: 100,
    chunkOverlap: 20,
  };

  beforeEach(() => {
    vectorStore = new VectorStore({
      dimensions: 4,
      maxEntries: 1000,
      similarityThreshold: 0.3,
    });
    memory = new GraphMemory({
      maxNodes: 500,
      importanceThreshold: 0.2,
      autoSummarize: false,
      summarizeAfterTurns: 100,
    });
    pipeline = new RagPipeline(mockConfig, vectorStore, memory);
  });

  describe("Text Chunking", () => {
    it("should return whole text when under chunk size", () => {
      const chunks = pipeline.chunkText("Short text here");
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("Short text here");
    });

    it("should split text into overlapping chunks", () => {
      const text = "A".repeat(50) + " " + "B".repeat(50) + " " + "C".repeat(50);
      const chunks = pipeline.chunkText(text);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should handle empty text", () => {
      const chunks = pipeline.chunkText("");
      expect(chunks).toHaveLength(0);
    });

    it("should prefer splitting on paragraph boundaries", () => {
      const text = "First paragraph content here.\n\n" +
        "Second paragraph with more text here.\n\n" +
        "Third paragraph to test boundary splitting.";
      // With chunk size 100, it should split on \n\n
      const smallConfig = { ...mockConfig, chunkSize: 60, chunkOverlap: 10 };
      const smallPipeline = new RagPipeline(smallConfig, vectorStore, memory);
      const chunks = smallPipeline.chunkText(text);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should prefer splitting on sentence boundaries", () => {
      const text = "First sentence here. Second sentence follows. Third sentence ends. Fourth is last.";
      const smallConfig = { ...mockConfig, chunkSize: 50, chunkOverlap: 10 };
      const smallPipeline = new RagPipeline(smallConfig, vectorStore, memory);
      const chunks = smallPipeline.chunkText(text);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe("Config", () => {
    it("should return config values", () => {
      const config = pipeline.getConfig();
      expect(config.embeddingModel).toBe("nomic-embed-text");
      expect(config.dimensions).toBe(4);
      expect(config.topK).toBe(5);
    });

    it("should track chunk count", () => {
      expect(pipeline.getChunkCount()).toBe(0);
    });
  });

  describe("Retrieval with pre-loaded vectors", () => {
    it("should retrieve from vector store when chunks are present", () => {
      // Manually add entries to vector store
      vectorStore.add("chunk-1", "TypeScript is a typed superset of JavaScript", [0.5, 0.5, 0.5, 0.5], { source: "doc1" });
      vectorStore.add("chunk-2", "Python is great for data science", [0.1, 0.9, 0.1, 0.1], { source: "doc2" });

      // Search with a query embedding similar to chunk-1
      const results = vectorStore.search([0.5, 0.5, 0.5, 0.5], 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.id).toBe("chunk-1");
    });

    it("should query graph memory for related nodes", () => {
      memory.addNode("fact", "TypeScript compiles to JavaScript", {}, 0.8);
      memory.addNode("fact", "Proxmox runs virtual machines", {}, 0.7);

      const queryResult = memory.query({ text: "TypeScript", limit: 5 });
      expect(queryResult.nodes.length).toBeGreaterThan(0);
      expect(queryResult.nodes[0].content).toContain("TypeScript");
    });
  });
});
