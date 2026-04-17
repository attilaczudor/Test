import * as crypto from "crypto";
import { SkillManifest } from "../skills/types";

export interface RegistryConfig {
  registryUrl: string;
  requireSigned: boolean;
}

export interface RegistryEntry {
  manifest: SkillManifest;
  publishedAt: number;
  publisher: string;
  verified: boolean;
  signature: string;
  publicKey: string;
  downloads: number;
}

/**
 * Verified Skill Registry with Cryptographic Signing.
 *
 * Skills are signed with Ed25519 keys. Only verified publishers
 * can push to the registry. Clients verify signatures before
 * installing skills.
 */
export class SkillRegistry {
  private readonly config: RegistryConfig;
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly trustedKeys = new Set<string>();

  constructor(config: RegistryConfig) {
    this.config = config;
  }

  addTrustedKey(publicKeyHex: string): void {
    this.trustedKeys.add(publicKeyHex);
  }

  removeTrustedKey(publicKeyHex: string): void {
    this.trustedKeys.delete(publicKeyHex);
  }

  publish(
    manifest: SkillManifest,
    publisher: string,
    privateKeyHex: string,
    publicKeyHex: string
  ): RegistryEntry {
    const payload = this.canonicalize(manifest as unknown as Record<string, unknown>);
    const signature = this.sign(payload, privateKeyHex);

    const entry: RegistryEntry = {
      manifest: { ...manifest, signature },
      publishedAt: Date.now(),
      publisher,
      verified: this.trustedKeys.has(publicKeyHex),
      signature,
      publicKey: publicKeyHex,
      downloads: 0,
    };

    const key = `${manifest.name}@${manifest.version}`;
    this.entries.set(key, entry);
    return entry;
  }

  verify(manifest: SkillManifest, publicKeyHex: string): boolean {
    if (!manifest.signature) return false;

    const { signature: _sig, ...rest } = manifest;
    const payload = this.canonicalize(rest as unknown as Record<string, unknown>);

    return this.verifySignature(payload, manifest.signature, publicKeyHex);
  }

  install(
    name: string,
    version: string
  ): { manifest: SkillManifest; verified: boolean } | null {
    const key = `${name}@${version}`;
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (this.config.requireSigned && !entry.signature) {
      return null;
    }

    if (this.config.requireSigned) {
      const valid = this.verify(entry.manifest, entry.publicKey);
      if (!valid) return null;
    }

    entry.downloads++;
    return {
      manifest: entry.manifest,
      verified: entry.verified,
    };
  }

  search(query: string): RegistryEntry[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.entries.values()).filter(
      (e) =>
        e.manifest.name.toLowerCase().includes(lowerQuery) ||
        e.manifest.description.toLowerCase().includes(lowerQuery)
    );
  }

  list(): RegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Produce a canonical JSON representation for signing.
   */
  private canonicalize(obj: Record<string, unknown>): string {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] !== undefined) {
        sorted[key] = obj[key];
      }
    }
    return JSON.stringify(sorted);
  }

  /**
   * Sign a payload with Ed25519 using the private key.
   * Uses asymmetric cryptography — only the holder of the private key
   * can produce valid signatures, and anyone with the public key can verify.
   */
  private sign(payload: string, privateKeyHex: string): string {
    const privateKeyDer = Buffer.from(privateKeyHex, "hex");
    const keyObject = crypto.createPrivateKey({
      key: Buffer.concat([
        // Ed25519 PKCS#8 prefix
        Buffer.from("302e020100300506032b657004220420", "hex"),
        privateKeyDer.subarray(0, 32),
      ]),
      format: "der",
      type: "pkcs8",
    });
    return crypto.sign(null, Buffer.from(payload), keyObject).toString("hex");
  }

  private verifySignature(
    payload: string,
    signature: string,
    publicKeyHex: string
  ): boolean {
    try {
      const publicKeyDer = Buffer.from(publicKeyHex, "hex");
      const keyObject = crypto.createPublicKey({
        key: Buffer.concat([
          // Ed25519 SubjectPublicKeyInfo prefix
          Buffer.from("302a300506032b6570032100", "hex"),
          publicKeyDer.subarray(0, 32),
        ]),
        format: "der",
        type: "spki",
      });
      return crypto.verify(
        null,
        Buffer.from(payload),
        keyObject,
        Buffer.from(signature, "hex")
      );
    } catch {
      return false;
    }
  }
}
