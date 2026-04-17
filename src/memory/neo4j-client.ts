/**
 * Neo4j Knowledge Graph Client — Remote Graph Memory Backend
 *
 * Connects to a Neo4j instance running in a dedicated VM/container
 * over its HTTP transactional API. Implements the same interface as
 * the local GraphMemory so it's a drop-in replacement.
 *
 * Neo4j runs on:
 *   - Port 7474 (HTTP/REST API)
 *   - Port 7687 (Bolt protocol — not used here)
 *
 * This client uses the HTTP transactional endpoint (no driver needed).
 * VM Setup: See deploy/setup-databases.sh for automated provisioning.
 */

import { GraphMemoryConfig } from "./graph";
import { MemoryNode, MemoryEdge, MemoryQuery, MemoryQueryResult, MemoryStats } from "./types";

export interface Neo4jConfig extends GraphMemoryConfig {
  /** Neo4j HTTP endpoint, e.g. "http://10.0.0.51:7474" */
  neo4jUrl: string;
  /** Neo4j database name (default: "neo4j") */
  database?: string;
  /** Authentication: username */
  username?: string;
  /** Authentication: password */
  password?: string;
  /** Timeout for HTTP requests in ms */
  timeoutMs?: number;
}

/** Shape returned by the Neo4j HTTP transactional endpoint. */
interface Neo4jTransactionResponse {
  results?: Array<{
    columns?: string[];
    data?: Array<{ row?: unknown[] }>;
  }>;
  errors?: Array<{ message: string }>;
}

export class Neo4jClient {
  private readonly config: Neo4jConfig;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly database: string;
  private turnCount = 0;
  private initialized = false;

  constructor(config: Neo4jConfig) {
    this.config = config;
    this.baseUrl = config.neo4jUrl.replace(/\/$/, "");
    this.database = config.database || "neo4j";

    const auth =
      config.username && config.password
        ? `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`
        : `Basic ${Buffer.from("neo4j:neo4j").toString("base64")}`;

    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: auth,
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  /**
   * Create indexes and constraints on first use.
   */
  async ensureSchema(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create indexes for fast lookup
    await this.cypher(`CREATE INDEX IF NOT EXISTS FOR (n:MemoryNode) ON (n.id)`);
    await this.cypher(`CREATE INDEX IF NOT EXISTS FOR (n:MemoryNode) ON (n.type)`);
    await this.cypher(`CREATE INDEX IF NOT EXISTS FOR (n:MemoryNode) ON (n.importance)`);
    await this.cypher(`CREATE INDEX IF NOT EXISTS FOR ()-[r:MEMORY_EDGE]-() ON (r.id)`);

    this.initialized = true;
  }

  // ─── GraphMemory Interface ──────────────────────────────────

  async addNode(
    type: MemoryNode["type"],
    content: string,
    metadata: Record<string, unknown> = {},
    importance: number = 0.5,
  ): Promise<MemoryNode> {
    await this.ensureSchema();

    importance = Math.max(0, Math.min(1, importance));
    const id = `mem-${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();

    const node: MemoryNode = {
      id,
      type,
      content,
      metadata,
      importance,
      accessCount: 0,
      createdAt: now,
      lastAccessedAt: now,
    };

    await this.cypher(
      `CREATE (n:MemoryNode {
        id: $id, type: $type, content: $content,
        metadata: $metadata, importance: $importance,
        accessCount: 0, createdAt: $now, lastAccessedAt: $now
      })`,
      {
        id,
        type,
        content,
        metadata: JSON.stringify(metadata),
        importance,
        now,
      },
    );

    // Prune if over limit
    const count = await this.countNodes();
    if (count > this.config.maxNodes) {
      await this.prune();
    }

    return node;
  }

  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  async getNode(id: string): Promise<MemoryNode | undefined> {
    await this.ensureSchema();

    const result = await this.cypher(
      `MATCH (n:MemoryNode {id: $id})
       SET n.accessCount = n.accessCount + 1, n.lastAccessedAt = $now
       RETURN n`,
      { id, now: Date.now() },
    );

    const row = result[0];
    if (!row) {
      return undefined;
    }
    return this.rowToNode(row.n);
  }

  async removeNode(id: string): Promise<boolean> {
    await this.ensureSchema();

    const result = await this.cypher(
      `MATCH (n:MemoryNode {id: $id})
       DETACH DELETE n
       RETURN count(n) AS deleted`,
      { id },
    );

    return (result[0]?.deleted ?? 0) > 0;
  }

  async addEdge(
    sourceId: string,
    targetId: string,
    relation: string,
    weight: number = 1.0,
    // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  ): Promise<MemoryEdge | null> {
    await this.ensureSchema();

    const edgeId = `edge-${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();

    try {
      await this.cypher(
        `MATCH (s:MemoryNode {id: $sourceId}), (t:MemoryNode {id: $targetId})
         CREATE (s)-[r:MEMORY_EDGE {
           id: $edgeId, relation: $relation,
           weight: $weight, createdAt: $now
         }]->(t)
         RETURN r`,
        { sourceId, targetId, edgeId, relation, weight, now },
      );

      return { id: edgeId, sourceId, targetId, relation, weight, createdAt: now };
    } catch {
      return null;
    }
  }

  async removeEdge(id: string): Promise<boolean> {
    await this.ensureSchema();

    const result = await this.cypher(
      `MATCH ()-[r:MEMORY_EDGE {id: $id}]-()
       DELETE r
       RETURN count(r) AS deleted`,
      { id },
    );

    return (result[0]?.deleted ?? 0) > 0;
  }

  async query(query: MemoryQuery): Promise<MemoryQueryResult> {
    await this.ensureSchema();

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.types && query.types.length > 0) {
      conditions.push("n.type IN $types");
      params.types = query.types;
    }

    if (query.minImportance !== undefined) {
      conditions.push("n.importance >= $minImportance");
      params.minImportance = query.minImportance;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = query.limit || 20;

    // Text search using CONTAINS (Neo4j full-text index would be better for production)
    let orderBy = "n.importance DESC, n.lastAccessedAt DESC";
    if (query.text) {
      params.searchText = query.text.toLowerCase();
      conditions.push("toLower(n.content) CONTAINS $searchText");
      // Re-build WHERE
      const finalWhere = `WHERE ${conditions.join(" AND ")}`;

      const nodeResult = await this.cypher(
        `MATCH (n:MemoryNode) ${finalWhere}
         RETURN n ORDER BY ${orderBy} LIMIT $limit`,
        { ...params, limit },
      );

      const nodes = nodeResult.map((r: Record<string, unknown>) => this.rowToNode(r.n));

      let edges: MemoryEdge[] = [];
      if (query.includeEdges && nodes.length > 0) {
        const nodeIds = nodes.map((n) => n.id);
        const edgeResult = await this.cypher(
          `MATCH (s:MemoryNode)-[r:MEMORY_EDGE]-(t:MemoryNode)
           WHERE s.id IN $nodeIds OR t.id IN $nodeIds
           RETURN r, s.id AS sourceId, t.id AS targetId`,
          { nodeIds },
        );
        edges = edgeResult.map((r: Record<string, unknown>) => this.rowToEdge(r));
      }

      // Get total count
      const countResult = await this.cypher(
        `MATCH (n:MemoryNode) ${finalWhere} RETURN count(n) AS total`,
        params,
      );

      return {
        nodes,
        edges,
        totalMatched: countResult[0]?.total ?? nodes.length,
      };
    }

    // No text search — just filter
    const nodeResult = await this.cypher(
      `MATCH (n:MemoryNode) ${whereClause}
       RETURN n ORDER BY ${orderBy} LIMIT $limit`,
      { ...params, limit },
    );

    const nodes = nodeResult.map((r: Record<string, unknown>) => this.rowToNode(r.n));

    let edges: MemoryEdge[] = [];
    if (query.includeEdges && nodes.length > 0) {
      const nodeIds = nodes.map((n) => n.id);
      const edgeResult = await this.cypher(
        `MATCH (s:MemoryNode)-[r:MEMORY_EDGE]-(t:MemoryNode)
         WHERE s.id IN $nodeIds OR t.id IN $nodeIds
         RETURN r, s.id AS sourceId, t.id AS targetId`,
        { nodeIds },
      );
      edges = edgeResult.map((r: Record<string, unknown>) => this.rowToEdge(r));
    }

    const countResult = await this.cypher(
      `MATCH (n:MemoryNode) ${whereClause} RETURN count(n) AS total`,
      params,
    );

    return {
      nodes,
      edges,
      totalMatched: countResult[0]?.total ?? nodes.length,
    };
  }

  async getNeighbors(nodeId: string): Promise<MemoryNode[]> {
    await this.ensureSchema();

    const result = await this.cypher(
      `MATCH (n:MemoryNode {id: $nodeId})-[:MEMORY_EDGE]-(neighbor:MemoryNode)
       RETURN neighbor`,
      { nodeId },
    );

    return result.map((r: Record<string, unknown>) => this.rowToNode(r.neighbor));
  }

  async traverse(
    startId: string,
    maxDepth: number = 2,
  ): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[] }> {
    await this.ensureSchema();

    const nodeResult = await this.cypher(
      `MATCH path = (start:MemoryNode {id: $startId})-[:MEMORY_EDGE*0..${maxDepth}]-(n:MemoryNode)
       UNWIND nodes(path) AS node
       RETURN DISTINCT node`,
      { startId },
    );

    const nodes = nodeResult.map((r: Record<string, unknown>) => this.rowToNode(r.node));
    const nodeIds = nodes.map((n) => n.id);

    const edgeResult = await this.cypher(
      `MATCH (s:MemoryNode)-[r:MEMORY_EDGE]-(t:MemoryNode)
       WHERE s.id IN $nodeIds AND t.id IN $nodeIds
       RETURN DISTINCT r, s.id AS sourceId, t.id AS targetId`,
      { nodeIds },
    );

    const edges = edgeResult.map((r: Record<string, unknown>) => this.rowToEdge(r));

    return { nodes, edges };
  }

  recordTurn(): void {
    this.turnCount++;

    if (this.config.autoSummarize && this.turnCount % this.config.summarizeAfterTurns === 0) {
      // Fire and forget async summarize
      this.summarize().catch(() => {});
    }
  }

  async prune(): Promise<number> {
    await this.ensureSchema();

    // Remove low-importance, old, low-access nodes (never remove summaries)
    const result = await this.cypher(
      `MATCH (n:MemoryNode)
       WHERE n.type <> 'summary'
         AND n.importance < $threshold
         AND n.lastAccessedAt < $cutoff
       WITH n ORDER BY n.importance ASC, n.lastAccessedAt ASC
       LIMIT $pruneCount
       DETACH DELETE n
       RETURN count(n) AS pruned`,
      {
        threshold: this.config.importanceThreshold + 0.1,
        cutoff: Date.now() - 3600000, // 1 hour ago
        pruneCount: Math.max(1, Math.floor(this.config.maxNodes * 0.1)),
      },
    );

    return result[0]?.pruned ?? 0;
  }

  async summarize(): Promise<MemoryNode[]> {
    await this.ensureSchema();

    // Find old, low-access nodes to compress
    const oldNodes = await this.cypher(
      `MATCH (n:MemoryNode)
       WHERE n.type <> 'summary'
         AND n.accessCount <= 1
         AND n.lastAccessedAt < $cutoff
       RETURN n ORDER BY n.lastAccessedAt ASC LIMIT 20`,
      { cutoff: Date.now() - 7200000 },
    );

    if (oldNodes.length < 3) {
      return [];
    }

    const nodes = oldNodes.map((r: Record<string, unknown>) => this.rowToNode(r.n));
    const summaryContent = `Auto-summary of ${nodes.length} memories: ${nodes
      .map((n) => n.content.slice(0, 80))
      .join(" | ")}`;

    const summaryNode = await this.addNode(
      "summary",
      summaryContent,
      { summarizedNodeIds: nodes.map((n) => n.id), summarizedAt: Date.now() },
      0.6,
    );

    // Remove the summarized nodes
    const ids = nodes.map((n) => n.id);
    await this.cypher(`MATCH (n:MemoryNode) WHERE n.id IN $ids DETACH DELETE n`, { ids });

    return [summaryNode];
  }

  async stats(): Promise<MemoryStats> {
    await this.ensureSchema();

    const result = await this.cypher(`
      MATCH (n:MemoryNode)
      RETURN
        count(n) AS totalNodes,
        avg(n.importance) AS avgImportance,
        min(n.createdAt) AS oldestCreatedAt,
        n.type AS type
    `);

    const nodesByType: Record<string, number> = {};
    let totalNodes = 0;
    let avgImportance = 0;
    let oldestCreatedAt = Date.now();

    for (const row of result) {
      if (row.type) {
        nodesByType[row.type] = row.totalNodes || 0;
      }
      totalNodes += row.totalNodes || 0;
      avgImportance = row.avgImportance || 0;
      if (row.oldestCreatedAt && row.oldestCreatedAt < oldestCreatedAt) {
        oldestCreatedAt = row.oldestCreatedAt;
      }
    }

    const edgeResult = await this.cypher(
      `MATCH ()-[r:MEMORY_EDGE]-() RETURN count(r) AS totalEdges`,
    );

    return {
      totalNodes,
      totalEdges: edgeResult[0]?.totalEdges ?? 0,
      nodesByType,
      averageImportance: avgImportance,
      oldestNodeAge: Date.now() - oldestCreatedAt,
    };
  }

  // Persistence is handled by Neo4j — these are for interface compatibility
  saveToDisk(): void {
    /* Neo4j persists automatically */
  }
  dispose(): void {
    /* No cleanup needed */
  }

  // ─── Health Check ───────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Cypher Transport ───────────────────────────────────────

  /**
   * Execute a Cypher query via Neo4j's HTTP transactional endpoint.
   * Uses auto-commit transactions for simplicity.
   */
  private async cypher(
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    const url = `${this.baseUrl}/db/${this.database}/tx/commit`;
    const timeout = this.config.timeoutMs ?? 30000;

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        statements: [{ statement: query, parameters: params }],
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Neo4j query failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as Neo4jTransactionResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`Neo4j error: ${data.errors[0].message}`);
    }

    // Parse tabular results into objects
    const result = data.results?.[0];
    if (!result || !result.data) {
      return [];
    }

    const columns = result.columns || [];
    return result.data.map((row) => {
      const obj: Record<string, unknown> = {};
      const values = row.row || [];
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = values[i];
      }
      return obj;
    });
  }

  private async countNodes(): Promise<number> {
    const result = await this.cypher(`MATCH (n:MemoryNode) RETURN count(n) AS count`);
    return result[0]?.count ?? 0;
  }

  // ─── Data Mapping ───────────────────────────────────────────

  private rowToNode(raw: Record<string, unknown>): MemoryNode {
    return {
      id: (raw.id as string) || "",
      type: (raw.type as string) || "fact",
      content: (raw.content as string) || "",
      metadata: typeof raw.metadata === "string" ? JSON.parse(raw.metadata) : raw.metadata || {},
      importance: (raw.importance as number) || 0.5,
      accessCount: (raw.accessCount as number) || 0,
      createdAt: (raw.createdAt as number) || 0,
      lastAccessedAt: (raw.lastAccessedAt as number) || 0,
    };
  }

  private rowToEdge(raw: Record<string, unknown>): MemoryEdge {
    const r = (raw.r || raw) as Record<string, unknown>;
    return {
      id: (r.id as string) || "",
      sourceId: (raw.sourceId as string) || (r.sourceId as string) || "",
      targetId: (raw.targetId as string) || (r.targetId as string) || "",
      relation: (r.relation as string) || "related_to",
      weight: (r.weight as number) || 1.0,
      createdAt: (r.createdAt as number) || 0,
    };
  }
}
