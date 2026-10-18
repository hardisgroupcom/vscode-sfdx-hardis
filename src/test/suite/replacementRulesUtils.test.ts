import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  DOCSITE_URL,
  PANEL_DOC_URLS,
  RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
} from "../../constants";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";
import {
  buildReplacementListCommand,
  buildReplacementPreviewCommand,
  buildReplacementWriteCommand,
  checkReplacementWriteOperation,
  isReplacementCommandUnknown,
  normalizeReplacementRuleDraft,
  readReplacementListOutcome,
  readReplacementPreviewOutcome,
  sanitizeReplacementList,
  describeWriteRequest,
} from "../../utils/replacementRulesUtils";
import {
  REPO_ROOT,
  assertFeatureKeysUsedAndClean,
  assertKeysTranslated,
  assertPanelCommandWired,
  collectComponentI18nKeys,
  loadLocale,
  readModuleFile,
  readSourceFile,
} from "./lwcSourceUtils";

/**
 * Tests of the Replacement Rules panel that need no VS Code window:
 *  - the commands the panel runs, quoted for the shell of the platform
 *  - what it makes of the answers of sfdx-hardis, and that no secret value reaches the webview
 *  - the rule it writes for sfdx-hardis, with only the fields of a rule
 *  - every label is translated, the stylesheets follow the theme, the panel is wired everywhere
 */

const MODULES = ["replacementRules", "replacementRuleEditor"];
// Keys of the commands tree, the pipeline menu and the extension host, which the components do not draw
const KEYS_OUTSIDE_THE_COMPONENTS = [
  "replacementRulesTooltip",
  "menuConfigureReplacementRules",
  "replacementRulesBusy",
  "replacementRulesSaved",
  "replacementRulesSaveError",
  "replacementRulesInvalidLayer",
];

function fixture(): any {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        REPO_ROOT,
        "test",
        "fixtures",
        "sf-shim",
        "replacement-rules.json",
      ),
      "utf8",
    ),
  );
}

/**
 * The LWC webview bundle cannot be executed in this test host, but s/datatableSortUtils
 * is made of pure functions without any import: its source is evaluated here.
 */
function loadDatatableSortUtils(): any {
  const source = readModuleFile("datatableSortUtils", "datatableSortUtils.js");
  assert.ok(!/^import /m.test(source), "the module must stay free of imports");
  const body =
    source.replace(/^export /gm, "") +
    "\nreturn { makeColumnsSortable, sortDatatableRows, sortStateFromEvent };";
  return new Function(body)();
}

suite("Replacement Rules panel", () => {
  test("the progress title says what is saved and where", () => {
    const layers: any = { project: { file: "config/.sfdx-hardis.yml", count: 1 }, branches: [{ branch: "uat", file: "config/branches/.sfdx-hardis.uat.yml", count: 1 }], issue: { available: true, number: 128, url: "", error: "", count: 0 } };
    assert.deepStrictEqual(describeWriteRequest([{ action: "create", layer: "project", rule: { id: "x" } }], layers), { key: "replacementRulesSavingIn", vars: { id: "x" }, place: "config/.sfdx-hardis.yml" });
    assert.deepStrictEqual(describeWriteRequest([{ action: "update", layer: "branch", branch: "uat", id: "x" }], layers), { key: "replacementRulesSavingIn", vars: { id: "x" }, place: "config/branches/.sfdx-hardis.uat.yml" });
    assert.deepStrictEqual(describeWriteRequest([{ action: "update", layer: "issue", id: "x", enabled: false }], layers), { key: "replacementRulesTurningOffIn", vars: { id: "x" }, placeKey: "replacementRulesPlaceIssueNumber", placeVars: { number: "128" } });
    assert.strictEqual(describeWriteRequest([{ action: "create", layer: "issue", rule: { id: "x" } }, { action: "delete", layer: "project", id: "x" }], layers).key, "replacementRulesMovingTo");
    assert.strictEqual(describeWriteRequest([{ action: "delete", layer: "project", id: "x" }], null).key, "replacementRulesDeletingFrom");
  });

  test("a click on a column header sorts every table of the panel", () => {
    const sortUtils = loadDatatableSortUtils();
    const rows = [{ id: "b", api: "68.0" }, { id: "a", api: "" }, { id: "c", api: "9.0" }];
    assert.deepStrictEqual(sortUtils.sortDatatableRows(rows, "api", "asc").map((row: any) => row.id), ["c", "b", "a"]);
    assert.deepStrictEqual(sortUtils.sortDatatableRows(rows, "api", "desc").map((row: any) => row.id), ["b", "c", "a"]);
    assert.deepStrictEqual(sortUtils.sortDatatableRows(rows, null, "asc"), rows);
    const columns = sortUtils.makeColumnsSortable([{ fieldName: "id" }, { type: "action" }]);
    assert.strictEqual(columns[0].sortable, true);
    assert.strictEqual(columns[1].sortable, undefined);
    assert.deepStrictEqual(sortUtils.sortStateFromEvent({ detail: { fieldName: "id", sortDirection: "desc" } }), { fieldName: "id", direction: "desc" });
    const html = fs.readFileSync(path.resolve(__dirname, "../../../src/webviews/lwc-ui/modules/s/replacementRules/replacementRules.html"), "utf8");
    for (const table of ["rules", "values", "builtin", "preview"]) {
      assert.ok(html.includes(`sorted-by={sorts.${table}.fieldName}`), `table ${table} is sortable`);
    }
    assert.strictEqual((html.match(/onsort=\{handleTableSort\}/g) || []).length, 4);
  });

  test("the rules are read with the list command, and previewed for one target", () => {
    assert.strictEqual(
      buildReplacementListCommand(),
      "sf hardis:project:replacement:list --json",
    );
    assert.strictEqual(
      buildReplacementPreviewCommand(null, "linux"),
      "sf hardis:project:replacement:preview --agent --json",
    );
    assert.strictEqual(
      buildReplacementPreviewCommand("default", "linux"),
      "sf hardis:project:replacement:preview --agent --json",
    );
    assert.strictEqual(
      buildReplacementPreviewCommand("uat", "linux"),
      "sf hardis:project:replacement:preview --agent --target-branch 'uat' --json",
    );
    assert.strictEqual(
      buildReplacementPreviewCommand("uat", "win32"),
      'sf hardis:project:replacement:preview --agent --target-branch "uat" --json',
    );
  });

  test("a change of a rule is one create, update or delete command, values quoted for the shell", () => {
    assert.strictEqual(
      buildReplacementWriteCommand(
        {
          action: "create",
          layer: "branch",
          branch: "uat",
          ruleFile: "C:\\Temp\\rule dir\\x.json",
        },
        "win32",
      ),
      'sf hardis:project:replacement:create --agent --layer branch --branch "uat" --rule-file "C:\\Temp\\rule dir\\x.json" --json',
    );
    assert.strictEqual(
      buildReplacementWriteCommand(
        {
          action: "update",
          layer: "issue",
          id: "builtin-flow-groups",
          enabled: false,
        },
        "linux",
      ),
      "sf hardis:project:replacement:update --agent --layer issue --id 'builtin-flow-groups' --enabled false --json",
    );
    assert.strictEqual(
      buildReplacementWriteCommand(
        { action: "delete", layer: "project", id: "payment-api-endpoint" },
        "linux",
      ),
      "sf hardis:project:replacement:delete --agent --layer project --id 'payment-api-endpoint' --json",
    );
  });

  test("an id, a layer or a branch sfdx-hardis would refuse never reaches a command line", () => {
    assert.strictEqual(
      checkReplacementWriteOperation({
        action: "update",
        layer: "project",
        id: "payment-api-endpoint",
      }),
      null,
    );
    assert.strictEqual(
      checkReplacementWriteOperation({
        action: "update",
        layer: "project",
        id: "x; rm -rf /",
      }),
      "replacementRulesInvalidId",
    );
    assert.strictEqual(
      checkReplacementWriteOperation({
        action: "delete",
        layer: "user" as any,
        id: "abc",
      }),
      "replacementRulesInvalidLayer",
    );
    assert.strictEqual(
      checkReplacementWriteOperation({
        action: "create",
        layer: "branch",
        branch: "uat && calc",
      }),
      "replacementRulesInvalidBranch",
    );
    assert.strictEqual(
      checkReplacementWriteOperation({
        action: "create",
        layer: "branch",
        branch: "release/2026-10",
      }),
      null,
    );
  });

  test("the rule written for sfdx-hardis holds only the fields of a rule, empty ones left out", () => {
    assert.deepStrictEqual(
      normalizeReplacementRuleDraft({
        id: " payment-api-endpoint ",
        description: "",
        type: "xml-value",
        files: [
          "**/namedCredentials/Payment_API.namedCredential-meta.xml",
          " ",
        ],
        xmlPath: "NamedCredential/endpoint",
        find: "ignored for an XML rule",
        values: { uat: "https://pay-uat.example.com", main: "", default: "x" },
        includeTargetBranches: [],
        required: false,
        unknownField: "dropped",
      }),
      {
        id: "payment-api-endpoint",
        type: "xml-value",
        files: "**/namedCredentials/Payment_API.namedCredential-meta.xml",
        xmlPath: "NamedCredential/endpoint",
        values: { uat: "https://pay-uat.example.com", default: "x" },
      },
    );
    // A removal takes no value
    assert.deepStrictEqual(
      normalizeReplacementRuleDraft({
        id: "uat-hide-case-actions",
        type: "xml-remove",
        files: "**/layouts/Case-*.layout-meta.xml",
        xmlPath: "Layout/platformActionList",
        value: "x",
        includeTargetBranches: ["uat"],
        required: true,
      }),
      {
        id: "uat-hide-case-actions",
        type: "xml-remove",
        files: "**/layouts/Case-*.layout-meta.xml",
        xmlPath: "Layout/platformActionList",
        includeTargetBranches: ["uat"],
        required: true,
      },
    );
    // A secret is a variable name, a searched text keeps its spaces
    assert.deepStrictEqual(
      normalizeReplacementRuleDraft({
        id: "apex-host",
        type: "text",
        files: ["**/classes/*.cls", "**/lwc/**/*.js"],
        find: " https://old ",
        regex: true,
        secret: " PAYMENT_HOST ",
      }),
      {
        id: "apex-host",
        type: "text",
        files: ["**/classes/*.cls", "**/lwc/**/*.js"],
        find: " https://old ",
        regex: true,
        secret: "PAYMENT_HOST",
      },
    );
    // An override keeps only what it changes, an explicit enabled included
    assert.deepStrictEqual(
      normalizeReplacementRuleDraft({
        id: "builtin-flow-schedule-day-of-month",
        enabled: false,
      }),
      { id: "builtin-flow-schedule-day-of-month", enabled: false },
    );
  });

  test("a successful list answer is drawn, sorted by sfdx-hardis, with no secret value", () => {
    const outcome = readReplacementListOutcome({
      status: 0,
      result: fixture().list,
    });
    assert.ok("view" in outcome);
    const view = outcome.view;
    assert.strictEqual(view.definitions.length, 9);
    assert.deepStrictEqual(
      view.majorBranches.map((branch) => branch.branchName),
      ["integration", "uat", "preprod", "main"],
    );
    assert.deepStrictEqual(Object.keys(view.effective), [
      "integration",
      "uat",
      "preprod",
      "main",
      "default",
    ]);
    assert.strictEqual(view.layers.issue.number, 128);
    assert.strictEqual(view.builtInRules.length, 8);
    const password = view.effective.uat.find(
      (rule) => rule.id === "payment-api-password",
    );
    assert.deepStrictEqual(password?.resolved, {
      source: "secret",
      value: "",
      variables: ["PAYMENT_API_PASSWORD_UAT", "PAYMENT_API_PASSWORD"],
    });
    const override = view.definitions.find(
      (definition) =>
        definition.layer === "issue" &&
        definition.rule.id === "partner-site-admin",
    );
    assert.deepStrictEqual(override?.overrides, ["project"]);
    assert.deepStrictEqual(view.secretLookups.PAYMENT_API_PASSWORD[4], {
      target: "default",
      variables: ["PAYMENT_API_PASSWORD"],
    });
  });

  test("a secret value sfdx-hardis would answer by mistake, an unsafe link and unknown fields are dropped", () => {
    const list = fixture().list;
    const passwordIndex = list.effective.uat.findIndex(
      (rule: any) => rule.id === "payment-api-password",
    );
    list.effective.uat[passwordIndex].resolved.value = "s3cr3t";
    list.layers.issue.url = "javascript:alert(1)";
    list.definitions[0].rule.extra = "dropped";
    const view = sanitizeReplacementList(list);
    assert.strictEqual(view.effective.uat[passwordIndex].resolved.value, "");
    assert.ok(!JSON.stringify(view).includes("s3cr3t"));
    assert.strictEqual(view.layers.issue.url, "");
    assert.ok(!("extra" in view.definitions[0].rule));
  });

  test("an sfdx-hardis without the replacement rules commands is told apart from a failure", () => {
    const unknown = {
      status: 127,
      name: "CommandNotFoundError",
      message: "Command hardis:project:replacement:list not found.",
    };
    assert.strictEqual(isReplacementCommandUnknown(unknown), true);
    assert.deepStrictEqual(readReplacementListOutcome(unknown), {
      error: { kind: "cliTooOld", message: "" },
    });
    assert.strictEqual(
      isReplacementCommandUnknown({
        status: 1,
        stderr: "Warning: hardis:project:replacement:list is not a sf command.",
      }),
      true,
    );
    assert.deepStrictEqual(
      readReplacementListOutcome({
        status: 1,
        message: "The project configuration cannot be read",
      }),
      {
        error: {
          kind: "other",
          message: "The project configuration cannot be read",
        },
      },
    );
    assert.strictEqual(isReplacementCommandUnknown({ status: 0 }), false);
  });

  test("a preview answer keeps its results, warnings and applied rules", () => {
    const outcome = readReplacementPreviewOutcome({
      status: 0,
      result: fixture().preview.main,
    });
    assert.ok("preview" in outcome);
    assert.deepStrictEqual(outcome.preview.target, {
      targetBranch: "main",
      label: "main",
      apiVersion: 67,
    });
    assert.ok(
      outcome.preview.results.some(
        (result) => result.status === "risky-element",
      ),
    );
    assert.strictEqual(outcome.preview.warnings.length, 2);
    const unknownStatus = readReplacementPreviewOutcome({
      status: 0,
      result: { results: [{ file: "a", ruleId: "b", status: "weird" }] },
    });
    assert.ok("preview" in unknownStatus);
    assert.strictEqual(unknownStatus.preview.results[0].status, "unchanged");
  });

  test("the extension writes a rule in a temporary file removed after the command, and never the YAML", () => {
    const command = readSourceFile("commands/showReplacementRules.ts");
    assert.ok(command.includes("fs.promises.mkdtemp("));
    assert.ok(
      command.includes(
        "fs.promises.rm(tmpDir, { recursive: true, force: true })",
      ),
    );
    assert.ok(command.includes("reuseRecentResult: false"));
    assert.ok(command.includes("shareInFlightRun: false"));
    assert.ok(command.includes("collectProviderCredentialEnvVarsWithStatus"));
    assert.ok(
      !/writeGlobalConfigValues|writeBranchConfigValues|yaml/i.test(command),
    );
    assert.ok(!command.includes("customFunctionsUtils"));
  });

  test("the components send changes to the extension and draw what they receive", () => {
    const js = readModuleFile("replacementRules", "replacementRules.js");
    const html = readModuleFile("replacementRules", "replacementRules.html");
    const editorHtml = readModuleFile(
      "replacementRuleEditor",
      "replacementRuleEditor.html",
    );
    for (const type of [
      "loadReplacementRules",
      "saveReplacementRule",
      "setReplacementRuleEnabled",
      "deleteReplacementRule",
      "previewReplacementRules",
      "connectToGit",
    ]) {
      assert.ok(js.includes(`"${type}"`), type);
      assert.ok(
        readSourceFile("commands/showReplacementRules.ts").includes(
          `"${type}"`,
        ),
        `${type} is handled by the extension`,
      );
    }
    // A rule is deleted from the confirmation window only
    assert.ok(html.includes("onclick={handleDeleteConfirm}"));
    assert.ok(html.includes('class="hardis-btn-tinted-red"'));
    for (const template of [html, editorHtml]) {
      assert.ok(!template.includes("lwc:inner-html"));
      assert.ok(!template.includes("lwc:dom"));
      assert.ok(
        !/<lightning-button[^>]*variant="(brand|success|destructive)/.test(
          template,
        ),
      );
    }
    assert.ok(!js.includes("innerHTML"));
    assert.strictEqual((js.match(/type: "openExternal"/g) || []).length, 1);
    assert.ok(js.includes("const safeUrl = httpUrl(url);"));
    assert.ok(html.includes("<s-hardis-datatable"));
    assert.ok(html.includes('class="hardis-page-head"'));
  });

  test("the stylesheets of the panel have no hardcoded color nor font", () => {
    for (const module of MODULES) {
      const css = readModuleFile(module, `${module}.css`);
      assert.ok(
        !/#[0-9a-fA-F]{3,8}\b|rgba?\(|font-family|font-weight: *[0-9]|data-theme|--vscode-/.test(
          css,
        ),
        module,
      );
    }
  });

  test("every label of the panel is translated in the 9 locales, without em-dash", () => {
    const keys = new Set<string>();
    for (const module of MODULES) {
      for (const key of collectComponentI18nKeys(module)) {
        keys.add(key);
      }
      const js = readModuleFile(module, `${module}.js`);
      for (const [, key] of js.matchAll(/"(replacementRules\w+)"/g)) {
        keys.add(key);
      }
    }
    assert.ok(keys.size > 120, `keys found: ${keys.size}`);
    // Keys the extension host gives, refusals and errors included
    for (const source of [
      "commands/showReplacementRules.ts",
      "utils/replacementRulesUtils.ts",
    ]) {
      for (const [, key] of readSourceFile(source).matchAll(
        /"(replacementRules\w+)"/g,
      )) {
        keys.add(key);
      }
    }
    assertKeysTranslated(keys);
    assertKeysTranslated(KEYS_OUTSIDE_THE_COMPONENTS);
    assertFeatureKeysUsedAndClean(
      (key) =>
        key.startsWith("replacementRules") ||
        key === "menuConfigureReplacementRules",
      new Set([...keys, ...KEYS_OUTSIDE_THE_COMPONENTS]),
    );
    assert.strictEqual(
      loadLocale("en").replacementRulesTitle,
      "Replacement Rules (Beta)",
    );
  });

  test("the DevOps Pipeline settings menu always opens the panel", () => {
    const html = readModuleFile("pipeline", "pipeline.html");
    const js = readModuleFile("pipeline", "pipeline.js");
    const entry = html.indexOf("onclick={handleShowReplacementRules}");
    assert.ok(entry > -1);
    assert.ok(html.includes("label={i18n.menuConfigureReplacementRules}"));
    assert.ok(entry > html.indexOf("onclick={handleShowOrgInit}"));
    assert.ok(entry < html.indexOf("</lightning-button-menu>"));
    // Not inside a conditional template
    const before = html.slice(
      html.lastIndexOf("<lightning-menu-item", entry) - 80,
      entry,
    );
    assert.ok(!before.includes("<template"), before);
    assert.ok(
      js.includes('command: "vscode-sfdx-hardis.showReplacementRules"'),
    );
  });

  test("the panel command is declared, registered and has its icon and documentation", () => {
    assertPanelCommandWired({
      commandId: "vscode-sfdx-hardis.showReplacementRules",
      registerCall: "registerShowReplacementRules(this)",
      lwcId: "s-replacement-rules",
      module: "replacementRules",
    });
    assert.ok(
      readSourceFile("webviews/lwc-ui-panel.ts").includes(
        '"s-replacement-rules": t("replacementRulesTitle")',
      ),
    );
    assert.strictEqual(
      PANEL_DOC_URLS["s-replacement-rules"],
      DOCSITE_URL + "/salesforce-devops-config-replacement-rules/",
    );
    assert.strictEqual(RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION, "8.20.0");
  });

  test("the generic Pipeline Settings editor leaves the replacement rules to the panel", () => {
    const configurable = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.map(
      (field) => field.name,
    );
    assert.ok(!configurable.includes("replacementRules"));
    assert.ok(!configurable.includes("secretsProvider"));
    for (const section of SfdxHardisConfigHelper.SECTIONS) {
      assert.ok(!section.keys.includes("replacementRules"), section.label);
      assert.ok(!section.keys.includes("secretsProvider"), section.label);
    }
  });
});
