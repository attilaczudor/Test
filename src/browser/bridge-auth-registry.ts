/** @module browser/bridge-auth-registry - In-process registry for loopback bridge server auth credentials keyed by port. */

type BridgeAuth = {
  token?: string;
  password?: string;
};

// In-process registry for loopback-only bridge servers that require auth, but
// are addressed via dynamic ephemeral ports (e.g. sandbox browser bridge).
const authByPort = new Map<number, BridgeAuth>();

/** Stores auth credentials for a given bridge server port. @param port - The port number. @param auth - Token and/or password to associate. */
export function setBridgeAuthForPort(port: number, auth: BridgeAuth): void {
  if (!Number.isFinite(port) || port <= 0) {
    return;
  }
  const token = typeof auth.token === "string" ? auth.token.trim() : "";
  const password = typeof auth.password === "string" ? auth.password.trim() : "";
  authByPort.set(port, {
    token: token || undefined,
    password: password || undefined,
  });
}

/** Retrieves stored auth credentials for a bridge server port. @param port - The port number. @returns The auth object or undefined if not found. */
export function getBridgeAuthForPort(port: number): BridgeAuth | undefined {
  if (!Number.isFinite(port) || port <= 0) {
    return undefined;
  }
  return authByPort.get(port);
}

/** Removes stored auth credentials for a bridge server port. @param port - The port number. */
export function deleteBridgeAuthForPort(port: number): void {
  if (!Number.isFinite(port) || port <= 0) {
    return;
  }
  authByPort.delete(port);
}
