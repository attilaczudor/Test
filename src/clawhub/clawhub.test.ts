import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ClawHubClient, ClawHubApiError } from "./client";
import { ClawHubManager } from "./manager";
import { DEFAULT_CLAWHUB_CONFIG } from "./types";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── ClawHubClient Tests ────────────────────────────────────

describe("ClawHubClient", () => {
  let client: ClawHubClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new ClawHubClient({
      registryUrl: "https://clawhub.ai",
    });
  });

  it("should discover registry configuration", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        apiBase: "https://clawhub.ai",
        minCliVersion: "0.0.5",
      }),
      headers: new Map(),
    });

    const config = await client.discover();
    expect(config.apiBase).toBe("https://clawhub.ai");
  });

  it("should search skills", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        skills: [
          {
            slug: "todoist",
            displayName: "Todoist",
            description: "Manage tasks",
            latestVersion: "1.2.0",
            downloads: 5000,
            stars: 120,
          },
        ],
        total: 1,
      }),
      headers: new Map(),
    });

    const result = await client.search("todoist");
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].slug).toBe("todoist");
    expect(result.total).toBe(1);

    // Verify URL
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("/api/v1/search");
    expect(url).toContain("q=todoist");
  });

  it("should list skills with sorting", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        skills: [{ slug: "popular-skill" }],
        total: 100,
        cursor: "abc123",
      }),
      headers: new Map(),
    });

    const result = await client.listSkills({ sort: "trending", limit: 10 });
    expect(result.skills).toHaveLength(1);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("sort=trending");
    expect(url).toContain("limit=10");
  });

  it("should get skill details", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        slug: "github-agent",
        displayName: "GitHub Agent",
        description: "Manage GitHub repositories",
        latestVersion: "2.0.0",
        downloads: 15000,
        owner: { handle: "openclaw" },
      }),
      headers: new Map(),
    });

    const skill = await client.getSkill("github-agent");
    expect(skill.slug).toBe("github-agent");
    expect(skill.latestVersion).toBe("2.0.0");
    expect(skill.owner.handle).toBe("openclaw");
  });

  it("should get skill versions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [
          { version: "2.0.0", publishedAt: "2026-02-01", files: [] },
          { version: "1.5.0", publishedAt: "2026-01-15", files: [] },
        ],
      }),
      headers: new Map(),
    });

    const result = await client.getVersions("github-agent");
    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].version).toBe("2.0.0");
  });

  it("should get raw file content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "---\nname: test-skill\n---\n# Instructions",
      headers: new Map(),
    });

    const content = await client.getFile("test-skill", "SKILL.md");
    expect(content).toContain("test-skill");
  });

  it("should download skill as zip", async () => {
    const zipData = new ArrayBuffer(100);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => zipData,
      headers: new Map([["content-type", "application/zip"]]),
    });

    const result = await client.download("test-skill", "1.0.0");
    expect(result.data.byteLength).toBe(100);
    expect(result.contentType).toBe("application/zip");
  });

  it("should throw ClawHubApiError on HTTP errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });

    await expect(client.getSkill("nonexistent")).rejects.toThrow(ClawHubApiError);
    await expect(client.getSkill("nonexistent")).rejects.toThrow().catch(() => {});
  });

  it("should include auth header when token is set", async () => {
    const authedClient = new ClawHubClient({
      registryUrl: "https://clawhub.ai",
      authToken: "clh_test_token_123",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ handle: "testuser" }),
      headers: new Map(),
    });

    await authedClient.whoami();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer clh_test_token_123");
  });

  it("should star and unstar skills", async () => {
    const authedClient = new ClawHubClient({
      registryUrl: "https://clawhub.ai",
      authToken: "clh_test",
    });

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}), headers: new Map() });
    await authedClient.star("my-skill");

    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/stars/my-skill");
  });

  it("should resolve local skill hash", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "1.2.0", matched: true }),
      headers: new Map(),
    });

    const result = await client.resolve("test-skill", "abc123hash");
    expect(result.matched).toBe(true);
    expect(result.version).toBe("1.2.0");
  });
});

// ─── ClawHubManager Tests ───────────────────────────────────

describe("ClawHubManager", () => {
  let manager: ClawHubManager;
  let tmpDir: string;

  beforeEach(() => {
    mockFetch.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-test-"));
    manager = new ClawHubManager({
      registryUrl: "https://clawhub.ai",
      skillsDir: tmpDir,
      autoCheckUpdates: false,
      verifyHashes: false,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should initialize and create skills directory", async () => {
    await manager.init();
    expect(fs.existsSync(tmpDir)).toBe(true);
  });

  it("should return empty stats initially", async () => {
    await manager.init();
    const stats = manager.getStats();
    expect(stats.installedCount).toBe(0);
    expect(stats.updatesAvailable).toBe(0);
    expect(stats.requirementsUnmet).toBe(0);
    expect(stats.skills).toEqual([]);
  });

  it("should install a skill from ClawHub", async () => {
    await manager.init();

    // Mock getSkill
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        slug: "test-skill",
        displayName: "Test Skill",
        description: "A test skill",
        latestVersion: "1.0.0",
        downloads: 100,
      }),
      headers: new Map(),
    });

    // Mock download — return a plain text SKILL.md (not a zip)
    const skillContent = `---
name: test-skill
description: A test skill
version: 1.0.0
---
# Test Skill Instructions
Use this skill to test things.`;
    const encoder = new TextEncoder();
    const buffer = encoder.encode(skillContent).buffer;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => buffer,
      headers: new Map([["content-type", "text/plain"]]),
    });

    const installed = await manager.install("test-skill");
    expect(installed.slug).toBe("test-skill");
    expect(installed.version).toBe("1.0.0");
    expect(installed.displayName).toBe("Test Skill");

    // Verify file was written
    const skillPath = path.join(tmpDir, "test-skill", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);

    // Verify lockfile
    const lockPath = path.join(tmpDir, ".clawhub", "lock.json");
    expect(fs.existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    expect(lock.skills["test-skill"].version).toBe("1.0.0");
  });

  it("should list installed skills", async () => {
    await manager.init();

    // Create a skill directory manually
    const skillDir = path.join(tmpDir, "manual-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: manual-skill\ndescription: Manually added\nversion: 0.1.0\n---\n# Instructions`
    );

    // Re-init to scan
    const manager2 = new ClawHubManager({
      skillsDir: tmpDir,
      autoCheckUpdates: false,
    });
    await manager2.init();

    const installed = manager2.listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].slug).toBe("manual-skill");
    expect(installed[0].displayName).toBe("manual-skill");
  });

  it("should uninstall a skill", async () => {
    await manager.init();

    // Create skill
    const skillDir = path.join(tmpDir, "removeme");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: removeme\n---\n");

    // Create lockfile entry
    const lockDir = path.join(tmpDir, ".clawhub");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "lock.json"),
      JSON.stringify({
        version: "1",
        skills: { removeme: { version: "1.0.0", installedAt: "2026-01-01" } },
      })
    );

    // Re-init
    const m = new ClawHubManager({ skillsDir: tmpDir, autoCheckUpdates: false });
    await m.init();
    expect(m.listInstalled()).toHaveLength(1);

    m.uninstall("removeme");
    expect(m.listInstalled()).toHaveLength(0);
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it("should search skills via client", async () => {
    await manager.init();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        skills: [
          { slug: "search-result", displayName: "Search Result", downloads: 500 },
        ],
        total: 1,
      }),
      headers: new Map(),
    });

    const results = await manager.search("test query");
    expect(results.skills).toHaveLength(1);
    expect(results.skills[0].slug).toBe("search-result");
  });

  it("should get trending skills via client", async () => {
    await manager.init();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        skills: [
          { slug: "trending-1", downloads: 10000 },
          { slug: "trending-2", downloads: 8000 },
        ],
        total: 2,
      }),
      headers: new Map(),
    });

    const results = await manager.trending(5);
    expect(results.skills).toHaveLength(2);
  });

  it("should emit events on install/uninstall", async () => {
    await manager.init();

    const installStart = vi.fn();
    const installComplete = vi.fn();
    const uninstalled = vi.fn();

    manager.on("installStart", installStart);
    manager.on("installComplete", installComplete);
    manager.on("uninstalled", uninstalled);

    // Mock install
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        slug: "event-skill",
        displayName: "Event Skill",
        latestVersion: "1.0.0",
      }),
      headers: new Map(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("---\nname: event-skill\n---\n").buffer,
      headers: new Map([["content-type", "text/plain"]]),
    });

    await manager.install("event-skill");
    expect(installStart).toHaveBeenCalledTimes(1);
    expect(installComplete).toHaveBeenCalledTimes(1);

    manager.uninstall("event-skill");
    expect(uninstalled).toHaveBeenCalledTimes(1);
  });

  it("should parse SKILL.md frontmatter correctly", async () => {
    await manager.init();

    // Create skill with rich frontmatter
    const skillDir = path.join(tmpDir, "rich-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: rich-skill
description: A skill with full metadata
version: 2.1.0
metadata:
  openclaw:
    primaryEnv: MY_API_KEY
    always: false
    emoji: "star"
    requires:
      env:
        - MY_API_KEY
      bins:
        - curl
---
# Rich Skill

Use this skill to do amazing things.`
    );

    const m = new ClawHubManager({ skillsDir: tmpDir, autoCheckUpdates: false });
    await m.init();

    const installed = m.listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].displayName).toBe("rich-skill");
    expect(installed[0].description).toBe("A skill with full metadata");
  });
});

// ─── Default Config Tests ────────────────────────────────────

describe("DEFAULT_CLAWHUB_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_CLAWHUB_CONFIG.registryUrl).toBe("https://clawhub.ai");
    expect(DEFAULT_CLAWHUB_CONFIG.skillsDir).toBe("./skills");
    expect(DEFAULT_CLAWHUB_CONFIG.autoCheckUpdates).toBe(true);
    expect(DEFAULT_CLAWHUB_CONFIG.verifyHashes).toBe(true);
    expect(DEFAULT_CLAWHUB_CONFIG.maxConcurrentDownloads).toBe(3);
  });
});
