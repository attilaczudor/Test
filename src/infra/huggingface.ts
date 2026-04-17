import { EventEmitter } from "events";

export interface HuggingFaceConfig {
  token?: string; // HF API token for gated models
  cacheDir: string; // Local cache directory for downloaded models
  mirrorUrl?: string; // Optional mirror URL
}

export interface ModelInfo {
  id: string; // e.g. "TheBloke/Mistral-7B-Instruct-v0.2-GGUF"
  author: string;
  name: string;
  tags: string[];
  downloads: number;
  likes: number;
  pipelineTag?: string;
  formats: string[]; // Detected formats: gguf, safetensors, etc.
}

/** Shape returned by the HuggingFace /api/models endpoint. */
interface HfModelEntry {
  id: string;
  modelId?: string;
  author?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  pipeline_tag?: string;
  siblings?: Array<{ rfilename: string }>;
}

export interface DownloadProgress {
  modelId: string;
  filename: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}

/**
 * HuggingFace Hub Integration.
 *
 * Search, browse, and download models from HuggingFace Hub.
 * Supports GGUF (for llama.cpp), SafeTensors (for vLLM), and
 * Ollama model specs.
 */
export class HuggingFaceHub extends EventEmitter {
  private readonly config: HuggingFaceConfig;
  private readonly baseUrl: string;

  constructor(config: HuggingFaceConfig) {
    super();
    this.config = config;
    this.baseUrl = config.mirrorUrl || "https://huggingface.co";
  }

  async searchModels(
    query: string,
    opts?: {
      filter?: string;
      sort?: "downloads" | "likes" | "lastModified";
      limit?: number;
    },
  ): Promise<ModelInfo[]> {
    const params = new URLSearchParams({
      search: query,
      sort: opts?.sort || "downloads",
      direction: "-1",
      limit: String(opts?.limit || 20),
    });
    if (opts?.filter) {
      params.set("filter", opts.filter);
    }

    const response = await this.apiCall(`/api/models?${params}`);
    const data = (await response.json()) as HfModelEntry[];

    return data.map((m) => ({
      id: m.modelId || m.id,
      author: m.author || m.modelId?.split("/")[0] || "unknown",
      name: m.modelId?.split("/")[1] || m.id,
      tags: m.tags || [],
      downloads: m.downloads || 0,
      likes: m.likes || 0,
      pipelineTag: m.pipeline_tag,
      formats: this.detectFormats(m.tags || [], m.siblings || []),
    }));
  }

  async getModelInfo(modelId: string): Promise<ModelInfo & { files: string[] }> {
    const response = await this.apiCall(`/api/models/${modelId}`);
    const data = (await response.json()) as HfModelEntry;

    const files = (data.siblings || []).map((s) => s.rfilename);

    return {
      id: data.modelId || data.id,
      author: data.author || modelId.split("/")[0],
      name: modelId.split("/")[1] || modelId,
      tags: data.tags || [],
      downloads: data.downloads || 0,
      likes: data.likes || 0,
      pipelineTag: data.pipeline_tag,
      formats: this.detectFormats(data.tags || [], data.siblings || []),
      files,
    };
  }

  async downloadModel(modelId: string, filename: string): Promise<string> {
    const url = `${this.baseUrl}/${modelId}/resolve/main/${filename}`;
    const headers: Record<string, string> = {};
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const response = await fetch(url, { headers, redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Failed to download ${modelId}/${filename}: ${response.status}`);
    }

    const totalBytes = parseInt(response.headers.get("content-length") || "0", 10);
    const outputPath = `${this.config.cacheDir}/${modelId.replace("/", "_")}/${filename}`;

    // Ensure we have a body to read
    if (!response.body) {
      throw new Error("No response body for download");
    }

    // In a real implementation, we'd stream to disk here.
    // For the framework, we emit progress events.
    this.emit("downloadStart", { modelId, filename, totalBytes });

    let bytesDownloaded = 0;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(value);
      bytesDownloaded += value.length;

      this.emit("downloadProgress", {
        modelId,
        filename,
        bytesDownloaded,
        totalBytes,
        percent: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
      } as DownloadProgress);
    }

    this.emit("downloadComplete", { modelId, filename, outputPath });
    return outputPath;
  }

  /**
   * Recommend small, purpose-specific models for common tasks.
   */
  getRecommendedModels(): Array<{
    purpose: string;
    models: Array<{ id: string; format: string; sizeGb: number }>;
  }> {
    return [
      {
        purpose: "Code Generation",
        models: [
          { id: "TheBloke/CodeLlama-7B-Instruct-GGUF", format: "gguf", sizeGb: 4.1 },
          { id: "TheBloke/deepseek-coder-6.7B-instruct-GGUF", format: "gguf", sizeGb: 3.8 },
        ],
      },
      {
        purpose: "General Chat / Reasoning",
        models: [
          { id: "TheBloke/Mistral-7B-Instruct-v0.2-GGUF", format: "gguf", sizeGb: 4.1 },
          { id: "TheBloke/phi-2-GGUF", format: "gguf", sizeGb: 1.6 },
        ],
      },
      {
        purpose: "Summarization",
        models: [{ id: "TheBloke/SOLAR-10.7B-Instruct-v1.0-GGUF", format: "gguf", sizeGb: 6.1 }],
      },
      {
        purpose: "Embeddings / RAG",
        models: [
          { id: "BAAI/bge-small-en-v1.5", format: "safetensors", sizeGb: 0.13 },
          { id: "nomic-ai/nomic-embed-text-v1.5", format: "safetensors", sizeGb: 0.55 },
        ],
      },
      {
        purpose: "Function Calling / Tool Use",
        models: [{ id: "NousResearch/Hermes-2-Pro-Mistral-7B-GGUF", format: "gguf", sizeGb: 4.1 }],
      },
    ];
  }

  private detectFormats(tags: string[], siblings: Array<{ rfilename?: string }>): string[] {
    const formats = new Set<string>();
    const files = siblings.map((s) => s.rfilename || "");

    if (files.some((f: string) => f.endsWith(".gguf"))) {
      formats.add("gguf");
    }
    if (files.some((f: string) => f.endsWith(".safetensors"))) {
      formats.add("safetensors");
    }
    if (files.some((f: string) => f.endsWith(".bin"))) {
      formats.add("pytorch");
    }
    if (tags.includes("gguf")) {
      formats.add("gguf");
    }

    return Array.from(formats);
  }

  private async apiCall(path: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      throw new Error(`HuggingFace API error ${response.status}: ${path}`);
    }
    return response;
  }
}
