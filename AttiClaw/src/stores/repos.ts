import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Plugin Meta ──────────────────────────────────────────────────────────────

export type PluginType = "claw" | "skill" | "tool" | "resource" | "extension";

export interface PluginCapability {
  id: string;
  name: string;
  description: string;
}

export interface PluginMeta {
  type: PluginType;
  version?: string;
  capabilities: PluginCapability[];
  entrypoint?: string; // e.g. "src/index.ts"
  isCore?: boolean; // true for openclaw/openclaw — AttiClaw's own base
}

// ── Update Plan ──────────────────────────────────────────────────────────────

export type UpdateImpact = "low" | "medium" | "high";

export interface UpdatePlan {
  sourceId: string;
  sourceName: string;
  gitCommitMessage: string;
  summary: string;
  changes: string[];
  estimatedImpact: UpdateImpact;
  createdAt: number;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RepoLabel {
  id: string;
  name: string;
  color: string; // Tailwind color class suffix, e.g. "orange", "purple"
  isBuiltIn: boolean;
}

export interface RepoSource {
  id: string;
  name: string;
  url: string;
  description: string;
  labels: string[]; // Label IDs
  stars?: number;
  language?: string;
  owner?: string;
  addedAt: number;
  isPinned: boolean;
  forkUrl?: string;
  upstreamUrl?: string;
  isSubmodule: boolean;
  submodulePath?: string;

  // Plugin system
  pluginMeta?: PluginMeta;

  // Update tracking
  currentVersion?: string;
  latestVersion?: string;
  lastUpdated?: number;
  updateAvailable?: boolean;

  implementationStatus?: "implemented" | "deferred";
  implementedAt?: number;
  isActive?: boolean;
}

// ── State ────────────────────────────────────────────────────────────────────

interface ReposState {
  sources: RepoSource[];
  labels: RepoLabel[];
  selectedLabel: string | null; // null = show all
  searchQuery: string;

  // Update flow
  pendingUpdateId: string | null;
  updatePlan: UpdatePlan | null;
  implementingUpdateId: string | null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

interface ReposActions {
  setSelectedLabel: (labelId: string | null) => void;
  setSearchQuery: (query: string) => void;
  getFilteredSources: () => RepoSource[];

  // Source management
  addSource: (source: Omit<RepoSource, "addedAt">) => void;
  removeSource: (id: string) => void;
  updateSource: (id: string, updates: Partial<RepoSource>) => void;
  togglePin: (id: string) => void;
  addLabelToSource: (sourceId: string, labelId: string) => void;
  removeLabelFromSource: (sourceId: string, labelId: string) => void;
  setImplementationStatus: (id: string, status: "implemented" | "deferred") => void;
  toggleActive: (id: string) => void;

  // Label management
  createLabel: (name: string, color: string) => RepoLabel;
  updateLabel: (id: string, updates: Partial<Pick<RepoLabel, "name" | "color">>) => void;
  deleteLabel: (id: string) => void;

  // Update flow
  triggerUpdate: (id: string) => void;
  implementUpdate: (id: string) => void;
  dismissUpdate: () => void;
}

// ── Default Labels ──────────────────────────────────────────────────────────

const DEFAULT_LABELS: RepoLabel[] = [
  { id: "claw", name: "Claw", color: "orange", isBuiltIn: true },
  { id: "skill", name: "Skill", color: "purple", isBuiltIn: true },
  { id: "tool", name: "Tool", color: "blue", isBuiltIn: true },
  { id: "resource", name: "Resource", color: "green", isBuiltIn: true },
];

// ── Plan generator ───────────────────────────────────────────────────────────

function buildUpdatePlan(source: RepoSource): UpdatePlan {
  const isCore = source.pluginMeta?.isCore;
  const isSubmodule = source.isSubmodule;
  const name = source.name;
  const upstream = source.upstreamUrl ?? source.url;

  const changes: string[] = [];

  if (isSubmodule) {
    changes.push(`git submodule update --remote ${source.submodulePath ?? source.id}`);
    changes.push(`Merge upstream commits from ${upstream}`);
    changes.push(`Run post-update hooks (lint, type-check)`);
    changes.push(`git add ${source.submodulePath ?? source.id} && git commit`);
  } else if (isCore) {
    changes.push(`git fetch upstream main`);
    changes.push(`git merge upstream/main --no-edit`);
    changes.push(`Rebuild AttiClaw plugin manifest`);
    changes.push(`git push origin claude/fork-openclaw-atticlaw-DIDcw`);
  } else {
    changes.push(`Fetch latest release/tag from ${upstream}`);
    changes.push(`Diff and apply upstream changes to local fork`);
    changes.push(`Update plugin manifest entry for "${name}"`);
    changes.push(`git add -p && git commit`);
  }

  const impact: UpdateImpact = isCore ? "high" : isSubmodule ? "medium" : "low";

  const summary = isCore
    ? `Sync AttiClaw's openclaw core from upstream. This updates the foundation that all plugins depend on. Review breaking changes before implementing.`
    : isSubmodule
      ? `Pull the latest commits from the upstream ${name} repository into your local fork submodule. Conflicts may need manual resolution.`
      : `Refresh the "${name}" plugin entry with the latest release metadata and update the local fork if one exists.`;

  return {
    sourceId: source.id,
    sourceName: name,
    gitCommitMessage: `feat(repos): sync ${name.toLowerCase().replace(/\s+/g, "-")} from upstream`,
    summary,
    changes,
    estimatedImpact: impact,
    createdAt: Date.now(),
  };
}

// ── Default Sources ─────────────────────────────────────────────────────────

const DEFAULT_SOURCES: RepoSource[] = [
  // ── Claws ───────────────────────────────────────────────────────────
  {
    id: "openclaw/openclaw",
    name: "OpenClaw",
    url: "https://github.com/openclaw/openclaw",
    description:
      "Core autonomous agency framework — council-gated escalation, local-first inference, persistent memory, modular skills",
    labels: ["claw"],
    stars: 12400,
    language: "TypeScript",
    owner: "openclaw",
    addedAt: Date.now(),
    isPinned: true,
    forkUrl: "https://github.com/attilaczudor/openclaw",
    upstreamUrl: "https://github.com/openclaw/openclaw",
    isSubmodule: false,
    currentVersion: "0.11.0",
    pluginMeta: {
      type: "claw",
      version: "0.11.0",
      isCore: true,
      capabilities: [
        { id: "council", name: "Council", description: "Human-in-the-loop approval gates" },
        { id: "memory", name: "Memory", description: "Persistent graph-based memory" },
        { id: "rbac", name: "RBAC", description: "Fine-grained role-based access control" },
        { id: "mcp", name: "MCP Skills", description: "Model Context Protocol skill loading" },
      ],
    },
  },
  {
    id: "valuecell-ai/clawx",
    name: "ClawX",
    url: "https://github.com/ValueCell-ai/ClawX",
    description:
      "Electron desktop app for OpenClaw — tab-based dashboard with council, providers, skills, memory management",
    labels: ["claw"],
    stars: 0,
    language: "TypeScript",
    owner: "ValueCell-ai",
    addedAt: Date.now(),
    isPinned: true,
    forkUrl: "https://github.com/attilaczudor/ClawX",
    upstreamUrl: "https://github.com/ValueCell-ai/ClawX",
    isSubmodule: true,
    submodulePath: "repos/clawx",
    pluginMeta: {
      type: "claw",
      capabilities: [
        { id: "desktop-ui", name: "Desktop UI", description: "Electron-based desktop interface" },
      ],
    },
  },
  {
    id: "nearai/ironclaw",
    name: "IronClaw",
    url: "https://github.com/nearai/ironclaw",
    description: "AI agent infrastructure and orchestration framework by Near AI",
    labels: ["claw"],
    stars: 0,
    language: "TypeScript",
    owner: "nearai",
    addedAt: Date.now(),
    isPinned: false,
    forkUrl: "https://github.com/attilaczudor/ironclaw",
    upstreamUrl: "https://github.com/nearai/ironclaw",
    isSubmodule: true,
    submodulePath: "repos/ironclaw",
    pluginMeta: {
      type: "claw",
      capabilities: [
        {
          id: "orchestration",
          name: "Orchestration",
          description: "Multi-agent task orchestration",
        },
      ],
    },
  },
  {
    id: "zeroclaw-labs/zeroclaw",
    name: "ZeroClaw",
    url: "https://github.com/zeroclaw-labs/zeroclaw",
    description: "Zero-shot agent framework — build AI agents without training data or fine-tuning",
    labels: ["claw"],
    stars: 0,
    language: "TypeScript",
    owner: "zeroclaw-labs",
    addedAt: Date.now(),
    isPinned: false,
    forkUrl: "https://github.com/attilaczudor/zeroclaw",
    upstreamUrl: "https://github.com/zeroclaw-labs/zeroclaw",
    isSubmodule: true,
    submodulePath: "repos/zeroclaw",
    pluginMeta: {
      type: "claw",
      capabilities: [
        { id: "zero-shot", name: "Zero-Shot", description: "No-training agent execution" },
      ],
    },
  },
  {
    id: "sipeed/picoclaw",
    name: "PicoClaw",
    url: "https://github.com/sipeed/picoclaw",
    description:
      "Hardware-accelerated AI on RISC-V — edge deployment for resource-constrained devices",
    labels: ["claw"],
    stars: 890,
    language: "C",
    owner: "sipeed",
    addedAt: Date.now(),
    isPinned: false,
    forkUrl: "https://github.com/attilaczudor/picoclaw",
    upstreamUrl: "https://github.com/sipeed/picoclaw",
    isSubmodule: true,
    submodulePath: "repos/picoclaw",
    pluginMeta: {
      type: "claw",
      capabilities: [
        {
          id: "edge-inference",
          name: "Edge Inference",
          description: "RISC-V hardware-accelerated AI",
        },
      ],
    },
  },
  {
    id: "hkuds/nanobot",
    name: "NanoBot",
    url: "https://github.com/HKUDS/nanobot",
    description: "Lightweight composable agent framework — minimal footprint, maximum flexibility",
    labels: ["claw"],
    stars: 2100,
    language: "Python",
    owner: "HKUDS",
    addedAt: Date.now(),
    isPinned: false,
    forkUrl: "https://github.com/attilaczudor/nanobot",
    upstreamUrl: "https://github.com/HKUDS/nanobot",
    isSubmodule: true,
    submodulePath: "repos/nanobot",
    pluginMeta: {
      type: "claw",
      capabilities: [
        { id: "composable", name: "Composable", description: "Modular agent composition" },
      ],
    },
  },

  // ── Skills ──────────────────────────────────────────────────────────
  {
    id: "souls-directory",
    name: "Souls Directory",
    url: "https://souls.directory/souls",
    description:
      "Community directory of SOUL.md personality templates for AI agents — browse hundreds of pre-built personas across 15+ categories",
    labels: ["skill"],
    stars: 0,
    language: "TypeScript",
    owner: "thedaviddias",
    addedAt: Date.now(),
    isPinned: true,
    upstreamUrl: "https://github.com/thedaviddias/souls-directory",
    isSubmodule: false,
    pluginMeta: {
      type: "skill",
      capabilities: [
        { id: "personas", name: "Personas", description: "SOUL.md personality templates" },
      ],
    },
    isActive: true,
  },

  // ── Tools ───────────────────────────────────────────────────────────
  {
    id: "ggml-org/llama.cpp",
    name: "llama.cpp",
    url: "https://github.com/ggml-org/llama.cpp",
    description: "LLM inference in C/C++ — GGUF format, quantization, CPU/GPU acceleration",
    labels: ["tool"],
    stars: 74200,
    language: "C++",
    owner: "ggml-org",
    addedAt: Date.now(),
    isPinned: false,
    forkUrl: "https://github.com/attilaczudor/llama.cpp",
    upstreamUrl: "https://github.com/ggml-org/llama.cpp",
    isSubmodule: true,
    submodulePath: "repos/llama.cpp",
    pluginMeta: {
      type: "tool",
      capabilities: [
        { id: "gguf-inference", name: "GGUF Inference", description: "Local LLM inference engine" },
        { id: "quantization", name: "Quantization", description: "Model size reduction" },
      ],
    },
  },
  {
    id: "stanford-trinity/artemis",
    name: "ARTEMIS",
    url: "https://github.com/Stanford-Trinity/ARTEMIS",
    description:
      "AI research framework from Stanford — advanced reasoning, training, evaluation, and model improvement systems",
    labels: ["tool"],
    stars: 0,
    language: "Python",
    owner: "Stanford-Trinity",
    addedAt: Date.now(),
    isPinned: false,
    forkUrl: "https://github.com/attilaczudor/ARTEMIS",
    upstreamUrl: "https://github.com/Stanford-Trinity/ARTEMIS",
    isSubmodule: true,
    submodulePath: "repos/artemis",
    pluginMeta: {
      type: "tool",
      capabilities: [
        { id: "reasoning", name: "Reasoning", description: "Advanced reasoning systems" },
        { id: "evaluation", name: "Evaluation", description: "Model evaluation pipeline" },
      ],
    },
  },

  // ── Resources ───────────────────────────────────────────────────────
  {
    id: "anthropics/awesome-openclaw-usecases",
    name: "Awesome OpenClaw Use Cases",
    url: "https://github.com/anthropics/awesome-openclaw-usecases",
    description:
      "Curated collection of 29 use cases across 6 categories — patterns, recipes, and real-world examples",
    labels: ["resource"],
    stars: 3800,
    language: "Markdown",
    owner: "anthropics",
    addedAt: Date.now(),
    isPinned: true,
    forkUrl: "https://github.com/attilaczudor/awesome-openclaw-usecases",
    upstreamUrl: "https://github.com/anthropics/awesome-openclaw-usecases",
    isSubmodule: true,
    submodulePath: "repos/awesome-openclaw-usecases",
    pluginMeta: {
      type: "resource",
      capabilities: [
        { id: "patterns", name: "Patterns", description: "Agent use-case patterns and recipes" },
      ],
    },
  },
];

// ── Store ────────────────────────────────────────────────────────────────────

export const useReposStore = create<ReposState & ReposActions>()(
  persist(
    (set, get) => ({
      // ── State defaults ───────────────────────────────────────────────────
      sources: DEFAULT_SOURCES.map((s) => ({ ...s })),
      labels: DEFAULT_LABELS.map((l) => ({ ...l })),
      selectedLabel: null,
      searchQuery: "",
      pendingUpdateId: null,
      updatePlan: null,
      implementingUpdateId: null,

      // ── Filtering ────────────────────────────────────────────────────────

      setSelectedLabel: (labelId) => set({ selectedLabel: labelId }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      getFilteredSources: () => {
        const { sources, selectedLabel, searchQuery } = get();
        const q = searchQuery.toLowerCase().trim();

        return sources.filter((source) => {
          // Label filter
          if (selectedLabel && !source.labels.includes(selectedLabel)) {
            return false;
          }

          // Text filter
          if (q) {
            return (
              source.name.toLowerCase().includes(q) ||
              source.description.toLowerCase().includes(q) ||
              source.owner?.toLowerCase().includes(q) ||
              source.language?.toLowerCase().includes(q)
            );
          }

          return true;
        });
      },

      // ── Source management ─────────────────────────────────────────────────

      addSource: (source) => {
        const newSource: RepoSource = {
          ...source,
          id: source.id || `custom-${Date.now()}`,
          addedAt: Date.now(),
        };
        set((state) => ({ sources: [...state.sources, newSource] }));
      },

      removeSource: (id) => {
        set((state) => ({
          sources: state.sources.filter((s) => s.id !== id),
        }));
      },

      updateSource: (id, updates) => {
        set((state) => ({
          sources: state.sources.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        }));
      },

      togglePin: (id) => {
        set((state) => ({
          sources: state.sources.map((s) => (s.id === id ? { ...s, isPinned: !s.isPinned } : s)),
        }));
      },

      addLabelToSource: (sourceId, labelId) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === sourceId && !s.labels.includes(labelId)
              ? { ...s, labels: [...s.labels, labelId] }
              : s,
          ),
        }));
      },

      removeLabelFromSource: (sourceId, labelId) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === sourceId ? { ...s, labels: s.labels.filter((l) => l !== labelId) } : s,
          ),
        }));
      },

      setImplementationStatus: (id, status) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id ? { ...s, implementationStatus: status, implementedAt: Date.now() } : s,
          ),
        }));
      },

      toggleActive: (id) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id ? { ...s, isActive: !s.isActive } : s,
          ),
        }));
      },

      // ── Label management ──────────────────────────────────────────────────

      createLabel: (name, color) => {
        const newLabel: RepoLabel = {
          id: `label-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          color,
          isBuiltIn: false,
        };
        set((state) => ({ labels: [...state.labels, newLabel] }));
        return newLabel;
      },

      updateLabel: (id, updates) => {
        set((state) => ({
          labels: state.labels.map((l) =>
            l.id === id && !l.isBuiltIn ? { ...l, ...updates } : l,
          ),
        }));
      },

      deleteLabel: (id) => {
        const label = get().labels.find((l) => l.id === id);
        if (label?.isBuiltIn) {
          return;
        } // Cannot delete built-in labels

        set((state) => ({
          labels: state.labels.filter((l) => l.id !== id),
          // Remove the label from all sources that had it
          sources: state.sources.map((s) => ({
            ...s,
            labels: s.labels.filter((l) => l !== id),
          })),
        }));
      },

      // ── Update flow ───────────────────────────────────────────────────────

      triggerUpdate: (id) => {
        const source = get().sources.find((s) => s.id === id);
        if (!source) return;
        const plan = buildUpdatePlan(source);
        set({ pendingUpdateId: id, updatePlan: plan });
      },

      implementUpdate: (id) => {
        set({ implementingUpdateId: id });

        // Council applies the update — requires explicit user confirmation (Implement button)
        setTimeout(() => {
          set((state) => ({
            sources: state.sources.map((s) =>
              s.id === id
                ? {
                    ...s,
                    lastUpdated: Date.now(),
                    updateAvailable: false,
                    currentVersion: s.latestVersion ?? s.currentVersion,
                  }
                : s,
            ),
            pendingUpdateId: null,
            updatePlan: null,
            implementingUpdateId: null,
          }));
        }, 1500);
      },

      dismissUpdate: () => {
        set({ pendingUpdateId: null, updatePlan: null, implementingUpdateId: null });
      },
    }),
    {
      name: "atticlaw-repos",
      partialize: (state) => ({
        sources: state.sources,
        labels: state.labels,
      }),
    },
  ),
);
