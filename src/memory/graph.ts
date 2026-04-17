import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  MemoryNode,
  MemoryEdge,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStats,
} from "./types";

export interface GraphMemoryConfig {
  maxNodes: number;
  importanceThreshold: number;
  autoSummarize: boolean;
  summarizeAfterTurns: number;
  persistPath?: string;
  autoSaveInterval?: number; // ms between auto-saves, default 30000
}

export class GraphMemory {
  private readonly config: GraphMemoryConfig;
  private readonly nodes = new Map<string, MemoryNode>();
  private readonly edges = new Map<string, MemoryEdge>();
  private readonly adjacency = new Map<string, Set<string>>(); // nodeId -> edgeIds
  private turnCount = 0;
  private dirty = false;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: GraphMemoryConfig) {
    this.config = config;

    // Load persisted state if available
    if (config.persistPath) {
      this.loadFromDisk();
    }

    // Auto-save periodically when dirty
    if (config.persistPath) {
      const interval = config.autoSaveInterval ?? 30000;
      this.autoSaveTimer = setInterval(() => {
        if (this.dirty) this.saveToDisk();
      }, interval);
    }
  }

  addNode(
    type: MemoryNode["type"],
    content: string,
    metadata: Record<string, unknown> = {},
    importance: number = 0.5
  ): MemoryNode {
    const node: MemoryNode = {
      id: crypto.randomUUID(),
      type,
      content,
      metadata,
      importance: Math.max(0, Math.min(1, importance)),
      accessCount: 0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.nodes.set(node.id, node);
    this.adjacency.set(node.id, new Set());
    this.dirty = true;

    // Trigger pruning if over limit
    if (this.nodes.size > this.config.maxNodes) {
      this.prune();
    }

    return node;
  }

  getNode(id: string): MemoryNode | undefined {
    const node = this.nodes.get(id);
    if (node) {
      node.accessCount++;
      node.lastAccessedAt = Date.now();
      // Boost importance on access (decaying boost)
      node.importance = Math.min(1, node.importance + 0.01);
    }
    return node;
  }

  removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove all edges connected to this node
    const edgeIds = this.adjacency.get(id) || new Set();
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        const otherId =
          edge.sourceId === id ? edge.targetId : edge.sourceId;
        this.adjacency.get(otherId)?.delete(edgeId);
        this.edges.delete(edgeId);
      }
    }

    this.adjacency.delete(id);
    this.nodes.delete(id);
    this.dirty = true;
    return true;
  }

  addEdge(
    sourceId: string,
    targetId: string,
    relation: string,
    weight: number = 1.0
  ): MemoryEdge | null {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      return null;
    }

    const edge: MemoryEdge = {
      id: crypto.randomUUID(),
      sourceId,
      targetId,
      relation,
      weight: Math.max(0, Math.min(1, weight)),
      createdAt: Date.now(),
    };

    this.edges.set(edge.id, edge);
    this.adjacency.get(sourceId)?.add(edge.id);
    this.adjacency.get(targetId)?.add(edge.id);
    this.dirty = true;

    return edge;
  }

  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    this.adjacency.get(edge.sourceId)?.delete(id);
    this.adjacency.get(edge.targetId)?.delete(id);
    this.edges.delete(id);
    this.dirty = true;
    return true;
  }

  query(query: MemoryQuery): MemoryQueryResult {
    let candidates = Array.from(this.nodes.values());

    // Filter by type
    if (query.types && query.types.length > 0) {
      candidates = candidates.filter((n) => query.types!.includes(n.type));
    }

    // Filter by minimum importance
    if (query.minImportance !== undefined) {
      candidates = candidates.filter(
        (n) => n.importance >= query.minImportance!
      );
    }

    // Text search (simple substring + word matching)
    if (query.text) {
      const terms = query.text.toLowerCase().split(/\s+/);
      candidates = candidates.filter((n) => {
        const content = n.content.toLowerCase();
        return terms.some((term) => content.includes(term));
      });

      // Score by relevance (number of matching terms)
      candidates.sort((a, b) => {
        const aContent = a.content.toLowerCase();
        const bContent = b.content.toLowerCase();
        const aScore = terms.filter((t) => aContent.includes(t)).length;
        const bScore = terms.filter((t) => bContent.includes(t)).length;
        return bScore - aScore || b.importance - a.importance;
      });
    } else {
      // Sort by importance then recency
      candidates.sort(
        (a, b) =>
          b.importance - a.importance ||
          b.lastAccessedAt - a.lastAccessedAt
      );
    }

    const limit = query.limit || 20;
    const resultNodes = candidates.slice(0, limit);

    // Mark access on returned nodes
    for (const node of resultNodes) {
      node.accessCount++;
      node.lastAccessedAt = Date.now();
    }

    // Collect edges between result nodes
    let resultEdges: MemoryEdge[] = [];
    if (query.includeEdges) {
      const nodeIds = new Set(resultNodes.map((n) => n.id));
      resultEdges = Array.from(this.edges.values()).filter(
        (e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId)
      );
    }

    return {
      nodes: resultNodes,
      edges: resultEdges,
      totalMatched: candidates.length,
    };
  }

  /**
   * Get all nodes connected to a given node (1-hop neighbors)
   */
  getNeighbors(nodeId: string): MemoryNode[] {
    const edgeIds = this.adjacency.get(nodeId);
    if (!edgeIds) return [];

    const neighbors: MemoryNode[] = [];
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      const otherId =
        edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
      const node = this.nodes.get(otherId);
      if (node) neighbors.push(node);
    }
    return neighbors;
  }

  /**
   * Traverse the graph from a starting node up to a given depth.
   */
  traverse(
    startId: string,
    maxDepth: number = 2
  ): { nodes: MemoryNode[]; edges: MemoryEdge[] } {
    const visited = new Set<string>();
    const resultNodes: MemoryNode[] = [];
    const resultEdges: MemoryEdge[] = [];
    const queue: Array<{ id: string; depth: number }> = [
      { id: startId, depth: 0 },
    ];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (node) resultNodes.push(node);

      const edgeIds = this.adjacency.get(id) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        resultEdges.push(edge);
        const otherId =
          edge.sourceId === id ? edge.targetId : edge.sourceId;
        if (!visited.has(otherId)) {
          queue.push({ id: otherId, depth: depth + 1 });
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * Record a turn and trigger summarization if threshold is reached.
   */
  recordTurn(): void {
    this.turnCount++;
    if (
      this.config.autoSummarize &&
      this.turnCount % this.config.summarizeAfterTurns === 0
    ) {
      this.summarize();
    }
  }

  /**
   * Importance-based pruning: remove lowest-importance nodes until under limit.
   */
  prune(): number {
    const threshold = this.config.importanceThreshold;
    const target = Math.floor(this.config.maxNodes * 0.8);
    let pruned = 0;

    // Calculate effective importance (base + access boost + recency boost)
    const scored = Array.from(this.nodes.values()).map((node) => ({
      node,
      effectiveImportance: this.calculateEffectiveImportance(node),
    }));

    scored.sort((a, b) => a.effectiveImportance - b.effectiveImportance);

    for (const { node, effectiveImportance } of scored) {
      if (this.nodes.size <= target) break;
      // Never prune high-importance nodes
      if (effectiveImportance >= threshold) continue;
      // Never prune summary nodes
      if (node.type === "summary") continue;

      this.removeNode(node.id);
      pruned++;
    }

    return pruned;
  }

  /**
   * Compress old low-access memories into summary nodes.
   */
  summarize(): MemoryNode[] {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const summaries: MemoryNode[] = [];

    // Group old, low-access nodes by type
    const groups = new Map<string, MemoryNode[]>();
    for (const node of this.nodes.values()) {
      if (
        node.lastAccessedAt < oneHourAgo &&
        node.accessCount < 3 &&
        node.type !== "summary"
      ) {
        const key = node.type;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(node);
      }
    }

    for (const [type, nodes] of groups) {
      if (nodes.length < 3) continue; // Only summarize if enough to compress

      const contentParts = nodes
        .map((n) => n.content)
        .slice(0, 10);
      const summaryContent = `[Auto-summary of ${nodes.length} ${type} memories] ${contentParts.join(" | ")}`;

      const avgImportance =
        nodes.reduce((sum, n) => sum + n.importance, 0) / nodes.length;

      const summaryNode = this.addNode(
        "summary",
        summaryContent,
        {
          summarizedCount: nodes.length,
          originalTypes: [type],
          summarizedAt: now,
        },
        Math.min(1, avgImportance + 0.1)
      );

      // Remove the summarized nodes
      for (const node of nodes) {
        this.removeNode(node.id);
      }

      summaries.push(summaryNode);
    }

    return summaries;
  }

  stats(): MemoryStats {
    const nodes = Array.from(this.nodes.values());
    const nodesByType: Record<string, number> = {};
    let totalImportance = 0;
    let oldestAge = 0;
    const now = Date.now();

    for (const node of nodes) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
      totalImportance += node.importance;
      const age = now - node.createdAt;
      if (age > oldestAge) oldestAge = age;
    }

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      nodesByType,
      averageImportance:
        nodes.length > 0 ? totalImportance / nodes.length : 0,
      oldestNodeAge: oldestAge,
    };
  }

  private calculateEffectiveImportance(node: MemoryNode): number {
    const now = Date.now();
    const ageHours = (now - node.createdAt) / 3600000;
    const recencyBoost = Math.max(
      0,
      1 - (now - node.lastAccessedAt) / (24 * 3600000)
    );
    const accessBoost = Math.min(0.2, node.accessCount * 0.02);

    // Decay importance over time, boost by access patterns
    const decayFactor = Math.max(0, 1 - ageHours / (168)); // decay over 1 week
    return (
      node.importance * decayFactor + recencyBoost * 0.2 + accessBoost
    );
  }

  // ─── Persistence ─────────────────────────────────────────────

  /**
   * Save the entire graph to disk as JSON.
   * File is written atomically (write to temp, then rename).
   */
  saveToDisk(): void {
    if (!this.config.persistPath) return;

    try {
      const dir = path.dirname(this.config.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      const snapshot = {
        version: 1,
        savedAt: Date.now(),
        turnCount: this.turnCount,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
      };

      const tmpPath = this.config.persistPath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(snapshot), {
        encoding: "utf-8",
        mode: 0o600,
      });
      fs.renameSync(tmpPath, this.config.persistPath);
      this.dirty = false;
    } catch {
      // Persistence failure is non-fatal
    }
  }

  /**
   * Load graph state from disk. Merges into the current (empty) graph.
   */
  private loadFromDisk(): void {
    if (!this.config.persistPath) return;

    try {
      if (!fs.existsSync(this.config.persistPath)) return;

      const raw = fs.readFileSync(this.config.persistPath, "utf-8");
      const snapshot = JSON.parse(raw) as {
        version: number;
        turnCount: number;
        nodes: MemoryNode[];
        edges: MemoryEdge[];
      };

      if (snapshot.version !== 1) return;

      this.turnCount = snapshot.turnCount || 0;

      for (const node of snapshot.nodes) {
        this.nodes.set(node.id, node);
        this.adjacency.set(node.id, new Set());
      }

      for (const edge of snapshot.edges) {
        if (this.nodes.has(edge.sourceId) && this.nodes.has(edge.targetId)) {
          this.edges.set(edge.id, edge);
          this.adjacency.get(edge.sourceId)?.add(edge.id);
          this.adjacency.get(edge.targetId)?.add(edge.id);
        }
      }
    } catch {
      // Start fresh on corrupt data
    }
  }

  /**
   * Stop the auto-save timer and flush to disk.
   */
  dispose(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    if (this.dirty) this.saveToDisk();
  }
}
