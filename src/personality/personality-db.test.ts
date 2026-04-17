/**
 * Tests for PersonalityDb — database-backed personality storage.
 *
 * Tests the in-memory fallback paths (no SQL/Neo4j/Qdrant configured).
 * Database-backed paths are integration-level and require running services.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PersonalityDb, AiPersonalityRecord, UserProfileRecord } from "./personality-db";
import { UserKnowledgeNode } from "./clara-types";

function makePersonality(overrides: Partial<AiPersonalityRecord> = {}): AiPersonalityRecord {
  const now = Date.now();
  return {
    id: "clara-v2",
    name: "Clara",
    pronouns: "she",
    version: "2.0.0",
    birthdate: "2025-12-01",
    origin: "Born from the council architecture of OpenClaw",
    personality: "Friendly, curious, technically precise",
    favorites: { topic: "distributed systems", hobby: "exploring codebases" },
    opinions: ["Local-first is the future", "Type safety matters"],
    selfFacts: ["I was built on the council-gated escalation pattern"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeUserProfile(overrides: Partial<UserProfileRecord> = {}): UserProfileRecord {
  const now = Date.now();
  return {
    userId: "attila",
    displayName: "Attila",
    technicalLevel: "expert",
    preferredStyle: "friendly-technical",
    knownFacts: ["Runs Proxmox homelab", "Uses OpenClaw"],
    hardware: ["proxmox", "24-core cpu", "256gb ram"],
    tools: ["vscode", "docker", "ollama", "llama.cpp"],
    goals: ["Build autonomous AI agent"],
    conversationCount: 42,
    firstInteraction: now - 86400000,
    lastInteraction: now,
    createdAt: now - 86400000,
    updatedAt: now,
    ...overrides,
  };
}

function makeKnowledgeNode(overrides: Partial<UserKnowledgeNode> = {}): UserKnowledgeNode {
  const now = Date.now();
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    userId: "attila",
    category: "hardware",
    content: "Runs a 24-core Proxmox server with 256GB RAM",
    confidence: 1.0,
    importance: 0.9,
    learnedAt: now,
    lastConfirmedAt: now,
    mentionCount: 3,
    source: "stated",
    relatedNodeIds: [],
    ...overrides,
  };
}

describe("PersonalityDb", () => {
  let db: PersonalityDb;

  beforeEach(() => {
    db = new PersonalityDb();
  });

  describe("initialization", () => {
    it("creates with default empty config", () => {
      expect(db).toBeInstanceOf(PersonalityDb);
    });

    it("creates with custom config", () => {
      const customDb = new PersonalityDb({
        sqlUrl: "http://localhost:3306",
        neo4jUrl: "http://localhost:7474",
        qdrantUrl: "http://localhost:6333",
      });
      expect(customDb).toBeInstanceOf(PersonalityDb);
    });

    it("initialize() is idempotent", async () => {
      await db.initialize();
      await db.initialize();
      // Should not throw
    });
  });

  describe("AI Personality CRUD", () => {
    beforeEach(async () => {
      await db.initialize();
    });

    it("saves and retrieves a personality", async () => {
      const record = makePersonality();
      await db.savePersonality(record);
      const result = await db.getPersonality("clara-v2");
      expect(result).toEqual(record);
    });

    it("returns null for non-existent personality", async () => {
      const result = await db.getPersonality("nonexistent");
      expect(result).toBeNull();
    });

    it("updates an existing personality", async () => {
      const record = makePersonality();
      await db.savePersonality(record);

      const updated = { ...record, name: "Aria", pronouns: "they" as const, updatedAt: Date.now() };
      await db.savePersonality(updated);

      const result = await db.getPersonality("clara-v2");
      expect(result?.name).toBe("Aria");
      expect(result?.pronouns).toBe("they");
    });

    it("stores multiple personalities independently", async () => {
      const clara = makePersonality({ id: "clara-v2", name: "Clara" });
      const aria = makePersonality({ id: "aria-v1", name: "Aria", pronouns: "they" });

      await db.savePersonality(clara);
      await db.savePersonality(aria);

      const r1 = await db.getPersonality("clara-v2");
      const r2 = await db.getPersonality("aria-v1");
      expect(r1?.name).toBe("Clara");
      expect(r2?.name).toBe("Aria");
    });

    it("preserves all personality fields", async () => {
      const record = makePersonality();
      await db.savePersonality(record);
      const result = await db.getPersonality("clara-v2");

      expect(result?.version).toBe("2.0.0");
      expect(result?.birthdate).toBe("2025-12-01");
      expect(result?.origin).toContain("council architecture");
      expect(result?.favorites).toHaveProperty("topic");
      expect(result?.opinions).toHaveLength(2);
      expect(result?.selfFacts).toHaveLength(1);
    });

    it("supports all pronoun types", async () => {
      for (const pronouns of ["she", "he", "they"] as const) {
        const record = makePersonality({ id: `test-${pronouns}`, pronouns });
        await db.savePersonality(record);
        const result = await db.getPersonality(`test-${pronouns}`);
        expect(result?.pronouns).toBe(pronouns);
      }
    });
  });

  describe("User Profile CRUD", () => {
    beforeEach(async () => {
      await db.initialize();
    });

    it("saves and retrieves a user profile", async () => {
      const profile = makeUserProfile();
      await db.saveUserProfile(profile);
      const result = await db.getUserProfile("attila");
      expect(result).toEqual(profile);
    });

    it("returns null for non-existent user", async () => {
      const result = await db.getUserProfile("nonexistent");
      expect(result).toBeNull();
    });

    it("updates an existing user profile", async () => {
      const profile = makeUserProfile();
      await db.saveUserProfile(profile);

      const updated = {
        ...profile,
        displayName: "Attila C.",
        conversationCount: 43,
        updatedAt: Date.now(),
      };
      await db.saveUserProfile(updated);

      const result = await db.getUserProfile("attila");
      expect(result?.displayName).toBe("Attila C.");
      expect(result?.conversationCount).toBe(43);
    });

    it("stores multiple users independently", async () => {
      const attila = makeUserProfile({ userId: "attila", displayName: "Attila" });
      const bob = makeUserProfile({ userId: "bob", displayName: "Bob", technicalLevel: "beginner" });

      await db.saveUserProfile(attila);
      await db.saveUserProfile(bob);

      const r1 = await db.getUserProfile("attila");
      const r2 = await db.getUserProfile("bob");
      expect(r1?.displayName).toBe("Attila");
      expect(r2?.displayName).toBe("Bob");
      expect(r2?.technicalLevel).toBe("beginner");
    });

    it("preserves array fields", async () => {
      const profile = makeUserProfile();
      await db.saveUserProfile(profile);
      const result = await db.getUserProfile("attila");

      expect(result?.hardware).toContain("proxmox");
      expect(result?.tools).toContain("llama.cpp");
      expect(result?.goals).toContain("Build autonomous AI agent");
      expect(result?.knownFacts).toHaveLength(2);
    });
  });

  describe("Knowledge Graph", () => {
    beforeEach(async () => {
      await db.initialize();
    });

    it("saves and retrieves a knowledge node", async () => {
      const node = makeKnowledgeNode({ id: "hw-1" });
      await db.saveKnowledgeNode(node);
      const nodes = await db.getKnowledgeNodes("attila");
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("hw-1");
    });

    it("returns empty array for user with no nodes", async () => {
      const nodes = await db.getKnowledgeNodes("nonexistent");
      expect(nodes).toEqual([]);
    });

    it("saves multiple nodes for the same user", async () => {
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "hw-1", category: "hardware" }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "sw-1", category: "software", content: "Uses Docker and Kubernetes" }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "goal-1", category: "goal", content: "Build autonomous AI agent" }));

      const nodes = await db.getKnowledgeNodes("attila");
      expect(nodes).toHaveLength(3);
    });

    it("updates an existing node", async () => {
      const node = makeKnowledgeNode({ id: "hw-1", mentionCount: 1 });
      await db.saveKnowledgeNode(node);

      const updated = { ...node, mentionCount: 5, lastConfirmedAt: Date.now() };
      await db.saveKnowledgeNode(updated);

      const nodes = await db.getKnowledgeNodes("attila");
      expect(nodes).toHaveLength(1);
      expect(nodes[0].mentionCount).toBe(5);
    });

    it("removes a knowledge node", async () => {
      const node = makeKnowledgeNode({ id: "hw-1" });
      await db.saveKnowledgeNode(node);
      expect(await db.getKnowledgeNodes("attila")).toHaveLength(1);

      const removed = await db.removeKnowledgeNode("attila", "hw-1");
      expect(removed).toBe(true);
      expect(await db.getKnowledgeNodes("attila")).toHaveLength(0);
    });

    it("remove returns true even for non-existent node", async () => {
      const result = await db.removeKnowledgeNode("attila", "nonexistent");
      expect(result).toBe(true);
    });

    it("isolates nodes between different users", async () => {
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "a-1", userId: "attila" }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "b-1", userId: "bob" }));

      const attilaNodes = await db.getKnowledgeNodes("attila");
      const bobNodes = await db.getKnowledgeNodes("bob");
      expect(attilaNodes).toHaveLength(1);
      expect(bobNodes).toHaveLength(1);
      expect(attilaNodes[0].id).toBe("a-1");
      expect(bobNodes[0].id).toBe("b-1");
    });

    it("preserves node categories", async () => {
      const categories = ["identity", "hardware", "software", "goal", "preference", "skill", "interest"] as const;
      for (const category of categories) {
        await db.saveKnowledgeNode(makeKnowledgeNode({ id: `cat-${category}`, category }));
      }
      const nodes = await db.getKnowledgeNodes("attila");
      expect(nodes).toHaveLength(categories.length);
      const cats = nodes.map((n) => n.category);
      for (const cat of categories) {
        expect(cats).toContain(cat);
      }
    });

    it("preserves relatedNodeIds", async () => {
      const node = makeKnowledgeNode({ id: "hw-1", relatedNodeIds: ["sw-1", "goal-1"] });
      await db.saveKnowledgeNode(node);
      const nodes = await db.getKnowledgeNodes("attila");
      expect(nodes[0].relatedNodeIds).toEqual(["sw-1", "goal-1"]);
    });
  });

  describe("Knowledge Graph (full graph)", () => {
    beforeEach(async () => {
      await db.initialize();
    });

    it("returns a full knowledge graph", async () => {
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n1" }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n2" }));

      const graph = await db.getKnowledgeGraph("attila");
      expect(graph.userId).toBe("attila");
      expect(graph.nodes).toHaveLength(2);
      expect(graph.lastUpdated).toBeGreaterThan(0);
    });

    it("returns empty graph for unknown user", async () => {
      const graph = await db.getKnowledgeGraph("nobody");
      expect(graph.userId).toBe("nobody");
      expect(graph.nodes).toHaveLength(0);
    });
  });

  describe("Semantic Search (in-memory fallback)", () => {
    beforeEach(async () => {
      await db.initialize();
    });

    it("finds nodes by substring match", async () => {
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n1", content: "Runs a Proxmox homelab server" }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n2", content: "Uses Docker for containerization" }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n3", content: "Proxmox cluster with 3 nodes" }));

      const results = await db.semanticSearch("attila", "proxmox");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.content.toLowerCase().includes("proxmox"))).toBe(true);
    });

    it("returns empty for no matches", async () => {
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n1", content: "Runs Docker" }));
      const results = await db.semanticSearch("attila", "kubernetes");
      expect(results).toHaveLength(0);
    });

    it("is case-insensitive", async () => {
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n1", content: "Uses LLAMA.CPP for inference" }));
      const results = await db.semanticSearch("attila", "llama.cpp");
      expect(results).toHaveLength(1);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await db.saveKnowledgeNode(makeKnowledgeNode({ id: `n${i}`, content: `Fact ${i} about proxmox` }));
      }
      const results = await db.semanticSearch("attila", "proxmox", 3);
      expect(results).toHaveLength(3);
    });

    it("sorts by importance * confidence descending", async () => {
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n1", content: "low proxmox fact", importance: 0.3, confidence: 0.5 }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n2", content: "high proxmox fact", importance: 0.9, confidence: 1.0 }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "n3", content: "mid proxmox fact", importance: 0.6, confidence: 0.8 }));

      const results = await db.semanticSearch("attila", "proxmox");
      expect(results[0].id).toBe("n2"); // highest score
      expect(results[results.length - 1].id).toBe("n1"); // lowest score
    });
  });

  describe("Cross-concern operations", () => {
    beforeEach(async () => {
      await db.initialize();
    });

    it("personality + user + knowledge work together", async () => {
      // Save personality
      await db.savePersonality(makePersonality());
      // Save user profile
      await db.saveUserProfile(makeUserProfile());
      // Save knowledge nodes
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "hw-1" }));
      await db.saveKnowledgeNode(makeKnowledgeNode({ id: "sw-1", category: "software" }));

      // All retrievable
      expect(await db.getPersonality("clara-v2")).not.toBeNull();
      expect(await db.getUserProfile("attila")).not.toBeNull();
      expect(await db.getKnowledgeNodes("attila")).toHaveLength(2);
    });

    it("separate db instances have isolated state", async () => {
      const db2 = new PersonalityDb();
      await db2.initialize();

      await db.savePersonality(makePersonality());
      const result = await db2.getPersonality("clara-v2");
      expect(result).toBeNull();
    });
  });
});
