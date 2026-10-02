import * as assert from "assert";
import {
  isSchedulableApexClass,
  mergeSchedulableClasses,
  schedulableApexClassName,
} from "../../utils/pipeline/deploymentActionPickers";
import { LOCALES, loadLocale, readModuleFile } from "./lwcSourceUtils";

/**
 * The Apex class list of a "schedule-batch" deployment action is read from the
 * default org and from the project sources.
 *
 * A class merged in git reaches the integration org through the pipeline and
 * never the developer's own org, so a list read from the org alone left it
 * impossible to pick. These tests verify that such a class is listed, that it
 * is reported as found in the project only, and that the editor says so.
 */

suite("Deployment action schedulable classes", () => {
  test("a class found only in the project is listed and reported", () => {
    const merged = mergeSchedulableClasses(
      ["NightlyCleanup"],
      ["CrewCapacityBatch", "NightlyCleanup"],
    );
    assert.deepStrictEqual(merged.values, [
      "CrewCapacityBatch",
      "NightlyCleanup",
    ]);
    assert.deepStrictEqual(merged.projectOnlyValues, ["CrewCapacityBatch"]);
  });

  test("a class of the org is never reported as project only", () => {
    // Apex class names are case-insensitive: the file and the org can differ
    const merged = mergeSchedulableClasses(
      ["nightly_cleanup"],
      ["Nightly_Cleanup"],
    );
    assert.deepStrictEqual(merged.values, ["nightly_cleanup"]);
    assert.deepStrictEqual(merged.projectOnlyValues, []);
  });

  test("the project classes are listed when the org returns nothing", () => {
    const merged = mergeSchedulableClasses([], ["CrewCapacityBatch"]);
    assert.deepStrictEqual(merged.values, ["CrewCapacityBatch"]);
    assert.deepStrictEqual(merged.projectOnlyValues, ["CrewCapacityBatch"]);
  });

  test("no class is reported as project only when the org could not be read", () => {
    // Saying "not in the default org yet" about an org nobody could read would be a guess
    const merged = mergeSchedulableClasses(null, ["CrewCapacityBatch"]);
    assert.deepStrictEqual(merged.values, ["CrewCapacityBatch"]);
    assert.deepStrictEqual(merged.projectOnlyValues, []);
  });

  test("the editor asks for the list each time it opens", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    const start = js.indexOf("_requestSchedulableClassesIfNeeded(type) {");
    const body = js.slice(
      start,
      js.indexOf("_requestCommunitiesIfNeeded(type) {"),
    );
    // A list kept by the panel from an earlier opening must not stop the request
    assert.doesNotMatch(body, /schedulableClasses\.length/);
  });

  test("a global schedulable class of a managed package is listed with its namespace", () => {
    const record = {
      Name: "NightlyScheduler",
      NamespacePrefix: "acme",
      ManageableState: "installed",
      Body: "global class NightlyScheduler implements System.Schedulable {",
    };
    assert.strictEqual(isSchedulableApexClass(record), true);
    assert.strictEqual(
      schedulableApexClassName(record),
      "acme.NightlyScheduler",
    );
  });

  test("a managed class that is not global is never listed", () => {
    // Its body is hidden, and nothing outside its package can schedule it
    assert.strictEqual(
      isSchedulableApexClass({
        Name: "InternalScheduler",
        NamespacePrefix: "acme",
        ManageableState: "installed",
        Body: "(hidden)",
      }),
      false,
    );
  });

  test("a class of the org keeps its bare name, even in a namespaced org", () => {
    assert.strictEqual(
      schedulableApexClassName({
        Name: "NightlyScheduler",
        NamespacePrefix: "acme",
        ManageableState: "unmanaged",
      }),
      "NightlyScheduler",
    );
    assert.strictEqual(
      schedulableApexClassName({ Name: "NightlyScheduler" }),
      "NightlyScheduler",
    );
  });

  test("the editor labels the classes found only in the project", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(js, /@api projectOnlySchedulableClasses/);
    assert.match(js, /this\.t\("inProjectNotInOrg", \{ value: className \}\)/);
  });

  test("both panels hosting the editor pass it the project only classes", () => {
    for (const panel of ["pipeline", "pipelineConfig"]) {
      assert.match(
        readModuleFile(panel, `${panel}.html`),
        /project-only-schedulable-classes=\{projectOnlySchedulableClasses\}/,
        `${panel} must pass the project only classes to the editor`,
      );
      assert.match(
        readModuleFile(panel, `${panel}.js`),
        /projectOnlySchedulableClasses = Array\.isArray\(data\?\.projectOnlyValues\)/,
        `${panel} must read the project only classes from the response`,
      );
    }
  });

  test("the label exists in every locale and keeps its placeholder", () => {
    for (const locale of LOCALES) {
      const label = loadLocale(locale).inProjectNotInOrg;
      assert.ok(label, `inProjectNotInOrg is missing in ${locale}`);
      assert.ok(
        label.includes("{{value}}"),
        `inProjectNotInOrg must keep {{value}} in ${locale}`,
      );
    }
  });
});
