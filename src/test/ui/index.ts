import { runMochaSuite } from "../mochaRunner";

/**
 * Mocha entry point for the UI integration suite (runs inside the Extension
 * Development Host, with the dummy SFDX project workspace opened).
 */
export async function run(): Promise<void> {
  // Documentation screenshot runs only execute the screenshot suite: the other
  // suites open and close panels, which would pollute the captures.
  const pattern =
    process.env.SFDX_HARDIS_DOC_SCREENSHOTS === "true"
      ? "**/docScreenshots.test.js"
      : "**/*.test.js";
  return runMochaSuite({
    testsRoot: __dirname,
    pattern,
    // Real VS Code + real (mocked) CLI processes: needs way more than the
    // 2s mocha default
    timeout: 120000,
  });
}
