export async function readResponseWithLimit(
  res: Response,
  maxBytes: number,
  opts?: {
    onOverflow?: (params: { size: number; maxBytes: number; res: Response }) => Error;
  },
): Promise<Buffer> {
  const onOverflow =
    opts?.onOverflow ??
    ((params: { size: number; maxBytes: number }) =>
      new Error(`Content too large: ${params.size} bytes (limit: ${params.maxBytes} bytes)`));

  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    const fallback = Buffer.from(await res.arrayBuffer());
    if (fallback.length > maxBytes) {
      throw onOverflow({ size: fallback.length, maxBytes, res });
    }
    return fallback;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value?.length) {
        total += value.length;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Best-effort cancel — reader may already be closed
          }
          throw onOverflow({ size: total, maxBytes, res });
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Best-effort release — lock may already be released
    }
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}
