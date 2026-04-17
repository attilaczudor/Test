/**
 * @module browser-cli-actions-input
 *
 * Re-exports the browser input action CLI command registrations.
 *
 * Input actions include click, type, press, hover, drag, select, upload, fill,
 * dialog, wait, and evaluate. These commands drive user interactions in the
 * browser via the gateway's browser automation API.
 */
export { registerBrowserActionInputCommands } from "./browser-cli-actions-input/register.js";
