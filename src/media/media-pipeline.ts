import { EventEmitter } from "events";
import {
  MediaConfig,
  TtsRequest,
  TtsResult,
  SttRequest,
  SttResult,
  VisionRequest,
  VisionResult,
} from "./types";

const FETCH_TIMEOUT_MS = 30000; // 30 second timeout for all media calls
const ALLOWED_SCHEMES = ["http:", "https:"];
const BLOCKED_HOSTS = ["169.254.169.254", "metadata.google.internal", "[::1]"];

/**
 * Validate that an endpoint URL is safe (no SSRF to cloud metadata, etc.)
 */
function validateEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint URL: ${endpoint}`);
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Blocked endpoint scheme: ${parsed.protocol}`);
  }
  if (BLOCKED_HOSTS.includes(parsed.hostname)) {
    throw new Error(`Blocked endpoint host: ${parsed.hostname}`);
  }
  // Block link-local and cloud metadata IPs
  if (parsed.hostname.startsWith("169.254.")) {
    throw new Error(`Blocked link-local endpoint: ${parsed.hostname}`);
  }
}

/**
 * Media Pipeline — TTS, STT, and Vision
 *
 * Lightweight wrappers around local model endpoints running in
 * LXC containers on Proxmox. The Radeon GPU (16GB VRAM) can be
 * passed through to containers via ROCm for acceleration.
 *
 * All endpoints are simple HTTP APIs:
 *   - TTS: POST /synthesize → audio
 *   - STT: POST /transcribe → text
 *   - Vision: POST /api/chat (Ollama) → description
 */
export class MediaPipeline extends EventEmitter {
  private readonly config: MediaConfig;

  constructor(config: MediaConfig) {
    super();
    this.config = config;

    // Validate all endpoints at construction time
    validateEndpoint(config.tts.endpoint);
    validateEndpoint(config.stt.endpoint);
    validateEndpoint(config.vision.endpoint);
  }

  // ─── TTS (Text-to-Speech) ─────────────────────────────────

  /**
   * Convert text to speech using the configured TTS engine.
   * Returns base64-encoded audio data.
   */
  async speak(request: TtsRequest): Promise<TtsResult> {
    const startTime = Date.now();
    const endpoint = this.config.tts.endpoint;

    if (this.config.tts.engine === "piper") {
      return this.piperTts(request, endpoint, startTime);
    }
    return this.nemoTts(request, endpoint, startTime);
  }

  private async piperTts(
    request: TtsRequest,
    endpoint: string,
    startTime: number
  ): Promise<TtsResult> {
    const response = await fetch(`${endpoint}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: request.text,
        speaker_id: request.speakerId ?? this.config.tts.speakerId ?? 0,
        length_scale: 1.0 / (request.rate ?? this.config.tts.rate),
        output_type: request.format ?? "wav",
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`TTS failed: HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const audio = Buffer.from(buffer).toString("base64");

    return {
      audio,
      format: request.format ?? "wav",
      durationMs: 0, // Would need to parse audio header
      sampleRate: 22050,
      generationTimeMs: Date.now() - startTime,
    };
  }

  private async nemoTts(
    request: TtsRequest,
    endpoint: string,
    startTime: number
  ): Promise<TtsResult> {
    const response = await fetch(`${endpoint}/api/v1/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: request.text,
        model: this.config.tts.model,
        speaker: request.speakerId ?? this.config.tts.speakerId,
        sample_rate: 22050,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`NeMo TTS failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { audio: string; sample_rate: number };

    return {
      audio: data.audio,
      format: "wav",
      durationMs: 0,
      sampleRate: data.sample_rate || 22050,
      generationTimeMs: Date.now() - startTime,
    };
  }

  // ─── STT (Speech-to-Text) ─────────────────────────────────

  /**
   * Transcribe audio to text using the configured STT engine.
   */
  async transcribe(request: SttRequest): Promise<SttResult> {
    const startTime = Date.now();
    const endpoint = this.config.stt.endpoint;

    if (this.config.stt.engine === "whisper") {
      return this.whisperStt(request, endpoint, startTime);
    }
    return this.nemoStt(request, endpoint, startTime);
  }

  private async whisperStt(
    request: SttRequest,
    endpoint: string,
    startTime: number
  ): Promise<SttResult> {
    const response = await fetch(`${endpoint}/inference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: request.audio,
        language: request.language ?? this.config.stt.language ?? "auto",
        model: this.config.stt.model,
        response_format: "verbose_json",
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Whisper STT failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      text: string;
      language: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: data.text,
      language: data.language || "en",
      confidence: 0.9,
      segments: data.segments || [],
      processingTimeMs: Date.now() - startTime,
    };
  }

  private async nemoStt(
    request: SttRequest,
    endpoint: string,
    startTime: number
  ): Promise<SttResult> {
    const response = await fetch(`${endpoint}/api/v1/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: request.audio,
        model: this.config.stt.model,
        language: request.language ?? this.config.stt.language,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`NeMo STT failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      text: string;
      language: string;
      confidence: number;
      segments: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: data.text,
      language: data.language || "en",
      confidence: data.confidence ?? 0.9,
      segments: data.segments || [],
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ─── Vision ────────────────────────────────────────────────

  /**
   * Analyze an image using the configured vision model (LLaVA via Ollama).
   */
  async analyzeImage(request: VisionRequest): Promise<VisionResult> {
    const startTime = Date.now();
    const endpoint = this.config.vision.endpoint;

    const response = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.vision.model,
        messages: [
          {
            role: "user",
            content: request.prompt,
            images: [request.image],
          },
        ],
        stream: false,
        options: {
          num_predict: request.maxTokens ?? 1024,
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Vision failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      message?: { content: string };
    };

    const description = data.message?.content || "";

    // Extract confidence if the model provides one
    const confMatch = description.match(/\[confidence:\s*([\d.]+)\]/i);
    const confidence = confMatch ? parseFloat(confMatch[1]) : 0.7;

    return {
      description,
      confidence,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ─── Config Access ─────────────────────────────────────────

  getConfig(): MediaConfig {
    return { ...this.config };
  }

  getTtsConfig() {
    return this.config.tts;
  }

  getSttConfig() {
    return this.config.stt;
  }

  getVisionConfig() {
    return this.config.vision;
  }
}
