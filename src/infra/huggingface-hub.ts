/**
 * HuggingFace Hub — Enhanced Model Hub Client
 *
 * Search, browse, download, and manage models from HuggingFace Hub.
 * Supports all model formats: GGUF, SafeTensors, PyTorch, ONNX, GPTQ, AWQ.
 * Handles text-generation, speech-to-speech, TTS, STT, and multimodal models.
 */
import { EventEmitter } from "events";

// ── Model Format Types ──────────────────────────────────────────

export type ModelFormat =
  | "gguf" // llama.cpp, Ollama — single quantized file
  | "safetensors" // vLLM, transformers — sharded weights
  | "pytorch" // Legacy .bin format
  | "onnx" // ONNX Runtime
  | "gptq" // GPTQ quantized (AutoGPTQ)
  | "awq" // AWQ quantized
  | "ct2" // CTranslate2
  | "unknown";

export type ModelTask =
  | "text-generation"
  | "text2text-generation"
  | "text-to-speech"
  | "speech-to-speech"
  | "automatic-speech-recognition"
  | "text-to-audio"
  | "audio-to-audio"
  | "voice-conversion"
  | "image-text-to-text" // multimodal (LLaVA, etc.)
  | "feature-extraction" // embeddings
  | "text-classification"
  | "translation"
  | "summarization"
  | "fill-mask"
  | "conversational"
  | "other";

export type InferenceRuntime =
  | "ollama" // GGUF models
  | "llamacpp" // GGUF models
  | "vllm" // SafeTensors, GPTQ, AWQ
  | "transformers" // All formats (Python)
  | "onnxruntime" // ONNX
  | "lmstudio" // GGUF models
  | "tgi" // Text Generation Inference
  | "custom";

// ── Interfaces ──────────────────────────────────────────────────

export interface HuggingFaceConfig {
  token?: string;
  cacheDir: string;
  mirrorUrl?: string;
}

export interface ModelFileInfo {
  filename: string;
  size: number; // bytes
  format: ModelFormat;
  quantization?: string; // e.g. "Q4_K_M", "Q5_K_S", "GPTQ-Int4"
  isSharded?: boolean; // part of a sharded model
  shardIndex?: number;
  totalShards?: number;
}

export interface HfModelInfo {
  id: string; // e.g. "moonshotai/Kimi-K2.5"
  author: string;
  name: string;
  description?: string;
  tags: string[];
  downloads: number;
  likes: number;
  trending?: number;
  createdAt?: string;
  lastModified?: string;
  pipelineTag?: ModelTask;
  libraryName?: string; // e.g. "transformers", "diffusers"
  formats: ModelFormat[];
  files: ModelFileInfo[];
  parameterCount?: string; // e.g. "7B", "70B", "8x7B"
  license?: string;
  gated?: boolean; // requires access request
  private?: boolean;
  modelCard?: string;

  // Computed fields
  totalSizeBytes: number;
  compatibleRuntimes: InferenceRuntime[];
  isVoiceModel: boolean;
  isMultimodal: boolean;
  isMoE: boolean; // Mixture of Experts
}

export interface ModelSearchOptions {
  filter?: string; // HF filter string
  sort?: "downloads" | "likes" | "lastModified" | "trending";
  direction?: "asc" | "desc";
  limit?: number;
  task?: ModelTask;
  library?: string;
  author?: string;
}

export interface DownloadProgress {
  modelId: string;
  filename: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  speed?: number; // bytes/sec
  eta?: number; // seconds remaining
}

export interface DownloadRequest {
  modelId: string;
  files: string[]; // specific files to download (empty = all)
  targetDir?: string; // override cache dir
  resume?: boolean; // resume partial downloads
}

export interface ModelRecommendation {
  modelId: string;
  reason: string;
  score: number; // 0-100 recommendation strength
  category: string;
  format: ModelFormat;
  sizeGb: number;
  parameterCount: string;
  task: ModelTask;
  benchmarks?: Record<string, number>;
  compatibleWith: InferenceRuntime[];
}

// ── Raw API Response Types (internal) ───────────────────────────

/** Raw sibling entry from HuggingFace API */
interface HfApiSibling {
  rfilename?: string;
  filename?: string;
  path?: string;
  size?: number;
}

/** Raw tree entry from HuggingFace API */
interface HfApiTreeEntry {
  type: string;
  rfilename?: string;
  path?: string;
  filename?: string;
  size?: number;
}

/** Raw model response from HuggingFace API */
interface HfApiModelResponse {
  modelId?: string;
  id?: string;
  author?: string;
  description?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  trendingScore?: number;
  createdAt?: string;
  lastModified?: string;
  pipeline_tag?: string;
  library_name?: string;
  license?: string;
  gated?: boolean | string;
  private?: boolean;
  siblings?: HfApiSibling[];
  safetensors?: HfSafetensorsMetadata;
  config?: { model_type?: string };
}

/** Safetensors metadata from HuggingFace API */
interface HfSafetensorsMetadata {
  total?: number;
  [key: string]: unknown;
}

// ── HuggingFace Hub Client ──────────────────────────────────────

export class HuggingFaceHub extends EventEmitter {
  private readonly config: HuggingFaceConfig;
  private readonly baseUrl: string;
  private readonly apiUrl: string;

  constructor(config: HuggingFaceConfig) {
    super();
    this.config = config;
    this.baseUrl = config.mirrorUrl || "https://huggingface.co";
    this.apiUrl = `${this.baseUrl}/api`;
  }

  // ── Search & Browse ─────────────────────────────────────────

  async searchModels(query: string, opts?: ModelSearchOptions): Promise<HfModelInfo[]> {
    const params = new URLSearchParams({
      search: query,
      sort: opts?.sort || "downloads",
      direction: opts?.direction === "asc" ? "1" : "-1",
      limit: String(opts?.limit || 20),
    });

    if (opts?.filter) {
      params.set("filter", opts.filter);
    }
    if (opts?.task) {
      params.set("pipeline_tag", opts.task);
    }
    if (opts?.library) {
      params.set("library", opts.library);
    }
    if (opts?.author) {
      params.set("author", opts.author);
    }

    const response = await this.apiCall(`/models?${params}`);
    const data = (await response.json()) as HfApiModelResponse[];

    return data.map((m) => this.parseModelResponse(m));
  }

  async getModelInfo(modelId: string): Promise<HfModelInfo> {
    const response = await this.apiCall(`/models/${modelId}`);
    const data = (await response.json()) as HfApiModelResponse;
    return this.parseModelResponse(data);
  }

  async getModelTree(modelId: string, path?: string): Promise<ModelFileInfo[]> {
    const treePath = path ? `/${path}` : "";
    const response = await this.apiCall(`/models/${modelId}/tree/main${treePath}`);
    const data = (await response.json()) as HfApiTreeEntry[];

    return data.filter((f) => f.type === "file").map((f) => this.parseFileInfo(f));
  }

  async getTrendingModels(task?: ModelTask, limit?: number): Promise<HfModelInfo[]> {
    return this.searchModels("", {
      sort: "trending",
      direction: "desc",
      limit: limit || 20,
      task,
    });
  }

  // ── Model Download ──────────────────────────────────────────

  async downloadModel(request: DownloadRequest): Promise<string[]> {
    const { modelId, files, targetDir } = request;
    const outputDir = targetDir || `${this.config.cacheDir}/${modelId.replace("/", "_")}`;
    const downloadedPaths: string[] = [];

    // If no specific files requested, get all model files
    let filesToDownload = files;
    if (!filesToDownload.length) {
      const tree = await this.getModelTree(modelId);
      filesToDownload = tree.filter((f) => this.isModelFile(f.filename)).map((f) => f.filename);
    }

    this.emit("downloadStart", {
      modelId,
      totalFiles: filesToDownload.length,
    });

    for (const filename of filesToDownload) {
      const path = await this.downloadFile(modelId, filename, outputDir);
      downloadedPaths.push(path);
    }

    this.emit("downloadAllComplete", {
      modelId,
      paths: downloadedPaths,
      outputDir,
    });

    return downloadedPaths;
  }

  async downloadFile(modelId: string, filename: string, outputDir?: string): Promise<string> {
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
    const dir = outputDir || `${this.config.cacheDir}/${modelId.replace("/", "_")}`;
    const outputPath = `${dir}/${filename}`;

    if (!response.body) {
      throw new Error("No response body for download");
    }

    this.emit("fileDownloadStart", { modelId, filename, totalBytes });

    let bytesDownloaded = 0;
    const startTime = Date.now();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(value);
      bytesDownloaded += value.length;

      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? bytesDownloaded / elapsed : 0;
      const remaining = totalBytes > 0 ? (totalBytes - bytesDownloaded) / speed : 0;

      this.emit("downloadProgress", {
        modelId,
        filename,
        bytesDownloaded,
        totalBytes,
        percent: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
        speed,
        eta: remaining,
      } as DownloadProgress);
    }

    this.emit("fileDownloadComplete", { modelId, filename, outputPath });
    return outputPath;
  }

  // ── Model Recommendations ───────────────────────────────────

  getRecommendedModels(): ModelRecommendation[] {
    return [
      // Text Generation — Local-first models
      {
        modelId: "meta-llama/Llama-3.3-70B-Instruct",
        reason: "Best open-weight general model, excellent reasoning and instruction following",
        score: 95,
        category: "General Chat",
        format: "safetensors",
        sizeGb: 140,
        parameterCount: "70B",
        task: "text-generation",
        compatibleWith: ["vllm", "transformers", "tgi"],
        benchmarks: { MMLU: 86.0, HumanEval: 88.4, GSM8K: 95.1 },
      },
      {
        modelId: "Qwen/Qwen3-32B",
        reason: "Strong multilingual model with excellent coding and math",
        score: 92,
        category: "General Chat",
        format: "safetensors",
        sizeGb: 64,
        parameterCount: "32B",
        task: "text-generation",
        compatibleWith: ["vllm", "transformers", "tgi", "ollama"],
        benchmarks: { MMLU: 83.5, HumanEval: 82.0 },
      },
      {
        modelId: "bartowski/Qwen3-32B-GGUF",
        reason: "Qwen3-32B quantized for local running on consumer hardware",
        score: 90,
        category: "General Chat",
        format: "gguf",
        sizeGb: 20,
        parameterCount: "32B",
        task: "text-generation",
        compatibleWith: ["ollama", "llamacpp", "lmstudio"],
      },
      {
        modelId: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        reason: "Excellent small model for local inference, fast on CPU",
        score: 88,
        category: "General Chat",
        format: "gguf",
        sizeGb: 4.9,
        parameterCount: "8B",
        task: "text-generation",
        compatibleWith: ["ollama", "llamacpp", "lmstudio"],
        benchmarks: { MMLU: 73.0, HumanEval: 72.6 },
      },
      {
        modelId: "microsoft/phi-4",
        reason: "Small but powerful, runs on modest hardware with strong reasoning",
        score: 86,
        category: "General Chat",
        format: "safetensors",
        sizeGb: 7.6,
        parameterCount: "3.8B",
        task: "text-generation",
        compatibleWith: ["vllm", "transformers", "ollama"],
      },
      // Code Generation
      {
        modelId: "Qwen/Qwen2.5-Coder-32B-Instruct",
        reason: "Best open-source coding model, competitive with GPT-4",
        score: 95,
        category: "Code Generation",
        format: "safetensors",
        sizeGb: 64,
        parameterCount: "32B",
        task: "text-generation",
        compatibleWith: ["vllm", "transformers", "tgi"],
        benchmarks: { HumanEval: 92.7, MBPP: 90.2 },
      },
      {
        modelId: "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF",
        reason: "Excellent coding model that runs fast on local hardware",
        score: 87,
        category: "Code Generation",
        format: "gguf",
        sizeGb: 4.4,
        parameterCount: "7B",
        task: "text-generation",
        compatibleWith: ["ollama", "llamacpp", "lmstudio"],
      },
      // MoE Models
      {
        modelId: "moonshotai/Kimi-K2.5",
        reason: "State-of-the-art MoE model, needs vLLM or transformers for SafeTensors",
        score: 94,
        category: "Frontier MoE",
        format: "safetensors",
        sizeGb: 400,
        parameterCount: "MoE",
        task: "text-generation",
        compatibleWith: ["vllm", "transformers"],
        benchmarks: { MMLU: 88.0, MATH: 82.0 },
      },
      {
        modelId: "mistralai/Mixtral-8x22B-Instruct-v0.1",
        reason: "Production-grade MoE, efficient inference with sparse activation",
        score: 88,
        category: "Frontier MoE",
        format: "safetensors",
        sizeGb: 264,
        parameterCount: "8x22B",
        task: "text-generation",
        compatibleWith: ["vllm", "transformers", "tgi"],
      },
      // Voice & Audio
      {
        modelId: "nvidia/personaplex-7b-v1",
        reason: "Voice-to-voice model with personality synthesis, real-time capable",
        score: 92,
        category: "Voice",
        format: "safetensors",
        sizeGb: 14,
        parameterCount: "7B",
        task: "speech-to-speech",
        compatibleWith: ["transformers", "custom"],
      },
      {
        modelId: "parler-tts/parler-tts-large-v1",
        reason: "High-quality TTS with voice description control",
        score: 85,
        category: "Voice",
        format: "safetensors",
        sizeGb: 4.3,
        parameterCount: "2.3B",
        task: "text-to-speech",
        compatibleWith: ["transformers"],
      },
      {
        modelId: "openai/whisper-large-v3-turbo",
        reason: "Best open-source STT, supports 100+ languages",
        score: 93,
        category: "Voice",
        format: "safetensors",
        sizeGb: 3.1,
        parameterCount: "809M",
        task: "automatic-speech-recognition",
        compatibleWith: ["transformers", "onnxruntime"],
      },
      {
        modelId: "fishaudio/fish-speech-1.5",
        reason: "Ultra-fast TTS with voice cloning from 10s reference audio",
        score: 87,
        category: "Voice",
        format: "safetensors",
        sizeGb: 2.1,
        parameterCount: "500M",
        task: "text-to-speech",
        compatibleWith: ["transformers", "custom"],
      },
      // Multimodal
      {
        modelId: "llava-hf/llama3-llava-next-8b-hf",
        reason: "Strong vision-language model, understand images + text",
        score: 85,
        category: "Multimodal",
        format: "safetensors",
        sizeGb: 16,
        parameterCount: "8B",
        task: "image-text-to-text",
        compatibleWith: ["vllm", "transformers", "ollama"],
      },
      // Embeddings
      {
        modelId: "BAAI/bge-m3",
        reason: "Best multilingual embedding model, 8K context, dense+sparse+colbert",
        score: 94,
        category: "Embeddings",
        format: "safetensors",
        sizeGb: 2.2,
        parameterCount: "568M",
        task: "feature-extraction",
        compatibleWith: ["transformers", "onnxruntime"],
      },
      {
        modelId: "nomic-ai/nomic-embed-text-v1.5",
        reason: "Long context embeddings (8K), great for RAG",
        score: 88,
        category: "Embeddings",
        format: "safetensors",
        sizeGb: 0.55,
        parameterCount: "137M",
        task: "feature-extraction",
        compatibleWith: ["transformers", "onnxruntime", "ollama"],
      },
    ];
  }

  /**
   * Get better model suggestions for a given task and constraints.
   * Returns models scored by quality that fit within resource limits.
   */
  suggestBetterModels(opts: {
    currentModelId?: string;
    task: ModelTask;
    maxSizeGb: number;
    preferredFormat?: ModelFormat;
    preferredRuntimes?: InferenceRuntime[];
  }): ModelRecommendation[] {
    const all = this.getRecommendedModels();

    return all
      .filter((r) => {
        // Must match task
        if (r.task !== opts.task && opts.task !== "other") {
          return false;
        }
        // Must fit in resource budget
        if (r.sizeGb > opts.maxSizeGb) {
          return false;
        }
        // Exclude current model
        if (opts.currentModelId && r.modelId === opts.currentModelId) {
          return false;
        }
        // Format preference
        if (opts.preferredFormat && r.format !== opts.preferredFormat) {
          return false;
        }
        // Runtime compatibility
        if (opts.preferredRuntimes?.length) {
          if (!r.compatibleWith.some((rt) => opts.preferredRuntimes!.includes(rt))) {
            return false;
          }
        }
        return true;
      })
      .toSorted((a, b) => b.score - a.score);
  }

  // ── Format & Runtime Detection ──────────────────────────────

  detectFormats(tags: string[], siblings: HfApiSibling[]): ModelFormat[] {
    const formats = new Set<ModelFormat>();
    const files = siblings.map((s) => (s.rfilename || s.filename || "").toLowerCase());

    if (files.some((f: string) => f.endsWith(".gguf"))) {
      formats.add("gguf");
    }
    if (files.some((f: string) => f.endsWith(".safetensors"))) {
      formats.add("safetensors");
    }
    if (files.some((f: string) => f.endsWith(".bin") && !f.includes("tokenizer"))) {
      formats.add("pytorch");
    }
    if (files.some((f: string) => f.endsWith(".onnx"))) {
      formats.add("onnx");
    }
    if (tags.includes("gguf")) {
      formats.add("gguf");
    }
    if (tags.includes("gptq")) {
      formats.add("gptq");
    }
    if (tags.includes("awq")) {
      formats.add("awq");
    }

    return Array.from(formats);
  }

  getCompatibleRuntimes(formats: ModelFormat[]): InferenceRuntime[] {
    const runtimes = new Set<InferenceRuntime>();

    for (const format of formats) {
      switch (format) {
        case "gguf":
          runtimes.add("ollama");
          runtimes.add("llamacpp");
          runtimes.add("lmstudio");
          break;
        case "safetensors":
          runtimes.add("vllm");
          runtimes.add("transformers");
          runtimes.add("tgi");
          break;
        case "pytorch":
          runtimes.add("transformers");
          break;
        case "onnx":
          runtimes.add("onnxruntime");
          break;
        case "gptq":
        case "awq":
          runtimes.add("vllm");
          runtimes.add("transformers");
          break;
      }
    }

    return Array.from(runtimes);
  }

  // ── Internal Helpers ────────────────────────────────────────

  private parseModelResponse(data: HfApiModelResponse): HfModelInfo {
    const id = data.modelId || data.id || "";
    const siblings: HfApiSibling[] = data.siblings || [];
    const tags: string[] = data.tags || [];
    const formats = this.detectFormats(tags, siblings);
    const files = siblings.map((s) => this.parseFileInfo(s));
    const pipelineTag = (data.pipeline_tag || "other") as ModelTask;

    const isVoiceModel = [
      "text-to-speech",
      "speech-to-speech",
      "automatic-speech-recognition",
      "text-to-audio",
      "audio-to-audio",
      "voice-conversion",
    ].includes(pipelineTag);

    const isMultimodal =
      pipelineTag === "image-text-to-text" ||
      tags.includes("multimodal") ||
      tags.includes("vision");

    const isMoE =
      tags.includes("moe") ||
      id.toLowerCase().includes("mixtral") ||
      id.toLowerCase().includes("8x") ||
      (data.config?.model_type || "").toLowerCase().includes("mixtral");

    const parameterCount = this.extractParamCount(id, tags, data.safetensors);

    return {
      id,
      author: data.author || id.split("/")[0] || "unknown",
      name: id.split("/")[1] || id,
      description: data.description || "",
      tags,
      downloads: data.downloads || 0,
      likes: data.likes || 0,
      trending: data.trendingScore,
      createdAt: data.createdAt,
      lastModified: data.lastModified,
      pipelineTag,
      libraryName: data.library_name,
      formats,
      files,
      parameterCount,
      license: data.license || this.extractLicense(tags),
      gated: data.gated === true || data.gated === "auto",
      private: data.private || false,
      totalSizeBytes: files.reduce((sum: number, f: ModelFileInfo) => sum + (f.size || 0), 0),
      compatibleRuntimes: this.getCompatibleRuntimes(formats),
      isVoiceModel,
      isMultimodal,
      isMoE,
    };
  }

  private parseFileInfo(fileData: HfApiSibling | HfApiTreeEntry): ModelFileInfo {
    const filename = fileData.rfilename || fileData.path || fileData.filename || "";
    const size = fileData.size || 0;
    const format = this.detectFileFormat(filename);
    const quantization = this.extractQuantization(filename);
    const shardInfo = this.extractShardInfo(filename);

    return {
      filename,
      size,
      format,
      quantization,
      ...shardInfo,
    };
  }

  private detectFileFormat(filename: string): ModelFormat {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".gguf")) {
      return "gguf";
    }
    if (lower.endsWith(".safetensors")) {
      return "safetensors";
    }
    if (lower.endsWith(".onnx")) {
      return "onnx";
    }
    if (lower.endsWith(".bin") && !lower.includes("tokenizer")) {
      return "pytorch";
    }
    return "unknown";
  }

  private extractQuantization(filename: string): string | undefined {
    // GGUF quantization patterns
    const ggufMatch = filename.match(/[-.](Q\d[_A-Z0-9]+|F16|F32|IQ\d[_A-Z0-9]*)/i);
    if (ggufMatch) {
      return ggufMatch[1].toUpperCase();
    }

    // GPTQ patterns
    if (filename.toLowerCase().includes("gptq")) {
      return "GPTQ";
    }
    if (filename.toLowerCase().includes("awq")) {
      return "AWQ";
    }

    return undefined;
  }

  private extractShardInfo(filename: string): {
    isSharded?: boolean;
    shardIndex?: number;
    totalShards?: number;
  } {
    // Pattern: model-00001-of-00003.safetensors
    const match = filename.match(/(\d{5})-of-(\d{5})/);
    if (match) {
      return {
        isSharded: true,
        shardIndex: parseInt(match[1], 10),
        totalShards: parseInt(match[2], 10),
      };
    }
    return {};
  }

  private extractParamCount(
    id: string,
    tags: string[],
    safetensors?: HfSafetensorsMetadata,
  ): string {
    // Try safetensors metadata first
    if (safetensors?.total) {
      const total = safetensors.total;
      if (total >= 1e12) {
        return `${(total / 1e12).toFixed(1)}T`;
      }
      if (total >= 1e9) {
        return `${(total / 1e9).toFixed(1)}B`;
      }
      if (total >= 1e6) {
        return `${(total / 1e6).toFixed(0)}M`;
      }
    }

    // Try parsing from model ID
    const paramMatch = id.match(/(\d+(?:\.\d+)?)[xX]?(\d+)?[bB]/);
    if (paramMatch) {
      if (paramMatch[2]) {
        return `${paramMatch[1]}x${paramMatch[2]}B`;
      } // MoE
      return `${paramMatch[1]}B`;
    }

    // Check tags
    for (const tag of tags) {
      if (tag.match(/^\d+[bBmM]$/)) {
        return tag.toUpperCase();
      }
    }

    return "unknown";
  }

  private extractLicense(tags: string[]): string | undefined {
    const licenseTag = tags.find((t) =>
      ["mit", "apache-2.0", "cc-by-4.0", "cc-by-nc-4.0", "llama3", "llama3.1", "gemma"].some((l) =>
        t.toLowerCase().includes(l),
      ),
    );
    return licenseTag;
  }

  private isModelFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return (
      lower.endsWith(".gguf") ||
      lower.endsWith(".safetensors") ||
      lower.endsWith(".onnx") ||
      (lower.endsWith(".bin") && !lower.includes("tokenizer"))
    );
  }

  private async apiCall(path: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const response = await fetch(`${this.apiUrl}${path}`, { headers });
    if (!response.ok) {
      throw new Error(`HuggingFace API error ${response.status}: ${path}`);
    }
    return response;
  }
}
