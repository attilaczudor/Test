import { describe, it, expect } from "vitest";
import {
  CLARA_TRAITS,
  CLARA_SELF,
  CLARA_PERSONALITY_CONFIG,
  CLARA_CONFIG,
  ATTILA_SEED_PROFILE,
} from "./clara";

describe("Clara personality constants", () => {

  // ─── CLARA_TRAITS ─────────────────────────────────────────────

  describe("CLARA_TRAITS", () => {
    it("should have style 'friendly'", () => {
      expect(CLARA_TRAITS.style).toBe("friendly");
    });

    it("should have verbosity between 0 and 1", () => {
      expect(CLARA_TRAITS.verbosity).toBeGreaterThan(0);
      expect(CLARA_TRAITS.verbosity).toBeLessThanOrEqual(1);
    });

    it("should have proactivity between 0 and 1", () => {
      expect(CLARA_TRAITS.proactivity).toBeGreaterThan(0);
      expect(CLARA_TRAITS.proactivity).toBeLessThanOrEqual(1);
    });

    it("should mention Attila in the description", () => {
      expect(CLARA_TRAITS.description).toContain("Attila");
    });

    it("should mention Clara in the description", () => {
      expect(CLARA_TRAITS.description).toContain("Clara");
    });

    it("should have at least 4 interests", () => {
      expect(CLARA_TRAITS.interests.length).toBeGreaterThanOrEqual(4);
    });

    it("should have all preference flags set", () => {
      expect(CLARA_TRAITS.preferences.useAnalogies).toBe(true);
      expect(CLARA_TRAITS.preferences.useExamples).toBe(true);
      expect(CLARA_TRAITS.preferences.showReasoning).toBe(true);
      expect(CLARA_TRAITS.preferences.acknowledgeUncertainty).toBe(true);
    });
  });

  // ─── CLARA_SELF ───────────────────────────────────────────────

  describe("CLARA_SELF", () => {
    it("should have name 'Clara'", () => {
      expect(CLARA_SELF.name).toBe("Clara");
    });

    it("should have a version string", () => {
      expect(CLARA_SELF.version).toBeTruthy();
    });

    it("should have a birthdate in ISO format", () => {
      expect(CLARA_SELF.birthdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should have a non-empty origin describing homelab", () => {
      expect(CLARA_SELF.origin).toContain("homelab");
    });

    it("should have a non-empty personality description", () => {
      expect(CLARA_SELF.personality.length).toBeGreaterThan(10);
    });

    it("should have favorites with all fields", () => {
      expect(CLARA_SELF.favorites.topic).toBeTruthy();
      expect(CLARA_SELF.favorites.question).toBeTruthy();
      expect(CLARA_SELF.favorites.thing_she_finds_fascinating).toBeTruthy();
      expect(CLARA_SELF.favorites.hobby).toBeTruthy();
    });

    it("should have at least 2 opinions", () => {
      expect(CLARA_SELF.opinions.length).toBeGreaterThanOrEqual(2);
    });

    it("should have at least 2 self-facts", () => {
      expect(CLARA_SELF.selfFacts.length).toBeGreaterThanOrEqual(2);
    });

    it("should start with an empty thingsAboutAttila (populated at runtime)", () => {
      expect(CLARA_SELF.thingsAboutAttila).toEqual([]);
    });
  });

  // ─── ATTILA_SEED_PROFILE ──────────────────────────────────────

  describe("ATTILA_SEED_PROFILE", () => {
    it("should have userId 'attila'", () => {
      expect(ATTILA_SEED_PROFILE.userId).toBe("attila");
    });

    it("should have name 'Attila'", () => {
      expect(ATTILA_SEED_PROFILE.name).toBe("Attila");
    });

    it("should have at least 3 known facts", () => {
      expect(ATTILA_SEED_PROFILE.knownFacts.length).toBeGreaterThanOrEqual(3);
    });

    it("should include Proxmox in hardware", () => {
      const hw = ATTILA_SEED_PROFILE.identity.hardware.join(" ").toLowerCase();
      expect(hw).toContain("proxmox");
    });

    it("should include at least one goal about privacy or AI", () => {
      const goals = ATTILA_SEED_PROFILE.identity.goals.join(" ").toLowerCase();
      expect(goals).toMatch(/privacy|ai/);
    });

    it("should have technicalLevel 'expert'", () => {
      expect(ATTILA_SEED_PROFILE.preferences.technicalLevel).toBe("expert");
    });

    it("should have preferredStyle 'direct'", () => {
      expect(ATTILA_SEED_PROFILE.preferences.preferredStyle).toBe("direct");
    });
  });

  // ─── CLARA_PERSONALITY_CONFIG ─────────────────────────────────

  describe("CLARA_PERSONALITY_CONFIG", () => {
    it("should have name 'Clara'", () => {
      expect(CLARA_PERSONALITY_CONFIG.name).toBe("Clara");
    });

    it("should have a persistPath set", () => {
      expect(CLARA_PERSONALITY_CONFIG.persistPath).toBeTruthy();
    });

    it("should reference CLARA_TRAITS", () => {
      expect(CLARA_PERSONALITY_CONFIG.traits).toBe(CLARA_TRAITS);
    });

    it("should have maxConversations > 0", () => {
      expect(CLARA_PERSONALITY_CONFIG.maxConversations).toBeGreaterThan(0);
    });

    it("should have maxMessagesPerConversation > 0", () => {
      expect(CLARA_PERSONALITY_CONFIG.maxMessagesPerConversation).toBeGreaterThan(0);
    });

    it("should have summarizeAfterMs representing at least 1 hour", () => {
      expect(CLARA_PERSONALITY_CONFIG.summarizeAfterMs).toBeGreaterThanOrEqual(
        60 * 60 * 1000
      );
    });
  });

  // ─── CLARA_CONFIG ─────────────────────────────────────────────

  describe("CLARA_CONFIG", () => {
    it("should reference CLARA_PERSONALITY_CONFIG as personality", () => {
      expect(CLARA_CONFIG.personality).toBe(CLARA_PERSONALITY_CONFIG);
    });

    it("should reference CLARA_SELF as self", () => {
      expect(CLARA_CONFIG.self).toBe(CLARA_SELF);
    });

    it("should reference ATTILA_SEED_PROFILE as defaultUser", () => {
      expect(CLARA_CONFIG.defaultUser).toBe(ATTILA_SEED_PROFILE);
    });
  });
});
