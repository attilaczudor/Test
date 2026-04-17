import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { UserKnowledgeGraphEngine } from "./user-knowledge-graph";

describe("UserKnowledgeGraphEngine", () => {
  let engine: UserKnowledgeGraphEngine;
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `ukg-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    engine = new UserKnowledgeGraphEngine(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Constructor ──────────────────────────────────────────────

  it("should reject paths containing '..'", () => {
    expect(() => new UserKnowledgeGraphEngine("../etc/passwd")).toThrow(
      "Invalid persist path"
    );
  });

  it("should initialise with no graphs loaded for an empty directory", () => {
    const stats = engine.stats("attila");
    expect(stats.totalNodes).toBe(0);
  });

  // ─── addFact ──────────────────────────────────────────────────

  it("should add a new fact and return it", () => {
    const node = engine.addFact("attila", "Name: Attila", "identity");
    expect(node.content).toBe("Name: Attila");
    expect(node.category).toBe("identity");
    expect(node.userId).toBe("attila");
    expect(node.mentionCount).toBe(1);
    expect(node.id).toMatch(/^ukn-/);
  });

  it("should apply default importance weights per category", () => {
    const identity = engine.addFact("attila", "Name: Attila", "identity");
    const fact = engine.addFact("attila", "Some random fact", "fact");
    expect(identity.importance).toBe(1.0);
    expect(fact.importance).toBe(0.5);
  });

  it("should default source to 'stated'", () => {
    const node = engine.addFact("attila", "I like Rust", "preference");
    expect(node.source).toBe("stated");
  });

  it("should accept custom source and confidence options", () => {
    const node = engine.addFact("attila", "Name: Attila", "identity", {
      source: "seeded",
      confidence: 1.0,
      importance: 1.0,
    });
    expect(node.source).toBe("seeded");
    expect(node.confidence).toBe(1.0);
  });

  // ─── Deduplication ────────────────────────────────────────────

  it("should increment mentionCount when same content is added again", () => {
    engine.addFact("attila", "Name: Attila", "identity");
    const node = engine.addFact("attila", "Name: Attila", "identity");
    expect(node.mentionCount).toBe(2);
    expect(engine.stats("attila").totalNodes).toBe(1);
  });

  it("should boost confidence on re-mention (max 1.0)", () => {
    engine.addFact("attila", "Name: Attila", "identity", { confidence: 0.9 });
    const node = engine.addFact("attila", "Name: Attila", "identity");
    expect(node.confidence).toBeCloseTo(0.95);
  });

  it("should not deduplicate across different categories", () => {
    engine.addFact("attila", "proxmox", "software");
    engine.addFact("attila", "proxmox", "hardware");
    expect(engine.stats("attila").totalNodes).toBe(2);
  });

  it("should not deduplicate facts for different users", () => {
    engine.addFact("attila", "Name: Attila", "identity");
    engine.addFact("bob", "Name: Attila", "identity");
    expect(engine.stats("attila").totalNodes).toBe(1);
    expect(engine.stats("bob").totalNodes).toBe(1);
  });

  // ─── seedProfile ──────────────────────────────────────────────

  it("should seed initial facts without duplicates", () => {
    engine.seedProfile("attila", [
      { content: "Name: Attila", category: "identity" },
      { content: "Uses: proxmox", category: "software" },
    ]);
    expect(engine.stats("attila").totalNodes).toBe(2);

    // Re-seeding should not duplicate
    engine.seedProfile("attila", [
      { content: "Name: Attila", category: "identity" },
    ]);
    expect(engine.stats("attila").totalNodes).toBe(2);
  });

  it("should mark seeded facts with source='seeded'", () => {
    engine.seedProfile("attila", [
      { content: "Name: Attila", category: "identity" },
    ]);
    const nodes = engine.query("attila");
    expect(nodes[0].source).toBe("seeded");
  });

  // ─── extractFromMessage ───────────────────────────────────────

  it("should extract a name from a message", () => {
    const nodes = engine.extractFromMessage("attila", "My name is Attila.");
    const nameNode = nodes.find((n) => n.content.includes("Attila"));
    expect(nameNode).toBeDefined();
    expect(nameNode?.category).toBe("identity");
  });

  it("should extract a goal from a message", () => {
    const nodes = engine.extractFromMessage(
      "attila",
      "I want to run AI models locally."
    );
    const goalNode = nodes.find((n) => n.category === "goal");
    expect(goalNode).toBeDefined();
    expect(goalNode?.content).toContain("run AI models locally");
  });

  it("should extract a preference from a message", () => {
    const nodes = engine.extractFromMessage("attila", "I prefer dark mode.");
    const prefNode = nodes.find((n) => n.category === "preference");
    expect(prefNode).toBeDefined();
  });

  it("should detect known tools in a message", () => {
    const nodes = engine.extractFromMessage(
      "attila",
      "I've been using proxmox and docker a lot lately."
    );
    const tools = nodes.filter((n) => n.category === "software");
    expect(tools.length).toBeGreaterThanOrEqual(2);
  });

  it("should extract an opinion from a message", () => {
    const nodes = engine.extractFromMessage(
      "attila",
      "I think local AI is the future."
    );
    const opinionNode = nodes.find((n) => n.category === "opinion");
    expect(opinionNode).toBeDefined();
  });

  it("should extract a role from a message", () => {
    const nodes = engine.extractFromMessage(
      "attila",
      "I'm a systems engineer."
    );
    const roleNode = nodes.find((n) => n.category === "identity");
    expect(roleNode).toBeDefined();
    expect(roleNode?.content).toContain("engineer");
  });

  it("should extract location from a message", () => {
    const nodes = engine.extractFromMessage(
      "attila",
      "I'm based in Budapest."
    );
    const locationNode = nodes.find((n) => n.category === "location");
    expect(locationNode).toBeDefined();
    expect(locationNode?.content).toContain("Budapest");
  });

  it("should return empty array for unrecognised messages", () => {
    const nodes = engine.extractFromMessage("attila", "The weather is nice today.");
    expect(nodes).toHaveLength(0);
  });

  // ─── query ────────────────────────────────────────────────────

  it("should return all nodes when no filters applied", () => {
    engine.addFact("attila", "Name: Attila", "identity");
    engine.addFact("attila", "Uses: proxmox", "software");
    const nodes = engine.query("attila");
    expect(nodes.length).toBe(2);
  });

  it("should filter by category", () => {
    engine.addFact("attila", "Name: Attila", "identity");
    engine.addFact("attila", "Uses: proxmox", "software");
    const nodes = engine.query("attila", { categories: ["identity"] });
    expect(nodes.length).toBe(1);
    expect(nodes[0].category).toBe("identity");
  });

  it("should filter by minConfidence", () => {
    engine.addFact("attila", "High confidence", "fact", { confidence: 0.9 });
    engine.addFact("attila", "Low confidence", "fact", { confidence: 0.2 });
    const nodes = engine.query("attila", { minConfidence: 0.5 });
    expect(nodes.length).toBe(1);
    expect(nodes[0].content).toBe("High confidence");
  });

  it("should filter by minImportance", () => {
    engine.addFact("attila", "Name: Attila", "identity", { importance: 1.0 });
    engine.addFact("attila", "Some fact", "fact", { importance: 0.2 });
    const nodes = engine.query("attila", { minImportance: 0.8 });
    expect(nodes.length).toBe(1);
    expect(nodes[0].content).toBe("Name: Attila");
  });

  it("should respect the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      engine.addFact("attila", `Fact ${i}`, "fact");
    }
    const nodes = engine.query("attila", { limit: 3 });
    expect(nodes.length).toBe(3);
  });

  it("should sort by importance * confidence descending", () => {
    engine.addFact("attila", "Low score", "fact", { confidence: 0.5, importance: 0.5 });
    engine.addFact("attila", "High score", "goal", { confidence: 1.0, importance: 1.0 });
    const nodes = engine.query("attila");
    expect(nodes[0].content).toBe("High score");
  });

  it("should return empty array for unknown userId", () => {
    const nodes = engine.query("nobody");
    expect(nodes).toHaveLength(0);
  });

  // ─── removeFact ───────────────────────────────────────────────

  it("should remove a fact by nodeId", () => {
    const node = engine.addFact("attila", "To be removed", "fact");
    const removed = engine.removeFact("attila", node.id);
    expect(removed).toBe(true);
    expect(engine.stats("attila").totalNodes).toBe(0);
  });

  it("should return false when removing a non-existent nodeId", () => {
    const removed = engine.removeFact("attila", "does-not-exist");
    expect(removed).toBe(false);
  });

  it("should return false when removing from unknown userId", () => {
    const removed = engine.removeFact("nobody", "any-id");
    expect(removed).toBe(false);
  });

  // ─── updateFact ───────────────────────────────────────────────

  it("should update content and set confidence to 1.0", () => {
    const node = engine.addFact("attila", "Old content", "fact", { confidence: 0.7 });
    const updated = engine.updateFact("attila", node.id, "New content");
    expect(updated).toBe(true);
    const nodes = engine.query("attila");
    expect(nodes[0].content).toBe("New content");
    expect(nodes[0].confidence).toBe(1.0);
  });

  it("should return false when updating a non-existent nodeId", () => {
    const updated = engine.updateFact("attila", "no-such-id", "content");
    expect(updated).toBe(false);
  });

  // ─── buildContextSummary ──────────────────────────────────────

  it("should return empty string when no facts exist", () => {
    const summary = engine.buildContextSummary("attila");
    expect(summary).toBe("");
  });

  it("should include the userId heading", () => {
    engine.addFact("attila", "Name: Attila", "identity", { confidence: 0.9 });
    const summary = engine.buildContextSummary("attila");
    expect(summary).toContain("## What I Know About attila");
  });

  it("should include high-confidence facts in summary", () => {
    engine.addFact("attila", "Name: Attila", "identity", { confidence: 0.9 });
    const summary = engine.buildContextSummary("attila");
    expect(summary).toContain("Name: Attila");
  });

  it("should exclude low-confidence facts from summary", () => {
    engine.addFact("attila", "Name: Attila", "identity", { confidence: 0.9 });
    engine.addFact("attila", "Weak fact", "fact", { confidence: 0.3 });
    const summary = engine.buildContextSummary("attila");
    expect(summary).not.toContain("Weak fact");
  });

  // ─── stats ────────────────────────────────────────────────────

  it("should count nodes by category", () => {
    engine.addFact("attila", "Name: Attila", "identity");
    engine.addFact("attila", "Uses: proxmox", "software");
    engine.addFact("attila", "Uses: docker", "software");
    const stats = engine.stats("attila");
    expect(stats.totalNodes).toBe(3);
    expect(stats.byCategory.identity).toBe(1);
    expect(stats.byCategory.software).toBe(2);
  });

  it("should return zeros for unknown user", () => {
    const stats = engine.stats("nobody");
    expect(stats.totalNodes).toBe(0);
    expect(stats.lastUpdated).toBe(0);
  });

  // ─── Persistence ──────────────────────────────────────────────

  it("should persist facts to disk and reload them", () => {
    engine.addFact("attila", "Name: Attila", "identity");
    engine.addFact("attila", "Uses: proxmox", "software");

    // Create a fresh engine pointing at the same dir — should reload
    const engine2 = new UserKnowledgeGraphEngine(tempDir);
    expect(engine2.stats("attila").totalNodes).toBe(2);
  });

  it("should persist seeded facts and reload them", () => {
    engine.seedProfile("attila", [
      { content: "Name: Attila", category: "identity" },
    ]);

    const engine2 = new UserKnowledgeGraphEngine(tempDir);
    const nodes = engine2.query("attila");
    expect(nodes.length).toBe(1);
    expect(nodes[0].source).toBe("seeded");
  });

  it("should handle missing persist directory gracefully on load", () => {
    // Engine with a non-existent dir should not throw
    const dir = path.join(os.tmpdir(), `ukg-empty-${Date.now()}`);
    expect(() => new UserKnowledgeGraphEngine(dir)).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
