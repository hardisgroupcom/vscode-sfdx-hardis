import * as assert from "assert";
import * as vscode from "vscode";
import { RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION } from "../../constants";
import { activateExtension, readMockLog, waitFor } from "./uiTestUtils";

/**
 * UI integration tests of the DORA metrics panel, against the mocked sf CLI that
 * answers `sf hardis:doc:dora-report --data-only` with
 * test/fixtures/sf-shim/dora-report.json.
 *
 * The webview DOM is not reachable from the extension host: the tests drive the
 * extension side of the panel (state pushed to the webview, commands run for
 * each message of the LWC) the way the LWC does.
 */

const LWC_ID = "s-dora-metrics";
const SHOW_COMMAND = "vscode-sfdx-hardis.showDoraMetrics";

function doraCalls(): any[] {
  return readMockLog().filter(
    (entry) => entry.args[0] === "hardis:doc:dora-report",
  );
}

function dataCalls(): any[] {
  return doraCalls().filter((entry) => entry.args.includes("--data-only"));
}

function periodOf(call: any): string {
  return call.args[call.args.indexOf("--period") + 1];
}

suite("DORA metrics panel UI tests", function () {
  let panelManager: any;
  let panel: any;
  const tokenBefore = process.env.GITHUB_TOKEN;

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
    // The panel passes the git provider token to sfdx-hardis: the mock never calls GitHub
    process.env.GITHUB_TOKEN = "ghp_mock_token";
  });

  suiteTeardown(function () {
    delete process.env.SF_MOCK_DORA;
    if (tokenBefore === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = tokenBefore;
    }
    panelManager?.disposePanel(LWC_ID);
  });

  setup(function () {
    delete process.env.SF_MOCK_DORA;
  });

  /** The state of the panel once sfdx-hardis answered */
  async function waitForLoaded(
    label: string,
    accept: (state: any) => boolean = () => true,
  ): Promise<any> {
    return waitFor(
      () => {
        const state = panel.getInitializationData();
        return state && state.loading === false && accept(state) ? state : null;
      },
      40000,
      label,
    );
  }

  async function openPanel(args?: any): Promise<any> {
    panelManager.disposePanel(LWC_ID);
    await vscode.commands.executeCommand(SHOW_COMMAND, args);
    panel = await waitFor(
      () => panelManager.getPanel(LWC_ID),
      10000,
      "DORA metrics panel to open",
    );
    // What the panel shows before sfdx-hardis answers
    return { ...panel.getInitializationData() };
  }

  /**
   * Sends what the LWC sends and waits for the answer. The handler puts the panel in its
   * loading state before it returns, so the next loaded state is the answer of this request.
   */
  async function load(data: any, label: string): Promise<any> {
    panel.simulateWebviewMessage({ type: "loadDoraMetrics", data });
    assert.strictEqual(
      panel.getInitializationData().loading,
      true,
      `loading state (${label})`,
    );
    return waitForLoaded(label);
  }

  test("the panel opens at once on a loading state, then shows what sfdx-hardis computed", async function () {
    const opening = await openPanel({ period: 90 });
    assert.strictEqual(
      opening.loading,
      true,
      "the panel opens before the CLI answers",
    );
    assert.strictEqual(opening.period, 90);
    assert.deepStrictEqual(opening.periods, [30, 90, 180, 365]);
    assert.strictEqual(opening.error, null);
    assert.strictEqual(
      opening.minimalCliVersion,
      RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
    );

    const state = await waitForLoaded("the report", (data) => !!data.report);
    assert.strictEqual(state.error, null);
    assert.deepStrictEqual(
      state.report.branches.map((branch: any) => branch.name),
      ["integration", "uat", "preprod", "main"],
    );
    // The values are the ones of sfdx-hardis, untouched
    const preprod = state.report.branches[2];
    assert.strictEqual(preprod.metrics.changeFailureRate.percent, 23.1);
    assert.strictEqual(preprod.metrics.changeFailureRate.level, "low");
    assert.strictEqual(preprod.attention[0].code, "deploymentFailing");
    assert.strictEqual(state.report.contributors.length, 3);
    assert.ok(state.readAt, "the reading time is kept");

    const call = dataCalls().pop();
    assert.ok(call, "sf hardis:doc:dora-report --data-only must be called");
    for (const flag of ["--agent", "--data-only", "--compare", "--json"]) {
      assert.ok(call.args.includes(flag), `${flag} in ${call.args.join(" ")}`);
    }
    assert.strictEqual(periodOf(call), "90");
    assert.ok(!call.args.includes("--refresh"));
    assert.ok(!call.args.includes("--pdf"));
  });

  test("opened again, the panel shows the last result while sfdx-hardis reads the git provider", async function () {
    await openPanel({ period: 90 });
    const first = await waitForLoaded("the report", (data) => !!data.report);
    // The last result is written in the background
    await new Promise((resolve) => setTimeout(resolve, 500));
    const opening = await openPanel();
    assert.strictEqual(opening.loading, true);
    assert.ok(opening.report, "the last result is shown at once");
    assert.strictEqual(opening.report.branches.length, 4);
    assert.strictEqual(opening.readAt, first.readAt);
    const state = await waitForLoaded(
      "the new report",
      (data) => !!data.report && data.readAt !== first.readAt,
    );
    assert.strictEqual(state.error, null);
  });

  test("the period chosen is passed to sfdx-hardis and remembered for the session", async function () {
    await openPanel({ period: 90 });
    await waitForLoaded("the report", (data) => !!data.report);
    const state = await load({ period: 30, refresh: false }, "30 days");
    assert.strictEqual(state.period, 30);
    assert.strictEqual(state.report.period.days, 30);
    assert.strictEqual(periodOf(dataCalls().pop()), "30");

    // Closed and opened again without a period: the one chosen is still there
    const opening = await openPanel();
    assert.strictEqual(opening.period, 30);
    await waitForLoaded("the report", (data) => !!data.report);
    assert.strictEqual(periodOf(dataCalls().pop()), "30");

    // A period the panel does not offer is never written on a command line
    const fallback = await load(
      { period: "7 --pdf", refresh: false },
      "bad period",
    );
    assert.strictEqual(fallback.period, 90);
    assert.strictEqual(periodOf(dataCalls().pop()), "90");
  });

  test("Refresh reads everything again, without the cache of sfdx-hardis", async function () {
    await openPanel({ period: 90 });
    await waitForLoaded("the report", (data) => !!data.report);
    const state = await load({ period: 90, refresh: true }, "refresh");
    assert.ok(state.report);
    const call = dataCalls().pop();
    assert.ok(call.args.includes("--refresh"), call.args.join(" "));
    assert.strictEqual(periodOf(call), "90");
  });

  test("an sfdx-hardis that does not know the panel asks to be upgraded", async function () {
    await openPanel({ period: 90 });
    await waitForLoaded("the report", (data) => !!data.report);
    process.env.SF_MOCK_DORA = "old";
    const old = await load({ period: 90, refresh: false }, "old CLI");
    assert.strictEqual(old.error.kind, "oldCli");
    // A report read from an org, without branches, is the same case
    process.env.SF_MOCK_DORA = "legacy";
    const legacy = await load({ period: 90, refresh: false }, "legacy report");
    assert.strictEqual(legacy.error.kind, "oldCli");
    // Try again, once sfdx-hardis is upgraded
    delete process.env.SF_MOCK_DORA;
    const upgraded = await load({ period: 90, refresh: false }, "upgraded");
    assert.strictEqual(upgraded.error, null);
    assert.ok(upgraded.report);
  });

  test("a failed reading shows the message of sfdx-hardis, or asks to connect when there is no token", async function () {
    await openPanel({ period: 90 });
    await waitForLoaded("the report", (data) => !!data.report);
    process.env.SF_MOCK_DORA = "error";
    const failed = await load({ period: 90, refresh: false }, "failed reading");
    assert.strictEqual(failed.error.kind, "cli");
    assert.ok(
      failed.error.message.includes("cannot read the CI jobs"),
      failed.error.message,
    );
    assert.ok(failed.report, "the last result stays under the error");

    // Same failure without any git provider token: the panel offers to connect
    delete process.env.GITHUB_TOKEN;
    try {
      const noToken = await load({ period: 90, refresh: false }, "no token");
      assert.strictEqual(noToken.error.kind, "noGitProvider");
    } finally {
      process.env.GITHUB_TOKEN = "ghp_mock_token";
    }
  });

  test("Export runs the real report command in the command runner", async function () {
    await openPanel({ period: 90 });
    await waitForLoaded("the report", (data) => !!data.report);
    const knownPanels = new Set<string>(panelManager.getActivePanelIds());
    panel.simulateWebviewMessage({
      type: "exportDoraReport",
      data: { format: "pdf" },
    });
    const commandPanelId = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !knownPanels.has(id),
          ),
      20000,
      "the command execution panel of the export",
    );
    const call = await waitFor(
      () => doraCalls().find((entry) => entry.args.includes("--pdf")),
      20000,
      "sf hardis:doc:dora-report --pdf to run",
    );
    assert.ok(!call.args.includes("--data-only"), call.args.join(" "));
    assert.strictEqual(periodOf(call), "90");
    panelManager.disposePanel(commandPanelId);
  });

  test("the command of the DevOps Pipeline menu and of the commands tree is registered", async function () {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(SHOW_COMMAND));
    await openPanel({ period: 90 });
    const opened = panel;
    await waitForLoaded("the report", (data) => !!data.report);
    // The menu item posts runVsCodeCommand: the panel already open is brought back
    panel.simulateWebviewMessage({
      type: "runVsCodeCommand",
      data: { command: SHOW_COMMAND },
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.strictEqual(panelManager.getPanel(LWC_ID), opened, "the same panel");
    await waitForLoaded("the report", (data) => !!data.report);
  });
});
