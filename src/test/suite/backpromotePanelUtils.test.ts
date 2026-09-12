import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  REPO_ROOT,
  assertKeysTranslated,
  readModuleFile,
} from "./lwcSourceUtils";
import { tokenizeCommand } from "../../utils/sfCoreCommands";
import {
  BackpromotePlan,
  BackpromoteSelection,
  buildBackpromoteCommand,
  buildDefaultSelection,
  buildOrgChoices,
  buildPlanCommand,
  buildPlanProgress,
  buildSelectionPayload,
  computeSelectionSummary,
  getBackpromoteErrorMessage,
  getTargetOrgDisplayName,
  isAllowedBackpromoteCommand,
  isCliTooOldForBackpromotePanel,
  isSafeCommandValue,
  normalizeBackpromotePlan,
  normalizeSelection,
  parseMetadataKey,
  parseProgressEvents,
  quoteCommandValue,
  recoverJsonCommandResult,
} from "../../utils/backpromote/backpromotePanelUtils";

const USERNAME = "sam.dubois@mycompany.com.dev-sam";
const INVOICE_CALCULATOR_FILE = "force-app/main/default/classes/InvoiceCalculator.cls";
const QUOTE_APPROVAL_FILE = "force-app/main/default/flows/Quote_Approval.flow-meta.xml";

function loadPlan(): BackpromotePlan {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "test", "fixtures", "backpromote", "backpromote-plan.json"),
      "utf8",
    ),
  );
  const plan = normalizeBackpromotePlan(raw);
  assert.ok(plan, "the fixture must be a valid plan");
  return plan!;
}

function selection(
  plan: BackpromotePlan,
  overrides: Partial<BackpromoteSelection> = {},
): BackpromoteSelection {
  return { ...buildDefaultSelection(plan), ...overrides };
}

suite("backpromotePanelUtils", () => {
  test("parseMetadataKey splits on the first colon only", () => {
    assert.deepStrictEqual(parseMetadataKey("Layout:Opportunity-Sales Layout"), {
      type: "Layout",
      name: "Opportunity-Sales Layout",
    });
    assert.deepStrictEqual(parseMetadataKey("CustomLabel:A:B"), {
      type: "CustomLabel",
      name: "A:B",
    });
    assert.strictEqual(parseMetadataKey("Layout"), null);
    assert.strictEqual(parseMetadataKey(":x"), null);
  });

  test("quoteCommandValue quotes spaces and refuses shell syntax", () => {
    assert.strictEqual(quoteCommandValue("integration"), "integration");
    assert.strictEqual(
      quoteCommandValue("Layout:Opportunity-Sales Layout"),
      '"Layout:Opportunity-Sales Layout"',
    );
    // A lone dollar sign is part of the unfiled$public folder names: single quoted, never refused
    assert.strictEqual(quoteCommandValue("Report:unfiled$public/Pipeline"), "'Report:unfiled$public/Pipeline'");
    for (const unsafe of ['a"b', "a'b", "a$(b)", "a${b}", "a`b", "a\\b", "a && b", "a || b", "a\nb", ""]) {
      assert.throws(() => quoteCommandValue(unsafe), `${JSON.stringify(unsafe)} must be refused`);
    }
    assert.strictEqual(isSafeCommandValue("user$(whoami)@example.com"), false);
  });

  test("only sf hardis:work:backpromote commands without chaining are allowed", () => {
    assert.ok(isAllowedBackpromoteCommand("sf hardis:work:backpromote"));
    assert.ok(isAllowedBackpromoteCommand("sf hardis:work:backpromote --parentbranch integration --auto"));
    assert.strictEqual(isAllowedBackpromoteCommand("sf hardis:work:backpromote && rm -rf /"), false);
    assert.strictEqual(isAllowedBackpromoteCommand("sf hardis:work:save"), false);
    assert.strictEqual(isAllowedBackpromoteCommand(42), false);
  });

  test("normalizeBackpromotePlan reads the fixture and refuses the plan of an older sfdx-hardis", () => {
    const plan = loadPlan();
    assert.strictEqual(plan.status, "ready");
    assert.strictEqual(plan.pullRequests.length, 3);
    assert.strictEqual(plan.items.length, 6);
    assert.strictEqual(plan.conflicts.length, 2);
    assert.strictEqual(plan.targetOrg.tracksSource, true);
    assert.strictEqual(plan.orgChanges.files.length, 2);
    assert.strictEqual(normalizeBackpromotePlan({ planVersion: 1, status: "ready" }), null);
    assert.strictEqual(normalizeBackpromotePlan({ planVersion: 2, status: "weird" }), null);
    // A partial plan never crashes the panel
    const partial = normalizeBackpromotePlan({ planVersion: 2, status: "blocked" });
    assert.deepStrictEqual(partial?.items, []);
    assert.deepStrictEqual(partial?.conflicts, []);
    assert.deepStrictEqual(partial?.orgChanges, { tracked: false, files: [] });
  });

  test("the default selection deploys everything, runs every action and merges every conflicting file by hand", () => {
    const plan = loadPlan();
    const defaults = buildDefaultSelection(plan);
    assert.deepStrictEqual(defaults.excludedItems, []);
    assert.deepStrictEqual(defaults.excludedDeletions, []);
    assert.deepStrictEqual(defaults.actions, [
      "load-approval-matrix",
      "assign-sales-manager",
      "recalculate-quote-sharing",
    ]);
    assert.deepStrictEqual(defaults.conflictDecisions, {
      [INVOICE_CALCULATOR_FILE]: "merge",
      [QUOTE_APPROVAL_FILE]: "merge",
    });
  });

  test("the summary counts what the selection deploys, deletes and runs", () => {
    const plan = loadPlan();
    const summary = computeSelectionSummary(plan, buildDefaultSelection(plan));
    assert.strictEqual(summary.itemsToDeployCount, 6);
    assert.strictEqual(summary.deletionsToDeleteCount, 1);
    assert.strictEqual(summary.actionsToRunCount, 3);
    assert.strictEqual(summary.manualActionsCount, 2);
    assert.strictEqual(summary.conflicts.length, 2);
    assert.strictEqual(summary.conflicts[0].choice, "merge");
    assert.deepStrictEqual(summary.blockers, []);
    assert.strictEqual(summary.canRun, true);

    const emptied = computeSelectionSummary(
      plan,
      selection(plan, {
        excludedItems: plan.items.map((item) => item.key),
        excludedDeletions: plan.deletions.map((deletion) => deletion.key),
        actions: [],
      }),
    );
    assert.deepStrictEqual(emptied.blockers, ["nothingToDo"]);

    plan.status = "blocked";
    assert.deepStrictEqual(computeSelectionSummary(plan, buildDefaultSelection(plan)).blockers, ["notReady"]);
  });

  test("a merge in progress can only continue once its markers are gone", () => {
    const plan = loadPlan();
    plan.status = "mergeInProgress";
    plan.conflicts[0].conflictBlocks = 2;
    plan.conflicts[1].conflictBlocks = 0;
    const blocked = computeSelectionSummary(plan, buildDefaultSelection(plan));
    assert.deepStrictEqual(blocked.blockers, ["conflictMarkers"]);
    assert.deepStrictEqual(blocked.markersLeft, [{ path: INVOICE_CALCULATOR_FILE, conflictBlocks: 2 }]);
    plan.conflicts[0].conflictBlocks = 0;
    assert.strictEqual(computeSelectionSummary(plan, buildDefaultSelection(plan)).canRun, true);
  });

  test("buildBackpromoteCommand for the default selection", () => {
    const plan = loadPlan();
    assert.strictEqual(
      buildBackpromoteCommand(plan, buildDefaultSelection(plan)),
      `sf hardis:work:backpromote --parentbranch integration --auto --on-conflict ${INVOICE_CALCULATOR_FILE}=merge --on-conflict ${QUOTE_APPROVAL_FILE}=merge --actions load-approval-matrix,assign-sales-manager,recalculate-quote-sharing --target-org ${USERNAME}`,
    );
  });

  test("buildBackpromoteCommand with kept, overwritten, unticked items and no action", () => {
    const plan = loadPlan();
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, {
        excludedItems: ["Layout:Opportunity-Sales Layout"],
        excludedDeletions: ["CustomField:Opportunity.Legacy_Score__c"],
        actions: [],
        conflictDecisions: {
          [INVOICE_CALCULATOR_FILE]: "overwrite",
          [QUOTE_APPROVAL_FILE]: "keep",
        },
      }),
    );
    assert.strictEqual(
      command,
      `sf hardis:work:backpromote --parentbranch integration --auto --exclude-metadata "Layout:Opportunity-Sales Layout" --skip-destructive --on-conflict ${INVOICE_CALCULATOR_FILE}=overwrite --on-conflict ${QUOTE_APPROVAL_FILE}=keep --skip-actions --target-org ${USERNAME}`,
    );
    // The command runner splits it back into the same arguments
    const tokens = tokenizeCommand(command);
    assert.ok(tokens.includes("Layout:Opportunity-Sales Layout"));
    assert.ok(isAllowedBackpromoteCommand(command));
  });

  test("one --exclude-metadata per unticked deletion when some deletions stay", () => {
    const plan = loadPlan();
    plan.deletions.push({ key: "ApexClass:LegacyScoreService", type: "ApexClass", name: "LegacyScoreService" });
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, { excludedDeletions: ["CustomField:Opportunity.Legacy_Score__c"] }),
    );
    assert.ok(command.includes("--exclude-metadata CustomField:Opportunity.Legacy_Score__c"), command);
    assert.ok(!command.includes("--skip-destructive"), command);
  });

  test("an unsafe value of the plan blocks the run instead of reaching the command", () => {
    const plan = loadPlan();
    plan.targetOrg.username = "user$(whoami)@example.com";
    const payload = buildSelectionPayload(plan, buildDefaultSelection(plan));
    assert.strictEqual(payload.command, null);
    assert.ok(payload.commandError);
    assert.ok(payload.summary.blockers.includes("invalidCommand"));
    assert.strictEqual(payload.summary.canRun, false);
  });

  test("normalizeSelection keeps only what the plan knows", () => {
    const plan = loadPlan();
    const normalized = normalizeSelection(plan, {
      excludedItems: ["Layout:Opportunity-Sales Layout", "Unknown:Item", "Layout:Opportunity-Sales Layout"],
      excludedDeletions: ["Nope:x"],
      actions: ["assign-sales-manager", 42, "not-an-action"],
      conflictDecisions: {
        [INVOICE_CALCULATOR_FILE]: "keep",
        [QUOTE_APPROVAL_FILE]: "delete everything",
        "not/in/the/plan.cls": "overwrite",
      },
    });
    assert.deepStrictEqual(normalized.excludedItems, ["Layout:Opportunity-Sales Layout"]);
    assert.deepStrictEqual(normalized.excludedDeletions, []);
    assert.deepStrictEqual(normalized.actions, ["assign-sales-manager"]);
    assert.deepStrictEqual(normalized.conflictDecisions, {
      [INVOICE_CALCULATOR_FILE]: "keep",
      [QUOTE_APPROVAL_FILE]: "merge",
    });
  });

  test("buildPlanCommand", () => {
    assert.strictEqual(buildPlanCommand(), "sf hardis:work:backpromote --plan --json");
    assert.strictEqual(
      buildPlanCommand("feature/uat-2"),
      "sf hardis:work:backpromote --plan --parentbranch feature/uat-2 --json",
    );
    assert.strictEqual(
      buildPlanCommand("main;rm -rf"),
      'sf hardis:work:backpromote --plan --parentbranch "main;rm -rf" --json',
    );
    assert.throws(() => buildPlanCommand("main$(id)"));
    assert.strictEqual(
      buildPlanCommand("integration", { targetOrg: USERNAME }),
      `sf hardis:work:backpromote --plan --parentbranch integration --target-org ${USERNAME} --json`,
    );
  });

  test("buildOrgChoices offers the live developer orgs, the default one first", () => {
    const choices = buildOrgChoices([
      { username: "dev2@x.com.dev2", alias: "dev2", isSandbox: true },
      { username: "admin@x.com", orgType: "production" },
      { username: "scratch@x.com", isScratch: true, status: "Expired" },
      { username: "me@x.com.dev", alias: "dev", isSandbox: true, isDefaultUsername: true },
      { username: "user$(x)@x.com.dev", isSandbox: true },
    ]);
    assert.deepStrictEqual(choices, [
      { username: "me@x.com.dev", label: "dev (me@x.com.dev)", isDefault: true },
      { username: "dev2@x.com.dev2", label: "dev2 (dev2@x.com.dev2)", isDefault: false },
    ]);
  });

  test("an unknown flag error or a plan of the previous version means the installed sfdx-hardis is too old", () => {
    assert.ok(
      isCliTooOldForBackpromotePanel({
        status: 2,
        stdout: JSON.stringify({ code: "NonexistentFlagsError", message: "Nonexistent flag: --plan" }),
      }),
    );
    assert.ok(isCliTooOldForBackpromotePanel({ status: 0, result: { planVersion: 1, status: "ready" } }));
    assert.strictEqual(isCliTooOldForBackpromotePanel({ status: 1, message: "No default org" }), false);
  });

  test("getBackpromoteErrorMessage reads the message wherever the CLI put it", () => {
    assert.strictEqual(getBackpromoteErrorMessage({ message: "[31mNo org[0m" }), "No org");
    assert.strictEqual(
      getBackpromoteErrorMessage({ stdout: JSON.stringify({ message: "Nonexistent flag" }) }),
      "Nonexistent flag",
    );
    assert.strictEqual(getBackpromoteErrorMessage({ stderr: "line1\nline2" }), "line1\nline2");
    assert.strictEqual(getBackpromoteErrorMessage(null), "");
  });

  test("getTargetOrgDisplayName prefers the short name of the org", () => {
    assert.strictEqual(getTargetOrgDisplayName({ orgName: "mycompany--dev-sam", username: USERNAME }), "mycompany--dev-sam");
    assert.strictEqual(
      getTargetOrgDisplayName({ instanceUrl: "https://mycompany--dev-sam.sandbox.my.salesforce.com", username: USERNAME }),
      "mycompany--dev-sam",
    );
    assert.strictEqual(getTargetOrgDisplayName({ instanceUrl: "https://test.salesforce.com", username: USERNAME }), USERNAME);
    assert.strictEqual(getTargetOrgDisplayName(null), "");
  });

  test("recoverJsonCommandResult reads a JSON document printed after a log line", () => {
    const recovered = recoverJsonCommandResult({
      status: 1,
      unableToParseJson: true,
      stdout: 'WS Client started\n{\n  "status": 0,\n  "result": { "planVersion": 2 }\n}',
    });
    assert.strictEqual(recovered.status, 0);
    assert.strictEqual(recovered.result.planVersion, 2);
    assert.strictEqual(recovered.unableToParseJson, false);
    const unreadable = { status: 1, stdout: "WS Client started\nnot json", unableToParseJson: true };
    assert.strictEqual(recoverJsonCommandResult(unreadable), unreadable);
  });

  test("the plan progress keeps the last step and the ones done before it", () => {
    const events = parseProgressEvents(
      [
        '{"step":"targetOrg","message":"Reading the target org"}',
        '{"step":"fetch","message":"Fetching integration"}',
        '{"step":"delta","message":"Computing what the merge brings in","current":1,"total":4}',
        '{"step":"delta","message":"Computing what',
      ].join("\n"),
    );
    assert.strictEqual(events.length, 3);
    const progress = buildPlanProgress(events);
    assert.strictEqual(progress?.message, "Computing what the merge brings in");
    assert.strictEqual(progress?.percent, 25);
    assert.deepStrictEqual(
      progress?.doneSteps.map((step) => step.key),
      ["targetOrg", "fetch"],
    );
    assert.strictEqual(buildPlanProgress([]), null);
  });

  test("every label of the panel is translated in the 9 locales", () => {
    const sources = [
      readModuleFile("backpromote", "backpromote.html"),
      readModuleFile("backpromote", "backpromote.js"),
      fs.readFileSync(path.join(REPO_ROOT, "src", "commands", "showBackpromote.ts"), "utf8"),
    ].join("\n");
    const keys = new Set<string>();
    for (const [, key] of sources.matchAll(/i18n\.([A-Za-z0-9_]+)/g)) {
      keys.add(key);
    }
    for (const [, key] of sources.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) {
      keys.add(key);
    }
    // Keys chosen at runtime (count labels, check titles...)
    for (const [, key] of sources.matchAll(/"(backpromote[A-Za-z0-9_]+)"/g)) {
      keys.add(key);
    }
    assert.ok(keys.size > 50, `only ${keys.size} keys found`);
    assertKeysTranslated(keys);
  });
});
