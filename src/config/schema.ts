/**
 * OpenClaw Configuration JSON Schema
 *
 * Provides formal schema validation for openclaw.json, enabling
 * IDE autocompletion and setup wizard validation.
 */

export const OPENCLAW_CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://openclaw.dev/schema/v2/config.json",
  title: "OpenClaw Configuration",
  description: "Configuration schema for OpenClaw v2 autonomous agency framework",
  type: "object",
  required: ["version"],
  properties: {
    version: {
      type: "string",
      pattern: "^2\\.\\d+\\.\\d+$",
      description: "Configuration schema version (must be 2.x.x)",
    },
    useCloudModels: {
      type: "boolean",
      description: "Enable cloud model providers (OpenAI, Anthropic, etc). Default false — local models only.",
    },
    resourceScaling: {
      type: "object",
      description: "Hardware resource auto-detection and scaling (reference: 16-core / 128 GB)",
      properties: {
        mode: { type: "string", enum: ["auto", "manual"], description: "auto = detect hardware, manual = use explicit config" },
        maxUtilization: { type: "number", minimum: 0.1, maximum: 1.0, description: "Max fraction of resources to use (default: 0.8 = 80%)" },
        reservedMemoryMb: { type: "number", minimum: 0, description: "Memory reserved for OS and services in MB (default: 4096)" },
        reservedCores: { type: "number", minimum: 0, description: "CPU cores reserved for OS and services (default: 2)" },
      },
    },
    gateway: {
      type: "object",
      description: "Gateway server configuration",
      properties: {
        host: { type: "string" },
        port: { type: "number", minimum: 1, maximum: 65535 },
        allowedOrigins: { type: "array", items: { type: "string" } },
        csrfSecret: { type: "string", minLength: 32 },
        rateLimit: {
          type: "object",
          properties: {
            windowMs: { type: "number" },
            maxRequests: { type: "number" },
          },
        },
        tls: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            certPath: { type: "string" },
            keyPath: { type: "string" },
          },
        },
      },
    },
    agent: {
      type: "object",
      description: "Agent reasoning engine configuration",
      properties: {
        defaultModel: { type: "string" },
        maxTurns: { type: "number", minimum: 1, maximum: 500 },
        temperature: { type: "number", minimum: 0, maximum: 2 },
        systemPrompt: { type: "string" },
      },
    },
    memory: {
      type: "object",
      description: "Memory system configuration",
      properties: {
        backend: { type: "string", enum: ["graph", "vector", "hybrid"] },
        maxNodes: { type: "number" },
        importanceThreshold: { type: "number", minimum: 0, maximum: 1 },
        autoSummarize: { type: "boolean" },
        summarizeAfterTurns: { type: "number" },
        persistPath: { type: "string", description: "Directory for persisting memory, vector, and personality data to disk. Default: ./data" },
      },
    },
    sandbox: {
      type: "object",
      description: "Execution sandbox configuration (secure by default)",
      properties: {
        enabled: { type: "boolean" },
        runtime: { type: "string", enum: ["wasm", "docker", "nsjail", "none"] },
        allowNetwork: { type: "boolean" },
        maxMemoryMb: { type: "number", minimum: 64 },
        maxCpuSeconds: { type: "number", minimum: 1 },
        allowedPaths: { type: "array", items: { type: "string" } },
      },
    },
    skills: {
      type: "object",
      description: "Skill ecosystem configuration",
      properties: {
        registryUrl: { type: "string" },
        requireSigned: { type: "boolean" },
        installed: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "version"],
            properties: {
              name: { type: "string" },
              version: { type: "string" },
              permissions: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
    laneQueue: {
      type: "object",
      description: "Task execution lane queue configuration",
      properties: {
        maxParallel: { type: "number", minimum: 1, maximum: 32 },
        lockTimeoutMs: { type: "number" },
      },
    },
    discovery: {
      type: "object",
      description: "Local LLM autodiscovery configuration",
      properties: {
        enabled: { type: "boolean" },
        scanIntervalMs: { type: "number" },
        knownBackends: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "url"],
            properties: {
              name: { type: "string" },
              url: { type: "string" },
              models: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    rbac: {
      type: "object",
      description: "Role-Based Access Control configuration",
      properties: {
        enabled: { type: "boolean" },
        defaultRole: { type: "string" },
        roles: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "permissions"],
            properties: {
              name: { type: "string" },
              permissions: { type: "array", items: { type: "string" } },
              allowedPaths: { type: "array", items: { type: "string" } },
              allowedApiScopes: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    databases: {
      type: "object",
      description: "Dedicated database backends running in separate VMs/containers",
      properties: {
        qdrant: {
          type: "object",
          description: "Qdrant vector database (replaces in-memory VectorStore)",
          properties: {
            url: { type: "string", description: "Qdrant REST endpoint, e.g. http://10.0.0.50:6333" },
            collection: { type: "string", description: "Collection name (default: openclaw)" },
            apiKey: { type: "string", description: "API key for secured Qdrant instances" },
          },
        },
        neo4j: {
          type: "object",
          description: "Neo4j knowledge graph (replaces in-memory GraphMemory)",
          properties: {
            url: { type: "string", description: "Neo4j HTTP endpoint, e.g. http://10.0.0.51:7474" },
            database: { type: "string", description: "Database name (default: neo4j)" },
            username: { type: "string", description: "Neo4j username" },
            password: { type: "string", description: "Neo4j password" },
          },
        },
        sql: {
          type: "object",
          description: "SQL database for standard relational storage (MariaDB remote or SQLite embedded)",
          properties: {
            backend: { type: "string", enum: ["mariadb", "sqlite"], description: "Database backend (default: sqlite)" },
            url: { type: "string", description: "MariaDB REST proxy endpoint, e.g. http://10.0.0.52:8080" },
            database: { type: "string", description: "Database name (default: openclaw)" },
            username: { type: "string", description: "MariaDB username" },
            password: { type: "string", description: "MariaDB password" },
            sqlitePath: { type: "string", description: "SQLite file path (default: ./data/openclaw.db)" },
          },
        },
      },
    },
    personality: {
      type: "object",
      description: "Clara personality and persistent user knowledge graph configuration",
      properties: {
        claraName: { type: "string", description: "Clara's display name (default: Clara)" },
        userName: { type: "string", description: "Primary user's name Clara uses (default: Attila)" },
        persistPath: { type: "string", description: "Directory to persist personality and knowledge graph data (default: ./data)" },
        traits: {
          type: "object",
          description: "Override Clara's default personality traits",
          properties: {
            friendlinessLevel: { type: "number", minimum: 0, maximum: 1 },
            verbosity: { type: "number", minimum: 0, maximum: 1 },
            proactivity: { type: "number", minimum: 0, maximum: 1 },
            humor: { type: "number", minimum: 0, maximum: 1 },
            technicality: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        knowledgeGraph: {
          type: "object",
          description: "User knowledge graph settings",
          properties: {
            enabled: { type: "boolean", description: "Enable knowledge graph extraction from conversations (default: true)" },
            minConfidence: { type: "number", minimum: 0, maximum: 1, description: "Min confidence to retain a fact (default: 0.3)" },
            maxNodesPerUser: { type: "number", minimum: 10, description: "Max knowledge nodes per user (default: 500)" },
            extractionEnabled: { type: "boolean", description: "Auto-extract facts from messages (default: true)" },
          },
        },
      },
    },
    lora: {
      type: "object",
      description: "LoRA fine-tuning pipeline for recursive self-improvement",
      properties: {
        enabled: { type: "boolean", description: "Enable LoRA training pipeline" },
        ollamaEndpoint: { type: "string", description: "Ollama endpoint for model creation" },
        baseModel: { type: "string", description: "Base model to fine-tune (default: agent's defaultModel)" },
        rank: { type: "number", minimum: 4, maximum: 64, description: "LoRA rank (default: 16)" },
        alpha: { type: "number", minimum: 4, maximum: 128, description: "LoRA alpha scaling (default: rank*2)" },
        qualityThreshold: { type: "number", minimum: 0, maximum: 1, description: "Min score to collect training data (default: 0.7)" },
        minTrainingExamples: { type: "number", minimum: 10, description: "Min examples before training (default: 50)" },
        maxTrainingExamples: { type: "number", minimum: 50, description: "Max examples per training run (default: 500)" },
        trainingCheckInterval: { type: "number", description: "How often to check for training data (ms, default: 3600000)" },
      },
    },
    clawhub: {
      type: "object",
      description: "ClawHub skill marketplace integration (https://clawhub.ai)",
      properties: {
        registryUrl: { type: "string", description: "ClawHub registry URL (default: https://clawhub.ai)" },
        skillsDir: { type: "string", description: "Directory for installed skills (default: ./data/skills)" },
        authToken: { type: "string", description: "ClawHub auth token (clh_...) for publish/star" },
        autoCheckUpdates: { type: "boolean", description: "Check for updates on startup (default: true)" },
        verifyHashes: { type: "boolean", description: "SHA-256 verify downloads (default: true)" },
        maxConcurrentDownloads: { type: "number", minimum: 1, maximum: 10, description: "Max parallel downloads (default: 3)" },
      },
    },
    router: {
      type: "object",
      description: "Smart Router configuration (council-gated escalation)",
      properties: {
        confidenceThreshold: { type: "number", minimum: 0, maximum: 1, description: "Confidence below this triggers council evaluation (default: 0.6)" },
        maxLocalTokens: { type: "number", minimum: 0, description: "Max tokens for local before considering escalation (default: 0)" },
        autoEscalate: { type: "boolean", description: "Skip council gate and auto-escalate (default: false)" },
        maxCostPerRequest: { type: "number", minimum: 0, description: "Max cloud cost per request in USD (default: 0.50)" },
        maxDailySpend: { type: "number", minimum: 0, description: "Max daily cloud spend in USD (default: 10.00)" },
        logDecisions: { type: "boolean", description: "Log all routing decisions (default: true)" },
        maxDecisionHistory: { type: "number", minimum: 10, description: "Number of decisions to keep in memory (default: 1000)" },
      },
    },
    providers: {
      type: "object",
      description: "Cloud LLM provider credentials (only used when useCloudModels is true)",
      properties: {
        openai: {
          type: "object",
          description: "OpenAI-compatible API (also works with Together, Groq, OpenRouter)",
          properties: {
            apiKey: { type: "string", description: "API key" },
            baseUrl: { type: "string", description: "Base URL (default: https://api.openai.com)" },
            model: { type: "string", description: "Model name (default: gpt-4o)" },
            maxTokens: { type: "number", description: "Max output tokens" },
          },
        },
        anthropic: {
          type: "object",
          description: "Anthropic Messages API (Claude)",
          properties: {
            apiKey: { type: "string", description: "API key" },
            baseUrl: { type: "string", description: "Base URL (default: https://api.anthropic.com)" },
            model: { type: "string", description: "Model name (default: claude-sonnet-4-5-20250929)" },
            maxTokens: { type: "number", description: "Max output tokens" },
          },
        },
        google: {
          type: "object",
          description: "Google Generative AI (Gemini)",
          properties: {
            apiKey: { type: "string", description: "API key" },
            baseUrl: { type: "string", description: "Base URL (default: https://generativelanguage.googleapis.com)" },
            model: { type: "string", description: "Model name (default: gemini-2.0-flash)" },
            maxTokens: { type: "number", description: "Max output tokens" },
          },
        },
      },
    },
  },
  additionalProperties: false,
};
