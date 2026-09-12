import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { activateExtension, readMockLog, waitFor } from "./uiTestUtils";

/**
 * UI integration tests of the Backpromote panel, against the mocked sf CLI that
 * answers `sf hardis:work:backpromote` with the plan (version 3) of
 * test/fixtures/backpromote/backpromote-plan.json.
 *
 * The webview DOM is not reachable from the extension host: the tests drive the
 * extension side of the panel (initialization data, selection messages, merge
 * preparation, run) the way the LWC does.
 */

const LWC_ID = "s-backpromote";
const INVOICE_CALCULATOR_FILE = "force-app/main/default/classes/InvoiceCalculator.cls";
const CASE_LAYOUT_FILE = "force-app/main/default/layouts/Case-Case Layout.layout-meta.xml";

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

function backpromoteCalls(): any[] {
  return readMockLog().filter((entry) => entry.args[0] === "hardis:work:backpromote");
}

suite("Backpromote panel UI tests", function () {
  let panelManager: any;
  let panel: any;
  let sent: any[] = [];
  let initData: any;
  const tokenBefore = process.env.GITHUB_TOKEN;

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
    // The panel needs a git provider token: the mock never calls GitHub
    process.env.GITHUB_TOKEN = "ghp_mock_token";
  });

  // Files the tests write in the workspace, removed at the end
  const writtenFiles: string[] = [];

  suiteTeardown(function () {
    delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    if (tokenBefore === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = tokenBefore;
    }
    panelManager?.disposePanel(LWC_ID);
    for (const file of writtenFiles) {
      fs.rmSync(file, { force: true });
    }
  });

  function writeWorkspaceFile(absolutePath: string, content: string): void {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
    writtenFiles.push(absolutePath);
  }

  function lastPlanCall(): any {
    return [...backpromoteCalls()].reverse().find((entry) => entry.args.includes("--plan"));
  }

  async function waitForPlan(label: string, accept: (data: any) => boolean): Promise<any> {
    return waitFor(
      () => {
        const current = panel.getInitializationData();
        return current && current.loading === false && current.plan && accept(current) ? current : null;
      },
      40000,
      label,
    );
  }

  async function runAndWait(selection: any, revision: number, dirtyTree: any = null): Promise<any> {
    // Only a runFinished sent after this run counts: the panel may have run before
    const sentBefore = sent.length;
    panel.simulateWebviewMessage({ type: "runBackpromote", data: { selection, revision, dirtyTree } });
    await waitFor(() => sent.slice(sentBefore).find((entry) => entry.type === "runFinished"), 40000, "the run to finish");
    return panel.getInitializationData();
  }

  async function waitForPlanData(label: string): Promise<any> {
    return waitFor(
      () => {
        const data = panel.getInitializationData();
        return data && data.loading === false && (data.plan || data.planError || data.tokenMissing)
          ? data
          : null;
      },
      40000,
      label,
    );
  }

  async function openPanel(): Promise<void> {
    panelManager.disposePanel(LWC_ID);
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showBackpromote");
    panel = await waitFor(
      () => panelManager.getPanel(LWC_ID),
      10000,
      "backpromote panel to open",
    );
    sent = recordSentMessages(panel);
    initData = await waitForPlanData("the plan to be pushed to the panel");
  }

  test("the panel opens and shows the plan computed by sfdx-hardis with its default selection", async function () {
    await openPanel();
    assert.strictEqual(initData.tokenMissing, false);
    assert.ok(Array.isArray(initData.setup.orgs));
    assert.strictEqual(initData.plan.status, "ok");
    assert.strictEqual(initData.plan.pullRequests.length, 5);
    assert.strictEqual(initData.plan.window.startPullRequest, 415);
    assert.strictEqual(initData.targetOrgLabel, "dev1");
    assert.strictEqual(initData.summary.itemsToDeployCount, 5);
    assert.strictEqual(initData.summary.deletionsToDeleteCount, 1);
    assert.strictEqual(initData.summary.actionsToRunCount, 2);
    assert.strictEqual(initData.summary.canRun, true);
    assert.deepStrictEqual(initData.selection.excludedItems, ["Profile:Admin"]);
    assert.ok(initData.command.startsWith("sf hardis:work:backpromote --auto --run-id mock7f3a"), initData.command);
    const planCall = backpromoteCalls().find((entry) => entry.args.includes("--plan"));
    assert.ok(planCall, "sf hardis:work:backpromote --plan must be called");
    assert.ok(planCall!.args.includes("--json"));
    assert.ok(planCall!.args.includes("--parent-branch"));
    assert.ok(planCall!.args.includes("--target-org"));
  });

  test("the extension summarizes every selection change", async function () {
    const selection = {
      ...initData.selection,
      excludedItems: ["Flow:Quote_Approval"],
      diffDecisions: { ...initData.selection.diffDecisions, "Layout:Case-Case Layout": "org" },
    };
    panel.simulateWebviewMessage({
      type: "selectionChanged",
      data: { selection, revision: 7 },
    });
    const message = await waitFor(
      () => sent.find((entry) => entry.type === "selectionSummary" && entry.data.revision === 7),
      5000,
      "the summary of the new selection",
    );
    // Flow left out, Profile still held back by no-overwrite, the layout kept as org version
    assert.strictEqual(message.data.summary.itemsToDeployCount, 3);
    assert.strictEqual(message.data.summary.keptOrgCount, 1);
    assert.match(message.data.command, /--exclude-metadata Flow:Quote_Approval/);
    assert.match(message.data.command, /--exclude-metadata Profile:Admin/);
    assert.ok(message.data.command.includes(`--on-diff "${CASE_LAYOUT_FILE}=org"`), message.data.command);
  });

  test("picking another start Pull Request computes the plan again for that window", async function () {
    panel.simulateWebviewMessage({ type: "changeStartPullRequest", data: { number: 417 } });
    const data = await waitFor(
      () => {
        const current = panel.getInitializationData();
        return current && current.loading === false && current.plan?.window?.startPullRequest === 417 ? current : null;
      },
      40000,
      "the plan of the picked start Pull Request",
    );
    assert.strictEqual(data.plan.pullRequests.find((pr: any) => pr.number === 417).selected, true);
    assert.strictEqual(data.plan.pullRequests.find((pr: any) => pr.number === 415).inWindow, false);
    const call = backpromoteCalls().reverse().find((entry) => entry.args.includes("--plan"));
    assert.ok(call!.args.includes("--from-pull-request"), JSON.stringify(call!.args));
    assert.strictEqual(call!.args[call!.args.indexOf("--from-pull-request") + 1], "417");
    // The run id of the previous plan is passed back so the cache is reused
    assert.ok(call!.args.includes("--run-id"), JSON.stringify(call!.args));
  });

  test("Merge on an item prepares the merged file with sfdx-hardis and tracks its markers", async function () {
    panel.simulateWebviewMessage({
      type: "mergeItem",
      data: { itemKey: "ApexClass:InvoiceCalculator", revision: 9 },
    });
    const data = await waitFor(
      () => {
        const current = panel.getInitializationData();
        const comparison = current?.plan?.comparison?.find((entry: any) => entry.file === INVOICE_CALCULATOR_FILE);
        return current && current.loading === false && comparison?.prepared ? current : null;
      },
      40000,
      "the prepared plan",
    );
    const prepareCall = backpromoteCalls().find((entry) => entry.args.includes("--prepare"));
    assert.ok(prepareCall, "sf hardis:work:backpromote --prepare must be called");
    assert.ok(prepareCall!.args.includes(`${INVOICE_CALCULATOR_FILE}=merge`), JSON.stringify(prepareCall!.args));
    assert.strictEqual(data.plan.checkout.onBackpromoteBranch, true);
    assert.strictEqual(data.selection.diffDecisions["ApexClass:InvoiceCalculator"], "merge");
    // One marker left (the mock writes none on disk, so the plan count stands): the run is blocked
    assert.deepStrictEqual(data.summary.blockers, ["conflictMarkers"]);
    assert.strictEqual(data.summary.canRun, false);
    assert.ok(data.plan.promptFile, "the coding agent prompt path is known");
  });

  test("switching a prepared file back to Overwrite does not unblock the run: its markers are still in the checkout", async function () {
    panel.simulateWebviewMessage({
      type: "selectionChanged",
      data: { selection: { ...panel.getInitializationData().selection, diffDecisions: { "ApexClass:InvoiceCalculator": "git", "Layout:Case-Case Layout": "git" } }, revision: 10 },
    });
    const summary = await waitFor(
      () => sent.find((entry) => entry.type === "selectionSummary" && entry.data.revision === 10),
      5000,
      "the summary after the decision changed",
    );
    assert.deepStrictEqual(summary.data.summary.blockers, ["preparedMarkers"]);
    assert.strictEqual(summary.data.summary.canRun, false);
    assert.strictEqual(summary.data.summary.markersLeft[0].merging, false);
    // The run is refused by the extension too, whatever the webview sends
    const callsBefore = backpromoteCalls().length;
    panel.simulateWebviewMessage({ type: "runBackpromote", data: { selection: summary.data.selection, revision: 10 } });
    const refused = await waitFor(
      () => sent.find((entry) => entry.type === "selectionSummary" && entry.data.revision === 10 && entry !== summary),
      5000,
      "the summary sent back with the refusal",
    );
    assert.strictEqual(refused.data.summary.canRun, false);
    assert.strictEqual(backpromoteCalls().length, callsBefore, "no --auto call");
  });

  test("saving the merged file without markers enables the run, which carries the merge decision", async function () {
    // Back to Merge, then the developer solves the conflict and saves
    panel.simulateWebviewMessage({
      type: "selectionChanged",
      data: { selection: { ...panel.getInitializationData().selection, diffDecisions: { "ApexClass:InvoiceCalculator": "merge", "Layout:Case-Case Layout": "git" } }, revision: 11 },
    });
    await waitFor(() => sent.find((entry) => entry.type === "selectionSummary" && entry.data.revision === 11), 5000, "the summary of the merge decision");
    const absolute = path.join(initData.workspaceRoot, INVOICE_CALCULATOR_FILE);
    writeWorkspaceFile(absolute, "public with sharing class InvoiceCalculator {\n}\n");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(document.lineCount, 0), "\n");
    await vscode.workspace.applyEdit(edit);
    await document.save();
    const solved = await waitFor(
      () => sent.find((entry) => entry.type === "selectionSummary" && entry.data.markers && entry.data.markers[INVOICE_CALCULATOR_FILE] === 0),
      15000,
      "the marker count read after the save",
    );
    assert.strictEqual(solved.data.summary.canRun, true);
    assert.deepStrictEqual(solved.data.summary.blockers, []);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    panel.simulateWebviewMessage({
      type: "runBackpromote",
      data: { selection: { ...solved.data.selection, command: "sf hardis:evil" }, revision: 11 },
    });
    const started = await waitFor(() => lastOfType(sent, "runStarted"), 5000, "the run to start");
    assert.ok(started.data.command.startsWith("sf hardis:work:backpromote --auto --run-id"), started.data.command);
    assert.ok(started.data.command.includes(`--on-diff ${INVOICE_CALCULATOR_FILE}=merge`), started.data.command);
    assert.ok(started.data.command.includes("--from-pull-request 417"), started.data.command);
    assert.ok(!started.data.command.includes("evil"));
    await waitFor(() => lastOfType(sent, "runFinished"), 40000, "the run to finish");
    const data = panel.getInitializationData();
    assert.strictEqual(data.running, false);
    assert.strictEqual(data.runError, null);
    // 6 items, minus the Flow left out earlier and the Profile held back by no-overwrite
    assert.strictEqual(data.runResult.result.deployed, 4);
    assert.strictEqual(data.runResult.result.pushed, true);
    assert.deepStrictEqual(data.runResult.result.commentedPullRequests, [415, 417, 418]);
    assert.deepStrictEqual(data.runResult.result.actions.pending, ["enable-sla-approval"]);
    assert.ok(data.runLog.length > 0, "the progress lines of the run are shown");
    const runCall = backpromoteCalls().find((entry) => entry.args.includes("--auto"));
    assert.ok(runCall!.args.includes("--json"));
  });

  test("Done in the sandbox records the manual action with sfdx-hardis", async function () {
    panel.simulateWebviewMessage({ type: "confirmAction", data: { actionId: "enable-sla-approval" } });
    const data = await waitFor(
      () => {
        const current = panel.getInitializationData();
        const action = current?.plan?.actions?.find((entry: any) => entry.id === "enable-sla-approval");
        return action?.alreadyRunOn ? current : null;
      },
      40000,
      "the manual action to be recorded",
    );
    assert.ok(data.plan.actions.find((entry: any) => entry.id === "enable-sla-approval").alreadyRunOn);
    const call = backpromoteCalls().find((entry) => entry.args.includes("--confirm-action"));
    assert.ok(call, "sf hardis:work:backpromote --confirm-action must be called");
    // The result of the run stays on screen, the button is given back to the webview
    assert.ok(data.runResult, "the run result is kept");
    await waitFor(() => lastOfType(sent, "confirmActionFinished"), 5000, "the confirmation to be released");
  });

  test("after a successful run, Refresh no longer pins the start Pull Request and drops the result", async function () {
    const callsBefore = backpromoteCalls().length;
    panel.simulateWebviewMessage({ type: "refresh" });
    const data = await waitForPlan(
      "the refreshed plan",
      (current) => backpromoteCalls().length > callsBefore && current.plan.window?.startPullRequest === 415,
    );
    const call = lastPlanCall();
    assert.ok(!call.args.includes("--from-pull-request"), JSON.stringify(call.args));
    assert.ok(call.args.includes("--run-id"), JSON.stringify(call.args));
    assert.strictEqual(data.runResult, null);
    assert.strictEqual(data.runError, null);
    assert.deepStrictEqual(data.runLog, []);
    assert.strictEqual(data.fromPullRequest, null);
  });

  test("Look for earlier Pull Requests scans one more page than the plan did", async function () {
    const callsBefore = backpromoteCalls().length;
    panel.simulateWebviewMessage({ type: "showEarlier" });
    await waitForPlan("the wider plan", () => backpromoteCalls().length > callsBefore);
    const call = lastPlanCall();
    assert.ok(call.args.includes("--scan-limit"), JSON.stringify(call.args));
    // The fixture scan limit is 100: one page more
    assert.strictEqual(call.args[call.args.indexOf("--scan-limit") + 1], "200");
  });

  test("picking another start Pull Request after a run drops the previous result", async function () {
    // The Merge decision taken before the refresh was kept, and the fresh plan holds no prepared
    // file: Overwrite both differing items so that the run is allowed
    const selection = {
      ...panel.getInitializationData().selection,
      diffDecisions: { "ApexClass:InvoiceCalculator": "git", "Layout:Case-Case Layout": "git" },
    };
    const before = await runAndWait(selection, 20);
    assert.ok(before.runResult?.result, "the run succeeded");
    panel.simulateWebviewMessage({ type: "changeStartPullRequest", data: { number: 417 } });
    const data = await waitForPlan("the plan of the picked start Pull Request", (current) => current.plan.window?.startPullRequest === 417);
    assert.strictEqual(data.runResult, null);
    assert.strictEqual(data.runError, null);
    assert.deepStrictEqual(data.runLog, []);
  });

  test("Copy agent prompt puts the prompt written by sfdx-hardis in the clipboard", async function () {
    panel.simulateWebviewMessage({ type: "mergeItem", data: { itemKey: "ApexClass:InvoiceCalculator", revision: 21 } });
    const data = await waitForPlan(
      "the prepared plan",
      (current) => current.plan.comparison.some((entry: any) => entry.file === INVOICE_CALCULATOR_FILE && entry.prepared),
    );
    assert.ok(data.plan.promptFile, "the prompt path is known");
    const content = `# Merge prompt ${Date.now()}\n`;
    writeWorkspaceFile(data.plan.promptFile, content);
    // The clipboard API object is frozen: the real clipboard is used, when this instance has one
    const probe = `probe-${Date.now()}`;
    await vscode.env.clipboard.writeText(probe);
    if ((await vscode.env.clipboard.readText()) !== probe) {
      this.skip();
    }
    panel.simulateWebviewMessage({ type: "copyAgentPrompt" });
    const start = Date.now();
    let clipboard = "";
    while (clipboard !== content && Date.now() - start < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      clipboard = await vscode.env.clipboard.readText();
    }
    assert.strictEqual(clipboard, content, `prompt file exists: ${fs.existsSync(data.plan.promptFile)}`);
  });

  test("another parent branch starts over: no run id, no start Pull Request, no previous result", async function () {
    panel.simulateWebviewMessage({
      type: "changeParentBranch",
      data: { targetOrg: panel.getInitializationData().targetOrg, parentBranch: "uat" },
    });
    const data = await waitForPlan("the plan of the other parent branch", (current) => current.plan.parentBranch === "uat");
    const call = lastPlanCall();
    assert.ok(!call.args.includes("--run-id"), JSON.stringify(call.args));
    assert.ok(!call.args.includes("--from-pull-request"), JSON.stringify(call.args));
    assert.strictEqual(call.args[call.args.indexOf("--parent-branch") + 1], "uat");
    assert.strictEqual(data.plan.backpromoteBranch.name, "backpromote/uat/dev1");
    assert.strictEqual(data.runResult, null);
  });

  test("Abandon pending merges deletes the branch with sfdx-hardis after a confirmation, then plans again", async function () {
    const original = vscode.window.showWarningMessage;
    try {
      // The modal confirmation is answered with its button
      (vscode.window as any).showWarningMessage = async (_message: any, _options: any, ...items: any[]) => items[0];
    } catch {
      this.skip();
    }
    try {
      const callsBefore = backpromoteCalls().length;
      panel.simulateWebviewMessage({ type: "resetBranch" });
      const resetCall = await waitFor(
        () => backpromoteCalls().find((entry) => entry.args.includes("--reset")),
        20000,
        "the reset call",
      );
      assert.ok(resetCall.args.includes("--auto"), JSON.stringify(resetCall.args));
      assert.ok(!resetCall.args.includes("--run-id"), JSON.stringify(resetCall.args));
      assert.strictEqual(resetCall.args[resetCall.args.indexOf("--parent-branch") + 1], "uat");
      await waitForPlan("the plan after the reset", () => backpromoteCalls().length > callsBefore + 1 && !!lastPlanCall() && lastPlanCall().time >= resetCall.time);
      assert.ok(!lastPlanCall().args.includes("--run-id"), JSON.stringify(lastPlanCall().args));
    } finally {
      (vscode.window as any).showWarningMessage = original;
    }
  });

  test("without a git provider token the panel shows how to configure one and calls nothing", async function () {
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const callsBefore = backpromoteCalls().length;
    try {
      await openPanel();
      assert.strictEqual(initData.tokenMissing, true);
      assert.strictEqual(initData.plan, null);
      assert.strictEqual(backpromoteCalls().length, callsBefore);
    } finally {
      process.env.GITHUB_TOKEN = saved;
    }
  });

  test("a plan blocked on the git provider check shows the same token state", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "tokenMissing";
    try {
      await openPanel();
      assert.strictEqual(initData.tokenMissing, true);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("an sfdx-hardis version without the panel flags shows the update state", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "old";
    try {
      await openPanel();
      assert.ok(initData.planError, "a plan error is expected");
      assert.strictEqual(initData.planError.cliTooOld, true);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("a sandbox with no backpromote history waits for the start Pull Request", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "noHistory";
    try {
      await openPanel();
      assert.strictEqual(initData.plan.scan.found, false);
      assert.strictEqual(initData.plan.window, null);
      assert.deepStrictEqual(initData.summary.blockers, ["noWindow"]);
      panel.simulateWebviewMessage({ type: "changeStartPullRequest", data: { number: 412 } });
      const data = await waitFor(
        () => {
          const current = panel.getInitializationData();
          return current && current.loading === false && current.plan?.window?.startPullRequest === 412 ? current : null;
        },
        40000,
        "the plan of the picked start Pull Request",
      );
      assert.strictEqual(data.summary.canRun, true);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("a run refused because markers remain shows the status and keeps the plan", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "conflictsRemaining";
    try {
      await openPanel();
      const data = await runAndWait(initData.selection, 1);
      assert.strictEqual(data.runError.status, "conflictsRemaining");
      assert.match(data.runError.message, /conflict markers/);
      assert.strictEqual(data.plan.status, "conflictsRemaining");
      assert.strictEqual(data.runResult, null);
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("a failed deployment shows its status and message, and keeps the plan attached to the error", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "deployFailed";
    try {
      await openPanel();
      const data = await runAndWait(initData.selection, 1);
      assert.strictEqual(data.running, false);
      assert.strictEqual(data.runError.status, "deployFailed");
      assert.match(data.runError.message, /Deployment to dev1 failed/);
      assert.strictEqual(data.plan.status, "deployFailed");
      assert.strictEqual(data.plan.checkout.onBackpromoteBranch, true);
      assert.strictEqual(data.runResult, null);
      assert.ok(data.runLog.length > 0, "the progress lines up to the failure are shown");
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("with a dirty working tree, the choice made in the modal travels as --dirty-tree", async function () {
    process.env.SF_MOCK_BACKPROMOTE_CLI = "dirty";
    try {
      await openPanel();
      assert.strictEqual(initData.plan.checkout.clean, false);
      assert.strictEqual(initData.plan.checkout.dirtyFiles.length, 2);
      // Commit with a message before the run
      panel.simulateWebviewMessage({
        type: "runBackpromote",
        data: { selection: initData.selection, revision: 1, dirtyTree: { action: "commit", message: "WIP lead routing" } },
      });
      const started = await waitFor(() => lastOfType(sent, "runStarted"), 5000, "the run to start");
      assert.ok(started.data.command.endsWith('--dirty-tree commit --commit-message "WIP lead routing" --json'), started.data.command);
      await waitFor(() => lastOfType(sent, "runFinished"), 40000, "the run to finish");
      const runCall = [...backpromoteCalls()].reverse().find((entry) => entry.args.includes("--auto"));
      assert.strictEqual(runCall!.args[runCall!.args.indexOf("--dirty-tree") + 1], "commit");
      assert.strictEqual(runCall!.args[runCall!.args.indexOf("--commit-message") + 1], "WIP lead routing");
      assert.strictEqual(panel.getInitializationData().runError, null);
      // Stash before a merge is prepared
      panel.simulateWebviewMessage({
        type: "mergeItem",
        data: { itemKey: "Layout:Case-Case Layout", revision: 2, dirtyTree: { action: "stash" } },
      });
      const data = await waitForPlan(
        "the prepared plan",
        (current) => current.plan.comparison.some((entry: any) => entry.file === CASE_LAYOUT_FILE && entry.prepared),
      );
      const prepareCall = [...backpromoteCalls()].reverse().find((entry) => entry.args.includes("--prepare"));
      assert.strictEqual(prepareCall!.args[prepareCall!.args.indexOf("--dirty-tree") + 1], "stash");
      assert.ok(!prepareCall!.args.includes("--commit-message"), JSON.stringify(prepareCall!.args));
      assert.strictEqual(data.plan.checkout.stashed, true);
      assert.ok(data.plan.checkout.stashMessage, "the stash message is known for Back to my branch");
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
    }
  });

  test("closing the panel during a run does not break the next opening", async function () {
    await openPanel();
    panel.simulateWebviewMessage({ type: "runBackpromote", data: { selection: initData.selection, revision: 1 } });
    await waitFor(() => lastOfType(sent, "runStarted"), 5000, "the run to start");
    panelManager.disposePanel(LWC_ID);
    await openPanel();
    assert.strictEqual(initData.plan.status, "ok");
    assert.strictEqual(initData.running, false);
    assert.strictEqual(initData.runResult, null);
    assert.strictEqual(initData.summary.canRun, true);
  });
});
