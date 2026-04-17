import { describe, it, expect, beforeEach } from "vitest";
import { RbacEngine } from "./rbac";
import { Role } from "./types";

describe("RbacEngine", () => {
  const roles: Role[] = [
    {
      name: "admin",
      permissions: ["*"],
      allowedPaths: ["**"],
      allowedApiScopes: ["*"],
    },
    {
      name: "agent",
      permissions: ["FS_READ", "FS_WRITE", "SHELL_EXEC", "NET_OUTBOUND"],
      allowedPaths: ["./project/**", "./tmp/**"],
      allowedApiScopes: ["llm:invoke", "memory:read", "memory:write"],
    },
    {
      name: "skill",
      permissions: ["FS_READ"],
      allowedPaths: ["./project/src/**"],
      allowedApiScopes: ["memory:read"],
    },
    {
      name: "readonly",
      permissions: ["FS_READ"],
      allowedPaths: [],
      allowedApiScopes: [],
    },
  ];

  let rbac: RbacEngine;

  beforeEach(() => {
    rbac = new RbacEngine({
      enabled: true,
      defaultRole: "agent",
      roles,
    });
  });

  describe("admin role", () => {
    it("should allow everything via wildcard", () => {
      const result = rbac.check({
        role: "admin",
        resourceType: "filesystem",
        resourcePath: "/etc/passwd",
        action: "FS_READ",
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("granted");
    });
  });

  describe("agent role", () => {
    it("should allow permitted actions", () => {
      const result = rbac.check({
        role: "agent",
        resourceType: "shell",
        resourcePath: "ls",
        action: "SHELL_EXEC",
      });
      expect(result.allowed).toBe(true);
    });

    it("should deny unpermitted actions", () => {
      const result = rbac.check({
        role: "agent",
        resourceType: "skill",
        resourcePath: "install-plugin",
        action: "SKILL_INSTALL",
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("lacks permission");
    });

    it("should allow filesystem access to allowed paths", () => {
      const result = rbac.check({
        role: "agent",
        resourceType: "filesystem",
        resourcePath: "./project/src/main.ts",
        action: "FS_READ",
      });
      expect(result.allowed).toBe(true);
    });

    it("should deny filesystem access to disallowed paths", () => {
      const result = rbac.check({
        role: "agent",
        resourceType: "filesystem",
        resourcePath: "/etc/shadow",
        action: "FS_READ",
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cannot access path");
    });

    it("should allow matching API scopes", () => {
      const result = rbac.check({
        role: "agent",
        resourceType: "api",
        resourcePath: "llm:invoke",
        action: "FS_READ",
      });
      expect(result.allowed).toBe(true);
    });

    it("should deny non-matching API scopes", () => {
      const result = rbac.check({
        role: "agent",
        resourceType: "api",
        resourcePath: "admin:config",
        action: "FS_READ",
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("skill role", () => {
    it("should restrict to read-only access", () => {
      const readResult = rbac.check({
        role: "skill",
        resourceType: "filesystem",
        resourcePath: "./project/src/index.ts",
        action: "FS_READ",
      });
      expect(readResult.allowed).toBe(true);

      const writeResult = rbac.check({
        role: "skill",
        resourceType: "filesystem",
        resourcePath: "./project/src/index.ts",
        action: "FS_WRITE",
      });
      expect(writeResult.allowed).toBe(false);
    });
  });

  describe("readonly role with empty paths", () => {
    it("should deny filesystem access when allowedPaths is empty", () => {
      const result = rbac.check({
        role: "readonly",
        resourceType: "filesystem",
        resourcePath: "./any/path",
        action: "FS_READ",
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("unknown role", () => {
    it("should deny access for unknown roles", () => {
      const result = rbac.check({
        role: "hacker",
        resourceType: "shell",
        resourcePath: "rm",
        action: "SHELL_EXEC",
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Unknown role");
    });
  });

  describe("disabled RBAC", () => {
    it("should allow everything when disabled", () => {
      const disabledRbac = new RbacEngine({
        enabled: false,
        defaultRole: "agent",
        roles: [],
      });

      const result = disabledRbac.check({
        role: "anyone",
        resourceType: "shell",
        resourcePath: "rm -rf /",
        action: "SHELL_EXEC",
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("disabled");
    });
  });

  describe("utility methods", () => {
    it("should list all roles", () => {
      const names = rbac.listRoles();
      expect(names).toContain("admin");
      expect(names).toContain("agent");
      expect(names).toContain("skill");
    });

    it("should get role by name", () => {
      const role = rbac.getRole("agent");
      expect(role).toBeDefined();
      expect(role!.name).toBe("agent");
    });

    it("should return undefined for unknown role", () => {
      expect(rbac.getRole("nonexistent")).toBeUndefined();
    });

    it("should get default role", () => {
      const role = rbac.getDefaultRole();
      expect(role).toBeDefined();
      expect(role!.name).toBe("agent");
    });
  });
});
