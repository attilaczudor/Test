/**
 * @module acp-cli
 *
 * Registers the `openclaw acp` CLI command and its `client` subcommand.
 *
 * The ACP (Agent Communication Protocol) bridge connects the OpenClaw gateway
 * to external ACP-compatible agents and clients. This module provides:
 * - `openclaw acp`         - Start an ACP bridge backed by the gateway
 * - `openclaw acp client`  - Run an interactive ACP client session
 *
 * Secrets (tokens, passwords) can be supplied directly via flags or read
 * from files to avoid leaking credentials through process listings.
 */

import type { Command } from "commander";
import { runAcpClientInteractive } from "../acp/client.js";
import { readSecretFromFile } from "../acp/secret-file.js";
import { serveAcpGateway } from "../acp/server.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { inheritOptionFromParent } from "./command-options.js";

/**
 * Resolves a secret value from either a direct CLI flag or a file path flag.
 *
 * Throws if both the direct and file flags are provided simultaneously.
 * When a file path is given, reads the secret from that file.
 *
 * @param params - Object containing `direct` value, `file` path, flag names, and label
 * @returns The resolved secret string, or undefined if neither flag was provided
 * @throws {Error} If both direct and file flags are supplied
 */
function resolveSecretOption(params: {
  direct?: string;
  file?: string;
  directFlag: string;
  fileFlag: string;
  label: string;
}) {
  const direct = params.direct?.trim();
  const file = params.file?.trim();
  if (direct && file) {
    throw new Error(`Use either ${params.directFlag} or ${params.fileFlag} for ${params.label}.`);
  }
  if (file) {
    return readSecretFromFile(file, params.label);
  }
  return direct || undefined;
}

/**
 * Emits a warning to stderr when a secret is passed directly on the command line.
 *
 * Command-line arguments are visible in process listings (`ps`, `/proc`), so
 * passing secrets via `--token` or `--password` is insecure. This warns the
 * user to prefer file-based or environment-variable-based secret injection.
 *
 * @param flag - The CLI flag name that was used to pass the secret
 */
function warnSecretCliFlag(flag: "--token" | "--password") {
  defaultRuntime.error(
    `Warning: ${flag} can be exposed via process listings. Prefer ${flag}-file or environment variables.`,
  );
}

/**
 * Registers the `acp` command and `acp client` subcommand on the given Commander program.
 *
 * The `acp` command starts an ACP bridge that proxies between the OpenClaw gateway
 * and ACP-compatible consumers. It supports gateway URL, authentication, session
 * management, and verbose logging options.
 *
 * The `acp client` subcommand launches an interactive ACP client for manual
 * testing and debugging of ACP sessions.
 *
 * @param program - The root Commander program to attach the command to
 */
export function registerAcpCli(program: Command) {
  const acp = program.command("acp").description("Run an ACP bridge backed by the Gateway");

  acp
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--token-file <path>", "Read gateway token from file")
    .option("--password <password>", "Gateway password (if required)")
    .option("--password-file <path>", "Read gateway password from file")
    .option("--session <key>", "Default session key (e.g. agent:main:main)")
    .option("--session-label <label>", "Default session label to resolve")
    .option("--require-existing", "Fail if the session key/label does not exist", false)
    .option("--reset-session", "Reset the session key before first use", false)
    .option("--no-prefix-cwd", "Do not prefix prompts with the working directory", false)
    .option("-v, --verbose", "Verbose logging to stderr", false)
    .addHelpText(
      "after",
      () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/acp", "docs.openclaw.ai/cli/acp")}\n`,
    )
    .action(async (opts) => {
      try {
        const gatewayToken = resolveSecretOption({
          direct: opts.token as string | undefined,
          file: opts.tokenFile as string | undefined,
          directFlag: "--token",
          fileFlag: "--token-file",
          label: "Gateway token",
        });
        const gatewayPassword = resolveSecretOption({
          direct: opts.password as string | undefined,
          file: opts.passwordFile as string | undefined,
          directFlag: "--password",
          fileFlag: "--password-file",
          label: "Gateway password",
        });
        if (opts.token) {
          warnSecretCliFlag("--token");
        }
        if (opts.password) {
          warnSecretCliFlag("--password");
        }
        await serveAcpGateway({
          gatewayUrl: opts.url as string | undefined,
          gatewayToken,
          gatewayPassword,
          defaultSessionKey: opts.session as string | undefined,
          defaultSessionLabel: opts.sessionLabel as string | undefined,
          requireExistingSession: Boolean(opts.requireExisting),
          resetSession: Boolean(opts.resetSession),
          prefixCwd: !opts.noPrefixCwd,
          verbose: Boolean(opts.verbose),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  acp
    .command("client")
    .description("Run an interactive ACP client against the local ACP bridge")
    .option("--cwd <dir>", "Working directory for the ACP session")
    .option("--server <command>", "ACP server command (default: openclaw)")
    .option("--server-args <args...>", "Extra arguments for the ACP server")
    .option("--server-verbose", "Enable verbose logging on the ACP server", false)
    .option("-v, --verbose", "Verbose client logging", false)
    .action(async (opts, command) => {
      const inheritedVerbose = inheritOptionFromParent<boolean>(command, "verbose");
      try {
        await runAcpClientInteractive({
          cwd: opts.cwd as string | undefined,
          serverCommand: opts.server as string | undefined,
          serverArgs: opts.serverArgs as string[] | undefined,
          serverVerbose: Boolean(opts.serverVerbose),
          verbose: Boolean(opts.verbose || inheritedVerbose),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
