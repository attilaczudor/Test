/**
 * @module rate-limiter
 *
 * Provides a sliding-window rate limiter for the gateway.
 * Tracks request counts per client within a configurable time window
 * and periodically cleans up expired entries to prevent memory leaks.
 */

/**
 * Represents a single rate-limit tracking entry for one client.
 * @internal
 */
interface RateLimitEntry {
  /** The number of requests made within the current window. */
  count: number;
  /** The timestamp (ms) when the current rate-limit window started. */
  windowStart: number;
}

/**
 * A fixed-window rate limiter that tracks per-client request counts.
 *
 * Each client is identified by a string key. When a client's request count
 * exceeds `maxRequests` within `windowMs` milliseconds, further requests
 * are denied until the window resets. Stale entries are automatically
 * purged at twice the window interval.
 */
export class RateLimiter {
  /** Duration of the rate-limit window in milliseconds. */
  private readonly windowMs: number;

  /** Maximum number of requests allowed per window. */
  private readonly maxRequests: number;

  /** Map of client IDs to their current rate-limit tracking entries. */
  private readonly entries = new Map<string, RateLimitEntry>();

  /** Handle for the periodic cleanup timer, or null if destroyed. */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Creates a new RateLimiter.
   * @param windowMs - The length of the rate-limit window in milliseconds.
   * @param maxRequests - The maximum number of requests allowed per window per client.
   */
  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    // Schedule periodic cleanup at 2x the window duration to remove expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), windowMs * 2);
  }

  /**
   * Checks whether a client is allowed to make a request.
   *
   * If the client has no entry or their window has expired, a new window is
   * started. Otherwise the existing count is incremented.
   *
   * @param clientId - A unique identifier for the client (e.g., IP address or API key).
   * @returns An object containing:
   *   - `allowed`: whether the request should be permitted.
   *   - `remaining`: the number of requests still available in the current window.
   *   - `resetMs`: the number of milliseconds until the current window resets.
   */
  check(clientId: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const entry = this.entries.get(clientId);

    // If no entry exists or the previous window has expired, start a fresh window
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.entries.set(clientId, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetMs: this.windowMs,
      };
    }

    // Increment the request count within the current window
    entry.count++;
    const remaining = Math.max(0, this.maxRequests - entry.count);
    const resetMs = this.windowMs - (now - entry.windowStart);

    return {
      allowed: entry.count <= this.maxRequests,
      remaining,
      resetMs,
    };
  }

  /**
   * Removes expired entries from the internal map to free memory.
   * Called automatically on a timer, but can also be invoked manually.
   * @internal
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      // Delete entries whose windows have fully elapsed
      if (now - entry.windowStart >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Stops the periodic cleanup timer and clears all tracked entries.
   * Should be called when the rate limiter is no longer needed to prevent
   * memory leaks and dangling timers.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.entries.clear();
  }
}
