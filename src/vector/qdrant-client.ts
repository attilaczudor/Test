/**
 * Qdrant Vector Database Client — Remote Vector Store Backend
 *
 * Connects to a Qdrant instance running in a dedicated VM/container
 * over its REST API. Implements the same interface as the local
 * VectorStore so it's a drop-in replacement.
 *
 * Qdrant runs on port 6333 (REST) / 6334 (gRPC).
 * This client uses the REST API for simplicity — no native deps needed.
 *
 * VM Setup: See deploy/setup-databases.sh for automated provisioning.
 */

import { VectorEntry, VectorSearchResult, VectorStoreConfig } from "./vector-store.js";

/** Shape of a Qdrant REST API JSON response. */
interface QdrantPoint {
  id: number;
  payload?: {
    original_id?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    createdAt?: number;
  };
  vector?: number[];
  score?: number;
}

interface QdrantResponse {
  result?:
    | {
        points_count?: number;
        points?: QdrantPoint[];
        [key: string]: unknown;
      }
    | QdrantPoint[]
    | null;
}

export interface QdrantConfig extends VectorStoreConfig {
  /** Qdrant REST endpoint, e.g. "http://10.0.0.50:6333" */
  qdrantUrl: string;
  /** Collection name (auto-created if missing) */
  collectionName: string;
  /** API key for Qdrant Cloud or secured instances */
  apiKey?: string;
  /** Timeout for HTTP requests in ms */
  timeoutMs?: number;
}

export class QdrantClient {
  private readonly config: QdrantConfig;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private initialized = false;
  private entryCount = 0;

  constructor(config: QdrantConfig) {
    this.config = config;
    this.baseUrl = config.qdrantUrl.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      ...(config.apiKey ? { "api-key": config.apiKey } : {}),
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  /**
   * Ensure collection exists with correct dimensions and distance metric.
   * Called lazily on first operation.
   */
  async ensureCollection(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Check if collection exists
      const res = await this.request("GET", `/collections/${this.config.collectionName}`);
      if (res.status === 200) {
        const data = (await res.json()) as QdrantResponse;
        const result = data.result && !Array.isArray(data.result) ? data.result : null;
        this.entryCount = result?.points_count ?? 0;
        this.initialized = true;
        return;
      }
    } catch {
      // Collection doesn't exist — create it
    }

    await this.request("PUT", `/collections/${this.config.collectionName}`, {
      vectors: {
        size: this.config.dimensions,
        distance: "Cosine",
      },
      optimizers_config: {
        default_segment_number: 2,
      },
      // Enable payload indexing for metadata filtering
      on_disk_payload: true,
    });

    this.initialized = true;
  }

  // ─── VectorStore Interface ──────────────────────────────────

  async add(
    id: string,
    content: string,
    embedding: number[],
    metadata: Record<string, unknown> = {},
  ): Promise<VectorEntry> {
    if (embedding.length !== this.config.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.config.dimensions}, got ${embedding.length}`,
      );
    }

    await this.ensureCollection();

    const entry: VectorEntry = {
      id,
      content,
      embedding,
      metadata,
      createdAt: Date.now(),
    };

    await this.request("PUT", `/collections/${this.config.collectionName}/points`, {
      points: [
        {
          id: this.hashId(id),
          vector: embedding,
          payload: {
            original_id: id,
            content,
            metadata,
            createdAt: entry.createdAt,
          },
        },
      ],
    });

    this.entryCount++;
    return entry;
  }

  async batchAdd(
    entries: Array<{
      id: string;
      content: string;
      embedding: number[];
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<number> {
    await this.ensureCollection();

    const points = entries.map((e) => ({
      id: this.hashId(e.id),
      vector: e.embedding,
      payload: {
        original_id: e.id,
        content: e.content,
        metadata: e.metadata || {},
        createdAt: Date.now(),
      },
    }));

    // Batch upsert in chunks of 100
    let added = 0;
    for (let i = 0; i < points.length; i += 100) {
      const batch = points.slice(i, i + 100);
      await this.request("PUT", `/collections/${this.config.collectionName}/points`, {
        points: batch,
      });
      added += batch.length;
    }

    this.entryCount += added;
    return added;
  }

  async search(
    queryEmbedding: number[],
    k: number = 10,
    filter?: (entry: VectorEntry) => boolean,
  ): Promise<VectorSearchResult[]> {
    await this.ensureCollection();

    const res = await this.request(
      "POST",
      `/collections/${this.config.collectionName}/points/search`,
      {
        vector: queryEmbedding,
        limit: filter ? k * 3 : k, // Over-fetch if filtering client-side
        with_payload: true,
        score_threshold: this.config.similarityThreshold,
      },
    );

    const data = (await res.json()) as QdrantResponse;
    const hits = Array.isArray(data.result) ? data.result : [];
    const results: VectorSearchResult[] = hits.map((hit) => ({
      entry: {
        id: hit.payload?.original_id || String(hit.id),
        content: hit.payload?.content || "",
        embedding: [], // Don't return full embeddings from search
        metadata: hit.payload?.metadata || {},
        createdAt: hit.payload?.createdAt || 0,
      },
      score: hit.score ?? 0,
    }));

    if (filter) {
      return results.filter((r) => filter(r.entry)).slice(0, k);
    }

    return results.slice(0, k);
  }

  async get(id: string): Promise<VectorEntry | undefined> {
    await this.ensureCollection();

    try {
      const res = await this.request(
        "POST",
        `/collections/${this.config.collectionName}/points/scroll`,
        {
          filter: {
            must: [{ key: "original_id", match: { value: id } }],
          },
          limit: 1,
          with_payload: true,
          with_vector: true,
        },
      );

      const data = (await res.json()) as QdrantResponse;
      const result = data.result && !Array.isArray(data.result) ? data.result : null;
      const point = result?.points?.[0];
      if (!point) {
        return undefined;
      }

      return {
        id: point.payload?.original_id || String(point.id),
        content: point.payload?.content || "",
        embedding: point.vector || [],
        metadata: point.payload?.metadata || {},
        createdAt: point.payload?.createdAt || 0,
      };
    } catch {
      return undefined;
    }
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureCollection();

    try {
      await this.request("POST", `/collections/${this.config.collectionName}/points/delete`, {
        filter: {
          must: [{ key: "original_id", match: { value: id } }],
        },
      });
      this.entryCount = Math.max(0, this.entryCount - 1);
      return true;
    } catch {
      return false;
    }
  }

  size(): number {
    return this.entryCount;
  }

  async clear(): Promise<void> {
    try {
      await this.request("DELETE", `/collections/${this.config.collectionName}`);
      this.initialized = false;
      this.entryCount = 0;
      await this.ensureCollection();
    } catch {
      // Already cleared
    }
  }

  stats(): { size: number; dimensions: number; maxEntries: number; oldestAge: number } {
    return {
      size: this.entryCount,
      dimensions: this.config.dimensions,
      maxEntries: this.config.maxEntries,
      oldestAge: 0,
    };
  }

  // Qdrant persists automatically — these are no-ops for interface compatibility
  saveToDisk(): void {
    /* Qdrant handles persistence */
  }
  dispose(): void {
    /* No cleanup needed */
  }

  // ─── Health Check ───────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.request("GET", "/healthz");
      return res.ok;
    } catch {
      return false;
    }
  }

  async getCollectionInfo(): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.request("GET", `/collections/${this.config.collectionName}`);
      const data = (await res.json()) as QdrantResponse;
      const result = data.result && !Array.isArray(data.result) ? data.result : null;
      return result as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }

  // ─── HTTP Transport ─────────────────────────────────────────

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const timeout = this.config.timeoutMs ?? 30000;

    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`Qdrant ${method} ${path}: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }

    return res;
  }

  /**
   * Qdrant uses numeric point IDs. Hash string IDs to positive integers.
   * Uses FNV-1a for fast, collision-resistant hashing.
   */
  private hashId(id: string): number {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    // Qdrant accepts unsigned 64-bit ints; JS safe integer is 2^53-1
    return hash;
  }
}
