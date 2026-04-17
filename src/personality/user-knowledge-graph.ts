/**
 * UserKnowledgeGraph — Clara's Growing Understanding of a Person
 *
 * Builds a structured, persistent knowledge graph about a user across all
 * conversations. Every node is a fact Clara has learned. Facts are categorized,
 * weighted by confidence and importance, and stored with provenance.
 *
 * The graph is backed by both:
 *   1. A JSON snapshot for fast in-memory access (personality-state.json)
 *   2. The main memory graph (Neo4j / in-memory) for vector-augmented retrieval
 *
 * This is how Clara builds real understanding of Attila over time.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { UserKnowledgeNode, UserKnowledgeGraph } from "./clara-types";

export class UserKnowledgeGraphEngine {
  private graphs: Map<string, UserKnowledgeGraph> = new Map();
  private readonly persistDir: string;

  constructor(persistDir: string) {
    if (persistDir.includes("..")) {
      throw new Error(`Invalid persist path: ${persistDir}`);
    }
    this.persistDir = path.resolve(persistDir);
    this.load();
  }

  // ─── Graph Operations ────────────────────────────────────────

  /**
   * Add or update a knowledge node about a user.
   * Returns the node (created or updated).
   */
  addFact(
    userId: string,
    content: string,
    category: UserKnowledgeNode["category"],
    options: Partial<Pick<UserKnowledgeNode, "confidence" | "importance" | "source" | "relatedNodeIds">> = {}
  ): UserKnowledgeNode {
    const graph = this.ensureGraph(userId);

    // Dedup: check if very similar content already exists
    const existing = this.findSimilarNode(graph, content, category);
    if (existing) {
      existing.mentionCount++;
      existing.lastConfirmedAt = Date.now();
      // Boost confidence/importance when fact comes up again
      existing.confidence = Math.min(1.0, existing.confidence + 0.05);
      existing.importance = Math.min(1.0, existing.importance + 0.02);
      this.save(userId);
      return existing;
    }

    const node: UserKnowledgeNode = {
      id: `ukn-${crypto.randomUUID().slice(0, 8)}`,
      userId,
      category,
      content,
      confidence: options.confidence ?? 0.8,
      importance: options.importance ?? this.defaultImportance(category),
      learnedAt: Date.now(),
      lastConfirmedAt: Date.now(),
      mentionCount: 1,
      source: options.source ?? "stated",
      relatedNodeIds: options.relatedNodeIds ?? [],
    };

    graph.nodes.push(node);
    graph.lastUpdated = Date.now();
    this.save(userId);
    return node;
  }

  /**
   * Seed a user's graph with initial known facts (e.g. from ATTILA_SEED_PROFILE).
   */
  seedProfile(
    userId: string,
    facts: Array<{ content: string; category: UserKnowledgeNode["category"] }>
  ): void {
    const graph = this.ensureGraph(userId);
    for (const f of facts) {
      // Don't duplicate seeded facts
      const dup = graph.nodes.find(
        (n) => n.source === "seeded" && n.content === f.content
      );
      if (!dup) {
        this.addFact(userId, f.content, f.category, {
          source: "seeded",
          confidence: 1.0,
          importance: this.defaultImportance(f.category),
        });
      }
    }
  }

  /**
   * Parse a user message and extract new knowledge nodes automatically.
   * Uses pattern matching aligned with PersonalityEngine.extractFacts.
   */
  extractFromMessage(userId: string, text: string): UserKnowledgeNode[] {
    const added: UserKnowledgeNode[] = [];

    // Name patterns
    const nameMatch = text.match(/(?:[Mm]y name is|[Cc]all me|I'm|I am)\s+([A-Z][a-z]{1,30})/);
    if (nameMatch) {
      added.push(this.addFact(userId, `Name: ${nameMatch[1]}`, "identity", { confidence: 1.0, importance: 1.0 }));
    }

    // Hardware patterns
    const hardwareRe = /(?:I have|I'm using|I run|running on|my machine is)\s+(.{5,80}?)(?:\.|,|$)/gi;
    for (const m of text.matchAll(hardwareRe)) {
      const content = m[1].trim();
      if (content.length > 4) {
        added.push(this.addFact(userId, `Hardware/setup: ${content}`, "hardware", { confidence: 0.85 }));
      }
    }

    // Goals
    const goalRe = /I (?:want|need|plan|hope|intend|am trying) to (.{8,120})(?:\.|,|$)/gi;
    for (const m of text.matchAll(goalRe)) {
      added.push(this.addFact(userId, `Goal: ${m[1].trim()}`, "goal", { importance: 0.8 }));
    }

    // Preferences / likes
    const prefRe = /I (?:like|prefer|enjoy|love|hate|dislike)\s+(.{4,100})(?:\.|,|$)/gi;
    for (const m of text.matchAll(prefRe)) {
      added.push(this.addFact(userId, `Preference: ${m[1].trim()}`, "preference", { confidence: 0.9 }));
    }

    // Tools / software
    const knownTools = [
      "proxmox", "docker", "kubernetes", "ansible", "terraform", "ollama",
      "vllm", "llama.cpp", "pytorch", "neovim", "vim", "git", "zfs", "nginx",
      "postgresql", "redis", "mongodb", "openclaw", "nix", "arch linux",
    ];
    const lower = text.toLowerCase();
    for (const tool of knownTools) {
      if (lower.includes(tool)) {
        added.push(this.addFact(userId, `Uses: ${tool}`, "software", { confidence: 0.9, importance: 0.5 }));
      }
    }

    // Opinions
    const opinionRe = /I (?:think|believe|feel|know) (?:that )?(.{10,200})(?:\.|,|$)/gi;
    for (const m of text.matchAll(opinionRe)) {
      added.push(this.addFact(userId, `Opinion: ${m[1].trim()}`, "opinion", { confidence: 0.75, importance: 0.6 }));
    }

    // Role/identity
    const roleRe = /I(?:'m| am) (?:a |an )?(.+?(?:developer|engineer|admin|architect|researcher|sysadmin|founder))(?:\.|,|$)/i;
    const roleMatch = text.match(roleRe);
    if (roleMatch) {
      added.push(this.addFact(userId, `Role: ${roleMatch[1].trim()}`, "identity", { confidence: 0.9, importance: 0.9 }));
    }

    // Location
    const locationRe = /I(?:'m| am| live)? (?:based |located )?in (.{3,60})(?:\.|,|$)/i;
    const locationMatch = text.match(locationRe);
    if (locationMatch) {
      added.push(this.addFact(userId, `Location: ${locationMatch[1].trim()}`, "location", { confidence: 0.85, importance: 0.6 }));
    }

    return added;
  }

  /**
   * Query knowledge nodes about a user, optionally filtered by category.
   */
  query(
    userId: string,
    options: {
      categories?: UserKnowledgeNode["category"][];
      minConfidence?: number;
      minImportance?: number;
      limit?: number;
    } = {}
  ): UserKnowledgeNode[] {
    const graph = this.graphs.get(userId);
    if (!graph) return [];

    let nodes = graph.nodes;

    if (options.categories) {
      nodes = nodes.filter((n) => options.categories!.includes(n.category));
    }
    if (options.minConfidence !== undefined) {
      nodes = nodes.filter((n) => n.confidence >= options.minConfidence!);
    }
    if (options.minImportance !== undefined) {
      nodes = nodes.filter((n) => n.importance >= options.minImportance!);
    }

    // Sort by importance * confidence descending
    nodes = [...nodes].sort((a, b) => b.importance * b.confidence - a.importance * a.confidence);

    return options.limit ? nodes.slice(0, options.limit) : nodes;
  }

  /**
   * Get the full graph for a user.
   */
  getGraph(userId: string): UserKnowledgeGraph | undefined {
    return this.graphs.get(userId);
  }

  /**
   * Build a Clara-facing summary of what she knows about a user.
   * Injected into system prompts so Clara can address Attila naturally.
   */
  buildContextSummary(userId: string, limit = 20): string {
    const nodes = this.query(userId, { minConfidence: 0.5, limit });
    if (nodes.length === 0) return "";

    const sections: Record<string, string[]> = {};
    for (const node of nodes) {
      if (!sections[node.category]) sections[node.category] = [];
      sections[node.category].push(node.content);
    }

    const lines: string[] = [`## What I Know About ${userId}`];
    for (const [cat, items] of Object.entries(sections)) {
      lines.push(`### ${capitalize(cat)}`);
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * Remove a specific node (e.g. if user corrects a wrong fact).
   */
  removeFact(userId: string, nodeId: string): boolean {
    const graph = this.graphs.get(userId);
    if (!graph) return false;

    const before = graph.nodes.length;
    graph.nodes = graph.nodes.filter((n) => n.id !== nodeId);

    if (graph.nodes.length < before) {
      this.save(userId);
      return true;
    }
    return false;
  }

  /**
   * Update the content of a fact (for user corrections).
   */
  updateFact(userId: string, nodeId: string, newContent: string): boolean {
    const graph = this.graphs.get(userId);
    if (!graph) return false;

    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return false;

    node.content = newContent;
    node.lastConfirmedAt = Date.now();
    node.confidence = 1.0; // user confirmed it
    this.save(userId);
    return true;
  }

  /**
   * Stats about the knowledge graph for a user.
   */
  stats(userId: string): { totalNodes: number; byCategory: Record<string, number>; lastUpdated: number } {
    const graph = this.graphs.get(userId);
    if (!graph) return { totalNodes: 0, byCategory: {}, lastUpdated: 0 };

    const byCategory: Record<string, number> = {};
    for (const node of graph.nodes) {
      byCategory[node.category] = (byCategory[node.category] || 0) + 1;
    }

    return {
      totalNodes: graph.nodes.length,
      byCategory,
      lastUpdated: graph.lastUpdated,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  private ensureGraph(userId: string): UserKnowledgeGraph {
    if (!this.graphs.has(userId)) {
      this.graphs.set(userId, {
        userId,
        nodes: [],
        lastUpdated: Date.now(),
        totalConversations: 0,
      });
    }
    return this.graphs.get(userId)!;
  }

  private findSimilarNode(
    graph: UserKnowledgeGraph,
    content: string,
    category: UserKnowledgeNode["category"]
  ): UserKnowledgeNode | undefined {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const norm = normalize(content);

    return graph.nodes.find(
      (n) =>
        n.category === category &&
        (normalize(n.content) === norm ||
          // Levenshtein-like: content is substring of existing or vice versa
          (norm.length > 10 && normalize(n.content).includes(norm.slice(0, Math.floor(norm.length * 0.7)))))
    );
  }

  private defaultImportance(category: UserKnowledgeNode["category"]): number {
    const weights: Record<UserKnowledgeNode["category"], number> = {
      identity: 1.0,
      hardware: 0.7,
      software: 0.6,
      goal: 0.85,
      preference: 0.7,
      opinion: 0.65,
      relationship: 0.8,
      event: 0.6,
      skill: 0.75,
      interest: 0.7,
      location: 0.6,
      habit: 0.65,
      fact: 0.5,
    };
    return weights[category] ?? 0.5;
  }

  // ─── Persistence ─────────────────────────────────────────────

  private filePath(userId: string): string {
    return path.join(this.persistDir, `user-knowledge-${userId}.json`);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.persistDir)) return;
      const files = fs.readdirSync(this.persistDir).filter((f) => f.startsWith("user-knowledge-"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.persistDir, file), "utf-8");
          const graph = JSON.parse(raw) as UserKnowledgeGraph;
          this.graphs.set(graph.userId, graph);
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // Nothing to load
    }
  }

  private save(userId: string): void {
    try {
      const graph = this.graphs.get(userId);
      if (!graph) return;

      if (!fs.existsSync(this.persistDir)) {
        fs.mkdirSync(this.persistDir, { recursive: true, mode: 0o700 });
      }

      fs.writeFileSync(this.filePath(userId), JSON.stringify(graph, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch {
      // Silently fail — don't crash on disk errors
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
