/**
 * Vector Database Integration for OpenClaw.
 *
 * Provides a local vector store for RAG (Retrieval-Augmented Generation)
 * that integrates with the graph-based memory system. Uses cosine
 * similarity for nearest-neighbor search.
 *
 * Supports optional disk persistence so embeddings survive restarts.
 *
 * In production, this can be backed by external stores like
 * ChromaDB, Qdrant, Milvus, or Weaviate.
 */

import * as fs from "fs";
import * as path from "path";

export interface VectorEntry {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface VectorSearchResult {
  entry: VectorEntry;
  score: number; // cosine similarity 0-1
}

export interface VectorStoreConfig {
  dimensions: number; // embedding dimension (e.g. 384, 768, 1536)
  maxEntries: number;
  similarityThreshold: number; // minimum cosine similarity for results
  persistPath?: string;
  autoSaveInterval?: number; // ms between auto-saves, default 60000
}

export class VectorStore {
  private readonly config: VectorStoreConfig;
  private readonly entries = new Map<string, VectorEntry>();
  private dirty = false;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: VectorStoreConfig) {
    this.config = config;

    if (config.persistPath) {
      this.loadFromDisk();
    }

    if (config.persistPath) {
      const interval = config.autoSaveInterval ?? 60000;
      this.autoSaveTimer = setInterval(() => {
        if (this.dirty) this.saveToDisk();
      }, interval);
    }
  }

  add(
    id: string,
    content: string,
    embedding: number[],
    metadata: Record<string, unknown> = {}
  ): VectorEntry {
    if (embedding.length !== this.config.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.config.dimensions}, got ${embedding.length}`
      );
    }

    const entry: VectorEntry = {
      id,
      content,
      embedding: this.normalize(embedding),
      metadata,
      createdAt: Date.now(),
    };

    this.entries.set(id, entry);
    this.dirty = true;

    // Evict oldest entries if over limit
    if (this.entries.size > this.config.maxEntries) {
      this.evictOldest();
    }

    return entry;
  }

  get(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    const deleted = this.entries.delete(id);
    if (deleted) this.dirty = true;
    return deleted;
  }

  /**
   * Find the k nearest neighbors to a query embedding.
   */
  search(
    queryEmbedding: number[],
    k: number = 10,
    filter?: (entry: VectorEntry) => boolean
  ): VectorSearchResult[] {
    if (queryEmbedding.length !== this.config.dimensions) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.config.dimensions}, got ${queryEmbedding.length}`
      );
    }

    const normalizedQuery = this.normalize(queryEmbedding);
    const results: VectorSearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (filter && !filter(entry)) continue;

      const score = this.cosineSimilarity(normalizedQuery, entry.embedding);
      if (score >= this.config.similarityThreshold) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /**
   * Batch upsert entries.
   */
  batchAdd(
    entries: Array<{
      id: string;
      content: string;
      embedding: number[];
      metadata?: Record<string, unknown>;
    }>
  ): number {
    let added = 0;
    for (const e of entries) {
      this.add(e.id, e.content, e.embedding, e.metadata || {});
      added++;
    }
    return added;
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.dirty = true;
  }

  stats(): {
    size: number;
    dimensions: number;
    maxEntries: number;
    oldestAge: number;
  } {
    let oldestAge = 0;
    const now = Date.now();
    for (const entry of this.entries.values()) {
      const age = now - entry.createdAt;
      if (age > oldestAge) oldestAge = age;
    }

    return {
      size: this.entries.size,
      dimensions: this.config.dimensions,
      maxEntries: this.config.maxEntries,
      oldestAge,
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    // Vectors are pre-normalized, so dot product = cosine similarity
    return dot;
  }

  private normalize(vec: number[]): number[] {
    let mag = 0;
    for (const v of vec) mag += v * v;
    mag = Math.sqrt(mag);
    if (mag === 0) return vec;
    return vec.map((v) => v / mag);
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of this.entries) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.entries.delete(oldestId);
    }
  }

  // ─── Persistence ─────────────────────────────────────────────

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
        dimensions: this.config.dimensions,
        entries: Array.from(this.entries.values()),
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

  private loadFromDisk(): void {
    if (!this.config.persistPath) return;

    try {
      if (!fs.existsSync(this.config.persistPath)) return;

      const raw = fs.readFileSync(this.config.persistPath, "utf-8");
      const snapshot = JSON.parse(raw) as {
        version: number;
        dimensions: number;
        entries: VectorEntry[];
      };

      if (snapshot.version !== 1) return;
      if (snapshot.dimensions !== this.config.dimensions) return;

      for (const entry of snapshot.entries) {
        if (entry.embedding.length === this.config.dimensions) {
          this.entries.set(entry.id, entry);
        }
      }
    } catch {
      // Start fresh on corrupt data
    }
  }

  dispose(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    if (this.dirty) this.saveToDisk();
  }
}
