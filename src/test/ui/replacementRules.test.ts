import * as assert from "assert";
import { RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION } from "../../constants";
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
 * UI integration tests of the Replacement Rules panel, against the mocked sf CLI that answers
 * `sf hardis:project:replacement:*` from test/fixtures/sf-shim/replacement-rules.json.
 * SF_MOCK_REPLACEMENT makes the mock answer a failure instead (see sf-mock.js).
 *
 * The webview DOM is not reachable from the extension host: the tests drive the extension side
 * of the panel (state pushed to the webview, commands run for each message of the LWC) the way
 * the LWC does.
 */

const LWC_ID = "s-replacement-rules";
const SHOW_COMMAND = "vscode-sfdx-hardis.showReplacementRules";

function callsOf(command: string): any[] {
  return readMockLog().filter(
    (entry) => entry.args && entry.args[0] === command && !entry.event,
  );
}

function ruleFilesLogged(): any[] {
  return readMockLog().filter(
    (entry: any) => entry.event === "replacementRuleFile",
  );
}

/* jscpd:ignore-start */
suite("Replacement Rules panel UI tests", function () {
  let panelManager: any;
  let panel: any;

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  suiteTeardown(function () {
    delete process.env.SF_MOCK_REPLACEMENT;
    panelManager?.disposePanel(LWC_ID);
  });

  setup(function () {
    delete process.env.SF_MOCK_REPLACEMENT;
  });

  const waitForLoaded = (label: string, accept?: (state: any) => boolean) =>
    waitForPanelLoaded(panel, label, accept);

  async function openPanel(): Promise<any> {
    panel = await openFreshPanel(panelManager, LWC_ID, SHOW_COMMAND);
    return { ...panel.getInitializationData() };
  }
  /* jscpd:ignore-end */

  async function openLoaded(): Promise<any> {
    await openPanel();
    return waitForLoaded("the rules", (state) => !!state.data);
  }

  /** Sends a change like the LWC does, and waits for the answer of the extension */
  async function write(type: string, data: any): Promise<any> {
    const sent = recordSentMessages(panel);
    const requestId = `test-${Date.now()}`;
    panel.simulateWebviewMessage({ type, data: { ...data, requestId } });
    const done = await waitFor(
      () =>
        sent.find(
          (message) =>
            message.type === "replacementWriteDone" &&
            message.data.requestId === requestId,
        ),
      30000,
      `the answer to ${type}`,
    );
    return done.data;
  }

  test("the panel opens at once on a loading state, then shows the rules sfdx-hardis lists", async function () {
    const opening = await openPanel();
    assert.strictEqual(opening.loading, true, "opened before the CLI answers");
    assert.strictEqual(
      opening.minimalCliVersion,
      RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
    );
    const state = await waitForLoaded("the rules", (data) => !!data.data);
    assert.strictEqual(state.error, null);
    const data = state.data;
    assert.strictEqual(data.definitions.length, 8);
    assert.deepStrictEqual(
      data.majorBranches.map((branch: any) => branch.branchName),
      ["integration", "uat", "preprod", "main"],
    );
    assert.strictEqual(data.layers.issue.number, 128);
    assert.strictEqual(data.builtInRules.length, 8);
    // Only the names of the variables of a secret reach the webview
    const password = data.effective.main.find(
      (rule: any) => rule.id === "payment-api-password",
    );
    assert.deepStrictEqual(password.resolved.variables, [
      "PAYMENT_API_PASSWORD_MAIN",
      "PAYMENT_API_PASSWORD",
    ]);
    assert.strictEqual(password.resolved.value, "");
    const call = callsOf("hardis:project:replacement:list").pop();
    assert.ok(call, "sf hardis:project:replacement:list must be called");
    assert.ok(call.args.includes("--json"), call.args.join(" "));
  });

  test("Refresh reads the rules again, never from the result of the last 20 seconds", async function () {
    await openLoaded();
    const before = callsOf("hardis:project:replacement:list").length;
    panel.simulateWebviewMessage({ type: "loadReplacementRules", data: {} });
    assert.strictEqual(panel.getInitializationData().loading, true);
    await waitForLoaded("refresh", (state) => !!state.data);
    assert.strictEqual(
      callsOf("hardis:project:replacement:list").length,
      before + 1,
    );
  });

  test("an sfdx-hardis without the replacement rules commands asks to be upgraded", async function () {
    process.env.SF_MOCK_REPLACEMENT = "old";
    await openPanel();
    const state = await waitForLoaded("old CLI", (data) => !!data.error);
    assert.strictEqual(state.error.kind, "cliTooOld");
    assert.strictEqual(state.data, null);
  });

  test("a failed reading shows the message of sfdx-hardis", async function () {
    process.env.SF_MOCK_REPLACEMENT = "error";
    await openPanel();
    const state = await waitForLoaded("failed reading", (data) => !!data.error);
    assert.strictEqual(state.error.kind, "other");
    assert.ok(
      state.error.message.includes("cannot be read"),
      state.error.message,
    );
  });

  test("saving a new rule runs create with the rule in a temporary file, then reads the rules again", async function () {
    await openLoaded();
    const listsBefore = callsOf("hardis:project:replacement:list").length;
    const filesBefore = ruleFilesLogged().length;
    const done = await write("saveReplacementRule", {
      mode: "create",
      layer: "branch",
      branch: "uat",
      rule: {
        id: "uat-support-email",
        type: "xml-value",
        files: "**/workflows/Case.workflow-meta.xml",
        xmlPath: "Workflow/alerts/senderAddress",
        value: "support-uat@example.com",
        notARuleField: "dropped",
      },
    });
    assert.strictEqual(done.ok, true, done.message);
    const call = callsOf("hardis:project:replacement:create").pop();
    assert.ok(call, "create must run");
    const args = call.args.join(" ");
    assert.ok(args.includes("--agent"), args);
    assert.ok(args.includes("--layer branch --branch uat"), args);
    assert.ok(args.includes("--rule-file"), args);
    const logged = ruleFilesLogged()[filesBefore];
    assert.deepStrictEqual(logged.rule, {
      id: "uat-support-email",
      type: "xml-value",
      files: "**/workflows/Case.workflow-meta.xml",
      xmlPath: "Workflow/alerts/senderAddress",
      value: "support-uat@example.com",
    });
    await waitFor(
      () => callsOf("hardis:project:replacement:list").length > listsBefore,
      20000,
      "the rules to be read again",
    );
    await waitForLoaded(
      "after the save",
      (state) => !!state.data && !state.busy,
    );
  });

  test("moving a rule to the issue creates it there, then deletes it from the project", async function () {
    await openLoaded();
    const createsBefore = callsOf("hardis:project:replacement:create").length;
    const deletesBefore = callsOf("hardis:project:replacement:delete").length;
    const done = await write("saveReplacementRule", {
      mode: "update",
      layer: "issue",
      branch: "",
      originalLayer: "project",
      originalBranch: "",
      rule: {
        id: "escalation-alert-sender",
        type: "xml-value",
        files: "**/workflows/Case.workflow-meta.xml",
        xmlPath: "Workflow/alerts[fullName=Escalation_Alert]/senderAddress",
        values: {
          main: "support@example.com",
          default: "support-test@example.com",
        },
      },
    });
    assert.strictEqual(done.ok, true, done.message);
    const create = callsOf("hardis:project:replacement:create")[createsBefore];
    const remove = callsOf("hardis:project:replacement:delete")[deletesBefore];
    assert.ok(create.args.join(" ").includes("--layer issue"));
    assert.ok(remove.args.join(" ").includes("--layer project"));
    assert.ok(remove.args.join(" ").includes("--id escalation-alert-sender"));
    assert.ok(create.time <= remove.time, "create first");
    await waitForLoaded(
      "after the move",
      (state) => !!state.data && !state.busy,
    );
  });

  test("turning a built-in rule off and deleting a rule run update and delete with --agent", async function () {
    await openLoaded();
    const toggled = await write("setReplacementRuleEnabled", {
      layer: "project",
      branch: "",
      id: "builtin-flow-groups",
      enabled: false,
    });
    assert.strictEqual(toggled.ok, true, toggled.message);
    const update = callsOf("hardis:project:replacement:update").pop();
    const updateArgs = update.args.join(" ");
    assert.ok(updateArgs.includes("--agent"), updateArgs);
    assert.ok(updateArgs.includes("--id builtin-flow-groups"), updateArgs);
    assert.ok(updateArgs.includes("--enabled false"), updateArgs);
    assert.ok(!updateArgs.includes("--rule-file"), updateArgs);
    await waitForLoaded("after the toggle", (state) => !state.busy);

    const deleted = await write("deleteReplacementRule", {
      layer: "branch",
      branch: "uat",
      id: "uat-hide-case-actions",
    });
    assert.strictEqual(deleted.ok, true, deleted.message);
    const remove = callsOf("hardis:project:replacement:delete").pop();
    assert.ok(
      remove.args
        .join(" ")
        .includes("--layer branch --branch uat --id uat-hide-case-actions"),
      remove.args.join(" "),
    );
    await waitForLoaded("after the delete", (state) => !state.busy);
  });

  test("an id that is not a rule id never reaches the CLI, and a failure of sfdx-hardis is told", async function () {
    await openLoaded();
    const updatesBefore = callsOf("hardis:project:replacement:update").length;
    const refused = await write("setReplacementRuleEnabled", {
      layer: "project",
      id: "x & calc",
      enabled: false,
    });
    assert.strictEqual(refused.ok, false);
    assert.strictEqual(
      callsOf("hardis:project:replacement:update").length,
      updatesBefore,
    );

    process.env.SF_MOCK_REPLACEMENT = "writeError";
    const failed = await write("deleteReplacementRule", {
      layer: "project",
      id: "payment-api-endpoint",
    });
    assert.strictEqual(failed.ok, false);
    assert.ok(failed.message.includes("xmlPath is required"), failed.message);
    delete process.env.SF_MOCK_REPLACEMENT;
    await waitForLoaded(
      "after the failure",
      (state) => !state.busy && !!state.data,
    );
  });

  test("the preview of a target runs on the local files and shows its results", async function () {
    await openLoaded();
    panel.simulateWebviewMessage({
      type: "previewReplacementRules",
      data: { targetBranch: "main" },
    });
    const state = await waitFor(
      () => {
        const current = panel.getInitializationData();
        return current.preview &&
          current.preview.result &&
          !current.preview.running
          ? current
          : null;
      },
      30000,
      "the preview",
    );
    assert.strictEqual(state.preview.targetBranch, "main");
    assert.strictEqual(state.preview.result.target.apiVersion, 67);
    assert.ok(
      state.preview.result.results.some(
        (result: any) => result.status === "risky-element",
      ),
    );
    const call = callsOf("hardis:project:replacement:preview").pop();
    const args = call.args.join(" ");
    assert.ok(args.includes("--agent"), args);
    assert.ok(args.includes("--target-branch main"), args);

    panel.simulateWebviewMessage({
      type: "previewReplacementRules",
      data: { targetBranch: "default" },
    });
    await waitFor(
      () => {
        const current = panel.getInitializationData();
        return current.preview?.targetBranch === "default" &&
          current.preview.result &&
          !current.preview.running
          ? current
          : null;
      },
      30000,
      "the preview of a dev sandbox",
    );
    const defaultCall = callsOf("hardis:project:replacement:preview").pop();
    assert.ok(!defaultCall.args.includes("--target-branch"));
  });

  test("the command of the DevOps Pipeline menu and the commands tree is registered", async function () {
    await openLoaded();
    await assertShowCommandBringsPanelBack(
      panelManager,
      panel,
      LWC_ID,
      SHOW_COMMAND,
    );
    await waitForLoaded("the rules", (state) => !!state.data);
  });
});
