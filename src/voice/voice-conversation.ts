/**
 * Real-time Voice Conversation Engine
 *
 * Full-duplex voice loop per client:
 *   1. Client streams audio chunks with client-side VAD flags
 *   2. Engine accumulates speech chunks into a buffer
 *   3. On silence detection (end-of-utterance), sends buffer to STT
 *   4. STT result goes to Agent for processing
 *   5. Agent response is split into sentences and streamed through TTS
 *   6. TTS audio chunks are sent back to client for playback
 *   7. Barge-in: if user speaks while AI is talking, cancel TTS and restart
 */

import { EventEmitter } from "events";
import { MediaPipeline } from "../media/media-pipeline";
import {
  VoiceSession,
  VoiceAudioChunk,
  VoiceConversationConfig,
  DEFAULT_VOICE_CONFIG,
} from "./types";

export class VoiceConversation extends EventEmitter {
  private static readonly MAX_SESSIONS = 50;
  private static readonly MAX_BUFFER_MEMORY_BYTES = 10 * 1024 * 1024; // 10MB per session

  private readonly config: VoiceConversationConfig;
  private readonly sessions = new Map<string, VoiceSession>();
  private readonly media: MediaPipeline;

  constructor(media: MediaPipeline, config?: Partial<VoiceConversationConfig>) {
    super();
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
    this.media = media;
  }

  /**
   * Start a voice session for a client.
   */
  startSession(clientId: string): VoiceSession {
    // Enforce max concurrent session limit
    if (this.sessions.size >= VoiceConversation.MAX_SESSIONS && !this.sessions.has(clientId)) {
      throw new Error(`Max voice sessions (${VoiceConversation.MAX_SESSIONS}) reached`);
    }

    const session: VoiceSession = {
      clientId,
      active: true,
      audioBuffer: [],
      userSpeaking: false,
      aiSpeaking: false,
      silenceChunks: 0,
      lastSpeechAt: Date.now(),
      turnId: 0,
      interrupted: false,
    };
    this.sessions.set(clientId, session);
    this.emit("sessionStarted", { clientId });
    this.emit("voiceState", clientId, {
      active: true,
      listening: true,
      aiSpeaking: false,
      turnId: 0,
    });
    return session;
  }

  /**
   * Stop a voice session.
   */
  stopSession(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (session) {
      session.active = false;
      session.interrupted = true;
      this.sessions.delete(clientId);
      this.emit("sessionStopped", { clientId });
      this.emit("voiceState", clientId, {
        active: false,
        listening: false,
        aiSpeaking: false,
        turnId: session.turnId,
      });
    }
  }

  /**
   * Get session for a client.
   */
  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- upstream module resolution
  getSession(clientId: string): VoiceSession | undefined {
    return this.sessions.get(clientId);
  }

  /**
   * Returns true if client has an active voice session.
   */
  hasSession(clientId: string): boolean {
    const s = this.sessions.get(clientId);
    return !!s && s.active;
  }

  /**
   * Process an incoming audio chunk from the client.
   * This is the main entry point called for each chunk of mic audio.
   */
  async processChunk(clientId: string, chunk: VoiceAudioChunk): Promise<void> {
    const session = this.sessions.get(clientId);
    if (!session || !session.active) {
      return;
    }

    if (chunk.speechDetected) {
      // Speech detected in this chunk
      if (session.aiSpeaking && this.config.bargeInEnabled) {
        // Barge-in: user started talking over the AI
        session.interrupted = true;
        session.aiSpeaking = false;
        this.emit("bargeIn", clientId, session.turnId);
        this.emit("voiceState", clientId, {
          active: true,
          listening: true,
          aiSpeaking: false,
          turnId: session.turnId,
        });
      }

      session.userSpeaking = true;
      session.silenceChunks = 0;
      session.lastSpeechAt = Date.now();
      session.audioBuffer.push(chunk.audio);

      // Safety: cap buffer by chunk count AND estimated memory
      const estimatedBytes = session.audioBuffer.reduce((sum, a) => sum + a.length, 0);
      if (
        session.audioBuffer.length >= this.config.maxBufferChunks ||
        estimatedBytes >= VoiceConversation.MAX_BUFFER_MEMORY_BYTES
      ) {
        await this.finalizeUtterance(session);
      }
    } else {
      // Silence in this chunk
      if (session.userSpeaking) {
        // Still accumulate a bit of trailing silence for natural boundaries
        session.audioBuffer.push(chunk.audio);
        session.silenceChunks++;

        if (session.silenceChunks >= this.config.silenceThreshold) {
          // End of utterance detected
          if (session.audioBuffer.length >= this.config.minSpeechChunks) {
            await this.finalizeUtterance(session);
          } else {
            // Too short, discard (noise/false trigger)
            this.resetBuffer(session);
          }
        }
      }
      // If not speaking and silence, just ignore (idle listening)
    }
  }

  /**
   * Finalize an utterance: run STT, emit transcription, trigger agent processing.
   */
  private async finalizeUtterance(session: VoiceSession): Promise<void> {
    const audioChunks = [...session.audioBuffer];
    this.resetBuffer(session);

    if (audioChunks.length === 0) {
      return;
    }

    session.turnId++;
    const turnId = session.turnId;

    // Concatenate all base64 chunks into one audio blob
    const combinedAudio = audioChunks.join("");

    this.emit("voiceState", session.clientId, {
      active: true,
      listening: false,
      aiSpeaking: false,
      turnId,
    });

    // STT
    let transcription: string;
    try {
      const sttResult = await this.media.transcribe({
        audio: combinedAudio,
        format: "webm",
      });
      transcription = sttResult.text.trim();
    } catch (err: unknown) {
      this.emit(
        "voiceError",
        session.clientId,
        `STT failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.emit("voiceState", session.clientId, {
        active: true,
        listening: true,
        aiSpeaking: false,
        turnId,
      });
      return;
    }

    if (!transcription) {
      // Empty transcription, go back to listening
      this.emit("voiceState", session.clientId, {
        active: true,
        listening: true,
        aiSpeaking: false,
        turnId,
      });
      return;
    }

    // Emit the final transcription
    this.emit("transcription", session.clientId, {
      text: transcription,
      isFinal: true,
      turnId,
    });

    // Emit the user's text so the orchestrator can process it
    // The orchestrator (index.ts) will call respondToVoice() when the agent replies
    this.emit("userUtterance", session.clientId, transcription, turnId);
  }

  /**
   * Called by the orchestrator when the agent has a text response.
   * Splits into sentences and streams TTS back to the client.
   */
  async respondWithVoice(clientId: string, text: string, turnId: number): Promise<void> {
    const session = this.sessions.get(clientId);
    if (!session || !session.active) {
      return;
    }

    session.aiSpeaking = true;
    session.interrupted = false;

    this.emit("agentResponse", clientId, { text, turnId });
    this.emit("voiceState", clientId, {
      active: true,
      listening: true,
      aiSpeaking: true,
      turnId,
    });

    // Split response into sentences for lower-latency TTS streaming
    const sentences = this.splitIntoSentences(text);

    for (let i = 0; i < sentences.length; i++) {
      // Check for barge-in or session end between chunks
      if (session.interrupted || !session.active) {
        this.emit("ttsCancelled", clientId, turnId);
        break;
      }

      try {
        const ttsResult = await this.media.speak({ text: sentences[i] });

        // Double-check interruption after async TTS call
        if (session.interrupted || !session.active) {
          this.emit("ttsCancelled", clientId, turnId);
          break;
        }

        this.emit("ttsChunk", clientId, {
          audio: ttsResult.audio,
          format: ttsResult.format,
          turnId,
          isFinal: i === sentences.length - 1,
        });
      } catch (err: unknown) {
        this.emit(
          "voiceError",
          clientId,
          `TTS failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    }

    if (session.active && !session.interrupted) {
      session.aiSpeaking = false;
      this.emit("voiceState", clientId, {
        active: true,
        listening: true,
        aiSpeaking: false,
        turnId,
      });
    }
  }

  /**
   * Split text into sentences for streaming TTS.
   * Respects sentence boundaries and max char limits.
   */
  private splitIntoSentences(text: string): string[] {
    const raw = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const result: string[] = [];

    for (const s of raw) {
      const trimmed = s.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.length <= this.config.ttsMaxChars) {
        result.push(trimmed);
      } else {
        // Split long sentences at commas or midpoint
        const parts = trimmed.match(/[^,;]+[,;]?/g) || [trimmed];
        for (const p of parts) {
          if (p.trim()) {
            result.push(p.trim());
          }
        }
      }
    }

    return result.length > 0 ? result : [text];
  }

  /**
   * Reset the audio buffer and speech state for a session.
   */
  private resetBuffer(session: VoiceSession): void {
    session.audioBuffer = [];
    session.userSpeaking = false;
    session.silenceChunks = 0;
  }

  /**
   * Get stats about active voice sessions.
   */
  getStats(): { activeSessions: number; clientIds: string[] } {
    const clientIds = Array.from(this.sessions.keys());
    return { activeSessions: clientIds.length, clientIds };
  }
}
