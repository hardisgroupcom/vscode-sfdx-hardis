import * as assert from "assert";
import { RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION } from "../../constants";
import { CacheManager } from "../../utils/cache-manager";
import { SCRATCH_ORG_POOL_COUNTS_CACHE_KEY } from "../../utils/scratchOrgPoolUtils";
import {
  activateExtension,
  assertShowCommandBringsPanelBack,
  openFreshPanel,
  readMockLog,
  waitFor,
  waitForPanelLoaded,
} from "./uiTestUtils";

/**
 * UI integration tests of the Scratch Org Pool panel, against the mocked sf CLI that
 * answers `sf hardis:scratch:pool:view` with test/fixtures/sf-shim/scratch-org-pool.json.
 * SF_MOCK_POOL makes the mock answer a failure instead (see sf-mock.js).
 *
 * The webview DOM is not reachable from the extension host: the tests drive the
 * extension side of the panel (state pushed to the webview, commands run for
 * each message of the LWC) the way the LWC does.
 */

const LWC_ID = "s-scratch-org-pool";
const SHOW_COMMAND = "vscode-sfdx-hardis.showScratchOrgPool";

function callsOf(command: string): any[] {
  return readMockLog().filter(
    (entry) => entry.args && entry.args[0] === command,
  );
}

function viewCalls(): any[] {
  return callsOf("hardis:scratch:pool:view");
}

suite("Scratch Org Pool panel UI tests", function () {
  let panelManager: any;
  let panel: any;

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  suiteTeardown(function () {
    delete process.env.SF_MOCK_POOL;
    panelManager?.disposePanel(LWC_ID);
  });

  setup(function () {
    delete process.env.SF_MOCK_POOL;
  });

  /** The state of the panel once sfdx-hardis answered */
  const waitForLoaded = (label: string, accept?: (state: any) => boolean) =>
    waitForPanelLoaded(panel, label, accept);

  async function openPanel(): Promise<any> {
    panel = await openFreshPanel(panelManager, LWC_ID, SHOW_COMMAND);
    // What the panel shows before sfdx-hardis answers
    return { ...panel.getInitializationData() };
  }

  /**
   * Sends the request of the Refresh button and waits for the answer. The handler puts the
   * panel in its loading state before it returns, so the next loaded state is the answer.
   */
  async function reload(label: string): Promise<any> {
    panel.simulateWebviewMessage({ type: "loadScratchOrgPool", data: {} });
    assert.strictEqual(
      panel.getInitializationData().loading,
      true,
      `loading state (${label})`,
    );
    return waitForLoaded(label);
  }

  /** Runs what a card of the panel runs, and returns the command panel and the call of the mock */
  async function runFromPanel(
    command: string,
  ): Promise<{ commandPanelId: string; call: any }> {
    const knownPanels = new Set<string>(panelManager.getActivePanelIds());
    const knownCalls = callsOf(command.split(" ")[1]).length;
    panel.simulateWebviewMessage({ type: "runCommand", data: { command } });
    const commandPanelId = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !knownPanels.has(id),
          ),
      20000,
      `the command execution panel of ${command}`,
    );
    const call = await waitFor(
      () => callsOf(command.split(" ")[1])[knownCalls],
      20000,
      `${command} to run`,
    );
    return { commandPanelId, call };
  }

  test("the panel opens at once on a loading state, then shows the pool sfdx-hardis describes", async function () {
    const opening = await openPanel();
    assert.strictEqual(
      opening.loading,
      true,
      "the panel opens before the CLI answers",
    );
    assert.strictEqual(opening.error, null);
    assert.strictEqual(
      opening.minimalCliVersion,
      RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
    );

    const state = await waitForLoaded("the pool", (data) => !!data.pool);
    assert.strictEqual(state.error, null);
    const pool = state.pool;
    assert.strictEqual(pool.storageService, "gitProvider");
    assert.strictEqual(pool.available, 4);
    assert.strictEqual(pool.max, 5);
    assert.strictEqual(pool.canTake, true);
    assert.strictEqual(pool.keyStatus, "ok");
    assert.strictEqual(
      pool.dashboardUrl,
      "https://github.com/mycompany/mycompany-crm/issues/42",
    );
    // The four scratch orgs of the table
    assert.deepStrictEqual(
      pool.orgs.map((org: any) => org.alias),
      [
        "PO-x7CI-main_20260924_0312",
        "PO-x7CI-main_20261001_0312",
        "PO-x7CI-main_20261005_0313",
        "PO-x7CI-main_20261009_0312",
      ],
    );
    assert.deepStrictEqual(
      pool.orgs.map((org: any) => org.daysLeft),
      [12, 19, 23, 27],
    );
    // What the panel does not draw stays in the extension
    assert.ok(!("instanceUrl" in pool.orgs[0]));
    // The last scratch orgs taken, the failed creation and what the status cards show
    assert.strictEqual(pool.history.length, 6);
    assert.strictEqual(pool.history[0].by, "github-actions[bot]");
    assert.strictEqual(pool.history[0].pullRequest, "#128");
    assert.strictEqual(pool.failures.length, 1);
    assert.ok(pool.failures[0].error.includes("daily scratch org limit"));
    assert.ok(pool.lastRefresh.jobUrl.includes("/actions/runs/"));
    assert.deepStrictEqual(pool.devHubLimits, {
      activeScratchOrgs: { used: 9, max: 40 },
      dailyScratchOrgs: { used: 6, max: 80 },
    });
    assert.ok(state.readAt, "the reading time is kept");

    const call = viewCalls().pop();
    assert.ok(call, "sf hardis:scratch:pool:view must be called");
    assert.ok(call.args.includes("--json"), call.args.join(" "));
  });

  test("opened again, the panel shows the last pool while sfdx-hardis reads it again", async function () {
    await openPanel();
    const first = await waitForLoaded("the pool", (data) => !!data.pool);
    // The last result is written in the background
    await new Promise((resolve) => setTimeout(resolve, 500));
    const opening = await openPanel();
    assert.strictEqual(opening.loading, true);
    assert.ok(opening.pool, "the last pool is shown at once");
    assert.strictEqual(opening.pool.orgs.length, 4);
    assert.strictEqual(opening.readAt, first.readAt);
    const state = await waitForLoaded(
      "the new pool",
      (data) => !!data.pool && data.readAt !== first.readAt,
    );
    assert.strictEqual(state.error, null);
  });

  test("Refresh reads the pool again", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    const before = viewCalls().length;
    const state = await reload("refresh");
    assert.ok(state.pool);
    assert.strictEqual(viewCalls().length, before + 1);
  });

  test("a reading asked during a reading runs after it, once, and its answer is the one drawn", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    const before = viewCalls().length;
    // The answer of the first reading must not be drawn: the pool changed meanwhile
    process.env.SF_MOCK_POOL = "noGitProvider";
    process.env.SF_MOCK_POOL_DELAY_MS = "3000";
    panel.simulateWebviewMessage({ type: "loadScratchOrgPool", data: {} });
    await waitFor(
      () => viewCalls().length > before,
      20000,
      "the first reading to start",
    );
    delete process.env.SF_MOCK_POOL;
    delete process.env.SF_MOCK_POOL_DELAY_MS;
    // Three requests while it runs: one reading waits, not three
    for (let request = 0; request < 3; request++) {
      panel.simulateWebviewMessage({ type: "loadScratchOrgPool", data: {} });
    }
    assert.strictEqual(panel.getInitializationData().loading, true);
    const state = await waitForLoaded("the second reading");
    assert.strictEqual(state.error, null, "the older answer was not drawn");
    assert.strictEqual(state.pool.available, 4);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.strictEqual(viewCalls().length, before + 2);
  });

  test("the pool line of the status view gets the counts the panel reads", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    await waitFor(
      () => CacheManager.get<any>("project", SCRATCH_ORG_POOL_COUNTS_CACHE_KEY),
      5000,
      "the counts of the status view",
    );
    assert.deepStrictEqual(
      CacheManager.get<any>("project", SCRATCH_ORG_POOL_COUNTS_CACHE_KEY),
      { available: 4, max: 5 },
    );
    // A project that lost its pool loses its line
    process.env.SF_MOCK_POOL = "noPool";
    await reload("no pool");
    await waitFor(
      () =>
        !CacheManager.get<any>("project", SCRATCH_ORG_POOL_COUNTS_CACHE_KEY),
      5000,
      "the counts of the status view to be forgotten",
    );
  });

  test("a git provider that cannot be read asks to connect, and keeps the last pool on screen", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    process.env.SF_MOCK_POOL = "noGitProvider";
    const state = await reload("no git provider");
    assert.strictEqual(state.error.kind, "noGitProvider");
    assert.ok(state.error.message.includes("No git provider token"));
    assert.ok(state.pool, "the last pool stays under the error");
    // Try again, once connected
    delete process.env.SF_MOCK_POOL;
    const connected = await reload("connected");
    assert.strictEqual(connected.error, null);
    assert.strictEqual(connected.pool.available, 4);
  });

  test("a project without a pool offers to configure one, and shows no pool", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    process.env.SF_MOCK_POOL = "noPool";
    const state = await reload("no pool");
    assert.strictEqual(state.error.kind, "noPool");
    assert.strictEqual(state.pool, null);
    // The pool kept from the last reading is forgotten: opened again, the panel shows none
    await new Promise((resolve) => setTimeout(resolve, 500));
    const opening = await openPanel();
    assert.strictEqual(opening.loading, true);
    assert.strictEqual(opening.pool, null, "no pool from an earlier reading");
    await waitForLoaded("no pool again");
  });

  test("an sfdx-hardis that answers the pool storage asks to be upgraded, and its credentials go nowhere", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    process.env.SF_MOCK_POOL = "old";
    const state = await reload("old CLI");
    assert.strictEqual(state.error.kind, "cliTooOld");
    assert.strictEqual(state.pool, null);
    assert.ok(
      !JSON.stringify(state).includes("mock-pool-credential"),
      "the credentials of the pool storage never reach the webview",
    );
    assert.ok(!JSON.stringify(state).includes("poolStorage"));
  });

  test("a failed reading shows the message of sfdx-hardis", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    process.env.SF_MOCK_POOL = "error";
    const state = await reload("failed reading");
    assert.strictEqual(state.error.kind, "other");
    assert.ok(
      state.error.message.includes("cannot be read"),
      state.error.message,
    );
    assert.ok(state.pool, "the last pool stays under the error");
  });

  test("Refill the pool runs the real command, and the pool is read again when it ends", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    const viewsBefore = viewCalls().length;
    const { commandPanelId, call } = await runFromPanel(
      "sf hardis:scratch:pool:refresh --agent",
    );
    assert.ok(call.args.includes("--agent"), call.args.join(" "));
    await waitFor(
      () => viewCalls().length > viewsBefore,
      30000,
      "the pool to be read again once the refill ended",
    );
    const state = await waitForLoaded("the pool after the refill");
    assert.strictEqual(state.error, null);
    assert.ok(state.pool);
    panelManager.disposePanel(commandPanelId);
  });

  test("Reset the pool and Get a scratch org run the real commands", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    const reset = await runFromPanel("sf hardis:scratch:pool:reset --agent");
    assert.ok(reset.call.args.includes("--agent"), reset.call.args.join(" "));
    panelManager.disposePanel(reset.commandPanelId);
    const take = await runFromPanel("sf hardis:scratch:create");
    assert.strictEqual(take.call.args[0], "hardis:scratch:create");
    panelManager.disposePanel(take.commandPanelId);
    await waitForLoaded("the pool after the commands");
  });

  test("the command of the DevOps Pipeline menu, the commands tree and the status view is registered", async function () {
    await openPanel();
    await waitForLoaded("the pool", (data) => !!data.pool);
    // The menu item posts runVsCodeCommand: the panel already open is brought back
    await assertShowCommandBringsPanelBack(
      panelManager,
      panel,
      LWC_ID,
      SHOW_COMMAND,
    );
    await waitForLoaded("the pool", (data) => !!data.pool);
  });
});
