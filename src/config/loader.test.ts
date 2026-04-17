import { describe, it, expect } from "vitest";
import { validateConfig, ConfigValidationError, generateCsrfSecret } from "./loader";

describe("Config Loader", () => {
  describe("validateConfig", () => {
    it("should accept a valid minimal config", () => {
      const config = validateConfig({
        version: "2.0.0",
      });
      expect(config.version).toBe("2.0.0");
    });

    it("should accept a full config", () => {
      const config = validateConfig({
        version: "2.0.0",
        gateway: {
          host: "0.0.0.0",
          port: 8080,
          allowedOrigins: ["https://app.example.com"],
        },
        agent: {
          defaultModel: "gpt-4",
          maxTurns: 100,
          temperature: 0.5,
        },
        memory: {
          backend: "graph",
          maxNodes: 5000,
          importanceThreshold: 0.5,
          autoSummarize: true,
          summarizeAfterTurns: 50,
        },
        sandbox: {
          enabled: true,
          runtime: "docker",
          allowNetwork: false,
          maxMemoryMb: 256,
          maxCpuSeconds: 10,
          allowedPaths: ["/home/user/project"],
        },
        rbac: {
          enabled: true,
          defaultRole: "agent",
          roles: [
            {
              name: "agent",
              permissions: ["FS_READ", "FS_WRITE"],
              allowedPaths: ["./**"],
              allowedApiScopes: ["llm:invoke"],
            },
          ],
        },
      });

      expect(config.gateway.port).toBe(8080);
      expect(config.agent.defaultModel).toBe("gpt-4");
      expect(config.memory.backend).toBe("graph");
      expect(config.sandbox.runtime).toBe("docker");
    });

    it("should reject an invalid version format", () => {
      expect(() => {
        validateConfig({ version: "1.0.0" });
      }).toThrow();
    });

    it("should reject unknown properties", () => {
      expect(() => {
        validateConfig({
          version: "2.0.0",
          unknownField: true,
        });
      }).toThrow();
    });

    it("should reject invalid port numbers", () => {
      expect(() => {
        validateConfig({
          version: "2.0.0",
          gateway: { port: 99999 },
        });
      }).toThrow();
    });

    it("should reject invalid memory backend", () => {
      expect(() => {
        validateConfig({
          version: "2.0.0",
          memory: { backend: "invalid" },
        });
      }).toThrow();
    });
  });

  describe("generateCsrfSecret", () => {
    it("should generate a string of at least 32 characters", () => {
      const secret = generateCsrfSecret();
      expect(secret.length).toBeGreaterThanOrEqual(32);
    });

    it("should generate unique values", () => {
      const a = generateCsrfSecret();
      const b = generateCsrfSecret();
      expect(a).not.toBe(b);
    });
  });

  describe("ConfigValidationError", () => {
    it("should include structured errors", () => {
      const err = new ConfigValidationError("test", [
        { path: "/gateway/port", message: "must be >= 1" },
      ]);
      expect(err.errors).toHaveLength(1);
      expect(err.errors[0].path).toBe("/gateway/port");
      expect(err.name).toBe("ConfigValidationError");
    });
  });
});
