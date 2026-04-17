/**
 * ClawHub API Client
 *
 * HTTP client for the ClawHub skill marketplace (https://clawhub.ai).
 * Handles search, skill details, version listing, and downloads.
 *
 * Security: All downloads are verified via SHA-256 hashes.
 * Rate limits: 120 reads/min, 20 downloads/min per IP.
 */

import {
  ClawHubConfig,
  DEFAULT_CLAWHUB_CONFIG,
  ClawHubWellKnown,
  ClawHubSkill,
  ClawHubSkillVersion,
  ClawHubSearchResult,
} from "./types";

export class ClawHubClient {
  private readonly config: ClawHubConfig;
  private apiBase: string;

  constructor(config?: Partial<ClawHubConfig>) {
    this.config = { ...DEFAULT_CLAWHUB_CONFIG, ...config };
    this.apiBase = this.config.registryUrl;
  }

  /**
   * Discover registry configuration via .well-known endpoint.
   */
  async discover(): Promise<ClawHubWellKnown> {
    const res = await this.fetch("/.well-known/clawhub.json");
    const data = (await res.json()) as ClawHubWellKnown;
    if (data.apiBase) {
      this.apiBase = data.apiBase;
    }
    return data;
  }

  /**
   * Search skills using semantic/vector search.
   */
  async search(
    query: string,
    options?: { limit?: number; highlightedOnly?: boolean }
  ): Promise<ClawHubSearchResult> {
    const params = new URLSearchParams({
      q: query,
      limit: String(options?.limit || 20),
    });
    if (options?.highlightedOnly) {
      params.set("highlightedOnly", "true");
    }

    const res = await this.fetch(`/api/v1/search?${params}`);
    return (await res.json()) as ClawHubSearchResult;
  }

  /**
   * List skills with sorting and pagination.
   */
  async listSkills(options?: {
    limit?: number;
    cursor?: string;
    sort?: "updated" | "downloads" | "stars" | "installs" | "trending";
  }): Promise<ClawHubSearchResult> {
    const params = new URLSearchParams({
      limit: String(options?.limit || 20),
      sort: options?.sort || "trending",
    });
    if (options?.cursor) {
      params.set("cursor", options.cursor);
    }

    const res = await this.fetch(`/api/v1/skills?${params}`);
    return (await res.json()) as ClawHubSearchResult;
  }

  /**
   * Get skill details including owner and latest version.
   */
  async getSkill(slug: string): Promise<ClawHubSkill> {
    const res = await this.fetch(`/api/v1/skills/${encodeURIComponent(slug)}`);
    return (await res.json()) as ClawHubSkill;
  }

  /**
   * Get versions for a skill.
   */
  async getVersions(
    slug: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<{ versions: ClawHubSkillVersion[]; cursor?: string }> {
    const params = new URLSearchParams({
      limit: String(options?.limit || 10),
    });
    if (options?.cursor) {
      params.set("cursor", options.cursor);
    }

    const res = await this.fetch(
      `/api/v1/skills/${encodeURIComponent(slug)}/versions?${params}`
    );
    return (await res.json()) as { versions: ClawHubSkillVersion[]; cursor?: string };
  }

  /**
   * Get a specific version's metadata and file list.
   */
  async getVersion(
    slug: string,
    version: string
  ): Promise<ClawHubSkillVersion> {
    const res = await this.fetch(
      `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`
    );
    return (await res.json()) as ClawHubSkillVersion;
  }

  /**
   * Get raw file content from a skill.
   */
  async getFile(
    slug: string,
    path: string,
    version?: string
  ): Promise<string> {
    const params = new URLSearchParams({ path });
    if (version) {
      params.set("version", version);
    }

    const res = await this.fetch(
      `/api/v1/skills/${encodeURIComponent(slug)}/file?${params}`
    );
    return res.text();
  }

  /**
   * Download a skill version as a zip buffer.
   */
  async download(
    slug: string,
    version?: string
  ): Promise<{ data: ArrayBuffer; contentType: string }> {
    const params = new URLSearchParams({ slug });
    if (version) {
      params.set("version", version);
    }

    const res = await this.fetch(`/api/v1/download?${params}`);
    const data = await res.arrayBuffer();
    return {
      data,
      contentType: res.headers.get("content-type") || "application/zip",
    };
  }

  /**
   * Resolve a local skill's hash to a known ClawHub version.
   */
  async resolve(
    slug: string,
    hash: string
  ): Promise<{ version?: string; matched: boolean }> {
    const params = new URLSearchParams({ slug, hash });
    const res = await this.fetch(`/api/v1/resolve?${params}`);
    return (await res.json()) as { version?: string; matched: boolean };
  }

  /**
   * Star a skill (requires auth).
   */
  async star(slug: string): Promise<void> {
    await this.fetch(`/api/v1/stars/${encodeURIComponent(slug)}`, {
      method: "POST",
      auth: true,
    });
  }

  /**
   * Unstar a skill (requires auth).
   */
  async unstar(slug: string): Promise<void> {
    await this.fetch(`/api/v1/stars/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      auth: true,
    });
  }

  /**
   * Validate the auth token and return user info.
   */
  async whoami(): Promise<{ handle: string }> {
    const res = await this.fetch("/api/v1/whoami", { auth: true });
    return (await res.json()) as { handle: string };
  }

  // ─── Private ──────────────────────────────────────────────

  private async fetch(
    path: string,
    options?: { method?: string; auth?: boolean; body?: unknown }
  ): Promise<Response> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (options?.auth && this.config.authToken) {
      headers.Authorization = `Bearer ${this.config.authToken}`;
    }

    if (options?.body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await globalThis.fetch(url, {
      method: options?.method || "GET",
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ClawHubApiError(
        `ClawHub API ${res.status}: ${text.slice(0, 200)}`,
        res.status,
        path
      );
    }

    return res;
  }
}

export class ClawHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string
  ) {
    super(message);
    this.name = "ClawHubApiError";
  }
}
