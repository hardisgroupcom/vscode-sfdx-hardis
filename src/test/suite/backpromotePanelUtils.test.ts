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
  buildPlanCommand,
  buildPrepareMergeCommand,
  buildSelectionPayload,
  computeSelectionSummary,
  countConflictBlocks,
  getBackpromoteErrorMessage,
  getTargetOrgDisplayName,
  isAllowedBackpromoteCommand,
  isCliTooOldForBackpromotePanel,
  isSafeCommandValue,
  normalizeBackpromotePlan,
  normalizePrepareMergeResult,
  normalizeSelection,
  parseMetadataKey,
  quoteCommandValue,
  recoverJsonCommandResult,
  buildPlanProgress,
  parseProgressEvents,
} from "../../utils/backpromote/backpromotePanelUtils";

const USERNAME = "sam.dubois@mycompany.com.dev-sam";

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

function hashOfPullRequest(plan: BackpromotePlan, id: number): string {
  const group = plan.groups.find((entry) =>
    entry.pullRequests.some((pr) => pr.id === id),
  );
  assert.ok(group, `group of #${id} not found`);
  return group!.hash;
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
    assert.deepStrictEqual(parseMetadataKey("CustomMetadata:A.B:C"), {
      type: "CustomMetadata",
      name: "A.B:C",
    });
    assert.strictEqual(parseMetadataKey("NoColon"), null);
    assert.strictEqual(parseMetadataKey(":Name"), null);
    assert.strictEqual(parseMetadataKey("Type:"), null);
  });

  test("quoteCommandValue quotes spaces and refuses shell syntax", () => {
    assert.strictEqual(quoteCommandValue("integration"), "integration");
    assert.strictEqual(
      quoteCommandValue("ApexClass:InvoiceCalculator"),
      "ApexClass:InvoiceCalculator",
    );
    assert.strictEqual(
      quoteCommandValue("Layout:Opportunity-Sales Layout"),
      '"Layout:Opportunity-Sales Layout"',
    );
    // A lone dollar sign is part of the unfiled$public folder names: single quoted, never refused
    assert.strictEqual(quoteCommandValue("a$b"), "'a$b'");
    for (const unsafe of [
      'a"b',
      "a'b",
      "a$(b)",
      "a${b}",
      "a`b",
      "a\\b",
      "a && b",
      "a || b",
      "a\nb",
      "",
    ]) {
      assert.throws(
        () => quoteCommandValue(unsafe),
        `${JSON.stringify(unsafe)} must be refused`,
      );
    }
  });

  test("only sf hardis:work:backpromote commands without chaining are allowed", () => {
    assert.ok(isAllowedBackpromoteCommand("sf hardis:work:backpromote"));
    assert.ok(
      isAllowedBackpromoteCommand(
        "sf hardis:work:backpromote --pull-requests 481",
      ),
    );
    assert.ok(!isAllowedBackpromoteCommand("sf hardis:work:backpromotex"));
    assert.ok(!isAllowedBackpromoteCommand("sf hardis:work:save"));
    assert.ok(
      !isAllowedBackpromoteCommand("sf hardis:work:backpromote && rm -rf /"),
    );
    assert.ok(
      !isAllowedBackpromoteCommand("sf hardis:work:backpromote\nrm -rf /"),
    );
    assert.ok(!isAllowedBackpromoteCommand(null));
  });

  test("normalizeBackpromotePlan accepts the fixture and rejects other payloads", () => {
    const plan = loadPlan();
    assert.strictEqual(plan.groups.length, 7);
    assert.strictEqual(plan.items.length, 44);
    assert.strictEqual(plan.gitProvider.name, "github");
    assert.strictEqual(plan.stateStorage, "pullRequestComments");
    assert.deepStrictEqual(plan.stateReadErrors, []);
    assert.strictEqual(plan.checks[0].id, "gitProvider");
    assert.strictEqual(normalizeBackpromotePlan({ status: 0 }), null);
    assert.strictEqual(normalizeBackpromotePlan(null), null);
    const partial = normalizeBackpromotePlan({
      planVersion: 1,
      status: "upToDate",
    });
    assert.ok(partial);
    assert.deepStrictEqual(partial!.groups, []);
    assert.deepStrictEqual(partial!.checks, []);
    assert.strictEqual(partial!.gitProvider.name, null);
    assert.deepStrictEqual(partial!.stateReadErrors, []);
  });

  test("done and untrackable groups are listed but not preselected, other developer orgs are kept", () => {
    const plan = loadPlan();
    const done = plan.groups.find((group) => group.status === "done")!;
    const untrackable = plan.groups.find((group) => !group.trackable)!;
    assert.ok(done && untrackable);
    assert.strictEqual(done.selectedByDefault, false);
    assert.ok(done.backpromotedToThisOrg);
    // The target org is recorded too, only the other developer orgs are shown
    assert.strictEqual(done.backpromotedTo.length, 2);
    assert.deepStrictEqual(
      done.backpromotedToOtherOrgs.map((record) => record.orgName),
      ["mycompany--dev-lea"],
    );
    assert.strictEqual(untrackable.selectedByDefault, false);
    assert.strictEqual(untrackable.status, "pending");
    const group481 = plan.groups.find(
      (group) => group.hash === hashOfPullRequest(plan, 481),
    )!;
    assert.strictEqual(group481.backpromotedToOtherOrgs.length, 1);

    const selectedGroups = buildDefaultSelection(plan).groups;
    assert.ok(!selectedGroups.includes(done.hash));
    assert.ok(!selectedGroups.includes(untrackable.hash));

    // Selecting a done group backpromotes it again
    const again = computeSelectionSummary(
      plan,
      selection(plan, { groups: [...selectedGroups, done.hash] }),
    );
    assert.strictEqual(again.alreadyInOrgSelectedCount, 1);
    assert.strictEqual(
      computeSelectionSummary(plan, buildDefaultSelection(plan))
        .alreadyInOrgSelectedCount,
      0,
    );

    // A partial group gets safe defaults, and an unknown status is pending
    const legacy = normalizeBackpromotePlan({
      planVersion: 1,
      status: "ready",
      targetOrg: { orgId: "00Dx" },
      groups: [
        {
          hash: "abcdef0123",
          status: "skipped",
          backpromotedTo: [{ orgId: "00Dx", orgName: "me" }, { foo: 1 }],
        },
      ],
    })!;
    assert.strictEqual(legacy.groups[0].status, "pending");
    assert.strictEqual(legacy.groups[0].trackable, true);
    assert.strictEqual(legacy.groups[0].backpromotedTo.length, 1);
    assert.deepStrictEqual(legacy.groups[0].backpromotedToOtherOrgs, []);
  });

  test("default selection: every pending group, every item, the actions not done", () => {
    const plan = loadPlan();
    const summary = computeSelectionSummary(plan, buildDefaultSelection(plan));
    assert.strictEqual(summary.selectedGroupCount, 5);
    assert.deepStrictEqual(summary.pullRequestIds, [478, 481, 482, 485, 487]);
    assert.strictEqual(summary.itemsToDeployCount, 41);
    assert.strictEqual(summary.changedInOrg.length, 3);
    assert.strictEqual(summary.deletionsToDeleteCount, 1);
    assert.strictEqual(summary.actions.length, 3);
    assert.strictEqual(summary.actionsToRunCount, 2);
    assert.strictEqual(summary.actionsAlreadyDoneCount, 1);
    assert.strictEqual(summary.manualActionsCount, 1);
    assert.deepStrictEqual(summary.testClasses, [
      "AccountHierarchyRollupTest",
      "InvoiceCalculatorTest",
      "QuoteApprovalTest",
    ]);
    const shortHashOf = (id: number) =>
      plan.groups.find((group) => group.hash === hashOfPullRequest(plan, id))!
        .shortHash;
    assert.deepStrictEqual(summary.range, {
      oldest: shortHashOf(478),
      newest: shortHashOf(487),
    });
    assert.strictEqual(summary.alsoInUnselectedCount, 0);
    assert.deepStrictEqual(summary.blockers, []);
    assert.strictEqual(summary.canRun, true);
  });

  test("an item also changed by an unselected group is flagged", () => {
    const plan = loadPlan();
    const hash487 = hashOfPullRequest(plan, 487);
    const without487 = selection(plan, {
      groups: buildDefaultSelection(plan).groups.filter(
        (hash) => hash !== hash487,
      ),
    });
    const summary = computeSelectionSummary(plan, without487);
    // #487 brings 5 items, one of them (Flow:Quote_Approval) also comes with #482
    assert.strictEqual(summary.itemsToDeployCount, 37);
    const flow = summary.items.find((item) => item.key === "Flow:Quote_Approval");
    assert.ok(flow);
    assert.deepStrictEqual(flow!.pullRequestIds, [482]);
    assert.deepStrictEqual(
      flow!.alsoInUnselected.map((group) => group.pullRequestIds),
      [[487]],
    );
    assert.strictEqual(summary.alsoInUnselectedCount, 1);
    assert.ok(
      !summary.actions.some((action) => action.id === "recalculate-quote-sharing"),
      "the actions of #487 are not part of the selection",
    );
  });

  test("buildBackpromoteCommand for the default selection", () => {
    const plan = loadPlan();
    assert.strictEqual(
      buildBackpromoteCommand(plan, buildDefaultSelection(plan)),
      `sf hardis:work:backpromote --parentbranch integration --pull-requests 478,481,482,485,487 --actions load-approval-matrix,assign-sales-manager --target-org ${USERNAME}`,
    );
  });

  test("buildBackpromoteCommand with kept, merged, undeleted items and no action", () => {
    const plan = loadPlan();
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, {
        groups: [hashOfPullRequest(plan, 485), hashOfPullRequest(plan, 481)],
        excludedItems: ["Layout:Opportunity-Sales Layout"],
        mergedItems: ["ApexClass:InvoiceCalculator"],
        excludedDeletions: ["CustomField:Opportunity.Legacy_Score__c"],
        actions: [],
      }),
    );
    assert.strictEqual(
      command,
      `sf hardis:work:backpromote --parentbranch integration --pull-requests 481,485 --exclude-metadata "Layout:Opportunity-Sales Layout" --skip-destructive --merged-metadata ApexClass:InvoiceCalculator --target-org ${USERNAME}`,
    );
    // The command runner splits it back into the same arguments
    const tokens = tokenizeCommand(command!);
    assert.ok(tokens.includes("Layout:Opportunity-Sales Layout"));
    assert.ok(isAllowedBackpromoteCommand(command));
  });

  test("--skip-actions when the selection has actions but none is ticked", () => {
    const plan = loadPlan();
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, { groups: [hashOfPullRequest(plan, 482)], actions: [] }),
    );
    assert.ok(command!.includes(" --skip-actions "), command!);
    assert.ok(!command!.includes("--actions "), command!);
  });

  test("one --exclude-metadata per unticked deletion when some deletions stay", () => {
    const plan = loadPlan();
    const hash485 = hashOfPullRequest(plan, 485);
    plan.deletions.push({
      key: "ApexClass:LegacyScoreService",
      type: "ApexClass",
      name: "LegacyScoreService",
      commits: [hash485],
    });
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, {
        groups: [hash485],
        excludedDeletions: ["CustomField:Opportunity.Legacy_Score__c"],
      }),
    );
    assert.ok(
      command!.includes(
        "--exclude-metadata CustomField:Opportunity.Legacy_Score__c",
      ),
      command!,
    );
    assert.ok(!command!.includes("--skip-destructive"), command!);
  });

  test("a group sharing a Pull Request number with an unselected group goes to --commits", () => {
    const plan = loadPlan();
    const group481 = plan.groups.find((group) => group.hash === hashOfPullRequest(plan, 481))!;
    // #481 was merged a second time by another group (ex: a revert of a revert)
    plan.groups
      .find((group) => group.hash === hashOfPullRequest(plan, 478))!
      .pullRequests.push({ ...group481.pullRequests[0] });
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, {
        groups: [group481.hash, hashOfPullRequest(plan, 487)],
      }),
    );
    assert.ok(command!.includes(`--pull-requests 487`), command!);
    assert.ok(command!.includes(`--commits ${group481.shortHash}`), command!);
  });

  test("a group without Pull Request goes to --commits", () => {
    const plan = loadPlan();
    const untrackable = plan.groups.find((group) => !group.trackable)!;
    assert.deepStrictEqual(untrackable.pullRequests, []);
    const command = buildBackpromoteCommand(
      plan,
      selection(plan, {
        groups: [hashOfPullRequest(plan, 487), untrackable.hash],
      }),
    );
    assert.ok(command!.includes("--pull-requests 487 "), command!);
    assert.ok(command!.includes(`--commits ${untrackable.shortHash}`), command!);
  });

  test("a folder name holding a dollar sign is quoted instead of blocking the run", () => {
    // Reports, Dashboards and Email Templates of the default folder are named
    // unfiled$public: the panel used to refuse the whole command as soon as such an
    // item was kept or merged
    assert.strictEqual(
      quoteCommandValue("Report:unfiled$public/Pipeline"),
      "'Report:unfiled$public/Pipeline'",
    );
    assert.strictEqual(quoteCommandValue("Report:unfiled$public/My Report"), "'Report:unfiled$public/My Report'");
    const tokens = tokenizeCommand(
      `sf hardis:work:backpromote --exclude-metadata ${quoteCommandValue("Report:unfiled$public/My Report")}`,
    );
    assert.ok(tokens.includes("Report:unfiled$public/My Report"), tokens.join("|"));
    // Substitutions and quotes stay refused
    assert.strictEqual(isSafeCommandValue("user$(whoami)@example.com"), false);
    assert.strictEqual(isSafeCommandValue("Report:${HOME}/x"), false);
    assert.strictEqual(isSafeCommandValue("Report:it's mine"), false);
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
      groups: [plan.groups[1].hash, "not-a-hash", plan.groups[1].hash, 42],
      excludedItems: ["Layout:Opportunity-Sales Layout", "Unknown:Item"],
      mergedItems: [
        "ApexClass:InvoiceCalculator",
        // not mergeable
        "ApexClass:InvoiceCalculatorTest",
        // excluded at the same time: keep org version wins
        "Layout:Opportunity-Sales Layout",
      ],
      excludedDeletions: "CustomField:Opportunity.Legacy_Score__c",
      actions: ["assign-sales-manager", "rm -rf"],
    });
    assert.deepStrictEqual(normalized, {
      groups: [plan.groups[1].hash],
      excludedItems: ["Layout:Opportunity-Sales Layout"],
      mergedItems: ["ApexClass:InvoiceCalculator"],
      excludedDeletions: [],
      actions: ["assign-sales-manager"],
    });
    assert.deepStrictEqual(normalizeSelection(plan, null).groups, []);
  });

  test("a merged item blocks the run until its file holds no conflict marker", () => {
    const plan = loadPlan();
    const merged = selection(plan, {
      mergedItems: ["ApexClass:InvoiceCalculator"],
    });
    const notChecked = computeSelectionSummary(plan, merged);
    assert.deepStrictEqual(notChecked.conflictKeys, ["ApexClass:InvoiceCalculator"]);
    assert.ok(notChecked.blockers.includes("conflictMarkers"));
    const withMarkers = computeSelectionSummary(plan, merged, {
      "ApexClass:InvoiceCalculator": 2,
    });
    assert.strictEqual(
      withMarkers.items.find((item) => item.key === "ApexClass:InvoiceCalculator")!
        .conflictBlocks,
      2,
    );
    assert.strictEqual(withMarkers.canRun, false);
    const solved = computeSelectionSummary(plan, merged, {
      "ApexClass:InvoiceCalculator": 0,
    });
    assert.strictEqual(solved.canRun, true);
  });

  test("noGroup, nothingToDo and notReady blockers", () => {
    const plan = loadPlan();
    const none = buildSelectionPayload(plan, selection(plan, { groups: [] }));
    assert.strictEqual(none.command, null);
    assert.deepStrictEqual(none.summary.blockers, ["noGroup"]);

    const group478 = plan.groups.find(
      (group) => group.hash === hashOfPullRequest(plan, 478),
    )!;
    const nothing = computeSelectionSummary(
      plan,
      selection(plan, { groups: [group478.hash], excludedItems: group478.items }),
    );
    assert.deepStrictEqual(nothing.blockers, ["nothingToDo"]);

    plan.status = "blocked";
    const blocked = computeSelectionSummary(plan, buildDefaultSelection(plan));
    assert.deepStrictEqual(blocked.blockers, ["notReady"]);
  });

  test("buildPlanCommand", () => {
    assert.strictEqual(
      buildPlanCommand(),
      "sf hardis:work:backpromote --plan --json",
    );
    assert.strictEqual(
      buildPlanCommand("feature/uat-2"),
      "sf hardis:work:backpromote --plan --parentbranch feature/uat-2 --json",
    );
    // Shell separators stay inside double quotes, substitutions are refused
    assert.strictEqual(
      buildPlanCommand("main;rm -rf"),
      'sf hardis:work:backpromote --plan --parentbranch "main;rm -rf" --json',
    );
    assert.throws(() => buildPlanCommand("main$(id)"));
    // A plan asked while merges are waiting names them, otherwise the CLI answers "not clean"
    assert.strictEqual(
      buildPlanCommand("integration", {
        mergedItems: ["ApexClass:InvoiceCalculator"],
        from: "0123456789abcdef",
      }),
      "sf hardis:work:backpromote --plan --parentbranch integration --merged-metadata ApexClass:InvoiceCalculator --from 0123456789abcdef --json",
    );
  });

  test("buildPrepareMergeCommand keeps mergeable items, the group selection and the decisions", () => {
    const plan = loadPlan();
    assert.strictEqual(
      buildPrepareMergeCommand(plan, buildDefaultSelection(plan), [
        "ApexClass:InvoiceCalculator",
        "Layout:Opportunity-Sales Layout",
        // not mergeable
        "ApexClass:InvoiceCalculatorTest",
      ]),
      `sf hardis:work:backpromote --prepare-merge ApexClass:InvoiceCalculator --prepare-merge "Layout:Opportunity-Sales Layout" --parentbranch integration --pull-requests 478,481,482,485,487 --actions load-approval-matrix,assign-sales-manager --target-org ${USERNAME} --json`,
    );
    assert.throws(() =>
      buildPrepareMergeCommand(plan, buildDefaultSelection(plan), [
        "ApexClass:InvoiceCalculatorTest",
      ]),
    );
    assert.throws(() =>
      buildPrepareMergeCommand(plan, selection(plan, { groups: [] }), [
        "ApexClass:InvoiceCalculator",
      ]),
    );
  });

  test("a second merge names the first one, so the CLI accepts the modified file", () => {
    const plan = loadPlan();
    const command = buildPrepareMergeCommand(
      plan,
      selection(plan, {
        mergedItems: ["ApexClass:InvoiceCalculator"],
        excludedItems: ["Layout:Opportunity-Sales Layout"],
      }),
      ["Flow:Quote_Approval"],
    );
    assert.ok(command.includes("--prepare-merge Flow:Quote_Approval"), command);
    assert.ok(
      command.includes("--merged-metadata ApexClass:InvoiceCalculator"),
      command,
    );
    assert.ok(
      command.includes(
        '--exclude-metadata "Layout:Opportunity-Sales Layout"',
      ),
      command,
    );
    assert.ok(
      !command.includes("--prepare-merge ApexClass:InvoiceCalculator"),
      command,
    );
  });

  test("countConflictBlocks still counts a half-removed conflict", () => {
    const halfSolved = [
      "public class InvoiceCalculator {",
      "  Decimal scale = 2;",
      "=======",
      "  Decimal scale = 4;",
      ">>>>>>> integration",
      "}",
    ].join("\n");
    assert.strictEqual(countConflictBlocks(halfSolved), 1);
  });

  test("countConflictBlocks counts the opening markers", () => {
    const content = [
      "public class InvoiceCalculator {",
      "<<<<<<< your org",
      "  Decimal scale = 2;",
      "||||||| last backpromoted",
      "  Decimal scale = 3;",
      "=======",
      "  Decimal scale = 4;",
      ">>>>>>> integration",
      "<<<<<<<< not a marker",
      "<<<<<<< your org",
      "=======",
      ">>>>>>> integration",
      "}",
    ].join("\r\n");
    assert.strictEqual(countConflictBlocks(content), 2);
    assert.strictEqual(countConflictBlocks("public class A {}"), 0);
    assert.strictEqual(countConflictBlocks(""), 0);
  });

  test("an unknown flag error means the installed sfdx-hardis is too old", () => {
    const stderrJson = JSON.stringify({
      code: "NonexistentFlagsError",
      name: "NonexistentFlagsError",
      message: "Nonexistent flag: --plan\nSee more help with --help",
      status: 2,
      exitCode: 2,
    });
    assert.ok(
      isCliTooOldForBackpromotePanel({ status: 1, stdout: "", stderr: stderrJson }),
    );
    assert.ok(
      isCliTooOldForBackpromotePanel({
        status: 2,
        message: "Nonexistent flag: --plan",
      }),
    );
    assert.ok(
      !isCliTooOldForBackpromotePanel({
        status: 1,
        message: "No authorization information found for sam.dubois",
      }),
    );
    assert.ok(!isCliTooOldForBackpromotePanel(null));
  });

  test("getBackpromoteErrorMessage reads the message, the JSON streams, then the raw output", () => {
    assert.strictEqual(
      getBackpromoteErrorMessage({ status: 1, message: "Org not found" }),
      "Org not found",
    );
    assert.strictEqual(
      getBackpromoteErrorMessage({
        status: 1,
        stdout: "",
        stderr: JSON.stringify({ message: "Git is not installed" }),
      }),
      "Git is not installed",
    );
    assert.strictEqual(
      getBackpromoteErrorMessage({ status: 1, stderr: "plain failure" }),
      "plain failure",
    );
    assert.strictEqual(getBackpromoteErrorMessage(null), "");
  });

  test("getTargetOrgDisplayName uses the org name, the instance URL, then the username", () => {
    assert.strictEqual(
      getTargetOrgDisplayName({
        username: USERNAME,
        instanceUrl: "https://mycompany--dev-sam.sandbox.my.salesforce.com",
        orgType: "sandbox",
        orgName: "dev-sam",
      }),
      "dev-sam",
    );
    assert.strictEqual(
      getTargetOrgDisplayName({
        username: USERNAME,
        instanceUrl: "https://mycompany--dev-sam.sandbox.my.salesforce.com",
        orgType: "sandbox",
      }),
      "mycompany--dev-sam",
    );
    assert.strictEqual(
      getTargetOrgDisplayName({
        username: USERNAME,
        instanceUrl: "",
        orgType: "sandbox",
      }),
      USERNAME,
    );
    assert.strictEqual(getTargetOrgDisplayName(null), "");
  });

  test("normalizePrepareMergeResult", () => {
    const result = normalizePrepareMergeResult({
      files: [
        {
          key: "ApexClass:InvoiceCalculator",
          localPath: "force-app/main/default/classes/InvoiceCalculator.cls",
          basePath: null,
          orgPath: "/tmp/org/InvoiceCalculator.cls",
          conflictBlocks: 2,
        },
        { key: 3 },
      ],
      prompt: "Solve the conflicts",
      promptFile: "hardis-report/backpromote-merge-prompt.md",
      nextCommand: "sf hardis:work:backpromote --merged-metadata ApexClass:InvoiceCalculator",
    });
    assert.ok(result);
    assert.strictEqual(result!.files.length, 1);
    assert.strictEqual(result!.files[0].conflictBlocks, 2);
    assert.strictEqual(normalizePrepareMergeResult({ files: [] }), null);
    assert.strictEqual(normalizePrepareMergeResult(undefined), null);
  });

  test("recoverJsonCommandResult reads the JSON document printed after a log line", () => {
    const stdout =
      'WS Client started\r\n{\r\n  "status": 0,\r\n  "result": {\r\n    "planVersion": 1,\r\n    "status": "upToDate"\r\n  },\r\n  "warnings": []\r\n}\r\n';
    const recovered = recoverJsonCommandResult({
      status: 1,
      stdout,
      stderr: "",
      unableToParseJson: true,
    });
    assert.strictEqual(recovered.status, 0);
    assert.strictEqual(recovered.unableToParseJson, false);
    assert.ok(normalizeBackpromotePlan(recovered.result));

    const unreadable = {
      status: 1,
      stdout: "WS Client started\nnot json",
      unableToParseJson: true,
    };
    assert.strictEqual(recoverJsonCommandResult(unreadable), unreadable);
    const parsed = { status: 0, result: {} };
    assert.strictEqual(recoverJsonCommandResult(parsed), parsed);
  });

  test("every label of the panel is translated in the 9 locales", () => {
    const sources = [
      readModuleFile("backpromote", "backpromote.html"),
      readModuleFile("backpromote", "backpromote.js"),
      fs.readFileSync(
        path.join(REPO_ROOT, "src", "commands", "showBackpromote.ts"),
        "utf8",
      ),
    ].join("\n");
    const keys = new Set<string>();
    for (const [, key] of sources.matchAll(/i18n\.([A-Za-z0-9_]+)/g)) {
      keys.add(key);
    }
    for (const [, key] of sources.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) {
      keys.add(key);
    }
    // Keys chosen at runtime (count labels, check titles, org states...)
    for (const [, key] of sources.matchAll(/"(backpromote[A-Za-z0-9_]+)"/g)) {
      keys.add(key);
    }
    assert.ok(keys.size > 100, `only ${keys.size} keys found`);
    assertKeysTranslated(keys);
  });

  test("manual deployment actions are counted, whatever makes them manual", () => {
    const plan = loadPlan();
    // Real plans also hold actions of type "manual" without a custom username
    plan.actions.find((action) => action.id === "assign-sales-manager")!.type =
      "manual";
    const summary = computeSelectionSummary(plan, buildDefaultSelection(plan));
    assert.strictEqual(summary.manualActionsCount, 2);
  });
});

suite("backpromote working branch", () => {
  test("keeps where the run works, and drops an unknown shape", () => {
    const base = { planVersion: 1, status: "ready" };
    const workingBranch = {
      mode: "newBackpromoteBranch",
      reason: "promotionBranch",
      returnBranch: "promotion/integration/uat/2026-09-11-0859",
    };
    assert.deepStrictEqual(
      normalizeBackpromotePlan({ ...base, workingBranch })?.workingBranch,
      workingBranch,
    );
    assert.strictEqual(
      normalizeBackpromotePlan({ ...base, workingBranch: { mode: "major" } })
        ?.workingBranch,
      null,
    );
    assert.strictEqual(normalizeBackpromotePlan(base)?.workingBranch, null);
  });

  test("keeps the backpromote branch a merge was written on", () => {
    const result = normalizePrepareMergeResult({
      files: [
        {
          key: "ApexClass:PromoE2EAlphaTest",
          localPath: "force-app/main/default/classes/PromoE2EAlphaTest.cls",
          conflictBlocks: 1,
        },
      ],
      nextCommand:
        "sf hardis:work:backpromote --merged-metadata ApexClass:PromoE2EAlphaTest",
      backpromoteBranch: "backpromote/integration/2026-09-11-0859",
      returnBranch: "feature/E2E-401-dev",
    });
    assert.strictEqual(
      result?.backpromoteBranch,
      "backpromote/integration/2026-09-11-0859",
    );
    assert.strictEqual(result?.returnBranch, "feature/E2E-401-dev");
    const older = normalizePrepareMergeResult({
      files: [{ key: "ApexClass:A", localPath: "a.cls" }],
    });
    assert.strictEqual(older?.backpromoteBranch, null);
    assert.strictEqual(older?.returnBranch, null);
  });
});

suite("backpromote plan progress", () => {
  test("reads the progress lines, skipping a line not written completely", () => {
    const events = parseProgressEvents(
      '{"step":"listing","message":"Listing"}\n{"step":"delta","message":"Delta 1","current":1,"total":4}\n{"step":"del',
    );
    assert.deepStrictEqual(events, [
      { step: "listing", message: "Listing", current: null, total: null },
      { step: "delta", message: "Delta 1", current: 1, total: 4 },
    ]);
  });

  test("shows the last step with its percentage, and the steps done before it", () => {
    const content = [
      '{"step":"fetch","message":"Fetching integration"}',
      '{"step":"listing","message":"Listing the Pull Requests merged in integration"}',
      '{"step":"delta","message":"Computing what #487 deploys (1 of 4)","current":1,"total":4}',
      '{"step":"delta","message":"Computing what #485 deploys (2 of 4)","current":2,"total":4}',
    ].join("\n");
    assert.deepStrictEqual(buildPlanProgress(parseProgressEvents(content)), {
      message: "Computing what #485 deploys (2 of 4)",
      percent: 50,
      doneSteps: [
        { key: "fetch", message: "Fetching integration" },
        {
          key: "listing",
          message: "Listing the Pull Requests merged in integration",
        },
      ],
    });
    assert.strictEqual(buildPlanProgress([]), null);
    assert.strictEqual(
      buildPlanProgress(
        parseProgressEvents('{"step":"history","message":"Reading"}'),
      )?.percent,
      null,
    );
  });
});
