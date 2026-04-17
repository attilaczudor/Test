/**
 * Council Memory Manager — Per-Member Persistent Memory
 *
 * Each council member has its own namespaced:
 *   - Vector collection (embeddings for semantic search)
 *   - Graph memory tag (knowledge graph nodes)
 *   - RAG namespace (chunked documents)
 *   - LoRA adapter tracking
 *
 * Memory survives model swaps — swap the model, keep all learned knowledge.
 * This is what makes the council an "individual person" with long-term memory.
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import {
  MemberMemory,
  MemberMetrics,
  CouncilMemoryConfig,
  createDefaultMemory,
  createDefaultMetrics,
} from "./types";

export interface MemberMemoryState {
  memberId: string;
  memberName: string;
  tier: number;
  branch?: string;
  memory: MemberMemory;
  metrics: MemberMetrics;
  knowledge: KnowledgeEntry[];   // Accumulated knowledge from interactions
}

export interface KnowledgeEntry {
  id: string;
  content: string;
  source: "interaction" | "training" | "document" | "council";
  importance: number;            // 0-1
  timestamp: number;
  tags: string[];
}

export interface CouncilMemoryStats {
  totalMembers: number;
  totalKnowledgeEntries: number;
  totalInteractions: number;
  oldestMemory: number;
  memberStats: Array<{
    memberId: string;
    name: string;
    tier: number;
    knowledgeCount: number;
    interactions: number;
    lastActive: number;
    loraAdapter?: string;
  }>;
}

/**
 * Manages persistent memory for all council members.
 * Memory is stored per-member and survives model swaps.
 */
export class CouncilMemoryManager extends EventEmitter {
  private readonly members = new Map<string, MemberMemoryState>();
  private readonly persistPath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config?: CouncilMemoryConfig) {
    super();
    this.persistPath = config?.persistPath || "./data/council-memory";
    this.loadFromDisk();
    // Auto-save every 30 seconds
    this.saveTimer = setInterval(() => {
      if (this.dirty) this.saveToDisk();
    }, 30000);
  }

  // ─── Member Registration ────────────────────────────────────

  /**
   * Register a member's memory. If this member already has stored
   * memory (from a previous model), it's loaded automatically.
   */
  registerMember(
    memberId: string,
    memberName: string,
    tier: number,
    branch?: string
  ): MemberMemoryState {
    // Check if we already have memory for this member
    const existing = this.members.get(memberId);
    if (existing) {
      existing.memberName = memberName;
      existing.tier = tier;
      existing.branch = branch;
      return existing;
    }

    const state: MemberMemoryState = {
      memberId,
      memberName,
      tier,
      branch,
      memory: createDefaultMemory(memberId),
      metrics: createDefaultMetrics(),
      knowledge: [],
    };

    this.members.set(memberId, state);
    this.dirty = true;
    this.emit("memberRegistered", { memberId, memberName, tier });
    return state;
  }

  /**
   * Unregister a member — does NOT delete their memory.
   * Memory persists for potential future re-use.
   */
  unregisterMember(memberId: string): void {
    // We keep the data, just mark as inactive
    const state = this.members.get(memberId);
    if (state) {
      state.memory.lastActiveAt = Date.now();
      this.dirty = true;
    }
  }

  // ─── Knowledge Management ───────────────────────────────────

  /**
   * Record a piece of knowledge for a member.
   * This is called after each interaction to build long-term memory.
   */
  addKnowledge(
    memberId: string,
    content: string,
    source: KnowledgeEntry["source"],
    importance: number = 0.5,
    tags: string[] = []
  ): KnowledgeEntry | null {
    const state = this.members.get(memberId);
    if (!state) return null;

    const entry: KnowledgeEntry = {
      id: `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: content.slice(0, 2000), // Cap at 2k chars
      source,
      importance: Math.max(0, Math.min(1, importance)),
      timestamp: Date.now(),
      tags,
    };

    state.knowledge.push(entry);
    state.memory.totalInteractions++;
    state.memory.lastActiveAt = Date.now();

    // Cap knowledge at 1000 entries per member — prune lowest importance
    if (state.knowledge.length > 1000) {
      state.knowledge.sort((a, b) => b.importance - a.importance);
      state.knowledge = state.knowledge.slice(0, 800);
    }

    this.dirty = true;
    this.emit("knowledgeAdded", { memberId, entryId: entry.id });
    return entry;
  }

  /**
   * Search a member's knowledge base by text.
   */
  searchKnowledge(
    memberId: string,
    query: string,
    limit: number = 10
  ): KnowledgeEntry[] {
    const state = this.members.get(memberId);
    if (!state) return [];

    const terms = query.toLowerCase().split(/\s+/);
    const scored = state.knowledge.map((entry) => {
      const lower = entry.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) score += 1;
      }
      // Boost by importance and recency
      score += entry.importance * 0.5;
      score += Math.max(0, 1 - (Date.now() - entry.timestamp) / (30 * 24 * 60 * 60 * 1000)) * 0.3;
      return { entry, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  /**
   * Get all knowledge for a member, used to build context for LLM calls.
   */
  getMemberContext(memberId: string, maxEntries: number = 20): string {
    const state = this.members.get(memberId);
    if (!state || state.knowledge.length === 0) return "";

    // Get the most important recent knowledge
    const sorted = [...state.knowledge]
      .sort((a, b) => {
        const recencyA = Math.max(0, 1 - (Date.now() - a.timestamp) / (7 * 24 * 60 * 60 * 1000));
        const recencyB = Math.max(0, 1 - (Date.now() - b.timestamp) / (7 * 24 * 60 * 60 * 1000));
        return (b.importance + recencyB) - (a.importance + recencyA);
      })
      .slice(0, maxEntries);

    return sorted
      .map((k) => `[${k.source}] ${k.content}`)
      .join("\n");
  }

  // ─── Metrics Tracking ───────────────────────────────────────

  /**
   * Record the result of a query for metrics tracking.
   */
  recordQuery(
    memberId: string,
    responseTimeMs: number,
    confidence: number,
    isError: boolean
  ): void {
    const state = this.members.get(memberId);
    if (!state) return;

    const m = state.metrics;
    m.totalQueries++;

    // Running average for response time
    m.avgResponseTimeMs = m.avgResponseTimeMs === 0
      ? responseTimeMs
      : m.avgResponseTimeMs * 0.9 + responseTimeMs * 0.1;

    // Running average for confidence
    if (!isError) {
      m.avgConfidence = m.avgConfidence === 0
        ? confidence
        : m.avgConfidence * 0.9 + confidence * 0.1;
    }

    if (isError) {
      m.errorCount++;
    }
    m.errorRate = m.totalQueries > 0 ? m.errorCount / m.totalQueries : 0;

    // Track evaluation history (ring buffer of last 50)
    m.evaluationHistory.push(isError ? 0 : confidence);
    if (m.evaluationHistory.length > 50) {
      m.evaluationHistory.shift();
    }
    m.lastEvaluationScore = confidence;

    this.dirty = true;
  }

  /**
   * Check if a member's model should be auto-swapped based on metrics.
   * Returns true if performance is degrading.
   */
  shouldRecommendSwap(memberId: string): boolean {
    const state = this.members.get(memberId);
    if (!state || state.metrics.totalQueries < 10) return false;

    const m = state.metrics;
    // Recommend swap if error rate is high or avg confidence is very low
    return m.errorRate > 0.3 || m.avgConfidence < 0.3;
  }

  // ─── Model Swap Support ─────────────────────────────────────

  /**
   * Called when a model is swapped on a member. Records the swap
   * and preserves all memory/knowledge.
   */
  recordModelSwap(memberId: string, oldModel: string, newModel: string): void {
    const state = this.members.get(memberId);
    if (!state) return;

    // Add knowledge entry about the swap
    this.addKnowledge(
      memberId,
      `Model swapped from ${oldModel} to ${newModel}`,
      "council",
      0.8,
      ["model-swap"]
    );

    // Reset metrics (new model, fresh start) but keep knowledge
    state.metrics = createDefaultMetrics();
    this.dirty = true;
    this.emit("modelSwapped", { memberId, oldModel, newModel });
  }

  // ─── LoRA Tracking ──────────────────────────────────────────

  setLoraAdapter(memberId: string, adapterId: string): void {
    const state = this.members.get(memberId);
    if (!state) return;
    state.memory.loraAdapterId = adapterId;
    this.dirty = true;
  }

  getLoraAdapter(memberId: string): string | undefined {
    return this.members.get(memberId)?.memory.loraAdapterId;
  }

  // ─── State Access ───────────────────────────────────────────

  getMemberState(memberId: string): MemberMemoryState | undefined {
    return this.members.get(memberId);
  }

  getMemory(memberId: string): MemberMemory | undefined {
    return this.members.get(memberId)?.memory;
  }

  getMetrics(memberId: string): MemberMetrics | undefined {
    return this.members.get(memberId)?.metrics;
  }

  getAllMembers(): MemberMemoryState[] {
    return Array.from(this.members.values());
  }

  // ─── Stats ──────────────────────────────────────────────────

  getStats(): CouncilMemoryStats {
    const members = this.getAllMembers();
    let totalKnowledge = 0;
    let totalInteractions = 0;
    let oldest = Date.now();

    const memberStats = members.map((m) => {
      totalKnowledge += m.knowledge.length;
      totalInteractions += m.memory.totalInteractions;
      if (m.knowledge.length > 0) {
        const firstTs = m.knowledge[0].timestamp;
        if (firstTs < oldest) oldest = firstTs;
      }
      return {
        memberId: m.memberId,
        name: m.memberName,
        tier: m.tier,
        knowledgeCount: m.knowledge.length,
        interactions: m.memory.totalInteractions,
        lastActive: m.memory.lastActiveAt,
        loraAdapter: m.memory.loraAdapterId,
      };
    });

    return {
      totalMembers: members.length,
      totalKnowledgeEntries: totalKnowledge,
      totalInteractions,
      oldestMemory: members.length > 0 ? oldest : 0,
      memberStats,
    };
  }

  // ─── Persistence ────────────────────────────────────────────

  saveToDisk(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: Record<string, MemberMemoryState> = {};
      for (const [id, state] of this.members) {
        data[id] = state;
      }

      const filePath = path.join(this.persistPath, "council-memory.json");
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch {
      // Non-fatal — memory continues in-memory
    }
  }

  loadFromDisk(): void {
    try {
      const filePath = path.join(this.persistPath, "council-memory.json");
      if (!fs.existsSync(filePath)) return;

      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, MemberMemoryState>;

      for (const [id, state] of Object.entries(data)) {
        this.members.set(id, state);
      }
    } catch {
      // Non-fatal — start fresh
    }
  }

  dispose(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.saveToDisk();
  }
}
