import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  BUILT_IN_ACTION_TYPES,
  isBuiltInActionType,
} from "../../utils/prePostCommandsUtils";
import { handleDeploymentActionPickerMessage } from "../../utils/pipeline/deploymentActionPickers";
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
      assert.match(js, /type: "validateBrowserforceConfig"/);
      assert.match(js, /handleReturnBrowserforceCatalog\(data\)/);
      assert.match(js, /handleReturnBrowserforceValidation\(data\)/);
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
