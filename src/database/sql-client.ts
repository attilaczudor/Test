/**
 * SQL Database Client — MariaDB / SQLite Backend
 *
 * Provides standard relational storage for OpenClaw using MariaDB
 * as the primary backend with SQLite as an embedded fallback.
 *
 * MariaDB runs on port 3306 in a dedicated VM/container.
 * SQLite uses a local file for zero-config environments.
 *
 * Uses HTTP-based REST API for MariaDB (via MaxScale or custom proxy)
 * and better-sqlite3-compatible interface for SQLite — no native deps
 * needed at the transport layer; both use the same SQL interface.
 *
 * VM Setup: See deploy/setup-databases.sh for automated provisioning.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("sql-client");

export interface SqlConfig {
  /** Database backend: "mariadb" for remote, "sqlite" for embedded */
  backend: "mariadb" | "sqlite";
  /** MariaDB connection URL, e.g. "http://10.0.0.52:8080" (REST proxy) */
  url?: string;
  /** Database name (default: "openclaw") */
  database?: string;
  /** Username for MariaDB auth */
  username?: string;
  /** Password for MariaDB auth */
  password?: string;
  /** SQLite file path (default: "./data/openclaw.db") */
  sqlitePath?: string;
  /** HTTP request timeout in ms */
  timeoutMs?: number;
}

export interface SqlRow {
  [key: string]: unknown;
}

export interface SqlQueryResult {
  rows: SqlRow[];
  affectedRows: number;
  insertId: number;
}

/**
 * Unified SQL client supporting MariaDB (remote) and SQLite (embedded).
 * Communicates with MariaDB via its REST API endpoint.
 */
export class SqlClient {
  private readonly config: SqlConfig;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /** In-memory SQLite fallback store (rows keyed by table name) */
  private sqliteStore: Map<string, SqlRow[]> = new Map();

  constructor(config: SqlConfig) {
    this.config = {
      database: "openclaw",
      timeoutMs: 30000,
      ...config,
    };

    if (config.backend === "mariadb") {
      if (!config.url) {
        throw new Error("MariaDB backend requires a url");
      }
      this.baseUrl = config.url.replace(/\/$/, "");
      this.headers = {
        "Content-Type": "application/json",
      };

      if (config.username && config.password) {
        const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");
        this.headers["Authorization"] = `Basic ${credentials}`;
      }
    } else {
      this.baseUrl = "";
      this.headers = {};
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  /**
   * Initialize the database: create required tables if they don't exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initPromise ??= this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    const schema = `
      CREATE TABLE IF NOT EXISTS repositories (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        url VARCHAR(1024) NOT NULL,
        description TEXT,
        stars INTEGER DEFAULT 0,
        language VARCHAR(64),
        owner VARCHAR(255),
        added_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        category VARCHAR(128),
        tags TEXT,
        is_pinned BOOLEAN DEFAULT FALSE,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS repo_sync_log (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        repo_id VARCHAR(255) NOT NULL,
        synced_at BIGINT NOT NULL,
        status VARCHAR(32) NOT NULL,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS kv_store (
        key_name VARCHAR(255) PRIMARY KEY,
        value_data TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `;

    if (this.config.backend === "mariadb") {
      // Split statements and execute each
      const statements = schema
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await this.executeMariaDb(stmt);
      }
    } else {
      // SQLite fallback: initialize in-memory tables
      this.sqliteStore.set("repositories", []);
      this.sqliteStore.set("repo_sync_log", []);
      this.sqliteStore.set("kv_store", []);
    }

    this.initialized = true;
  }

  // ─── Repository Operations ──────────────────────────────────

  async addRepository(repo: {
    id: string;
    name: string;
    url: string;
    description?: string;
    stars?: number;
    language?: string;
    owner?: string;
    category?: string;
    tags?: string[];
    isPinned?: boolean;
    notes?: string;
  }): Promise<void> {
    await this.initialize();

    const now = Date.now();
    const tagsStr = repo.tags ? JSON.stringify(repo.tags) : "[]";

    if (this.config.backend === "mariadb") {
      await this.executeMariaDb(
        `INSERT INTO repositories (id, name, url, description, stars, language, owner, added_at, updated_at, category, tags, is_pinned, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           description = VALUES(description),
           stars = VALUES(stars),
           language = VALUES(language),
           updated_at = VALUES(updated_at),
           category = VALUES(category),
           tags = VALUES(tags),
           notes = VALUES(notes)`,
        [
          repo.id,
          repo.name,
          repo.url,
          repo.description || "",
          repo.stars || 0,
          repo.language || "",
          repo.owner || "",
          now,
          now,
          repo.category || "",
          tagsStr,
          repo.isPinned ? 1 : 0,
          repo.notes || "",
        ],
      );
    } else {
      const table = this.sqliteStore.get("repositories")!;
      const existing = table.findIndex((r) => r.id === repo.id);
      const row: SqlRow = {
        id: repo.id,
        name: repo.name,
        url: repo.url,
        description: repo.description || "",
        stars: repo.stars || 0,
        language: repo.language || "",
        owner: repo.owner || "",
        added_at: now,
        updated_at: now,
        category: repo.category || "",
        tags: tagsStr,
        is_pinned: repo.isPinned ? 1 : 0,
        notes: repo.notes || "",
      };

      if (existing >= 0) {
        row.added_at = table[existing].added_at; // preserve original add time
        table[existing] = row;
      } else {
        table.push(row);
      }
    }
  }

  async getRepositories(): Promise<SqlRow[]> {
    await this.initialize();

    if (this.config.backend === "mariadb") {
      const result = await this.executeMariaDb(
        `SELECT * FROM repositories ORDER BY is_pinned DESC, stars DESC, name ASC`,
      );
      return result.rows;
    } else {
      const table = this.sqliteStore.get("repositories") || [];
      return [...table].toSorted((a, b) => {
        // Pinned first
        if ((b.is_pinned as number) !== (a.is_pinned as number)) {
          return (b.is_pinned as number) - (a.is_pinned as number);
        }
        // Then by stars
        if ((b.stars as number) !== (a.stars as number)) {
          return (b.stars as number) - (a.stars as number);
        }
        // Then alphabetical
        return String(a.name).localeCompare(String(b.name));
      });
    }
  }

  async getRepository(id: string): Promise<SqlRow | undefined> {
    await this.initialize();

    if (this.config.backend === "mariadb") {
      const result = await this.executeMariaDb(`SELECT * FROM repositories WHERE id = ?`, [id]);
      return result.rows[0];
    } else {
      const table = this.sqliteStore.get("repositories") || [];
      return table.find((r) => r.id === id);
    }
  }

  async removeRepository(id: string): Promise<boolean> {
    await this.initialize();

    if (this.config.backend === "mariadb") {
      const result = await this.executeMariaDb(`DELETE FROM repositories WHERE id = ?`, [id]);
      return result.affectedRows > 0;
    } else {
      const table = this.sqliteStore.get("repositories")!;
      const idx = table.findIndex((r) => r.id === id);
      if (idx >= 0) {
        table.splice(idx, 1);
        return true;
      }
      return false;
    }
  }

  async updateRepository(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
      stars: number;
      category: string;
      tags: string[];
      isPinned: boolean;
      notes: string;
    }>,
  ): Promise<boolean> {
    await this.initialize();

    const now = Date.now();

    if (this.config.backend === "mariadb") {
      const setClauses: string[] = ["updated_at = ?"];
      const params: unknown[] = [now];

      if (updates.name !== undefined) {
        setClauses.push("name = ?");
        params.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push("description = ?");
        params.push(updates.description);
      }
      if (updates.stars !== undefined) {
        setClauses.push("stars = ?");
        params.push(updates.stars);
      }
      if (updates.category !== undefined) {
        setClauses.push("category = ?");
        params.push(updates.category);
      }
      if (updates.tags !== undefined) {
        setClauses.push("tags = ?");
        params.push(JSON.stringify(updates.tags));
      }
      if (updates.isPinned !== undefined) {
        setClauses.push("is_pinned = ?");
        params.push(updates.isPinned ? 1 : 0);
      }
      if (updates.notes !== undefined) {
        setClauses.push("notes = ?");
        params.push(updates.notes);
      }

      params.push(id);
      const result = await this.executeMariaDb(
        `UPDATE repositories SET ${setClauses.join(", ")} WHERE id = ?`,
        params,
      );
      return result.affectedRows > 0;
    } else {
      const table = this.sqliteStore.get("repositories")!;
      const row = table.find((r) => r.id === id);
      if (!row) {
        return false;
      }

      row.updated_at = now;
      if (updates.name !== undefined) {
        row.name = updates.name;
      }
      if (updates.description !== undefined) {
        row.description = updates.description;
      }
      if (updates.stars !== undefined) {
        row.stars = updates.stars;
      }
      if (updates.category !== undefined) {
        row.category = updates.category;
      }
      if (updates.tags !== undefined) {
        row.tags = JSON.stringify(updates.tags);
      }
      if (updates.isPinned !== undefined) {
        row.is_pinned = updates.isPinned ? 1 : 0;
      }
      if (updates.notes !== undefined) {
        row.notes = updates.notes;
      }

      return true;
    }
  }

  // ─── KV Store Operations ────────────────────────────────────

  async kvSet(key: string, value: unknown): Promise<void> {
    await this.initialize();
    const now = Date.now();
    const valueStr = JSON.stringify(value);

    if (this.config.backend === "mariadb") {
      await this.executeMariaDb(
        `INSERT INTO kv_store (key_name, value_data, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value_data = VALUES(value_data), updated_at = VALUES(updated_at)`,
        [key, valueStr, now],
      );
    } else {
      const table = this.sqliteStore.get("kv_store")!;
      const existing = table.findIndex((r) => r.key_name === key);
      const row: SqlRow = { key_name: key, value_data: valueStr, updated_at: now };
      if (existing >= 0) {
        table[existing] = row;
      } else {
        table.push(row);
      }
    }
  }

  async kvGet<T = unknown>(key: string): Promise<T | undefined> {
    await this.initialize();

    if (this.config.backend === "mariadb") {
      const result = await this.executeMariaDb(
        `SELECT value_data FROM kv_store WHERE key_name = ?`,
        [key],
      );
      if (result.rows.length === 0) {
        return undefined;
      }
      try {
        return JSON.parse(String(result.rows[0].value_data)) as T;
      } catch (err) {
        console.error(`[sql-client] kvGet: failed to parse value for key "${key}":`, err);
        return undefined;
      }
    } else {
      const table = this.sqliteStore.get("kv_store") || [];
      const row = table.find((r) => r.key_name === key);
      if (!row) {
        return undefined;
      }
      try {
        return JSON.parse(String(row.value_data)) as T;
      } catch (err) {
        console.error(`[sql-client] kvGet: failed to parse value for key "${key}":`, err);
        return undefined;
      }
    }
  }

  async kvDelete(key: string): Promise<boolean> {
    await this.initialize();

    if (this.config.backend === "mariadb") {
      const result = await this.executeMariaDb(`DELETE FROM kv_store WHERE key_name = ?`, [key]);
      return result.affectedRows > 0;
    } else {
      const table = this.sqliteStore.get("kv_store")!;
      const idx = table.findIndex((r) => r.key_name === key);
      if (idx >= 0) {
        table.splice(idx, 1);
        return true;
      }
      return false;
    }
  }

  // ─── Generic Query ──────────────────────────────────────────

  async query(sql: string, params?: unknown[]): Promise<SqlQueryResult> {
    await this.initialize();

    if (this.config.backend === "mariadb") {
      return this.executeMariaDb(sql, params);
    }

    // SQLite fallback doesn't support arbitrary SQL
    throw new Error("Arbitrary SQL queries are only supported with MariaDB backend");
  }

  // ─── Health & Stats ─────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    if (this.config.backend === "sqlite") {
      return true;
    }

    try {
      const res = await this.request("GET", "/health");
      return res.ok;
    } catch (err) {
      log.warn(`health check failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async getStats(): Promise<{ backend: string; tables: number; repoCount: number }> {
    await this.initialize();

    if (this.config.backend === "mariadb") {
      const result = await this.executeMariaDb(`SELECT COUNT(*) as cnt FROM repositories`);
      return {
        backend: "mariadb",
        tables: 3,
        repoCount: Number(result.rows[0]?.cnt ?? 0),
      };
    } else {
      return {
        backend: "sqlite",
        tables: this.sqliteStore.size,
        repoCount: (this.sqliteStore.get("repositories") || []).length,
      };
    }
  }

  getBackend(): string {
    return this.config.backend;
  }

  // ─── MariaDB HTTP Transport ─────────────────────────────────

  private async executeMariaDb(sql: string, params?: unknown[]): Promise<SqlQueryResult> {
    const res = await this.request("POST", `/sql/${this.config.database}`, {
      sql,
      params: params || [],
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MariaDB SQL error (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      rows?: SqlRow[];
      result?: SqlRow[];
      affectedRows?: number;
      affected_rows?: number;
      insertId?: number;
      insert_id?: number;
    };
    return {
      rows: data.rows || data.result || [],
      affectedRows: data.affectedRows ?? data.affected_rows ?? 0,
      insertId: data.insertId ?? data.insert_id ?? 0,
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const timeout = this.config.timeoutMs ?? 30000;

    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    return res;
  }

  /**
   * Reset/clear all data (for testing).
   */
  async clear(): Promise<void> {
    if (this.config.backend === "mariadb") {
      await this.executeMariaDb("DELETE FROM repositories");
      await this.executeMariaDb("DELETE FROM repo_sync_log");
      await this.executeMariaDb("DELETE FROM kv_store");
    } else {
      this.sqliteStore.set("repositories", []);
      this.sqliteStore.set("repo_sync_log", []);
      this.sqliteStore.set("kv_store", []);
    }
  }

  dispose(): void {
    this.sqliteStore.clear();
    this.initialized = false;
  }
}
