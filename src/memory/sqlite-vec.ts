import type { DatabaseSync } from "node:sqlite";

// NOTE: sqlite-vec is pinned to an alpha version (0.1.7-alpha.2).
// The API is unstable and breaking changes are expected before stable release.
// Monitor https://github.com/asg017/sqlite-vec for a stable release and upgrade when available.

export async function loadSqliteVecExtension(params: {
  db: DatabaseSync;
  extensionPath?: string;
}): Promise<{ ok: boolean; extensionPath?: string; error?: string }> {
  try {
    const sqliteVec = await import("sqlite-vec");
    const resolvedPath = params.extensionPath?.trim() ? params.extensionPath.trim() : undefined;
    const extensionPath = resolvedPath ?? sqliteVec.getLoadablePath();

    params.db.enableLoadExtension(true);
    if (resolvedPath) {
      params.db.loadExtension(extensionPath);
    } else {
      sqliteVec.load(params.db);
    }

    return { ok: true, extensionPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
