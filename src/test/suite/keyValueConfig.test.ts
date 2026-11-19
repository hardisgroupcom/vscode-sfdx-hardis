import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import { assertKeysTranslated, readModuleFile } from "./lwcSourceUtils";
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
    const pipelineHtml = readModuleFile("pipelineConfig", "pipelineConfig.html");
    assert.match(
      pipelineJs,
      /const isKeyValueObject =\s*isObject &&\s*!schema\.properties &&\s*!!schema\.additionalProperties/,
      "an object schema with only additionalProperties is a key/value setting",
    );
    const editors = pipelineHtml.match(/<s-key-value-config/g) || [];
    assert.strictEqual(editors.length, 2, "one editable and one read-only editor");
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
    assert.ok(field, "releaseVersioningMinimumVariables must be a configurable field");
    assert.deepStrictEqual(field!.scopes, ["global", "branch"]);
  });

  test("every i18n key of the editor exists in the 9 locales", () => {
    const usedKeys = new Set<string>();
    for (const match of js.matchAll(/this\.i18n\.(\w+)/g)) {
      usedKeys.add(match[1]);
    }
    for (const match of html.matchAll(/\{i18n\.(\w+)\}/g)) {
      usedKeys.add(match[1]);
    }
    assert.ok(usedKeys.size >= 4, "the editor must be translated");
    assertKeysTranslated(usedKeys);
  });

  test("saving writes the map, and an empty map removes it", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "sfdx-hardis-key-value-"),
    );
    const configPath = path.join(workspaceRoot, ".sfdx-hardis.yml");
    fs.writeFileSync(configPath, "developmentBranch: integration\n", "utf8");
    const helper = new SfdxHardisConfigHelper(workspaceRoot);
    await SfdxHardisConfigHelper.loadSchema();

    await helper.saveConfigFromEditor({
      config: { releaseVersioningMinimumVariables: { PI: 3, IT: "05" } },
      isBranch: false,
      branchName: "",
    });
    const saved: any = yaml.load(fs.readFileSync(configPath, "utf8"));
    assert.deepStrictEqual(saved.releaseVersioningMinimumVariables, {
      PI: 3,
      IT: "05",
    });
    assert.strictEqual(saved.developmentBranch, "integration");

    await helper.saveConfigFromEditor({
      config: { releaseVersioningMinimumVariables: null },
      isBranch: false,
      branchName: "",
    });
    const reset: any = yaml.load(fs.readFileSync(configPath, "utf8"));
    assert.ok(!("releaseVersioningMinimumVariables" in reset));
  });

  test("the stylesheet holds no hardcoded color", () => {
    assert.doesNotMatch(
      css,
      /#[0-9a-fA-F]{3,8}\b|rgba?\(|color:\s*(white|black)/,
    );
  });
});
