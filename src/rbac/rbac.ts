import { Permission, AccessContext, AccessDecision } from "./types";

export interface RoleEntry {
  name: string;
  permissions: string[];
  allowedPaths?: string[];
  allowedApiScopes?: string[];
}

export interface RbacConfig {
  enabled: boolean;
  defaultRole: string;
  roles: RoleEntry[];
}

export class RbacEngine {
  private static readonly MAX_PATTERN_LENGTH = 256;
  private static readonly MAX_TARGET_LENGTH = 1024;

  private readonly config: RbacConfig;
  private readonly roleMap: Map<string, RoleEntry>;

  constructor(config: RbacConfig) {
    this.config = config;
    this.roleMap = new Map();
    for (const role of config.roles) {
      this.roleMap.set(role.name, role);
    }
  }

  check(context: AccessContext): AccessDecision {
    const timestamp = Date.now();

    if (!this.config.enabled) {
      return {
        allowed: true,
        reason: "RBAC is disabled",
        role: context.role,
        checkedAt: timestamp,
      };
    }

    const role = this.roleMap.get(context.role);
    if (!role) {
      return {
        allowed: false,
        reason: `Unknown role: '${context.role}'`,
        role: context.role,
        checkedAt: timestamp,
      };
    }

    // Wildcard permission grants the action, but still enforce path/scope checks
    if (!role.permissions.includes("*") && !role.permissions.includes(context.action)) {
      return {
        allowed: false,
        reason: `Role '${context.role}' lacks permission '${context.action}'`,
        role: context.role,
        checkedAt: timestamp,
      };
    }

    // Check path-level access for filesystem resources
    if (context.resourceType === "filesystem") {
      if (!this.isPathAllowed(role, context.resourcePath)) {
        return {
          allowed: false,
          reason: `Role '${context.role}' cannot access path '${context.resourcePath}'`,
          role: context.role,
          checkedAt: timestamp,
        };
      }
    }

    // Check API scope for api resources
    if (context.resourceType === "api") {
      if (!this.isScopeAllowed(role, context.resourcePath)) {
        return {
          allowed: false,
          reason: `Role '${context.role}' cannot access API scope '${context.resourcePath}'`,
          role: context.role,
          checkedAt: timestamp,
        };
      }
    }

    return {
      allowed: true,
      reason: "Access granted",
      role: context.role,
      checkedAt: timestamp,
    };
  }

  getRole(name: string): RoleEntry | undefined {
    return this.roleMap.get(name);
  }

  getDefaultRole(): RoleEntry | undefined {
    return this.roleMap.get(this.config.defaultRole);
  }

  listRoles(): string[] {
    return Array.from(this.roleMap.keys());
  }

  private isPathAllowed(role: RoleEntry, resourcePath: string): boolean {
    if (!role.allowedPaths || role.allowedPaths.length === 0) return false;

    return role.allowedPaths.some((pattern) => {
      if (pattern === "**") return true;
      return this.matchGlob(pattern, resourcePath);
    });
  }

  private isScopeAllowed(role: RoleEntry, scope: string): boolean {
    if (!role.allowedApiScopes || role.allowedApiScopes.length === 0)
      return false;

    return role.allowedApiScopes.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed.endsWith(":*")) {
        const prefix = allowed.slice(0, -1);
        return scope.startsWith(prefix);
      }
      return allowed === scope;
    });
  }

  private matchGlob(pattern: string, target: string): boolean {
    // ReDoS protection: limit input lengths
    if (
      pattern.length > RbacEngine.MAX_PATTERN_LENGTH ||
      target.length > RbacEngine.MAX_TARGET_LENGTH
    ) {
      return false;
    }

    // Use iterative matching instead of regex to avoid catastrophic backtracking
    return this.iterativeGlobMatch(pattern, target);
  }

  /**
   * Iterative glob matcher (no regex) — immune to ReDoS.
   * Supports * (single segment) and ** (any depth).
   */
  private iterativeGlobMatch(pattern: string, target: string): boolean {
    const patternParts = pattern.split("/");
    const targetParts = target.split("/");
    return this.matchParts(patternParts, 0, targetParts, 0);
  }

  private matchParts(
    pp: string[],
    pi: number,
    tp: string[],
    ti: number
  ): boolean {
    while (pi < pp.length && ti < tp.length) {
      if (pp[pi] === "**") {
        // ** matches zero or more path segments
        if (pi === pp.length - 1) return true; // trailing **
        for (let skip = ti; skip <= tp.length; skip++) {
          if (this.matchParts(pp, pi + 1, tp, skip)) return true;
        }
        return false;
      }
      if (!this.matchSegment(pp[pi], tp[ti])) return false;
      pi++;
      ti++;
    }

    // Allow trailing ** to match empty
    while (pi < pp.length && pp[pi] === "**") pi++;

    return pi === pp.length && ti === tp.length;
  }

  private matchSegment(pattern: string, segment: string): boolean {
    // Simple * wildcard within a segment
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === segment;

    // Pattern with embedded wildcards, e.g., "*.ts"
    const parts = pattern.split("*");
    let pos = 0;
    for (let i = 0; i < parts.length; i++) {
      const idx = segment.indexOf(parts[i], pos);
      if (idx === -1) return false;
      if (i === 0 && idx !== 0) return false; // must match start
      pos = idx + parts[i].length;
    }
    if (parts[parts.length - 1] !== "") {
      return segment.endsWith(parts[parts.length - 1]);
    }
    return true;
  }
}
