import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import { LOCALES, loadLocale, readModuleFile } from "./lwcSourceUtils";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";

/**
 * Contract tests for the anonymization configuration editor
 * (s/anonymizationConfig), shared by the Pipeline Settings panel and the
 * Monitoring Config Workbench.
 *
 * The LWC bundle cannot be executed in the extension test host, so the
 * component contracts are asserted statically on its sources:
 *  - a per-channel level can only RAISE the global one, never weaken it
 *  - a configuration back to the defaults is emitted as null, so the save
 *    removes the property instead of writing an empty block
 *  - both panels embed the same component
 *  - the property is editable in Pipeline Settings (global scope only)
 *  - every i18n key it uses exists in the 9 locales
 *  - its stylesheet holds no hardcoded color (webviews render in both themes)
 */

suite("Anonymization configuration contract", () => {
  const js = readModuleFile("anonymizationConfig", "anonymizationConfig.js");
  const html = readModuleFile(
    "anonymizationConfig",
    "anonymizationConfig.html",
  );
  const css = readModuleFile("anonymizationConfig", "anonymizationConfig.css");

  test("the three levels and the four channels of the CLI are all offered", () => {
    assert.match(
      js,
      /const LEVELS = \["off", "standard", "strict"\];/,
      "levels must match the enum of the sfdx-hardis JSON schema",
    );
    assert.match(
      js,
      /const CHANNELS = \["files", "api", "email", "messaging"\];/,
      "channels must match the ones of the sfdx-hardis JSON schema",
    );
    // Each channel row carries its own label and its own explanation of what
    // that destination receives
    for (const channel of ["Files", "Api", "Email", "Messaging"]) {
      assert.ok(
        js.includes(`this.i18n.anonymizationChannel${channel}`),
        `channel ${channel} must have a label`,
      );
      assert.ok(
        js.includes(`this.i18n.anonymizationDesc${channel}`),
        `channel ${channel} must explain what that destination receives`,
      );
    }
  });

  test("a channel level can only raise the level in force", () => {
    // The options offered for a channel start at the level in force
    assert.match(
      js,
      /LEVELS\.slice\(LEVELS\.indexOf\(this\.effectiveLevel\)\)/,
      "the channel combobox must only offer levels at or above the one in force",
    );
    // A stored weaker value is clamped up on load, so the panel shows what the
    // CLI really applies instead of an option that never takes effect
    const normalize = js.substring(js.indexOf("_normalize(rawValue)"));
    assert.match(
      normalize.substring(0, 1100),
      /const floor = level \|\| DEFAULT_LEVEL;/,
      "the clamping floor must fall back to the sfdx-hardis default level",
    );
    assert.match(
      normalize.substring(0, 1100),
      /LEVELS\.indexOf\(channelLevel\) < LEVELS\.indexOf\(floor\)/,
      "loading must clamp a channel level weaker than the one in force",
    );
    // Raising the global level raises the channels that were below it
    const levelClick = js.substring(js.indexOf("handleLevelClick(event)"));
    assert.match(
      levelClick.substring(0, 900),
      /LEVELS\.indexOf\(channelLevel\) < LEVELS\.indexOf\(level\)/,
      "raising the global level must raise the channels that were below it",
    );
  });

  test("the level in force is highlighted even when nothing is configured", () => {
    // Without this, an unconfigured repository showed three unselected cards
    // and the panel never answered "which level applies today"
    assert.match(
      js,
      /const DEFAULT_LEVEL = "standard";/,
      "the sfdx-hardis default level must be known to the editor",
    );
    assert.match(
      js,
      /get effectiveLevel\(\)\s*\{\s*return this\._config\.level \|\| DEFAULT_LEVEL;/,
      "the level in force must fall back to the default",
    );
    const cards = js.substring(js.indexOf("get levelCards()"));
    assert.match(
      cards.substring(0, 1400),
      /const selected = effectiveLevel === level;/,
      "the card of the level in force must be the selected one",
    );
    // ...but a default is not a choice: the badge keeps the two apart
    assert.match(
      cards.substring(0, 1400),
      /showDefaultBadge: selected && isDefault,/,
      "the default must be badged instead of passing for an explicit choice",
    );
    assert.ok(
      html.includes("{i18n.anonymizationDefaultBadge}"),
      "the level card must render the default badge",
    );
  });

  test("a configuration back to the defaults is emitted as null", () => {
    assert.match(
      js,
      /Object\.keys\(built\)\.length > 0\s*\?\s*built\s*:\s*null/,
      "an empty configuration must be emitted as null, never as an empty object",
    );
    assert.match(js, /handleReset\(\)/, "a reset to defaults must be offered");
  });

  test("the editor is read-only when the hosting panel is", () => {
    assert.match(js, /@api readOnly = false;/);
    assert.match(
      js,
      /get isEditable\(\)\s*\{\s*return this\.readOnly !== true;/,
      "every control must be gated by isEditable",
    );
    assert.match(
      js,
      /handleLevelClick\(event\) \{\s*if \(!this\.isEditable\)/,
      "clicking a level card must do nothing in read-only mode",
    );
  });

  test("the controls of the editor never leak their own change event", () => {
    // lightning-combobox and lightning-input dispatch `change` with
    // bubbles + composed: without stopPropagation the raw control value would
    // reach the panel listener and replace the whole anonymization object
    for (const handler of [
      "handleEnforceLocallyChange",
      "handleChannelChange",
    ]) {
      const body = js.substring(js.indexOf(`${handler}(event)`));
      assert.match(
        body.substring(0, 200),
        /event\.stopPropagation\(\);/,
        `${handler} must stop the propagation of the control event`,
      );
    }
    // Both panels also refuse a value that is not the whole object
    for (const [module, file] of [
      ["pipelineConfig", "pipelineConfig.js"],
      ["monitoringConfig", "monitoringConfig.js"],
    ]) {
      assert.match(
        readModuleFile(module, file),
        /value !== null && typeof value !== "object"/,
        `${module} must ignore a change event carrying a raw control value`,
      );
    }
  });

  test("both configuration panels embed the same editor", () => {
    const pipelineHtml = readModuleFile(
      "pipelineConfig",
      "pipelineConfig.html",
    );
    const monitoringHtml = readModuleFile(
      "monitoringConfig",
      "monitoringConfig.html",
    );
    assert.ok(
      pipelineHtml.includes("<s-anonymization-config"),
      "Pipeline Settings must render the shared anonymization editor",
    );
    assert.ok(
      monitoringHtml.includes("<s-anonymization-config"),
      "the Monitoring Config Workbench must render the shared editor too",
    );
    // Read-only in the view mode of the settings panel, editable when editing
    assert.ok(
      pipelineHtml.includes("read-only={isViewMode}"),
      "the settings panel must pass its view mode down to the editor",
    );
  });

  test("anonymization is a global-scoped field of the Security & Privacy section", () => {
    const field = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.find(
      (entry) => entry.name === "anonymization",
    );
    assert.ok(field, "anonymization must be a configurable field");
    assert.deepStrictEqual(
      field!.scopes,
      ["global"],
      "anonymization is not branch-scoped in sfdx-hardis",
    );
    const section = SfdxHardisConfigHelper.SECTIONS.find(
      (entry) => entry.label === "securityPrivacy",
    );
    assert.ok(section, "a Security & Privacy section must exist");
    assert.ok(
      section!.keys.includes("anonymization"),
      "the Security & Privacy section must hold the anonymization field",
    );
  });

  test("every i18n key of the editor exists in the 9 locales", () => {
    const usedKeys = new Set<string>();
    for (const match of js.matchAll(/this\.i18n\.(\w+)/g)) {
      usedKeys.add(match[1]);
    }
    for (const match of html.matchAll(/\{i18n\.(\w+)\}/g)) {
      usedKeys.add(match[1]);
    }
    assert.ok(usedKeys.size > 10, "the editor must be fully translated");
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      for (const key of usedKeys) {
        assert.ok(
          typeof translations[key] === "string" && translations[key].length > 0,
          `missing i18n key "${key}" in ${locale}.json`,
        );
      }
    }
  });

  test("the Security & Privacy section label is translated in the 9 locales", () => {
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      assert.ok(
        typeof translations.securityPrivacy === "string" &&
          translations.securityPrivacy.length > 0,
        `missing i18n key "securityPrivacy" in ${locale}.json`,
      );
    }
  });

  test("saving writes a nested block, and a reset removes the property", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "sfdx-hardis-anonymization-"),
    );
    const configPath = path.join(workspaceRoot, ".sfdx-hardis.yml");
    fs.writeFileSync(configPath, "developmentBranch: integration\n", "utf8");
    const helper = new SfdxHardisConfigHelper(workspaceRoot);
    await SfdxHardisConfigHelper.loadSchema();

    await helper.saveConfigFromEditor({
      config: {
        anonymization: {
          level: "standard",
          channels: { api: "strict" },
        },
      },
      isBranch: false,
      branchName: "",
    });
    const saved: any = yaml.load(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(
      saved.developmentBranch,
      "integration",
      "the other properties of the file must be preserved",
    );
    assert.deepStrictEqual(saved.anonymization, {
      level: "standard",
      channels: { api: "strict" },
    });

    // Back to the sfdx-hardis defaults: the property is removed, not emptied
    await helper.saveConfigFromEditor({
      config: { anonymization: null },
      isBranch: false,
      branchName: "",
    });
    const reset: any = yaml.load(fs.readFileSync(configPath, "utf8"));
    assert.ok(
      !("anonymization" in reset),
      "a reset must delete the property instead of writing `anonymization: null`",
    );
    assert.strictEqual(reset.developmentBranch, "integration");
  });

  test("the stylesheet holds no hardcoded color", () => {
    assert.doesNotMatch(
      css,
      /#[0-9a-fA-F]{3,8}\b|rgba?\(|color:\s*(white|black)/,
      "colors must come from the hardis kit, so both VS Code themes render",
    );
  });
});
