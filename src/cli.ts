#!/usr/bin/env node

/**
 * @module cli
 *
 * Main entry point for the OpenClaw CLI application.
 *
 * This module provides the top-level command dispatcher for the `openclaw` CLI tool.
 * It parses the first positional argument from `process.argv` and routes to the
 * appropriate handler: init, start, validate, status, version, or help.
 *
 * Supported commands:
 * - `init`     - Scaffold a new `openclaw.json` configuration file with secure defaults
 * - `start`    - Boot the OpenClaw gateway and agent runtime
 * - `validate` - Check the current `openclaw.json` for schema/validation errors
 * - `status`   - Display a summary of the active configuration
 * - `version`  - Print the CLI version string
 * - `help`     - Show usage instructions (also the default for unknown commands)
 */

import * as fs from "fs";
import * as path from "path";
import { OpenClaw, writeDefaultConfig, loadConfig, ConfigValidationError } from "./index";

// Extract user-supplied arguments (skip the node binary path and script path)
const args = process.argv.slice(2);
// The first positional argument selects which sub-command to execute
const command = args[0];

/**
 * Asynchronous main dispatcher.
 *
 * Routes the CLI invocation to the handler matching `command`.
 * Falls through to `printHelp()` for unrecognized or missing commands.
 */
async function main() {
  switch (command) {
    case "init":
      return handleInit();
    case "start":
      return handleStart();
    case "validate":
      return handleValidate();
    case "status":
      return handleStatus();
    case "version":
      console.log("openclaw v2.0.0");
      return;
    case "help":
    default:
      return printHelp();
  }
}

/**
 * Handles the `openclaw init` command.
 *
 * Creates a new `openclaw.json` configuration file in the current working directory
 * populated with secure defaults (sandbox enabled, RBAC enabled, localhost-only origins).
 * Exits with code 1 if the file already exists to prevent accidental overwrites.
 */
function handleInit() {
  const configPath = path.resolve(process.cwd(), "openclaw.json");
  // Guard: prevent overwriting an existing configuration file
  if (fs.existsSync(configPath)) {
    console.error("openclaw.json already exists. Remove it first to re-initialize.");
    process.exit(1);
  }
  writeDefaultConfig(configPath);
  console.log("Created openclaw.json with secure defaults.");
  console.log("  - Sandbox: enabled (wasm runtime)");
  console.log("  - RBAC: enabled");
  console.log("  - Origin validation: localhost only");
  console.log("\nEdit openclaw.json to customize, then run: openclaw start");
}

/**
 * Handles the `openclaw start` command.
 *
 * Instantiates the OpenClaw runtime, prints the active configuration summary
 * (sandbox mode, RBAC, memory backend, skills policy, discovery), starts the
 * WebSocket gateway, and registers SIGINT/SIGTERM handlers for graceful shutdown.
 *
 * If the configuration is invalid, detailed validation errors are printed and the
 * process exits with code 1.
 */
async function handleStart() {
  console.log("OpenClaw v2.0.0 — Secure Autonomous Agency Framework");
  console.log("─".repeat(50));

  try {
    const app = new OpenClaw();
    const config = app.config;

    console.log(
      `Sandbox: ${config.sandbox.enabled ? config.sandbox.runtime : "DISABLED (unsafe)"}`,
    );
    console.log(`RBAC: ${config.rbac.enabled ? "enabled" : "DISABLED"}`);
    console.log(`Memory: ${config.memory.backend} (max ${config.memory.maxNodes} nodes)`);
    console.log(`Skills: ${config.skills.requireSigned ? "signed-only" : "unsigned allowed"}`);
    console.log(`Discovery: ${config.discovery.enabled ? "enabled" : "disabled"}`);

    await app.start();
    console.log(`\nGateway listening on ws://${config.gateway.host}:${config.gateway.port}`);
    console.log(`Allowed origins: ${config.gateway.allowedOrigins.join(", ")}`);

    // Register graceful shutdown handler for clean process termination
    const shutdown = async () => {
      console.log("\nShutting down...");
      await app.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err: unknown) {
    if (err instanceof ConfigValidationError) {
      console.error("Configuration error:");
      for (const e of err.errors) {
        console.error(`  ${e.path}: ${e.message}`);
      }
      process.exit(1);
    }
    console.error("Failed to start:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Handles the `openclaw validate` command.
 *
 * Loads and validates the `openclaw.json` configuration file. On success,
 * prints a summary (version, sandbox runtime, RBAC role names). On failure,
 * prints each validation error with its JSON path and exits with code 1.
 */
function handleValidate() {
  try {
    const config = loadConfig();
    console.log("openclaw.json is valid.");
    console.log(`  Version: ${config.version}`);
    console.log(`  Sandbox: ${config.sandbox.runtime}`);
    console.log(`  RBAC roles: ${config.rbac.roles.map((r) => r.name).join(", ")}`);
  } catch (err: unknown) {
    if (err instanceof ConfigValidationError) {
      console.error("Validation failed:");
      for (const e of err.errors) {
        console.error(`  ${e.path}: ${e.message}`);
      }
      process.exit(1);
    }
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Handles the `openclaw status` command.
 *
 * Loads the configuration and displays a concise status dashboard showing:
 * config validity, gateway endpoint, sandbox mode, RBAC state, memory backend,
 * and number of installed skills. Exits with code 1 if the config cannot be read.
 */
function handleStatus() {
  console.log("OpenClaw v2.0.0 Status");
  console.log("─".repeat(30));
  try {
    const config = loadConfig();
    console.log(`Config: valid`);
    console.log(`Gateway: ws://${config.gateway.host}:${config.gateway.port}`);
    console.log(`Sandbox: ${config.sandbox.enabled ? config.sandbox.runtime : "disabled"}`);
    console.log(
      `RBAC: ${config.rbac.enabled ? `enabled (${config.rbac.roles.length} roles)` : "disabled"}`,
    );
    console.log(`Memory: ${config.memory.backend}`);
    console.log(`Installed skills: ${config.skills.installed.length}`);
  } catch (err: unknown) {
    console.error("Cannot read config:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Prints the CLI help/usage message to stdout.
 *
 * Displays all available commands, configuration guidance, and a summary
 * of the default security posture (sandboxed execution, RBAC, origin validation,
 * CSRF protection, signed-only skills).
 */
function printHelp() {
  console.log(`
OpenClaw v2.0.0 — Secure Autonomous Agency Framework

Usage: openclaw <command>

Commands:
  init       Create a new openclaw.json with secure defaults
  start      Start the OpenClaw gateway and agent
  validate   Validate openclaw.json configuration
  status     Show current configuration status
  version    Print version
  help       Show this help message

Configuration:
  OpenClaw uses openclaw.json in the current directory.
  Run 'openclaw init' to create one with secure defaults.

Security:
  By default, OpenClaw runs with:
  - Sandboxed execution (WebAssembly runtime)
  - RBAC with admin/agent/skill roles
  - Strict WebSocket origin validation
  - CSRF protection on state-changing operations
  - Signed-only skill installation

Documentation: https://openclaw.dev/docs
`);
}

// Kick off the async main dispatcher; catch and report any unhandled fatal errors
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
