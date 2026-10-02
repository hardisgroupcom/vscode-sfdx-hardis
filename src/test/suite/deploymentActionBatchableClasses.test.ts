import * as assert from "assert";
import {
  isBatchableApexClass,
  isSchedulableApexClass,
  mergeBatchableClasses,
  splitApexClassesByKind,
} from "../../utils/pipeline/deploymentActionPickers";
import {
  BATCHABLE_APEX_CLASS_REGEX,
  BUILT_IN_ACTION_TYPES,
  isBuiltInActionType,
} from "../../utils/prePostCommandsUtils";
import * as fs from "fs";
import * as path from "path";
import {
  LOCALES,
  REPO_ROOT,
  loadLocale,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * The Apex class list of a "run-batch" deployment action holds the classes
 * implementing Database.Batchable, read from the default org and from the
 * project sources like the schedulable classes of a "schedule-batch" action.
 *
 * Both lists come from the same org query, so these tests also verify that one
 * set of records is split into the two lists.
 */

const RUN_BATCH_I18N_KEYS = [
  "loadingBatchableClasses",
  "noBatchableClassFound",
  "runBatchBatchSizeHelp",
  "runBatchBatchSizeLabel",
  "runBatchClassNameHelp",
  "runBatchInvalidNumbers",
  "runBatchPreDeployClassWarning",
  "runBatchRunModeHelp",
  "runBatchRunModeLabel",
  "runBatchRunModeNoWait",
  "runBatchRunModeWait",
  "runBatchSuccessEvenIfBatchErrorsHelp",
  "runBatchSuccessEvenIfBatchErrorsLabel",
  "runBatchType",
  "runBatchWaitTimeoutHelp",
  "runBatchWaitTimeoutLabel",
];

suite("Deployment action batchable classes", () => {
  test("run-batch is a built-in action type", () => {
    assert.ok(BUILT_IN_ACTION_TYPES.includes("run-batch"));
    assert.strictEqual(isBuiltInActionType("run-batch"), true);
  });

  test("a class implementing Database.Batchable is batchable", () => {
    assert.strictEqual(
      isBatchableApexClass({
        Name: "CrewCapacityBatch",
        Body: "public class CrewCapacityBatch implements Database.Batchable<SObject> {",
      }),
      true,
    );
    // Apex is case-insensitive and tolerates spaces around the dot
    assert.strictEqual(
      isBatchableApexClass({
        Name: "CrewCapacityBatch",
        Body: "public class CrewCapacityBatch implements database . batchable<SObject> {",
      }),
      true,
    );
  });

  test("a class that only mentions a batch in its name is not batchable", () => {
    assert.strictEqual(
      isBatchableApexClass({
        Name: "BatchHelper",
        Body: "public class BatchHelper implements Schedulable {",
      }),
      false,
    );
    assert.strictEqual(isBatchableApexClass({ Name: "NoBody" }), false);
  });

  test("a managed class that is not global is never listed", () => {
    // Its body is hidden, and nothing outside its package can run it
    assert.strictEqual(
      isBatchableApexClass({
        Name: "InternalBatch",
        NamespacePrefix: "acme",
        ManageableState: "installed",
        Body: "(hidden)",
      }),
      false,
    );
  });

  test("the project sources and the org use the same test", () => {
    assert.ok(
      BATCHABLE_APEX_CLASS_REGEX.test(
        "global class NightlyBatch implements Database.Batchable<SObject>, Database.Stateful {",
      ),
    );
    assert.ok(!BATCHABLE_APEX_CLASS_REGEX.test("public class Batchable {"));
  });

  test("one org result fills the schedulable and the batchable lists", () => {
    const records = [
      {
        Name: "SyncBatch",
        Body: "global class SyncBatch implements Database.Batchable<SObject>, Schedulable {",
      },
      {
        Name: "ReminderScheduler",
        Body: "public class ReminderScheduler implements Schedulable {",
      },
      {
        Name: "CapacityBatch",
        NamespacePrefix: "acme",
        ManageableState: "installed",
        Body: "global class CapacityBatch implements Database.Batchable<SObject> {",
      },
      {
        Name: "HiddenBatch",
        NamespacePrefix: "acme",
        ManageableState: "installed",
        Body: "(hidden)",
      },
      { Name: "AccountService", Body: "public class AccountService {" },
    ];
    const split = splitApexClassesByKind(records);
    assert.deepStrictEqual(split.batchable, [
      "acme.CapacityBatch",
      "SyncBatch",
    ]);
    assert.deepStrictEqual(split.schedulable, [
      "ReminderScheduler",
      "SyncBatch",
    ]);
    // The schedulable filter keeps its behavior
    assert.strictEqual(isSchedulableApexClass(records[1]), true);
    assert.strictEqual(isSchedulableApexClass(records[2]), false);
  });

  test("the org is asked once for both lists", () => {
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
    assert.strictEqual(
      source.split("FROM ApexClass").length - 1,
      1,
      "the ApexClass query must be written once",
    );
    assert.match(
      source,
      /loadBatchableClasses: \{\s+responseType: "returnBatchableClasses"/,
    );
  });

  test("a class found only in the project is listed and reported", () => {
    const merged = mergeBatchableClasses(
      ["NightlyBatch"],
      ["CrewCapacityBatch", "NightlyBatch"],
    );
    assert.deepStrictEqual(merged.values, [
      "CrewCapacityBatch",
      "NightlyBatch",
    ]);
    assert.deepStrictEqual(merged.projectOnlyValues, ["CrewCapacityBatch"]);
  });

  test("no class is reported as project only when the org could not be read", () => {
    const merged = mergeBatchableClasses(null, ["CrewCapacityBatch"]);
    assert.deepStrictEqual(merged.values, ["CrewCapacityBatch"]);
    assert.deepStrictEqual(merged.projectOnlyValues, []);
  });

  test("the editor offers the type before and after the deployment, on real deployments only", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /"run-batch": \{[^}]*when: \["pre-deploy", "post-deploy"\],\s+context: \["process-deployment-only"\],/,
    );
    assert.match(js, /value: "run-batch"/);
    assert.match(js, /@api projectOnlyBatchableClasses/);
    assert.match(js, /new CustomEvent\("loadbatchableclasses"\)/);
  });

  test("the editor asks for the list each time it opens", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    const start = js.indexOf("_requestBatchableClassesIfNeeded(type) {");
    const body = js.slice(start, js.indexOf("_generateActionId() {"));
    assert.ok(start > 0 && body.length > 0);
    assert.doesNotMatch(body, /batchableClasses\.length/);
  });

  test("both panels hosting the editor pass it the batchable classes", () => {
    for (const panel of ["pipeline", "pipelineConfig"]) {
      const html = readModuleFile(panel, `${panel}.html`);
      for (const attribute of [
        "batchable-classes={projectBatchableClasses}",
        "project-only-batchable-classes={projectOnlyBatchableClasses}",
        "batchable-classes-loading={batchableClassesLoading}",
        "onloadbatchableclasses={handleLoadBatchableClasses}",
      ]) {
        assert.ok(
          html.includes(attribute),
          `${panel} must pass ${attribute} to the editor`,
        );
      }
      const js = readModuleFile(panel, `${panel}.js`);
      assert.match(js, /type: "loadBatchableClasses"/);
      assert.match(js, /handleReturnBatchableClasses\(data\)/);
    }
  });

  test("the type has a label, an icon and a pill color", () => {
    const utils = readModuleFile(
      "deploymentActionUtils",
      "deploymentActionUtils.js",
    );
    assert.strictEqual(utils.split('"run-batch":').length - 1, 3);
  });

  test("every label of the editor exists in every locale", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    const html = readModuleFile("deploymentAction", "deploymentAction.html");
    for (const key of RUN_BATCH_I18N_KEYS) {
      assert.ok(
        js.includes(`"${key}"`) || html.includes(`i18n.${key}}`),
        `${key} is not used by the editor`,
      );
      for (const locale of LOCALES) {
        assert.ok(loadLocale(locale)[key], `${key} is missing in ${locale}`);
      }
    }
  });
});
