import { EventEmitter } from "events";

export interface DiscoveryConfig {
  enabled: boolean;
  scanIntervalMs: number;
  knownBackends: Array<{
    name: string;
    url: string;
    models?: string[];
  }>;
  /** Additional IPs to probe for Ollama (e.g. council member container IPs) */
  probeHosts?: string[];
}

export interface LlmBackend {
  name: string;
  url: string;
  type: "ollama" | "vllm" | "llamacpp" | "lmstudio" | "unknown";
  models: string[];
  healthy: boolean;
  lastSeen: number;
  discoveredVia: "manual" | "probe" | "mdns";
}

/**
 * Local LLM Autodiscovery Service.
 *
 * Probes known ports for local inference servers (Ollama, vLLM, llama.cpp, LM Studio)
 * and maintains a registry of available backends. Optionally uses mDNS for LAN discovery.
 */
export class DiscoveryService extends EventEmitter {
  private readonly config: DiscoveryConfig;
  private readonly backends = new Map<string, LlmBackend>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  // Well-known default ports for local LLM servers
  private static readonly PROBE_TARGETS = [
    { port: 11434, type: "ollama" as const, path: "/api/tags" },
    { port: 8080, type: "llamacpp" as const, path: "/health" },
    { port: 8000, type: "vllm" as const, path: "/v1/models" },
    { port: 1234, type: "lmstudio" as const, path: "/v1/models" },
  ];

  constructor(config: DiscoveryConfig) {
    super();
    this.config = config;

    // Register manually configured backends
    for (const backend of config.knownBackends) {
      this.backends.set(backend.url, {
        name: backend.name,
        url: backend.url,
        type: "unknown",
        models: backend.models || [],
        healthy: false,
        lastSeen: 0,
        discoveredVia: "manual",
      });
    }
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;

    // Initial scan
    await this.scan();

    // Periodic scanning
    this.scanTimer = setInterval(
      () => this.scan(),
      this.config.scanIntervalMs
    );
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  async scan(): Promise<LlmBackend[]> {
    const discovered: LlmBackend[] = [];

    // Probe well-known ports on localhost
    const probes = DiscoveryService.PROBE_TARGETS.map(async (target) => {
      const url = `http://127.0.0.1:${target.port}`;
      const backend = await this.probeBackend(
        url,
        target.type,
        target.path
      );
      if (backend) {
        discovered.push(backend);
        const isNew = !this.backends.has(url);
        this.backends.set(url, backend);
        if (isNew) {
          this.emit("backendDiscovered", backend);
        }
      }
    });

    // Probe additional hosts (e.g. Proxmox council member containers)
    const hostProbes = (this.config.probeHosts || []).map(async (host) => {
      // Probe Ollama port on each council member IP
      const url = `http://${host}:11434`;
      const backend = await this.probeBackend(url, "ollama", "/api/tags");
      if (backend) {
        discovered.push(backend);
        const isNew = !this.backends.has(url);
        this.backends.set(url, backend);
        if (isNew) {
          this.emit("backendDiscovered", backend);
        }
      }
    });

    // Also probe manually configured backends
    const manualProbes = Array.from(this.backends.values())
      .filter((b) => b.discoveredVia === "manual")
      .map(async (existing) => {
        const backend = await this.probeBackend(
          existing.url,
          existing.type,
          "/v1/models"
        );
        if (backend) {
          backend.discoveredVia = "manual";
          backend.name = existing.name;
          this.backends.set(existing.url, backend);
          discovered.push(backend);
        } else {
          existing.healthy = false;
        }
      });

    await Promise.allSettled([...probes, ...hostProbes, ...manualProbes]);

    this.emit("scanComplete", discovered.length);
    return discovered;
  }

  getBackends(): LlmBackend[] {
    return Array.from(this.backends.values());
  }

  getHealthyBackends(): LlmBackend[] {
    return this.getBackends().filter((b) => b.healthy);
  }

  getBackendByModel(modelName: string): LlmBackend | undefined {
    return this.getHealthyBackends().find((b) =>
      b.models.some(
        (m) => m === modelName || m.includes(modelName)
      )
    );
  }

  private async probeBackend(
    baseUrl: string,
    expectedType: LlmBackend["type"],
    healthPath: string
  ): Promise<LlmBackend | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${baseUrl}${healthPath}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (!response.ok) return null;

      const data = await response.json().catch(() => ({}));
      const models = this.extractModels(data, expectedType);

      return {
        name: expectedType,
        url: baseUrl,
        type: expectedType,
        models,
        healthy: true,
        lastSeen: Date.now(),
        discoveredVia: "probe",
      };
    } catch {
      return null;
    }
  }

  private extractModels(data: any, type: LlmBackend["type"]): string[] {
    try {
      switch (type) {
        case "ollama":
          // Ollama returns { models: [{ name: "..." }] }
          return (data.models || []).map((m: any) => m.name || m);
        case "vllm":
        case "lmstudio":
          // OpenAI-compatible returns { data: [{ id: "..." }] }
          return (data.data || []).map((m: any) => m.id || m);
        default:
          return [];
      }
    } catch {
      return [];
    }
  }
}
