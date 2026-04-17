/**
 * Database-Backed Personality Storage
 *
 * Stores the AI personality and user knowledge graph in the actual databases
 * instead of flat JSON files:
 *
 *   SQL (MariaDB/SQLite) — personality config, user profiles, conversation metadata
 *   Neo4j              — knowledge graph nodes and relationships
 *   Qdrant             — vector embeddings of facts for semantic retrieval
 *
 * Falls back to in-memory storage when databases are unreachable.
 */

import { UserKnowledgeNode, UserKnowledgeGraph } from "./clara-types";

export interface PersonalityDbConfig {
  /** SQL client for personality config and user profiles */
  sqlUrl?: string;
  /** Neo4j endpoint for knowledge graph */
  neo4jUrl?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  /** Qdrant endpoint for vector embeddings */
  qdrantUrl?: string;
  qdrantCollection?: string;
}

export interface AiPersonalityRecord {
  id: string;
  name: string;
  pronouns: "she" | "he" | "they";
  version: string;
  birthdate: string;
  origin: string;
  personality: string;
  favorites: Record<string, string>;
  opinions: string[];
  selfFacts: string[];
  createdAt: number;
  updatedAt: number;
}

export interface UserProfileRecord {
  userId: string;
  displayName: string;
  technicalLevel: string;
  preferredStyle: string;
  knownFacts: string[];
  hardware: string[];
  tools: string[];
  goals: string[];
  conversationCount: number;
  firstInteraction: number;
  lastInteraction: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * PersonalityDb — unified database layer for persistent personality storage.
 *
 * SQL tables:
 *   ai_personality  — one row per AI identity (Clara, etc.)
 *   user_profiles   — one row per user the AI interacts with
 *
 * Neo4j nodes:
 *   (:KnowledgeNode {id, userId, category, content, confidence, importance, ...})
 *   (:User {userId, name}) -[:KNOWS]-> (:KnowledgeNode)
 *   (:KnowledgeNode) -[:RELATED_TO]-> (:KnowledgeNode)
 *
 * Qdrant:
 *   Collection "personality" — vector embeddings of knowledge nodes for semantic query
 */
export class PersonalityDb {
  private config: PersonalityDbConfig;
  private initialized = false;

  // In-memory fallback
  private personalities: Map<string, AiPersonalityRecord> = new Map();
  private users: Map<string, UserProfileRecord> = new Map();
  private knowledgeNodes: Map<string, UserKnowledgeNode[]> = new Map();

  constructor(config: PersonalityDbConfig = {}) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize SQL tables
    if (this.config.sqlUrl) {
      await this.initSqlTables();
    }

    // Initialize Neo4j constraints
    if (this.config.neo4jUrl) {
      await this.initNeo4jSchema();
    }

    // Initialize Qdrant collection
    if (this.config.qdrantUrl) {
      await this.initQdrantCollection();
    }

    this.initialized = true;
  }

  // ─── AI Personality CRUD ────────────────────────────────────────

  async savePersonality(record: AiPersonalityRecord): Promise<void> {
    this.personalities.set(record.id, record);

    if (this.config.sqlUrl) {
      await this.sqlExec(
        `INSERT INTO ai_personality (id, name, pronouns, version, birthdate, origin, personality, favorites, opinions, self_facts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=?, pronouns=?, personality=?, favorites=?, opinions=?, self_facts=?, updated_at=?`,
        [
          record.id, record.name, record.pronouns, record.version,
          record.birthdate, record.origin, record.personality,
          JSON.stringify(record.favorites), JSON.stringify(record.opinions),
          JSON.stringify(record.selfFacts), record.createdAt, record.updatedAt,
          record.name, record.pronouns, record.personality,
          JSON.stringify(record.favorites), JSON.stringify(record.opinions),
          JSON.stringify(record.selfFacts), record.updatedAt,
        ]
      );
    }
  }

  async getPersonality(id: string): Promise<AiPersonalityRecord | null> {
    if (this.config.sqlUrl) {
      const rows = await this.sqlQuery<AiPersonalityRecord>(
        `SELECT * FROM ai_personality WHERE id = ?`, [id]
      );
      if (rows.length > 0) return this.parsePersonalityRow(rows[0]);
    }
    return this.personalities.get(id) ?? null;
  }

  // ─── User Profile CRUD ──────────────────────────────────────────

  async saveUserProfile(record: UserProfileRecord): Promise<void> {
    this.users.set(record.userId, record);

    if (this.config.sqlUrl) {
      await this.sqlExec(
        `INSERT INTO user_profiles (user_id, display_name, technical_level, preferred_style, known_facts, hardware, tools, goals, conversation_count, first_interaction, last_interaction, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name=?, technical_level=?, known_facts=?, hardware=?, tools=?, goals=?, conversation_count=?, last_interaction=?, updated_at=?`,
        [
          record.userId, record.displayName, record.technicalLevel,
          record.preferredStyle, JSON.stringify(record.knownFacts),
          JSON.stringify(record.hardware), JSON.stringify(record.tools),
          JSON.stringify(record.goals), record.conversationCount,
          record.firstInteraction, record.lastInteraction,
          record.createdAt, record.updatedAt,
          record.displayName, record.technicalLevel,
          JSON.stringify(record.knownFacts), JSON.stringify(record.hardware),
          JSON.stringify(record.tools), JSON.stringify(record.goals),
          record.conversationCount, record.lastInteraction, record.updatedAt,
        ]
      );
    }

    // Also create/update Neo4j user node
    if (this.config.neo4jUrl) {
      await this.neo4jExec(
        `MERGE (u:User {userId: $userId})
         SET u.name = $name, u.technicalLevel = $technicalLevel, u.updatedAt = $updatedAt`,
        { userId: record.userId, name: record.displayName, technicalLevel: record.technicalLevel, updatedAt: record.updatedAt }
      );
    }
  }

  async getUserProfile(userId: string): Promise<UserProfileRecord | null> {
    if (this.config.sqlUrl) {
      const rows = await this.sqlQuery<UserProfileRecord>(
        `SELECT * FROM user_profiles WHERE user_id = ?`, [userId]
      );
      if (rows.length > 0) return this.parseUserRow(rows[0]);
    }
    return this.users.get(userId) ?? null;
  }

  // ─── Knowledge Graph (Neo4j-backed) ─────────────────────────────

  async saveKnowledgeNode(node: UserKnowledgeNode): Promise<void> {
    // In-memory
    if (!this.knowledgeNodes.has(node.userId)) {
      this.knowledgeNodes.set(node.userId, []);
    }
    const nodes = this.knowledgeNodes.get(node.userId)!;
    const idx = nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) nodes[idx] = node;
    else nodes.push(node);

    // Neo4j
    if (this.config.neo4jUrl) {
      await this.neo4jExec(
        `MERGE (n:KnowledgeNode {id: $id})
         SET n.userId = $userId, n.category = $category, n.content = $content,
             n.confidence = $confidence, n.importance = $importance,
             n.learnedAt = $learnedAt, n.lastConfirmedAt = $lastConfirmedAt,
             n.mentionCount = $mentionCount, n.source = $source
         WITH n
         MERGE (u:User {userId: $userId})
         MERGE (u)-[:KNOWS]->(n)`,
        {
          id: node.id, userId: node.userId, category: node.category,
          content: node.content, confidence: node.confidence,
          importance: node.importance, learnedAt: node.learnedAt,
          lastConfirmedAt: node.lastConfirmedAt, mentionCount: node.mentionCount,
          source: node.source,
        }
      );

      // Create RELATED_TO edges
      for (const relatedId of node.relatedNodeIds) {
        await this.neo4jExec(
          `MATCH (a:KnowledgeNode {id: $fromId}), (b:KnowledgeNode {id: $toId})
           MERGE (a)-[:RELATED_TO]->(b)`,
          { fromId: node.id, toId: relatedId }
        );
      }
    }

    // Qdrant — store vector embedding for semantic search
    if (this.config.qdrantUrl) {
      await this.qdrantUpsert(node);
    }
  }

  async getKnowledgeNodes(userId: string): Promise<UserKnowledgeNode[]> {
    if (this.config.neo4jUrl) {
      return this.neo4jQueryNodes(
        `MATCH (u:User {userId: $userId})-[:KNOWS]->(n:KnowledgeNode)
         RETURN n ORDER BY n.importance * n.confidence DESC`,
        { userId }
      );
    }
    return this.knowledgeNodes.get(userId) ?? [];
  }

  async removeKnowledgeNode(userId: string, nodeId: string): Promise<boolean> {
    const nodes = this.knowledgeNodes.get(userId);
    if (nodes) {
      const idx = nodes.findIndex((n) => n.id === nodeId);
      if (idx >= 0) nodes.splice(idx, 1);
    }

    if (this.config.neo4jUrl) {
      await this.neo4jExec(
        `MATCH (n:KnowledgeNode {id: $id}) DETACH DELETE n`,
        { id: nodeId }
      );
    }
    if (this.config.qdrantUrl) {
      await this.qdrantDelete(nodeId);
    }
    return true;
  }

  async getKnowledgeGraph(userId: string): Promise<UserKnowledgeGraph> {
    const nodes = await this.getKnowledgeNodes(userId);
    return {
      userId,
      nodes,
      lastUpdated: nodes.length > 0 ? Math.max(...nodes.map((n) => n.lastConfirmedAt)) : Date.now(),
      totalConversations: 0,
    };
  }

  // ─── Semantic Search (Qdrant-backed) ─────────────────────────────

  async semanticSearch(userId: string, query: string, limit = 10): Promise<UserKnowledgeNode[]> {
    if (!this.config.qdrantUrl) {
      // Fallback: simple substring match
      const nodes = this.knowledgeNodes.get(userId) ?? [];
      const lower = query.toLowerCase();
      return nodes
        .filter((n) => n.content.toLowerCase().includes(lower))
        .sort((a, b) => b.importance * b.confidence - a.importance * a.confidence)
        .slice(0, limit);
    }

    const collection = this.config.qdrantCollection ?? "personality";
    const resp = await this.httpPost(`${this.config.qdrantUrl}/collections/${collection}/points/search`, {
      vector: this.simpleHash(query),
      filter: { must: [{ key: "userId", match: { value: userId } }] },
      limit,
      with_payload: true,
    });

    if (resp?.result) {
      return resp.result.map((r: { payload: UserKnowledgeNode }) => r.payload);
    }
    return [];
  }

  // ─── SQL Helpers ────────────────────────────────────────────────

  private async initSqlTables(): Promise<void> {
    await this.sqlExec(`
      CREATE TABLE IF NOT EXISTS ai_personality (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        pronouns VARCHAR(10) DEFAULT 'she',
        version VARCHAR(20),
        birthdate VARCHAR(20),
        origin TEXT,
        personality TEXT,
        favorites TEXT,
        opinions TEXT,
        self_facts TEXT,
        created_at BIGINT,
        updated_at BIGINT
      )
    `);

    await this.sqlExec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id VARCHAR(64) PRIMARY KEY,
        display_name VARCHAR(100) NOT NULL,
        technical_level VARCHAR(20) DEFAULT 'intermediate',
        preferred_style VARCHAR(50) DEFAULT 'friendly',
        known_facts TEXT,
        hardware TEXT,
        tools TEXT,
        goals TEXT,
        conversation_count INT DEFAULT 0,
        first_interaction BIGINT,
        last_interaction BIGINT,
        created_at BIGINT,
        updated_at BIGINT
      )
    `);
  }

  private async sqlExec(query: string, params: unknown[] = []): Promise<void> {
    try {
      await this.httpPost(`${this.config.sqlUrl}/query`, { query, params });
    } catch { /* best-effort */ }
  }

  private async sqlQuery<T>(query: string, params: unknown[] = []): Promise<T[]> {
    try {
      const resp = await this.httpPost(`${this.config.sqlUrl}/query`, { query, params });
      return (resp?.rows ?? []) as T[];
    } catch {
      return [];
    }
  }

  // ─── Neo4j Helpers ──────────────────────────────────────────────

  private async initNeo4jSchema(): Promise<void> {
    await this.neo4jExec(
      `CREATE CONSTRAINT IF NOT EXISTS FOR (n:KnowledgeNode) REQUIRE n.id IS UNIQUE`
    );
    await this.neo4jExec(
      `CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE`
    );
  }

  private async neo4jExec(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
    try {
      const auth = this.config.neo4jUser && this.config.neo4jPassword
        ? `Basic ${btoa(`${this.config.neo4jUser}:${this.config.neo4jPassword}`)}`
        : undefined;

      await fetch(`${this.config.neo4jUrl}/db/neo4j/tx/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({ statements: [{ statement: cypher, parameters: params }] }),
      });
    } catch { /* best-effort */ }
  }

  private async neo4jQueryNodes(cypher: string, params: Record<string, unknown>): Promise<UserKnowledgeNode[]> {
    try {
      const auth = this.config.neo4jUser && this.config.neo4jPassword
        ? `Basic ${btoa(`${this.config.neo4jUser}:${this.config.neo4jPassword}`)}`
        : undefined;

      const resp = await fetch(`${this.config.neo4jUrl}/db/neo4j/tx/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({ statements: [{ statement: cypher, parameters: params }] }),
      });
      const data = await resp.json();
      const rows = data?.results?.[0]?.data ?? [];
      return rows.map((r: { row: [UserKnowledgeNode] }) => r.row[0]);
    } catch {
      return this.knowledgeNodes.get(params.userId as string) ?? [];
    }
  }

  // ─── Qdrant Helpers ─────────────────────────────────────────────

  private async initQdrantCollection(): Promise<void> {
    const collection = this.config.qdrantCollection ?? "personality";
    try {
      await this.httpPost(`${this.config.qdrantUrl}/collections/${collection}`, {
        vectors: { size: 64, distance: "Cosine" },
      });
    } catch { /* collection may already exist */ }
  }

  private async qdrantUpsert(node: UserKnowledgeNode): Promise<void> {
    const collection = this.config.qdrantCollection ?? "personality";
    try {
      await this.httpPost(`${this.config.qdrantUrl}/collections/${collection}/points`, {
        points: [{
          id: this.stableNumericId(node.id),
          vector: this.simpleHash(node.content),
          payload: node,
        }],
      });
    } catch { /* best-effort */ }
  }

  private async qdrantDelete(nodeId: string): Promise<void> {
    const collection = this.config.qdrantCollection ?? "personality";
    try {
      await this.httpPost(`${this.config.qdrantUrl}/collections/${collection}/points/delete`, {
        points: [this.stableNumericId(nodeId)],
      });
    } catch { /* best-effort */ }
  }

  // ─── HTTP / Utility ─────────────────────────────────────────────

  private async httpPost(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.ok) return await resp.json();
    } catch { /* network error */ }
    return null;
  }

  /** Simple deterministic hash to 64-dim float vector for content matching */
  private simpleHash(text: string): number[] {
    const vec = new Array(64).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 64] += text.charCodeAt(i) / 255;
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / mag);
  }

  /** Convert string id to stable numeric for Qdrant */
  private stableNumericId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private parsePersonalityRow(row: Record<string, unknown>): AiPersonalityRecord {
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      pronouns: (row.pronouns as AiPersonalityRecord["pronouns"]) ?? "she",
      version: String(row.version ?? ""),
      birthdate: String(row.birthdate ?? ""),
      origin: String(row.origin ?? ""),
      personality: String(row.personality ?? ""),
      favorites: typeof row.favorites === "string" ? JSON.parse(row.favorites) : {},
      opinions: typeof row.opinions === "string" ? JSON.parse(row.opinions) : [],
      selfFacts: typeof row.self_facts === "string" ? JSON.parse(row.self_facts as string) : [],
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    };
  }

  private parseUserRow(row: Record<string, unknown>): UserProfileRecord {
    return {
      userId: String(row.user_id ?? ""),
      displayName: String(row.display_name ?? ""),
      technicalLevel: String(row.technical_level ?? "intermediate"),
      preferredStyle: String(row.preferred_style ?? "friendly"),
      knownFacts: typeof row.known_facts === "string" ? JSON.parse(row.known_facts) : [],
      hardware: typeof row.hardware === "string" ? JSON.parse(row.hardware) : [],
      tools: typeof row.tools === "string" ? JSON.parse(row.tools) : [],
      goals: typeof row.goals === "string" ? JSON.parse(row.goals) : [],
      conversationCount: Number(row.conversation_count ?? 0),
      firstInteraction: Number(row.first_interaction ?? 0),
      lastInteraction: Number(row.last_interaction ?? 0),
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    };
  }
}
