import { EventEmitter } from "events";
import * as https from "https";

export interface ProxmoxConfig {
  apiUrl: string; // e.g. "https://proxmox.local:8006/api2/json"
  tokenId: string; // e.g. "root@pam!openclaw"
  tokenSecret: string;
  node: string; // Proxmox node name
  verifySsl: boolean;
}

export interface VmTemplate {
  name: string;
  type: "lxc" | "vm";
  cores: number;
  memoryMb: number;
  diskGb: number;
  osTemplate?: string; // LXC template (e.g. "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst")
  isoImage?: string; // VM ISO
  startupScript?: string; // Cloud-init or setup script
}

export interface LlmInstance {
  id: string;
  vmid: number;
  name: string;
  type: "lxc" | "vm";
  status: "running" | "stopped" | "creating" | "error";
  ip?: string;
  model: string;
  backend: "ollama" | "llamacpp" | "vllm";
  port: number;
  createdAt: number;
}

/**
 * Proxmox VM/LXC Container Manager for OpenClaw.
 *
 * Spins up lightweight containers or VMs running local LLM inference
 * servers (Ollama, llama.cpp, vLLM) for specific purposes. Each
 * container downloads its model from HuggingFace and serves it.
 */
export class ProxmoxManager extends EventEmitter {
  private readonly config: ProxmoxConfig;
  private readonly instances = new Map<string, LlmInstance>();
  private nextVmid = 302;

  constructor(config: ProxmoxConfig) {
    super();
    this.config = config;
  }

  async createLlmContainer(opts: {
    name: string;
    model: string;
    backend: "ollama" | "llamacpp" | "vllm";
    purpose: string;
    cores?: number;
    memoryMb?: number;
    diskGb?: number;
  }): Promise<LlmInstance> {
    const vmid = this.nextVmid++;
    const instance: LlmInstance = {
      id: `llm-${vmid}`,
      vmid,
      name: opts.name,
      type: "lxc",
      status: "creating",
      model: opts.model,
      backend: opts.backend,
      port: 11434 + (vmid - 302),
      createdAt: Date.now(),
    };

    this.instances.set(instance.id, instance);
    this.emit("instanceCreating", instance);

    try {
      // Create the LXC container via Proxmox API
      await this.apiCall("POST", `/nodes/${this.config.node}/lxc`, {
        vmid,
        hostname: opts.name,
        ostemplate: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
        cores: opts.cores || 4,
        memory: opts.memoryMb || 4096,
        rootfs: `local-lvm:${opts.diskGb || 20}`,
        net0: "name=eth0,bridge=vmbr0,ip=dhcp",
        start: 1,
        unprivileged: 1,
      });

      // Wait for container to boot
      await this.waitForBoot(vmid);

      // Get the container's IP
      const ip = await this.getContainerIp(vmid);
      instance.ip = ip;

      // Install and configure the LLM backend
      await this.setupLlmBackend(vmid, opts.backend, opts.model);

      instance.status = "running";
      this.emit("instanceRunning", instance);
    } catch (err: unknown) {
      instance.status = "error";
      this.emit("instanceError", {
        instance,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return instance;
  }

  async destroyInstance(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    try {
      // Stop the container
      await this.apiCall("POST", `/nodes/${this.config.node}/lxc/${instance.vmid}/status/stop`);

      // Destroy it
      await this.apiCall("DELETE", `/nodes/${this.config.node}/lxc/${instance.vmid}`);

      this.instances.delete(id);
      this.emit("instanceDestroyed", id);
      return true;
    } catch {
      return false;
    }
  }

  async startInstance(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    try {
      await this.apiCall("POST", `/nodes/${this.config.node}/lxc/${instance.vmid}/status/start`);
      instance.status = "running";
      return true;
    } catch {
      return false;
    }
  }

  async stopInstance(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) {
      return false;
    }

    try {
      await this.apiCall("POST", `/nodes/${this.config.node}/lxc/${instance.vmid}/status/stop`);
      instance.status = "stopped";
      return true;
    } catch {
      return false;
    }
  }

  listInstances(): LlmInstance[] {
    return Array.from(this.instances.values());
  }

  getRunningInstances(): LlmInstance[] {
    return this.listInstances().filter((i) => i.status === "running");
  }

  getInstance(id: string): LlmInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Generate a setup script for an LLM container.
   */
  generateSetupScript(backend: "ollama" | "llamacpp" | "vllm", model: string): string {
    switch (backend) {
      case "ollama":
        return [
          "#!/bin/bash",
          "set -e",
          "apt-get update && apt-get install -y curl",
          "curl -fsSL https://ollama.ai/install.sh | sh",
          "systemctl enable ollama",
          "systemctl start ollama",
          `sleep 5 && ollama pull ${model}`,
          `echo 'Ollama ready with model: ${model}'`,
        ].join("\n");

      case "llamacpp":
        return [
          "#!/bin/bash",
          "set -e",
          "apt-get update && apt-get install -y build-essential cmake git python3-pip",
          "git clone https://github.com/ggerganov/llama.cpp /opt/llama.cpp",
          "cd /opt/llama.cpp && make -j$(nproc)",
          "pip3 install huggingface-hub",
          `python3 -c "from huggingface_hub import hf_hub_download; hf_hub_download('${model}', filename='*.gguf', local_dir='/opt/models')"`,
          "/opt/llama.cpp/llama-server -m /opt/models/*.gguf --host 0.0.0.0 --port 8080 &",
          `echo 'llama.cpp ready with model: ${model}'`,
        ].join("\n");

      case "vllm":
        return [
          "#!/bin/bash",
          "set -e",
          "apt-get update && apt-get install -y python3-pip",
          "pip3 install vllm",
          `python3 -m vllm.entrypoints.openai.api_server --model ${model} --host 0.0.0.0 --port 8000 &`,
          `echo 'vLLM ready with model: ${model}'`,
        ].join("\n");
    }
  }

  private async apiCall(
    method: string,
    path: string,
    data?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${this.config.apiUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${this.config.tokenId}=${this.config.tokenSecret}`,
      "Content-Type": "application/json",
    };

    // Support self-signed certs common in homelab Proxmox setups
    const fetchOptions: RequestInit & { dispatcher?: unknown } = {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    };

    if (!this.config.verifySsl && url.startsWith("https:")) {
      // Node 18+ undici-based fetch supports a custom Agent via the
      // NODE_TLS_REJECT_UNAUTHORIZED env var as the simplest option.
      // For a more targeted approach, consumers can set verifySsl: true
      // and install a proper CA certificate.
      const agent = new https.Agent({ rejectUnauthorized: false });
      (fetchOptions as Record<string, unknown>).agent = agent;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Proxmox API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  private async waitForBoot(vmid: number, timeoutMs = 60000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const status = (await this.apiCall(
          "GET",
          `/nodes/${this.config.node}/lxc/${vmid}/status/current`,
        )) as { data?: { status?: string } };
        if (status?.data?.status === "running") {
          return;
        }
      } catch {
        // Ignore and retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Container ${vmid} failed to boot within ${timeoutMs}ms`);
  }

  private async getContainerIp(vmid: number): Promise<string> {
    const interfaces = (await this.apiCall(
      "GET",
      `/nodes/${this.config.node}/lxc/${vmid}/interfaces`,
    )) as { data?: Array<{ name: string; inet?: string }> };

    for (const iface of interfaces?.data || []) {
      if (iface.name === "eth0" && iface.inet) {
        return iface.inet.split("/")[0];
      }
    }

    return "unknown";
  }

  private async setupLlmBackend(
    vmid: number,
    backend: "ollama" | "llamacpp" | "vllm",
    model: string,
  ): Promise<void> {
    const script = this.generateSetupScript(backend, model);

    // Execute setup script inside the container
    await this.apiCall("POST", `/nodes/${this.config.node}/lxc/${vmid}/exec`, {
      command: ["bash", "-c", script],
    });
  }
}
