/**
 * Role-Based Access Control (RBAC) Types
 *
 * Defines the permission model used by the Gateway and Skill Runner
 * to enforce least-privilege access for agents, skills, and users.
 */

/**
 * Fine-grained permission token.
 *
 * `"*"` grants unrestricted access (admin only).
 */
export type Permission =
  | "FS_READ"
  | "FS_WRITE"
  | "NET_INBOUND"
  | "NET_OUTBOUND"
  | "SHELL_EXEC"
  | "BROWSER"
  | "CLIPBOARD"
  | "ENV_READ"
  | "MEMORY_READ"
  | "MEMORY_WRITE"
  | "SKILL_INSTALL"
  | "SKILL_EXECUTE"
  | "CONFIG_READ"
  | "CONFIG_WRITE"
  | "AGENT_SPAWN"
  | "*";

/** A named role with its associated permissions and resource scopes. */
export interface Role {
  /** Unique role name (e.g. "admin", "agent", "skill"). */
  name: string;
  /** Set of permissions granted to this role. */
  permissions: Permission[];
  /** Filesystem glob patterns this role may access. */
  allowedPaths: string[];
  /** API scope identifiers this role is permitted to call. */
  allowedApiScopes: string[];
}

/** Context passed to the RBAC engine when evaluating an access request. */
export interface AccessContext {
  /** Name of the role being evaluated. */
  role: string;
  /** Category of the resource being accessed. */
  resourceType: "filesystem" | "api" | "skill" | "shell" | "network";
  /** Specific resource path or identifier. */
  resourcePath: string;
  /** Permission required for the requested action. */
  action: Permission;
}

/** Result of an RBAC access check. */
export interface AccessDecision {
  /** Whether access was granted. */
  allowed: boolean;
  /** Human-readable explanation of the decision. */
  reason: string;
  /** Role that was evaluated. */
  role: string;
  /** Unix timestamp (ms) when the check was performed. */
  checkedAt: number;
}
