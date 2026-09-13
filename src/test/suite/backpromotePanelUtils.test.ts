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
  buildConfirmActionCommand,
  buildDefaultSelection,
  buildOrgChoices,
  buildPlanCommand,
  buildPlanProgress,
  buildPrepareCommand,
  buildResetCommand,
  buildSelectionPayload,
  comparisonsByItem,
  computeItemState,
  computeSelectionSummary,
  countConflictMarkerBlocks,
  differingComparisons,
  extractPlanDocument,
  getBackpromoteErrorMessage,
  getTargetOrgDisplayName,
  hasGitProviderToken,
  isAllowedBackpromoteCommand,
  isCliTooOldForBackpromotePanel,
  isGitProviderMissing,
  isSafeCommandValue,
  defaultParentBranchFor,
  listAllowedParentBranches,
  normalizeBackpromotePlan,
  normalizeSelection,
  parseMetadataKey,
  parseProgressEvents,
  quoteCommandValue,
  recoverJsonCommandResult,
} from "../../utils/backpromote/backpromotePanelUtils";
import {
  isBackpromoteBranchName,
  parseBackpromoteBranchName,
} from "../../utils/pipeline/promotionBranchUtils";

const USERNAME = "sam.dubois@mycompany.com.dev1";
const INVOICE_CALCULATOR_FILE = "force-app/main/default/classes/InvoiceCalculator.cls";
const CASE_LAYOUT_FILE = "force-app/main/default/layouts/Case-Case Layout.layout-meta.xml";
const TARGET = { targetOrg: USERNAME, parentBranch: "integration", fromPullRequest: 415, runId: "mock7f3a" };

function loadRawPlan(): any {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "test", "fixtures", "backpromote", "backpromote-plan.json"),
      "utf8",
    ),
  );
}

function loadPlan(): BackpromotePlan {
  const plan = normalizeBackpromotePlan(loadRawPlan());
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

  test("quoteCommandValue quotes spaces and refuses shell syntax, by platform", () => {
    for (const platform of ["win32", "linux", "darwin"]) {
      assert.strictEqual(quoteCommandValue("integration", platform), "integration");
      assert.strictEqual(
        quoteCommandValue("Layout:Opportunity-Sales Layout", platform),
        '"Layout:Opportunity-Sales Layout"',
        platform,
      );
      for (const unsafe of ['a"b', "a$(b)", "a${b}", "a`b", "a\\b", "a && b", "a || b", "a\nb", "a\tb", ""]) {
        assert.throws(() => quoteCommandValue(unsafe, platform), `${JSON.stringify(unsafe)} must be refused on ${platform}`);
      }
      assert.strictEqual(isSafeCommandValue("user$(whoami)@example.com", platform), false);
      // A single quote is a plain character for cmd.exe and inside double quotes for /bin/sh
      assert.strictEqual(quoteCommandValue("Layout:Sam's Layout", platform), "\"Layout:Sam's Layout\"", platform);
    }
    // A lone dollar sign is part of the unfiled$public folder names. cmd.exe (the shell of
    // child_process.exec on Windows) never expands it and takes single quotes literally:
    // double quotes there, single quotes for /bin/sh which expands $ inside double quotes
    assert.strictEqual(quoteCommandValue("Report:unfiled$public/Pipeline", "win32"), '"Report:unfiled$public/Pipeline"');
    assert.strictEqual(quoteCommandValue("Report:unfiled$public/Pipeline", "linux"), "'Report:unfiled$public/Pipeline'");
    assert.strictEqual(quoteCommandValue("Report:unfiled$public/Pipeline", "darwin"), "'Report:unfiled$public/Pipeline'");
    // A dollar sign next to a single quote cannot be protected by /bin/sh: refused there only
    assert.strictEqual(quoteCommandValue("Report:unfiled$public/Sam's", "win32"), "\"Report:unfiled$public/Sam's\"");
    assert.throws(() => quoteCommandValue("Report:unfiled$public/Sam's", "linux"));
    assert.strictEqual(isSafeCommandValue("Report:unfiled$public/Sam's", "linux"), false);
    assert.strictEqual(isSafeCommandValue("Report:unfiled$public/Sam's", "win32"), true);
    // The default platform is the one of the extension host
    assert.strictEqual(quoteCommandValue("a b"), '"a b"');
  });

  test("the comparison entries of a plan are grouped by item once", () => {
    const plan = loadPlan();
    const byItem = comparisonsByItem(plan);
    assert.strictEqual(byItem, comparisonsByItem(plan), "the same map for the same plan");
    assert.deepStrictEqual(
      byItem.get("ApexClass:InvoiceCalculator")?.map((comparison) => comparison.file),
      [INVOICE_CALCULATOR_FILE, `${INVOICE_CALCULATOR_FILE}-meta.xml`],
    );
    assert.strictEqual(byItem.get("Profile:Admin"), undefined);
    assert.deepStrictEqual(differingComparisons(plan, "ApexClass:InvoiceCalculator").map((comparison) => comparison.file), [INVOICE_CALCULATOR_FILE]);
    assert.deepStrictEqual(differingComparisons(plan, "Profile:Admin"), []);
    // Another plan object (a new answer of sfdx-hardis) gets its own map
    assert.notStrictEqual(comparisonsByItem(loadPlan()), byItem);
  });

  test("only sf hardis:work:backpromote commands without chaining are allowed", () => {
    assert.ok(isAllowedBackpromoteCommand("sf hardis:work:backpromote"));
    assert.ok(isAllowedBackpromoteCommand("sf hardis:work:backpromote --auto --parent-branch integration"));
    assert.strictEqual(isAllowedBackpromoteCommand("sf hardis:work:backpromote && rm -rf /"), false);
    assert.strictEqual(isAllowedBackpromoteCommand("sf hardis:work:save"), false);
    assert.strictEqual(isAllowedBackpromoteCommand(42), false);
  });

  test("countConflictMarkerBlocks counts every marker line, so a half removed block still counts", () => {
    assert.strictEqual(countConflictMarkerBlocks("a\nb\n"), 0);
    assert.strictEqual(countConflictMarkerBlocks("<<<<<<< sandbox\na\n=======\nb\n>>>>>>> integration\n"), 1);
    assert.strictEqual(countConflictMarkerBlocks("a\n=======\nb\n>>>>>>> integration\n"), 1);
    assert.strictEqual(countConflictMarkerBlocks("<<<<<<< a\n1\n||||||| base\n0\n=======\n2\n>>>>>>> b\n<<<<<<< a\n=======\n>>>>>>> b\n"), 2);
  });

  test("hasGitProviderToken finds any of the provider token variables", () => {
    assert.strictEqual(hasGitProviderToken({}), false);
    assert.strictEqual(hasGitProviderToken({ GITHUB_TOKEN: "" }), false);
    assert.strictEqual(hasGitProviderToken({ GITHUB_TOKEN: "ghp_x" }), true);
    assert.strictEqual(hasGitProviderToken({ CI_SFDX_HARDIS_GITLAB_TOKEN: "glpat" }), true);
    assert.strictEqual(hasGitProviderToken({ SYSTEM_ACCESSTOKEN: "pat" }), true);
    assert.strictEqual(hasGitProviderToken({ CI_SFDX_HARDIS_BITBUCKET_TOKEN: "bb" }), true);
  });

  test("normalizeBackpromotePlan reads the fixture and refuses the plan of another version", () => {
    const plan = loadPlan();
    assert.strictEqual(plan.status, "ok");
    assert.strictEqual(plan.runId, "mock7f3a");
    assert.strictEqual(plan.pullRequests.length, 5);
    assert.strictEqual(plan.items.length, 6);
    assert.strictEqual(plan.comparison.length, 6);
    assert.strictEqual(plan.window?.startPullRequest, 415);
    assert.strictEqual(plan.targetOrg.sandboxName, "dev1");
    assert.strictEqual(plan.gitRoot, "/tmp/mock-workspace");
    assert.strictEqual(plan.pullRequests[3].backpromote?.user, "Sam Dubois");
    // #409 is older than #412, the newest Pull Request backpromoted to dev1: counted as backpromoted
    assert.deepStrictEqual(
      plan.pullRequests.map((pr) => [pr.number, pr.beforeLastBackpromote]),
      [[418, false], [417, false], [415, false], [412, false], [409, true]],
    );
    assert.strictEqual(normalizeBackpromotePlan({ planVersion: 2, status: "ready" }), null);
    assert.strictEqual(normalizeBackpromotePlan({ version: 3, status: "weird" }), null);
    // A partial plan never crashes the panel
    const partial = normalizeBackpromotePlan({ version: 3, status: "blocked" });
    assert.deepStrictEqual(partial?.items, []);
    assert.deepStrictEqual(partial?.comparison, []);
    assert.strictEqual(partial?.window, null);
    assert.strictEqual(partial?.checkout.clean, true);
    assert.strictEqual(partial?.gitRoot, "");
  });

  test("extractPlanDocument reads the plan of a success and the plan attached to an error", () => {
    const raw = loadRawPlan();
    assert.strictEqual(extractPlanDocument({ status: 0, result: raw })?.runId, "mock7f3a");
    const refused = { ...raw, status: "conflictsRemaining" };
    const fromError = extractPlanDocument({ status: 1, message: "markers left", data: refused });
    assert.strictEqual(fromError?.status, "conflictsRemaining");
    assert.strictEqual(extractPlanDocument({ status: 1, message: "boom" }), null);
    assert.strictEqual(extractPlanDocument({ status: 1, data: { plan: raw } }), null);
    const blocked = normalizeBackpromotePlan({ version: 3, status: "blocked", checks: [{ id: "gitProvider", ok: false, message: "no token" }] });
    assert.strictEqual(isGitProviderMissing(blocked), true);
    assert.strictEqual(isGitProviderMissing(loadPlan()), false);
  });

  test("the default selection deploys everything but the no-overwrite items, and overwrites differing files", () => {
    const plan = loadPlan();
    const defaults = buildDefaultSelection(plan);
    assert.deepStrictEqual(defaults.excludedItems, ["Profile:Admin"]);
    assert.deepStrictEqual(defaults.excludedDeletions, []);
    // The action already run in this sandbox is not offered
    assert.deepStrictEqual(defaults.actions, ["load-sla-thresholds", "enable-sla-approval"]);
    assert.deepStrictEqual(defaults.diffDecisions, {
      "ApexClass:InvoiceCalculator": "git",
      "Layout:Case-Case Layout": "git",
    });
  });

  test("normalizeSelection keeps only what the plan knows, and never re-ticks a no-overwrite item", () => {
    const plan = loadPlan();
    const normalized = normalizeSelection(plan, {
      excludedItems: ["Flow:Quote_Approval", "Flow:Unknown"],
      excludedDeletions: ["ApexClass:LegacyDiscountHelper", "ApexClass:Nope"],
      actions: ["enable-sla-approval", "recalculate-quote-sharing", "evil"],
      diffDecisions: { "ApexClass:InvoiceCalculator": "merge", "Flow:Quote_Approval": "org", "Layout:Case-Case Layout": "deploy" },
    });
    assert.deepStrictEqual(normalized.excludedItems, ["Flow:Quote_Approval", "Profile:Admin"]);
    assert.deepStrictEqual(normalized.excludedDeletions, ["ApexClass:LegacyDiscountHelper"]);
    assert.deepStrictEqual(normalized.actions, ["enable-sla-approval"]);
    assert.deepStrictEqual(normalized.diffDecisions, {
      "ApexClass:InvoiceCalculator": "merge",
      "Layout:Case-Case Layout": "git",
    });
  });

  test("computeItemState reads the worst state of the item files and the markers of a prepared merge", () => {
    const plan = loadPlan();
    const invoice = computeItemState(plan, selection(plan), "ApexClass:InvoiceCalculator");
    assert.strictEqual(invoice.status, "different");
    assert.strictEqual(invoice.differs, true);
    assert.strictEqual(invoice.decision, "git");
    assert.strictEqual(invoice.threeWay, true);
    const layout = computeItemState(plan, selection(plan), "Layout:Case-Case Layout");
    assert.strictEqual(layout.status, "pendingInOrg");
    assert.strictEqual(layout.pendingInOrg, true);
    const flow = computeItemState(plan, selection(plan), "Flow:Quote_Approval");
    assert.strictEqual(flow.status, "same");
    assert.strictEqual(flow.differs, false);
    // A prepared file: the marker count read after a save wins over the plan
    const prepared = normalizeBackpromotePlan({
      ...loadRawPlan(),
      comparison: loadRawPlan().comparison.map((comparison: any) =>
        comparison.file === INVOICE_CALCULATOR_FILE ? { ...comparison, decision: "merge", prepared: true, markersRemaining: 2 } : comparison,
      ),
    })!;
    const merged = computeItemState(prepared, selection(prepared), "ApexClass:InvoiceCalculator");
    assert.strictEqual(merged.decision, "merge");
    assert.strictEqual(merged.markersRemaining, 2);
    const solved = computeItemState(prepared, selection(prepared), "ApexClass:InvoiceCalculator", { [INVOICE_CALCULATOR_FILE]: 0 });
    assert.strictEqual(solved.markersRemaining, 0);
  });

  test("the summary counts what runs, blocks on markers and on a missing window", () => {
    const plan = loadPlan();
    const summary = computeSelectionSummary(plan, selection(plan));
    assert.strictEqual(summary.itemsToDeployCount, 5);
    assert.strictEqual(summary.deletionsToDeleteCount, 1);
    assert.strictEqual(summary.actionsToRunCount, 2);
    assert.strictEqual(summary.manualActionsCount, 1);
    assert.deepStrictEqual(summary.blockers, []);
    assert.strictEqual(summary.canRun, true);

    const keptOrg = computeSelectionSummary(plan, selection(plan, { diffDecisions: { "ApexClass:InvoiceCalculator": "org", "Layout:Case-Case Layout": "git" } }));
    assert.strictEqual(keptOrg.itemsToDeployCount, 4);
    assert.strictEqual(keptOrg.keptOrgCount, 1);

    // A merge decided but not prepared yet blocks the run, a prepared one blocks while markers remain
    const merging = computeSelectionSummary(plan, selection(plan, { diffDecisions: { "ApexClass:InvoiceCalculator": "merge", "Layout:Case-Case Layout": "git" } }));
    assert.deepStrictEqual(merging.blockers, ["conflictMarkers"]);
    assert.strictEqual(merging.mergedFilesCount, 1);
    const prepared = normalizeBackpromotePlan({
      ...loadRawPlan(),
      comparison: loadRawPlan().comparison.map((comparison: any) =>
        comparison.file === INVOICE_CALCULATOR_FILE ? { ...comparison, decision: "merge", prepared: true, markersRemaining: 1 } : comparison,
      ),
    })!;
    const stillMarked = computeSelectionSummary(prepared, selection(prepared));
    assert.deepStrictEqual(stillMarked.blockers, ["conflictMarkers"]);
    assert.deepStrictEqual(stillMarked.markersLeft.map((file) => file.file), [INVOICE_CALCULATOR_FILE]);
    const solved = computeSelectionSummary(prepared, selection(prepared), { [INVOICE_CALCULATOR_FILE]: 0 });
    assert.strictEqual(solved.canRun, true);

    // A prepared file switched back to Overwrite or Keep org version, or unticked, still holds
    // its markers in the checkout: sfdx-hardis would refuse the run, so the panel does too
    for (const overrides of [
      { diffDecisions: { "ApexClass:InvoiceCalculator": "git" as const, "Layout:Case-Case Layout": "git" as const } },
      { diffDecisions: { "ApexClass:InvoiceCalculator": "org" as const, "Layout:Case-Case Layout": "git" as const } },
      { excludedItems: ["ApexClass:InvoiceCalculator", "Profile:Admin"] },
    ]) {
      const switched = computeSelectionSummary(prepared, selection(prepared, overrides));
      assert.deepStrictEqual(switched.blockers, ["preparedMarkers"], JSON.stringify(overrides));
      assert.deepStrictEqual(switched.markersLeft, [{ file: INVOICE_CALCULATOR_FILE, item: "ApexClass:InvoiceCalculator", markersRemaining: 1, merging: false }]);
      assert.strictEqual(switched.mergedFilesCount, 0);
      assert.strictEqual(switched.canRun, false);
    }
    const switchedSolved = computeSelectionSummary(prepared, selection(prepared, { diffDecisions: { "ApexClass:InvoiceCalculator": "git", "Layout:Case-Case Layout": "git" } }), { [INVOICE_CALCULATOR_FILE]: 0 });
    assert.deepStrictEqual(switchedSolved.blockers, []);
    assert.strictEqual(stillMarked.markersLeft[0].merging, true);

    const empty = computeSelectionSummary(plan, selection(plan, {
      excludedItems: plan.items.map((item) => item.key),
      excludedDeletions: plan.deletions.map((deletion) => deletion.key),
      actions: [],
    }));
    assert.deepStrictEqual(empty.blockers, ["nothingToDo"]);

    const noWindow = normalizeBackpromotePlan({ ...loadRawPlan(), window: null, items: [], comparison: [] })!;
    assert.deepStrictEqual(computeSelectionSummary(noWindow, buildDefaultSelection(noWindow)).blockers, ["noWindow"]);
    const blocked = normalizeBackpromotePlan({ ...loadRawPlan(), status: "blocked" })!;
    assert.deepStrictEqual(computeSelectionSummary(blocked, buildDefaultSelection(blocked)).blockers, ["notReady"]);
  });

  test("the run command carries every decision as flags", () => {
    const plan = loadPlan();
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, {
        excludedItems: ["Flow:Quote_Approval", "Profile:Admin"],
        excludedDeletions: [],
        actions: ["load-sla-thresholds"],
        diffDecisions: { "ApexClass:InvoiceCalculator": "merge", "Layout:Case-Case Layout": "org" },
      }),
      TARGET,
      { action: "commit", message: "WIP lead routing" },
    );
    const tokens = tokenizeCommand(command);
    assert.deepStrictEqual(tokens.slice(0, 3), ["sf", "hardis:work:backpromote", "--auto"]);
    assert.ok(command.includes("--run-id mock7f3a --target-org sam.dubois@mycompany.com.dev1 --parent-branch integration --from-pull-request 415"), command);
    assert.ok(command.includes("--exclude-metadata Flow:Quote_Approval --exclude-metadata Profile:Admin"), command);
    assert.ok(command.includes(`--on-diff ${INVOICE_CALCULATOR_FILE}=merge`), command);
    assert.ok(command.includes(`--on-diff "${CASE_LAYOUT_FILE}=org"`), command);
    assert.ok(command.includes("--actions load-sla-thresholds"), command);
    assert.ok(command.includes('--dirty-tree commit --commit-message "WIP lead routing"'), command);
    assert.ok(command.endsWith(" --json"), command);
    assert.ok(!command.includes("--skip-destructive"));

    const skipping = buildBackpromoteCommand(plan, selection(plan, { excludedDeletions: ["ApexClass:LegacyDiscountHelper"], actions: [] }), TARGET);
    assert.ok(skipping.includes("--skip-destructive"), skipping);
    assert.ok(skipping.includes("--skip-actions"), skipping);
    assert.ok(!skipping.includes("--on-diff"), skipping);
    assert.ok(!skipping.includes("--dirty-tree"), skipping);

    // An unticked item carries no decision, whatever the choice taken before it was unticked
    const excludedMerge = buildBackpromoteCommand(
      plan,
      selection(plan, { excludedItems: ["ApexClass:InvoiceCalculator", "Profile:Admin"], diffDecisions: { "ApexClass:InvoiceCalculator": "merge", "Layout:Case-Case Layout": "git" } }),
      TARGET,
    );
    assert.ok(excludedMerge.includes("--exclude-metadata ApexClass:InvoiceCalculator"), excludedMerge);
    assert.ok(!excludedMerge.includes("--on-diff"), excludedMerge);

    // A commit of the working tree without a message: sfdx-hardis uses its default one
    const commitNoMessage = buildBackpromoteCommand(plan, selection(plan), TARGET, { action: "commit", message: null });
    assert.ok(commitNoMessage.endsWith("--dirty-tree commit --json"), commitNoMessage);
    assert.ok(!commitNoMessage.includes("--commit-message"), commitNoMessage);
  });

  test("an action that runs every time stays ticked and in --actions after it ran in the sandbox", () => {
    const raw = loadRawPlan();
    const everyTime = normalizeBackpromotePlan({
      ...raw,
      actions: raw.actions.map((action: any) =>
        action.id === "recalculate-quote-sharing" ? { ...action, runOnlyOnceByOrg: false } : action,
      ),
    })!;
    const defaults = buildDefaultSelection(everyTime);
    assert.deepStrictEqual(defaults.actions, ["load-sla-thresholds", "enable-sla-approval", "recalculate-quote-sharing"]);
    assert.deepStrictEqual(normalizeSelection(everyTime, defaults).actions, defaults.actions);
    const command = buildBackpromoteCommand(everyTime, defaults, TARGET);
    assert.ok(command.includes("--actions load-sla-thresholds,enable-sla-approval,recalculate-quote-sharing"), command);
    assert.strictEqual(computeSelectionSummary(everyTime, defaults).actionsToRunCount, 3);
  });

  test("the prepare command lists every differing file of an item", () => {
    const raw = loadRawPlan();
    const twoFiles = normalizeBackpromotePlan({
      ...raw,
      comparison: raw.comparison.map((comparison: any) =>
        comparison.file === `${INVOICE_CALCULATOR_FILE}-meta.xml`
          ? { ...comparison, status: "different", diffLines: 2 }
          : comparison,
      ),
    })!;
    const prepare = buildPrepareCommand(twoFiles, TARGET, ["ApexClass:InvoiceCalculator"]);
    assert.ok(prepare.includes(`--on-diff ${INVOICE_CALCULATOR_FILE}=merge --on-diff ${INVOICE_CALCULATOR_FILE}-meta.xml=merge`), prepare);
    assert.strictEqual((prepare.match(/--on-diff/g) || []).length, 2);
    // The same two files in the run command once the merge is decided
    const run = buildBackpromoteCommand(twoFiles, selection(twoFiles, { diffDecisions: { "ApexClass:InvoiceCalculator": "merge", "Layout:Case-Case Layout": "git" } }), TARGET);
    assert.strictEqual((run.match(/--on-diff/g) || []).length, 2);
    assert.strictEqual(computeSelectionSummary(twoFiles, selection(twoFiles, { diffDecisions: { "ApexClass:InvoiceCalculator": "merge", "Layout:Case-Case Layout": "git" } })).mergedFilesCount, 2);
  });

  test("the plan, prepare, confirm and reset commands", () => {
    const plan = loadPlan();
    assert.strictEqual(
      buildPlanCommand({ targetOrg: USERNAME, parentBranch: "integration" }),
      `sf hardis:work:backpromote --plan --target-org ${USERNAME} --parent-branch integration --json`,
    );
    assert.strictEqual(
      buildPlanCommand(TARGET, { scanLimit: 200 }),
      `sf hardis:work:backpromote --plan --run-id mock7f3a --target-org ${USERNAME} --parent-branch integration --from-pull-request 415 --scan-limit 200 --json`,
    );
    const prepare = buildPrepareCommand(plan, TARGET, ["Layout:Case-Case Layout"], { action: "stash", message: null });
    assert.ok(prepare.startsWith("sf hardis:work:backpromote --prepare --run-id mock7f3a"), prepare);
    assert.ok(prepare.includes(`--on-diff "${CASE_LAYOUT_FILE}=merge" --dirty-tree stash --json`), prepare);
    assert.throws(() => buildPrepareCommand(plan, TARGET, ["Flow:Quote_Approval"]));
    assert.strictEqual(
      buildConfirmActionCommand(TARGET, ["enable-sla-approval"]),
      `sf hardis:work:backpromote --confirm-action enable-sla-approval --run-id mock7f3a --target-org ${USERNAME} --parent-branch integration --from-pull-request 415 --json`,
    );
    // The scan the plan was made with: sfdx-hardis only records an action of a Pull Request within its scan
    assert.strictEqual(
      buildConfirmActionCommand(TARGET, ["enable-sla-approval"], { scanLimit: 200 }),
      `sf hardis:work:backpromote --confirm-action enable-sla-approval --run-id mock7f3a --target-org ${USERNAME} --parent-branch integration --from-pull-request 415 --scan-limit 200 --json`,
    );
    assert.ok(!buildConfirmActionCommand(TARGET, ["enable-sla-approval"], { scanLimit: 100 }).includes("--scan-limit"));
    assert.strictEqual(
      buildResetCommand(TARGET),
      `sf hardis:work:backpromote --reset --auto --target-org ${USERNAME} --parent-branch integration --json`,
    );
  });

  test("buildSelectionPayload reports a value the command cannot carry", () => {
    const plan = loadPlan();
    const payload = buildSelectionPayload(plan, selection(plan), TARGET);
    assert.ok(payload.command);
    assert.strictEqual(payload.commandError, null);
    const evil = normalizeBackpromotePlan({ ...loadRawPlan(), items: [{ key: 'Flow:a"b', type: "Flow", name: 'a"b', files: [], pullRequests: [] }], comparison: [] })!;
    const broken = buildSelectionPayload(evil, { ...buildDefaultSelection(evil), excludedItems: ['Flow:a"b'] }, TARGET);
    assert.strictEqual(broken.command, null);
    assert.ok(broken.commandError);
    assert.ok(broken.summary.blockers.includes("invalidCommand"));
    assert.strictEqual(broken.summary.canRun, false);
  });

  test("buildOrgChoices disables the major orgs and the production orgs, default org first", () => {
    const majorOrgs = [
      { branchName: "integration", targetUsername: "deploy@mycompany.com.integ", instanceUrl: "https://mycompany--integ.sandbox.my.salesforce.com" },
      { branchName: "uat", targetUsername: "deploy@mycompany.com.uat" },
    ];
    const choices = buildOrgChoices(
      [
        { username: "sam@mycompany.com.dev1", alias: "dev1", orgType: "sandbox", isSandbox: true, isDefaultUsername: true },
        { username: "alex@mycompany.com.dev2", orgType: "sandbox", isSandbox: true },
        // Another user of the UAT sandbox: still the UAT org
        { username: "sam@mycompany.com.uat", alias: "UAT-sam", orgType: "sandbox", isSandbox: true },
        { username: "deploy@mycompany.com", alias: "PROD", orgType: "production", isSandbox: false },
        { username: "test-x@example.com", alias: "scratch", orgType: "scratch", isScratch: true },
        // A Developer Edition org is "other" for listAllOrgs: selectable
        { username: "dev@example.com", alias: "devEd", orgType: "other", instanceUrl: "https://mycompany-dev-ed.develop.my.salesforce.com" },
        { username: "old@mycompany.com.dead", orgType: "sandbox", isSandbox: true, status: "Expired" },
        { username: "bad$(x)@mycompany.com.dev3", orgType: "sandbox", isSandbox: true },
        // Without the orgType of listAllOrgs, the same rule is applied on the flags and the URL
        { username: "legacy@mycompany.com", isSandbox: false, instanceUrl: "https://mycompany.my.salesforce.com" },
        { username: "legacy-dev@example.com", isSandbox: false, instanceUrl: "https://legacy-dev-ed.develop.my.salesforce.com" },
      ],
      majorOrgs,
    );
    assert.deepStrictEqual(
      choices.map((org) => [org.username, org.disabledReason, org.majorBranch]),
      [
        ["sam@mycompany.com.dev1", null, null],
        ["alex@mycompany.com.dev2", null, null],
        ["dev@example.com", null, null],
        ["legacy-dev@example.com", null, null],
        ["test-x@example.com", null, null],
        ["legacy@mycompany.com", "production", null],
        ["deploy@mycompany.com", "production", null],
        ["sam@mycompany.com.uat", "majorOrg", "uat"],
      ],
    );
    assert.strictEqual(choices[0].label, "dev1 (sam@mycompany.com.dev1)");
    assert.strictEqual(choices[0].isDefault, true);
  });

  test("listAllowedParentBranches keeps developmentBranch first, then availableTargetBranches, nothing else", () => {
    assert.deepStrictEqual(listAllowedParentBranches({ developmentBranch: "integration", availableTargetBranches: ["preprod", "integration", "uat"] }), ["integration", "preprod", "uat"]);
    assert.deepStrictEqual(listAllowedParentBranches({ developmentBranch: "integration" }), ["integration"]);
    assert.deepStrictEqual(listAllowedParentBranches({ availableTargetBranches: ["uat", "a && b"] }), ["uat"]);
    assert.deepStrictEqual(listAllowedParentBranches({}), []);
  });

  test("the parent branch is taken without asking only when it cannot be another one", () => {
    const allowed = ["integration", "preprod"];
    assert.strictEqual(defaultParentBranchFor("integration", allowed), "integration");
    assert.strictEqual(defaultParentBranchFor("backpromote/preprod/dev1", allowed), "preprod");
    // A User Story branch could come from any of them: the user chooses
    assert.strictEqual(defaultParentBranchFor("feature/CRM-1042-account-hierarchy", allowed), null);
    assert.strictEqual(defaultParentBranchFor("backpromote/uat/dev1", allowed), null);
    assert.strictEqual(defaultParentBranchFor("", allowed), null);
    assert.strictEqual(defaultParentBranchFor("feature/x", ["integration"]), "integration");
    assert.strictEqual(defaultParentBranchFor("feature/x", []), null);
  });

  test("a backpromote branch is recognized, with a parent branch holding slashes", () => {
    assert.deepStrictEqual(parseBackpromoteBranchName("backpromote/integration/dev1"), { parentBranch: "integration", sandboxName: "dev1" });
    assert.deepStrictEqual(parseBackpromoteBranchName("backpromote/release/2026.09/dev-sam"), { parentBranch: "release/2026.09", sandboxName: "dev-sam" });
    assert.strictEqual(parseBackpromoteBranchName("backpromote/dev1"), null);
    assert.strictEqual(parseBackpromoteBranchName("feature/backpromote/x"), null);
    assert.strictEqual(isBackpromoteBranchName("backpromote/uat/dev2"), true);
    assert.strictEqual(isBackpromoteBranchName("promotion/uat/preprod/2026-09-11-0859"), false);
  });

  test("recoverJsonCommandResult reads the JSON printed after a log line", () => {
    const stdout = ["WS Client started", "{", '  "status": 0,', '  "result": { "version": 3, "status": "ok" }', "}"].join("\n");
    const recovered = recoverJsonCommandResult({ status: 1, unableToParseJson: true, stdout, stderr: "" });
    assert.strictEqual(recovered.status, 0);
    assert.strictEqual(recovered.result.version, 3);
    assert.strictEqual(recovered.unableToParseJson, false);
    const untouched = { status: 0, result: {} };
    assert.strictEqual(recoverJsonCommandResult(untouched), untouched);
  });

  test("an old sfdx-hardis and a failed command are told apart", () => {
    assert.strictEqual(isCliTooOldForBackpromotePanel({ status: 2, message: "Nonexistent flag: --parent-branch" }), true);
    assert.strictEqual(isCliTooOldForBackpromotePanel({ status: 0, result: { planVersion: 2, status: "ready" } }), true);
    assert.strictEqual(isCliTooOldForBackpromotePanel({ status: 0, result: loadRawPlan() }), false);
    assert.strictEqual(isCliTooOldForBackpromotePanel({ status: 1, message: "Deployment failed" }), false);
    assert.strictEqual(getBackpromoteErrorMessage({ status: 1, message: "[31mDeployment failed[0m" }), "Deployment failed");
    assert.strictEqual(getBackpromoteErrorMessage({ status: 1, stdout: '{"status":1,"message":"No git provider token"}' }), "No git provider token");
    assert.strictEqual(getBackpromoteErrorMessage({ status: 1, stderr: "line 1\nline 2" }), "line 1\nline 2");
    assert.strictEqual(getBackpromoteErrorMessage(null), "");
  });

  test("getTargetOrgDisplayName prefers the sandbox name, then the short host of the status bar", () => {
    assert.strictEqual(getTargetOrgDisplayName(loadPlan().targetOrg), "dev1");
    assert.strictEqual(getTargetOrgDisplayName({ instanceUrl: "https://mycompany--dev-sam.sandbox.my.salesforce.com", username: USERNAME }), "mycompany--dev-sam");
    assert.strictEqual(getTargetOrgDisplayName({ instanceUrl: "https://mycompany-dev-ed.develop.my.salesforce.com", username: USERNAME }), "mycompany-dev-ed");
    assert.strictEqual(getTargetOrgDisplayName({ instanceUrl: "https://test.salesforce.com", username: USERNAME }), USERNAME);
    assert.strictEqual(getTargetOrgDisplayName({ instanceUrl: "", alias: "dev1", username: USERNAME }), "dev1");
    assert.strictEqual(getTargetOrgDisplayName(null), "");
  });

  test("the progress file of a background command is read line by line", () => {
    const content = [
      '{"time":"2026-09-11T10:00:00Z","step":"targetOrg","message":"Reading the target sandbox"}',
      '{"time":"2026-09-11T10:00:01Z","step":"history","message":"Reading #418","current":1,"total":4}',
      '{"time":"2026-09-11T10:00:02Z","step":"history","message":"Reading #417","current":2,"total":4}',
      '{"time":"2026-09-11T10:00:03Z","step":"history","message":"Reading #4',
    ].join("\n");
    const events = parseProgressEvents(content);
    assert.strictEqual(events.length, 3);
    const progress = buildPlanProgress(events);
    assert.strictEqual(progress?.message, "Reading #417");
    assert.strictEqual(progress?.percent, 50);
    assert.deepStrictEqual(progress?.doneSteps.map((step) => step.key), ["targetOrg"]);
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
    // Keys chosen at runtime (count labels, states...)
    for (const [, key] of sources.matchAll(/"(backpromote[A-Za-z0-9_]+)"/g)) {
      keys.add(key);
    }
    assert.ok(keys.size > 80, `only ${keys.size} keys found`);
    assertKeysTranslated(keys);
  });
});
