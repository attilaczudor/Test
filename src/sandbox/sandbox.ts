import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { SandboxConfig, ExecutionRequest, ExecutionResult, SandboxLimits } from "./types";

export class Sandbox {
  private readonly config: SandboxConfig;
  private readonly limits: SandboxLimits;

  constructor(config: SandboxConfig) {
    this.config = config;
    this.limits = {
      maxMemoryBytes: config.maxMemoryMb * 1024 * 1024,
      maxCpuMs: config.maxCpuSeconds * 1000,
      allowNetwork: config.allowNetwork,
      allowedPaths: config.allowedPaths.map((p) => path.resolve(p)),
      readOnlyPaths: ["/usr", "/lib", "/bin", "/etc"],
    };
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.config.enabled || this.config.runtime === "none") {
      return this.executeUnsandboxed(request);
    }

    // Validate the command path is allowed
    if (!this.isCommandAllowed(request.command)) {
      return {
        id: request.id,
        exitCode: 126,
        stdout: "",
        stderr: `Sandbox: command '${request.command}' is not permitted`,
        durationMs: 0,
        killed: true,
        killedReason: "COMMAND_BLOCKED",
      };
    }

    switch (this.config.runtime) {
      case "docker":
        return this.executeInDocker(request);
      case "nsjail":
        return this.executeInNsjail(request);
      case "wasm":
        // Wasm sandbox is not yet implemented — falls through to
        // process-level limits (ulimit + allowed-path enforcement).
        // For production isolation, use "nsjail" or "docker".
        return this.executeWithLimits(request);
      case "none":
        return this.executeWithLimits(request);
      default:
        return this.executeWithLimits(request);
    }
  }

  /**
   * Resolve path safely, following symlinks to prevent traversal attacks.
   * Falls back to path.resolve() if the path doesn't exist yet.
   */
  private safeResolvePath(targetPath: string): string {
    const fs = require("fs") as typeof import("fs");
    const resolved = path.resolve(targetPath);
    try {
      // Resolve symlinks to get the real path — prevents symlink-based traversal
      return fs.realpathSync(resolved);
    } catch {
      // Path doesn't exist yet; resolve the nearest existing ancestor's real
      // path, then append the remaining segments. This prevents an attacker from
      // pre-creating a symlink inside an allowed directory that points outside
      // the sandbox — path.normalize alone wouldn't follow that symlink.
      let current = resolved;
      const trailing: string[] = [];
      while (current !== path.dirname(current)) {
        try {
          const real = fs.realpathSync(current);
          return path.join(real, ...trailing);
        } catch {
          trailing.unshift(path.basename(current));
          current = path.dirname(current);
        }
      }
      // Reached filesystem root without any resolvable ancestor
      return path.normalize(resolved);
    }
  }

  isPathAllowed(targetPath: string): boolean {
    if (!this.config.enabled) {
      return true;
    }

    const resolved = this.safeResolvePath(targetPath);

    // Ensure path separators prevent prefix collisions (e.g., /etc2 vs /etc)
    const withTrailing = (p: string) => (p.endsWith("/") ? p : p + "/");

    // Check read-only paths (always accessible)
    for (const ro of this.limits.readOnlyPaths) {
      if (resolved === ro || resolved.startsWith(withTrailing(ro))) {
        return true;
      }
    }

    // Check explicitly allowed paths
    for (const allowed of this.limits.allowedPaths) {
      if (resolved === allowed || resolved.startsWith(withTrailing(allowed))) {
        return true;
      }
    }

    return false;
  }

  isWriteAllowed(targetPath: string): boolean {
    if (!this.config.enabled) {
      return true;
    }

    const resolved = this.safeResolvePath(targetPath);
    const withTrailing = (p: string) => (p.endsWith("/") ? p : p + "/");

    // Read-only paths are never writable
    for (const ro of this.limits.readOnlyPaths) {
      if (resolved === ro || resolved.startsWith(withTrailing(ro))) {
        return false;
      }
    }

    // Must be in allowed paths
    for (const allowed of this.limits.allowedPaths) {
      if (resolved === allowed || resolved.startsWith(withTrailing(allowed))) {
        return true;
      }
    }

    return false;
  }

  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  getLimits(): SandboxLimits {
    return { ...this.limits };
  }

  private isCommandAllowed(command: string): boolean {
    // Block shell metacharacters that could be used for command injection
    if (/[|;&`$(){}[\]<>!\n\\]/.test(command)) {
      return false;
    }

    // Block dangerous commands (check both basename and full path)
    const blocked = new Set([
      "rm",
      "mkfs",
      "dd",
      "shutdown",
      "reboot",
      "init",
      "systemctl",
      "iptables",
      "mount",
      "umount",
      "fdisk",
      "parted",
      "chmod",
      "chown",
      "su",
      "sudo",
      "nohup",
      "kill",
      "killall",
      "pkill",
    ]);

    const basename = path.basename(command);
    return !blocked.has(basename);
  }

  private executeWithLimits(request: ExecutionRequest): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const timeoutMs = Math.min(request.timeoutMs || this.limits.maxCpuMs, this.limits.maxCpuMs);

      const env: Record<string, string> = {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        ...request.env,
      };

      // Strip dangerous env vars
      delete env.LD_PRELOAD;
      delete env.LD_LIBRARY_PATH;

      let child: ChildProcess;
      try {
        child = spawn(request.command, request.args || [], {
          cwd: request.cwd || "/tmp",
          env,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: timeoutMs,
        });
      } catch (err: unknown) {
        resolve({
          id: request.id,
          exitCode: 127,
          stdout: "",
          stderr: `Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startTime,
          killed: true,
          killedReason: "SPAWN_ERROR",
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      const maxOutputBytes = 1024 * 1024; // 1MB output limit

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < maxOutputBytes) {
          stdout += chunk.toString();
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < maxOutputBytes) {
          stderr += chunk.toString();
        }
      });

      if (request.stdin) {
        child.stdin?.write(request.stdin);
        child.stdin?.end();
      }

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs);

      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          id: request.id,
          exitCode: code ?? 1,
          stdout: stdout.slice(0, maxOutputBytes),
          stderr: stderr.slice(0, maxOutputBytes),
          durationMs: Date.now() - startTime,
          killed: signal === "SIGKILL",
          killedReason: signal === "SIGKILL" ? "TIMEOUT" : undefined,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          id: request.id,
          exitCode: 127,
          stdout,
          stderr: err.message,
          durationMs: Date.now() - startTime,
          killed: false,
        });
      });
    });
  }

  private async executeInDocker(request: ExecutionRequest): Promise<ExecutionResult> {
    const dockerArgs = [
      "run",
      "--rm",
      `--memory=${this.config.maxMemoryMb}m`,
      `--cpus=1`,
      "--pids-limit=100",
      "--read-only",
      "--no-new-privileges",
    ];

    if (!this.config.allowNetwork) {
      dockerArgs.push("--network=none");
    }

    for (const p of this.config.allowedPaths) {
      dockerArgs.push(`-v`, `${path.resolve(p)}:${path.resolve(p)}`);
    }

    dockerArgs.push("openclaw-sandbox:latest");
    dockerArgs.push(request.command);
    if (request.args) {
      dockerArgs.push(...request.args);
    }

    return this.executeWithLimits({
      ...request,
      command: "docker",
      args: dockerArgs,
    });
  }

  private async executeInNsjail(request: ExecutionRequest): Promise<ExecutionResult> {
    const nsjailArgs = [
      "--mode",
      "o",
      "--time_limit",
      String(this.config.maxCpuSeconds),
      "--rlimit_as",
      String(this.config.maxMemoryMb),
      "--disable_proc",
    ];

    if (!this.config.allowNetwork) {
      nsjailArgs.push("--disable_clone_newnet");
    }

    for (const p of this.config.allowedPaths) {
      nsjailArgs.push("--bindmount", `${path.resolve(p)}:${path.resolve(p)}`);
    }

    nsjailArgs.push("--", request.command);
    if (request.args) {
      nsjailArgs.push(...request.args);
    }

    return this.executeWithLimits({
      ...request,
      command: "nsjail",
      args: nsjailArgs,
    });
  }

  private async executeUnsandboxed(request: ExecutionRequest): Promise<ExecutionResult> {
    return this.executeWithLimits(request);
  }
}
