/**
 * @module browser-cli-actions-observe
 *
 * Registers browser observation CLI subcommands: `console`, `pdf`, and `responsebody`.
 *
 * These commands are read-only operations that inspect the browser's current state:
 * - `console` - Retrieve recent console messages, optionally filtered by level
 * - `pdf` - Save the current page as a PDF file
 * - `responsebody` - Wait for a network response matching a URL pattern and return its body
 */

import type { Command } from "commander";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { callBrowserRequest, type BrowserParentOpts } from "./browser-cli-shared.js";
import { runCommandWithRuntime } from "./cli-utils.js";

/**
 * Executes a browser observe action with standardized error handling.
 *
 * Wraps the action in `runCommandWithRuntime`, logging errors via the
 * default runtime and exiting with code 1 on failure.
 *
 * @param action - The async action to execute
 */
function runBrowserObserve(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action, (err) => {
    defaultRuntime.error(danger(String(err)));
    defaultRuntime.exit(1);
  });
}

/**
 * Registers browser observation subcommands (`console`, `pdf`, `responsebody`)
 * on the given parent browser command.
 *
 * @param browser - The parent `browser` Commander command
 * @param parentOpts - Accessor function to retrieve parent command options (json, browserProfile, etc.)
 */
export function registerBrowserActionObserveCommands(
  browser: Command,
  parentOpts: (cmd: Command) => BrowserParentOpts,
) {
  browser
    .command("console")
    .description("Get recent console messages")
    .option("--level <level>", "Filter by level (error, warn, info)")
    .option("--target-id <id>", "CDP target id (or unique prefix)")
    .action(async (opts, cmd) => {
      const parent = parentOpts(cmd);
      const profile = parent?.browserProfile;
      await runBrowserObserve(async () => {
        const result = await callBrowserRequest<{ messages: unknown[] }>(
          parent,
          {
            method: "GET",
            path: "/console",
            query: {
              level: opts.level?.trim() || undefined,
              targetId: opts.targetId?.trim() || undefined,
              profile,
            },
          },
          { timeoutMs: 20000 },
        );
        if (parent?.json) {
          defaultRuntime.log(JSON.stringify(result, null, 2));
          return;
        }
        defaultRuntime.log(JSON.stringify(result.messages, null, 2));
      });
    });

  browser
    .command("pdf")
    .description("Save page as PDF")
    .option("--target-id <id>", "CDP target id (or unique prefix)")
    .action(async (opts, cmd) => {
      const parent = parentOpts(cmd);
      const profile = parent?.browserProfile;
      await runBrowserObserve(async () => {
        const result = await callBrowserRequest<{ path: string }>(
          parent,
          {
            method: "POST",
            path: "/pdf",
            query: profile ? { profile } : undefined,
            body: { targetId: opts.targetId?.trim() || undefined },
          },
          { timeoutMs: 20000 },
        );
        if (parent?.json) {
          defaultRuntime.log(JSON.stringify(result, null, 2));
          return;
        }
        defaultRuntime.log(`PDF: ${shortenHomePath(result.path)}`);
      });
    });

  browser
    .command("responsebody")
    .description("Wait for a network response and return its body")
    .argument("<url>", "URL (exact, substring, or glob like **/api)")
    .option("--target-id <id>", "CDP target id (or unique prefix)")
    .option(
      "--timeout-ms <ms>",
      "How long to wait for the response (default: 20000)",
      (v: string) => Number(v),
    )
    .option("--max-chars <n>", "Max body chars to return (default: 200000)", (v: string) =>
      Number(v),
    )
    .action(async (url: string, opts, cmd) => {
      const parent = parentOpts(cmd);
      const profile = parent?.browserProfile;
      await runBrowserObserve(async () => {
        const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : undefined;
        const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : undefined;
        const result = await callBrowserRequest<{ response: { body: string } }>(
          parent,
          {
            method: "POST",
            path: "/response/body",
            query: profile ? { profile } : undefined,
            body: {
              url,
              targetId: opts.targetId?.trim() || undefined,
              timeoutMs,
              maxChars,
            },
          },
          { timeoutMs: timeoutMs ?? 20000 },
        );
        if (parent?.json) {
          defaultRuntime.log(JSON.stringify(result, null, 2));
          return;
        }
        defaultRuntime.log(result.response.body);
      });
    });
}
