/**
 * Real-time voice conversation types.
 *
 * Full-duplex voice: continuous mic → VAD → STT → Agent → TTS → speaker
 * with barge-in (user interrupts AI mid-speech).
 */

/** Per-client voice session state */
export interface VoiceSession {
  clientId: string;
  /** Whether the voice loop is active */
  active: boolean;
  /** Accumulates audio chunks while user is speaking */
  audioBuffer: string[];
  /** Tracks if user is currently speaking (VAD detected speech) */
  userSpeaking: boolean;
  /** Tracks if AI is currently speaking (TTS playing) */
  aiSpeaking: boolean;
  /** Silence counter — how many consecutive silent chunks received */
  silenceChunks: number;
  /** Timestamp of last speech activity */
  lastSpeechAt: number;
  /** Current conversation turn ID */
  turnId: number;
  /** If set, the current TTS generation should be cancelled */
  interrupted: boolean;
}

/** Audio chunk sent from client during voice mode */
export interface VoiceAudioChunk {
  /** Base64-encoded audio data (PCM 16-bit 16kHz mono) */
  audio: string;
  /** Client-side VAD result: true if speech detected in this chunk */
  speechDetected: boolean;
  /** Chunk sequence number */
  seq: number;
}

/** Server → Client: voice session state update */
export interface VoiceStateUpdate {
  active: boolean;
  listening: boolean;
  aiSpeaking: boolean;
  turnId: number;
}

/** Server → Client: transcription result (partial or final) */
export interface VoiceTranscription {
  text: string;
  isFinal: boolean;
  turnId: number;
}

/** Server → Client: TTS audio chunk for playback */
export interface VoiceTtsChunk {
  /** Base64-encoded audio data */
  audio: string;
  format: string;
  turnId: number;
  /** True if this is the last chunk for this turn */
  isFinal: boolean;
}

/** Server → Client: agent response text */
export interface VoiceAgentResponse {
  text: string;
  turnId: number;
}

/** Configuration for the voice conversation engine */
export interface VoiceConversationConfig {
  /** Number of consecutive silent chunks before treating as end-of-speech */
  silenceThreshold: number;
  /** Max audio buffer duration in chunks before force-processing */
  maxBufferChunks: number;
  /** Minimum chunks of speech required to trigger processing (debounce) */
  minSpeechChunks: number;
  /** Whether to enable barge-in (user interrupts AI) */
  bargeInEnabled: boolean;
  /** Max text length for a single TTS call (longer gets chunked) */
  ttsMaxChars: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceConversationConfig = {
  silenceThreshold: 12,    // ~750ms of silence at 16kHz/60ms chunks
  maxBufferChunks: 500,    // ~30 seconds max recording
  minSpeechChunks: 3,      // At least ~180ms of speech to avoid false triggers
  bargeInEnabled: true,
  ttsMaxChars: 500,
};
