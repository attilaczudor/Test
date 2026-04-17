/**
 * Personality & Conversation Memory Types
 *
 * Provides a persistent identity for the system — remembers all
 * conversations, maintains a consistent personality, and builds
 * long-term relationships with users.
 */

export interface PersonalityConfig {
  /** Directory to persist personality data and conversation history */
  persistPath: string;
  /** The system's name */
  name: string;
  /** Core personality traits */
  traits: PersonalityTraits;
  /** Maximum conversations to keep in full (older ones get summarized) */
  maxConversations: number;
  /** Maximum messages per conversation to retain */
  maxMessagesPerConversation: number;
  /** Auto-summarize conversations older than this (ms) */
  summarizeAfterMs: number;
}

export interface PersonalityTraits {
  /** Overall communication style */
  style: "formal" | "casual" | "technical" | "friendly" | "witty";
  /** How verbose responses should be (0.0 = terse, 1.0 = elaborate) */
  verbosity: number;
  /** How much initiative the system takes (0.0 = reactive, 1.0 = proactive) */
  proactivity: number;
  /** Custom personality description injected into system prompts */
  description: string;
  /** Topics the system is especially interested in or knowledgeable about */
  interests: string[];
  /** Communication preferences */
  preferences: {
    useAnalogies: boolean;
    useExamples: boolean;
    showReasoning: boolean;
    acknowledgeUncertainty: boolean;
  };
}

export interface ConversationEntry {
  id: string;
  userId: string;
  startedAt: number;
  lastMessageAt: number;
  messages: ConversationMessage[];
  /** Auto-generated summary for long conversations */
  summary?: string;
  /** Key topics discussed */
  topics: string[];
  /** Sentiment trend over the conversation */
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  /** Important facts learned about the user in this conversation */
  learnedFacts: string[];
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface UserProfile {
  userId: string;
  /** Accumulated facts about this user across all conversations */
  knownFacts: string[];
  /** User's communication preferences (learned over time) */
  preferences: {
    technicalLevel: "beginner" | "intermediate" | "advanced" | "expert";
    preferredStyle: string;
  };
  /** Topics the user frequently discusses */
  frequentTopics: string[];
  /** Total conversations with this user */
  conversationCount: number;
  firstInteraction: number;
  lastInteraction: number;
  /** Structured knowledge about the user (name, role, tools, goals, etc.) */
  identity: {
    name?: string;
    role?: string;        // "developer", "sysadmin", "researcher", etc.
    location?: string;
    language?: string;     // preferred language
    timezone?: string;
    hardware?: string[];   // detected hardware mentions
    tools?: string[];      // tools/software they use
    goals?: string[];      // stated goals or interests
  };
  /** Interaction patterns learned over time */
  patterns: {
    averageMessageLength: number;
    totalMessages: number;
    topicHistory: Array<{ topic: string; count: number; lastSeen: number }>;
    activeHours: number[]; // 0-23 hour buckets showing when user is active
  };
}

export interface PersonalityState {
  /** User profiles keyed by userId */
  users: Record<string, UserProfile>;
  /** Conversation entries keyed by conversation id */
  conversations: Record<string, ConversationEntry>;
  /** Conversation summaries for older chats */
  conversationSummaries: Array<{
    conversationId: string;
    userId: string;
    summary: string;
    topics: string[];
    date: number;
  }>;
  /** Facts the system has learned across all interactions */
  globalFacts: string[];
  /** System's mood/state (evolves based on interactions) */
  mood: "neutral" | "engaged" | "curious" | "helpful" | "focused";
  lastUpdated: number;
}
