import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension, readMockLog, waitFor } from "./uiTestUtils";

/**
 * UI integration tests of the Backpromote panel, against the mocked sf CLI that
 * answers `sf hardis:work:backpromote --plan --json` with the plan of
 * test/fixtures/backpromote/backpromote-plan.json.
 *
 * The webview DOM is not reachable from the extension host: the tests drive the
 * extension side of the panel (initialization data, selection messages, command
 * launch) the way the LWC does.
 */

const LWC_ID = "s-backpromote";
const INVOICE_CALCULATOR_FILE = "force-app/main/default/classes/InvoiceCalculator.cls";

/** Records the messages the extension sends to the webview of a panel. */
function recordSentMessages(panel: any): any[] {
  const sent: any[] = [];
  const original = panel.sendMessage.bind(panel);
  panel.sendMessage = (message: any) => {
    sent.push(message);
    original(message);
  };
  return sent;
}

function lastOfType(sent: any[], type: string): any {
  return [...sent].reverse().find((message) => message.type === type);
}

suite("Backpromote panel UI tests", function () {
  let panelManager: any;
  let panel: any;
  let sent: any[] = [];
  let initData: any;

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  suiteTeardown(function () {
    delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    panelManager?.disposePanel(LWC_ID);
  });

  async function openPanel(): Promise<void> {
    panelManager.disposePanel(LWC_ID);
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showBackpromote");
    panel = await waitFor(
      () => panelManager.getPanel(LWC_ID),
      10000,
      "backpromote panel to open",
    );
    sent = recordSentMessages(panel);
    initData = await waitFor(
      () => {
        const data = panel.getInitializationData();
        return data && data.loading === false && (data.plan || data.planError)
          ? data
          : null;
      },
      30000,
      "the plan to be pushed to the panel",
    );
  }

  test("the panel opens and shows the plan computed by sfdx-hardis", async function () {
    await openPanel();
    assert.strictEqual(initData.plan.status, "ready");
    assert.strictEqual(initData.plan.pullRequests.length, 3);
    assert.strictEqual(initData.summary.itemsToDeployCount, 6);
    assert.strictEqual(initData.summary.conflicts.length, 2);
    assert.strictEqual(initData.summary.actionsToRunCount, 3);
    assert.strictEqual(initData.targetOrgLabel, "mycompany--dev-sam");
    assert.ok(
      initData.command.startsWith(
        "sf hardis:work:backpromote --parentbranch integration --auto",
      ),
      initData.command,
    );
    const planCall = readMockLog().find(
      (entry) =>
        entry.args[0] === "hardis:work:backpromote" &&
        entry.args.includes("--plan"),
    );
    assert.ok(planCall, "sf hardis:work:backpromote --plan must be called");
    assert.ok(planCall!.args.includes("--json"));
  });

  test("the extension summarizes every selection change", async function () {
    const selection = {
      ...initData.selection,
      excludedItems: ["Layout:Opportunity-Sales Layout"],
      conflictDecisions: {
        ...initData.selection.conflictDecisions,
        [INVOICE_CALCULATOR_FILE]: "overwrite",
      },
    };
    panel.simulateWebviewMessage({
      type: "selectionChanged",
      data: { selection, revision: 7 },
    });
    const message = await waitFor(
      () =>
        sent.find(
          (entry) =>
            entry.type === "selectionSummary" && entry.data.revision === 7,
        ),
      5000,
      "the summary of the new selection",
    );
    assert.strictEqual(message.data.summary.itemsToDeployCount, 5);
    assert.match(
      message.data.command,
      /--exclude-metadata "Layout:Opportunity-Sales Layout"/,
    );
    assert.match(
      message.data.command,
      /--on-conflict force-app\/main\/default\/classes\/InvoiceCalculator\.cls=overwrite/,
    );
  });

  test("Backpromote runs the command rebuilt by the extension, never one sent by the webview", async function () {
    panel.simulateWebviewMessage({
      type: "runBackpromote",
      data: {
        selection: { ...initData.selection, command: "sf hardis:evil" },
        revision: 8,
      },
    });
    const started = await waitFor(
      () => lastOfType(sent, "runStarted"),
      5000,
      "the run to start",
    );
    assert.ok(
      started.data.command.startsWith(
        "sf hardis:work:backpromote --parentbranch integration --auto",
      ),
      started.data.command,
    );
    assert.ok(!started.data.command.includes("evil"));
  });

  test("an sfdx-hardis version without --plan shows the update state", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "old";
    try {
      await openPanel();
      assert.ok(initData.planError, "a plan error is expected");
      assert.strictEqual(initData.planError.cliTooOld, true);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("a run started from a major branch is blocked on its branch check", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "notUserStory";
    try {
      await openPanel();
      assert.strictEqual(initData.plan.status, "blocked");
      const check = initData.plan.checks.find(
        (entry: any) => entry.id === "currentBranch",
      );
      assert.strictEqual(check.ok, false);
      assert.strictEqual(initData.summary.canRun, false);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("a parent branch that is not a major branch blocks the plan until a major branch is picked", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "parentNotMajor";
    try {
      await openPanel();
      assert.strictEqual(initData.plan.status, "blocked");
      assert.deepStrictEqual(initData.plan.parentBranchChoices, [
        "integration",
        "uat",
        "preprod",
      ]);
      panel.simulateWebviewMessage({
        type: "changeParentBranch",
        data: { parentBranch: "uat" },
      });
      const ready = await waitFor(
        () => {
          const data = panel.getInitializationData();
          return data && data.loading === false && data.plan?.status === "ready"
            ? data
            : null;
        },
        30000,
        "the plan of the picked parent branch",
      );
      assert.strictEqual(ready.plan.parentBranch, "uat");
      assert.match(ready.command, /--parentbranch uat /);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("a merge that stopped on conflicts waits for its markers before continuing", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "mergeInProgress";
    try {
      await openPanel();
      assert.strictEqual(initData.plan.status, "mergeInProgress");
      assert.deepStrictEqual(initData.summary.blockers, ["conflictMarkers"]);
      assert.strictEqual(initData.summary.markersLeft.length, 1);
      assert.strictEqual(initData.summary.canRun, false);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("the commands tree and the DevOps Pipeline open the panel", async function () {
    await openPanel();
    assert.ok(panelManager.getPanel(LWC_ID), "the panel is open");
    assert.strictEqual(initData.plan.status, "ready");
  });
});
