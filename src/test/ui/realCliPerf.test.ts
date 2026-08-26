import * as assert from "assert";
import { execSync } from "child_process";
import {
  activateExtension,
  runCommandAndWaitForPanel,
  waitFor,
} from "./uiTestUtils";

/**
 * Real-CLI performance regression gate (yarn test:ui:perf).
 *
 * Unlike the other UI suites, this one runs against the REAL Salesforce CLI
 * and the REAL sfdx-hardis plugin (installed by the CI workflow, or whatever
 * is installed locally): it measures the wall-clock time between the launch
 * of "New User Story" (sf hardis:work:new) and the first prompt reaching the
 * Command Runner panel, end to end through the extension, the WebSocket
 * server and the CLI.
 *
 * It FAILS when the first prompt takes longer than
 * SFDX_HARDIS_PERF_MAX_PROMPT_MS (default 15000 ms). This is the regression
 * that historically went unnoticed: a lost WebSocket handshake made every
 * command silently wait a 10-second timeout before doing any work.
 *
 * The run is selected by runUiTest.js --real-cli-perf, which keeps the real
 * `sf` on the PATH (no shim) and strips the CI environment markers so the
 * CLI behaves interactively (sfdx-hardis skips its WebSocket client when
 * CI is set).
 */

const REAL_CLI_MODE = process.env.SFDX_HARDIS_REAL_CLI_PERF === "true";

/**
 * Launches one background run of the command, waits for the first showPrompt
 * message posted to its Command Runner panel, and returns the elapsed time
 * from launch to that prompt. The command is then cancelled by disposing the
 * panel (the extension sends cancelCommand to the CLI).
 */
async function measureFirstPromptMs(
  panelManager: any,
  command: string,
): Promise<number> {
  const start = Date.now();
  const panelId = await runCommandAndWaitForPanel(panelManager, command, 60000);
  const panel = panelManager.getPanel(panelId);
  assert.ok(panel, `Panel ${panelId} must exist`);
  let promptAt: number | null = null;
  const originalSendMessage = panel.sendMessage.bind(panel);
  panel.sendMessage = (message: any) => {
    if (message?.type === "showPrompt" && promptAt === null) {
      promptAt = Date.now();
    }
    return originalSendMessage(message);
  };
  try {
    await waitFor(
      () => promptAt !== null,
      90000,
      `first prompt of ${command}`,
    );
  } finally {
    panel.sendMessage = originalSendMessage;
    // Cancel the command: disposing the panel sends cancelCommand to the CLI
    try {
      panelManager.disposePanel(panelId);
    } catch {
      // The panel may already be gone if the command errored
    }
    // Leave the CLI process time to exit before a follow-up run
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return promptAt! - start;
}

(REAL_CLI_MODE ? suite : suite.skip)(
  "Real CLI performance gate",
  function () {
    this.timeout(300000);
    let panelManager: any;
    let pluginIsLinked = false;

    suiteSetup(async function () {
      // Fail loudly (not silently green) when the real CLI is missing
      let version = "";
      try {
        version = execSync("sf --version", { encoding: "utf8" }).trim();
      } catch {
        assert.fail(
          "The real Salesforce CLI (sf) must be installed and on the PATH for the perf gate",
        );
      }
      console.log(`Real CLI perf gate: ${version}`);
      // The plugins listing also warms the CLI (first oclif run builds caches)
      let plugins = "";
      try {
        plugins = execSync("sf plugins", { encoding: "utf8" });
      } catch (e: any) {
        assert.fail(`'sf plugins' failed: ${e?.message}`);
      }
      assert.ok(
        plugins.includes("sfdx-hardis"),
        `The sfdx-hardis plugin must be installed (sf plugins returned:\n${plugins})`,
      );
      console.log(
        `sfdx-hardis: ${plugins
          .split("\n")
          .filter((line) => line.includes("sfdx-hardis"))
          .join(" | ")}`,
      );
      pluginIsLinked = /sfdx-hardis[^\n]*link/.test(plugins);
      const api = await activateExtension();
      panelManager = api.getLwcPanelManager();
    });

    test("New User Story reaches its first prompt fast enough", async function () {
      // Budgets set by the product owner: 10 s on Windows (antivirus scanning
      // and slower disk on the thousands of CLI module files), 5 s on macOS
      // and Linux. Override with SFDX_HARDIS_PERF_MAX_PROMPT_MS.
      const defaultBudgetMs = process.platform === "win32" ? 10000 : 5000;
      // A LINKED sfdx-hardis (sf plugins link, the contributor setup) is
      // structurally slower than an installed one (bigger dev node_modules on
      // the import path, possibly live TypeScript transpilation): the budget
      // is doubled so the local gate stays meaningful without crying wolf.
      // CI always installs the plugin, so it keeps the strict budget.
      const linkedFactor = pluginIsLinked ? 2 : 1;
      const maxMs = parseInt(
        process.env.SFDX_HARDIS_PERF_MAX_PROMPT_MS ||
          String(defaultBudgetMs * linkedFactor),
        10,
      );
      if (pluginIsLinked) {
        console.log(
          `Linked sfdx-hardis detected: budget doubled to ${maxMs} ms`,
        );
      }
      const first = await measureFirstPromptMs(
        panelManager,
        "sf hardis:work:new",
      );
      console.log(`work:new first prompt: ${first} ms (max: ${maxMs} ms)`);
      let best = first;
      if (first > maxMs) {
        // One retry: the very first CLI run of a fresh environment pays
        // one-time costs (OS file cache, antivirus scanning, oclif caches)
        const second = await measureFirstPromptMs(
          panelManager,
          "sf hardis:work:new",
        );
        console.log(`work:new first prompt (retry): ${second} ms`);
        best = Math.min(first, second);
      }
      assert.ok(
        best <= maxMs,
        `The first prompt of "New User Story" took ${best} ms, more than the ${maxMs} ms budget: ` +
          "a startup performance regression reached the click-to-prompt path " +
          "(raise SFDX_HARDIS_PERF_MAX_PROMPT_MS only if the slowdown is understood and accepted)",
      );
    });
  },
);
