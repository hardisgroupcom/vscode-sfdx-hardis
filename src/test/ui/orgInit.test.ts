import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import {
  activateExtension,
  assertShowCommandBringsPanelBack,
  openFreshPanel,
  readMockLog,
  recordSentMessages,
  waitFor,
  waitForPanelLoaded,
} from "./uiTestUtils";

/**
 * UI integration tests of the Org Initialization panel, against the mocked sf CLI that answers
 * `sf hardis:config:org-init --json` with test/fixtures/sf-shim/org-init.json (steps built from
 * the older settings of the project).
 *
 * The webview DOM is not reachable from the extension host: the tests drive the extension side
 * of the panel the way the LWC does.
 */

const LWC_ID = "s-org-init";
const SHOW_COMMAND = "vscode-sfdx-hardis.showOrgInit";

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders![0].uri.fsPath;
}

function readProjectConfig(): any {
  const configFile = path.join(workspaceRoot(), "config", ".sfdx-hardis.yml");
  return fs.existsSync(configFile)
    ? (yaml.load(fs.readFileSync(configFile, "utf8")) as any) || {}
    : {};
}

function callsOf(command: string): any[] {
  return readMockLog().filter(
    (entry) => entry.args && entry.args[0] === command,
  );
}

suite("Org Initialization panel UI tests", function () {
  let panelManager: any;
  let panel: any;

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  suiteTeardown(function () {
    panelManager?.disposePanel(LWC_ID);
  });

  async function openLoadedPanel(): Promise<any> {
    panel = await openFreshPanel(panelManager, LWC_ID, SHOW_COMMAND);
    return waitForPanelLoaded(
      panel,
      "the org initialization",
      (state) => !!state.config,
    );
  }

  test("the panel opens at once on a loading state, then shows the steps the CLI builds", async function () {
    process.env.SF_MOCK_ORG_INIT_DELAY_MS = "3000";
    let state: any;
    try {
      panel = await openFreshPanel(panelManager, LWC_ID, SHOW_COMMAND);
      assert.strictEqual(
        panel.getInitializationData().loading,
        true,
        "the panel opens before the CLI answers",
      );
      state = await waitForPanelLoaded(
        panel,
        "the steps",
        (data) => !!data.config,
      );
    } finally {
      delete process.env.SF_MOCK_ORG_INIT_DELAY_MS;
    }
    assert.strictEqual(state.config.source, "legacy");
    assert.deepStrictEqual(
      state.config.steps.map((step: any) => step.id),
      [
        "legacy-install-packages",
        "legacy-deploy-sources",
        "legacy-permission-sets",
        "legacy-scratch-apex-1",
      ],
    );
    assert.strictEqual(state.config.scratchDef.content.edition, "Developer");
    assert.ok(Array.isArray(state.apexScripts));
    assert.ok(Array.isArray(state.permissionSets));
    const call = callsOf("hardis:config:org-init").pop();
    assert.ok(call, "sf hardis:config:org-init must be called");
    assert.ok(call.args.includes("--json"));
  });

  test("saving writes orgInitSteps and removes the older settings", async function () {
    const configFile = path.join(workspaceRoot(), "config", ".sfdx-hardis.yml");
    const before = fs.existsSync(configFile)
      ? fs.readFileSync(configFile, "utf8")
      : null;
    try {
      // The older settings the first save replaces
      const config = readProjectConfig();
      config.initPermissionSets = ["MyCompany_Sales_Admin"];
      config.scratchOrgInitApexScripts = ["scripts/apex/init-scratch.apex"];
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, yaml.dump(config), "utf8");

      const state = await openLoadedPanel();
      const steps = state.config.steps.map((step: any) => ({ ...step }));
      steps[2].enabled = false;
      panel.simulateWebviewMessage({
        type: "saveOrgInitSteps",
        data: { steps },
      });
      const saved = await waitFor(
        () => {
          const current = readProjectConfig();
          return Array.isArray(current.orgInitSteps) ? current : null;
        },
        20000,
        "orgInitSteps to be written",
      );
      assert.strictEqual(saved.orgInitSteps.length, 4);
      assert.strictEqual(saved.orgInitSteps[2].enabled, false);
      assert.ok(!("initPermissionSets" in saved), "initPermissionSets removed");
      assert.ok(
        !("scratchOrgInitApexScripts" in saved),
        "scratchOrgInitApexScripts removed",
      );
    } finally {
      if (before === null) {
        fs.rmSync(configFile, { force: true });
      } else {
        fs.writeFileSync(configFile, before, "utf8");
      }
    }
  });

  test("an invalid scratch org definition is not written", async function () {
    await openLoadedPanel();
    const sent = recordSentMessages(panel);
    const scratchDefFile = path.join(
      workspaceRoot(),
      "config",
      "project-scratch-def.json",
    );
    const before = fs.existsSync(scratchDefFile)
      ? fs.readFileSync(scratchDefFile, "utf8")
      : null;
    panel.simulateWebviewMessage({
      type: "saveScratchDef",
      data: {
        content: { edition: "Developer", settings: { notARealSettings: {} } },
        scratchOrgDuration: "7",
      },
    });
    const answer = await waitFor(
      () => sent.find((message) => message.type === "scratchDefValidated"),
      20000,
      "the validation answer",
    );
    assert.ok(
      answer.data.issues.some((issue: string) =>
        issue.startsWith("settings.notARealSettings"),
      ),
      JSON.stringify(answer.data.issues),
    );
    const after = fs.existsSync(scratchDefFile)
      ? fs.readFileSync(scratchDefFile, "utf8")
      : null;
    assert.strictEqual(after, before, "the file is unchanged");
  });

  test("Run now runs sf hardis:org:init with the selected steps and the org", async function () {
    await openLoadedPanel();
    const knownCalls = callsOf("hardis:org:init").length;
    panel.simulateWebviewMessage({
      type: "runOrgInit",
      data: {
        stepIds: ["legacy-permission-sets", "legacy-scratch-apex-1"],
        targetOrg: "dev-sandbox@mycompany.com",
      },
    });
    const call = await waitFor(
      () => callsOf("hardis:org:init")[knownCalls],
      20000,
      "sf hardis:org:init to run",
    );
    const commandLine = call.args.join(" ");
    assert.ok(commandLine.includes("--agent"), commandLine);
    assert.ok(
      commandLine.includes(
        "--steps legacy-permission-sets,legacy-scratch-apex-1",
      ),
      commandLine,
    );
    assert.ok(
      commandLine.includes("--target-org dev-sandbox@mycompany.com"),
      commandLine,
    );
  });

  test("the command brings the open panel back instead of opening a second one", async function () {
    await openLoadedPanel();
    await assertShowCommandBringsPanelBack(
      panelManager,
      panel,
      LWC_ID,
      SHOW_COMMAND,
    );
  });
});
