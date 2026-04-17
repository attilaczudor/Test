/**
 * @module csrf
 *
 * Provides CSRF (Cross-Site Request Forgery) protection for the gateway.
 * Implements token generation and validation using HMAC-SHA256 signatures
 * with time-based expiration and cryptographic nonce to prevent replay attacks.
 */

import * as crypto from "crypto";

/** Hashing algorithm used for HMAC signature generation. */
const ALGORITHM = "sha256";

/** Maximum age of a CSRF token before it expires (1 hour in milliseconds). */
const TOKEN_TTL_MS = 3600000; // 1 hour

/**
 * Handles CSRF token generation and validation.
 *
 * Tokens are base64url-encoded strings containing a session ID, timestamp,
 * random nonce, and HMAC signature. Validation checks the session binding,
 * token age, and signature integrity using timing-safe comparison.
 */
export class CsrfProtection {
  /** The secret key used for HMAC signing; must be at least 32 characters. */
  private readonly secret: string;

  /**
   * Creates a new CsrfProtection instance.
   * @param secret - The secret key for HMAC signing. Must be at least 32 characters long.
   * @throws {Error} If the secret is shorter than 32 characters.
   */
  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error("CSRF secret must be at least 32 characters");
    }
    this.secret = secret;
  }

  /**
   * Generates a new CSRF token bound to the given session.
   *
   * The token encodes the session ID, a base-36 timestamp, a random nonce,
   * and an HMAC signature, all packed into a base64url string.
   *
   * @param sessionId - The session identifier to bind the token to.
   * @returns A base64url-encoded CSRF token string.
   */
  generateToken(sessionId: string): string {
    const timestamp = Date.now().toString(16);
    const nonce = crypto.randomBytes(16).toString("hex");
    const payload = `${sessionId}:${timestamp}:${nonce}`;
    const signature = this.sign(payload);
    // Combine payload and signature, then encode as base64url for safe transport
    return Buffer.from(`${payload}:${signature}`).toString("base64url");
  }

  /**
   * Validates a CSRF token against the expected session ID.
   *
   * Checks that:
   * 1. The token can be decoded and has the correct structure (4 parts).
   * 2. The embedded session ID matches the provided session ID.
   * 3. The token has not expired (within TOKEN_TTL_MS).
   * 4. The HMAC signature is valid (using timing-safe comparison).
   *
   * @param token - The base64url-encoded CSRF token to validate.
   * @param sessionId - The expected session identifier.
   * @returns `true` if the token is valid, `false` otherwise.
   */
  validateToken(token: string, sessionId: string): boolean {
    try {
      const decoded = Buffer.from(token, "base64url").toString("utf-8");
      const parts = decoded.split(":");
      if (parts.length !== 4) {
        return false;
      }

      const [tokenSessionId, timestamp, nonce, signature] = parts;

      if (tokenSessionId !== sessionId) {
        return false;
      }

      const age = Date.now() - parseInt(timestamp, 16);
      if (age > TOKEN_TTL_MS || age < 0) {
        return false;
      }

      // Reconstruct the payload and verify the HMAC signature
      const payload = `${tokenSessionId}:${timestamp}:${nonce}`;
      const expectedSignature = this.sign(payload);

      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      // Any decoding or parsing error means the token is invalid
      return false;
    }
  }

  /**
   * Produces an HMAC-SHA256 hex digest for the given payload.
   *
   * @param payload - The string to sign.
   * @returns The hex-encoded HMAC signature.
   */
  private sign(payload: string): string {
    return crypto.createHmac(ALGORITHM, this.secret).update(payload).digest("hex");
  }
}
