/**
 * Tests for HuggingFace Hub Enhanced Client
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HuggingFaceHub } from "./huggingface-hub.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createHub(token?: string) {
  return new HuggingFaceHub({
    cacheDir: "/tmp/test-hf-cache",
    token,
  });
}

describe("HuggingFaceHub", () => {
  let hub: HuggingFaceHub;

  beforeEach(() => {
    mockFetch.mockReset();
    hub = createHub();
  });

  // ── Search & Browse ─────────────────────────────────────────

  describe("searchModels", () => {
    it("should search models and return parsed results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            modelId: "meta-llama/Llama-3.3-70B-Instruct",
            author: "meta-llama",
            tags: ["text-generation", "pytorch", "safetensors"],
            downloads: 500000,
            likes: 12000,
            pipeline_tag: "text-generation",
            siblings: [
              { rfilename: "model-00001-of-00030.safetensors", size: 5000000000 },
              { rfilename: "model-00002-of-00030.safetensors", size: 5000000000 },
              { rfilename: "config.json", size: 1024 },
              { rfilename: "tokenizer.json", size: 50000 },
            ],
          },
        ],
      });

      const results = await hub.searchModels("llama 70b");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("meta-llama/Llama-3.3-70B-Instruct");
      expect(results[0].author).toBe("meta-llama");
      expect(results[0].formats).toContain("safetensors");
      expect(results[0].pipelineTag).toBe("text-generation");
      expect(results[0].downloads).toBe(500000);
    });

    it("should pass search parameters correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await hub.searchModels("whisper", {
        task: "automatic-speech-recognition",
        sort: "likes",
        limit: 5,
      });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("search=whisper");
      expect(callUrl).toContain("pipeline_tag=automatic-speech-recognition");
      expect(callUrl).toContain("sort=likes");
      expect(callUrl).toContain("limit=5");
    });

    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(hub.searchModels("test")).rejects.toThrow("HuggingFace API error 500");
    });
  });

  describe("getModelInfo", () => {
    it("should get detailed model info", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          modelId: "nvidia/personaplex-7b-v1",
          author: "nvidia",
          tags: ["speech-to-speech", "safetensors"],
          downloads: 10000,
          likes: 500,
          pipeline_tag: "speech-to-speech",
          library_name: "transformers",
          siblings: [
            { rfilename: "model.safetensors", size: 14000000000 },
            { rfilename: "config.json", size: 512 },
          ],
          gated: false,
          private: false,
          safetensors: { total: 7000000000 },
        }),
      });

      const info = await hub.getModelInfo("nvidia/personaplex-7b-v1");
      expect(info.id).toBe("nvidia/personaplex-7b-v1");
      expect(info.isVoiceModel).toBe(true);
      expect(info.formats).toContain("safetensors");
      expect(info.compatibleRuntimes).toContain("vllm");
      expect(info.compatibleRuntimes).toContain("transformers");
      expect(info.pipelineTag).toBe("speech-to-speech");
      expect(info.parameterCount).toBe("7.0B");
    });

    it("should detect MoE models", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          modelId: "moonshotai/Kimi-K2.5",
          author: "moonshotai",
          tags: ["text-generation", "safetensors", "moe"],
          downloads: 50000,
          likes: 2000,
          pipeline_tag: "text-generation",
          siblings: [{ rfilename: "model-00001-of-00100.safetensors", size: 4000000000 }],
          safetensors: { total: 400000000000 },
        }),
      });

      const info = await hub.getModelInfo("moonshotai/Kimi-K2.5");
      expect(info.isMoE).toBe(true);
      expect(info.formats).toContain("safetensors");
    });

    it("should detect multimodal models", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          modelId: "llava-hf/llama3-llava-next-8b-hf",
          author: "llava-hf",
          tags: ["image-text-to-text", "safetensors", "multimodal"],
          downloads: 30000,
          likes: 800,
          pipeline_tag: "image-text-to-text",
          siblings: [{ rfilename: "model.safetensors", size: 16000000000 }],
        }),
      });

      const info = await hub.getModelInfo("llava-hf/llama3-llava-next-8b-hf");
      expect(info.isMultimodal).toBe(true);
      expect(info.pipelineTag).toBe("image-text-to-text");
    });
  });

  // ── Format Detection ────────────────────────────────────────

  describe("detectFormats", () => {
    it("should detect GGUF format from file extensions", () => {
      const formats = hub.detectFormats(
        [],
        [{ rfilename: "model-Q4_K_M.gguf" }, { rfilename: "config.json" }],
      );
      expect(formats).toContain("gguf");
    });

    it("should detect SafeTensors format", () => {
      const formats = hub.detectFormats(
        [],
        [
          { rfilename: "model-00001-of-00003.safetensors" },
          { rfilename: "model-00002-of-00003.safetensors" },
        ],
      );
      expect(formats).toContain("safetensors");
    });

    it("should detect PyTorch format from .bin files", () => {
      const formats = hub.detectFormats([], [{ rfilename: "pytorch_model.bin" }]);
      expect(formats).toContain("pytorch");
    });

    it("should detect ONNX format", () => {
      const formats = hub.detectFormats([], [{ rfilename: "model.onnx" }]);
      expect(formats).toContain("onnx");
    });

    it("should detect GPTQ from tags", () => {
      const formats = hub.detectFormats(["gptq"], []);
      expect(formats).toContain("gptq");
    });

    it("should detect AWQ from tags", () => {
      const formats = hub.detectFormats(["awq"], []);
      expect(formats).toContain("awq");
    });

    it("should detect multiple formats", () => {
      const formats = hub.detectFormats(
        ["gguf"],
        [{ rfilename: "model.gguf" }, { rfilename: "model.safetensors" }],
      );
      expect(formats).toContain("gguf");
      expect(formats).toContain("safetensors");
    });

    it("should not count tokenizer.bin as pytorch", () => {
      const formats = hub.detectFormats([], [{ rfilename: "tokenizer.bin" }]);
      expect(formats).not.toContain("pytorch");
    });
  });

  // ── Runtime Compatibility ───────────────────────────────────

  describe("getCompatibleRuntimes", () => {
    it("should return ollama/llamacpp/lmstudio for GGUF", () => {
      const runtimes = hub.getCompatibleRuntimes(["gguf"]);
      expect(runtimes).toContain("ollama");
      expect(runtimes).toContain("llamacpp");
      expect(runtimes).toContain("lmstudio");
    });

    it("should return vllm/transformers/tgi for SafeTensors", () => {
      const runtimes = hub.getCompatibleRuntimes(["safetensors"]);
      expect(runtimes).toContain("vllm");
      expect(runtimes).toContain("transformers");
      expect(runtimes).toContain("tgi");
    });

    it("should return onnxruntime for ONNX", () => {
      const runtimes = hub.getCompatibleRuntimes(["onnx"]);
      expect(runtimes).toContain("onnxruntime");
    });

    it("should return vllm/transformers for GPTQ/AWQ", () => {
      const runtimes = hub.getCompatibleRuntimes(["gptq"]);
      expect(runtimes).toContain("vllm");
      expect(runtimes).toContain("transformers");
    });

    it("should combine runtimes for multiple formats", () => {
      const runtimes = hub.getCompatibleRuntimes(["gguf", "safetensors"]);
      expect(runtimes).toContain("ollama");
      expect(runtimes).toContain("vllm");
      expect(runtimes).toContain("transformers");
    });
  });

  // ── Model Recommendations ───────────────────────────────────

  describe("getRecommendedModels", () => {
    it("should return curated recommendations", () => {
      const recs = hub.getRecommendedModels();
      expect(recs.length).toBeGreaterThan(10);
    });

    it("should include voice models", () => {
      const recs = hub.getRecommendedModels();
      const voice = recs.filter((r) =>
        ["speech-to-speech", "text-to-speech", "automatic-speech-recognition"].includes(r.task),
      );
      expect(voice.length).toBeGreaterThanOrEqual(3);
    });

    it("should include personaplex voice model", () => {
      const recs = hub.getRecommendedModels();
      const personaplex = recs.find((r) => r.modelId.includes("personaplex"));
      expect(personaplex).toBeDefined();
      expect(personaplex!.task).toBe("speech-to-speech");
    });

    it("should include MoE models", () => {
      const recs = hub.getRecommendedModels();
      const kimi = recs.find((r) => r.modelId.includes("Kimi"));
      expect(kimi).toBeDefined();
    });

    it("should include embedding models", () => {
      const recs = hub.getRecommendedModels();
      const embeddings = recs.filter((r) => r.task === "feature-extraction");
      expect(embeddings.length).toBeGreaterThanOrEqual(2);
    });

    it("should have valid scores between 0-100", () => {
      const recs = hub.getRecommendedModels();
      for (const rec of recs) {
        expect(rec.score).toBeGreaterThanOrEqual(0);
        expect(rec.score).toBeLessThanOrEqual(100);
      }
    });

    it("should have compatible runtimes for each recommendation", () => {
      const recs = hub.getRecommendedModels();
      for (const rec of recs) {
        expect(rec.compatibleWith.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Better Model Suggestions ────────────────────────────────

  describe("suggestBetterModels", () => {
    it("should suggest models for a given task within size budget", () => {
      const suggestions = hub.suggestBetterModels({
        task: "text-generation",
        maxSizeGb: 50,
      });

      expect(suggestions.length).toBeGreaterThan(0);
      for (const s of suggestions) {
        expect(s.sizeGb).toBeLessThanOrEqual(50);
        expect(s.task).toBe("text-generation");
      }
    });

    it("should exclude current model from suggestions", () => {
      const suggestions = hub.suggestBetterModels({
        currentModelId: "bartowski/Qwen3-32B-GGUF",
        task: "text-generation",
        maxSizeGb: 200,
      });

      expect(suggestions.every((s) => s.modelId !== "bartowski/Qwen3-32B-GGUF")).toBe(true);
    });

    it("should filter by preferred format", () => {
      const suggestions = hub.suggestBetterModels({
        task: "text-generation",
        maxSizeGb: 200,
        preferredFormat: "gguf",
      });

      for (const s of suggestions) {
        expect(s.format).toBe("gguf");
      }
    });

    it("should filter by preferred runtimes", () => {
      const suggestions = hub.suggestBetterModels({
        task: "text-generation",
        maxSizeGb: 200,
        preferredRuntimes: ["ollama"],
      });

      for (const s of suggestions) {
        expect(s.compatibleWith).toContain("ollama");
      }
    });

    it("should sort by score descending", () => {
      const suggestions = hub.suggestBetterModels({
        task: "text-generation",
        maxSizeGb: 200,
      });

      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i].score).toBeLessThanOrEqual(suggestions[i - 1].score);
      }
    });

    it("should return voice model suggestions", () => {
      const suggestions = hub.suggestBetterModels({
        task: "text-to-speech",
        maxSizeGb: 50,
      });

      expect(suggestions.length).toBeGreaterThan(0);
      for (const s of suggestions) {
        expect(s.task).toBe("text-to-speech");
      }
    });

    it("should return empty array when no models fit constraints", () => {
      const suggestions = hub.suggestBetterModels({
        task: "text-generation",
        maxSizeGb: 0.1,
      });

      expect(suggestions).toHaveLength(0);
    });
  });

  // ── Download ────────────────────────────────────────────────

  describe("downloadFile", () => {
    it("should download a file with progress events", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array(1000) })
          .mockResolvedValueOnce({ done: true }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) => (name === "content-length" ? "1000" : null),
        },
        body: {
          getReader: () => mockReader,
        },
      });

      const events: string[] = [];
      hub.on("fileDownloadStart", () => events.push("start"));
      hub.on("downloadProgress", () => events.push("progress"));
      hub.on("fileDownloadComplete", () => events.push("complete"));

      const path = await hub.downloadFile("test/model", "model.gguf");
      expect(path).toContain("test_model");
      expect(path).toContain("model.gguf");
      expect(events).toEqual(["start", "progress", "complete"]);
    });

    it("should include auth token when configured", async () => {
      const authedHub = createHub("hf_test_token");
      const mockReader = {
        read: vi.fn().mockResolvedValueOnce({ done: true }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "0" },
        body: { getReader: () => mockReader },
      });

      await authedHub.downloadFile("test/model", "model.gguf");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer hf_test_token");
    });

    it("should throw on download failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(hub.downloadFile("test/model", "model.gguf")).rejects.toThrow(
        "Failed to download",
      );
    });
  });

  // ── Model File Tree ─────────────────────────────────────────

  describe("getModelTree", () => {
    it("should list files in a model repo", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { type: "file", rfilename: "model-Q4_K_M.gguf", size: 4500000000 },
          { type: "file", rfilename: "model-Q5_K_S.gguf", size: 5200000000 },
          { type: "file", rfilename: "config.json", size: 1024 },
          { type: "directory", path: "tokenizer" },
        ],
      });

      const files = await hub.getModelTree("TheBloke/Mistral-7B-GGUF");
      expect(files).toHaveLength(3); // Only files, not directories
      expect(files[0].filename).toBe("model-Q4_K_M.gguf");
      expect(files[0].format).toBe("gguf");
      expect(files[0].quantization).toBe("Q4_K_M");
      expect(files[1].quantization).toBe("Q5_K_S");
    });
  });

  // ── Sharded Model Detection ─────────────────────────────────

  describe("sharded model detection", () => {
    it("should detect sharded SafeTensors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { type: "file", rfilename: "model-00001-of-00030.safetensors", size: 5000000000 },
          { type: "file", rfilename: "model-00002-of-00030.safetensors", size: 5000000000 },
        ],
      });

      const files = await hub.getModelTree("meta-llama/Llama-70B");
      expect(files[0].isSharded).toBe(true);
      expect(files[0].shardIndex).toBe(1);
      expect(files[0].totalShards).toBe(30);
    });
  });
});
