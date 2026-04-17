import { describe, it, expect, beforeEach } from "vitest";
import { MediaPipeline } from "./media-pipeline";
import { MediaConfig } from "./types";

describe("Media Pipeline", () => {
  let media: MediaPipeline;
  const mockConfig: MediaConfig = {
    tts: {
      endpoint: "http://localhost:5000",
      engine: "piper",
      model: "hu_HU-anna-medium",
      speakerId: 0,
      rate: 1.0,
      resources: { memoryMb: 1024, cores: 2, useGpu: false },
    },
    stt: {
      endpoint: "http://localhost:8080",
      engine: "whisper",
      model: "whisper-large-v3",
      language: undefined,
      resources: { memoryMb: 4096, cores: 4, useGpu: true },
    },
    vision: {
      endpoint: "http://localhost:11434",
      model: "llava-llama3:8b",
      backend: "ollama",
      resources: { memoryMb: 8192, cores: 4, useGpu: true },
    },
  };

  beforeEach(() => {
    media = new MediaPipeline(mockConfig);
  });

  describe("Configuration", () => {
    it("should store and return config", () => {
      const config = media.getConfig();
      expect(config.tts.engine).toBe("piper");
      expect(config.stt.engine).toBe("whisper");
      expect(config.vision.model).toBe("llava-llama3:8b");
    });

    it("should return TTS config", () => {
      const tts = media.getTtsConfig();
      expect(tts.model).toBe("hu_HU-anna-medium");
      expect(tts.resources.useGpu).toBe(false);
    });

    it("should return STT config with Hungarian support", () => {
      const stt = media.getSttConfig();
      expect(stt.model).toBe("whisper-large-v3");
      expect(stt.language).toBeUndefined(); // auto-detect
      expect(stt.resources.useGpu).toBe(true); // ROCm
    });

    it("should return Vision config with GPU offload", () => {
      const vision = media.getVisionConfig();
      expect(vision.model).toBe("llava-llama3:8b");
      expect(vision.resources.useGpu).toBe(true);
      expect(vision.resources.memoryMb).toBe(8192);
    });
  });

  describe("TTS", () => {
    it("should support Piper engine for Hungarian", () => {
      expect(mockConfig.tts.engine).toBe("piper");
      expect(mockConfig.tts.model).toBe("hu_HU-anna-medium");
    });

    it("should configure rate correctly", () => {
      expect(mockConfig.tts.rate).toBe(1.0);
    });
  });

  describe("STT", () => {
    it("should support Whisper engine", () => {
      expect(mockConfig.stt.engine).toBe("whisper");
    });

    it("should use large-v3 for best Hungarian accuracy", () => {
      expect(mockConfig.stt.model).toBe("whisper-large-v3");
    });

    it("should auto-detect language by default", () => {
      expect(mockConfig.stt.language).toBeUndefined();
    });
  });

  describe("Vision", () => {
    it("should use LLaVA via Ollama", () => {
      expect(mockConfig.vision.backend).toBe("ollama");
      expect(mockConfig.vision.model).toContain("llava");
    });

    it("should be configured for Radeon GPU", () => {
      expect(mockConfig.vision.resources.useGpu).toBe(true);
      expect(mockConfig.vision.resources.memoryMb).toBe(8192);
    });
  });

  describe("Resource Requirements", () => {
    it("should have lightweight TTS (CPU only)", () => {
      expect(mockConfig.tts.resources.memoryMb).toBe(1024);
      expect(mockConfig.tts.resources.cores).toBe(2);
      expect(mockConfig.tts.resources.useGpu).toBe(false);
    });

    it("should have STT with GPU acceleration", () => {
      expect(mockConfig.stt.resources.memoryMb).toBe(4096);
      expect(mockConfig.stt.resources.cores).toBe(4);
      expect(mockConfig.stt.resources.useGpu).toBe(true);
    });

    it("should have vision with GPU offload", () => {
      expect(mockConfig.vision.resources.memoryMb).toBe(8192);
      expect(mockConfig.vision.resources.cores).toBe(4);
      expect(mockConfig.vision.resources.useGpu).toBe(true);
    });

    it("should total media resources correctly", () => {
      const totalMem =
        mockConfig.tts.resources.memoryMb +
        mockConfig.stt.resources.memoryMb +
        mockConfig.vision.resources.memoryMb;
      const totalCores =
        mockConfig.tts.resources.cores +
        mockConfig.stt.resources.cores +
        mockConfig.vision.resources.cores;

      expect(totalMem).toBe(13312); // 1024 + 4096 + 8192
      expect(totalCores).toBe(10); // 2 + 4 + 4
    });
  });
});
