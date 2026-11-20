import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import {
  assertKeysTranslated,
  collectComponentI18nKeys,
  extractMember,
  readModuleFile,
} from "./lwcSourceUtils";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";

/**
 * Contract tests for the key/value editor (s/keyValueConfig), used by Pipeline
 * Settings for the object settings that map names to values, such as
 * releaseVersioningMinimumVariables ({ PI: 3, IT: 1 }).
 *
 * The LWC bundle cannot be executed in the extension test host, so the
 * component contracts are asserted statically on its sources.
 */

suite("Key/value configuration editor contract", () => {
  const js = readModuleFile("keyValueConfig", "keyValueConfig.js");
  const html = readModuleFile("keyValueConfig", "keyValueConfig.html");
  const css = readModuleFile("keyValueConfig", "keyValueConfig.css");

  test("Pipeline Settings renders it for any map of names to values, in both modes", () => {
    const pipelineJs = readModuleFile("pipelineConfig", "pipelineConfig.js");
    const pipelineHtml = readModuleFile(
      "pipelineConfig",
      "pipelineConfig.html",
    );
    assert.match(
      pipelineJs,
      /const isKeyValueObject =\s*isObject &&\s*!schema\.properties &&\s*!!schema\.additionalProperties/,
      "an object schema with only additionalProperties is a key/value setting",
    );
    const editors = pipelineHtml.match(/<s-key-value-config/g) || [];
    assert.strictEqual(
      editors.length,
      2,
      "one editable and one read-only editor",
    );
    assert.ok(
      pipelineHtml.includes("onchange={handleObjectEditorChange}"),
      "the editor change goes through the nested-object handler",
    );
  });

  test("an empty map is emitted as null, and control events never leak", () => {
    assert.match(
      js,
      /return Object\.keys\(built\)\.length > 0 \? built : null;/,
      "no complete pair left must remove the property instead of writing {}",
    );
    for (const handler of ["_updateRow(event, field)"]) {
      const body = js.substring(js.indexOf(handler));
      assert.match(
        body.substring(0, 250),
        /event\.stopPropagation\(\);/,
        `${handler} must stop the propagation of the input event`,
      );
    }
    // The schema patterns are checked in JS: the pattern attribute is compiled
    // with the v flag by the browser, which refuses [A-Za-z0-9_-]
    assert.doesNotMatch(html, /pattern=/);
    assert.match(js, /setCustomValidity/);
  });

  test("releaseVersioningMinimumVariables is editable at project and branch level", () => {
    const field = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.find(
      (entry) => entry.name === "releaseVersioningMinimumVariables",
    );
    assert.ok(
      field,
      "releaseVersioningMinimumVariables must be a configurable field",
    );
    assert.deepStrictEqual(field!.scopes, ["global", "branch"]);
    // A key outside every section is never shown by Pipeline Settings
    const sectionKeys = SfdxHardisConfigHelper.SECTIONS.flatMap(
      (section) => section.keys,
    );
    for (const key of [
      "releaseVersioningMinimumVariables",
      "releaseVersioningTagFormat",
    ]) {
      assert.ok(sectionKeys.includes(key), `${key} must be in a section`);
    }
  });

  test("every i18n key of the editor exists in the 9 locales", () => {
    const usedKeys = collectComponentI18nKeys("keyValueConfig");
    assert.ok(usedKeys.size >= 4, "the editor must be translated");
    assertKeysTranslated(usedKeys);
  });

  test("Save waits until every pair is valid, since an invalid pair is left out of the value", () => {
    assert.match(
      js,
      /@api\s+reportValidity\(\) \{/,
      "the editor must tell the panel when a pair is invalid",
    );
    assert.match(
      extractMember(js, "reportValidity()"),
      /row\.invalid\.name \|\| row\.invalid\.value/,
    );
    const handleSave = extractMember(
      readModuleFile("pipelineConfig", "pipelineConfig.js"),
      "handleSave()",
    );
    const check = handleSave.indexOf('querySelectorAll("s-key-value-config")');
    assert.ok(check > -1, "handleSave must check the key/value editors");
    assert.match(handleSave, /editor\.reportValidity\(\) === false/);
    assert.ok(
      check < handleSave.indexOf("sendMessageToVSCode"),
      "the check must come before the save message",
    );
  });

  test("saving writes the map, and an empty map removes it", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "sfdx-hardis-key-value-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, ".sfdx-hardis.yml"),
      "developmentBranch: integration\n",
      "utf8",
    );

    const saved = await saveProjectConfig(workspaceRoot, {
      releaseVersioningMinimumVariables: { PI: 3, IT: "05" },
    });
    assert.deepStrictEqual(saved.releaseVersioningMinimumVariables, {
      PI: 3,
      IT: "05",
    });
    assert.strictEqual(saved.developmentBranch, "integration");

    const reset = await saveProjectConfig(workspaceRoot, {
      releaseVersioningMinimumVariables: null,
    });
    assert.ok(!("releaseVersioningMinimumVariables" in reset));
  });

  test("a branch save never copies the inherited map or the default tag format", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "sfdx-hardis-key-value-branch-"),
    );
    const globalPath = path.join(workspaceRoot, "config", ".sfdx-hardis.yml");
    const branchPath = path.join(
      workspaceRoot,
      "config",
      "branches",
      ".sfdx-hardis.uat.yml",
    );
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(
      globalPath,
      "releaseVersioningMinimumVariables:\n  PI: 3\n",
      "utf8",
    );
    const helper = new SfdxHardisConfigHelper(workspaceRoot);
    await SfdxHardisConfigHelper.loadSchema();

    // What the panel sends for a branch: every value it shows, inherited ones included
    await helper.saveConfigFromEditor({
      config: {
        releaseVersioning: true,
        releaseVersioningMinimumVariables: { PI: 3 },
        releaseVersioningTagFormat: "v{MAJ}.{MIN}.{PATCH}-rc.{RC}",
      },
      isBranch: true,
      branchName: "uat",
    });
    const saved: any = yaml.load(fs.readFileSync(branchPath, "utf8"));
    assert.strictEqual(saved.releaseVersioning, true);
    assert.ok(!("releaseVersioningMinimumVariables" in saved));
    assert.ok(!("releaseVersioningTagFormat" in saved));

    // A value of its own is written
    await helper.saveConfigFromEditor({
      config: {
        releaseVersioning: true,
        releaseVersioningMinimumVariables: { PI: 3, IT: 2 },
      },
      isBranch: true,
      branchName: "uat",
    });
    const overridden: any = yaml.load(fs.readFileSync(branchPath, "utf8"));
    assert.deepStrictEqual(overridden.releaseVersioningMinimumVariables, {
      PI: 3,
      IT: 2,
    });
  });

  test("the stylesheet holds no hardcoded color", () => {
    assert.doesNotMatch(
      css,
      /#[0-9a-fA-F]{3,8}\b|rgba?\(|color:\s*(white|black)/,
    );
  });
});

/** Saves what Pipeline Settings sends to the project config file, and reads that file back */
async function saveProjectConfig(
  workspaceRoot: string,
  config: Record<string, any>,
): Promise<any> {
  await SfdxHardisConfigHelper.loadSchema();
  await new SfdxHardisConfigHelper(workspaceRoot).saveConfigFromEditor({
    config,
    isBranch: false,
    branchName: "",
  });
  return yaml.load(
    fs.readFileSync(path.join(workspaceRoot, ".sfdx-hardis.yml"), "utf8"),
  );
}
