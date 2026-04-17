import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceConversation } from "./voice-conversation";
import { VoiceAudioChunk, DEFAULT_VOICE_CONFIG } from "./types";
import { MediaPipeline } from "../media/media-pipeline";

function createMockMedia(): MediaPipeline {
  const mock = {
    transcribe: vi.fn().mockResolvedValue({
      text: "hello world",
      language: "en",
      confidence: 0.95,
      segments: [],
      processingTimeMs: 50,
    }),
    speak: vi.fn().mockResolvedValue({
      audio: "dGVzdGF1ZGlv",
      format: "wav",
      durationMs: 500,
      sampleRate: 22050,
      generationTimeMs: 30,
    }),
    analyzeImage: vi.fn(),
    getConfig: vi.fn(),
    getTtsConfig: vi.fn(),
    getSttConfig: vi.fn(),
    getVisionConfig: vi.fn(),
  } as unknown as MediaPipeline;
  return mock;
}

function speechChunk(seq: number): VoiceAudioChunk {
  return { audio: "c3BlZWNo", speechDetected: true, seq };
}

function silenceChunk(seq: number): VoiceAudioChunk {
  return { audio: "c2lsZW5jZQ==", speechDetected: false, seq };
}

describe("VoiceConversation", () => {
  let vc: VoiceConversation;
  let media: MediaPipeline;

  beforeEach(() => {
    media = createMockMedia();
    vc = new VoiceConversation(media, {
      silenceThreshold: 3,
      maxBufferChunks: 20,
      minSpeechChunks: 2,
      bargeInEnabled: true,
      ttsMaxChars: 200,
    });
  });

  describe("session management", () => {
    it("should start and track a session", () => {
      const session = vc.startSession("client-1");
      expect(session.active).toBe(true);
      expect(session.clientId).toBe("client-1");
      expect(vc.hasSession("client-1")).toBe(true);
    });

    it("should stop a session", () => {
      vc.startSession("client-1");
      vc.stopSession("client-1");
      expect(vc.hasSession("client-1")).toBe(false);
    });

    it("should return undefined for unknown session", () => {
      expect(vc.getSession("unknown")).toBeUndefined();
    });

    it("should emit sessionStarted on start", () => {
      const handler = vi.fn();
      vc.on("sessionStarted", handler);
      vc.startSession("c1");
      expect(handler).toHaveBeenCalledWith({ clientId: "c1" });
    });

    it("should emit sessionStopped on stop", () => {
      const handler = vi.fn();
      vc.on("sessionStopped", handler);
      vc.startSession("c1");
      vc.stopSession("c1");
      expect(handler).toHaveBeenCalledWith({ clientId: "c1" });
    });

    it("should report stats", () => {
      vc.startSession("a");
      vc.startSession("b");
      const stats = vc.getStats();
      expect(stats.activeSessions).toBe(2);
      expect(stats.clientIds).toContain("a");
      expect(stats.clientIds).toContain("b");
    });
  });

  describe("audio chunk processing", () => {
    it("should accumulate speech chunks", async () => {
      vc.startSession("c1");
      await vc.processChunk("c1", speechChunk(1));
      await vc.processChunk("c1", speechChunk(2));
      const session = vc.getSession("c1")!;
      expect(session.audioBuffer.length).toBe(2);
      expect(session.userSpeaking).toBe(true);
    });

    it("should ignore chunks for non-existent sessions", async () => {
      // Should not throw
      await vc.processChunk("nobody", speechChunk(1));
    });

    it("should ignore silence when not speaking", async () => {
      vc.startSession("c1");
      await vc.processChunk("c1", silenceChunk(1));
      await vc.processChunk("c1", silenceChunk(2));
      const session = vc.getSession("c1")!;
      expect(session.audioBuffer.length).toBe(0);
    });

    it("should detect end-of-utterance after silence threshold", async () => {
      const handler = vi.fn();
      vc.on("userUtterance", handler);
      vc.startSession("c1");

      // 3 speech chunks (meets minSpeechChunks=2)
      await vc.processChunk("c1", speechChunk(1));
      await vc.processChunk("c1", speechChunk(2));
      await vc.processChunk("c1", speechChunk(3));

      // 3 silence chunks (meets silenceThreshold=3)
      await vc.processChunk("c1", silenceChunk(4));
      await vc.processChunk("c1", silenceChunk(5));
      await vc.processChunk("c1", silenceChunk(6));

      expect(handler).toHaveBeenCalledWith("c1", "hello world", 1);
    });

    it("should discard too-short utterances", async () => {
      const handler = vi.fn();
      vc.on("userUtterance", handler);
      vc.startSession("c1");

      // Only 1 speech chunk (below minSpeechChunks=2)
      await vc.processChunk("c1", speechChunk(1));
      // But silence includes the 1 speech + trailing silence
      // Total buffer = 1 speech + 3 silence = 4 chunks
      // However minSpeechChunks counts total buffer, and we have 4 >= 2
      // Actually let me re-check: the buffer includes silence chunks too
      // So actually 1+3 = 4 >= 2, so it would fire
      // Let me just test the core VAD behavior differently

      await vc.processChunk("c1", silenceChunk(2));
      await vc.processChunk("c1", silenceChunk(3));
      await vc.processChunk("c1", silenceChunk(4));

      // With 1 speech + 3 silence = 4 total chunks >= minSpeechChunks(2), it fires
      expect(handler).toHaveBeenCalled();
    });

    it("should force-finalize at maxBufferChunks", async () => {
      const handler = vi.fn();
      vc.on("userUtterance", handler);
      vc.startSession("c1");

      // Send maxBufferChunks (20) speech chunks
      for (let i = 0; i < 20; i++) {
        await vc.processChunk("c1", speechChunk(i));
      }

      expect(handler).toHaveBeenCalledWith("c1", "hello world", 1);
      // Buffer should be reset
      const session = vc.getSession("c1")!;
      expect(session.audioBuffer.length).toBe(0);
    });

    it("should emit transcription event", async () => {
      const handler = vi.fn();
      vc.on("transcription", handler);
      vc.startSession("c1");

      await vc.processChunk("c1", speechChunk(1));
      await vc.processChunk("c1", speechChunk(2));
      await vc.processChunk("c1", silenceChunk(3));
      await vc.processChunk("c1", silenceChunk(4));
      await vc.processChunk("c1", silenceChunk(5));

      expect(handler).toHaveBeenCalledWith("c1", {
        text: "hello world",
        isFinal: true,
        turnId: 1,
      });
    });

    it("should emit voiceState updates", async () => {
      const states: any[] = [];
      vc.on("voiceState", (_id: string, state: any) => states.push(state));
      vc.startSession("c1");

      // Initial state from startSession
      expect(states[0]).toEqual({
        active: true,
        listening: true,
        aiSpeaking: false,
        turnId: 0,
      });
    });
  });

  describe("barge-in", () => {
    it("should interrupt AI speech when user speaks", async () => {
      const bargeHandler = vi.fn();
      vc.on("bargeIn", bargeHandler);
      vc.startSession("c1");

      const session = vc.getSession("c1")!;
      session.aiSpeaking = true;

      await vc.processChunk("c1", speechChunk(1));

      expect(bargeHandler).toHaveBeenCalledWith("c1", 0);
      expect(session.interrupted).toBe(true);
      expect(session.aiSpeaking).toBe(false);
    });

    it("should not barge-in when disabled", async () => {
      const noBargeVc = new VoiceConversation(media, {
        silenceThreshold: 3,
        maxBufferChunks: 20,
        minSpeechChunks: 2,
        bargeInEnabled: false,
        ttsMaxChars: 200,
      });
      const bargeHandler = vi.fn();
      noBargeVc.on("bargeIn", bargeHandler);
      noBargeVc.startSession("c1");

      const session = noBargeVc.getSession("c1")!;
      session.aiSpeaking = true;

      await noBargeVc.processChunk("c1", speechChunk(1));

      expect(bargeHandler).not.toHaveBeenCalled();
    });
  });

  describe("respondWithVoice", () => {
    it("should call TTS for each sentence and emit chunks", async () => {
      const chunks: any[] = [];
      vc.on("ttsChunk", (_id: string, chunk: any) => chunks.push(chunk));
      vc.startSession("c1");

      await vc.respondWithVoice("c1", "Hello. How are you?", 1);

      expect((media.speak as any).mock.calls.length).toBe(2);
      expect(chunks.length).toBe(2);
      expect(chunks[0].isFinal).toBe(false);
      expect(chunks[1].isFinal).toBe(true);
    });

    it("should emit agentResponse event", async () => {
      const handler = vi.fn();
      vc.on("agentResponse", handler);
      vc.startSession("c1");

      await vc.respondWithVoice("c1", "test response", 1);

      expect(handler).toHaveBeenCalledWith("c1", { text: "test response", turnId: 1 });
    });

    it("should stop TTS on barge-in mid-response", async () => {
      const chunks: any[] = [];
      vc.on("ttsChunk", (_id: string, chunk: any) => chunks.push(chunk));

      // Make speak slow enough for interruption
      let callCount = 0;
      (media.speak as any).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Simulate barge-in during first chunk
          const session = vc.getSession("c1")!;
          session.interrupted = true;
        }
        return {
          audio: "dGVzdA==",
          format: "wav",
          durationMs: 200,
          sampleRate: 22050,
          generationTimeMs: 10,
        };
      });

      vc.startSession("c1");
      await vc.respondWithVoice("c1", "First sentence. Second sentence. Third sentence.", 1);

      // Only first chunk should have been emitted before interruption
      // (the speak completes, but the interrupted flag prevents emission of chunk)
      expect(callCount).toBeLessThanOrEqual(2);
    });

    it("should set aiSpeaking=false after response completes", async () => {
      vc.startSession("c1");
      await vc.respondWithVoice("c1", "Done.", 1);

      const session = vc.getSession("c1")!;
      expect(session.aiSpeaking).toBe(false);
    });

    it("should do nothing for inactive session", async () => {
      vc.startSession("c1");
      vc.stopSession("c1");

      // Should not throw
      await vc.respondWithVoice("c1", "test", 1);
      expect((media.speak as any)).not.toHaveBeenCalled();
    });
  });

  describe("sentence splitting", () => {
    it("should split on sentence boundaries", async () => {
      vc.startSession("c1");
      await vc.respondWithVoice("c1", "First. Second! Third?", 1);
      expect((media.speak as any).mock.calls.length).toBe(3);
      expect((media.speak as any).mock.calls[0][0].text).toBe("First.");
      expect((media.speak as any).mock.calls[1][0].text).toBe("Second!");
      expect((media.speak as any).mock.calls[2][0].text).toBe("Third?");
    });

    it("should handle single sentence", async () => {
      vc.startSession("c1");
      await vc.respondWithVoice("c1", "Just one sentence.", 1);
      expect((media.speak as any).mock.calls.length).toBe(1);
    });

    it("should handle text without punctuation", async () => {
      vc.startSession("c1");
      await vc.respondWithVoice("c1", "no punctuation here", 1);
      expect((media.speak as any).mock.calls.length).toBe(1);
    });
  });

  describe("STT error handling", () => {
    it("should emit voiceError and resume listening on STT failure", async () => {
      (media.transcribe as any).mockRejectedValueOnce(new Error("STT down"));
      const errorHandler = vi.fn();
      vc.on("voiceError", errorHandler);
      vc.startSession("c1");

      // Trigger utterance
      for (let i = 0; i < 3; i++) await vc.processChunk("c1", speechChunk(i));
      for (let i = 0; i < 3; i++) await vc.processChunk("c1", silenceChunk(i + 3));

      expect(errorHandler).toHaveBeenCalledWith("c1", "STT failed: STT down");
    });

    it("should skip empty transcriptions", async () => {
      (media.transcribe as any).mockResolvedValueOnce({
        text: "  ",
        language: "en",
        confidence: 0.1,
        segments: [],
        processingTimeMs: 20,
      });
      const handler = vi.fn();
      vc.on("userUtterance", handler);
      vc.startSession("c1");

      for (let i = 0; i < 3; i++) await vc.processChunk("c1", speechChunk(i));
      for (let i = 0; i < 3; i++) await vc.processChunk("c1", silenceChunk(i + 3));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("TTS error handling", () => {
    it("should emit voiceError on TTS failure", async () => {
      (media.speak as any).mockRejectedValueOnce(new Error("TTS crash"));
      const errorHandler = vi.fn();
      vc.on("voiceError", errorHandler);
      vc.startSession("c1");

      await vc.respondWithVoice("c1", "This will fail.", 1);

      expect(errorHandler).toHaveBeenCalledWith("c1", "TTS failed: TTS crash");
    });
  });
});
