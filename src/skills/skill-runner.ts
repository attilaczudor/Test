import { EventEmitter } from "events";
import { RbacEngine, AccessContext } from "../rbac";
import {
  SkillManifest,
  SkillInvocation,
  SkillResult,
  SkillPermission,
  McpToolDefinition,
} from "./types";

export type SkillHandler = (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface RegisteredSkill {
  manifest: SkillManifest;
  handler: SkillHandler;
}

export class SkillRunner extends EventEmitter {
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly rbac: RbacEngine;

  constructor(rbac: RbacEngine) {
    super();
    this.rbac = rbac;
  }

  register(manifest: SkillManifest, handler: SkillHandler): void {
    if (this.skills.has(manifest.name)) {
      throw new Error(`Skill '${manifest.name}' is already registered`);
    }

    this.validateManifest(manifest);
    this.skills.set(manifest.name, { manifest, handler });
    this.emit("skillRegistered", manifest.name);
  }

  unregister(name: string): boolean {
    const removed = this.skills.delete(name);
    if (removed) this.emit("skillUnregistered", name);
    return removed;
  }

  async invoke(invocation: SkillInvocation): Promise<SkillResult> {
    const startTime = Date.now();
    const skill = this.skills.get(invocation.skillName);

    if (!skill) {
      return {
        invocationId: invocation.id,
        success: false,
        outputs: {},
        error: `Skill '${invocation.skillName}' not found`,
        durationMs: Date.now() - startTime,
      };
    }

    // Check RBAC permissions for each skill permission
    for (const perm of skill.manifest.permissions) {
      const context: AccessContext = {
        role: invocation.callerRole,
        resourceType: "skill",
        resourcePath: invocation.skillName,
        action: perm,
      };

      const decision = this.rbac.check(context);
      if (!decision.allowed) {
        return {
          invocationId: invocation.id,
          success: false,
          outputs: {},
          error: `Permission denied: ${decision.reason}`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Validate required inputs
    for (const param of skill.manifest.inputs) {
      if (param.required && !(param.name in invocation.inputs)) {
        return {
          invocationId: invocation.id,
          success: false,
          outputs: {},
          error: `Missing required input: '${param.name}'`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Apply defaults
    const resolvedInputs = { ...invocation.inputs };
    for (const param of skill.manifest.inputs) {
      if (!(param.name in resolvedInputs) && param.default !== undefined) {
        resolvedInputs[param.name] = param.default;
      }
    }

    try {
      this.emit("skillInvoking", invocation);
      const outputs = await skill.handler(resolvedInputs);
      const result: SkillResult = {
        invocationId: invocation.id,
        success: true,
        outputs,
        durationMs: Date.now() - startTime,
      };
      this.emit("skillCompleted", result);
      return result;
    } catch (err: unknown) {
      const result: SkillResult = {
        invocationId: invocation.id,
        success: false,
        outputs: {},
        error:
          (err instanceof Error ? err.message : String(err)) || "Unknown skill execution error",
        durationMs: Date.now() - startTime,
      };
      this.emit("skillFailed", result);
      return result;
    }
  }

  getManifest(name: string): SkillManifest | undefined {
    return this.skills.get(name)?.manifest;
  }

  listSkills(): SkillManifest[] {
    return Array.from(this.skills.values()).map((s) => s.manifest);
  }

  /**
   * Convert all registered skills to MCP tool definitions.
   * Enables interoperability with any MCP-compatible client.
   */
  toMcpTools(): McpToolDefinition[] {
    return Array.from(this.skills.values()).map(({ manifest }) => ({
      name: manifest.name,
      description: manifest.description,
      inputSchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          manifest.inputs.map((p) => [
            p.name,
            {
              type: p.type,
              description: p.description,
              default: p.default,
            },
          ]),
        ),
        required: manifest.inputs.filter((p) => p.required).map((p) => p.name),
      },
    }));
  }

  /**
   * Register a skill from an MCP tool definition (external MCP server).
   */
  registerFromMcp(
    tool: McpToolDefinition,
    handler: SkillHandler,
    permissions: SkillPermission[] = ["NET_OUTBOUND"],
  ): void {
    const manifest: SkillManifest = {
      name: tool.name,
      version: "1.0.0",
      description: tool.description,
      author: "mcp-external",
      license: "MIT",
      permissions,
      inputs: Object.entries(tool.inputSchema.properties || {}).map(
        ([name, schema]: [string, any]) => ({
          name,
          type: schema.type || "string",
          description: schema.description || "",
          required: (tool.inputSchema.required || []).includes(name),
          default: schema.default,
        }),
      ),
      outputs: [],
    };

    this.register(manifest, handler);
  }

  private validateManifest(manifest: SkillManifest): void {
    if (!manifest.name || manifest.name.length < 1) {
      throw new Error("Skill manifest must have a non-empty name");
    }
    if (!manifest.version) {
      throw new Error("Skill manifest must have a version");
    }
    if (!Array.isArray(manifest.permissions)) {
      throw new Error("Skill manifest must declare permissions array");
    }
  }

  private permissionToResourceType(perm: SkillPermission): AccessContext["resourceType"] {
    switch (perm) {
      case "FS_READ":
      case "FS_WRITE":
        return "filesystem";
      case "NET_INBOUND":
      case "NET_OUTBOUND":
        return "network";
      case "SHELL_EXEC":
        return "shell";
      default:
        return "skill";
    }
  }
}
