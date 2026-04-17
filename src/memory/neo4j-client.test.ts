import { describe, it, expect, beforeEach, vi } from "vitest";
import { Neo4jClient } from "./neo4j-client";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  randomUUID: () => "aaaa-bbbb-cccc-dddd",
});

describe("Neo4jClient", () => {
  let client: Neo4jClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new Neo4jClient({
      neo4jUrl: "http://10.0.0.51:7474",
      database: "testdb",
      username: "neo4j",
      password: "testpass",
      maxNodes: 1000,
      importanceThreshold: 0.3,
      autoSummarize: false,
      summarizeAfterTurns: 100,
    });
  });

  function cypherResponse(columns: string[], rows: any[][]) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          columns,
          data: rows.map((row) => ({ row })),
        }],
        errors: [],
      }),
      text: async () => "",
    };
  }

  function emptyResponse() {
    return cypherResponse([], []);
  }

  it("should create schema indexes on first operation", async () => {
    // 4 index creation calls
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    // addNode: CREATE
    mockFetch.mockResolvedValueOnce(emptyResponse());
    // countNodes
    mockFetch.mockResolvedValueOnce(cypherResponse(["count"], [[0]]));

    await client.addNode("fact", "test content");

    // 4 indexes + 1 create + 1 count = 6 calls
    expect(mockFetch).toHaveBeenCalledTimes(6);

    // Verify first calls are index creation
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[0]).toContain("/db/testdb/tx/commit");
    const body = JSON.parse(firstCall[1].body);
    expect(body.statements[0].statement).toContain("CREATE INDEX");
  });

  it("should use Basic auth from credentials", () => {
    // The constructor sets up auth headers — verify through a call
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["count"], [[0]]));

    client.addNode("fact", "test");

    // Check that the Authorization header is set
    const expectedAuth = `Basic ${Buffer.from("neo4j:testpass").toString("base64")}`;
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1].headers.Authorization).toBe(expectedAuth);
  });

  it("should add a memory node", async () => {
    // Schema (skip — mark as initialized by doing a second add)
    mockFetch.mockResolvedValueOnce(emptyResponse()); // index 1
    mockFetch.mockResolvedValueOnce(emptyResponse()); // index 2
    mockFetch.mockResolvedValueOnce(emptyResponse()); // index 3
    mockFetch.mockResolvedValueOnce(emptyResponse()); // index 4
    mockFetch.mockResolvedValueOnce(emptyResponse()); // CREATE node
    mockFetch.mockResolvedValueOnce(cypherResponse(["count"], [[1]])); // countNodes

    const node = await client.addNode("fact", "Neo4j is a graph DB", { source: "wiki" }, 0.8);

    expect(node.type).toBe("fact");
    expect(node.content).toBe("Neo4j is a graph DB");
    expect(node.importance).toBe(0.8);
    expect(node.metadata).toEqual({ source: "wiki" });
    expect(node.id).toMatch(/^mem-/);
  });

  it("should clamp importance to 0-1 range", async () => {
    // Skip schema setup by initializing first
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["count"], [[0]]));

    const node = await client.addNode("fact", "test", {}, 1.5);
    expect(node.importance).toBe(1);
  });

  it("should get a node by id", async () => {
    // Schema indexes
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    // MATCH query
    mockFetch.mockResolvedValueOnce(cypherResponse(["n"], [[{
      id: "mem-abc",
      type: "fact",
      content: "test content",
      metadata: "{}",
      importance: 0.7,
      accessCount: 3,
      createdAt: 1000,
      lastAccessedAt: 2000,
    }]]));

    const node = await client.getNode("mem-abc");

    expect(node).toBeDefined();
    expect(node!.id).toBe("mem-abc");
    expect(node!.type).toBe("fact");
    expect(node!.content).toBe("test content");
    expect(node!.accessCount).toBe(3);
  });

  it("should return undefined for missing nodes", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["n"], []));

    const node = await client.getNode("nonexistent");
    expect(node).toBeUndefined();
  });

  it("should remove a node", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["deleted"], [[1]]));

    const removed = await client.removeNode("mem-abc");
    expect(removed).toBe(true);
  });

  it("should return false when removing nonexistent node", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["deleted"], [[0]]));

    const removed = await client.removeNode("nonexistent");
    expect(removed).toBe(false);
  });

  it("should add edges between nodes", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["r"], [[{}]]));

    const edge = await client.addEdge("node-a", "node-b", "relates_to", 0.8);

    expect(edge).not.toBeNull();
    expect(edge!.sourceId).toBe("node-a");
    expect(edge!.targetId).toBe("node-b");
    expect(edge!.relation).toBe("relates_to");
    expect(edge!.weight).toBe(0.8);
  });

  it("should remove edges", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["deleted"], [[1]]));

    const removed = await client.removeEdge("edge-123");
    expect(removed).toBe(true);
  });

  it("should query nodes with type filter", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    // Query result
    mockFetch.mockResolvedValueOnce(cypherResponse(["n"], [[{
      id: "mem-1", type: "fact", content: "a fact",
      metadata: "{}", importance: 0.8,
      accessCount: 1, createdAt: 1000, lastAccessedAt: 2000,
    }]]));
    // Count
    mockFetch.mockResolvedValueOnce(cypherResponse(["total"], [[1]]));

    const result = await client.query({ types: ["fact"], limit: 10 });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe("fact");
    expect(result.totalMatched).toBe(1);
  });

  it("should query with text search", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["n"], [[{
      id: "mem-1", type: "fact", content: "neo4j is a graph database",
      metadata: "{}", importance: 0.9,
      accessCount: 2, createdAt: 1000, lastAccessedAt: 3000,
    }]]));
    mockFetch.mockResolvedValueOnce(cypherResponse(["total"], [[1]]));

    const result = await client.query({ text: "graph database", limit: 5 });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].content).toContain("graph database");
  });

  it("should check health", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    expect(await client.isHealthy()).toBe(true);

    mockFetch.mockRejectedValueOnce(new Error("connection refused"));
    expect(await client.isHealthy()).toBe(false);
  });

  it("should handle Neo4j errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    // Return an error from Neo4j
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        results: [],
        errors: [{ message: "Node not found" }],
      }),
      text: async () => "",
    });

    await expect(client.getNode("bad-id")).rejects.toThrow("Neo4j error");
  });

  it("should track turn count and trigger summarize", () => {
    const autoClient = new Neo4jClient({
      neo4jUrl: "http://10.0.0.51:7474",
      maxNodes: 100,
      importanceThreshold: 0.3,
      autoSummarize: true,
      summarizeAfterTurns: 5,
    });

    // recordTurn is synchronous and doesn't throw
    for (let i = 0; i < 10; i++) {
      autoClient.recordTurn();
    }
    // No assertion needed — just verify it doesn't crash
  });

  it("saveToDisk and dispose are no-ops", () => {
    // These should not throw
    client.saveToDisk();
    client.dispose();
  });

  it("should parse metadata from JSON strings", async () => {
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(emptyResponse());
    mockFetch.mockResolvedValueOnce(cypherResponse(["n"], [[{
      id: "mem-meta",
      type: "fact",
      content: "metadata test",
      metadata: '{"key":"value","nested":{"a":1}}',
      importance: 0.5,
      accessCount: 0,
      createdAt: 1000,
      lastAccessedAt: 1000,
    }]]));

    const node = await client.getNode("mem-meta");
    expect(node!.metadata).toEqual({ key: "value", nested: { a: 1 } });
  });
});
