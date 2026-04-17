/**
 * @module agents/announce-idempotency
 *
 * Utilities for generating idempotency keys for announce-style queue messages.
 *
 * These keys prevent duplicate processing when a child session run announces
 * its result back to the parent queue. The versioned ID format
 * (`v1:<sessionKey>:<runId>`) guarantees uniqueness per child run, while the
 * legacy fallback (`legacy:<sessionKey>:<enqueuedAt>`) covers older queue
 * items that predate the announce-ID system.
 */

/**
 * Parameters for building an announce ID from a child run.
 *
 * @property childSessionKey - The session key of the child that produced the result.
 * @property childRunId      - The unique run identifier within that child session.
 */
export type AnnounceIdFromChildRunParams = {
  childSessionKey: string;
  childRunId: string;
};

/**
 * Builds a versioned announce ID string from a child run's session key and run ID.
 *
 * @param params - The child session key and run ID.
 * @returns A string in the format `v1:<childSessionKey>:<childRunId>`.
 */
export function buildAnnounceIdFromChildRun(params: AnnounceIdFromChildRunParams): string {
  return `v1:${params.childSessionKey}:${params.childRunId}`;
}

/**
 * Wraps an announce ID into a namespaced idempotency key suitable for
 * deduplication in a queue or store.
 *
 * @param announceId - The announce ID to wrap.
 * @returns A string in the format `announce:<announceId>`.
 */
export function buildAnnounceIdempotencyKey(announceId: string): string {
  return `announce:${announceId}`;
}

/**
 * Resolves the effective announce ID for a queue item.
 *
 * If the queue item already carries an `announceId`, that value is used.
 * Otherwise a backward-compatible fallback is generated from the session key
 * and enqueue timestamp.
 *
 * @param params - Object with optional `announceId`, required `sessionKey` and `enqueuedAt`.
 * @returns The resolved announce ID string.
 */
export function resolveQueueAnnounceId(params: {
  announceId?: string;
  sessionKey: string;
  enqueuedAt: number;
}): string {
  const announceId = params.announceId?.trim();
  if (announceId) {
    return announceId;
  }
  // Backward-compatible fallback for queue items that predate announceId.
  return `legacy:${params.sessionKey}:${params.enqueuedAt}`;
}
