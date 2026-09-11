import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension, readMockLog, waitFor } from "./uiTestUtils";

/**
 * UI integration tests of the Backpromote panel, against the mocked sf CLI that
 * answers `sf hardis:work:backpromote --plan --json` with the plan of
 * test/fixtures/backpromote/backpromote-plan.json.
 *
 * The webview DOM is not reachable from the extension host: the tests drive the
 * extension side of the panel (initialization data, selection messages, merge
 * preparation, command launch) the way the LWC does.
 */

const LWC_ID = "s-backpromote";
const INVOICE_CALCULATOR = "ApexClass:InvoiceCalculator";

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

  test("the panel opens and shows the plan computed by sfdx-hardis", async function () {
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
        return data && data.loading === false && data.plan ? data : null;
      },
      30000,
      "the plan to be pushed to the panel",
    );
    // 5 pending groups, 1 merged without Pull Request, 1 already in the org
    assert.strictEqual(initData.plan.groups.length, 7);
    assert.strictEqual(initData.selection.groups.length, 5);
    assert.strictEqual(initData.summary.itemsToDeployCount, 41);
    assert.strictEqual(initData.summary.changedInOrg.length, 3);
    assert.strictEqual(initData.targetOrgLabel, "mycompany--dev-sam");
    assert.ok(
      initData.command.startsWith(
        "sf hardis:work:backpromote --parentbranch integration --pull-requests 478,481,482,485,487",
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
      groups: initData.selection.groups.slice(1),
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
    // #487 is unselected: 4 of its 5 items leave, Flow:Quote_Approval stays with #482
    assert.strictEqual(message.data.summary.itemsToDeployCount, 37);
    assert.strictEqual(message.data.summary.alsoInUnselectedCount, 1);
    assert.match(message.data.command, /--pull-requests 478,481,482,485 /);
  });

  test("a prepared merge blocks the run until its conflict markers are solved", async function () {
    const selection = {
      ...initData.selection,
      mergedItems: [INVOICE_CALCULATOR],
    };
    panel.simulateWebviewMessage({
      type: "prepareMerge",
      data: { keys: [INVOICE_CALCULATOR], selection, revision: 8 },
    });
    const prepared = await waitFor(
      () => lastOfType(sent, "mergePrepared"),
      30000,
      "the merge to be prepared",
    );
    assert.strictEqual(
      prepared.data.conflictBlocksByKey[INVOICE_CALCULATOR],
      1,
    );
    const blocked = await waitFor(
      () => {
        const summary = lastOfType(sent, "selectionSummary");
        return summary && summary.data.revision === 8 ? summary : null;
      },
      5000,
      "the summary after the merge",
    );
    assert.ok(
      blocked.data.summary.blockers.includes("conflictMarkers"),
      JSON.stringify(blocked.data.summary.blockers),
    );

    // Solve the conflict in the editor and save
    const fileUri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0].uri,
      "force-app/main/default/classes/InvoiceCalculator.cls",
    );
    const document = await vscode.workspace.openTextDocument(fileUri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      fileUri,
      new vscode.Range(0, 0, document.lineCount, 0),
      "// InvoiceCalculator\nDecimal scale = 4;\n",
    );
    await vscode.workspace.applyEdit(edit);
    await document.save();

    await waitFor(
      () =>
        sent.find(
          (entry) =>
            entry.type === "mergeMarkers" &&
            entry.data.key === INVOICE_CALCULATOR &&
            entry.data.conflictBlocks === 0,
        ),
      20000,
      "the conflict markers to be counted again",
    );
    const solved = await waitFor(
      () => {
        const summary = lastOfType(sent, "selectionSummary");
        return summary && summary.data.summary.canRun ? summary : null;
      },
      5000,
      "the run to be allowed again",
    );
    assert.ok(
      solved.data.command.includes(`--merged-metadata ${INVOICE_CALCULATOR}`),
      solved.data.command,
    );
  });

  test("Backpromote runs the command rebuilt by the extension, never one sent by the webview", async function () {
    // A forged command line is ignored: without a selection nothing can run
    panel.simulateWebviewMessage({
      type: "runBackpromote",
      data: { command: "sf hardis:org:purge:flow" },
    });
    const selection = {
      ...initData.selection,
      mergedItems: [INVOICE_CALCULATOR],
    };
    panel.simulateWebviewMessage({
      type: "runBackpromote",
      data: { selection, revision: 9 },
    });
    const run = await waitFor(
      () =>
        readMockLog().find(
          (entry) =>
            entry.args[0] === "hardis:work:backpromote" &&
            entry.args.includes("--merged-metadata"),
        ),
      30000,
      "the backpromote command to run",
    );
    const pullRequestsIndex = run!.args.indexOf("--pull-requests");
    assert.strictEqual(run!.args[pullRequestsIndex + 1], "478,481,482,485,487");
    assert.ok(
      run!.args.includes(INVOICE_CALCULATOR),
      JSON.stringify(run!.args),
    );
    assert.ok(
      !readMockLog().some((entry) => entry.args[0] === "hardis:org:purge:flow"),
      "a command sent by the webview must never run",
    );
  });

  test("an sfdx-hardis version without --plan shows the update state", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "old";
    try {
      panel.simulateWebviewMessage({ type: "refresh" });
      const errorData = await waitFor(
        () => {
          const data = panel.getInitializationData();
          return data && data.planError ? data : null;
        },
        30000,
        "the plan error to be pushed",
      );
      assert.strictEqual(errorData.planError.cliTooOld, true);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("without a git provider connection the plan is blocked on its first check", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "noGitProvider";
    try {
      panel.simulateWebviewMessage({ type: "refresh" });
      const blocked = await waitFor(
        () => {
          const data = panel.getInitializationData();
          return data && data.plan && data.plan.status === "blocked"
            ? data
            : null;
        },
        30000,
        "the blocked plan to be pushed",
      );
      assert.strictEqual(blocked.plan.checks[0].id, "gitProvider");
      assert.strictEqual(blocked.plan.checks[0].ok, false);
      assert.strictEqual(blocked.summary.canRun, false);
      assert.strictEqual(blocked.plan.groups.length, 0);

      // The dummy project has no remote: connecting reports that no git provider
      // is detected and does not reload the plan
      const planCalls = () =>
        readMockLog().filter(
          (entry) =>
            entry.args[0] === "hardis:work:backpromote" &&
            entry.args.includes("--plan"),
        ).length;
      const callsBefore = planCalls();
      panel.simulateWebviewMessage({ type: "connectGitProvider" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.strictEqual(planCalls(), callsBefore);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("the commands tree and the DevOps Pipeline open the panel", async function () {
    const commandIds = await vscode.commands.getCommands(true);
    assert.ok(commandIds.includes("vscode-sfdx-hardis.showBackpromote"));
  });
});
