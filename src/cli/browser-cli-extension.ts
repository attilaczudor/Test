/**
 * @module browser-cli-extension
 *
 * Registers CLI commands for managing the bundled OpenClaw Chrome extension.
 *
 * Provides:
 * - `browser extension install` - Copies the bundled Chrome extension to a stable
 *   local path inside the OpenClaw state directory, suitable for "Load unpacked" in Chrome.
 * - `browser extension path` - Prints the installed extension directory path.
 *
 * Also exports helpers for programmatic extension installation and path resolution.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { movePathToTrash } from "../browser/trash.js";
import { resolveStateDir } from "../config/paths.js";
import { danger, info } from "../globals.js";
import { copyToClipboard } from "../infra/clipboard.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

/**
 * Resolves the path to the bundled Chrome extension source directory.
 *
 * Walks up from the given starting directory looking for `assets/chrome-extension/manifest.json`.
 * Falls back to a relative path from the current module location.
 *
 * @param here - Starting directory for the upward search (defaults to this module's directory)
 * @returns Absolute path to the bundled extension directory
 */
export function resolveBundledExtensionRootDir(
  here = path.dirname(fileURLToPath(import.meta.url)),
) {
  let current = here;
  while (true) {
    const candidate = path.join(current, "assets", "chrome-extension");
    if (hasManifest(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(here, "../../assets/chrome-extension");
}

/** Returns the path where the Chrome extension is installed within the OpenClaw state directory */
function installedExtensionRootDir() {
  return path.join(resolveStateDir(), "browser", "chrome-extension");
}

/** Checks whether a directory contains a manifest.json file (indicating a valid extension) */
function hasManifest(dir: string) {
  return fs.existsSync(path.join(dir, "manifest.json"));
}

/**
 * Installs the bundled Chrome extension to the OpenClaw state directory.
 *
 * Copies the extension source to a stable path, replacing any existing installation
 * (old copy is moved to trash or renamed with a timestamp backup). Verifies the
 * installation by checking for manifest.json in the destination.
 *
 * @param opts - Optional overrides for source and state directories
 * @returns An object containing the installed extension path
 * @throws {Error} If the bundled extension is missing or installation fails
 */
export async function installChromeExtension(opts?: {
  stateDir?: string;
  sourceDir?: string;
}): Promise<{ path: string }> {
  const src = opts?.sourceDir ?? resolveBundledExtensionRootDir();
  if (!hasManifest(src)) {
    throw new Error("Bundled Chrome extension is missing. Reinstall OpenClaw and try again.");
  }

  const stateDir = opts?.stateDir ?? resolveStateDir();
  const dest = path.join(stateDir, "browser", "chrome-extension");
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    await movePathToTrash(dest).catch(() => {
      const backup = `${dest}.old-${Date.now()}`;
      fs.renameSync(dest, backup);
    });
  }

  await fs.promises.cp(src, dest, { recursive: true });
  if (!hasManifest(dest)) {
    throw new Error("Chrome extension install failed (manifest.json missing). Try again.");
  }

  return { path: dest };
}

/**
 * Registers `browser extension install` and `browser extension path` subcommands.
 *
 * @param browser - The parent `browser` Commander command
 * @param parentOpts - Accessor function to retrieve parent command options (json mode)
 */
export function registerBrowserExtensionCommands(
  browser: Command,
  parentOpts: (cmd: Command) => { json?: boolean },
) {
  const ext = browser.command("extension").description("Chrome extension helpers");

  ext
    .command("install")
    .description("Install the Chrome extension to a stable local path")
    .action(async (_opts, cmd) => {
      const parent = parentOpts(cmd);
      let installed: { path: string };
      try {
        installed = await installChromeExtension();
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
        return;
      }

      if (parent?.json) {
        defaultRuntime.log(JSON.stringify({ ok: true, path: installed.path }, null, 2));
        return;
      }
      const displayPath = shortenHomePath(installed.path);
      defaultRuntime.log(displayPath);
      const copied = await copyToClipboard(installed.path).catch(() => false);
      defaultRuntime.error(
        info(
          [
            copied ? "Copied to clipboard." : "Copy to clipboard unavailable.",
            "Next:",
            `- Chrome → chrome://extensions → enable “Developer mode”`,
            `- “Load unpacked” → select: ${displayPath}`,
            `- Pin “OpenClaw Browser Relay”, then click it on the tab (badge shows ON)`,
            "",
            `${theme.muted("Docs:")} ${formatDocsLink("/tools/chrome-extension", "docs.openclaw.ai/tools/chrome-extension")}`,
          ].join("\n"),
        ),
      );
    });

  ext
    .command("path")
    .description("Print the path to the installed Chrome extension (load unpacked)")
    .action(async (_opts, cmd) => {
      const parent = parentOpts(cmd);
      const dir = installedExtensionRootDir();
      if (!hasManifest(dir)) {
        defaultRuntime.error(
          danger(
            [
              `Chrome extension is not installed. Run: "${formatCliCommand("openclaw browser extension install")}"`,
              `Docs: ${formatDocsLink("/tools/chrome-extension", "docs.openclaw.ai/tools/chrome-extension")}`,
            ].join("\n"),
          ),
        );
        defaultRuntime.exit(1);
      }
      if (parent?.json) {
        defaultRuntime.log(JSON.stringify({ path: dir }, null, 2));
        return;
      }
      const displayPath = shortenHomePath(dir);
      defaultRuntime.log(displayPath);
      const copied = await copyToClipboard(dir).catch(() => false);
      if (copied) {
        defaultRuntime.error(info("Copied to clipboard."));
      }
    });
}
