/**
 * @module browser-cli
 *
 * Registers the top-level `openclaw browser` CLI command and all its subcommands.
 *
 * This module acts as the entry point for browser automation features, delegating
 * to specialized sub-modules for manage (start/stop/tabs), inspect (screenshot/snapshot),
 * input actions (click/type/navigate), observe actions (console/pdf), debug (errors/requests/trace),
 * state management (cookies/storage/viewport), and Chrome extension helpers.
 *
 * All browser subcommands communicate with the gateway via RPC and support
 * both human-readable and `--json` machine-readable output.
 */

import type { Command } from "commander";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { registerBrowserActionInputCommands } from "./browser-cli-actions-input.js";
import { registerBrowserActionObserveCommands } from "./browser-cli-actions-observe.js";
import { registerBrowserDebugCommands } from "./browser-cli-debug.js";
import { browserActionExamples, browserCoreExamples } from "./browser-cli-examples.js";
import { registerBrowserExtensionCommands } from "./browser-cli-extension.js";
import { registerBrowserInspectCommands } from "./browser-cli-inspect.js";
import { registerBrowserManageCommands } from "./browser-cli-manage.js";
import type { BrowserParentOpts } from "./browser-cli-shared.js";
import { registerBrowserStateCommands } from "./browser-cli-state.js";
import { formatCliCommand } from "./command-format.js";
import { addGatewayClientOptions } from "./gateway-rpc.js";
import { formatHelpExamples } from "./help-format.js";

/**
 * Registers the `browser` command group and all browser-related subcommands
 * on the given Commander program.
 *
 * Creates the parent `browser` command with shared options (`--browser-profile`, `--json`,
 * gateway connection options), attaches help text with usage examples, and delegates
 * subcommand registration to specialized modules.
 *
 * @param program - The root Commander program to attach the `browser` command to
 */
export function registerBrowserCli(program: Command) {
  const browser = program
    .command("browser")
    .description("Manage OpenClaw's dedicated browser (Chrome/Chromium)")
    .option("--browser-profile <name>", "Browser profile name (default from config)")
    .option("--json", "Output machine-readable JSON", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples(
          [...browserCoreExamples, ...browserActionExamples].map((cmd) => [cmd, ""]),
          true,
        )}\n\n${theme.muted("Docs:")} ${formatDocsLink(
          "/cli/browser",
          "docs.openclaw.ai/cli/browser",
        )}\n`,
    )
    .action(() => {
      browser.outputHelp();
      defaultRuntime.error(
        danger(`Missing subcommand. Try: "${formatCliCommand("openclaw browser status")}"`),
      );
      defaultRuntime.exit(1);
    });

  addGatewayClientOptions(browser);

  const parentOpts = (cmd: Command) => cmd.parent?.opts?.() as BrowserParentOpts;

  registerBrowserManageCommands(browser, parentOpts);
  registerBrowserExtensionCommands(browser, parentOpts);
  registerBrowserInspectCommands(browser, parentOpts);
  registerBrowserActionInputCommands(browser, parentOpts);
  registerBrowserActionObserveCommands(browser, parentOpts);
  registerBrowserDebugCommands(browser, parentOpts);
  registerBrowserStateCommands(browser, parentOpts);
}
