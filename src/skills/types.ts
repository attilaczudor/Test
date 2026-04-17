/**
 * MCP-standardized skill interface with permissions manifest.
 *
 * Each skill declares a machine-readable manifest of required
 * permissions (like Android app permissions) that the Gateway
 * enforces at runtime.
 */

export type SkillPermission =
  | "FS_READ"
  | "FS_WRITE"
  | "NET_INBOUND"
  | "NET_OUTBOUND"
  | "SHELL_EXEC"
  | "BROWSER"
  | "CLIPBOARD"
  | "ENV_READ";

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  permissions: SkillPermission[];
  inputs: SkillParameter[];
  outputs: SkillParameter[];
  signature?: string; // Ed25519 signature for verified registry
}

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface SkillInvocation {
  id: string;
  skillName: string;
  inputs: Record<string, unknown>;
  callerRole: string;
  timestamp: number;
}

export interface SkillResult {
  invocationId: string;
  success: boolean;
  outputs: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

/**
 * MCP-compatible tool definition.
 * Allows OpenClaw skills to be consumed as MCP tools and vice versa.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
