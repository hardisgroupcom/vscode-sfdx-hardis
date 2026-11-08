import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  BUILT_IN_ACTION_TYPES,
  isBuiltInActionType,
} from "../../utils/prePostCommandsUtils";
import { handleDeploymentActionPickerMessage } from "../../utils/pipeline/deploymentActionPickers";
import { BROWSERFORCE_MIN_VERSION } from "../../utils/browserforceCatalogUtils";
import {
  REPO_ROOT,
  assertKeysTranslated,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * A "browser" deployment action applies one Browserforce setting to the org, before or after the
 * deployment. Its editor is a component of its own (s/browserforceSettingEditor), fed with the
 * Browserforce catalog the extension reads, and the value is checked by Browserforce before saving.
 */

const BROWSER_EDITOR_MODULE = "browserforceSettingEditor";

// The shared host helper has no import: its source is evaluated here with a fake window
function loadHostUtils(fakeWindow: any): any {
  const source = readModuleFile(
    "browserforceHostUtils",
    "browserforceHostUtils.js",
  );
  assert.ok(!/^import /m.test(source), "the module must stay free of imports");
  const exported = [...source.matchAll(/^export function (\w+)/gm)].map(
    (match) => match[1],
  );
  const body =
    source.replace(/^export /gm, "") + `\nreturn { ${exported.join(", ")} };`;
  return new Function("window", body)(fakeWindow);
}

suite("Deployment action browser (Browserforce setting)", () => {
  test("browser is a built-in action type", () => {
    assert.ok(BUILT_IN_ACTION_TYPES.includes("browser"));
    assert.strictEqual(isBuiltInActionType("browser"), true);
  });

  test("the editor offers the type before and after the deployment, in every job", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(js, /\{ label: this\.t\("browserType"\), value: "browser" \}/);
    assert.match(
      js,
      /browser: \{[^}]*when: \["pre-deploy", "post-deploy"\],\s+context: \["all", "check-deployment-only", "process-deployment-only"\],/,
    );
  });

  test("the type is never offered as an org initialization step", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /_buildOrgInitTypeOptions\(\) \{[\s\S]*?\.filter\(\(option\) => option\.value !== "browser"\);/,
    );
  });

  test("a new action starts without a setting and runs once by org", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /if \(type === "browser"\) \{\s+return \{ setting: "", config: \{\} \};/,
    );
    assert.match(
      js,
      /newType === "browser"\) \{\s+this\.editedAction\.runOnlyOnceByOrg = true;/,
    );
    assert.match(
      js,
      /currentType === "browser"\) \{\s+requiredFields\.push\("parameters\.setting"\);/,
    );
  });

  test("saving asks Browserforce to check the value first", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(js, /new CustomEvent\("validatebrowserforceconfig"/);
    assert.match(js, /new CustomEvent\("loadbrowserforcecatalog"\)/);
    assert.match(
      js,
      /this\._saveAfterBrowserforceValidation = true;\s+this\._requestBrowserforceValidation\(\);\s+return;/,
    );
    const html = readModuleFile("deploymentAction", "deploymentAction.html");
    assert.ok(html.includes("<s-browserforce-setting-editor"));
    for (const attribute of [
      "onsettingchange={handleBrowserforceSettingChange}",
      "oncheckvalue={handleBrowserforceValidate}",
      "validation={browserforceValidation}",
    ]) {
      assert.ok(html.includes(attribute), `the editor must bind ${attribute}`);
    }
  });

  test("both panels hosting the editor pass it the catalog and the check", () => {
    for (const panel of ["pipeline", "pipelineConfig"]) {
      const html = readModuleFile(panel, `${panel}.html`);
      for (const attribute of [
        "browserforce-catalog={browserforceCatalog}",
        "browserforce-catalog-loading={browserforceCatalogLoading}",
        "browserforce-validation={browserforceValidation}",
        "onloadbrowserforcecatalog={handleLoadBrowserforceCatalog}",
        "onvalidatebrowserforceconfig={handleValidateBrowserforceConfig}",
      ]) {
        assert.ok(
          html.includes(attribute),
          `${panel} must pass ${attribute} to the editor`,
        );
      }
      const js = readModuleFile(panel, `${panel}.js`);
      assert.match(js, /from "s\/browserforceHostUtils"/);
      assert.match(js, /receiveBrowserforceCatalog\(this, data\)/);
      assert.match(js, /receiveBrowserforceValidation\(this, data\)/);
      assert.match(js, /requestBrowserforceCatalog\(this\)/);
      assert.match(js, /requestBrowserforceValidation\(this, event\)/);
      assert.ok(
        !js.includes('type: "validateBrowserforceConfig"'),
        `${panel} must use the shared helper, not its own copy`,
      );
    }
  });

  test("the shared host helper sends the requests and keeps only the expected answers", () => {
    const sent: any[] = [];
    const utils = loadHostUtils({
      sendMessageToVSCode: (message: any) => sent.push(message),
    });
    const host: any = {};
    utils.requestBrowserforceCatalog(host);
    assert.strictEqual(host.browserforceCatalogLoading, true);
    assert.strictEqual(sent[0].type, "loadBrowserforceCatalog");
    const catalogRequestId = sent[0].data.requestId;
    utils.receiveBrowserforceCatalog(host, { requestId: "old", catalog: 1 });
    assert.strictEqual(host.browserforceCatalog, undefined);
    utils.receiveBrowserforceCatalog(host, {
      requestId: catalogRequestId,
      catalog: 2,
    });
    assert.strictEqual(host.browserforceCatalog.catalog, 2);
    assert.strictEqual(host.browserforceCatalogLoading, false);

    // The editor names its check: the answer to an older one never reaches it
    utils.requestBrowserforceValidation(host, {
      detail: { requestId: "check-2", setting: "density", config: { a: 1 } },
    });
    assert.deepStrictEqual(sent[1], {
      type: "validateBrowserforceConfig",
      data: { requestId: "check-2", setting: "density", config: { a: 1 } },
    });
    utils.receiveBrowserforceValidation(host, { requestId: "check-1" });
    assert.strictEqual(host.browserforceValidation, undefined);
    utils.receiveBrowserforceValidation(host, {
      requestId: "check-2",
      valid: true,
    });
    assert.strictEqual(host.browserforceValidation.valid, true);
  });

  test("a save answer is used only for the value sent, and a check that never answers ends", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /const BROWSERFORCE_VALIDATION_TIMEOUT_MS = 3 \* 60 \* 1000;/,
    );
    // The answer must carry the id of the pending check
    assert.match(
      js,
      /val\.requestId !== this\._browserforceValidationRequestId/,
    );
    // The value sent is kept and compared when the answer comes
    assert.match(
      js,
      /this\._browserforceValidationSnapshot = this\._browserforceValueSnapshot\(\);/,
    );
    assert.match(
      js,
      /this\._browserforceValueSnapshot\(\) !== this\._browserforceValidationSnapshot[\s\S]*?browserforceValueChangedDuringCheck/,
    );
    // A form in error is never saved, even when Browserforce accepted the value
    assert.match(
      js,
      /_finishSaveAfterBrowserforceValidation\(validation\) \{\s+if \(this\._browserforceFormHasErrors\) \{/,
    );
    // No answer in time: the wait ends with a message, and the timer is cleared on close
    assert.match(
      js,
      /_handleBrowserforceValidationTimeout\(requestId\) \{[\s\S]*?this\._endBrowserforceValidationWait\(\);[\s\S]*?"browserforceCheckTimeout"/,
    );
    assert.match(
      js,
      /disconnectedCallback\(\) \{[\s\S]*?this\._clearBrowserforceValidationTimer\(\);/,
    );
  });

  test("the setting editor keeps what is typed and tells the parent its error state", () => {
    const js = readModuleFile(
      BROWSER_EDITOR_MODULE,
      `${BROWSER_EDITOR_MODULE}.js`,
    );
    // The second catalog answer (CI/CD variable names) does not rebuild the form
    assert.match(
      js,
      /set catalogState\(val\) \{[\s\S]*?if \(catalogJson === this\._catalogJson\) \{\s+return;\s+\}/,
    );
    // Clearing the errors of the form is told to the parent
    assert.match(
      js,
      /const hadFormErrors = this\.formErrors\.length > 0;[\s\S]*?if \(hadFormErrors\) \{[\s\S]*?this\._emitChange\(this\._hasErrors\(\)\)/,
    );
    // Each JSON mode switch tells the parent, and a form in error cannot switch to JSON
    const toggle = js.match(/handleJsonModeToggle\(event\) \{[\s\S]*?\n {2}\}/);
    assert.ok(toggle);
    assert.strictEqual(
      (toggle[0].match(/this\._emitChange\(this\._hasErrors\(\)\)/g) || [])
        .length,
      2,
    );
    assert.match(toggle[0], /"browserforceFixFormBeforeJson"/);
    // Check never runs on a form in error
    assert.match(
      js,
      /get isCheckDisabled\(\) \{[\s\S]*?this\.formErrors\.length > 0/,
    );
    // The minimum version comes from the extension, not from the component
    assert.match(js, /minimum: this\._catalogState\.minimumVersion/);
    assert.ok(!/BROWSERFORCE_MIN_VERSION|"7\.0\.0"/.test(js));
    const html = readModuleFile(
      BROWSER_EDITOR_MODULE,
      `${BROWSER_EDITOR_MODULE}.html`,
    );
    const handlers = [...html.matchAll(/on(?:change|click)=\{(handle\w+)\}/g)]
      .map((match) => match[1])
      .filter(
        (name) =>
          !["handleOpenSetup", "handleReloadCatalog", "handleCheck"].includes(
            name,
          ),
      );
    // The Setting picker is also disabled while the catalog loads
    const disabled = (
      html.match(/disabled=\{(?:inputsDisabled|settingPickerDisabled)\}/g) || []
    ).length;
    assert.strictEqual(
      disabled,
      handlers.length,
      "every input of the value is disabled while Browserforce checks it",
    );
  });

  test("the editor reads well: loading in the picker, readable fields, ENV variables apart", () => {
    const js = readModuleFile(
      BROWSER_EDITOR_MODULE,
      `${BROWSER_EDITOR_MODULE}.js`,
    );
    const html = readModuleFile(
      BROWSER_EDITOR_MODULE,
      `${BROWSER_EDITOR_MODULE}.html`,
    );
    // The loading text is the placeholder of the Setting picker, not a line of its own
    assert.ok(html.includes("placeholder={settingPickerPlaceholder}"));
    assert.ok(html.includes("loading={showCatalogLoading}"));
    assert.ok(!html.includes("{i18n.browserforceCatalogLoading}"));
    assert.match(js, /this\.i18n\.browserforceCatalogLoading/);
    // A boolean is a toggle, and no field has a checkbox: the ENV variable switch is a link
    assert.ok(!html.includes('type="checkbox"'));
    assert.match(html, /type="toggle"[\s\S]*?onchange=\{handleBooleanChange\}/);
    assert.match(
      html,
      /class="hardis-textlink bfe-variable-switch"[\s\S]*?onclick=\{handleVariableToggle\}/,
    );
    // Every field has a help icon and its raw key
    assert.ok(
      html.includes(
        '<s-multiline-helptext content={field.helpText} class="slds-icon-text-info"></s-multiline-helptext>',
      ),
    );
    assert.ok(html.includes("{field.rawKey}"));
    // Variable names are typed in capitals
    assert.match(
      js,
      /handleVariableNameChange\(event\) \{[\s\S]*?\.toUpperCase\(\)/,
    );
    // The Check button spins and says so, with no other checking text
    assert.match(html, /class="bfe-button-spinner"/);
    assert.match(js, /this\.i18n\.browserforceChecking/);
    assert.ok(!html.includes("{i18n.browserforceChecking}"));
  });

  test("the catalog answer skips the CI/CD variable names when Browserforce is missing", async () => {
    const previousDataDir = process.env.SF_DATA_DIR;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-no-plugin-"));
    process.env.SF_DATA_DIR = dataDir;
    try {
      const messages: any[] = [];
      const handled = await handleDeploymentActionPickerMessage(
        { sendMessage: (message) => messages.push(message) },
        "loadBrowserforceCatalog",
        { requestId: "c1" },
      );
      assert.strictEqual(handled, true);
      // One answer only: no second one waiting for sfdx-hardis
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].type, "returnBrowserforceCatalog");
      assert.strictEqual(messages[0].data.requestId, "c1");
      assert.strictEqual(messages[0].data.notInstalled, true);
      assert.strictEqual(messages[0].data.secretsLookup, null);
      assert.strictEqual(
        messages[0].data.minimumVersion,
        BROWSERFORCE_MIN_VERSION,
      );
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.SF_DATA_DIR;
      } else {
        process.env.SF_DATA_DIR = previousDataDir;
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("the Org Initialization panel does not wire the Browserforce editor", () => {
    const html = readModuleFile("orgInit", "orgInit.html");
    assert.ok(!html.includes("browserforce"));
  });

  test("the type has a label, an icon and a pill color of its own", () => {
    const utils = readModuleFile(
      "deploymentActionUtils",
      "deploymentActionUtils.js",
    );
    assert.match(utils, /browser: "browserType"/);
    assert.match(utils, /browser: "utility:desktop"/);
    const hueBlock = utils.match(/TYPE_HUE_BY_CODE = \{[\s\S]*?\};/);
    assert.ok(hueBlock);
    const hues = [...hueBlock[0].matchAll(/: "([a-z]+)"/g)].map(
      (match) => match[1],
    );
    assert.strictEqual(new Set(hues).size, hues.length, "hues must differ");
    assert.ok(hues.includes("orange"));
  });

  test("the picker answers a check that names no setting without starting a command", async () => {
    const messages: any[] = [];
    const handled = await handleDeploymentActionPickerMessage(
      { sendMessage: (message) => messages.push(message) },
      "validateBrowserforceConfig",
      { requestId: "r1", setting: "not a key!", config: {} },
    );
    assert.strictEqual(handled, true);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, "returnBrowserforceValidation");
    assert.strictEqual(messages[0].data.requestId, "r1");
    assert.strictEqual(messages[0].data.valid, false);
    assert.strictEqual(messages[0].data.errors.length, 1);
  });

  test("the editors never install Browserforce: they send the user to the Setup panel", () => {
    const source = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "src",
        "utils",
        "pipeline",
        "deploymentActionPickers.ts",
      ),
      "utf8",
    );
    assert.match(source, /type === "loadBrowserforceCatalog"/);
    assert.match(source, /type: "returnBrowserforceCatalog"/);
    const editorJs = readModuleFile(
      BROWSER_EDITOR_MODULE,
      `${BROWSER_EDITOR_MODULE}.js`,
    );
    assert.match(editorJs, /command: "vscode-sfdx-hardis\.showSetup"/);
    const sources = [
      source,
      editorJs,
      readModuleFile(BROWSER_EDITOR_MODULE, `${BROWSER_EDITOR_MODULE}.html`),
      readModuleFile("deploymentAction", "deploymentAction.js"),
      readModuleFile("deploymentAction", "deploymentAction.html"),
      ...["pipeline", "pipelineConfig"].flatMap((panel) => [
        readModuleFile(panel, `${panel}.js`),
        readModuleFile(panel, `${panel}.html`),
      ]),
    ];
    for (const text of sources) {
      assert.ok(!/installBrowserforce|installSfPlugin/i.test(text));
    }
  });

  test("the Setup panel can install Browserforce", () => {
    for (const file of ["hardis-plugins-provider.ts", "utils/setupUtils.ts"]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, "src", file), "utf8");
      assert.ok(
        source.includes('"sfdx-browserforce-plugin"'),
        `${file} must list sfdx-browserforce-plugin`,
      );
    }
  });

  test("every label of the editor exists in every locale", () => {
    const keys = new Set<string>(["browserType", "depBrowserforceExplanation"]);
    const sources = [
      readModuleFile(BROWSER_EDITOR_MODULE, `${BROWSER_EDITOR_MODULE}.html`),
      readModuleFile(BROWSER_EDITOR_MODULE, `${BROWSER_EDITOR_MODULE}.js`),
      readModuleFile("deploymentAction", "deploymentAction.js"),
      ...[
        "browserforceCatalogUtils.ts",
        "pipeline/deploymentActionPickers.ts",
      ].map((file) =>
        fs.readFileSync(path.join(REPO_ROOT, "src", "utils", file), "utf8"),
      ),
    ];
    for (const source of sources) {
      for (const [, key] of source.matchAll(/i18n\.(browserforce\w+)/g)) {
        keys.add(key);
      }
      for (const [, key] of source.matchAll(/"(browserforce[A-Z]\w+)"/g)) {
        keys.add(key);
      }
    }
    assert.ok(keys.size > 30, "the editor labels should have been collected");
    assertKeysTranslated(keys);
  });
});
