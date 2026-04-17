/**
 * @module banner
 *
 * CLI startup banner rendering for OpenClaw.
 *
 * Responsible for formatting and emitting the branded startup banner that
 * appears when the CLI is run interactively. Handles both rich (ANSI color)
 * and plain-text output modes, single-line and multi-line layouts depending
 * on terminal width, and an optional ASCII art lobster logo.
 *
 * The banner is emitted at most once per process and is suppressed when:
 * - stdout is not a TTY (piped or redirected)
 * - `--json` output is requested
 * - `--version` / `-V` flags are present
 */

import { resolveCommitHash } from "../infra/git-commit.js";
import { visibleWidth } from "../terminal/ansi.js";
import { isRich, theme } from "../terminal/theme.js";
import { hasRootVersionAlias } from "./argv.js";
import { pickTagline, type TaglineOptions } from "./tagline.js";

/**
 * Options for controlling banner appearance and content.
 *
 * Extends {@link TaglineOptions} to inherit tagline selection behavior
 * and adds banner-specific options like commit hash, column width, and
 * argv inspection for flag detection.
 */
type BannerOptions = TaglineOptions & {
  /** Raw process.argv for flag detection (--json, --version) */
  argv?: string[];
  /** Git commit hash to display; null/undefined triggers auto-resolution */
  commit?: string | null;
  /** Terminal column width override (defaults to process.stdout.columns) */
  columns?: number;
  /** Force rich (ANSI) or plain rendering (defaults to isRich() detection) */
  richTty?: boolean;
};

/** Tracks whether the banner has already been printed to prevent duplicates */
let bannerEmitted = false;

// Use Intl.Segmenter when available for correct grapheme cluster splitting
// (handles emoji, combining marks, etc.). Falls back to Array.from for
// environments without Intl support.
const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * Splits a string into individual grapheme clusters.
 *
 * Uses `Intl.Segmenter` when available for proper Unicode grapheme
 * segmentation; falls back to `Array.from` for basic code-point splitting.
 *
 * @param value - The string to split into grapheme clusters
 * @returns An array of individual grapheme cluster strings
 */
function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) {
    return Array.from(value);
  }
  try {
    return Array.from(graphemeSegmenter.segment(value), (seg) => seg.segment);
  } catch {
    return Array.from(value);
  }
}

/** Detects whether `--json` or `--json=...` appears anywhere in argv */
const hasJsonFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--json" || arg.startsWith("--json="));

/** Detects whether `--version`, `-V`, or the root `-v` alias appears in argv */
const hasVersionFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--version" || arg === "-V") || hasRootVersionAlias(argv);

/**
 * Formats the single-line (or two-line) CLI banner text.
 *
 * Assembles the banner from the version string, git commit hash, and a
 * randomly picked tagline. When the full line exceeds the terminal width,
 * it wraps to two lines with the tagline indented below the title.
 *
 * @param version - The CLI version string (e.g. "2.0.0")
 * @param options - Banner rendering options
 * @returns The formatted banner string (may contain ANSI escape codes if rich mode)
 */
export function formatCliBannerLine(version: string, options: BannerOptions = {}): string {
  const commit = options.commit ?? resolveCommitHash({ env: options.env });
  const commitLabel = commit ?? "unknown";
  const tagline = pickTagline(options);
  const rich = options.richTty ?? isRich();
  const title = "🦞 OpenClaw";
  const prefix = "🦞 ";
  const columns = options.columns ?? process.stdout.columns ?? 120;
  const plainFullLine = `${title} ${version} (${commitLabel}) — ${tagline}`;
  const fitsOnOneLine = visibleWidth(plainFullLine) <= columns;
  if (rich) {
    if (fitsOnOneLine) {
      return `${theme.heading(title)} ${theme.info(version)} ${theme.muted(
        `(${commitLabel})`,
      )} ${theme.muted("—")} ${theme.accentDim(tagline)}`;
    }
    const line1 = `${theme.heading(title)} ${theme.info(version)} ${theme.muted(
      `(${commitLabel})`,
    )}`;
    const line2 = `${" ".repeat(prefix.length)}${theme.accentDim(tagline)}`;
    return `${line1}\n${line2}`;
  }
  if (fitsOnOneLine) {
    return plainFullLine;
  }
  const line1 = `${title} ${version} (${commitLabel})`;
  const line2 = `${" ".repeat(prefix.length)}${tagline}`;
  return `${line1}\n${line2}`;
}

/** ASCII art block used for the full lobster logo banner */
const LOBSTER_ASCII = [
  "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
  "██░▄▄▄░██░▄▄░██░▄▄▄██░▀██░██░▄▄▀██░████░▄▄▀██░███░██",
  "██░███░██░▀▀░██░▄▄▄██░█░█░██░█████░████░▀▀░██░█░█░██",
  "██░▀▀▀░██░█████░▀▀▀██░██▄░██░▀▀▄██░▀▀░█░██░██▄▀▄▀▄██",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  "                  🦞 OPENCLAW 🦞                    ",
  " ",
];

/**
 * Formats the ASCII art lobster banner with optional ANSI coloring.
 *
 * In rich mode, each character of the ASCII art is individually colored:
 * full blocks get the bright accent, shaded blocks the dim accent, and
 * half-blocks the mid accent. In plain mode, the raw ASCII is returned.
 *
 * @param options - Banner rendering options
 * @returns The formatted ASCII art string
 */
export function formatCliBannerArt(options: BannerOptions = {}): string {
  const rich = options.richTty ?? isRich();
  if (!rich) {
    return LOBSTER_ASCII.join("\n");
  }

  const colorChar = (ch: string) => {
    if (ch === "█") {
      return theme.accentBright(ch);
    }
    if (ch === "░") {
      return theme.accentDim(ch);
    }
    if (ch === "▀") {
      return theme.accent(ch);
    }
    return theme.muted(ch);
  };

  const colored = LOBSTER_ASCII.map((line) => {
    if (line.includes("OPENCLAW")) {
      return (
        theme.muted("              ") +
        theme.accent("🦞") +
        theme.info(" OPENCLAW ") +
        theme.accent("🦞")
      );
    }
    return splitGraphemes(line).map(colorChar).join("");
  });

  return colored.join("\n");
}

/**
 * Emits the CLI banner to stdout (at most once per process).
 *
 * Suppresses output when:
 * - The banner has already been emitted
 * - stdout is not a TTY
 * - `--json` output mode is requested
 * - `--version` / `-V` flags are present
 *
 * @param version - The CLI version string
 * @param options - Banner rendering options
 */
export function emitCliBanner(version: string, options: BannerOptions = {}) {
  if (bannerEmitted) {
    return;
  }
  const argv = options.argv ?? process.argv;
  if (!process.stdout.isTTY) {
    return;
  }
  if (hasJsonFlag(argv)) {
    return;
  }
  if (hasVersionFlag(argv)) {
    return;
  }
  const line = formatCliBannerLine(version, options);
  process.stdout.write(`\n${line}\n\n`);
  bannerEmitted = true;
}

/**
 * Returns whether the CLI banner has already been emitted in this process.
 *
 * @returns `true` if `emitCliBanner` has already written banner output
 */
export function hasEmittedCliBanner(): boolean {
  return bannerEmitted;
}
