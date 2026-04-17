/**
 * Sandbox Execution Types
 *
 * Defines the configuration and request/result shapes for the
 * sandboxed command execution layer. Supports WASM, Docker,
 * and nsjail runtimes with configurable resource limits.
 */

/** Top-level sandbox configuration. */
export interface SandboxConfig {
  /** Whether sandboxing is active. */
  enabled: boolean;
  /** Isolation runtime to use. `"none"` disables isolation. */
  runtime: "wasm" | "docker" | "nsjail" | "none";
  /** Allow outbound network access from the sandbox. */
  allowNetwork: boolean;
  /** Maximum memory the sandbox may consume (MB). */
  maxMemoryMb: number;
  /** Maximum CPU time allowed (seconds). */
  maxCpuSeconds: number;
  /** Filesystem paths the sandbox may access. */
  allowedPaths: string[];
}

/** A command to execute inside the sandbox. */
export interface ExecutionRequest {
  /** Unique request identifier for correlation. */
  id: string;
  /** The command to execute (binary name or path). */
  command: string;
  /** Command-line arguments. */
  args?: string[];
  /** Data piped to the command's stdin. */
  stdin?: string;
  /** Environment variables visible inside the sandbox. */
  env?: Record<string, string>;
  /** Working directory for the command. */
  cwd?: string;
  /** Hard timeout in milliseconds (overrides global default). */
  timeoutMs?: number;
}

/** Result returned after a sandboxed command completes (or is killed). */
export interface ExecutionResult {
  /** Matches the originating {@link ExecutionRequest.id}. */
  id: string;
  /** Process exit code (0 = success). */
  exitCode: number;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /** Wall-clock execution time in milliseconds. */
  durationMs: number;
  /** Whether the process was killed (timeout or resource limit). */
  killed: boolean;
  /** Reason the process was killed, if applicable. */
  killedReason?: string;
}

/** Low-level resource limits enforced by the sandbox runtime. */
export interface SandboxLimits {
  /** Maximum resident memory in bytes. */
  maxMemoryBytes: number;
  /** Maximum CPU time in milliseconds. */
  maxCpuMs: number;
  /** Whether outbound networking is permitted. */
  allowNetwork: boolean;
  /** Paths with read+write access. */
  allowedPaths: string[];
  /** Paths with read-only access. */
  readOnlyPaths: string[];
}
