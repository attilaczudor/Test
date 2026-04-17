import { describe, it, expect, beforeEach } from "vitest";
import { GraphMemory } from "./graph";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

describe("GraphMemory", () => {
  let memory: GraphMemory;

  beforeEach(() => {
    memory = new GraphMemory({
      maxNodes: 100,
      importanceThreshold: 0.3,
      autoSummarize: false,
      summarizeAfterTurns: 50,
    });
  });

  describe("addNode / getNode", () => {
    it("should add and retrieve a node", () => {
      const node = memory.addNode("fact", "The sky is blue");
      expect(node.id).toBeTruthy();
      expect(node.type).toBe("fact");
      expect(node.content).toBe("The sky is blue");
      expect(node.importance).toBe(0.5);

      const retrieved = memory.getNode(node.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe("The sky is blue");
    });

    it("should clamp importance to [0, 1]", () => {
      const high = memory.addNode("fact", "test", {}, 5.0);
      expect(high.importance).toBe(1);

      const low = memory.addNode("fact", "test", {}, -1);
      expect(low.importance).toBe(0);
    });

    it("should increment access count on getNode", () => {
      const node = memory.addNode("fact", "test");
      expect(node.accessCount).toBe(0);

      memory.getNode(node.id);
      expect(node.accessCount).toBe(1);

      memory.getNode(node.id);
      expect(node.accessCount).toBe(2);
    });

    it("should return undefined for non-existent node", () => {
      expect(memory.getNode("nonexistent")).toBeUndefined();
    });
  });

  describe("removeNode", () => {
    it("should remove a node and its edges", () => {
      const a = memory.addNode("fact", "A");
      const b = memory.addNode("fact", "B");
      memory.addEdge(a.id, b.id, "related_to");

      expect(memory.removeNode(a.id)).toBe(true);
      expect(memory.getNode(a.id)).toBeUndefined();
      expect(memory.getNeighbors(b.id)).toHaveLength(0);
    });

    it("should return false for non-existent node", () => {
      expect(memory.removeNode("nonexistent")).toBe(false);
    });
  });

  describe("edges", () => {
    it("should create edges between nodes", () => {
      const a = memory.addNode("fact", "A");
      const b = memory.addNode("fact", "B");
      const edge = memory.addEdge(a.id, b.id, "related_to");

      expect(edge).not.toBeNull();
      expect(edge!.sourceId).toBe(a.id);
      expect(edge!.targetId).toBe(b.id);
      expect(edge!.relation).toBe("related_to");
    });

    it("should return null for edges between non-existent nodes", () => {
      const a = memory.addNode("fact", "A");
      expect(memory.addEdge(a.id, "nonexistent", "test")).toBeNull();
    });

    it("should remove edges", () => {
      const a = memory.addNode("fact", "A");
      const b = memory.addNode("fact", "B");
      const edge = memory.addEdge(a.id, b.id, "related_to");

      expect(memory.removeEdge(edge!.id)).toBe(true);
      expect(memory.getNeighbors(a.id)).toHaveLength(0);
    });
  });

  describe("query", () => {
    it("should search by text", () => {
      memory.addNode("fact", "TypeScript is a typed language");
      memory.addNode("fact", "Python is dynamically typed");
      memory.addNode("task", "Buy groceries");

      const results = memory.query({ text: "typed language" });
      expect(results.nodes.length).toBeGreaterThan(0);
      expect(results.nodes[0].content).toContain("typed");
    });

    it("should filter by type", () => {
      memory.addNode("fact", "A fact");
      memory.addNode("task", "A task");
      memory.addNode("contact", "A contact");

      const results = memory.query({ types: ["task"] });
      expect(results.nodes).toHaveLength(1);
      expect(results.nodes[0].type).toBe("task");
    });

    it("should filter by minimum importance", () => {
      memory.addNode("fact", "Low importance", {}, 0.1);
      memory.addNode("fact", "High importance", {}, 0.9);

      const results = memory.query({ minImportance: 0.5 });
      expect(results.nodes).toHaveLength(1);
      expect(results.nodes[0].content).toBe("High importance");
    });

    it("should respect limit", () => {
      for (let i = 0; i < 10; i++) {
        memory.addNode("fact", `Fact ${i}`);
      }

      const results = memory.query({ limit: 3 });
      expect(results.nodes).toHaveLength(3);
      expect(results.totalMatched).toBe(10);
    });

    it("should include edges when requested", () => {
      const a = memory.addNode("fact", "A");
      const b = memory.addNode("fact", "B");
      memory.addEdge(a.id, b.id, "related_to");

      const results = memory.query({ includeEdges: true });
      expect(results.edges.length).toBeGreaterThan(0);
    });
  });

  describe("getNeighbors", () => {
    it("should return connected nodes", () => {
      const a = memory.addNode("fact", "A");
      const b = memory.addNode("fact", "B");
      const c = memory.addNode("fact", "C");

      memory.addEdge(a.id, b.id, "related_to");
      memory.addEdge(a.id, c.id, "part_of");

      const neighbors = memory.getNeighbors(a.id);
      expect(neighbors).toHaveLength(2);
    });

    it("should return empty for isolated nodes", () => {
      const a = memory.addNode("fact", "A");
      expect(memory.getNeighbors(a.id)).toHaveLength(0);
    });
  });

  describe("traverse", () => {
    it("should traverse the graph BFS up to maxDepth", () => {
      const a = memory.addNode("fact", "A");
      const b = memory.addNode("fact", "B");
      const c = memory.addNode("fact", "C");
      const d = memory.addNode("fact", "D");

      memory.addEdge(a.id, b.id, "r");
      memory.addEdge(b.id, c.id, "r");
      memory.addEdge(c.id, d.id, "r");

      // Depth 1 should get A and B
      const depth1 = memory.traverse(a.id, 1);
      expect(depth1.nodes).toHaveLength(2);

      // Depth 2 should get A, B, C
      const depth2 = memory.traverse(a.id, 2);
      expect(depth2.nodes).toHaveLength(3);
    });
  });

  describe("prune", () => {
    it("should remove low-importance nodes when over limit", () => {
      const smallMemory = new GraphMemory({
        maxNodes: 5,
        importanceThreshold: 0.99,
        autoSummarize: false,
        summarizeAfterTurns: 50,
      });

      // Add low-importance nodes backdated to defeat recency boost
      for (let i = 0; i < 4; i++) {
        const node = smallMemory.addNode("fact", `Low ${i}`, {}, 0.01);
        node.createdAt = Date.now() - 7 * 24 * 3600000;
        node.lastAccessedAt = Date.now() - 7 * 24 * 3600000;
      }
      // This high-importance node should survive
      smallMemory.addNode("fact", "Important!", {}, 0.9);

      // Add one more to trigger pruning (6 > 5)
      smallMemory.addNode("fact", "Trigger", {}, 0.01);

      const stats = smallMemory.stats();
      expect(stats.totalNodes).toBeLessThanOrEqual(5);
    });

    it("should never prune summary nodes", () => {
      const smallMemory = new GraphMemory({
        maxNodes: 3,
        importanceThreshold: 0.5,
        autoSummarize: false,
        summarizeAfterTurns: 50,
      });

      smallMemory.addNode("summary", "Summary node", {}, 0.1);
      smallMemory.addNode("fact", "Fact 1", {}, 0.1);
      smallMemory.addNode("fact", "Fact 2", {}, 0.1);
      // Trigger pruning
      smallMemory.addNode("fact", "Trigger", {}, 0.1);

      const stats = smallMemory.stats();
      expect(stats.nodesByType["summary"]).toBe(1);
    });
  });

  describe("summarize", () => {
    it("should compress old low-access nodes into summaries", () => {
      // Add nodes with old timestamps
      for (let i = 0; i < 5; i++) {
        const node = memory.addNode("fact", `Old fact ${i}`);
        // Backdate the node
        node.lastAccessedAt = Date.now() - 7200000; // 2 hours ago
        node.accessCount = 0;
      }

      const summaries = memory.summarize();
      expect(summaries.length).toBeGreaterThan(0);
      expect(summaries[0].type).toBe("summary");
      expect(summaries[0].content).toContain("Auto-summary");
    });
  });

  describe("stats", () => {
    it("should report correct statistics", () => {
      memory.addNode("fact", "Fact 1", {}, 0.5);
      memory.addNode("fact", "Fact 2", {}, 0.7);
      memory.addNode("task", "Task 1", {}, 0.9);

      const a = memory.addNode("fact", "A");
      const b = memory.addNode("fact", "B");
      memory.addEdge(a.id, b.id, "test");

      const stats = memory.stats();
      expect(stats.totalNodes).toBe(5);
      expect(stats.totalEdges).toBe(1);
      expect(stats.nodesByType["fact"]).toBe(4);
      expect(stats.nodesByType["task"]).toBe(1);
      expect(stats.averageImportance).toBeGreaterThan(0);
    });
  });

  describe("persistence", () => {
    it("should save and load graph state from disk", () => {
      const persistPath = path.join(os.tmpdir(), `graph-test-${Date.now()}.json`);

      const mem1 = new GraphMemory({
        maxNodes: 100,
        importanceThreshold: 0.3,
        autoSummarize: false,
        summarizeAfterTurns: 50,
        persistPath,
      });

      const nodeA = mem1.addNode("fact", "Persisted fact A", {}, 0.8);
      const nodeB = mem1.addNode("contact", "User Bob", {}, 0.9);
      mem1.addEdge(nodeA.id, nodeB.id, "references");
      mem1.saveToDisk();
      mem1.dispose();

      // Load into a fresh instance
      const mem2 = new GraphMemory({
        maxNodes: 100,
        importanceThreshold: 0.3,
        autoSummarize: false,
        summarizeAfterTurns: 50,
        persistPath,
      });

      const stats = mem2.stats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.totalEdges).toBe(1);

      const loaded = mem2.getNode(nodeA.id);
      expect(loaded).toBeDefined();
      expect(loaded!.content).toBe("Persisted fact A");
      expect(loaded!.type).toBe("fact");

      mem2.dispose();

      // Cleanup
      if (fs.existsSync(persistPath)) fs.unlinkSync(persistPath);
    });

    it("should start fresh when persist file does not exist", () => {
      const mem = new GraphMemory({
        maxNodes: 100,
        importanceThreshold: 0.3,
        autoSummarize: false,
        summarizeAfterTurns: 50,
        persistPath: path.join(os.tmpdir(), `nonexistent-${Date.now()}.json`),
      });

      expect(mem.stats().totalNodes).toBe(0);
      mem.dispose();
    });
  });
});
