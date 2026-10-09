import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import WebSocket from "ws";
import { activateExtension, recordSentMessages, waitFor } from "./uiTestUtils";
import { CdpWindow, captureWindowTo } from "./cdpWindow";

/**
 * The Files button of the Pull Request view against a REAL git provider, with the REAL
 * Salesforce CLI: listing and downloading the artifacts of a job is about what the provider
 * answers, which no mock can tell.
 *
 * It reads the Pull Request comments and downloads the artifacts of their jobs under
 * hardis-report/job-artifacts of the workspace. Nothing is written to the provider.
 *
 *   SFDX_HARDIS_REAL_JOB_ARTIFACTS=true
 *   SFDX_HARDIS_LAB_WORKSPACE          a clone of the repository, opened as the workspace
 *   SFDX_HARDIS_REAL_JOB_ARTIFACTS_PR  number of a Pull Request whose jobs still have artifacts
 *   SFDX_HARDIS_REAL_JOB_ARTIFACTS_SHOTS  optional folder for captures of the panel
 *   plus the token of the provider in the environment (GITHUB_TOKEN...)
 *
 * It runs on any provider. Where the files cannot be downloaded (Bitbucket), it checks instead
 * that no Files button is offered and that "Open job" stays. The MegaLinter step is skipped on
 * a Pull Request without a MegaLinter run.
 *
 *   yarn dev && yarn compile && node ./out/test/runUiTest.js
 */

const REAL_MODE = process.env.SFDX_HARDIS_REAL_JOB_ARTIFACTS === "true";
const LWC_ID = "s-pipeline";
const DOWNLOAD_TIMEOUT_MS = 180000;

// Runs in the page of a webview: every element of the panel, through the shadow roots
const DEEP_QUERY = `
  const deepAll = (root, selector, found = []) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.matches(selector)) {
        found.push(element);
      }
      if (element.shadowRoot) {
        deepAll(element.shadowRoot, selector, found);
      }
    }
    return found;
  };
  const frame = document.querySelector("iframe");
  const panelDocument = (frame && frame.contentDocument) || document;
`;

suite("Job artifacts on a real git provider", function () {
  this.timeout(DOWNLOAD_TIMEOUT_MS * 6);

  let panelManager: any;
  let panel: any;
  let sent: any[] = [];
  let workspaceRoot = "";
  let runs: any[] = [];
  let artifactsSupported = false;
  const prNumber = Number(process.env.SFDX_HARDIS_REAL_JOB_ARTIFACTS_PR || "");
  const shotsDir = process.env.SFDX_HARDIS_REAL_JOB_ARTIFACTS_SHOTS || "";

  const shoot = (name: string) => captureWindowTo(shotsDir, name);

  // Evaluates an expression in the page of the pipeline webview, and returns its value
  async function inWebview(expression: string): Promise<any> {
    const port = CdpWindow.portFromEnv();
    assert.ok(port, "the window was started with a debugging port");
    const targets: any[] = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const webviews = targets.filter((target) =>
      String(target.url || "").startsWith("vscode-webview://"),
    );
    for (const target of webviews) {
      const value = await evaluate(target.webSocketDebuggerUrl, expression);
      if (value !== null && value !== undefined) {
        return value;
      }
    }
    return null;
  }

  function evaluate(url: string, expression: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { perMessageDeflate: false });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("no answer from the webview"));
      }, 15000);
      socket.once("error", reject);
      socket.once("open", () => {
        socket.send(
          JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: {
              expression: `(() => { ${DEEP_QUERY} ${expression} })()`,
              returnByValue: true,
            },
          }),
        );
      });
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.id === 1) {
          clearTimeout(timer);
          socket.close();
          resolve(message.result?.result?.value);
        }
      });
    });
  }

  suiteSetup(async function () {
    if (!REAL_MODE) {
      this.skip();
    }
    assert.ok(
      prNumber > 0,
      "SFDX_HARDIS_REAL_JOB_ARTIFACTS_PR must be a Pull Request number",
    );
    workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  test("the Pull Request view gets the runs, their job and the capability from sfdx-hardis", async () => {
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline", {
      focus: "pullRequest",
      prNumber,
      tab: "validation",
    });
    panel = await waitFor(
      () => panelManager.getPanel(LWC_ID),
      60000,
      "the pipeline panel to open",
    );
    sent = recordSentMessages(panel);
    // The panel asks for the statuses and the runs once the Pull Request is shown: asked again
    // here, the way the LWC does, so the answer is read whatever was sent before the recording
    panel.simulateWebviewMessage({
      type: "loadDeploymentActionStatuses",
      data: {
        requestId: 9001,
        prNumbers: [prNumber],
        workflowPrNumbers: [prNumber],
      },
    });
    const answer = await waitFor(
      () =>
        sent.find(
          (message) =>
            message?.type === "returnDeploymentActionStatuses" &&
            message?.data?.requestId === 9001,
        ),
      DOWNLOAD_TIMEOUT_MS,
      "the runs of the Pull Request",
    );
    assert.strictEqual(
      typeof answer.data.artifactsSupported,
      "boolean",
      "sfdx-hardis says whether the files of the jobs can be downloaded",
    );
    artifactsSupported = answer.data.artifactsSupported;
    runs = answer.data.workflows?.[String(prNumber)] || [];
    console.log(
      `      artifactsSupported: ${artifactsSupported}, runs: ${runs.map((run) => `${run.kind} ${run.jobUrl}`).join(" | ")}`,
    );
    const validation = runs.find(
      (candidate) => candidate.kind === "validation",
    );
    assert.ok(validation, "a validation run");
    assert.match(validation.jobUrl, /^https?:\/\//, "validation has a job URL");
    const megalinter = runs.find(
      (candidate) => candidate.kind === "megalinter",
    );
    if (megalinter) {
      assert.match(
        megalinter.jobUrl,
        /^https?:\/\//,
        "megalinter has a job URL",
      );
    }
  });

  test("the files of every job are downloaded in the workspace", async function () {
    if (!artifactsSupported) {
      this.skip();
    }
    for (const run of runs.filter((candidate) => candidate.jobUrl)) {
      const requestedAt = Date.now();
      panel.simulateWebviewMessage({
        type: "loadJobArtifacts",
        data: { jobUrl: run.jobUrl, requestedAt },
      });
      const answer = await waitFor(
        () =>
          sent.find(
            (message) =>
              message?.type === "returnJobArtifacts" &&
              message?.data?.requestedAt === requestedAt,
          ),
        DOWNLOAD_TIMEOUT_MS,
        `the files of the ${run.kind} job`,
      );
      const data = answer.data;
      console.log(
        `      ${run.kind}: ${data.status}, ${data.files.length} file(s) in ${data.folder}`,
      );
      assert.strictEqual(data.jobUrl, run.jobUrl);
      // Only the validation job is sure to publish reports: another one can have none, or lost them
      if (run.kind !== "validation" && data.status !== "success") {
        assert.ok(["none", "expired"].includes(data.status), data.message);
        continue;
      }
      assert.strictEqual(data.status, "success", data.message);
      assert.ok(data.files.length > 0, "the job published files");
      // Lower case on both sides: Windows gives the same folder with either case
      assert.ok(
        path
          .resolve(data.folder)
          .toLowerCase()
          .startsWith(
            path.resolve(workspaceRoot, "hardis-report").toLowerCase(),
          ),
        "the files are under hardis-report of the workspace",
      );
      for (const file of data.files) {
        assert.ok(
          fs.existsSync(path.join(data.folder, file.path)),
          `${file.path} is on disk`,
        );
      }
    }
  });

  test("a job address that is not a plain web address is refused without calling sfdx-hardis", async () => {
    const requestedAt = Date.now();
    const started = Date.now();
    panel.simulateWebviewMessage({
      type: "loadJobArtifacts",
      data: {
        jobUrl: 'https://github.com/acme/repo/actions/runs/1" --debug "',
        requestedAt,
      },
    });
    const answer = await waitFor(
      () =>
        sent.find(
          (message) =>
            message?.type === "returnJobArtifacts" &&
            message?.data?.requestedAt === requestedAt,
        ),
      20000,
      "the refusal",
    );
    assert.strictEqual(answer.data.status, "error");
    assert.ok(
      Date.now() - started < 3000,
      "no sfdx-hardis process was started",
    );
  });

  test("without download on this provider, the run only offers its job and its comment", async function () {
    if (artifactsSupported || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    const buttons = await waitFor<any>(
      async () => {
        const labels = await inWebview(`
          const row = deepAll(panelDocument, ".hardis-list-actions").find(
            (actions) => actions.offsetParent !== null,
          );
          return row
            ? [...row.querySelectorAll("button")].map((button) => button.textContent.trim())
            : null;
        `);
        return Array.isArray(labels) && labels.length > 0 ? labels : null;
      },
      60000,
      "the buttons of the validation run",
    );
    console.log(`      buttons: ${buttons.join(" | ")}`);
    assert.strictEqual(buttons.length, 2, "job and comment");
    const filesButtons = await inWebview(
      `return deepAll(panelDocument, "button.run-files-button").length;`,
    );
    assert.strictEqual(
      filesButtons,
      0,
      "no Files button anywhere in the panel",
    );
    await shoot("job-artifacts-1-row-unsupported");
  });

  test("the Files button of a run lists its files, and a click opens one", async function () {
    if (!artifactsSupported || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    // The Validation tab is the one shown: its run has a Files button after Open comment
    const buttons = await waitFor<any>(
      async () => {
        const labels = await inWebview(`
          const row = deepAll(panelDocument, ".hardis-list-actions").find(
            (actions) => actions.offsetParent !== null,
          );
          return row
            ? [...row.querySelectorAll("button")].map((button) => button.textContent.trim())
            : null;
        `);
        return Array.isArray(labels) && labels.length > 0 ? labels : null;
      },
      60000,
      "the buttons of the validation run",
    );
    console.log(`      buttons: ${buttons.join(" | ")}`);
    assert.strictEqual(buttons.length, 3, "job, comment and files");
    assert.match(buttons[2], /^Files/);
    await shoot("job-artifacts-1-row");

    await inWebview(`
      const button = deepAll(panelDocument, "button.run-files-button").find(
        (candidate) => candidate.offsetParent !== null,
      );
      if (!button) { return null; }
      button.click();
      return true;
    `);
    const names = await waitFor<any>(
      async () => {
        const found = await inWebview(`
          const list = deepAll(panelDocument, ".run-file-name")
            .filter((name) => name.offsetParent !== null)
            .map((name) => name.textContent.trim());
          return list.length > 0 ? list : null;
        `);
        return Array.isArray(found) ? found : null;
      },
      DOWNLOAD_TIMEOUT_MS,
      "the list of files under the validation run",
    );
    console.log(`      files shown: ${names.join(" | ")}`);
    assert.ok(names.length > 0);
    await shoot("job-artifacts-2-files");

    // A text file opens in an editor of the window
    const jsonName = names.find((name: string) => name.endsWith(".json"));
    assert.ok(jsonName, "a JSON report in the list");
    await inWebview(`
      const entry = deepAll(panelDocument, "button.run-file").find(
        (candidate) =>
          candidate.offsetParent !== null &&
          candidate.querySelector(".run-file-name").textContent.trim() === ${JSON.stringify(jsonName)},
      );
      if (!entry) { return null; }
      entry.click();
      return true;
    `);
    const opened = await waitFor(
      () =>
        vscode.window.visibleTextEditors.find((editor) =>
          editor.document.uri.fsPath.includes("job-artifacts"),
        ),
      30000,
      "the file to open in an editor",
    );
    console.log(`      opened: ${opened.document.uri.fsPath}`);
    assert.ok(
      opened.document.uri.fsPath
        .replace(/\\/g, "/")
        .endsWith(jsonName.replace(/\\/g, "/")),
    );
    await shoot("job-artifacts-3-opened");
  });

  test("the files of the MegaLinter job are browsed by folder", async function () {
    if (
      !artifactsSupported ||
      !CdpWindow.portFromEnv() ||
      !runs.some((candidate) => candidate.kind === "megalinter")
    ) {
      this.skip();
    }
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline", {
      focus: "pullRequest",
      prNumber,
      tab: "megalinter",
    });
    await waitFor<any>(
      async () =>
        (await inWebview(`
          // The run shown must be the MegaLinter one: the tab is still changing at first
          const run = deepAll(panelDocument, ".hardis-list").find(
            (candidate) =>
              candidate.offsetParent !== null &&
              candidate.querySelector(".hardis-list-title").textContent.trim() === "MegaLinter",
          );
          const button = run && run.querySelector("button.run-files-button");
          if (!button) { return null; }
          button.click();
          return true;
        `)) === true,
      60000,
      "the Files button of the MegaLinter run",
    );
    const crumbs = await waitFor<any>(
      async () => {
        const found = await inWebview(`
          const list = deepAll(panelDocument, ".run-files-crumb")
            .filter((crumb) => crumb.offsetParent !== null)
            .map((crumb) => crumb.textContent.trim());
          return list.length > 0 ? list : null;
        `);
        return Array.isArray(found) ? found : null;
      },
      DOWNLOAD_TIMEOUT_MS,
      "the breadcrumb of the MegaLinter files",
    );
    assert.deepStrictEqual(crumbs, ["All files"]);
    await shoot("job-artifacts-4-megalinter-root");

    // Into the first folder: the breadcrumb follows
    const folder = await inWebview(`
      const entry = deepAll(panelDocument, "button.run-file").find(
        (candidate) => candidate.offsetParent !== null,
      );
      if (!entry) { return null; }
      const name = entry.querySelector(".run-file-name").textContent.trim();
      entry.click();
      return name;
    `);
    assert.ok(folder, "a folder in the list");
    const inside = await waitFor<any>(
      async () => {
        const found = await inWebview(`
          const list = deepAll(panelDocument, ".run-files-crumb")
            .filter((crumb) => crumb.offsetParent !== null)
            .map((crumb) => crumb.textContent.replace(/\\s*\\/\\s*$/, "").trim());
          return list.length > 1 ? list : null;
        `);
        return Array.isArray(found) ? found : null;
      },
      20000,
      "the breadcrumb inside the folder",
    );
    console.log(`      breadcrumb: ${inside.join(" / ")}`);
    assert.deepStrictEqual(inside, ["All files", folder]);
    await shoot("job-artifacts-5-megalinter-folder");
  });
});
