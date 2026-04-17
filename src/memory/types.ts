export interface MemoryNode {
  id: string;
  type: "fact" | "task" | "contact" | "file" | "experience" | "summary";
  content: string;
  metadata: Record<string, unknown>;
  importance: number; // 0.0 - 1.0
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  embedding?: number[];
}

export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string; // e.g. "related_to", "part_of", "caused_by", "references"
  weight: number; // 0.0 - 1.0
  createdAt: number;
}

export interface MemoryQuery {
  text?: string;
  types?: MemoryNode["type"][];
  minImportance?: number;
  limit?: number;
  includeEdges?: boolean;
}

export interface MemoryQueryResult {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  totalMatched: number;
}

export interface MemoryStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  averageImportance: number;
  oldestNodeAge: number;
}

// ─── Types used by memory manager, search manager, and sync ────────

export type MemorySource = "memory" | "sessions" | (string & {});

export interface MemorySearchResult {
  id?: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
  textScore?: number;
}

export interface MemoryProviderStatus {
  backend: string;
  files: number;
  chunks: number;
  dirty: boolean;
  workspaceDir?: string;
  dbPath?: string;
  provider: string;
  model?: string;
  requestedProvider?: string;
  sources: MemorySource[];
  extraPaths: string[];
  sourceCounts: Array<{ source: MemorySource; files: number; chunks: number }>;
  cache: { enabled: boolean; entries?: number; maxEntries: number };
  fts: { enabled: boolean; available: boolean; error?: string };
  fallback?: { from: string; reason: string };
  vector: {
    enabled: boolean;
    available?: boolean;
    extensionPath?: string;
    loadError?: string;
    dims?: number;
  };
  batch: {
    enabled: boolean;
    failures: number;
    limit: number;
    wait: boolean;
    concurrency: number;
    pollIntervalMs: number;
    timeoutMs: number;
    lastError?: string;
    lastProvider?: string;
  };
  custom?: Record<string, unknown>;
}

export interface MemorySyncProgressUpdate {
  phase: string;
  current?: number;
  total?: number;
  detail?: string;
}

export interface MemoryEmbeddingProbeResult {
  ok: boolean;
  provider?: string;
  model?: string;
  dimensions?: number;
  error?: string;
}

export interface MemorySearchManager {
  search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]>;
  readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }>;
  status(): MemoryProviderStatus;
  sync?(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void>;
  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;
  close?(): Promise<void>;
}
