/**
 * @module browser-cli-examples
 *
 * Curated lists of example CLI commands shown in the `openclaw browser --help` output.
 *
 * These examples are rendered in the help text footer to guide users through
 * common browser automation workflows. They are split into core examples
 * (lifecycle, tabs, screenshots, snapshots) and action examples (navigation,
 * interaction, form filling, downloads, debugging).
 */

/** Example commands for core browser operations (lifecycle, tabs, screenshots, snapshots) */
export const browserCoreExamples = [
  "openclaw browser status",
  "openclaw browser start",
  "openclaw browser stop",
  "openclaw browser tabs",
  "openclaw browser open https://example.com",
  "openclaw browser focus abcd1234",
  "openclaw browser close abcd1234",
  "openclaw browser screenshot",
  "openclaw browser screenshot --full-page",
  "openclaw browser screenshot --ref 12",
  "openclaw browser snapshot",
  "openclaw browser snapshot --format aria --limit 200",
  "openclaw browser snapshot --efficient",
  "openclaw browser snapshot --labels",
];

/** Example commands for browser action operations (navigation, clicking, typing, etc.) */
export const browserActionExamples = [
  "openclaw browser navigate https://example.com",
  "openclaw browser resize 1280 720",
  "openclaw browser click 12 --double",
  'openclaw browser type 23 "hello" --submit',
  "openclaw browser press Enter",
  "openclaw browser hover 44",
  "openclaw browser drag 10 11",
  "openclaw browser select 9 OptionA OptionB",
  "openclaw browser upload /tmp/openclaw/uploads/file.pdf",
  'openclaw browser fill --fields \'[{"ref":"1","value":"Ada"}]\'',
  "openclaw browser dialog --accept",
  'openclaw browser wait --text "Done"',
  "openclaw browser evaluate --fn '(el) => el.textContent' --ref 7",
  "openclaw browser console --level error",
  "openclaw browser pdf",
];
