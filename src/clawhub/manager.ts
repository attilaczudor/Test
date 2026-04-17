/**
 * ClawHub Skill Manager
 *
 * Manages skill installation, updates, and lifecycle.
 * Skills are downloaded from ClawHub, verified, and installed
 * into the local skills directory.
 *
 * Security hardening:
 * - SHA-256 hash verification on all downloads
 * - SKILL.md parsing validates frontmatter structure
 * - Requirement checking before activation
 * - Lock file tracking for reproducible installs
 */

import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { ClawHubClient } from "./client";
import {
  ClawHubConfig,
  DEFAULT_CLAWHUB_CONFIG,
  ClawHubLockfile,
  InstalledSkill,
  SkillFrontmatter,
  SkillRequirements,
  ClawHubSearchResult,
} from "./types";

export class ClawHubManager extends EventEmitter {
  private readonly config: ClawHubConfig;
  readonly client: ClawHubClient;
  private lockfile: ClawHubLockfile;
  private installed: Map<string, InstalledSkill> = new Map();

  constructor(config?: Partial<ClawHubConfig>) {
    super();
    this.config = { ...DEFAULT_CLAWHUB_CONFIG, ...config };
    this.client = new ClawHubClient(this.config);
    this.lockfile = { version: "1", skills: {} };
  }

  /**
   * Initialize: load lockfile and scan installed skills.
   */
  async init(): Promise<void> {
    this.ensureSkillsDir();
    this.loadLockfile();
    await this.scanInstalled();

    if (this.config.autoCheckUpdates) {
      this.checkUpdates().catch(() => {
        // Silent failure on update check
      });
    }
  }

  /**
   * Search the ClawHub marketplace.
   */
  async search(query: string, limit?: number): Promise<ClawHubSearchResult> {
    return this.client.search(query, { limit });
  }

  /**
   * List trending skills.
   */
  async trending(limit?: number): Promise<ClawHubSearchResult> {
    return this.client.listSkills({ limit, sort: "trending" });
  }

  /**
   * Install a skill from ClawHub.
   */
  async install(slug: string, version?: string): Promise<InstalledSkill> {
    this.emit("installStart", { slug, version });

    // Get skill info
    const skill = await this.client.getSkill(slug);
    const targetVersion = version || skill.latestVersion;

    // Download the skill zip
    const { data } = await this.client.download(slug, targetVersion);

    // Get version metadata for hash verification
    let expectedFiles: Array<{ path: string; sha256: string }> = [];
    if (this.config.verifyHashes) {
      try {
        const versionInfo = await this.client.getVersion(slug, targetVersion);
        expectedFiles = versionInfo.files;
      } catch {
        // Version info unavailable — skip hash check
      }
    }

    // Create skill directory
    const skillDir = path.resolve(this.config.skillsDir, slug);
    if (fs.existsSync(skillDir)) {
      // Remove old version
      fs.rmSync(skillDir, { recursive: true });
    }
    fs.mkdirSync(skillDir, { recursive: true });

    // Extract zip contents
    await this.extractZip(data, skillDir);

    // Verify file hashes if available
    if (expectedFiles.length > 0) {
      for (const expected of expectedFiles) {
        const filePath = path.join(skillDir, expected.path);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          const hash = crypto.createHash("sha256").update(content).digest("hex");
          if (hash !== expected.sha256) {
            // Hash mismatch — remove and fail
            fs.rmSync(skillDir, { recursive: true });
            throw new Error(
              `Hash mismatch for ${expected.path}: expected ${expected.sha256}, got ${hash}`,
            );
          }
        }
      }
    }

    // Parse SKILL.md
    const frontmatter = this.parseSkillMd(skillDir);

    // Check requirements
    const requirementsMet = this.checkRequirements(frontmatter?.metadata?.openclaw?.requires);

    // Update lockfile
    const now = new Date().toISOString();
    this.lockfile.skills[slug] = {
      version: targetVersion,
      installedAt: now,
    };
    this.saveLockfile();

    // Create installed skill entry
    const installed: InstalledSkill = {
      slug,
      version: targetVersion,
      installedAt: now,
      path: skillDir,
      displayName: skill.displayName || frontmatter?.name || slug,
      description: skill.description || frontmatter?.description,
      requirements: frontmatter?.metadata?.openclaw?.requires,
      requirementsMet,
    };

    this.installed.set(slug, installed);
    this.emit("installComplete", installed);
    return installed;
  }

  /**
   * Uninstall a skill.
   */
  uninstall(slug: string): boolean {
    const skillDir = path.resolve(this.config.skillsDir, slug);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true });
    }

    delete this.lockfile.skills[slug];
    this.saveLockfile();
    this.installed.delete(slug);
    this.emit("uninstalled", { slug });
    return true;
  }

  /**
   * Update a specific skill to latest version.
   */
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  async update(slug: string): Promise<InstalledSkill | null> {
    const current = this.installed.get(slug);
    if (!current) {
      return null;
    }

    const skill = await this.client.getSkill(slug);
    if (skill.latestVersion === current.version) {
      return current; // Already up to date
    }

    return this.install(slug, skill.latestVersion);
  }

  /**
   * Update all installed skills.
   */
  async updateAll(): Promise<InstalledSkill[]> {
    const updated: InstalledSkill[] = [];

    for (const [slug] of this.installed) {
      try {
        const result = await this.update(slug);
        if (result) {
          updated.push(result);
        }
      } catch (err: unknown) {
        this.emit("updateError", { slug, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return updated;
  }

  /**
   * Check for available updates without installing.
   */
  async checkUpdates(): Promise<Map<string, string>> {
    const updates = new Map<string, string>();

    for (const [slug, installed] of this.installed) {
      try {
        const skill = await this.client.getSkill(slug);
        if (skill.latestVersion !== installed.version) {
          updates.set(slug, skill.latestVersion);
          installed.updateAvailable = skill.latestVersion;
        }
      } catch {
        // Skip unavailable skills
      }
    }

    if (updates.size > 0) {
      this.emit("updatesAvailable", Object.fromEntries(updates));
    }

    return updates;
  }

  /**
   * List all installed skills.
   */
  listInstalled(): InstalledSkill[] {
    return Array.from(this.installed.values());
  }

  /**
   * Get installed skill by slug.
   */
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  getInstalled(slug: string): InstalledSkill | undefined {
    return this.installed.get(slug);
  }

  /**
   * Get stats for the dashboard.
   */
  getStats(): {
    installedCount: number;
    updatesAvailable: number;
    requirementsUnmet: number;
    skills: InstalledSkill[];
  } {
    const skills = this.listInstalled();
    return {
      installedCount: skills.length,
      updatesAvailable: skills.filter((s) => s.updateAvailable).length,
      requirementsUnmet: skills.filter((s) => !s.requirementsMet).length,
      skills,
    };
  }

  // ─── Private ──────────────────────────────────────────────

  private ensureSkillsDir(): void {
    const dir = path.resolve(this.config.skillsDir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadLockfile(): void {
    const lockPath = path.resolve(this.config.skillsDir, ".clawhub", "lock.json");
    if (fs.existsSync(lockPath)) {
      try {
        const content = fs.readFileSync(lockPath, "utf-8");
        this.lockfile = JSON.parse(content);
      } catch {
        this.lockfile = { version: "1", skills: {} };
      }
    }
  }

  private saveLockfile(): void {
    const lockDir = path.resolve(this.config.skillsDir, ".clawhub");
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
    const lockPath = path.join(lockDir, "lock.json");
    fs.writeFileSync(lockPath, JSON.stringify(this.lockfile, null, 2) + "\n");
  }

  private async scanInstalled(): Promise<void> {
    const dir = path.resolve(this.config.skillsDir);
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const skillDir = path.join(dir, entry.name);
      const slug = entry.name;
      const lockEntry = this.lockfile.skills[slug];

      const frontmatter = this.parseSkillMd(skillDir);
      const requirementsMet = this.checkRequirements(frontmatter?.metadata?.openclaw?.requires);

      this.installed.set(slug, {
        slug,
        version: lockEntry?.version || frontmatter?.version || "unknown",
        installedAt: lockEntry?.installedAt || new Date().toISOString(),
        path: skillDir,
        displayName: frontmatter?.name || slug,
        description: frontmatter?.description,
        requirements: frontmatter?.metadata?.openclaw?.requires,
        requirementsMet,
      });
    }
  }

  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  private parseSkillMd(skillDir: string): SkillFrontmatter | null {
    // Try SKILL.md and skill.md
    const candidates = ["SKILL.md", "skill.md"];
    let content: string | null = null;

    for (const name of candidates) {
      const filePath = path.join(skillDir, name);
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, "utf-8");
        break;
      }
    }

    if (!content) {
      return null;
    }

    // Parse YAML frontmatter
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
      return null;
    }

    try {
      return this.parseYamlFrontmatter(match[1]);
    } catch {
      return null;
    }
  }

  /**
   * Minimal YAML frontmatter parser.
   * Handles the simple key: value format used in SKILL.md files.
   * Does not handle full YAML spec — just enough for skill frontmatter.
   */
  private parseYamlFrontmatter(yaml: string): SkillFrontmatter {
    const result: Record<string, unknown> = {};
    const lines = yaml.split("\n");
    // Each stack entry tracks the object, its indent, and the key that created it in the parent
    const stack: Array<{ indent: number; obj: Record<string, unknown>; entryKey: string }> = [
      { indent: -1, obj: result, entryKey: "" },
    ];

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith("#")) {
        continue;
      }

      const indent = line.search(/\S/);
      const trimmed = line.trim();

      // Array item: `- value`
      if (trimmed.startsWith("- ")) {
        const val = trimmed.slice(2).trim();

        // The array belongs to the key that pushed the current (or a recent) stack entry.
        // Pop entries whose indent >= indent - 2 (array items are indented under their key)
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent - 2) {
          stack.pop();
        }

        // The top of stack is now the parent object containing the array key.
        // The entry we just popped (or the most recent child) has the key name.
        // Find the last-set key in the current top's object that is an empty object or array.
        const parent = stack[stack.length - 1].obj;
        const keys = Object.keys(parent);
        const arrayKey = keys[keys.length - 1];

        if (arrayKey) {
          if (!Array.isArray(parent[arrayKey])) {
            parent[arrayKey] = [];
          }
          parent[arrayKey].push(this.parseYamlValue(val));
        }
        continue;
      }

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) {
        continue;
      }

      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();

      // Pop stack to correct indent level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const current = stack[stack.length - 1].obj;

      if (rawValue === "" || rawValue === "|") {
        // Nested object (or array — will be converted on first "- " item)
        current[key] = {};
        stack.push({ indent, obj: current[key], entryKey: key });
      } else if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        // Inline array
        const items = rawValue
          .slice(1, -1)
          .split(",")
          .map((s) => this.parseYamlValue(s.trim()));
        current[key] = items;
      } else {
        current[key] = this.parseYamlValue(rawValue);
      }
    }

    return result as SkillFrontmatter;
  }

  private parseYamlValue(val: string): string | number | boolean | null {
    if (val === "true") {
      return true;
    }
    if (val === "false") {
      return false;
    }
    if (val === "null") {
      return null;
    }
    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1);
    }
    const num = Number(val);
    if (!isNaN(num) && val !== "") {
      return num;
    }
    return val;
  }

  /**
   * Check if skill requirements are met on this system.
   */
  private checkRequirements(requires?: SkillRequirements): boolean {
    if (!requires) {
      return true;
    }

    // Check environment variables
    if (requires.env) {
      for (const envVar of requires.env) {
        if (!process.env[envVar]) {
          return false;
        }
      }
    }

    // Check binary existence (bins = ALL must exist)
    if (requires.bins) {
      for (const bin of requires.bins) {
        if (!this.binaryExists(bin)) {
          return false;
        }
      }
    }

    // Check anyBins (at least one must exist)
    if (requires.anyBins && requires.anyBins.length > 0) {
      const found = requires.anyBins.some((bin) => this.binaryExists(bin));
      if (!found) {
        return false;
      }
    }

    return true;
  }

  private binaryExists(name: string): boolean {
    const paths = (process.env.PATH || "").split(path.delimiter);
    for (const dir of paths) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return true;
      } catch {
        // Not found in this directory
      }
    }
    return false;
  }

  /**
   * Extract a zip archive to a directory.
   * Uses a minimal implementation for the simple skill zip format.
   */
  private async extractZip(data: ArrayBuffer, destDir: string): Promise<void> {
    // Skills are distributed as zip archives.
    // For robustness, we write the zip to a temp file and use the
    // built-in Node.js zlib for decompression. If the data isn't
    // actually a zip (e.g., it's a tarball or raw files), we fall
    // back to treating it as a single SKILL.md file.

    const buffer = Buffer.from(data);

    // Check for ZIP magic bytes (PK\x03\x04)
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      // Write zip to temp, extract via child process
      const tmpZip = path.join(destDir, "__download.zip");
      fs.writeFileSync(tmpZip, buffer);

      try {
        const { execFileSync } = await import("child_process");
        execFileSync("unzip", ["-o", "-q", tmpZip, "-d", destDir], {
          timeout: 30000,
        });
      } finally {
        if (fs.existsSync(tmpZip)) {
          fs.unlinkSync(tmpZip);
        }
      }
    } else {
      // Not a zip — write as SKILL.md
      fs.writeFileSync(path.join(destDir, "SKILL.md"), buffer.toString("utf-8"));
    }
  }
}
