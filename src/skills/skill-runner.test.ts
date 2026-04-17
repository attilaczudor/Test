import { describe, it, expect, beforeEach } from "vitest";
import { SkillRunner } from "./skill-runner";
import { SkillManifest } from "./types";
import { RbacEngine } from "../rbac";

describe("SkillRunner", () => {
  let runner: SkillRunner;

  const rbac = new RbacEngine({
    enabled: true,
    defaultRole: "agent",
    roles: [
      {
        name: "agent",
        permissions: ["FS_READ", "FS_WRITE", "NET_OUTBOUND", "SHELL_EXEC"],
        allowedPaths: ["./**"],
        allowedApiScopes: ["*"],
      },
      {
        name: "restricted",
        permissions: ["FS_READ"],
        allowedPaths: ["./**"],
        allowedApiScopes: [],
      },
    ],
  });

  const testManifest: SkillManifest = {
    name: "file-reader",
    version: "1.0.0",
    description: "Read files from disk",
    author: "test",
    license: "MIT",
    permissions: ["FS_READ"],
    inputs: [
      {
        name: "path",
        type: "string",
        description: "File path to read",
        required: true,
      },
      {
        name: "encoding",
        type: "string",
        description: "File encoding",
        required: false,
        default: "utf-8",
      },
    ],
    outputs: [
      {
        name: "content",
        type: "string",
        description: "File content",
        required: true,
      },
    ],
  };

  beforeEach(() => {
    runner = new SkillRunner(rbac);
  });

  describe("register / unregister", () => {
    it("should register a skill", () => {
      runner.register(testManifest, async () => ({ content: "test" }));
      expect(runner.listSkills()).toHaveLength(1);
      expect(runner.getManifest("file-reader")).toBeDefined();
    });

    it("should reject duplicate registration", () => {
      runner.register(testManifest, async () => ({}));
      expect(() => runner.register(testManifest, async () => ({}))).toThrow(
        "already registered"
      );
    });

    it("should unregister a skill", () => {
      runner.register(testManifest, async () => ({}));
      expect(runner.unregister("file-reader")).toBe(true);
      expect(runner.listSkills()).toHaveLength(0);
    });

    it("should return false for unregistering non-existent skill", () => {
      expect(runner.unregister("nonexistent")).toBe(false);
    });
  });

  describe("invoke", () => {
    it("should invoke a skill successfully", async () => {
      runner.register(testManifest, async (inputs) => ({
        content: `Read: ${inputs.path}`,
      }));

      const result = await runner.invoke({
        id: "inv-1",
        skillName: "file-reader",
        inputs: { path: "/tmp/test.txt" },
        callerRole: "agent",
        timestamp: Date.now(),
      });

      expect(result.success).toBe(true);
      expect(result.outputs).toEqual({ content: "Read: /tmp/test.txt" });
    });

    it("should fail for non-existent skill", async () => {
      const result = await runner.invoke({
        id: "inv-1",
        skillName: "nonexistent",
        inputs: {},
        callerRole: "agent",
        timestamp: Date.now(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should fail when missing required inputs", async () => {
      runner.register(testManifest, async () => ({}));

      const result = await runner.invoke({
        id: "inv-1",
        skillName: "file-reader",
        inputs: {}, // missing 'path'
        callerRole: "agent",
        timestamp: Date.now(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required input");
    });

    it("should deny when RBAC blocks the permission", async () => {
      const writeManifest: SkillManifest = {
        ...testManifest,
        name: "file-writer",
        permissions: ["FS_WRITE"],
      };
      runner.register(writeManifest, async () => ({}));

      const result = await runner.invoke({
        id: "inv-1",
        skillName: "file-writer",
        inputs: { path: "/tmp/test.txt" },
        callerRole: "restricted", // only has FS_READ
        timestamp: Date.now(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission denied");
    });

    it("should apply default values for optional inputs", async () => {
      let receivedInputs: Record<string, unknown> = {};
      runner.register(testManifest, async (inputs) => {
        receivedInputs = inputs;
        return {};
      });

      await runner.invoke({
        id: "inv-1",
        skillName: "file-reader",
        inputs: { path: "/tmp/test.txt" },
        callerRole: "agent",
        timestamp: Date.now(),
      });

      expect(receivedInputs.encoding).toBe("utf-8");
    });

    it("should catch and report handler errors", async () => {
      runner.register(testManifest, async () => {
        throw new Error("Disk read failed");
      });

      const result = await runner.invoke({
        id: "inv-1",
        skillName: "file-reader",
        inputs: { path: "/tmp/test.txt" },
        callerRole: "agent",
        timestamp: Date.now(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Disk read failed");
    });
  });

  describe("MCP interop", () => {
    it("should convert skills to MCP tool definitions", () => {
      runner.register(testManifest, async () => ({}));
      const tools = runner.toMcpTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("file-reader");
      expect(tools[0].inputSchema.type).toBe("object");
      expect(tools[0].inputSchema.required).toContain("path");
    });

    it("should register from MCP tool definition", () => {
      runner.registerFromMcp(
        {
          name: "web-search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
            },
            required: ["query"],
          },
        },
        async (inputs) => ({ results: [] }),
        ["NET_OUTBOUND"]
      );

      expect(runner.listSkills()).toHaveLength(1);
      const manifest = runner.getManifest("web-search");
      expect(manifest!.permissions).toContain("NET_OUTBOUND");
    });
  });

  describe("events", () => {
    it("should emit events on registration", () => {
      return new Promise<void>((resolve) => {
        runner.on("skillRegistered", (name) => {
          expect(name).toBe("file-reader");
          resolve();
        });
        runner.register(testManifest, async () => ({}));
      });
    });

    it("should emit events on invocation", async () => {
      const events: string[] = [];
      runner.on("skillInvoking", () => events.push("invoking"));
      runner.on("skillCompleted", () => events.push("completed"));

      runner.register(testManifest, async () => ({ content: "ok" }));
      await runner.invoke({
        id: "inv-1",
        skillName: "file-reader",
        inputs: { path: "/tmp/test.txt" },
        callerRole: "agent",
        timestamp: Date.now(),
      });

      expect(events).toEqual(["invoking", "completed"]);
    });
  });
});
