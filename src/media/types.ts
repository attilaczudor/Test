/**
 * Media Pipeline Types — TTS, STT, and Vision
 *
 * Integrates:
 *   - TTS: Piper TTS (lightweight, runs on CPU) or NVIDIA NeMo Parakeet
 *   - STT: Whisper.cpp (CPU/ROCm) or NVIDIA NeMo Canary
 *   - Vision: LLaVA via Ollama (image understanding)
 *
 * All models run locally in LXC containers on Proxmox.
 * Radeon GPU (16GB VRAM) can accelerate via ROCm.
 */

export interface MediaConfig {
  tts: TtsConfig;
  stt: SttConfig;
  vision: VisionConfig;
}

// ─── TTS (Text-to-Speech) ────────────────────────────────────

export interface TtsConfig {
  /** TTS backend endpoint */
  endpoint: string;
  /** TTS engine: piper (lightweight CPU) or nemo (NVIDIA GPU) */
  engine: "piper" | "nemo";
  /** Voice model name */
  model: string;
  /** Default speaker ID (for multi-speaker models) */
  speakerId?: number;
  /** Speech rate multiplier (1.0 = normal) */
  rate: number;
  /** Container resources */
  resources: {
    memoryMb: number;
    cores: number;
    useGpu: boolean;
  };
}

export interface TtsRequest {
  text: string;
  speakerId?: number;
  rate?: number;
  format?: "wav" | "mp3" | "opus";
}

export interface TtsResult {
  /** Base64-encoded audio data */
  audio: string;
  format: string;
  durationMs: number;
  sampleRate: number;
  generationTimeMs: number;
}

// ─── STT (Speech-to-Text) ────────────────────────────────────

export interface SttConfig {
  /** STT backend endpoint */
  endpoint: string;
  /** STT engine: whisper (CPU/ROCm) or nemo (NVIDIA) */
  engine: "whisper" | "nemo";
  /** Whisper model size */
  model: string;
  /** Language for transcription (auto-detect if not set) */
  language?: string;
  /** Container resources */
  resources: {
    memoryMb: number;
    cores: number;
    useGpu: boolean;
  };
}

export interface SttRequest {
  /** Base64-encoded audio data */
  audio: string;
  format: "wav" | "mp3" | "opus" | "webm";
  language?: string;
}

export interface SttResult {
  text: string;
  language: string;
  confidence: number;
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  processingTimeMs: number;
}

// ─── Vision ──────────────────────────────────────────────────

export interface VisionConfig {
  /** Ollama endpoint for vision model */
  endpoint: string;
  /** Vision model name (e.g. "llava-llama3:8b-v1.1") */
  model: string;
  /** Backend */
  backend: "ollama";
  /** Container resources */
  resources: {
    memoryMb: number;
    cores: number;
    useGpu: boolean;
  };
}

export interface VisionRequest {
  /** Base64-encoded image */
  image: string;
  /** Question about the image */
  prompt: string;
  /** Max tokens for response */
  maxTokens?: number;
}

export interface VisionResult {
  description: string;
  confidence: number;
  processingTimeMs: number;
}
