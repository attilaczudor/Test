import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Types ────────────────────────────────────────────────────────────────────

export type ModelFormat = "gguf" | "safetensors" | "pytorch" | "onnx" | "gptq" | "awq" | "unknown";

export type ModelTask =
  | "text-generation"
  | "text-to-speech"
  | "speech-to-speech"
  | "automatic-speech-recognition"
  | "image-text-to-text"
  | "feature-extraction"
  | "other";

export type InferenceRuntime =
  | "ollama"
  | "llamacpp"
  | "vllm"
  | "transformers"
  | "onnxruntime"
  | "lmstudio"
  | "tgi"
  | "custom";

export type ModelStatus =
  | "available"
  | "downloading"
  | "stored"
  | "loading"
  | "loaded"
  | "active"
  | "error";

export type StorageLocation = "smb" | "nvme" | "cache";

export type ModelCategory =
  | "all"
  | "chat"
  | "code"
  | "voice"
  | "multimodal"
  | "embeddings"
  | "moe"
  | "local"
  | "recommended";

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface LocalModel {
  id: string;
  modelId: string;
  name: string;
  filename: string;
  format: ModelFormat;
  quantization?: string;
  task: ModelTask;
  parameterCount: number;
  status: ModelStatus;
  location: StorageLocation;
  path?: string;
  sizeBytes: number;
  downloadProgress?: number;
  downloadSpeed?: number;
  downloadedAt?: string;
  loadedAt?: string;
  lastUsed?: string;
  assignedTo?: string;
  compatibleRuntimes: InferenceRuntime[];
  isVoiceModel: boolean;
  isMultimodal: boolean;
  isMoE: boolean;
}

export interface ModelRecommendation {
  modelId: string;
  reason: string;
  score: number;
  category: ModelCategory;
  format: ModelFormat;
  sizeGb: number;
  parameterCount: number;
  task: ModelTask;
  benchmarks?: Record<string, number>;
  compatibleWith: InferenceRuntime[];
  approved: boolean;
  dismissed: boolean;
}

// ── State ────────────────────────────────────────────────────────────────────

interface ModelsState {
  searchQuery: string;
  searchResults: ModelRecommendation[];
  searching: boolean;
  selectedCategory: ModelCategory;
  localModels: LocalModel[];
  recommendations: ModelRecommendation[];
  pendingApprovals: ModelRecommendation[];
  downloadQueue: string[];
  loading: boolean;
  error: string | null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

interface ModelsActions {
  setSearchQuery: (query: string) => void;
  searchModels: (query?: string) => void;
  setSelectedCategory: (category: ModelCategory) => void;
  downloadModel: (modelId: string) => Promise<void>;
  cancelDownload: (modelId: string) => void;
  updateDownloadProgress: (modelId: string, progress: number, speed?: number) => void;
  markDownloaded: (modelId: string) => void;
  loadToNvme: (modelId: string) => Promise<void>;
  unloadFromNvme: (modelId: string) => void;
  approveRecommendation: (modelId: string) => void;
  dismissRecommendation: (modelId: string) => void;
  removeModel: (modelId: string) => void;
  refreshLocalModels: () => Promise<void>;
}

// ── Curated Recommendations ──────────────────────────────────────────────────

const CURATED_RECOMMENDATIONS: ModelRecommendation[] = [
  // General Chat
  {
    modelId: "bartowski/Qwen3-32B-GGUF",
    reason:
      "Top-tier 32B chat model with excellent reasoning and multilingual support in efficient GGUF format",
    score: 95,
    category: "chat",
    format: "gguf",
    sizeGb: 22,
    parameterCount: 32_000_000_000,
    task: "text-generation",
    compatibleWith: ["ollama", "llamacpp", "lmstudio"],
    approved: false,
    dismissed: false,
  },
  {
    modelId: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
    reason:
      "Highly capable 8B instruction-tuned model, ideal for fast local inference with low resource usage",
    score: 90,
    category: "chat",
    format: "gguf",
    sizeGb: 5.5,
    parameterCount: 8_000_000_000,
    task: "text-generation",
    compatibleWith: ["ollama", "llamacpp", "lmstudio"],
    approved: false,
    dismissed: false,
  },
  {
    modelId: "meta-llama/Llama-3.3-70B-Instruct",
    reason:
      "Frontier-class 70B model with state-of-the-art instruction following and reasoning capabilities",
    score: 96,
    category: "chat",
    format: "safetensors",
    sizeGb: 140,
    parameterCount: 70_000_000_000,
    task: "text-generation",
    compatibleWith: ["vllm", "transformers", "tgi"],
    approved: false,
    dismissed: false,
  },

  // Code
  {
    modelId: "Qwen/Qwen2.5-Coder-32B-Instruct",
    reason: "Best-in-class open code model rivaling GPT-4 on coding benchmarks with 32B parameters",
    score: 95,
    category: "code",
    format: "safetensors",
    sizeGb: 65,
    parameterCount: 32_000_000_000,
    task: "text-generation",
    compatibleWith: ["vllm", "transformers", "tgi"],
    approved: false,
    dismissed: false,
  },
  {
    modelId: "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF",
    reason:
      "Compact yet powerful code assistant in GGUF format, great for real-time code completion",
    score: 88,
    category: "code",
    format: "gguf",
    sizeGb: 4.8,
    parameterCount: 7_000_000_000,
    task: "text-generation",
    compatibleWith: ["ollama", "llamacpp", "lmstudio"],
    approved: false,
    dismissed: false,
  },

  // MoE
  {
    modelId: "moonshotai/Kimi-K2.5",
    reason:
      "High-performance Mixture-of-Experts model with efficient routing and broad task coverage",
    score: 94,
    category: "moe",
    format: "safetensors",
    sizeGb: 180,
    parameterCount: 120_000_000_000,
    task: "text-generation",
    compatibleWith: ["vllm", "transformers", "tgi"],
    approved: false,
    dismissed: false,
  },

  // Voice
  {
    modelId: "nvidia/personaplex-7b-v1",
    reason:
      "Real-time speech-to-speech model with persona control for natural conversational voice AI",
    score: 92,
    category: "voice",
    format: "safetensors",
    sizeGb: 14,
    parameterCount: 7_000_000_000,
    task: "speech-to-speech",
    compatibleWith: ["transformers", "custom"],
    approved: false,
    dismissed: false,
  },
  {
    modelId: "openai/whisper-large-v3-turbo",
    reason:
      "Industry-leading automatic speech recognition with multilingual support and fast inference",
    score: 93,
    category: "voice",
    format: "safetensors",
    sizeGb: 3.1,
    parameterCount: 1_550_000_000,
    task: "automatic-speech-recognition",
    compatibleWith: ["transformers", "onnxruntime", "custom"],
    approved: false,
    dismissed: false,
  },
  {
    modelId: "fishaudio/fish-speech-1.5",
    reason: "High-quality text-to-speech with natural prosody and voice cloning capabilities",
    score: 87,
    category: "voice",
    format: "safetensors",
    sizeGb: 2.4,
    parameterCount: 800_000_000,
    task: "text-to-speech",
    compatibleWith: ["transformers", "custom"],
    approved: false,
    dismissed: false,
  },

  // Multimodal
  {
    modelId: "llava-hf/llama3-llava-next-8b-hf",
    reason:
      "Strong vision-language model combining LLaMA 3 backbone with advanced image understanding",
    score: 85,
    category: "multimodal",
    format: "safetensors",
    sizeGb: 16,
    parameterCount: 8_000_000_000,
    task: "image-text-to-text",
    compatibleWith: ["transformers", "vllm"],
    approved: false,
    dismissed: false,
  },

  // Embeddings
  {
    modelId: "BAAI/bge-m3",
    reason:
      "State-of-the-art multilingual embedding model with dense, sparse, and multi-vector retrieval",
    score: 94,
    category: "embeddings",
    format: "safetensors",
    sizeGb: 2.2,
    parameterCount: 567_000_000,
    task: "feature-extraction",
    compatibleWith: ["transformers", "onnxruntime"],
    approved: false,
    dismissed: false,
  },
  {
    modelId: "nomic-ai/nomic-embed-text-v1.5",
    reason:
      "Efficient text embedding model with long-context support and excellent retrieval performance",
    score: 88,
    category: "embeddings",
    format: "safetensors",
    sizeGb: 0.5,
    parameterCount: 137_000_000,
    task: "feature-extraction",
    compatibleWith: ["transformers", "onnxruntime", "ollama"],
    approved: false,
    dismissed: false,
  },
];

// ── Store ────────────────────────────────────────────────────────────────────

export const useModelsStore = create<ModelsState & ModelsActions>()(
  persist(
    (set, get) => ({
      // ── State defaults ───────────────────────────────────────────────────
      searchQuery: "",
      searchResults: [],
      searching: false,
      selectedCategory: "all",
      localModels: [],
      recommendations: CURATED_RECOMMENDATIONS.map((r) => ({ ...r })),
      pendingApprovals: [],
      downloadQueue: [],
      loading: false,
      error: null,

      // ── Actions ──────────────────────────────────────────────────────────

      setSearchQuery: (query) => set({ searchQuery: query }),

      searchModels: (query) => {
        const state = get();
        const searchTerm = (query ?? state.searchQuery).toLowerCase().trim();

        set({ searching: true });

        const results = state.recommendations.filter((rec) => {
          if (rec.dismissed) {
            return false;
          }

          // Category filter
          if (
            state.selectedCategory !== "all" &&
            state.selectedCategory !== "recommended" &&
            rec.category !== state.selectedCategory
          ) {
            return false;
          }

          // Text filter
          if (searchTerm) {
            return (
              rec.modelId.toLowerCase().includes(searchTerm) ||
              rec.reason.toLowerCase().includes(searchTerm) ||
              rec.category.toLowerCase().includes(searchTerm) ||
              rec.task.toLowerCase().includes(searchTerm)
            );
          }

          return true;
        });

        set({ searchResults: results, searching: false });
      },

      setSelectedCategory: (category) => {
        set({ selectedCategory: category });
        // Re-run search with the new category applied
        get().searchModels();
      },

      downloadModel: async (modelId) => {
        const { downloadQueue, localModels } = get();

        // Prevent duplicate downloads
        if (downloadQueue.includes(modelId)) {
          return;
        }

        // Find recommendation metadata to seed the local model entry
        const rec = get().recommendations.find((r) => r.modelId === modelId);

        const newModel: LocalModel = {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          modelId,
          name: modelId.split("/").pop() ?? modelId,
          filename: "",
          format: rec?.format ?? "unknown",
          task: rec?.task ?? "other",
          parameterCount: rec?.parameterCount ?? 0,
          status: "downloading",
          location: "smb", // Target SMB as permanent store; falls back to cache
          sizeBytes: (rec?.sizeGb ?? 0) * 1_073_741_824,
          downloadProgress: 0,
          compatibleRuntimes: rec?.compatibleWith ?? [],
          isVoiceModel:
            rec?.task === "text-to-speech" ||
            rec?.task === "speech-to-speech" ||
            rec?.task === "automatic-speech-recognition",
          isMultimodal: rec?.task === "image-text-to-text",
          isMoE: rec?.category === "moe",
        };

        set({
          downloadQueue: [...downloadQueue, modelId],
          localModels: [...localModels, newModel],
          error: null,
        });

        // In a real implementation this would call an IPC/backend endpoint
        // that invokes `huggingface-cli download` targeting the SMB mount.
        // If SMB is not connected, falls back to a local cache directory.
      },

      cancelDownload: (modelId) => {
        set((state) => ({
          downloadQueue: state.downloadQueue.filter((id) => id !== modelId),
          localModels: state.localModels.filter(
            (m) => !(m.modelId === modelId && m.status === "downloading"),
          ),
        }));
      },

      updateDownloadProgress: (modelId, progress, speed) => {
        set((state) => ({
          localModels: state.localModels.map((m) =>
            m.modelId === modelId && m.status === "downloading"
              ? {
                  ...m,
                  downloadProgress: progress,
                  ...(speed !== undefined ? { downloadSpeed: speed } : {}),
                }
              : m,
          ),
        }));
      },

      markDownloaded: (modelId) => {
        set((state) => ({
          downloadQueue: state.downloadQueue.filter((id) => id !== modelId),
          localModels: state.localModels.map((m) =>
            m.modelId === modelId && m.status === "downloading"
              ? {
                  ...m,
                  status: "stored" as ModelStatus,
                  downloadProgress: 100,
                  downloadSpeed: undefined,
                  downloadedAt: new Date().toISOString(),
                  location: "smb" as StorageLocation,
                }
              : m,
          ),
        }));
      },

      loadToNvme: async (modelId) => {
        // NVMe is the fast runtime cache -- models are copied from SMB for
        // active inference and returned when unloaded.
        set((state) => ({
          localModels: state.localModels.map((m) =>
            m.modelId === modelId && m.status === "stored"
              ? { ...m, status: "loading" as ModelStatus }
              : m,
          ),
        }));

        // In a real implementation this would copy the model file from the
        // SMB mount to the NVMe path, then mark it as loaded.
        set((state) => ({
          localModels: state.localModels.map((m) =>
            m.modelId === modelId && m.status === "loading"
              ? {
                  ...m,
                  status: "loaded" as ModelStatus,
                  location: "nvme" as StorageLocation,
                  loadedAt: new Date().toISOString(),
                }
              : m,
          ),
        }));
      },

      unloadFromNvme: (modelId) => {
        // Returns the model back to SMB -- removes from NVMe cache.
        set((state) => ({
          localModels: state.localModels.map((m) =>
            m.modelId === modelId && (m.status === "loaded" || m.status === "active")
              ? {
                  ...m,
                  status: "stored" as ModelStatus,
                  location: "smb" as StorageLocation,
                  loadedAt: undefined,
                }
              : m,
          ),
        }));
      },

      approveRecommendation: (modelId) => {
        set((state) => ({
          recommendations: state.recommendations.map((r) =>
            r.modelId === modelId ? { ...r, approved: true } : r,
          ),
          pendingApprovals: state.pendingApprovals.filter((r) => r.modelId !== modelId),
        }));
      },

      dismissRecommendation: (modelId) => {
        set((state) => ({
          recommendations: state.recommendations.map((r) =>
            r.modelId === modelId ? { ...r, dismissed: true } : r,
          ),
          pendingApprovals: state.pendingApprovals.filter((r) => r.modelId !== modelId),
        }));
      },

      removeModel: (modelId) => {
        set((state) => ({
          localModels: state.localModels.filter((m) => m.modelId !== modelId),
          downloadQueue: state.downloadQueue.filter((id) => id !== modelId),
        }));
      },

      refreshLocalModels: async () => {
        set({ loading: true, error: null });

        // In a real implementation this would scan the SMB mount and NVMe
        // path for model files, parse metadata, and reconcile with the
        // existing localModels array.
        set({ loading: false });
      },
    }),
    {
      name: "atticlaw-models",
      partialize: (state) => ({
        localModels: state.localModels,
        recommendations: state.recommendations,
      }),
    },
  ),
);
