import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "./registry";
import { SkillManifest } from "../skills/types";
import * as crypto from "crypto";

// Generate a proper Ed25519 key pair for testing
function generateEd25519KeyPair(): { privateKeyHex: string; publicKeyHex: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // Export raw 32-byte keys
  const privDer = privateKey.export({ format: "der", type: "pkcs8" });
  const pubDer = publicKey.export({ format: "der", type: "spki" });
  // The raw 32-byte private key is the last 32 bytes of PKCS#8 DER
  const privateKeyHex = (privDer as Buffer).subarray(-32).toString("hex");
  // The raw 32-byte public key is the last 32 bytes of SPKI DER
  const publicKeyHex = (pubDer as Buffer).subarray(-32).toString("hex");
  return { privateKeyHex, publicKeyHex };
}

describe("SkillRegistry", () => {
  let registry: SkillRegistry;
  const keys = generateEd25519KeyPair();

  const testManifest: SkillManifest = {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    author: "tester",
    license: "MIT",
    permissions: ["FS_READ"],
    inputs: [],
    outputs: [],
  };

  beforeEach(() => {
    registry = new SkillRegistry({
      registryUrl: "https://registry.openclaw.dev",
      requireSigned: true,
    });
  });

  describe("publish", () => {
    it("should publish a skill entry", () => {
      const entry = registry.publish(
        testManifest,
        "tester",
        keys.privateKeyHex,
        keys.publicKeyHex
      );

      expect(entry.manifest.name).toBe("test-skill");
      expect(entry.publisher).toBe("tester");
      expect(entry.signature).toBeTruthy();
    });

    it("should mark verified when key is trusted", () => {
      registry.addTrustedKey(keys.publicKeyHex);

      const entry = registry.publish(
        testManifest,
        "tester",
        keys.privateKeyHex,
        keys.publicKeyHex
      );

      expect(entry.verified).toBe(true);
    });

    it("should mark unverified when key is not trusted", () => {
      const entry = registry.publish(
        testManifest,
        "unknown-publisher",
        keys.privateKeyHex,
        keys.publicKeyHex
      );

      expect(entry.verified).toBe(false);
    });
  });

  describe("verify", () => {
    it("should verify a validly signed manifest", () => {
      const entry = registry.publish(
        testManifest,
        "tester",
        keys.privateKeyHex,
        keys.publicKeyHex
      );

      const valid = registry.verify(entry.manifest, keys.publicKeyHex);
      expect(valid).toBe(true);
    });

    it("should reject a tampered manifest", () => {
      const entry = registry.publish(
        testManifest,
        "tester",
        keys.privateKeyHex,
        keys.publicKeyHex
      );

      const tampered = {
        ...entry.manifest,
        description: "HACKED",
      };

      const valid = registry.verify(tampered, keys.publicKeyHex);
      expect(valid).toBe(false);
    });

    it("should reject without signature", () => {
      const unsigned = { ...testManifest, signature: undefined };
      expect(registry.verify(unsigned, keys.publicKeyHex)).toBe(false);
    });
  });

  describe("install", () => {
    it("should install a valid signed skill", () => {
      registry.publish(testManifest, "tester", keys.privateKeyHex, keys.publicKeyHex);

      const result = registry.install("test-skill", "1.0.0");
      expect(result).not.toBeNull();
      expect(result!.manifest.name).toBe("test-skill");
    });

    it("should return null for non-existent skill", () => {
      expect(registry.install("nonexistent", "1.0.0")).toBeNull();
    });

    it("should increment download count", () => {
      registry.publish(testManifest, "tester", keys.privateKeyHex, keys.publicKeyHex);

      registry.install("test-skill", "1.0.0");
      registry.install("test-skill", "1.0.0");

      const entries = registry.list();
      expect(entries[0].downloads).toBe(2);
    });

    it("should reject tampered signatures in signed-required mode", () => {
      // Publish with one key pair, but store a different public key
      const otherKeys = generateEd25519KeyPair();
      const freshRegistry = new SkillRegistry({
        registryUrl: "https://registry.openclaw.dev",
        requireSigned: true,
      });

      // Sign with keys.privateKeyHex but record otherKeys.publicKeyHex
      freshRegistry.publish(testManifest, "tester", keys.privateKeyHex, otherKeys.publicKeyHex);
      // Verification will fail because the stored publicKey doesn't match the signer
      const result = freshRegistry.install("test-skill", "1.0.0");
      expect(result).toBeNull();
    });
  });

  describe("search", () => {
    it("should find skills by name", () => {
      registry.publish(testManifest, "tester", keys.privateKeyHex, keys.publicKeyHex);
      registry.publish(
        { ...testManifest, name: "web-fetcher", version: "1.0.0", description: "Fetch web pages" },
        "tester",
        keys.privateKeyHex,
        keys.publicKeyHex
      );

      const results = registry.search("web-fetcher");
      expect(results).toHaveLength(1);
      expect(results[0].manifest.name).toBe("web-fetcher");
    });

    it("should find skills by description", () => {
      registry.publish(testManifest, "tester", keys.privateKeyHex, keys.publicKeyHex);

      const results = registry.search("test skill");
      expect(results).toHaveLength(1);
    });
  });

  describe("trusted keys", () => {
    it("should add and remove trusted keys", () => {
      registry.addTrustedKey(keys.publicKeyHex);
      const entry1 = registry.publish(
        { ...testManifest, version: "1.0.0" },
        "tester",
        keys.privateKeyHex,
        keys.publicKeyHex
      );
      expect(entry1.verified).toBe(true);

      registry.removeTrustedKey(keys.publicKeyHex);
      const entry2 = registry.publish(
        { ...testManifest, version: "2.0.0" },
        "tester",
        keys.privateKeyHex,
        keys.publicKeyHex
      );
      expect(entry2.verified).toBe(false);
    });
  });
});
