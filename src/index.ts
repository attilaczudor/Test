/**
 * OpenClaw v2 — Secure Autonomous Agency Framework
 *
 * Architecture:
 *   Gateway (communication) <-> Agent (reasoning) <-> Skills (action)
 *
 * Key features:
 *   - Secure-by-default sandboxing (Wasm/Docker/nsjail)
 *   - Fine-grained RBAC with path and scope restrictions
 *   - Graph-based memory with importance scoring and auto-summarization
 *   - MCP-standardized skill interface with permissions manifest
 *   - Verified skill registry with cryptographic signing
 *   - Lane Queue with controlled parallelism
 *   - Local LLM autodiscovery (Ollama, vLLM, llama.cpp, LM Studio)
 *   - Proxmox VM/LXC orchestration for spinning up LLM instances
 *   - HuggingFace model discovery and download
 *   - RAG pipeline with embedding + vector store + graph memory
 *   - Model evaluation via RL (Thompson sampling, trial & error)
 *   - Persistent personality and conversation memory
 *   - Media pipeline: TTS (Piper, Hungarian+English), STT (Whisper), Vision (LLaVA)
 *   - Built-in web UI for agent interaction
 *   - All models are uncensored variants
 */

// Config
export {
  loadConfig,
  validateConfig,
  writeDefaultConfig,
  OpenClawConfig,
  ConfigValidationError,
  OPENCLAW_CONFIG_SCHEMA,
} from "./config";

// Gateway
export {
  Gateway,
  GatewayConfig,
  GatewayClient,
  GatewayMessage,
  CsrfProtection,
  RateLimiter,
} from "./gateway";

// RBAC
export {
  RbacEngine,
  RbacConfig,
  RoleEntry,
  Role,
  Permission,
  AccessContext,
  AccessDecision,
} from "./rbac";

// Memory
export {
  GraphMemory,
  GraphMemoryConfig,
  MemoryNode,
  MemoryEdge,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStats,
} from "./memory";

// Sandbox
export {
  Sandbox,
  SandboxConfig,
  ExecutionRequest,
  ExecutionResult,
  SandboxLimits,
} from "./sandbox";

// Skills
export {
  SkillRunner,
  SkillHandler,
  SkillManifest,
  SkillInvocation,
  SkillResult,
  SkillPermission,
  McpToolDefinition,
} from "./skills";

// Lane Queue
export { LaneQueue, LaneQueueConfig, LaneTask, LaneTaskResult } from "./lane-queue";

// Discovery
export { DiscoveryService, DiscoveryConfig, LlmBackend } from "./discovery";

// Registry
export { SkillRegistry, RegistryConfig, RegistryEntry } from "./registry";

// Agent
export {
  Agent,
  AgentConfig,
  AgentMessage,
  AgentTask,
  AgentTurnResult,
  LlmProvider,
  LlmResponse,
} from "./agent";

// Infrastructure
export { ProxmoxManager, ProxmoxConfig, LlmInstance, VmTemplate } from "./infra";
export { HuggingFaceHub, HuggingFaceConfig, ModelInfo, DownloadProgress } from "./infra";

// Vector Store
export { VectorStore, VectorStoreConfig, VectorEntry, VectorSearchResult } from "./vector";
export { QdrantClient, QdrantConfig } from "./vector";

// Neo4j Knowledge Graph
export { Neo4jClient, Neo4jConfig } from "./memory";

// LoRA Fine-Tuning
export {
  LoraPipeline,
  LoraConfig,
  TrainingExample,
  TrainingDataset,
  LoraAdapter,
  TrainingHyperparameters,
  LoraHistory,
} from "./lora";

// Multi-Provider LLM Support
export { LlmProviderRegistry, ProviderConfig, ProviderType, ProviderHealth } from "./providers";

// Smart Router (Council-Gated Escalation)
export {
  SmartRouter,
  CostTracker,
  SmartRouterConfig,
  RoutingDecision,
  RouterStats,
  EscalationRequest,
  EscalationVerdict,
} from "./router";

// Hybrid Search (BM25 + Vector)
export { Bm25Index, fuseScores, HybridSearchResult, HybridSearchConfig } from "./rag";

// Web UI
export { UiServer, UiServerConfig } from "./ui";

// Council
export {
  Council,
  CouncilMemoryManager,
  CouncilConfig,
  CouncilMember,
  CouncilPrompt,
  CouncilResult,
  CouncilStrategy,
  CouncilRole,
  FlatCouncilConfig,
  FlatCouncilResult,
  BranchConfig,
  BranchResult,
  BranchType,
  Tier,
  ModelSizing,
  MemberPersonality,
  MemberMemory,
  MemberMetrics,
  CouncilMemoryConfig,
  CloudApprovalRequest,
  CloudApprovalResponse,
  ModelSwapRequest,
  ModelSwapResult,
  TIER_CONSTRAINTS,
  OPENCLAW_COUNCIL,
  HOMELAB_COUNCIL,
  CODING_FLAT,
  MINIMAL_FLAT,
  calculateResources,
  calculateFullSystemResources,
  DEFAULT_RAG_CONFIG,
  DEFAULT_EVAL_CONFIG,
  DEFAULT_PERSONALITY_CONFIG,
  DEFAULT_MEDIA_CONFIG,
  sizeForModel,
  sizeForDirector,
  parseModelParams,
} from "./council";

// RAG Pipeline
export {
  RagPipeline,
  RagConfig,
  RagChunk,
  RagRetrievalResult,
  RagAugmentedPrompt,
  DocumentIngestResult,
} from "./rag";

// Model Evaluator (RL)
export {
  ModelEvaluator,
  EvalConfig,
  EvalPrompt,
  EvalResult,
  EvalCategory,
  ModelScore,
  ModelRanking,
  EvalHistory,
} from "./evaluator";

// Personality & Conversation Memory
export {
  PersonalityEngine,
  PersonalityConfig,
  PersonalityTraits,
  ConversationEntry,
  ConversationMessage,
  UserProfile,
  PersonalityState,
} from "./personality";

// Media Pipeline (TTS, STT, Vision)
export {
  MediaPipeline,
  MediaConfig,
  TtsConfig,
  SttConfig,
  VisionConfig,
  TtsRequest,
  TtsResult,
  SttRequest,
  SttResult,
  VisionRequest,
  VisionResult,
} from "./media";

// Resource Auto-Detection & Scaling
export {
  detectHardware,
  calculateBudget,
  recommendTier,
  autoScale,
  HardwareProfile,
  ResourceBudget,
  CouncilTier,
  ScalingDecision,
} from "./resources";

// Real-time Voice Conversation
export {
  VoiceConversation,
  VoiceSession,
  VoiceAudioChunk,
  VoiceStateUpdate,
  VoiceTranscription,
  VoiceTtsChunk,
  VoiceAgentResponse,
  VoiceConversationConfig,
  DEFAULT_VOICE_CONFIG,
} from "./voice";

// ClawHub Skill Marketplace
export {
  ClawHubClient,
  ClawHubApiError,
  ClawHubManager,
  ClawHubConfig,
  ClawHubSkill,
  ClawHubSearchResult,
  InstalledSkill,
} from "./clawhub";

// OpenClaw application orchestrator
import * as path from "path";
import { Agent } from "./agent";
import { ClawHubManager } from "./clawhub";
import { loadConfig, OpenClawConfig } from "./config";
import { Council, OPENCLAW_COUNCIL, CouncilMemoryManager } from "./council";
import {
  DEFAULT_RAG_CONFIG,
  DEFAULT_EVAL_CONFIG,
  DEFAULT_PERSONALITY_CONFIG,
  DEFAULT_MEDIA_CONFIG,
  calculateResources,
} from "./council";
import { DiscoveryService } from "./discovery";
import { ModelEvaluator } from "./evaluator";
import { Gateway } from "./gateway";
import { LaneQueue } from "./lane-queue";
import { LoraPipeline } from "./lora";
import { LoraConfig } from "./lora";
import { MediaPipeline } from "./media";
import { GraphMemory } from "./memory";
import { Neo4jClient } from "./memory";
import { PersonalityEngine } from "./personality";
import { LlmProviderRegistry } from "./providers";
import { RagPipeline } from "./rag";
import { RbacEngine } from "./rbac";
import { SkillRegistry } from "./registry";
import { autoScale, ScalingDecision } from "./resources";
import { SmartRouter } from "./router";
import { SmartRouterConfig, RoutingDecision, EscalationRequest, EscalationVerdict } from "./router";
import { Sandbox } from "./sandbox";
import { SkillRunner } from "./skills";
import { UiServer } from "./ui";
import { VectorStore } from "./vector";
import { QdrantClient } from "./vector";
import {
  VoiceConversation,
  VoiceStateUpdate,
  VoiceTranscription,
  VoiceAgentResponse,
  VoiceTtsChunk,
} from "./voice";

export class OpenClaw {
  readonly config: OpenClawConfig;
  readonly gateway: Gateway;
  readonly rbac: RbacEngine;
  readonly memory: GraphMemory;
  readonly sandbox: Sandbox;
  readonly skills: SkillRunner;
  readonly queue: LaneQueue;
  readonly discovery: DiscoveryService;
  readonly registry: SkillRegistry;
  readonly agent: Agent;
  readonly vectorStore: VectorStore;
  readonly ui: UiServer;
  readonly rag: RagPipeline;
  readonly evaluator: ModelEvaluator;
  readonly personality: PersonalityEngine;
  readonly media: MediaPipeline;
  readonly voice: VoiceConversation;
  readonly scaling: ScalingDecision;
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  readonly qdrant: QdrantClient | null;
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  readonly neo4j: Neo4jClient | null;
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  readonly lora: LoraPipeline | null;
  readonly providerRegistry: LlmProviderRegistry;
  readonly router: SmartRouter;
  readonly clawhub: ClawHubManager;
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  council: Council | null = null;

  constructor(config?: OpenClawConfig) {
    this.config = config || loadConfig();

    // Auto-detect hardware and calculate resource budget
    const resourceConfig = this.config.resourceScaling;
    this.scaling = autoScale(
      resourceConfig.maxUtilization,
      resourceConfig.reservedMemoryMb,
      resourceConfig.reservedCores,
    );

    this.rbac = new RbacEngine(this.config.rbac);

    // Resolve data persistence directory
    const dataDir = path.resolve(this.config.memory.persistPath || "./data");

    this.memory = new GraphMemory({
      ...this.config.memory,
      maxNodes: this.scaling.memoryMaxNodes,
      persistPath: path.join(dataDir, "graph-memory.json"),
    });

    this.sandbox = new Sandbox(this.config.sandbox);

    this.skills = new SkillRunner(this.rbac);

    this.queue = new LaneQueue({
      ...this.config.laneQueue,
      maxParallel: this.scaling.laneQueueParallel,
    });

    this.gateway = new Gateway({
      ...this.config.gateway,
      csrfSecret: this.config.gateway.csrfSecret!,
    });

    this.discovery = new DiscoveryService(this.config.discovery);

    this.registry = new SkillRegistry({
      registryUrl: this.config.skills.registryUrl,
      requireSigned: this.config.skills.requireSigned,
    });

    this.agent = new Agent(
      this.config.agent,
      this.memory,
      this.skills,
      this.sandbox,
      this.rbac,
      this.queue,
    );

    this.vectorStore = new VectorStore({
      dimensions: DEFAULT_RAG_CONFIG.dimensions,
      maxEntries: this.scaling.vectorStoreMaxEntries,
      similarityThreshold: DEFAULT_RAG_CONFIG.similarityThreshold,
      persistPath: path.join(dataDir, "vector-store.json"),
    });

    this.rag = new RagPipeline(DEFAULT_RAG_CONFIG, this.vectorStore, this.memory);

    this.evaluator = new ModelEvaluator(DEFAULT_EVAL_CONFIG);

    this.personality = new PersonalityEngine({
      ...DEFAULT_PERSONALITY_CONFIG,
      persistPath: path.join(dataDir, "personality"),
    });

    this.media = new MediaPipeline(DEFAULT_MEDIA_CONFIG);

    this.voice = new VoiceConversation(this.media);

    // ── Dedicated Database Backends (optional) ─────────────────
    // When configured, Qdrant replaces the in-memory VectorStore
    // and Neo4j replaces the in-memory GraphMemory for persistent,
    // scalable storage in dedicated VMs.

    const dbConfig = (this.config as Record<string, unknown>).databases as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (dbConfig?.qdrant?.url) {
      this.qdrant = new QdrantClient({
        qdrantUrl: dbConfig.qdrant.url,
        collectionName: dbConfig.qdrant.collection || "openclaw",
        apiKey: dbConfig.qdrant.apiKey,
        dimensions: DEFAULT_RAG_CONFIG.dimensions,
        maxEntries: this.scaling.vectorStoreMaxEntries,
        similarityThreshold: DEFAULT_RAG_CONFIG.similarityThreshold,
      });
    } else {
      this.qdrant = null;
    }

    if (dbConfig?.neo4j?.url) {
      this.neo4j = new Neo4jClient({
        neo4jUrl: dbConfig.neo4j.url,
        database: dbConfig.neo4j.database || "neo4j",
        username: dbConfig.neo4j.username,
        password: dbConfig.neo4j.password,
        maxNodes: this.scaling.memoryMaxNodes,
        importanceThreshold: this.config.memory.importanceThreshold,
        autoSummarize: this.config.memory.autoSummarize,
        summarizeAfterTurns: this.config.memory.summarizeAfterTurns,
      });
    } else {
      this.neo4j = null;
    }

    // ── LoRA Fine-Tuning Pipeline ──────────────────────────────
    // Enables recursive self-improvement by fine-tuning on high-quality
    // interactions and deploying improved LoRA adapters via Ollama.

    const loraConfig = (this.config as Record<string, unknown>).lora as
      | Record<string, unknown>
      | undefined;
    if (loraConfig?.enabled) {
      this.lora = new LoraPipeline({
        persistPath: path.join(dataDir, "lora"),
        ollamaEndpoint: loraConfig.ollamaEndpoint || "http://127.0.0.1:11434",
        baseModel: loraConfig.baseModel || this.config.agent.defaultModel,
        rank: loraConfig.rank || 16,
        alpha: loraConfig.alpha || 32,
        qualityThreshold: loraConfig.qualityThreshold || 0.7,
        minTrainingExamples: loraConfig.minTrainingExamples || 50,
        maxTrainingExamples: loraConfig.maxTrainingExamples || 500,
        trainingCheckInterval: loraConfig.trainingCheckInterval || 3600000,
      });
    } else {
      this.lora = null;
    }

    // ── Multi-Provider LLM Registry ────────────────────────────
    // Supports Ollama (local), OpenAI, Anthropic, and Google with
    // automatic fallback. Local providers are always preferred.

    this.providerRegistry = new LlmProviderRegistry();

    // Always register Ollama as priority 0 (local, preferred)
    this.providerRegistry.addProvider({
      type: "ollama",
      name: "ollama-local",
      baseUrl: "http://127.0.0.1:11434",
      model: this.config.agent.defaultModel,
      priority: 0,
      enabled: true,
    });

    // Register cloud providers if enabled
    const providers = (this.config as Record<string, unknown>).providers as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (this.config.useCloudModels && providers) {
      if (providers.openai?.apiKey) {
        this.providerRegistry.addProvider({
          type: "openai",
          name: "openai",
          baseUrl: providers.openai.baseUrl || "https://api.openai.com",
          apiKey: providers.openai.apiKey,
          model: providers.openai.model || "gpt-4o",
          maxTokens: providers.openai.maxTokens || 4096,
          priority: 10,
          enabled: true,
        });
      }
      if (providers.anthropic?.apiKey) {
        this.providerRegistry.addProvider({
          type: "anthropic",
          name: "anthropic",
          baseUrl: providers.anthropic.baseUrl || "https://api.anthropic.com",
          apiKey: providers.anthropic.apiKey,
          model: providers.anthropic.model || "claude-sonnet-4-5-20250929",
          maxTokens: providers.anthropic.maxTokens || 4096,
          priority: 11,
          enabled: true,
        });
      }
      if (providers.google?.apiKey) {
        this.providerRegistry.addProvider({
          type: "google",
          name: "google",
          baseUrl: providers.google.baseUrl || "https://generativelanguage.googleapis.com",
          apiKey: providers.google.apiKey,
          model: providers.google.model || "gemini-2.0-flash",
          maxTokens: providers.google.maxTokens || 4096,
          priority: 12,
          enabled: true,
        });
      }
    }

    // ── Smart Router (Council-Gated Escalation) ─────────────
    // Wraps provider registry with intelligent routing:
    //   Phase 1: Try local first
    //   Phase 2: Assess confidence
    //   Phase 3: Council gate decides escalation
    const routerConfig: Partial<SmartRouterConfig> =
      ((this.config as Record<string, unknown>).router as Partial<SmartRouterConfig>) || {};
    this.router = new SmartRouter(this.providerRegistry, routerConfig);

    // ── ClawHub Skill Marketplace ─────────────────────────────
    const clawhubConfig =
      ((this.config as Record<string, unknown>).clawhub as Record<string, unknown>) || {};
    this.clawhub = new ClawHubManager({
      skillsDir: path.resolve(this.config.memory.persistPath || "./data", "skills"),
      ...clawhubConfig,
    });
    // Initialize ClawHub asynchronously (non-blocking)
    this.clawhub.init().catch(() => {});

    // UI binds to same host as gateway — network-accessible by default (0.0.0.0)
    // Gateway URL uses hostname for network clients to connect back
    const gwHost =
      this.config.gateway.host === "0.0.0.0"
        ? this.scaling.hardware.hostname
        : this.config.gateway.host;
    this.ui = new UiServer({
      port: this.config.gateway.port + 1,
      host: this.config.gateway.host,
      gatewayUrl: `ws://${gwHost}:${this.config.gateway.port}`,
    });

    // Auto-load council based on detected hardware tier
    this.autoLoadCouncil();

    // Wire council escalation evaluator to router
    if (this.council) {
      this.router.setEscalationEvaluator((req) => this.council!.evaluateEscalation(req));
    }

    this.wireGatewayToAgent();
  }

  /**
   * Auto-select and load council based on detected hardware resources.
   * Validates the preset fits within the detected resource budget.
   */
  private autoLoadCouncil(): void {
    const budget = this.scaling.budget;
    const councilRes = calculateResources(OPENCLAW_COUNCIL);

    // Warn if the council exceeds the hardware budget, but still load it
    if (councilRes.totalMemoryMb > budget.budgetMemoryMb) {
      console.warn(
        `[OpenClaw] Council needs ${Math.round(councilRes.totalMemoryMb / 1024)} GB RAM ` +
          `but budget allows ${Math.round(budget.budgetMemoryMb / 1024)} GB. ` +
          `Models may be slow or fail to load.`,
      );
    }

    this.council = new Council(OPENCLAW_COUNCIL);
  }

  /**
   * Wire the LLM provider via the Smart Router.
   * Updates Ollama endpoint from discovered backends, then
   * uses the router's council-gated escalation pipeline.
   */
  private wireDiscoveredLlm(): void {
    const backends = this.discovery.getHealthyBackends();

    // Update Ollama provider URL if a healthy backend was discovered
    if (backends.length > 0) {
      const preferred = backends.find((b) => b.type === "ollama") || backends[0];
      const providers = this.providerRegistry.getProviders();
      const ollamaProvider = providers.find((p) => p.type === "ollama");
      if (ollamaProvider) {
        ollamaProvider.baseUrl = preferred.url;
      }
    }

    // Set the agent's LLM provider to use the Smart Router
    // (council-gated escalation instead of dumb fallback)
    this.agent.setLlmProvider(this.router.createProvider());
  }

  /**
   * Register discovered backends as council member endpoints.
   * Maps council config names to live endpoints found by discovery.
   */
  private wireDiscoveredCouncil(): void {
    if (!this.council) {
      return;
    }

    const backends = this.discovery.getHealthyBackends();
    if (backends.length === 0) {
      return;
    }

    // Auto-register council members from known backends
    // Each council member needs its own Ollama endpoint
    const preset = OPENCLAW_COUNCIL;
    const members: Array<{
      spec: typeof preset.director;
      tier: 1 | 2 | 3;
      branch: string | undefined;
    }> = [{ spec: preset.director, tier: 1, branch: undefined }];
    for (const [branchName, branchConfig] of Object.entries(preset.branches)) {
      members.push({ spec: branchConfig.coordinator, tier: 2, branch: branchName });
      for (const specialist of branchConfig.specialists) {
        members.push({ spec: specialist, tier: 3, branch: branchName });
      }
    }

    for (const { spec, tier, branch } of members) {
      // Find a backend that has this model available
      const backend = this.discovery.getBackendByModel(spec.model);
      if (backend) {
        this.council.addMember(spec, backend.url, tier, branch);
      }
    }
  }

  async start(): Promise<void> {
    await this.gateway.start();
    await this.discovery.start();

    // Wire LLM provider and council members from discovered backends
    this.wireDiscoveredLlm();
    this.wireDiscoveredCouncil();

    // Re-wire when new backends are discovered
    this.discovery.on("backendDiscovered", () => {
      if (!this.agent.hasLlmProvider()) {
        this.wireDiscoveredLlm();
      }
      this.wireDiscoveredCouncil();
    });

    // Start LoRA auto-training loop if configured
    if (this.lora) {
      this.lora.startAutoTraining();
    }

    await this.ui.start();
  }

  async stop(): Promise<void> {
    this.discovery.stop();
    this.personality.saveState();
    this.evaluator.saveHistory();
    this.memory.dispose();
    this.vectorStore.dispose();
    if (this.lora) {
      this.lora.dispose();
    }
    await this.ui.stop();
    await this.gateway.stop();
  }

  private wireGatewayToAgent(): void {
    this.gateway.onMessage("task", (client, message) => {
      const payload = message.payload as {
        instruction: string;
        context?: string;
        userId?: string;
      };

      // Track conversation via personality engine
      const userId = payload.userId || client.id;
      this.personality.startConversation(userId);
      this.personality.addMessage(userId, "user", payload.instruction);

      const task = {
        id: message.id,
        instruction: payload.instruction,
        context: payload.context,
        role: this.config.rbac.defaultRole,
        createdAt: Date.now(),
      };

      this.queue.enqueue(
        `task:${task.id}`,
        async () => {
          const results = await this.agent.executeTask(task);

          for (const result of results) {
            this.gateway.send(client.id, "turn", {
              taskId: task.id,
              ...result,
            });

            // Record assistant responses in personality
            if (result.message.role === "assistant") {
              this.personality.addMessage(userId, "assistant", result.message.content);
            }
          }

          return results;
        },
        { destructive: true, priority: 1 },
      );

      this.gateway.send(client.id, "taskAccepted", { taskId: task.id });
    });

    this.gateway.onMessage("ping", (client) => {
      this.gateway.send(client.id, "pong", { timestamp: Date.now() });
    });

    this.gateway.onMessage("status", (client) => {
      this.gateway.send(client.id, "status", {
        queue: this.queue.getStatus(),
        memory: this.memory.stats(),
        backends: this.discovery.getHealthyBackends(),
        skills: this.skills.listSkills().map((s) => s.name),
        vectorStore: this.vectorStore.stats(),
        personality: {
          mood: this.personality.getMood(),
          conversationCount: Object.keys(this.personality.getState().conversations).length,
        },
        evaluator: {
          modelsTracked: Object.keys(this.evaluator.getAllScores()).length,
          flaggedModels: this.evaluator.getFlaggedModels().length,
        },
        council: this.council
          ? {
              members: this.council.getMembers().map((m) => ({
                id: m.id,
                name: m.name,
                role: m.role,
                model: m.model,
                status: m.status,
                tier: m.tier,
                branch: m.branch,
                personality: m.personality
                  ? { title: m.personality.title, expertise: m.personality.expertise }
                  : null,
                metrics: m.metrics,
              })),
              ready: this.council.getReadyMembers().length,
              running: this.council.isRunning,
              branches: this.council.getBranches(),
              memoryStats: this.council.getMemoryManager()?.getStats() || null,
            }
          : null,
        router: this.router.getStats(),
        providers: this.providerRegistry.getHealth(),
        clawhub: this.clawhub.getStats(),
        resources: {
          hardware: this.scaling.hardware,
          budget: this.scaling.budget,
          tier: this.scaling.recommendedTier,
        },
        cloudModels: this.config.useCloudModels,
        lora: this.lora ? this.lora.getStats() : null,
        databases: {
          qdrant: this.qdrant ? "configured" : "none (using in-memory)",
          neo4j: this.neo4j ? "configured" : "none (using in-memory)",
        },
      });
    });

    // Council deliberation endpoint (with RAG augmentation)
    this.gateway.onMessage("council", (client, message) => {
      if (!this.council) {
        this.gateway.send(client.id, "error", {
          message: "No council configured. Load a council config first.",
          requestId: message.id,
        });
        return;
      }

      const payload = message.payload as {
        question: string;
        context?: string;
        requiredBranch?: "logical" | "creative";
        useRag?: boolean;
      };

      this.queue.enqueue(
        `council:${message.id}`,
        async () => {
          // Augment with RAG if requested
          let question = payload.question;
          let context = payload.context;
          if (payload.useRag !== false) {
            try {
              const augmented = await this.rag.augment(payload.question);
              if (augmented.sourcesUsed > 0) {
                context = augmented.augmentedQuery;
              }
            } catch {
              // RAG failure is non-fatal — proceed without augmentation
            }
          }

          const result = await this.council!.deliberate({
            id: message.id,
            question,
            context,
            requiredBranch: payload.requiredBranch,
          });

          this.gateway.send(client.id, "councilResult", {
            requestId: message.id,
            ...result,
          });

          // Store the synthesis in memory
          const synthesis =
            "directorSynthesis" in result ? result.directorSynthesis : result.synthesis;
          this.memory.addNode(
            "experience",
            `Council deliberation: ${payload.question}\nResult: ${synthesis.slice(0, 500)}`,
            {
              participants: result.participantCount,
              confidence: result.confidence,
            },
            0.8,
          );

          return result;
        },
        { destructive: false, priority: 2 },
      );

      this.gateway.send(client.id, "councilAccepted", {
        requestId: message.id,
      });
    });

    // TTS endpoint
    this.gateway.onMessage("tts", (client, message) => {
      const payload = message.payload as { text: string; rate?: number };
      this.queue.enqueue(
        `tts:${message.id}`,
        async () => {
          const result = await this.media.speak({
            text: payload.text,
            rate: payload.rate,
          });
          this.gateway.send(client.id, "ttsResult", {
            requestId: message.id,
            ...result,
          });
          return result;
        },
        { destructive: false, priority: 3 },
      );
    });

    // STT endpoint
    this.gateway.onMessage("stt", (client, message) => {
      const payload = message.payload as { audio: string; format: "wav" | "mp3" | "opus" | "webm" };
      this.queue.enqueue(
        `stt:${message.id}`,
        async () => {
          const result = await this.media.transcribe({
            audio: payload.audio,
            format: payload.format,
          });
          this.gateway.send(client.id, "sttResult", {
            requestId: message.id,
            ...result,
          });
          return result;
        },
        { destructive: false, priority: 3 },
      );
    });

    // Vision endpoint
    this.gateway.onMessage("vision", (client, message) => {
      const payload = message.payload as { image: string; prompt: string };
      this.queue.enqueue(
        `vision:${message.id}`,
        async () => {
          const result = await this.media.analyzeImage({
            image: payload.image,
            prompt: payload.prompt,
          });
          this.gateway.send(client.id, "visionResult", {
            requestId: message.id,
            ...result,
          });
          return result;
        },
        { destructive: false, priority: 3 },
      );
    });

    // ── Real-time voice conversation ──────────────────────────────

    // Start voice session
    this.gateway.onMessage("voiceStart", (client) => {
      this.voice.startSession(client.id);
    });

    // Stop voice session
    this.gateway.onMessage("voiceStop", (client) => {
      this.voice.stopSession(client.id);
    });

    // Incoming audio chunk from client mic
    this.gateway.onMessage("voiceAudio", (client, message) => {
      const chunk = message.payload as {
        audio: string;
        speechDetected: boolean;
        seq: number;
      };
      this.voice.processChunk(client.id, chunk);
    });

    // Voice engine events → forward to client via gateway

    this.voice.on("voiceState", (clientId: string, state: VoiceStateUpdate) => {
      this.gateway.send(clientId, "voiceState", state);
    });

    this.voice.on("transcription", (clientId: string, data: VoiceTranscription) => {
      this.gateway.send(clientId, "voiceTranscription", data);
    });

    this.voice.on("agentResponse", (clientId: string, data: VoiceAgentResponse) => {
      this.gateway.send(clientId, "voiceAgentText", data);
    });

    this.voice.on("ttsChunk", (clientId: string, data: VoiceTtsChunk) => {
      this.gateway.send(clientId, "voiceTtsChunk", data);
    });

    this.voice.on("bargeIn", (clientId: string, turnId: number) => {
      this.gateway.send(clientId, "voiceBargeIn", { turnId });
    });

    this.voice.on("voiceError", (clientId: string, error: string) => {
      this.gateway.send(clientId, "voiceError", { message: error });
    });

    // ── Smart Router event forwarding ──────────────────────────
    // Forward routing decisions to all gateway clients for the activity feed

    this.router.on("routingDecision", (decision: RoutingDecision) => {
      this.gateway.broadcast("routingDecision", decision);
    });

    this.router.on(
      "escalationEvaluated",
      (data: { request: EscalationRequest; verdict: EscalationVerdict }) => {
        this.gateway.broadcast("escalationEvaluated", data);
      },
    );

    // ── Settings management ─────────────────────────────────────

    this.gateway.onMessage("updateSetting", (_client, message) => {
      const { key, value } = message.payload as { key: string; value: unknown };

      // Router settings
      const routerKeys = [
        "confidenceThreshold",
        "maxCostPerRequest",
        "maxDailySpend",
        "autoEscalate",
      ];
      if (routerKeys.includes(key)) {
        this.router.updateConfig({ [key]: value });
        return;
      }

      // useCloudModels toggle
      if (key === "useCloudModels") {
        (this.config as Record<string, unknown>).useCloudModels = !!value;
        // Enable/disable cloud providers accordingly
        const providers = this.providerRegistry.getProviders();
        for (const p of providers) {
          if (p.type !== "ollama") {
            p.enabled = !!value;
          }
        }
      }
    });

    this.gateway.onMessage("updateProviderSetting", (_client, message) => {
      const { provider, key, value } = message.payload as {
        provider: string;
        key: string;
        value: unknown;
      };

      // Update provider config in registry
      const providers = this.providerRegistry.getProviders();
      const target = providers.find((p) => p.type === provider || p.name === provider);
      if (target && key === "apiKey") {
        target.apiKey = String(value);
        // Auto-enable the provider if a key was set
        if (value) {
          target.enabled = true;
          this.providerRegistry.resetErrors(target.name);
        }
      }
    });

    // ── ClawHub skill marketplace handlers ────────────────────

    this.gateway.onMessage("skillSearch", async (_client, message) => {
      const { query, limit } = message.payload as { query: string; limit?: number };
      try {
        const results = await this.clawhub.search(query, limit);
        this.gateway.send(_client.id, "skillSearchResults", results);
      } catch (err: unknown) {
        this.gateway.send(_client.id, "error", {
          message: `Skill search failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    this.gateway.onMessage("skillTrending", async (_client, message) => {
      const { limit } = message.payload as { limit?: number };
      try {
        const results = await this.clawhub.trending(limit);
        this.gateway.send(_client.id, "skillSearchResults", results);
      } catch (err: unknown) {
        this.gateway.send(_client.id, "error", {
          message: `Failed to fetch trending: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    this.gateway.onMessage("skillInstall", async (_client, message) => {
      const { slug, version } = message.payload as { slug: string; version?: string };
      try {
        const installed = await this.clawhub.install(slug, version);
        this.gateway.send(_client.id, "skillInstalled", installed);
      } catch (err: unknown) {
        this.gateway.send(_client.id, "error", {
          message: `Install failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    this.gateway.onMessage("skillUninstall", (_client, message) => {
      const { slug } = message.payload as { slug: string };
      this.clawhub.uninstall(slug);
      this.gateway.send(_client.id, "skillUninstalled", { slug });
    });

    this.gateway.onMessage("skillUpdate", async (_client, message) => {
      const { slug } = message.payload as { slug: string };
      try {
        const updated = await this.clawhub.update(slug);
        if (updated) {
          this.gateway.send(_client.id, "skillInstalled", updated);
        }
      } catch (err: unknown) {
        this.gateway.send(_client.id, "error", {
          message: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    this.gateway.onMessage("skillCheckUpdates", async (_client) => {
      try {
        const updates = await this.clawhub.checkUpdates();
        this.gateway.send(_client.id, "skillUpdatesAvailable", Object.fromEntries(updates));
      } catch (err: unknown) {
        this.gateway.send(_client.id, "error", {
          message: `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    // ── Council lifecycle management ─────────────────────────────

    this.gateway.onMessage("councilStart", (_client) => {
      if (this.council) {
        this.council.startCouncil().then(() => {
          this.gateway.broadcast("councilLifecycle", { running: true });
        });
      }
    });

    this.gateway.onMessage("councilStop", (_client) => {
      if (this.council) {
        this.council.stopCouncil().then(() => {
          this.gateway.broadcast("councilLifecycle", { running: false });
        });
      }
    });

    this.gateway.onMessage("councilRestart", (_client) => {
      if (this.council) {
        this.council.restartCouncil().then(() => {
          this.gateway.broadcast("councilLifecycle", { running: true });
        });
      }
    });

    // ── Model swap handler ─────────────────────────────────────

    this.gateway.onMessage("modelSwap", async (client, message) => {
      if (!this.council) {
        this.gateway.send(client.id, "error", { message: "No council configured" });
        return;
      }
      const { memberId, newModel, backend, reason } = message.payload as {
        memberId: string;
        newModel: string;
        backend?: string;
        reason: string;
      };
      try {
        const result = await this.council.swapModel({
          memberId,
          newModel,
          newBackend: backend as "ollama" | "llamacpp" | "vllm" | undefined,
          reason: reason || "Manual swap from UI",
        });
        this.gateway.broadcast("modelSwapped", result);
      } catch (err: unknown) {
        this.gateway.send(client.id, "error", {
          message: `Model swap failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    // ── Cloud approval handler ─────────────────────────────────
    // When the director recommends cloud escalation, the UI shows an
    // approval dialog. The user's response comes back through this handler.

    this.gateway.onMessage("cloudApprovalResponse", (_client, _message) => {
      // The council handles approval through its callback mechanism
      // This is forwarded via the approval callback set in autoLoadCouncil
    });

    // ── Memory search handler ──────────────────────────────────

    this.gateway.onMessage("memorySearch", (client, message) => {
      if (!this.council) {
        this.gateway.send(client.id, "error", { message: "No council configured" });
        return;
      }
      const mm = this.council.getMemoryManager();
      if (!mm) {
        this.gateway.send(client.id, "error", { message: "Council memory not configured" });
        return;
      }
      const { query, memberId, limit } = message.payload as {
        query: string;
        memberId?: string;
        limit?: number;
      };
      if (memberId) {
        const results = mm.searchKnowledge(memberId, query, limit || 20);
        this.gateway.send(client.id, "memorySearchResults", { results, memberId });
      } else {
        // Search all members
        const allResults: Array<{
          importance: number;
          memberName: string;
          memberId: string;
          [key: string]: unknown;
        }> = [];
        for (const m of mm.getAllMembers()) {
          const results = mm.searchKnowledge(m.memberId, query, 5);
          allResults.push(
            ...results.map((r) => ({ ...r, memberName: m.memberName, memberId: m.memberId })),
          );
        }
        allResults.sort((a, b) => b.importance - a.importance);
        this.gateway.send(client.id, "memorySearchResults", {
          results: allResults.slice(0, limit || 20),
        });
      }
    });

    // Forward council memory stats with status updates
    if (this.council) {
      this.council.on("deliberationComplete", () => {
        const mm = this.council?.getMemoryManager();
        if (mm) {
          this.gateway.broadcast("councilMemoryStats", mm.getStats());
        }
      });
    }

    // ── Cloud approval callback wiring ────────────────────────
    // Connect the council's cloud approval mechanism to the UI via gateway
    if (this.council) {
      let pendingApprovalResolve: ((approved: boolean) => void) | null = null;

      this.council.setCloudApprovalCallback(async (req) => {
        // Forward approval request to all connected UI clients
        this.gateway.broadcast("cloudApprovalRequired", req);
        // Wait for user response
        return new Promise<boolean>((resolve) => {
          pendingApprovalResolve = resolve;
          // Timeout: deny after 60 seconds of no response
          setTimeout(() => {
            if (pendingApprovalResolve === resolve) {
              pendingApprovalResolve = null;
              resolve(false);
            }
          }, 60000);
        });
      });

      // Handle the approval response from UI
      this.gateway.onMessage("cloudApprovalResponse", (_client, message) => {
        const { approved } = message.payload as { requestId: string; approved: boolean };
        if (pendingApprovalResolve) {
          pendingApprovalResolve(approved);
          pendingApprovalResolve = null;
        }
      });
    }

    // When voice engine detects a complete user utterance, process it
    // through the agent and stream the response back as TTS
    this.voice.on("userUtterance", (clientId: string, text: string, turnId: number) => {
      const userId = clientId;
      this.personality.startConversation(userId);
      this.personality.addMessage(userId, "user", text);

      const task = {
        id: `voice-${turnId}-${Date.now()}`,
        instruction: text,
        role: this.config.rbac.defaultRole,
        createdAt: Date.now(),
      };

      this.queue.enqueue(
        `voice:${task.id}`,
        async () => {
          const results = await this.agent.executeTask(task);
          const lastResult = results[results.length - 1];

          if (lastResult?.message?.content) {
            const responseText = lastResult.message.content;
            this.personality.addMessage(userId, "assistant", responseText);

            // Stream the response as TTS audio
            await this.voice.respondWithVoice(clientId, responseText, turnId);
          }

          return results;
        },
        { destructive: false, priority: 1 },
      );
    });
  }

  /**
   * Load and activate an LLM council.
   * Accepts tiered (3-tier hierarchy) or flat (legacy) configs.
   */
  loadCouncil(config: import("./council").CouncilConfig): Council {
    this.council = new Council(config);
    // Wire council escalation evaluator to router
    this.router.setEscalationEvaluator((req) => this.council!.evaluateEscalation(req));
    return this.council;
  }
}
