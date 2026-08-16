import { runMochaSuite } from "../mochaRunner";

/**
 * Mocha entry point for the UI integration suite (runs inside the Extension
 * Development Host, with the dummy SFDX project workspace opened).
 */
export async function run(): Promise<void> {
  return runMochaSuite({
    testsRoot: __dirname,
    pattern: "**/*.test.js",
    // Real VS Code + real (mocked) CLI processes: needs way more than the
    // 2s mocha default
    timeout: 120000,
  });
}
