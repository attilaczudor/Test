/**
 * ClawHub Types — Skill Marketplace Integration
 *
 * Types for the ClawHub API (https://clawhub.ai), the official
 * OpenClaw skill marketplace. Provides search, install, update,
 * and version management for community-built skills.
 *
 * Security note: After the ClawHavoc incident (Feb 2026, 341 malicious skills),
 * ClawHub now requires VirusTotal scanning. We add our own verification layer.
 */

// ─── API Discovery ──────────────────────────────────────────

export interface ClawHubWellKnown {
  apiBase: string;
  authBase?: string;
  minCliVersion?: string;
}

// ─── Skill Metadata ─────────────────────────────────────────

export interface SkillRequirements {
  env?: string[];       // Environment variables needed
  bins?: string[];      // All binaries must exist
  anyBins?: string[];   // At least one must exist
  config?: string[];    // Config file paths
}

export interface SkillInstallSpec {
  kind: "brew" | "node" | "go" | "uv";
  label?: string;
  formula?: string;   // brew
  tap?: string;        // brew
  package?: string;    // node/go/uv
  module?: string;     // go
  bins?: string[];     // expected binaries after install
}

export interface SkillOpenClawMetadata {
  requires?: SkillRequirements;
  primaryEnv?: string;
  always?: boolean;
  skillKey?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  install?: SkillInstallSpec[];
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  metadata?: {
    openclaw?: SkillOpenClawMetadata;
  };
}

// ─── API Responses ──────────────────────────────────────────

export interface ClawHubSkill {
  slug: string;
  displayName: string;
  description: string;
  owner: {
    handle: string;
    displayName?: string;
    avatarUrl?: string;
  };
  latestVersion: string;
  downloads: number;
  installs: number;
  stars: number;
  highlighted: boolean;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface ClawHubSkillVersion {
  version: string;
  changelog?: string;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    contentType?: string;
  }>;
  publishedAt: string;
  source?: {
    kind: "github";
    url: string;
    repo: string;
    ref: string;
    commit: string;
  };
}

export interface ClawHubSearchResult {
  skills: ClawHubSkill[];
  total: number;
  cursor?: string;
}

// ─── Local State ────────────────────────────────────────────

export interface InstalledSkill {
  slug: string;
  version: string;
  installedAt: string;
  path: string;
  displayName?: string;
  description?: string;
  requirements?: SkillRequirements;
  requirementsMet: boolean;
  updateAvailable?: string;  // newer version available
}

export interface ClawHubLockfile {
  version: "1";
  skills: Record<string, {
    version: string;
    installedAt: string;
  }>;
}

// ─── Manager Config ─────────────────────────────────────────

export interface ClawHubConfig {
  /** ClawHub registry URL (default: https://clawhub.ai) */
  registryUrl: string;

  /** Directory to install skills into (default: ./skills) */
  skillsDir: string;

  /** Auth token for publish/star (optional, clh_...) */
  authToken?: string;

  /** Auto-check for updates on startup (default: true) */
  autoCheckUpdates: boolean;

  /** Verify SHA-256 hashes after download (default: true) */
  verifyHashes: boolean;

  /** Max concurrent downloads (default: 3) */
  maxConcurrentDownloads: number;
}

export const DEFAULT_CLAWHUB_CONFIG: ClawHubConfig = {
  registryUrl: "https://clawhub.ai",
  skillsDir: "./skills",
  autoCheckUpdates: true,
  verifyHashes: true,
  maxConcurrentDownloads: 3,
};
