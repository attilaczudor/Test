import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import Ajv from "ajv";
import { OPENCLAW_CONFIG_SCHEMA } from "./schema";

export interface OpenClawConfig {
  version: string;
  useCloudModels: boolean;
  resourceScaling: {
    mode: "auto" | "manual";
    maxUtilization: number; // 0-1, default 0.8 (80%)
    reservedMemoryMb: number;
    reservedCores: number;
  };
  gateway: {
    host: string;
    port: number;
    allowedOrigins: string[];
    csrfSecret?: string;
    rateLimit: { windowMs: number; maxRequests: number };
    tls?: { enabled: boolean; certPath?: string; keyPath?: string };
  };
  agent: {
    defaultModel: string;
    maxTurns: number;
    temperature: number;
    systemPrompt?: string;
  };
  memory: {
    backend: "graph" | "vector" | "hybrid";
    maxNodes: number;
    importanceThreshold: number;
    autoSummarize: boolean;
    summarizeAfterTurns: number;
    persistPath: string;
  };
  sandbox: {
    enabled: boolean;
    runtime: "wasm" | "docker" | "nsjail" | "none";
    allowNetwork: boolean;
    maxMemoryMb: number;
    maxCpuSeconds: number;
    allowedPaths: string[];
  };
  skills: {
    registryUrl: string;
    requireSigned: boolean;
    installed: Array<{
      name: string;
      version: string;
      permissions?: string[];
    }>;
  };
  laneQueue: {
    maxParallel: number;
    lockTimeoutMs: number;
  };
  discovery: {
    enabled: boolean;
    scanIntervalMs: number;
    knownBackends: Array<{
      name: string;
      url: string;
      models?: string[];
    }>;
  };
  rbac: {
    enabled: boolean;
    defaultRole: string;
    roles: Array<{
      name: string;
      permissions: string[];
      allowedPaths?: string[];
      allowedApiScopes?: string[];
    }>;
  };
  databases?: {
    qdrant?: {
      url: string;
      collection?: string;
      apiKey?: string;
    };
    neo4j?: {
      url: string;
      database?: string;
      username?: string;
      password?: string;
    };
  };
  lora?: {
    enabled: boolean;
    ollamaEndpoint?: string;
    baseModel?: string;
    rank?: number;
    alpha?: number;
    qualityThreshold?: number;
    minTrainingExamples?: number;
    maxTrainingExamples?: number;
    trainingCheckInterval?: number;
  };
  clawhub?: {
    registryUrl?: string;
    skillsDir?: string;
    authToken?: string;
    autoCheckUpdates?: boolean;
    verifyHashes?: boolean;
    maxConcurrentDownloads?: number;
  };
  router?: {
    confidenceThreshold?: number;
    maxLocalTokens?: number;
    autoEscalate?: boolean;
    maxCostPerRequest?: number;
    maxDailySpend?: number;
    logDecisions?: boolean;
    maxDecisionHistory?: number;
  };
  providers?: {
    openai?: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
      maxTokens?: number;
    };
    anthropic?: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
      maxTokens?: number;
    };
    google?: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
      maxTokens?: number;
    };
  };
}

const DEFAULTS: Omit<OpenClawConfig, "version"> = {
  useCloudModels: false,
  resourceScaling: {
    mode: "auto",
    maxUtilization: 0.8,
    reservedMemoryMb: 4096,
    reservedCores: 4,
  },
  gateway: {
    host: "0.0.0.0",
    port: 3100,
    allowedOrigins: ["http://localhost:3100", "http://127.0.0.1:3100"],
    rateLimit: { windowMs: 60000, maxRequests: 100 },
  },
  agent: {
    defaultModel: "dolphin-mistral:7b",
    maxTurns: 50,
    temperature: 0.7,
  },
  memory: {
    backend: "graph",
    maxNodes: 10000,
    importanceThreshold: 0.3,
    autoSummarize: true,
    summarizeAfterTurns: 100,
    persistPath: "./data",
  },
  sandbox: {
    enabled: true,
    runtime: "wasm",
    allowNetwork: false,
    maxMemoryMb: 512,
    maxCpuSeconds: 30,
    allowedPaths: [],
  },
  skills: {
    registryUrl: "https://registry.openclaw.dev",
    requireSigned: true,
    installed: [],
  },
  laneQueue: {
    maxParallel: 4,
    lockTimeoutMs: 30000,
  },
  discovery: {
    enabled: true,
    scanIntervalMs: 30000,
    knownBackends: [],
  },
  rbac: {
    enabled: true,
    defaultRole: "agent",
    roles: [
      {
        name: "admin",
        permissions: ["*"],
        allowedPaths: ["**"],
        allowedApiScopes: ["*"],
      },
      {
        name: "agent",
        permissions: ["FS_READ", "FS_WRITE", "NET_OUTBOUND", "SHELL_EXEC"],
        allowedPaths: ["./**"],
        allowedApiScopes: ["llm:invoke", "memory:read", "memory:write"],
      },
      {
        name: "skill",
        permissions: ["FS_READ"],
        allowedPaths: [],
        allowedApiScopes: ["memory:read"],
      },
    ],
  },
};

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function generateCsrfSecret(): string {
  // Use cryptographically secure random bytes — no modulo bias
  return crypto.randomBytes(32).toString("hex");
}

export function validateConfig(raw: unknown): OpenClawConfig {
  const ajv = new Ajv({ allErrors: true, useDefaults: true });
  const validate = ajv.compile(OPENCLAW_CONFIG_SCHEMA);

  if (!validate(raw)) {
    const errors = (validate.errors || []).map((e) => ({
      path: e.instancePath || "/",
      message: e.message || "Unknown validation error",
    }));
    throw new ConfigValidationError(
      `Invalid openclaw.json: ${errors.length} error(s) found`,
      errors,
    );
  }

  return raw as OpenClawConfig;
}

export function loadConfig(configPath?: string): OpenClawConfig {
  const resolvedPath = configPath || path.resolve(process.cwd(), "openclaw.json");

  let raw: Record<string, unknown>;
  if (fs.existsSync(resolvedPath)) {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    try {
      raw = JSON.parse(content);
    } catch (err) {
      throw new ConfigValidationError(
        `Failed to parse ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
        [{ path: "/", message: "File is not valid JSON" }],
      );
    }
  } else {
    raw = { version: "2.0.0" };
  }

  const merged = deepMerge({ version: raw.version, ...DEFAULTS }, raw);

  if (!merged.gateway.csrfSecret) {
    merged.gateway.csrfSecret = generateCsrfSecret();
  }

  // Validate origin format — each must be a valid URL or "*"
  if (merged.gateway.allowedOrigins) {
    for (const origin of merged.gateway.allowedOrigins) {
      if (origin !== "*" && !/^https?:\/\/.+/.test(origin)) {
        throw new ConfigValidationError(
          `Invalid origin '${origin}': must be http(s)://... or "*"`,
          [{ path: "/gateway/allowedOrigins", message: `Invalid origin: ${origin}` }],
        );
      }
    }
  }

  const config = validateConfig(merged);
  validateRequiredEnvVars(config);
  return config;
}

function validateRequiredEnvVars(config: OpenClawConfig): void {
  const missing: string[] = [];

  if (config.useCloudModels) {
    const hasAnyProvider =
      config.providers?.openai?.apiKey ||
      config.providers?.anthropic?.apiKey ||
      config.providers?.google?.apiKey;
    if (!hasAnyProvider) {
      missing.push(
        "useCloudModels is enabled but no provider API key is configured in providers.openai/anthropic/google",
      );
    }
  }

  if (config.databases?.qdrant?.url && !config.databases.qdrant.url.startsWith("http")) {
    missing.push("databases.qdrant.url must be a valid HTTP(S) URL");
  }

  if (config.databases?.neo4j?.url && !config.databases.neo4j.url.startsWith("http")) {
    missing.push("databases.neo4j.url must be a valid HTTP(S) URL");
  }

  if (missing.length > 0) {
    throw new ConfigValidationError(
      `Missing required configuration: ${missing.join("; ")}`,
      missing.map((m) => ({ path: "/", message: m })),
    );
  }
}

// oxlint-disable-next-line typescript-eslint/no-explicit-any -- recursive merge over arbitrary config shapes
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      source[key] !== undefined &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (Array.isArray(source[key]) && source[key].length > 0) {
      // User-provided arrays replace defaults entirely (intentional override)
      result[key] = source[key];
    } else if (Array.isArray(source[key]) && source[key].length === 0) {
      // Empty arrays in source don't overwrite non-empty defaults —
      // this prevents an empty user config from wiping default roles/origins.
      // To explicitly clear an array, omit the key or set it to a non-empty value.
      if (!Array.isArray(result[key]) || result[key].length === 0) {
        result[key] = source[key];
      }
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function writeDefaultConfig(outputPath: string): void {
  const config = {
    version: "2.0.0",
    useCloudModels: false,
    resourceScaling: {
      mode: "auto",
      maxUtilization: 0.8,
    },
    gateway: {
      host: "0.0.0.0",
      port: 3100,
      allowedOrigins: ["http://localhost:3100", "http://127.0.0.1:3100"],
    },
    agent: {
      defaultModel: "dolphin-mistral:7b",
    },
    memory: {
      backend: "graph",
      persistPath: "./data",
    },
    sandbox: {
      enabled: true,
      runtime: "wasm",
    },
    rbac: {
      enabled: true,
    },
    // Uncomment to use dedicated database VMs:
    // databases: {
    //   qdrant: { url: "http://10.0.0.50:6333", collection: "openclaw" },
    //   neo4j: { url: "http://10.0.0.51:7474", username: "neo4j", password: "changeme" },
    // },
    // Uncomment to enable LoRA recursive self-improvement:
    // lora: {
    //   enabled: true,
    //   baseModel: "dolphin-mistral:7b",
    //   qualityThreshold: 0.7,
    // },
  };
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n");
}
