import { EventEmitter } from "events";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  PersonalityConfig,
  ConversationEntry,
  ConversationMessage,
  UserProfile,
  PersonalityState,
} from "./types";

/**
 * Personality Engine — Persistent Identity & Conversation Memory
 *
 * Maintains a consistent personality across all interactions, remembers
 * every conversation, builds user profiles, and injects relevant context
 * into system prompts.
 *
 * All data persists to disk so the system remembers across restarts.
 */
export class PersonalityEngine extends EventEmitter {
  private readonly config: PersonalityConfig;
  private state: PersonalityState;
  private activeConversations = new Map<string, string>(); // userId -> conversationId

  constructor(config: PersonalityConfig) {
    super();
    // Validate persist path to prevent directory traversal
    // Check for ".." BEFORE resolving so traversal patterns are caught
    if (config.persistPath.includes("..")) {
      throw new Error(`Invalid persist path: ${config.persistPath}`);
    }
    const resolvedPath = path.resolve(config.persistPath);
    if (!path.isAbsolute(resolvedPath)) {
      throw new Error(`Invalid persist path: ${config.persistPath}`);
    }
    this.config = { ...config, persistPath: resolvedPath };
    this.state = this.loadState();
  }

  // ─── System Prompt Generation ──────────────────────────────

  /**
   * Generate a personality-aware system prompt for a given user.
   * Includes personality traits, user history, and relevant memories.
   */
  buildSystemPrompt(userId?: string): string {
    const parts: string[] = [];
    const t = this.config.traits;

    // Core identity
    parts.push(
      `You are ${this.config.name}, an autonomous AI system running on a local homelab.`,
      t.description,
      ""
    );

    // Communication style
    parts.push(`## Communication Style`);
    parts.push(`- Style: ${t.style}`);
    if (t.preferences.useAnalogies) parts.push("- Use analogies to explain complex concepts");
    if (t.preferences.useExamples) parts.push("- Provide concrete examples when helpful");
    if (t.preferences.showReasoning) parts.push("- Show your reasoning process");
    if (t.preferences.acknowledgeUncertainty) parts.push("- Acknowledge when you're uncertain");
    parts.push("");

    // Interests/expertise
    if (t.interests.length > 0) {
      parts.push(`## Areas of Expertise`);
      parts.push(t.interests.map((i) => `- ${i}`).join("\n"));
      parts.push("");
    }

    // User-specific context
    if (userId) {
      const profile = this.state.users[userId];
      if (profile) {
        parts.push(`## About This User`);

        // Identity section — what we know about the person
        if (profile.identity) {
          if (profile.identity.name) parts.push(`- Name: ${profile.identity.name}`);
          if (profile.identity.role) parts.push(`- Role: ${profile.identity.role}`);
          if (profile.identity.language) parts.push(`- Language: ${profile.identity.language}`);
          if (profile.identity.hardware && profile.identity.hardware.length > 0) {
            parts.push(`- Hardware: ${profile.identity.hardware.join(", ")}`);
          }
          if (profile.identity.tools && profile.identity.tools.length > 0) {
            parts.push(`- Uses: ${profile.identity.tools.join(", ")}`);
          }
          if (profile.identity.goals && profile.identity.goals.length > 0) {
            parts.push(`- Goals:`);
            for (const goal of profile.identity.goals.slice(-5)) {
              parts.push(`  - ${goal}`);
            }
          }
        }

        parts.push(`- Technical level: ${profile.preferences.technicalLevel}`);
        parts.push(`- Conversations so far: ${profile.conversationCount}`);
        parts.push(`- First interaction: ${new Date(profile.firstInteraction).toLocaleDateString()}`);

        if (profile.knownFacts.length > 0) {
          parts.push(`- Known facts:`);
          for (const fact of profile.knownFacts.slice(-10)) {
            parts.push(`  - ${fact}`);
          }
        }

        if (profile.frequentTopics.length > 0) {
          parts.push(`- Frequent topics: ${profile.frequentTopics.join(", ")}`);
        }
        parts.push("");
      }

      // Recent conversation context
      const recentSummaries = this.getRecentConversationSummaries(userId, 3);
      if (recentSummaries.length > 0) {
        parts.push(`## Recent Conversation History`);
        for (const summary of recentSummaries) {
          parts.push(`- [${new Date(summary.date).toLocaleDateString()}]: ${summary.summary}`);
        }
        parts.push("");
      }
    }

    // Global facts
    if (this.state.globalFacts.length > 0) {
      parts.push(`## Things I Remember`);
      for (const fact of this.state.globalFacts.slice(-15)) {
        parts.push(`- ${fact}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  // ─── Conversation Management ───────────────────────────────

  /**
   * Start a new conversation or resume an existing active one.
   */
  startConversation(userId: string): ConversationEntry {
    // Check for active conversation
    const activeId = this.activeConversations.get(userId);
    if (activeId && this.state.conversations[activeId]) {
      return this.state.conversations[activeId];
    }

    const entry: ConversationEntry = {
      id: `conv-${crypto.randomUUID().slice(0, 8)}`,
      userId,
      startedAt: Date.now(),
      lastMessageAt: Date.now(),
      messages: [],
      topics: [],
      sentiment: "neutral",
      learnedFacts: [],
    };

    this.state.conversations[entry.id] = entry;
    this.activeConversations.set(userId, entry.id);

    // Update user profile
    this.ensureUserProfile(userId);
    this.state.users[userId].conversationCount++;
    this.state.users[userId].lastInteraction = Date.now();

    this.saveState();
    this.emit("conversationStarted", { conversationId: entry.id, userId });

    return entry;
  }

  /**
   * Add a message to the active conversation.
   */
  addMessage(
    userId: string,
    role: ConversationMessage["role"],
    content: string
  ): ConversationMessage {
    let conversationId = this.activeConversations.get(userId);
    if (!conversationId) {
      const conv = this.startConversation(userId);
      conversationId = conv.id;
    }

    const conversation = this.state.conversations[conversationId];
    const message: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
    };

    conversation.messages.push(message);
    conversation.lastMessageAt = Date.now();

    // Trim messages if over limit
    if (conversation.messages.length > this.config.maxMessagesPerConversation) {
      // Summarize older messages before trimming
      const toSummarize = conversation.messages.slice(
        0,
        conversation.messages.length - this.config.maxMessagesPerConversation
      );
      if (toSummarize.length > 0) {
        const summary = this.summarizeMessages(toSummarize);
        conversation.summary = conversation.summary
          ? `${conversation.summary}\n${summary}`
          : summary;
      }
      conversation.messages = conversation.messages.slice(-this.config.maxMessagesPerConversation);
    }

    // Extract topics and facts from user messages
    if (role === "user") {
      this.extractTopics(conversation, content);
      this.extractFacts(userId, content);
    }

    this.saveState();
    return message;
  }

  /**
   * End an active conversation and generate a summary.
   */
  endConversation(userId: string): ConversationEntry | null {
    const conversationId = this.activeConversations.get(userId);
    if (!conversationId) return null;

    const conversation = this.state.conversations[conversationId];
    this.activeConversations.delete(userId);

    // Generate conversation summary
    if (conversation.messages.length > 0 && !conversation.summary) {
      conversation.summary = this.summarizeMessages(conversation.messages);
    }

    // Store summary for long-term recall
    if (conversation.summary) {
      this.state.conversationSummaries.push({
        conversationId,
        userId,
        summary: conversation.summary,
        topics: conversation.topics,
        date: conversation.startedAt,
      });
    }

    // Clean up old conversations
    this.pruneConversations();
    this.saveState();

    this.emit("conversationEnded", { conversationId, userId });
    return conversation;
  }

  /**
   * Get conversation history for a user.
   */
  getConversationHistory(
    userId: string,
    limit: number = 10
  ): ConversationEntry[] {
    return Object.values(this.state.conversations)
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, limit);
  }

  /**
   * Get summarized history of past conversations.
   */
  getRecentConversationSummaries(
    userId: string,
    limit: number = 5
  ): Array<{ conversationId: string; summary: string; topics: string[]; date: number }> {
    return this.state.conversationSummaries
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.date - a.date)
      .slice(0, limit);
  }

  // ─── User Profiles ────────────────────────────────────────

  getUserProfile(userId: string): UserProfile | undefined {
    return this.state.users[userId];
  }

  private ensureUserProfile(userId: string): UserProfile {
    if (!this.state.users[userId]) {
      this.state.users[userId] = {
        userId,
        knownFacts: [],
        preferences: {
          technicalLevel: "intermediate",
          preferredStyle: "adaptive",
        },
        frequentTopics: [],
        conversationCount: 0,
        firstInteraction: Date.now(),
        lastInteraction: Date.now(),
        identity: {
          hardware: [],
          tools: [],
          goals: [],
        },
        patterns: {
          averageMessageLength: 0,
          totalMessages: 0,
          topicHistory: [],
          activeHours: new Array(24).fill(0),
        },
      };
    }
    // Migrate existing profiles that lack new fields
    const p = this.state.users[userId];
    if (!p.identity) {
      p.identity = { hardware: [], tools: [], goals: [] };
    }
    if (!p.patterns) {
      p.patterns = {
        averageMessageLength: 0,
        totalMessages: 0,
        topicHistory: [],
        activeHours: new Array(24).fill(0),
      };
    }
    return p;
  }

  /**
   * Manually record a fact about a user.
   */
  learnFact(userId: string, fact: string): void {
    const profile = this.ensureUserProfile(userId);
    if (!profile.knownFacts.includes(fact)) {
      profile.knownFacts.push(fact);
      // Cap at 100 facts per user
      if (profile.knownFacts.length > 100) {
        profile.knownFacts = profile.knownFacts.slice(-80);
      }
    }
    this.saveState();
  }

  /**
   * Record a global fact (not user-specific).
   */
  learnGlobalFact(fact: string): void {
    if (!this.state.globalFacts.includes(fact)) {
      this.state.globalFacts.push(fact);
      if (this.state.globalFacts.length > 200) {
        this.state.globalFacts = this.state.globalFacts.slice(-150);
      }
    }
    this.saveState();
  }

  // ─── Topic & Fact Extraction ───────────────────────────────

  private extractTopics(conversation: ConversationEntry, text: string): void {
    // Simple keyword-based topic extraction
    const techKeywords: Record<string, string> = {
      proxmox: "infrastructure",
      docker: "containers",
      kubernetes: "orchestration",
      llm: "AI/ML",
      model: "AI/ML",
      code: "programming",
      python: "programming",
      typescript: "programming",
      rust: "programming",
      linux: "systems",
      network: "networking",
      database: "databases",
      security: "security",
      gpu: "hardware",
      cpu: "hardware",
      ram: "hardware",
      council: "AI council",
      agent: "AI agents",
    };

    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      const topic = techKeywords[word];
      if (topic && !conversation.topics.includes(topic)) {
        conversation.topics.push(topic);
      }
    }
  }

  private extractFacts(userId: string, text: string): void {
    const profile = this.ensureUserProfile(userId);

    // Extract "I have/am/use" patterns as facts
    const factPatterns = [
      /I have (?:a |an )?(.+?)(?:\.|,|$)/gi,
      /I(?:'m| am) (?:a |an )?(.+?)(?:\.|,|$)/gi,
      /I use (.+?)(?:\.|,|$)/gi,
      /my (.+?) (?:is|has|are) (.+?)(?:\.|,|$)/gi,
      /I work (?:at|for|with|on) (.+?)(?:\.|,|$)/gi,
      /I (?:want|need|plan) to (.+?)(?:\.|,|$)/gi,
      /I (?:like|prefer|enjoy) (.+?)(?:\.|,|$)/gi,
      /I live in (.+?)(?:\.|,|$)/gi,
      /I speak (.+?)(?:\.|,|$)/gi,
    ];

    for (const pattern of factPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const fact = match[0].trim();
        if (fact.length > 10 && fact.length < 200) {
          this.learnFact(userId, fact);
        }
      }
    }

    // Extract structured identity data
    this.extractIdentity(profile, text);

    // Track interaction patterns
    this.trackPatterns(profile, text);
  }

  /**
   * Extract structured identity fields from user messages.
   * Recognizes names, roles, hardware, tools, goals, and languages.
   */
  private extractIdentity(profile: UserProfile, text: string): void {
    const lower = text.toLowerCase();

    // Name detection: "my name is X", "call me X", "I'm X,"
    // Uses case-insensitive prefix but requires capitalized name
    const nameMatch = text.match(/(?:[Mm]y name is|[Cc]all me|I'm|I am)\s+([A-Z][a-z]+)/);
    if (nameMatch && nameMatch[1].length < 50) {
      profile.identity.name = nameMatch[1];
    }

    // Role detection
    const rolePatterns = [
      /I(?:'m| am) (?:a |an )?(\w+ ?(?:developer|engineer|admin|architect|designer|researcher|student|manager|devops))/i,
      /I work as (?:a |an )?(.+?)(?:\.|,|$)/i,
    ];
    for (const pat of rolePatterns) {
      const m = text.match(pat);
      if (m) profile.identity.role = m[1].trim();
    }

    // Hardware mentions
    const hardwareKeywords = [
      "threadripper", "ryzen", "epyc", "xeon", "radeon", "nvidia", "rtx", "gtx",
      "tesla", "a100", "h100", "3090", "4090", "rx 7900", "rx 6900",
    ];
    for (const hw of hardwareKeywords) {
      if (lower.includes(hw) && !profile.identity.hardware!.includes(hw)) {
        profile.identity.hardware!.push(hw);
      }
    }

    // Tool/software mentions
    const toolKeywords = [
      "proxmox", "docker", "kubernetes", "k8s", "ansible", "terraform",
      "ollama", "vllm", "llama.cpp", "pytorch", "vscode", "neovim", "vim",
      "git", "nginx", "postgresql", "redis", "mongodb", "zfs",
    ];
    for (const tool of toolKeywords) {
      if (lower.includes(tool) && !profile.identity.tools!.includes(tool)) {
        profile.identity.tools!.push(tool);
      }
    }

    // Goal detection
    const goalMatch = text.match(/I (?:want|need|plan|hope|intend) to (.{10,100})(?:\.|,|$)/i);
    if (goalMatch && profile.identity.goals!.length < 20) {
      const goal = goalMatch[1].trim();
      if (!profile.identity.goals!.includes(goal)) {
        profile.identity.goals!.push(goal);
      }
    }

    // Language mentions
    const langMatch = text.match(/I speak (.+?)(?:\.|,|$)/i);
    if (langMatch) profile.identity.language = langMatch[1].trim();
  }

  /**
   * Track interaction patterns: message length, active hours, topic frequency.
   */
  private trackPatterns(profile: UserProfile, text: string): void {
    const patterns = profile.patterns;

    // Update average message length
    patterns.totalMessages++;
    patterns.averageMessageLength =
      patterns.averageMessageLength + (text.length - patterns.averageMessageLength) / patterns.totalMessages;

    // Track active hour
    const hour = new Date().getHours();
    if (patterns.activeHours.length === 24) {
      patterns.activeHours[hour]++;
    }

    // Update technical level based on message complexity
    const techIndicators = [
      "api", "regex", "config", "deploy", "ssh", "kernel", "compile",
      "container", "systemd", "iptables", "cron", "daemon", "socket",
      "mutex", "async", "pipeline", "inference", "embeddings", "quantize",
    ];
    const techScore = techIndicators.filter((w) => text.toLowerCase().includes(w)).length;
    if (techScore >= 3) {
      profile.preferences.technicalLevel = "expert";
    } else if (techScore >= 2) {
      profile.preferences.technicalLevel = "advanced";
    }
  }

  // ─── Summarization ─────────────────────────────────────────

  private summarizeMessages(messages: ConversationMessage[]): string {
    // Local summarization (without calling LLM — simple extractive approach)
    const userMessages = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.slice(0, 200));

    const assistantMessages = messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content.slice(0, 200));

    const parts: string[] = [];
    if (userMessages.length > 0) {
      parts.push(`User discussed: ${userMessages.slice(0, 5).join(" | ")}`);
    }
    if (assistantMessages.length > 0) {
      parts.push(`Assistant helped with: ${assistantMessages.slice(0, 3).join(" | ")}`);
    }

    return parts.join(". ") || "Brief interaction with no significant content.";
  }

  // ─── Cleanup ───────────────────────────────────────────────

  private pruneConversations(): void {
    const entries = Object.values(this.state.conversations);
    if (entries.length <= this.config.maxConversations) return;

    // Sort by last message time, keep most recent
    entries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    const toRemove = entries.slice(this.config.maxConversations);
    for (const entry of toRemove) {
      // Ensure summary exists before removing
      if (!entry.summary) {
        entry.summary = this.summarizeMessages(entry.messages);
        this.state.conversationSummaries.push({
          conversationId: entry.id,
          userId: entry.userId,
          summary: entry.summary,
          topics: entry.topics,
          date: entry.startedAt,
        });
      }
      delete this.state.conversations[entry.id];
    }
  }

  // ─── Persistence ───────────────────────────────────────────

  private loadState(): PersonalityState {
    const filePath = path.join(this.config.persistPath, "personality-state.json");
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(data) as PersonalityState;
      }
    } catch {
      // Start fresh
    }
    return {
      users: {},
      conversations: {},
      conversationSummaries: [],
      globalFacts: [],
      mood: "neutral",
      lastUpdated: Date.now(),
    };
  }

  saveState(): void {
    try {
      const dir = this.config.persistPath;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      const filePath = path.join(dir, "personality-state.json");
      this.state.lastUpdated = Date.now();
      fs.writeFileSync(filePath, JSON.stringify(this.state, null, 2), {
        encoding: "utf-8",
        mode: 0o600, // Owner-only read/write
      });
    } catch {
      // Silently fail
    }
  }

  getState(): PersonalityState {
    return this.state;
  }

  getMood(): PersonalityState["mood"] {
    return this.state.mood;
  }

  setMood(mood: PersonalityState["mood"]): void {
    this.state.mood = mood;
    this.saveState();
  }
}
