/**
 * @module argv
 *
 * Low-level argument-vector (argv) parsing utilities.
 *
 * This module provides lightweight, dependency-free helpers for inspecting
 * raw `process.argv` arrays *before* Commander parses them. These are used
 * to make early decisions such as:
 * - Should the startup banner be suppressed (--help / --version)?
 * - Which profile was selected (--profile)?
 * - Should state migration run for this command path?
 * - How to normalize argv when invoked via npx, pnpm, bun, etc.?
 *
 * All functions treat `"--"` as a flag terminator per POSIX convention.
 */

/** Set of flags that request help output */
const HELP_FLAGS = new Set(["-h", "--help"]);
/** Set of flags that request version output */
const VERSION_FLAGS = new Set(["-V", "--version"]);
/** Short alias for version at the root level only (not inside subcommands) */
const ROOT_VERSION_ALIAS_FLAG = "-v";
/** Boolean flags recognized at the root level (no value argument expected) */
const ROOT_BOOLEAN_FLAGS = new Set(["--dev", "--no-color"]);
/** Value flags recognized at the root level (consume the next token as a value) */
const ROOT_VALUE_FLAGS = new Set(["--profile"]);
/** POSIX flag terminator -- arguments after this are treated as positional */
const FLAG_TERMINATOR = "--";

/**
 * Checks whether any help or version flag appears in the argument vector.
 *
 * Used to short-circuit expensive initialization (e.g., banner rendering)
 * when the user is only requesting help or version information.
 *
 * @param argv - The raw process.argv array
 * @returns `true` if `-h`, `--help`, `-V`, `--version`, or the root `-v` alias is present
 */
export function hasHelpOrVersion(argv: string[]): boolean {
  return (
    argv.some((arg) => HELP_FLAGS.has(arg) || VERSION_FLAGS.has(arg)) || hasRootVersionAlias(argv)
  );
}

/**
 * Determines whether a token looks like a value (as opposed to a flag or terminator).
 *
 * Returns true for non-flag strings and negative-number-like tokens (e.g. "-42").
 * Returns false for undefined, flag terminator "--", and flag-like strings starting with "-".
 *
 * @param arg - The token to inspect
 * @returns `true` if the token is a value rather than a flag
 */
function isValueToken(arg: string | undefined): boolean {
  if (!arg) {
    return false;
  }
  if (arg === FLAG_TERMINATOR) {
    return false;
  }
  if (!arg.startsWith("-")) {
    return true;
  }
  return /^-\d+(?:\.\d+)?$/.test(arg);
}

/**
 * Parses a string as a positive integer, returning undefined if invalid.
 *
 * @param value - The string to parse
 * @returns The parsed positive integer, or undefined if not a valid positive int
 */
function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

/**
 * Checks whether a specific flag (e.g. "--verbose") appears in argv.
 *
 * Respects the POSIX `--` flag terminator; flags after `--` are ignored.
 *
 * @param argv - The raw process.argv array
 * @param name - The flag name to look for (e.g. "--verbose")
 * @returns `true` if the flag is found before the terminator
 */
export function hasFlag(argv: string[], name: string): boolean {
  const args = argv.slice(2);
  for (const arg of args) {
    if (arg === FLAG_TERMINATOR) {
      break;
    }
    if (arg === name) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether `-v` appears at the root level (i.e., not inside a subcommand).
 *
 * Unlike `--version` / `-V` which are valid anywhere, `-v` is only treated as
 * a version alias when no subcommand has been entered. This prevents collisions
 * with subcommand-level `-v` flags (e.g. `--verbose`).
 *
 * The algorithm skips known root-level boolean and value flags, stopping at the
 * first positional argument (which would indicate a subcommand).
 *
 * @param argv - The raw process.argv array
 * @returns `true` if `-v` is a root-level version alias
 */
export function hasRootVersionAlias(argv: string[]): boolean {
  const args = argv.slice(2);
  let hasAlias = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === FLAG_TERMINATOR) {
      break;
    }
    if (arg === ROOT_VERSION_ALIAS_FLAG) {
      hasAlias = true;
      continue;
    }
    if (ROOT_BOOLEAN_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith("--profile=")) {
      continue;
    }
    if (ROOT_VALUE_FLAGS.has(arg)) {
      const next = args[i + 1];
      if (isValueToken(next)) {
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return false;
  }
  return hasAlias;
}

/**
 * Retrieves the value of a named flag from argv.
 *
 * Supports both `--flag value` and `--flag=value` syntaxes.
 *
 * @param argv - The raw process.argv array
 * @param name - The flag name (e.g. "--profile")
 * @returns The flag's value string, `null` if the flag is present but has no value,
 *          or `undefined` if the flag is not present at all
 */
export function getFlagValue(argv: string[], name: string): string | null | undefined {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === FLAG_TERMINATOR) {
      break;
    }
    if (arg === name) {
      const next = args[i + 1];
      return isValueToken(next) ? next : null;
    }
    if (arg.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      return value ? value : null;
    }
  }
  return undefined;
}

/**
 * Checks whether verbose mode is requested via `--verbose` (and optionally `--debug`).
 *
 * @param argv - The raw process.argv array
 * @param options - Optional settings; if `includeDebug` is true, `--debug` also triggers verbose
 * @returns `true` if verbose mode is requested
 */
export function getVerboseFlag(argv: string[], options?: { includeDebug?: boolean }): boolean {
  if (hasFlag(argv, "--verbose")) {
    return true;
  }
  if (options?.includeDebug && hasFlag(argv, "--debug")) {
    return true;
  }
  return false;
}

/**
 * Retrieves a flag's value as a positive integer.
 *
 * @param argv - The raw process.argv array
 * @param name - The flag name (e.g. "--port")
 * @returns The parsed positive integer, `null` if the flag is present but invalid/missing,
 *          or `undefined` if the flag is not found
 */
export function getPositiveIntFlagValue(argv: string[], name: string): number | null | undefined {
  const raw = getFlagValue(argv, name);
  if (raw === null || raw === undefined) {
    return raw;
  }
  return parsePositiveInt(raw);
}

/**
 * Extracts the positional command path from argv (e.g. ["gateway", "run"]).
 *
 * Skips flags and stops at the `--` terminator. Collects up to `depth`
 * positional arguments to determine the command hierarchy.
 *
 * @param argv - The raw process.argv array
 * @param depth - Maximum number of positional arguments to collect (default: 2)
 * @returns An array of positional command segments
 */
export function getCommandPath(argv: string[], depth = 2): string[] {
  const args = argv.slice(2);
  const path: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === "--") {
      break;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    path.push(arg);
    if (path.length >= depth) {
      break;
    }
  }
  return path;
}

/**
 * Extracts the first positional (primary) command from argv.
 *
 * @param argv - The raw process.argv array
 * @returns The primary command name, or `null` if none was found
 */
export function getPrimaryCommand(argv: string[]): string | null {
  const [primary] = getCommandPath(argv, 1);
  return primary ?? null;
}

/**
 * Builds a normalized argv array suitable for Commander's `parseAsync`.
 *
 * Handles various invocation patterns (npx, pnpm, bun, direct node) by
 * normalizing the first two elements to `["node", "openclaw", ...args]`.
 * This ensures Commander correctly identifies the program name regardless
 * of how the CLI was launched.
 *
 * @param params - Raw arguments, fallback argv, and optional program name
 * @returns A normalized argv array with `["node", "<programName>", ...userArgs]`
 */
export function buildParseArgv(params: {
  programName?: string;
  rawArgs?: string[];
  fallbackArgv?: string[];
}): string[] {
  const baseArgv =
    params.rawArgs && params.rawArgs.length > 0
      ? params.rawArgs
      : params.fallbackArgv && params.fallbackArgv.length > 0
        ? params.fallbackArgv
        : process.argv;
  const programName = params.programName ?? "";
  const normalizedArgv =
    programName && baseArgv[0] === programName
      ? baseArgv.slice(1)
      : baseArgv[0]?.endsWith("openclaw")
        ? baseArgv.slice(1)
        : baseArgv;
  const executable = (normalizedArgv[0]?.split(/[/\\]/).pop() ?? "").toLowerCase();
  const looksLikeNode =
    normalizedArgv.length >= 2 && (isNodeExecutable(executable) || isBunExecutable(executable));
  if (looksLikeNode) {
    return normalizedArgv;
  }
  return ["node", programName || "openclaw", ...normalizedArgv];
}

/** Pattern matching versioned Node.js executables like "node-18.0.0" or "node-20.exe" */
const nodeExecutablePattern = /^node-\d+(?:\.\d+)*(?:\.exe)?$/;

/**
 * Checks if an executable name is a Node.js binary (node, nodejs, or versioned variants).
 *
 * @param executable - The lowercase basename of the executable
 * @returns `true` if the name matches a known Node.js executable pattern
 */
function isNodeExecutable(executable: string): boolean {
  return (
    executable === "node" ||
    executable === "node.exe" ||
    executable === "nodejs" ||
    executable === "nodejs.exe" ||
    nodeExecutablePattern.test(executable)
  );
}

/**
 * Checks if an executable name is the Bun runtime.
 *
 * @param executable - The lowercase basename of the executable
 * @returns `true` if the executable is "bun" or "bun.exe"
 */
function isBunExecutable(executable: string): boolean {
  return executable === "bun" || executable === "bun.exe";
}

/**
 * Determines whether state migration should run for the given command path.
 *
 * Read-only and status-type commands (health, status, sessions, config get/unset,
 * models list/status, memory status, agent) skip migration to avoid side effects
 * during non-mutating operations.
 *
 * @param path - The command path segments (e.g. ["config", "get"])
 * @returns `true` if state migration should run for this command
 */
export function shouldMigrateStateFromPath(path: string[]): boolean {
  if (path.length === 0) {
    return true;
  }
  const [primary, secondary] = path;
  if (primary === "health" || primary === "status" || primary === "sessions") {
    return false;
  }
  if (primary === "config" && (secondary === "get" || secondary === "unset")) {
    return false;
  }
  if (primary === "models" && (secondary === "list" || secondary === "status")) {
    return false;
  }
  if (primary === "memory" && secondary === "status") {
    return false;
  }
  if (primary === "agent") {
    return false;
  }
  return true;
}

/**
 * Determines whether state migration should run based on the raw argv.
 *
 * Convenience wrapper that extracts the command path from argv and delegates
 * to {@link shouldMigrateStateFromPath}.
 *
 * @param argv - The raw process.argv array
 * @returns `true` if state migration should run for this invocation
 */
export function shouldMigrateState(argv: string[]): boolean {
  return shouldMigrateStateFromPath(getCommandPath(argv, 2));
}
