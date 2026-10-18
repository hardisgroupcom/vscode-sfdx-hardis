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
        content: { edition: "Developer", hasSampleData: "yes" },
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
        issue.startsWith("hasSampleData"),
      ),
      JSON.stringify(answer.data.issues),
    );
    const after = fs.existsSync(scratchDefFile)
      ? fs.readFileSync(scratchDefFile, "utf8")
      : null;
    assert.strictEqual(after, before, "the file is unchanged");
  });

  test("a Refresh keeps the content on screen under a spinner", async function () {
    await openLoadedPanel();
    const sent = recordSentMessages(panel);
    const pushed: any[] = [];
    const originalPush = panel.sendInitializationData.bind(panel);
    panel.sendInitializationData = (data: any) => {
      pushed.push(data);
      originalPush(data);
    };
    try {
      panel.simulateWebviewMessage({ type: "refresh" });
      await waitFor(
        () => pushed.find((data) => !!data.config),
        30000,
        "the reloaded data",
      );
    } finally {
      panel.sendInitializationData = originalPush;
    }
    assert.ok(
      sent.some((message) => message.type === "orgInitReloading"),
      "the panel is told to show its spinner over the content",
    );
    assert.ok(
      !pushed.some((data) => data.loading === true),
      "the panel never goes back to its loading state",
    );
  });

  test("the languages, countries and releases of the Dev Hub follow the panel data", async function () {
    await openLoadedPanel();
    const sent = recordSentMessages(panel);
    panel.simulateWebviewMessage({ type: "refresh" });
    const answer = await waitFor(
      () => sent.find((message) => message.type === "scratchDefOrgValues"),
      30000,
      "the org values",
    );
    assert.strictEqual(answer.data.orgValues.releases.current.version, "68.0");
    assert.strictEqual(
      answer.data.orgValues.releases.preview.label,
      "Spring '27",
    );
    assert.ok(answer.data.orgValues.languages.length > 0);
    const call = callsOf("hardis:config:org-init")
      .filter((entry) => entry.args.includes("--org-values"))
      .pop();
    assert.ok(call, "the org values come from the CLI");
    assert.ok(call.args.includes("--agent"));
  });

  test("without a Dev Hub nor a default org, the form keeps its text inputs", async function () {
    process.env.SF_MOCK_ORG_INIT_NO_ORG = "true";
    try {
      await openLoadedPanel();
      const sent = recordSentMessages(panel);
      // A call of the previous test can still be running, and identical calls share their answer:
      // refresh until an answer of this test arrives
      let answer: any = null;
      for (let attempt = 0; attempt < 4 && !answer; attempt++) {
        sent.length = 0;
        panel.simulateWebviewMessage({ type: "refresh" });
        const received = await waitFor(
          () => sent.find((message) => message.type === "scratchDefOrgValues"),
          30000,
          "the org values answer",
        );
        answer = received.data.orgValues === null ? received : null;
      }
      assert.ok(answer, "no org: the panel gets no org values");
    } finally {
      delete process.env.SF_MOCK_ORG_INIT_NO_ORG;
    }
  });

  test("settings are imported from an org with the CLI", async function () {
    await openLoadedPanel();
    const sent = recordSentMessages(panel);
    panel.simulateWebviewMessage({
      type: "importScratchDefSettings",
      data: {
        sourceOrg: "prod@mycompany.com",
        settingsNames: ["mobileSettings", "lightningExperienceSettings"],
      },
    });
    const answer = await waitFor(
      () => sent.find((message) => message.type === "scratchDefImportDone"),
      30000,
      "the settings import",
    );
    assert.deepStrictEqual(Object.keys(answer.data.settings), [
      "mobileSettings",
      "lightningExperienceSettings",
    ]);
    const commandLine = callsOf("hardis:config:org-init")
      .filter((entry) => entry.args.includes("--import-settings"))
      .pop()
      .args.join(" ");
    assert.ok(
      commandLine.includes(
        "--import-settings mobileSettings,lightningExperienceSettings",
      ),
      commandLine,
    );
    assert.ok(
      commandLine.includes("--source-org prod@mycompany.com"),
      commandLine,
    );
  });

  test("features are imported from an org shape, and an unsafe org name is refused", async function () {
    await openLoadedPanel();
    const sent = recordSentMessages(panel);
    panel.simulateWebviewMessage({
      type: "importScratchDefFeatures",
      data: { sourceOrg: "prod@mycompany.com" },
    });
    const answer = await waitFor(
      () => sent.find((message) => message.type === "scratchDefImportDone"),
      30000,
      "the features import",
    );
    assert.ok(answer.data.features.includes("MaxApexCodeSize:40"));
    sent.length = 0;
    panel.simulateWebviewMessage({
      type: "importScratchDefFeatures",
      data: { sourceOrg: "x;echo hacked" },
    });
    const refused = await waitFor(
      () => sent.find((message) => message.type === "scratchDefImportDone"),
      10000,
      "the refusal",
    );
    assert.ok(refused.data.error, "an error is answered");
    const hacked = callsOf("hardis:config:org-init").filter((call) =>
      call.args.join(" ").includes("hacked"),
    );
    assert.strictEqual(hacked.length, 0, "the CLI must not run");
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

  test("Run now refuses a step id that could change the command line", async function () {
    await openLoadedPanel();
    panel.simulateWebviewMessage({
      type: "runOrgInit",
      data: {
        stepIds: ["x;echo hacked"],
        targetOrg: "dev-sandbox@mycompany.com",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // The runs of the other tests are logged too: what matters is that this id never ran
    const hacked = callsOf("hardis:org:init").filter((call) =>
      call.args.join(" ").includes("hacked"),
    );
    assert.strictEqual(hacked.length, 0, "sf hardis:org:init must not run");
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
