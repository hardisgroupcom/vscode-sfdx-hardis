import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  activateExtension,
  readMockLog,
  waitFor,
  waitForLoadedPipeline,
} from "./uiTestUtils";

/**
 * The release versions of the DevOps Pipeline are listed on demand, against the mocked sf CLI:
 * a load of the pipeline never runs `sf hardis:project:version:list`, the Versions toggle is off
 * by default and saved in the extension settings.
 *
 * The tests drive the extension side of the panel the way the LWC does, and count the commands
 * the mock received.
 */

const LWC_ID = "s-pipeline";
const SETTING = "pipelineShowReleaseVersions";
const UAT_TAG = "v1.5.0-rc.3";
// Time for a reload of the panel to run a command it should not run
const SETTLE_MS = 2500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite("Release versions on demand UI tests", function () {
  let panelManager: any;
  let panel: any;
  let sent: any[] = [];
  let branchFiles: string[] = [];
  let callsBefore = 0;

  const versionCalls = () =>
    readMockLog().filter(
      (entry) => entry.args[0] === "hardis:project:version:list",
    ).length - callsBefore;

  const savedValue = () =>
    vscode.workspace
      .getConfiguration("vsCodeSfdxHardis")
      .get<boolean>(SETTING, false);

  const setSetting = (value: boolean | undefined) =>
    vscode.workspace
      .getConfiguration("vsCodeSfdxHardis")
      .update(SETTING, value, vscode.ConfigurationTarget.Global);

  async function openPipeline(): Promise<any> {
    panelManager.disposePanel(LWC_ID);
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline");
    const loaded = await waitForLoadedPipeline(panelManager);
    panel = loaded.panel;
    sent = loaded.sent;
    return loaded.data;
  }

  /** Sends what the LWC sends, and waits for the versions it asked for */
  async function nextVersionsAnswer(message: any): Promise<any> {
    const from = sent.length;
    panel.simulateWebviewMessage(message);
    const answer = await waitFor(
      () =>
        sent
          .slice(from)
          .find((entry) => entry.type === "releaseVersionsLoaded"),
      30000,
      "the versions to be sent to the panel",
    );
    return answer.data;
  }

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const branchDir = path.join(root, "config", "branches");
    fs.mkdirSync(branchDir, { recursive: true });
    branchFiles = [
      [".sfdx-hardis.versions-uat.yml", "mergeTargets: [versions-main]"],
      [".sfdx-hardis.versions-main.yml", "mergeTargets: []"],
    ].map(([name, targets]) => {
      const file = path.join(branchDir, name);
      fs.writeFileSync(
        file,
        `instanceUrl: https://test.salesforce.com\n${targets}\nreleaseVersioning: true\n`,
      );
      return file;
    });
  });

  suiteTeardown(async function () {
    delete process.env.SF_MOCK_RELEASE_VERSIONS;
    panelManager?.disposePanel(LWC_ID);
    for (const file of branchFiles) {
      fs.rmSync(file, { force: true });
    }
    await setSetting(undefined);
  });

  setup(async function () {
    delete process.env.SF_MOCK_RELEASE_VERSIONS;
    await setSetting(undefined);
    callsBefore = 0;
    callsBefore = versionCalls();
  });

  test("the pipeline loads and reloads without listing the versions", async function () {
    const data = await openPipeline();
    assert.strictEqual(data.pipelineData.releaseVersioningDeclared, true);
    assert.strictEqual(data.pipelineData.releaseVersioningEnabled, false);
    assert.strictEqual(data.showReleaseVersions, false, "off by default");
    assert.strictEqual(data.releaseVersionsStatus, "notLoaded");
    assert.ok(!data.pipelineData.mermaidDiagram.includes(UAT_TAG));

    panel.simulateWebviewMessage({
      type: "refreshPipeline",
      data: { manual: false },
    });
    await sleep(SETTLE_MS);
    panel.simulateWebviewMessage({
      type: "refreshPipeline",
      data: { manual: true },
    });
    await sleep(SETTLE_MS);
    assert.strictEqual(versionCalls(), 0, "no call while nobody asked");
  });

  test("the toggle is saved, and the versions are drawn once asked for", async function () {
    await openPipeline();
    panel.simulateWebviewMessage({
      type: "saveShowReleaseVersions",
      data: { value: true },
    });
    await waitFor(() => savedValue(), 10000, "the setting to be saved");
    await sleep(500);
    assert.ok(
      !sent.some((entry) => entry.type === "showReleaseVersionsChanged"),
      "the panel is not told about its own click",
    );

    const answer = await nextVersionsAnswer({ type: "loadReleaseVersions" });
    assert.strictEqual(answer.status, "loaded");
    assert.strictEqual(answer.pipelineData.releaseVersioningEnabled, true);
    assert.ok(answer.pipelineData.mermaidDiagram.includes(UAT_TAG));
    assert.ok(answer.pipelineData.mermaidDiagramMajor.includes(UAT_TAG));
    assert.strictEqual(answer.pipelineData.releaseVersionHistory.length, 2);
    assert.strictEqual(versionCalls(), 1);

    // The timer of the panel reuses the answer, and its payload keeps the chips
    panel.simulateWebviewMessage({
      type: "refreshPipeline",
      data: { manual: false },
    });
    await sleep(SETTLE_MS);
    assert.strictEqual(versionCalls(), 1, "a reload reuses the answer");
    const reloaded = panel.getInitializationData().pipelineData;
    assert.strictEqual(reloaded.releaseVersioningEnabled, true);
    assert.ok(reloaded.mermaidDiagram.includes(UAT_TAG));

    // Refresh lists them again, since they were asked for
    const refreshed = await nextVersionsAnswer({
      type: "refreshPipeline",
      data: { manual: true },
    });
    assert.strictEqual(refreshed.status, "loaded");
    assert.strictEqual(versionCalls(), 2);
  });

  test("a CLI failure is told to the panel, and Refresh tries again", async function () {
    await openPipeline();
    process.env.SF_MOCK_RELEASE_VERSIONS = "error";
    const failed = await nextVersionsAnswer({ type: "loadReleaseVersions" });
    assert.strictEqual(failed.status, "failed");
    assert.strictEqual(failed.pipelineData.releaseVersioningDeclared, true);
    assert.strictEqual(failed.pipelineData.releaseVersioningEnabled, false);

    delete process.env.SF_MOCK_RELEASE_VERSIONS;
    const retried = await nextVersionsAnswer({
      type: "refreshPipeline",
      data: { manual: true },
    });
    assert.strictEqual(retried.status, "loaded");
    assert.strictEqual(retried.pipelineData.releaseVersioningEnabled, true);
  });

  test("a toggle saved on opens with it on, and its versions are drawn", async function () {
    await setSetting(true);
    const data = await openPipeline();
    assert.strictEqual(data.showReleaseVersions, true);
    // What the LWC sends once the Pull Requests are displayed. When its page has booted, it has
    // sent the same message: the two share one CLI call
    const answer = await nextVersionsAnswer({ type: "loadReleaseVersions" });
    assert.strictEqual(answer.status, "loaded");
    assert.strictEqual(answer.pipelineData.releaseVersioningEnabled, true);
    assert.strictEqual(versionCalls(), 1);
  });

  test("a change of the setting elsewhere reaches the open panel", async function () {
    await openPipeline();
    await setSetting(true);
    const changed = await waitFor(
      () => sent.find((entry) => entry.type === "showReleaseVersionsChanged"),
      10000,
      "the panel to be told",
    );
    assert.strictEqual(changed.data.value, true);
  });
});
