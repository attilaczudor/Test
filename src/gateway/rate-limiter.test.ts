import { describe, it, expect, afterEach, vi } from "vitest";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow requests under the limit", () => {
    const limiter = new RateLimiter(60000, 5);
    for (let i = 0; i < 5; i++) {
      const result = limiter.check("client-1");
      expect(result.allowed).toBe(true);
    }
    limiter.destroy();
  });

  it("should block requests over the limit", () => {
    const limiter = new RateLimiter(60000, 3);
    limiter.check("client-1");
    limiter.check("client-1");
    limiter.check("client-1");
    const result = limiter.check("client-1");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    limiter.destroy();
  });

  it("should track clients independently", () => {
    const limiter = new RateLimiter(60000, 2);
    limiter.check("client-1");
    limiter.check("client-1");
    const blocked = limiter.check("client-1");
    expect(blocked.allowed).toBe(false);

    const otherClient = limiter.check("client-2");
    expect(otherClient.allowed).toBe(true);
    limiter.destroy();
  });

  it("should report remaining requests", () => {
    const limiter = new RateLimiter(60000, 5);
    const r1 = limiter.check("client-1");
    expect(r1.remaining).toBe(4);
    const r2 = limiter.check("client-1");
    expect(r2.remaining).toBe(3);
    limiter.destroy();
  });

  it("should reset after window expires", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(1000, 1);

    const r1 = limiter.check("client-1");
    expect(r1.allowed).toBe(true);

    const r2 = limiter.check("client-1");
    expect(r2.allowed).toBe(false);

    vi.advanceTimersByTime(1001);

    const r3 = limiter.check("client-1");
    expect(r3.allowed).toBe(true);
    limiter.destroy();
  });
});
