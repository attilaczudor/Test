import { describe, it, expect } from "vitest";
import { CsrfProtection } from "./csrf";

describe("CsrfProtection", () => {
  const SECRET = "a".repeat(32);

  it("should reject secrets shorter than 32 chars", () => {
    expect(() => new CsrfProtection("short")).toThrow(
      "CSRF secret must be at least 32 characters"
    );
  });

  it("should generate a non-empty token", () => {
    const csrf = new CsrfProtection(SECRET);
    const token = csrf.generateToken("session-1");
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(10);
  });

  it("should validate a correct token", () => {
    const csrf = new CsrfProtection(SECRET);
    const token = csrf.generateToken("session-1");
    expect(csrf.validateToken(token, "session-1")).toBe(true);
  });

  it("should reject a token with wrong session", () => {
    const csrf = new CsrfProtection(SECRET);
    const token = csrf.generateToken("session-1");
    expect(csrf.validateToken(token, "session-2")).toBe(false);
  });

  it("should reject a tampered token", () => {
    const csrf = new CsrfProtection(SECRET);
    const token = csrf.generateToken("session-1");
    const tampered = token.slice(0, -2) + "xx";
    expect(csrf.validateToken(tampered, "session-1")).toBe(false);
  });

  it("should reject garbage input", () => {
    const csrf = new CsrfProtection(SECRET);
    expect(csrf.validateToken("not-a-real-token", "session-1")).toBe(false);
    expect(csrf.validateToken("", "session-1")).toBe(false);
  });

  it("should generate unique tokens for same session", () => {
    const csrf = new CsrfProtection(SECRET);
    const t1 = csrf.generateToken("session-1");
    const t2 = csrf.generateToken("session-1");
    expect(t1).not.toBe(t2);
    // Both should be valid
    expect(csrf.validateToken(t1, "session-1")).toBe(true);
    expect(csrf.validateToken(t2, "session-1")).toBe(true);
  });
});
