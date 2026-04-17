import { describe, it, expect, beforeEach, vi } from "vitest";
import { SqlClient } from "./sql-client";

describe("SqlClient", () => {
  describe("SQLite backend (in-memory)", () => {
    let client: SqlClient;

    beforeEach(() => {
      client = new SqlClient({
        backend: "sqlite",
        sqlitePath: ":memory:",
      });
    });

    it("should initialize without error", async () => {
      await client.initialize();
      const stats = await client.getStats();
      expect(stats.backend).toBe("sqlite");
      expect(stats.tables).toBe(3);
      expect(stats.repoCount).toBe(0);
    });

    it("should add and retrieve a repository", async () => {
      await client.addRepository({
        id: "HKUDS/nanobot",
        name: "nanobot",
        url: "https://github.com/HKUDS/nanobot",
        description: "Nano-scale AI agent framework",
        stars: 1200,
        language: "Python",
        owner: "HKUDS",
        category: "agents",
        tags: ["ai", "agents", "nano"],
      });

      const repos = await client.getRepositories();
      expect(repos).toHaveLength(1);
      expect(repos[0].id).toBe("HKUDS/nanobot");
      expect(repos[0].name).toBe("nanobot");
      expect(repos[0].url).toBe("https://github.com/HKUDS/nanobot");
      expect(repos[0].stars).toBe(1200);
    });

    it("should get a specific repository by id", async () => {
      await client.addRepository({
        id: "sipeed/picoclaw",
        name: "picoclaw",
        url: "https://github.com/sipeed/picoclaw",
        description: "Pico-scale hardware AI claw",
        owner: "sipeed",
      });

      const repo = await client.getRepository("sipeed/picoclaw");
      expect(repo).toBeDefined();
      expect(repo!.name).toBe("picoclaw");

      const missing = await client.getRepository("nonexistent");
      expect(missing).toBeUndefined();
    });

    it("should update a repository", async () => {
      await client.addRepository({
        id: "test/repo",
        name: "test-repo",
        url: "https://github.com/test/repo",
      });

      const updated = await client.updateRepository("test/repo", {
        stars: 500,
        description: "Updated description",
        isPinned: true,
      });
      expect(updated).toBe(true);

      const repo = await client.getRepository("test/repo");
      expect(repo!.stars).toBe(500);
      expect(repo!.description).toBe("Updated description");
      expect(repo!.is_pinned).toBe(1);
    });

    it("should return false when updating nonexistent repo", async () => {
      const result = await client.updateRepository("nope", { stars: 1 });
      expect(result).toBe(false);
    });

    it("should remove a repository", async () => {
      await client.addRepository({
        id: "to-delete",
        name: "delete-me",
        url: "https://example.com",
      });

      const removed = await client.removeRepository("to-delete");
      expect(removed).toBe(true);

      const repos = await client.getRepositories();
      expect(repos).toHaveLength(0);

      const removedAgain = await client.removeRepository("to-delete");
      expect(removedAgain).toBe(false);
    });

    it("should upsert on duplicate id", async () => {
      await client.addRepository({
        id: "dup/repo",
        name: "original",
        url: "https://example.com",
        stars: 10,
      });

      await client.addRepository({
        id: "dup/repo",
        name: "updated",
        url: "https://example.com",
        stars: 50,
      });

      const repos = await client.getRepositories();
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("updated");
      expect(repos[0].stars).toBe(50);
    });

    it("should sort repos: pinned first, then by stars", async () => {
      await client.addRepository({ id: "a", name: "A Low Stars", url: "https://a.com", stars: 10 });
      await client.addRepository({ id: "b", name: "B High Stars", url: "https://b.com", stars: 1000 });
      await client.addRepository({ id: "c", name: "C Pinned", url: "https://c.com", stars: 5, isPinned: true });

      const repos = await client.getRepositories();
      expect(repos[0].id).toBe("c"); // pinned
      expect(repos[1].id).toBe("b"); // highest stars
      expect(repos[2].id).toBe("a"); // lowest stars
    });

    // ─── KV Store ───────────────────────────────────────────

    it("should set and get KV values", async () => {
      await client.kvSet("test-key", { foo: "bar", count: 42 });

      const value = await client.kvGet<{ foo: string; count: number }>("test-key");
      expect(value).toEqual({ foo: "bar", count: 42 });
    });

    it("should return undefined for missing KV keys", async () => {
      const value = await client.kvGet("nonexistent");
      expect(value).toBeUndefined();
    });

    it("should overwrite existing KV values", async () => {
      await client.kvSet("key", "first");
      await client.kvSet("key", "second");

      const value = await client.kvGet("key");
      expect(value).toBe("second");
    });

    it("should delete KV entries", async () => {
      await client.kvSet("delete-me", true);
      const deleted = await client.kvDelete("delete-me");
      expect(deleted).toBe(true);

      const value = await client.kvGet("delete-me");
      expect(value).toBeUndefined();

      const deletedAgain = await client.kvDelete("delete-me");
      expect(deletedAgain).toBe(false);
    });

    // ─── Health & Stats ─────────────────────────────────────

    it("should always report healthy for SQLite", async () => {
      expect(await client.isHealthy()).toBe(true);
    });

    it("should report correct stats", async () => {
      await client.addRepository({ id: "r1", name: "repo1", url: "https://r1.com" });
      await client.addRepository({ id: "r2", name: "repo2", url: "https://r2.com" });

      const stats = await client.getStats();
      expect(stats.repoCount).toBe(2);
    });

    it("should clear all data", async () => {
      await client.addRepository({ id: "r1", name: "repo1", url: "https://r1.com" });
      await client.kvSet("key", "value");

      await client.clear();

      const repos = await client.getRepositories();
      expect(repos).toHaveLength(0);

      const value = await client.kvGet("key");
      expect(value).toBeUndefined();
    });

    it("should reject arbitrary SQL for SQLite", async () => {
      await expect(
        client.query("SELECT * FROM repositories")
      ).rejects.toThrow("only supported with MariaDB");
    });

    it("should report backend type", () => {
      expect(client.getBackend()).toBe("sqlite");
    });

    it("should dispose cleanly", () => {
      client.dispose();
      // After dispose, should be able to reinitialize
      expect(client.getBackend()).toBe("sqlite");
    });
  });

  describe("MariaDB backend", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      mockFetch.mockReset();
      vi.stubGlobal("fetch", mockFetch);
    });

    function mockResponse(status: number, body: any = {}) {
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }

    it("should require url for MariaDB backend", () => {
      expect(() => new SqlClient({ backend: "mariadb" })).toThrow("requires a url");
    });

    it("should initialize and create tables", async () => {
      // 3 CREATE TABLE statements
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));

      const client = new SqlClient({
        backend: "mariadb",
        url: "http://10.0.0.52:8080",
        username: "openclaw",
        password: "secret",
      });

      await client.initialize();

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[0]).toContain("/sql/openclaw");
      expect(firstCall[1].method).toBe("POST");
      // Verify auth header
      expect(firstCall[1].headers.Authorization).toContain("Basic");
    });

    it("should add a repository via MariaDB", async () => {
      // init (3 tables)
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      // INSERT
      mockFetch.mockResolvedValueOnce(mockResponse(200, { affectedRows: 1 }));

      const client = new SqlClient({
        backend: "mariadb",
        url: "http://10.0.0.52:8080",
      });

      await client.addRepository({
        id: "HKUDS/nanobot",
        name: "nanobot",
        url: "https://github.com/HKUDS/nanobot",
        stars: 1200,
      });

      // 3 init + 1 insert = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
      const insertCall = mockFetch.mock.calls[3];
      const body = JSON.parse(insertCall[1].body);
      expect(body.sql).toContain("INSERT INTO repositories");
      expect(body.params[0]).toBe("HKUDS/nanobot");
    });

    it("should query repositories from MariaDB", async () => {
      // init
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      // SELECT
      mockFetch.mockResolvedValueOnce(mockResponse(200, {
        rows: [
          { id: "repo1", name: "Repo 1", url: "https://example.com", stars: 100 },
        ],
      }));

      const client = new SqlClient({
        backend: "mariadb",
        url: "http://10.0.0.52:8080",
      });

      const repos = await client.getRepositories();
      expect(repos).toHaveLength(1);
      expect(repos[0].id).toBe("repo1");
    });

    it("should check health via REST endpoint", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200));

      const client = new SqlClient({
        backend: "mariadb",
        url: "http://10.0.0.52:8080",
      });

      expect(await client.isHealthy()).toBe(true);

      mockFetch.mockRejectedValueOnce(new Error("connection refused"));
      expect(await client.isHealthy()).toBe(false);
    });

    it("should throw on SQL errors", async () => {
      // init
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, { rows: [] }));
      // error response
      mockFetch.mockResolvedValueOnce(mockResponse(500, { error: "syntax error" }));

      const client = new SqlClient({
        backend: "mariadb",
        url: "http://10.0.0.52:8080",
      });

      await expect(
        client.addRepository({ id: "bad", name: "bad", url: "bad" })
      ).rejects.toThrow("MariaDB SQL error");
    });

    it("should report backend type", () => {
      const client = new SqlClient({
        backend: "mariadb",
        url: "http://10.0.0.52:8080",
      });
      expect(client.getBackend()).toBe("mariadb");
    });
  });
});
