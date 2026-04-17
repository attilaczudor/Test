import { describe, it, expect, beforeEach } from "vitest";
import { PersonalityEngine } from "./personality";
import { PersonalityConfig } from "./types";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

describe("Personality Engine", () => {
  let personality: PersonalityEngine;
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `personality-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    personality = new PersonalityEngine({
      persistPath: tempDir,
      name: "TestClaw",
      traits: {
        style: "technical",
        verbosity: 0.6,
        proactivity: 0.7,
        description: "I am a test AI system.",
        interests: ["Programming", "AI/ML"],
        preferences: {
          useAnalogies: true,
          useExamples: true,
          showReasoning: true,
          acknowledgeUncertainty: true,
        },
      },
      maxConversations: 100,
      maxMessagesPerConversation: 50,
      summarizeAfterMs: 86400000,
    });
  });

  describe("System Prompt Generation", () => {
    it("should generate a personality-aware system prompt", () => {
      const prompt = personality.buildSystemPrompt();
      expect(prompt).toContain("TestClaw");
      expect(prompt).toContain("I am a test AI system.");
      expect(prompt).toContain("Programming");
    });

    it("should include user context when userId provided", () => {
      // Add some history first
      personality.learnFact("user-1", "I am a backend developer");
      const prompt = personality.buildSystemPrompt("user-1");
      expect(prompt).toContain("backend developer");
    });

    it("should include global facts", () => {
      personality.learnGlobalFact("The system has 256GB of RAM");
      const prompt = personality.buildSystemPrompt();
      expect(prompt).toContain("256GB");
    });
  });

  describe("Conversation Management", () => {
    it("should start a new conversation", () => {
      const conv = personality.startConversation("user-1");
      expect(conv.id).toBeTruthy();
      expect(conv.userId).toBe("user-1");
      expect(conv.messages).toHaveLength(0);
    });

    it("should return existing active conversation", () => {
      const conv1 = personality.startConversation("user-1");
      const conv2 = personality.startConversation("user-1");
      expect(conv1.id).toBe(conv2.id);
    });

    it("should add messages to conversation", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "Hello, how are you?");
      personality.addMessage("user-1", "assistant", "I'm doing great!");

      const history = personality.getConversationHistory("user-1");
      expect(history).toHaveLength(1);
      expect(history[0].messages).toHaveLength(2);
    });

    it("should auto-start conversation when adding message", () => {
      personality.addMessage("user-2", "user", "Hi there");
      const history = personality.getConversationHistory("user-2");
      expect(history).toHaveLength(1);
    });

    it("should end a conversation and create summary", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "Can you help with Proxmox?");
      personality.addMessage("user-1", "assistant", "Sure, I can help with Proxmox setup.");

      const ended = personality.endConversation("user-1");
      expect(ended).not.toBeNull();
      expect(ended!.summary).toBeTruthy();
    });

    it("should return null when ending non-existent conversation", () => {
      const ended = personality.endConversation("nonexistent");
      expect(ended).toBeNull();
    });

    it("should extract topics from user messages", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "I need help with proxmox and docker containers");

      const history = personality.getConversationHistory("user-1");
      expect(history[0].topics).toContain("infrastructure");
      expect(history[0].topics).toContain("containers");
    });
  });

  describe("User Profiles", () => {
    it("should create user profile on first interaction", () => {
      personality.startConversation("user-1");
      const profile = personality.getUserProfile("user-1");
      expect(profile).toBeDefined();
      expect(profile!.conversationCount).toBe(1);
    });

    it("should learn facts about users", () => {
      personality.learnFact("user-1", "Uses Threadripper processor");
      const profile = personality.getUserProfile("user-1");
      expect(profile).toBeDefined();
      expect(profile!.knownFacts).toContain("Uses Threadripper processor");
    });

    it("should not duplicate facts", () => {
      personality.learnFact("user-1", "Has 256GB RAM");
      personality.learnFact("user-1", "Has 256GB RAM");
      const profile = personality.getUserProfile("user-1");
      expect(profile!.knownFacts.filter((f) => f === "Has 256GB RAM")).toHaveLength(1);
    });

    it("should return undefined for unknown user", () => {
      expect(personality.getUserProfile("unknown")).toBeUndefined();
    });
  });

  describe("Global Facts", () => {
    it("should store global facts", () => {
      personality.learnGlobalFact("Running on Proxmox 8.x");
      const state = personality.getState();
      expect(state.globalFacts).toContain("Running on Proxmox 8.x");
    });

    it("should not duplicate global facts", () => {
      personality.learnGlobalFact("Test fact");
      personality.learnGlobalFact("Test fact");
      const state = personality.getState();
      expect(state.globalFacts.filter((f) => f === "Test fact")).toHaveLength(1);
    });
  });

  describe("Mood", () => {
    it("should default to neutral mood", () => {
      expect(personality.getMood()).toBe("neutral");
    });

    it("should update mood", () => {
      personality.setMood("engaged");
      expect(personality.getMood()).toBe("engaged");
    });
  });

  describe("Persistence", () => {
    it("should save and load state", () => {
      personality.learnGlobalFact("Persistent fact");
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "Test message");
      personality.saveState();

      const stateFile = path.join(tempDir, "personality-state.json");
      expect(fs.existsSync(stateFile)).toBe(true);

      // Create new personality that loads from disk
      const reloaded = new PersonalityEngine({
        persistPath: tempDir,
        name: "TestClaw",
        traits: {
          style: "technical",
          verbosity: 0.6,
          proactivity: 0.7,
          description: "I am a test AI system.",
          interests: [],
          preferences: {
            useAnalogies: true,
            useExamples: true,
            showReasoning: true,
            acknowledgeUncertainty: true,
          },
        },
        maxConversations: 100,
        maxMessagesPerConversation: 50,
        summarizeAfterMs: 86400000,
      });

      expect(reloaded.getState().globalFacts).toContain("Persistent fact");
    });
  });

  describe("Conversation Summaries", () => {
    it("should get recent conversation summaries for a user", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "Help with Kubernetes setup");
      personality.addMessage("user-1", "assistant", "Sure, here's how to set up K8s...");
      personality.endConversation("user-1");

      const summaries = personality.getRecentConversationSummaries("user-1", 5);
      expect(summaries.length).toBeGreaterThan(0);
      expect(summaries[0].summary).toBeTruthy();
    });
  });

  describe("Deep User Knowledge", () => {
    it("should extract user name from messages", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "My name is Attila and I need help with my server.");

      const profile = personality.getUserProfile("user-1");
      expect(profile).toBeDefined();
      expect(profile!.identity.name).toBe("Attila");
    });

    it("should extract hardware mentions", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "I have a Threadripper with a Radeon GPU and 256GB RAM.");

      const profile = personality.getUserProfile("user-1");
      expect(profile!.identity.hardware).toContain("threadripper");
      expect(profile!.identity.hardware).toContain("radeon");
    });

    it("should extract tool/software mentions", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "I use Proxmox and Docker for my homelab, with Ollama for LLMs.");

      const profile = personality.getUserProfile("user-1");
      expect(profile!.identity.tools).toContain("proxmox");
      expect(profile!.identity.tools).toContain("docker");
      expect(profile!.identity.tools).toContain("ollama");
    });

    it("should extract goals from user messages", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "I want to build a fully autonomous AI system on my homelab.");

      const profile = personality.getUserProfile("user-1");
      expect(profile!.identity.goals!.length).toBeGreaterThan(0);
      expect(profile!.identity.goals![0]).toContain("autonomous AI");
    });

    it("should track interaction patterns", () => {
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "First message about containers.");
      personality.addMessage("user-1", "user", "Second message about kubernetes.");

      const profile = personality.getUserProfile("user-1");
      expect(profile!.patterns.totalMessages).toBe(2);
      expect(profile!.patterns.averageMessageLength).toBeGreaterThan(0);
    });

    it("should detect expert technical level from message content", () => {
      personality.startConversation("user-1");
      personality.addMessage(
        "user-1", "user",
        "I need to deploy the inference pipeline in a container with systemd, configure the kernel cron daemon, and set up the API endpoint."
      );

      const profile = personality.getUserProfile("user-1");
      expect(profile!.preferences.technicalLevel).toBe("expert");
    });

    it("should include identity in system prompt", () => {
      personality.learnFact("user-1", "Uses Proxmox");
      personality.startConversation("user-1");
      personality.addMessage("user-1", "user", "My name is Attila. I use Docker and Proxmox for everything.");

      const prompt = personality.buildSystemPrompt("user-1");
      expect(prompt).toContain("Attila");
      expect(prompt).toContain("docker");
      expect(prompt).toContain("proxmox");
    });

    it("should migrate old profiles without identity/patterns fields", () => {
      // Simulate an old profile by directly manipulating state
      const state = personality.getState();
      state.users["old-user"] = {
        userId: "old-user",
        knownFacts: ["likes coffee"],
        preferences: { technicalLevel: "intermediate", preferredStyle: "adaptive" },
        frequentTopics: [],
        conversationCount: 5,
        firstInteraction: Date.now() - 86400000,
        lastInteraction: Date.now(),
      } as any;

      // ensureUserProfile is called via startConversation
      personality.startConversation("old-user");
      const profile = personality.getUserProfile("old-user");
      expect(profile!.identity).toBeDefined();
      expect(profile!.patterns).toBeDefined();
      expect(profile!.patterns.activeHours).toHaveLength(24);
    });
  });
});
