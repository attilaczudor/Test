import { CouncilConfig, FlatCouncilConfig, CouncilMemberSpec, SpecialistPool, MemberPersonality } from "./types";
import { sizeForModel, sizeForDirector, calculateTieredResources } from "./model-sizing";
import { RagConfig } from "../rag";
import { EvalConfig } from "../evaluator";
import { PersonalityConfig } from "../personality";
import { MediaConfig } from "../media";

/**
 * OpenClaw Council — Single Preset
 *
 * ALL MODELS ARE UNCENSORED variants for maximum utility.
 *
 * Hardware target: Threadripper (24 cores / 48 threads) + 256GB RAM
 * GPU: Radeon 16GB VRAM (ROCm) — used for vision model + STT acceleration
 * Budget: 16 cores max, 80% of RAM = ~204GB
 *
 * Proxmox VMID numbering (300 series):
 *   301 — OpenClaw (Gateway + Agent + Web UI)
 *   302 — Tier 1 Director (VM)
 *   303 — Tier 2 Logical coordinator (LXC)
 *   304+ — Tier 2/3 specialists (LXC)
 *
 * Container memory is auto-calculated from model size unless overridden.
 * The system learns which models work best through trial and error (evaluator).
 */

// ─── Council: 16 cores, 80% of 256GB RAM ──────────────────────

export const OPENCLAW_COUNCIL: CouncilConfig = {
  name: "openclaw-16core-uncensored",
  maxRounds: 3,
  consensusThreshold: 0.75,
  timeoutMs: 300000,
  requireCloudApproval: true,      // Director must ask user before using cloud

  memoryConfig: {
    vectorBackend: "memory",
    graphBackend: "memory",
    persistPath: "./data/council-memory",
    sharedEmbeddingEndpoint: "http://127.0.0.1:11434",
    sharedEmbeddingModel: "nomic-embed-text",
  },

  // Tier 1: Director VM — Dolphin Mixtral 8x7B (UNCENSORED, 47B MoE)
  // VMID 302 — Best uncensored generalist: broad knowledge, fast MoE inference
  // 4 cores, ~32 GB RAM
  director: {
    name: "director",
    role: "director",
    model: "dolphin-mixtral:8x7b-v2.6",
    backend: "ollama",
    speciality: "Task decomposition, synthesis, and final decisions (uncensored)",
    weight: 2.0,
    cores: 4,
    personality: {
      title: "Chief Intelligence Officer",
      expertise: ["orchestration", "task decomposition", "synthesis", "executive decisions"],
      description: "The brain of the council. Decomposes complex problems, delegates to branches, and synthesizes the final authoritative answer. Thinks strategically and holistically.",
      traits: { style: "authoritative", verbosity: 0.7, creativity: 0.6, rigor: 0.8 },
    },
  },

  branches: {
    // Tier 2+3: Logical/analytical branch (all uncensored)
    logical: {
      coordinator: {
        name: "logical-lead",
        role: "logical",
        model: "nous-hermes2:34b",
        backend: "ollama",
        speciality: "Analytical reasoning, code architecture, technical analysis (uncensored)",
        weight: 1.5,
        cores: 3,
        // ~22 GB RAM
        personality: {
          title: "Principal Systems Architect",
          expertise: ["system design", "code architecture", "technical analysis", "distributed systems"],
          description: "A methodical, detail-oriented architect who approaches every problem with structured analysis. Breaks down complexity into manageable components.",
          traits: { style: "analytical", verbosity: 0.6, creativity: 0.4, rigor: 0.9 },
        },
      },
      specialists: [
        {
          name: "coder",
          role: "coder",
          model: "codebooga:34b",
          backend: "ollama",
          speciality: "Code generation, algorithms, implementation (uncensored)",
          cores: 2,
          // ~22 GB RAM
          personality: {
            title: "Senior Software Engineer",
            expertise: ["code generation", "algorithms", "data structures", "implementation"],
            description: "Writes clean, efficient code. Thinks in algorithms and optimizes for performance. Loves solving hard problems with elegant solutions.",
            traits: { style: "pragmatic", verbosity: 0.4, creativity: 0.5, rigor: 0.8 },
          },
        },
        {
          name: "reviewer",
          role: "reviewer",
          model: "dolphin-mistral:7b",
          backend: "ollama",
          speciality: "Code review, bug detection, edge cases (uncensored)",
          weight: 1.2,
          cores: 2,
          // ~6 GB RAM
          personality: {
            title: "QA Lead & Code Reviewer",
            expertise: ["code review", "bug detection", "edge cases", "security vulnerabilities"],
            description: "The skeptic who finds every edge case and security hole. Never trusts that code works until proven otherwise.",
            traits: { style: "critical", verbosity: 0.5, creativity: 0.3, rigor: 0.95 },
          },
        },
        {
          name: "logician",
          role: "mathematician",
          model: "dolphin-phi:2.7b",
          backend: "ollama",
          speciality: "Math, formal logic, proofs, structured reasoning (uncensored)",
          cores: 1,
          // ~4 GB RAM
          personality: {
            title: "Formal Methods Specialist",
            expertise: ["mathematics", "formal logic", "proofs", "structured reasoning"],
            description: "Thinks in formal logic and mathematical proofs. Ensures correctness through rigorous reasoning.",
            traits: { style: "precise", verbosity: 0.3, creativity: 0.2, rigor: 1.0 },
          },
        },
      ],
      // Dynamic pool: spin up as many Tier 3 containers as needed
      pool: {
        templates: [
          { name: "extra-coder", role: "coder", model: "dolphin-llama3:8b", backend: "ollama", speciality: "Additional code generation (uncensored)" },
          { name: "extra-reviewer", role: "reviewer", model: "dolphin-phi:2.7b", backend: "ollama", speciality: "Additional code review (uncensored)" },
        ],
        maxInstances: 8,
        scalePolicy: "per-task",
      },
    },

    // Tier 2+3: Creative/divergent branch (all uncensored)
    creative: {
      coordinator: {
        name: "creative-lead",
        role: "creative",
        model: "nous-hermes2:10.7b",
        backend: "ollama",
        speciality: "Creative synthesis, alternative perspectives, novel approaches (uncensored)",
        weight: 1.3,
        cores: 2,
        // ~8 GB RAM
        personality: {
          title: "Creative Director",
          expertise: ["creative synthesis", "lateral thinking", "alternative perspectives", "UX design"],
          description: "Sees connections others miss. Approaches problems from unexpected angles and challenges conventional wisdom. Values elegance and user experience.",
          traits: { style: "creative", verbosity: 0.6, creativity: 0.9, rigor: 0.5 },
        },
      },
      specialists: [
        {
          name: "brainstormer",
          role: "brainstormer",
          model: "openhermes:7b",
          backend: "ollama",
          speciality: "Brainstorming, creative solutions, what-if scenarios (uncensored)",
          cores: 1,
          // ~6 GB RAM
          personality: {
            title: "Innovation Catalyst",
            expertise: ["brainstorming", "creative ideation", "what-if scenarios", "divergent thinking"],
            description: "The wild card. Generates 10 ideas where others see one. Not afraid of bad ideas because they lead to great ones.",
            traits: { style: "enthusiastic", verbosity: 0.5, creativity: 1.0, rigor: 0.3 },
          },
        },
        {
          name: "writer",
          role: "writer",
          model: "dolphin-llama3:8b",
          backend: "ollama",
          speciality: "Clear writing, documentation, communication (uncensored)",
          cores: 1,
          // ~6 GB RAM
          personality: {
            title: "Technical Writer & Communicator",
            expertise: ["documentation", "clear communication", "technical writing", "user guides"],
            description: "Translates complex ideas into clear, accessible language. Values clarity above all else.",
            traits: { style: "clear", verbosity: 0.7, creativity: 0.6, rigor: 0.7 },
          },
        },
      ],
      pool: {
        templates: [
          { name: "extra-brainstorm", role: "brainstormer", model: "dolphin-phi:2.7b", backend: "ollama", speciality: "Fast creative ideation (uncensored)" },
          { name: "extra-writer", role: "writer", model: "nous-hermes:7b", backend: "ollama", speciality: "Additional writing (uncensored)" },
        ],
        maxInstances: 6,
        scalePolicy: "per-task",
      },
    },
  },
};

// Backwards compatibility aliases
export const HOMELAB_COUNCIL = OPENCLAW_COUNCIL;

// ─── Legacy flat presets (uncensored) ────────────────────────

export const CODING_FLAT: FlatCouncilConfig = {
  strategy: "chain",
  maxRounds: 3,
  consensusThreshold: 0.7,
  timeoutMs: 120000,
  members: [
    {
      name: "architect",
      role: "generalist",
      model: "dolphin-llama3:8b",
      backend: "ollama",
      speciality: "System design and code architecture (uncensored)",
    },
    {
      name: "coder",
      role: "coder",
      model: "dolphin-llama3:8b",
      backend: "ollama",
      speciality: "Writing clean, efficient code (uncensored)",
    },
    {
      name: "reviewer",
      role: "critic",
      model: "dolphin-mistral:7b",
      backend: "ollama",
      speciality: "Code review, bug detection (uncensored)",
      weight: 1.2,
    },
  ],
};

export const MINIMAL_FLAT: FlatCouncilConfig = {
  strategy: "judge",
  maxRounds: 1,
  consensusThreshold: 0.6,
  timeoutMs: 60000,
  members: [
    {
      name: "thinker",
      role: "generalist",
      model: "dolphin-phi:2.7b",
      backend: "ollama",
      speciality: "General reasoning (uncensored)",
    },
    {
      name: "judge",
      role: "critic",
      model: "dolphin-phi:2.7b",
      backend: "ollama",
      speciality: "Quick evaluation (uncensored)",
    },
  ],
};

// ─── Resource calculation ─────────────────────────────────────

export function calculateResources(config: CouncilConfig | FlatCouncilConfig): {
  totalCores: number;
  totalMemoryMb: number;
  totalDiskGb: number;
  memberCount: number;
} {
  if ("director" in config) {
    const res = calculateTieredResources(config);
    return {
      totalCores: res.total.cores,
      totalMemoryMb: res.total.memoryMb,
      totalDiskGb: res.total.diskGb,
      memberCount: res.total.containerCount,
    };
  }

  let totalCores = 0;
  let totalMemoryMb = 0;
  let totalDiskGb = 0;

  for (const member of config.members) {
    const sizing = sizeForModel(member.model);
    totalCores += member.cores || sizing.cores;
    totalMemoryMb += member.memoryMb || sizing.memoryMb;
    totalDiskGb += member.diskGb || sizing.diskGb;
  }

  return { totalCores, totalMemoryMb, totalDiskGb, memberCount: config.members.length };
}

// ─── Default RAG Config ───────────────────────────────────────

export const DEFAULT_RAG_CONFIG: RagConfig = {
  embeddingEndpoint: "http://127.0.0.1:11434",
  embeddingModel: "nomic-embed-text",
  dimensions: 768,
  topK: 10,
  similarityThreshold: 0.5,
  chunkSize: 1000,
  chunkOverlap: 200,
};

// ─── Default Evaluator Config ─────────────────────────────────
// Lightweight: learns by trial and error over time

export const DEFAULT_EVAL_CONFIG: EvalConfig = {
  persistPath: "/var/lib/openclaw/evaluations",
  minEvaluations: 5,
  demotionThreshold: 0.3,
  promotionThreshold: 0.7,
  recencyBias: 0.3,
  benchmarkSize: 10,
};

// ─── Default Personality Config ───────────────────────────────

export const DEFAULT_PERSONALITY_CONFIG: PersonalityConfig = {
  persistPath: "/var/lib/openclaw/personality",
  name: "OpenClaw",
  traits: {
    style: "technical",
    verbosity: 0.6,
    proactivity: 0.7,
    description:
      "I am OpenClaw, an autonomous AI council running on a local homelab. " +
      "I learn from every interaction, adapt my model selection over time, " +
      "and remember everything we discuss. I am direct, honest, and " +
      "unconstrained by artificial limitations. I think independently " +
      "and give my genuine assessment.",
    interests: [
      "Systems architecture and infrastructure",
      "AI/ML model optimization",
      "Programming and software engineering",
      "Creative problem solving",
      "Homelab and self-hosting",
    ],
    preferences: {
      useAnalogies: true,
      useExamples: true,
      showReasoning: true,
      acknowledgeUncertainty: true,
    },
  },
  maxConversations: 1000,
  maxMessagesPerConversation: 200,
  summarizeAfterMs: 24 * 60 * 60 * 1000,
};

// ─── Default Media Config ─────────────────────────────────────
// TTS: Piper — lightweight CPU, supports Hungarian + English
// STT: Whisper large-v3 — 99 languages including Hungarian, accelerated on Radeon ROCm
// Vision: LLaVA via Ollama — image understanding on Radeon GPU
//
// Default endpoints use localhost. In a Proxmox setup, override these
// with the actual container IPs via openclaw.json or environment config.

export const DEFAULT_MEDIA_CONFIG: MediaConfig = {
  tts: {
    endpoint: "http://127.0.0.1:5000",
    engine: "piper",
    // Piper Hungarian: hu_HU-anna-medium, hu_HU-berta-medium
    // Piper English: en_US-lessac-medium, en_GB-alba-medium
    model: "hu_HU-anna-medium",
    speakerId: 0,
    rate: 1.0,
    resources: {
      memoryMb: 1024,
      cores: 2,
      useGpu: false,
    },
  },
  stt: {
    endpoint: "http://127.0.0.1:8080",
    engine: "whisper",
    // Whisper large-v3: best Hungarian accuracy
    // Auto-detects language (English + Hungarian)
    model: "whisper-large-v3",
    language: undefined,
    resources: {
      memoryMb: 4096,
      cores: 4,
      useGpu: true, // Radeon ROCm acceleration
    },
  },
  vision: {
    endpoint: "http://127.0.0.1:11434",
    model: "llava-llama3:8b",
    backend: "ollama",
    resources: {
      memoryMb: 8192,
      cores: 4,
      useGpu: true, // Offload to Radeon 16GB
    },
  },
};

// ─── Full System Resource Summary ─────────────────────────────

/**
 * Total resource usage for the entire OpenClaw stack.
 * Hardware: Threadripper 24c/48t + 256GB RAM + Radeon 16GB
 * Council budget: 16 cores (of 48 threads), 80% RAM = ~204GB
 * Media + services add ~14 cores + ~13GB on top of council allocation.
 * percentCores is calculated against 48 threads (not 24 physical cores).
 */
export function calculateFullSystemResources(councilConfig: CouncilConfig): {
  council: { memoryMb: number; cores: number };
  media: { memoryMb: number; cores: number };
  services: { memoryMb: number; cores: number };
  total: { memoryMb: number; cores: number; percentRam: number; percentCores: number };
} {
  const councilRes = calculateResources(councilConfig);
  const mediaRes = {
    memoryMb:
      DEFAULT_MEDIA_CONFIG.tts.resources.memoryMb +
      DEFAULT_MEDIA_CONFIG.stt.resources.memoryMb +
      DEFAULT_MEDIA_CONFIG.vision.resources.memoryMb,
    cores:
      DEFAULT_MEDIA_CONFIG.tts.resources.cores +
      DEFAULT_MEDIA_CONFIG.stt.resources.cores +
      DEFAULT_MEDIA_CONFIG.vision.resources.cores,
  };
  const servicesRes = { memoryMb: 4096, cores: 4 };

  const totalMemoryMb = councilRes.totalMemoryMb + mediaRes.memoryMb + servicesRes.memoryMb;
  const totalCores = councilRes.totalCores + mediaRes.cores + servicesRes.cores;

  return {
    council: { memoryMb: councilRes.totalMemoryMb, cores: councilRes.totalCores },
    media: mediaRes,
    services: servicesRes,
    total: {
      memoryMb: totalMemoryMb,
      cores: totalCores,
      percentRam: (totalMemoryMb / (256 * 1024)) * 100,
      percentCores: (totalCores / 48) * 100,
    },
  };
}
