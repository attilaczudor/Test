import { describe, it, expect } from "vitest";
import { Sandbox } from "./sandbox";

describe("Sandbox", () => {
  describe("path validation", () => {
    const sandbox = new Sandbox({
      enabled: true,
      runtime: "wasm",
      allowNetwork: false,
      maxMemoryMb: 512,
      maxCpuSeconds: 30,
      allowedPaths: ["/home/user/project"],
    });

    it("should allow reads from allowed paths", () => {
      expect(sandbox.isPathAllowed("/home/user/project/src/main.ts")).toBe(
        true
      );
    });

    it("should allow reads from read-only system paths", () => {
      expect(sandbox.isPathAllowed("/usr/bin/node")).toBe(true);
      expect(sandbox.isPathAllowed("/lib/x86_64-linux-gnu/libc.so")).toBe(
        true
      );
    });

    it("should deny reads from non-allowed paths", () => {
      expect(sandbox.isPathAllowed("/root/.ssh/id_rsa")).toBe(false);
      expect(sandbox.isPathAllowed("/var/secret/data")).toBe(false);
    });

    it("should deny writes to read-only paths", () => {
      expect(sandbox.isWriteAllowed("/usr/bin/malicious")).toBe(false);
    });

    it("should allow writes to allowed paths", () => {
      expect(sandbox.isWriteAllowed("/home/user/project/output.txt")).toBe(
        true
      );
    });

    it("should deny writes to non-allowed paths", () => {
      expect(sandbox.isWriteAllowed("/tmp/escape")).toBe(false);
    });
  });

  describe("disabled sandbox", () => {
    const sandbox = new Sandbox({
      enabled: false,
      runtime: "none",
      allowNetwork: true,
      maxMemoryMb: 512,
      maxCpuSeconds: 30,
      allowedPaths: [],
    });

    it("should allow all paths when disabled", () => {
      expect(sandbox.isPathAllowed("/etc/shadow")).toBe(true);
      expect(sandbox.isWriteAllowed("/etc/shadow")).toBe(true);
    });
  });

  describe("execute", () => {
    const sandbox = new Sandbox({
      enabled: true,
      runtime: "wasm",
      allowNetwork: false,
      maxMemoryMb: 512,
      maxCpuSeconds: 5,
      allowedPaths: ["/tmp"],
    });

    it("should execute a simple command", async () => {
      const result = await sandbox.execute({
        id: "test-1",
        command: "echo",
        args: ["hello"],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
      expect(result.killed).toBe(false);
    });

    it("should block dangerous commands", async () => {
      const result = await sandbox.execute({
        id: "test-2",
        command: "rm",
        args: ["-rf", "/"],
      });

      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("not permitted");
      expect(result.killed).toBe(true);
    });

    it("should capture stderr", async () => {
      const result = await sandbox.execute({
        id: "test-3",
        command: "ls",
        args: ["/nonexistent-path-12345"],
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    it("should strip dangerous env vars", async () => {
      const result = await sandbox.execute({
        id: "test-4",
        command: "env",
        env: { LD_PRELOAD: "/evil.so", NORMAL_VAR: "ok" },
      });

      expect(result.stdout).not.toContain("LD_PRELOAD");
    });

    it("should return config and limits", () => {
      const config = sandbox.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.runtime).toBe("wasm");

      const limits = sandbox.getLimits();
      expect(limits.maxMemoryBytes).toBe(512 * 1024 * 1024);
      expect(limits.allowNetwork).toBe(false);
    });
  });
});
