import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";
import { PullRequest } from "../../utils/gitProviders/types";
import { BranchStrategyMermaidBuilder } from "../../utils/pipeline/branchStrategyMermaidBuilder";
import { extractMember, readModuleFile } from "./lwcSourceUtils";
import {
  annotateAlreadyPromoted,
  buildPromotionIndex,
  enforceSinglePlacePerPullRequest,
  expandPullRequestsWithPromotions,
  findPromotionsCarrying,
  allowedPromotionTargetBranches,
  getPromotionBranchConfig,
  isMajorToMajorPullRequest,
  isPromotionSourceAllowed,
  isPromotionStepAllowed,
  parsePromotionSteps,
  isMergedPromotionOfStep,
  isMergedPullRequest,
  isVehiclePullRequest,
  isPromotionBranchName,
  isPromotionBranchOfStep,
  listMergedPromotionsOfSteps,
  isPromotionPullRequest,
  parsePromotionBranchName,
  parsePromotionPullRequestIds,
  userStoryPullRequests,
  visiblePullRequests,
} from "../../utils/pipeline/promotionBranchUtils";

const ENABLED = { enabled: true, allowedSteps: [] };
const DISABLED = { enabled: false, allowedSteps: [] };
const PROMOTION_BRANCH = "promotion/uat/preprod/2026-09-06-1";
const DECLARATION =
  "Promotion of September\n\n```yaml\npromotionPullRequests: [482, 487]\n```\n";

function pr(overrides: Partial<PullRequest> & { number: number }): PullRequest {
  return {
    id: overrides.number,
    title: `PR ${overrides.number}`,
    description: "",
    sourceBranch: "feature/story",
    targetBranch: "uat",
    authorLabel: "someone",
    state: "merged",
    webUrl: `https://git.example.com/pr/${overrides.number}`,
    jobsStatus: "unknown",
    ...overrides,
  };
}

suite("promotionBranchUtils", () => {
  test("enablePromotionBranches is a setting of the Danger Zone, at project and branch level", () => {
    const field = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.find(
      (entry) => entry.name === "enablePromotionBranches",
    );
    assert.ok(field, "enablePromotionBranches must be a configurable field");
    // Project level only: sfdx-hardis reads the merged config of the branch a job runs on, so a
    // switch set in a single branch file would not apply to the other branches nor to the command
    assert.deepStrictEqual(field!.scopes, ["global"]);
    const section = SfdxHardisConfigHelper.SECTIONS.find(
      (entry) => entry.label === "dangerZone",
    );
    assert.ok(section, "a Danger Zone section must exist");
    assert.ok(
      section!.keys.includes("enablePromotionBranches"),
      "the Danger Zone must hold enablePromotionBranches",
    );
    // The bundled schema must know the property, so the panel shows it even while the schema
    // published by sfdx-hardis main does not have it yet
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../resources/sfdx-hardis.jsonschema.json",
        ),
        "utf8",
      ),
    );
    assert.strictEqual(
      schema.properties.enablePromotionBranches?.type,
      "boolean",
    );
  });

  test("allowedPromotionSteps is a Danger Zone setting of the project scope", () => {
    const field = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.find(
      (entry) => entry.name === "allowedPromotionSteps",
    );
    assert.ok(field, "allowedPromotionSteps must be a configurable field");
    // Same reason as enablePromotionBranches: hardis:project:promotion:create runs from any
    // branch, so a restriction written in one branch file would not be seen
    assert.deepStrictEqual(field!.scopes, ["global"]);
    const section = SfdxHardisConfigHelper.SECTIONS.find(
      (entry) => entry.label === "dangerZone",
    );
    assert.ok(
      section!.keys.includes("allowedPromotionSteps"),
      "the Danger Zone must hold allowedPromotionSteps",
    );
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../resources/sfdx-hardis.jsonschema.json",
        ),
        "utf8",
      ),
    );
    // An array of objects: the settings panel builds its add/edit form from items.properties
    assert.strictEqual(schema.properties.allowedPromotionSteps?.type, "array");
    assert.strictEqual(
      schema.properties.allowedPromotionSteps?.items?.properties?.source?.type,
      "string",
    );
    assert.strictEqual(
      schema.properties.allowedPromotionSteps?.items?.properties?.target?.type,
      "string",
    );
  });

  test("the allowed promotion steps are read from the project config", () => {
    const config = getPromotionBranchConfig([
      {
        enablePromotionBranches: true,
        allowedPromotionSteps: [{ source: "uat", target: "preprod" }],
      },
    ]);
    assert.strictEqual(config.enabled, true);
    assert.deepStrictEqual(config.allowedSteps, [
      { source: "uat", target: "preprod" },
    ]);
  });

  // hardis:project:promotion:create refuses to run without the list. The pipeline keeps drawing
  // and listing whatever the project has, so a repository being configured is still readable.
  test("an absent list is no restriction for the pipeline", () => {
    const config = getPromotionBranchConfig([
      { enablePromotionBranches: true },
    ]);
    assert.deepStrictEqual(config.allowedSteps, []);
    assert.strictEqual(isPromotionStepAllowed([], "integration", "uat"), true);
    assert.strictEqual(isPromotionSourceAllowed([], "integration"), true);
  });

  test("a step restricts both the source and the target, whatever the case", () => {
    const steps = parsePromotionSteps([{ source: "UAT", target: "PreProd" }]);
    assert.strictEqual(isPromotionSourceAllowed(steps, "uat"), true);
    assert.strictEqual(isPromotionSourceAllowed(steps, "integration"), false);
    assert.strictEqual(isPromotionStepAllowed(steps, "uat", "preprod"), true);
    assert.strictEqual(isPromotionStepAllowed(steps, "uat", "main"), false);
    assert.deepStrictEqual(
      allowedPromotionTargetBranches(steps, "uat", ["preprod", "main"]),
      ["preprod"],
    );
  });

  test("an entry without a target allows every target of that branch", () => {
    const steps = parsePromotionSteps(["uat"]);
    assert.deepStrictEqual(steps, [{ source: "uat", target: "" }]);
    assert.strictEqual(isPromotionStepAllowed(steps, "uat", "main"), true);
    assert.strictEqual(isPromotionStepAllowed(steps, "preprod", "main"), false);
  });

  // The DevOps Pipeline modal cannot be instantiated in the extension test host, so the three
  // members that decide whether a promotion can start from a branch are lifted out of the
  // component source and run for real.
  function promotionGate(pipelineData: any): any {
    const js = readModuleFile("pipeline", "pipeline.js");
    const member = (signature: string) => extractMember(js, signature);
    const gate = new Function(
      `return {
        ${member("get _promotionAllowedSteps()")},
        ${member("_isPromotionSourceAllowed(branchName)")},
        ${member("_mergeTargetsOf(branchName)")},
        ${member("_allowedPromotionTargets(branchName)")}
      };`,
    )();
    gate.pipelineData = pipelineData;
    return gate;
  }

  const PIPELINE_LINKS = [
    { source: "integration", target: "uat", type: "gitMerge" },
    { source: "uat", target: "preprod", type: "gitMerge" },
    { source: "preprod", target: "main", type: "gitMerge" },
  ];

  test("a promotion can only start from a branch the allowed steps name", () => {
    const gate = promotionGate({
      links: PIPELINE_LINKS,
      promotionBranches: {
        enabled: true,
        allowedSteps: [{ source: "uat", target: "preprod" }],
      },
    });
    // showCreatePromotionButton ends with this call, and modalHideCheckboxColumn is its
    // negation: a branch that answers false gets neither the button nor the checkboxes
    assert.strictEqual(gate._isPromotionSourceAllowed("uat"), true);
    assert.strictEqual(gate._isPromotionSourceAllowed("integration"), false);
    assert.strictEqual(gate._isPromotionSourceAllowed("preprod"), false);
    // One allowed target: the command is called with it instead of asking
    assert.deepStrictEqual(gate._allowedPromotionTargets("uat"), ["preprod"]);
  });

  test("a step whose target is not a merge target of its source opens nothing", () => {
    const gate = promotionGate({
      links: PIPELINE_LINKS,
      promotionBranches: {
        enabled: true,
        allowedSteps: [{ source: "uat", target: "main" }],
      },
    });
    // hardis:project:promotion:create could not resolve that target either, so the branch
    // window must not offer a promotion that ends in an error
    assert.strictEqual(gate._isPromotionSourceAllowed("uat"), false);
  });

  test("a step without a target allows the branch, whatever its merge targets", () => {
    const gate = promotionGate({
      links: PIPELINE_LINKS,
      promotionBranches: {
        enabled: true,
        allowedSteps: [{ source: "integration", target: "" }],
      },
    });
    assert.strictEqual(gate._isPromotionSourceAllowed("integration"), true);
    assert.strictEqual(gate._isPromotionSourceAllowed("uat"), false);
    // Nothing to pass: the command asks between the merge targets it is allowed to use
    assert.deepStrictEqual(gate._allowedPromotionTargets("integration"), []);
  });

  test("the checkboxes of the branch window follow the promotion button", () => {
    const js = readModuleFile("pipeline", "pipeline.js");
    const getter = js.slice(js.indexOf("get modalHideCheckboxColumn()"));
    assert.ok(
      getter
        .slice(0, getter.indexOf("}"))
        .includes("return !this.showCreatePromotionButton;"),
      "the checkbox column must be hidden exactly when the promotion button is",
    );
    const button = js.slice(js.indexOf("get showCreatePromotionButton()"));
    assert.ok(
      button
        .slice(0, button.indexOf("\n  }"))
        .includes("this._isPromotionSourceAllowed(this.modalBranchName)"),
      "the promotion button must ask the allowed steps about the branch",
    );
  });

  test("the branch window table survives the promotion checkbox column", () => {
    const js = readModuleFile("pipeline", "pipeline.js");
    const view = new Function(
      `return {
        ${extractMember(js, "get modalPrColumns()")},
        ${extractMember(js, "get modalHasPromotionColumn()")},
        ${extractMember(js, "get modalHasMergeConflictColumn()")},
        ${extractMember(js, "_authorColumn()")}
      };`,
    )();
    view.modalPullRequests = [{ number: 1 }];
    view.showJobStatusColumn = false;
    view.i18n = new Proxy({}, { get: (_target, key) => String(key) });
    const columns = view.modalPrColumns;
    // The checkbox column takes its width from the others. Only the last column may be left
    // without one: any other column with no width collapses to nothing once the checkboxes
    // are shown, which is how the author column became an unreadable sliver
    const flexible = columns
      .filter((column: any) => !column.initialWidth)
      .map((column: any) => column.key);
    assert.deepStrictEqual(flexible, [columns[columns.length - 1].key]);
    // With promotion labels, the promotion column comes last, and every column keeps a width:
    // the table scrolls rather than squeezing a column
    view.modalPullRequests = [
      {
        number: 1,
        promotionLabel: "Already deployed via promotion/uat/preprod",
      },
    ];
    const withPromotion = view.modalPrColumns;
    assert.strictEqual(
      withPromotion[withPromotion.length - 1].key,
      "promotion",
    );
    assert.deepStrictEqual(
      withPromotion
        .filter((column: any) => !column.initialWidth)
        .map((column: any) => column.key),
      [],
    );
    const author = columns.find((column: any) => column.key === "author");
    assert.ok(
      author && author.initialWidth >= 150,
      "the author column needs room for the avatar and the name",
    );
  });

  test("the modal footer lays its actions out as a wrapping row", () => {
    const html = readModuleFile("pipeline", "pipeline.html");
    const css = readModuleFile("pipeline", "pipeline.css");
    const footer = html.slice(html.indexOf("slds-modal__footer"));
    const footerMarkup = footer.slice(0, footer.indexOf("</footer>"));
    assert.ok(
      footerMarkup.includes("hardis-modal-footer"),
      "the footer must carry its layout class",
    );
    // The inline flex style used to sit next to inline-block buttons: the third action wrapped
    // under the others and pushed Close out of its corner
    assert.ok(
      !footerMarkup.includes("style="),
      "the footer layout belongs to the stylesheet, not to an inline style",
    );
    assert.ok(
      !footerMarkup.includes("slds-m-right_small hardis-btn") &&
        !footerMarkup.includes("slds-m-left_small hardis-btn"),
      "the flex gap replaces the per-button margins",
    );
    const rule = css.slice(css.indexOf(".hardis-modal-footer {"));
    assert.ok(
      rule.slice(0, rule.indexOf("}")).includes("flex-wrap: wrap"),
      "the footer must wrap as a whole rather than let its buttons wrap",
    );
    assert.ok(
      css.includes(".hardis-modal-footer-actions"),
      "the actions of the left side need their own row",
    );
  });

  test("a Pull Request closed with a merge date counts as merged (GitHub)", () => {
    // GitHub only returns open/closed, the merge date is what says a Pull Request was merged
    assert.strictEqual(
      isMergedPullRequest(
        pr({ number: 1, state: "closed", mergeDate: "2026-09-05T10:00:00Z" }),
      ),
      true,
    );
    assert.strictEqual(
      isMergedPullRequest(
        pr({ number: 2, state: "closed", mergeDate: undefined }),
      ),
      false,
    );
    // A story declared by a promotion is carried even when its state is only "closed"
    const promotion = pr({
      number: 900,
      sourceBranch: PROMOTION_BRANCH,
      targetBranch: "preprod",
      description: DECLARATION,
    });
    const known = new Map<number, PullRequest>([
      [
        482,
        pr({ number: 482, state: "closed", mergeDate: "2026-09-05T10:00:00Z" }),
      ],
      [
        487,
        pr({ number: 487, state: "closed", mergeDate: "2026-09-05T11:00:00Z" }),
      ],
    ]);
    return expandPullRequestsWithPromotions(
      [promotion],
      ENABLED,
      known,
      async () => null,
    ).then(({ added }) => {
      assert.deepStrictEqual(
        added.map((story) => story.number),
        [482, 487],
      );
    });
  });

  test("reads the switch from the project config or any branch config", () => {
    assert.deepStrictEqual(getPromotionBranchConfig([{}]), {
      enabled: false,
      allowedSteps: [],
    });
    assert.deepStrictEqual(
      getPromotionBranchConfig([{}, { enablePromotionBranches: true }]),
      { enabled: true, allowedSteps: [] },
    );
    assert.strictEqual(
      getPromotionBranchConfig([{ enablePromotionBranches: "true" }]).enabled,
      false,
    );
  });

  test("parses promotion/<source>/<target>/<YYYY-MM-DD>-<HHMM>, the <YYYY-MM-DD>-<counter> names of the first releases, and nothing else", () => {
    assert.deepStrictEqual(
      parsePromotionBranchName("promotion/uat/preprod/2026-09-06-1430"),
      {
        sourceBranch: "uat",
        targetBranch: "preprod",
        date: "2026-09-06",
        time: "1430",
        counter: 1,
      },
    );
    assert.deepStrictEqual(
      parsePromotionBranchName("promotion/uat/preprod/2026-09-06-0005-2"),
      {
        sourceBranch: "uat",
        targetBranch: "preprod",
        date: "2026-09-06",
        time: "0005",
        counter: 2,
      },
    );
    // A counter only follows a real time of day
    assert.strictEqual(
      isPromotionBranchName("promotion/uat/preprod/2026-09-06-2460-2"),
      false,
    );
    // Promotions of the first releases can still be open or waiting in a branch
    assert.deepStrictEqual(parsePromotionBranchName(PROMOTION_BRANCH), {
      sourceBranch: "uat",
      targetBranch: "preprod",
      date: "2026-09-06",
      time: null,
      counter: 1,
    });
    assert.strictEqual(
      isPromotionBranchName("Promotion/UAT/main/2026-12-31-12"),
      true,
    );
    for (const name of [
      "promotion/2026-09",
      "promotion/uat/preprod",
      "promotion/uat/preprod/2026-09-06",
      "promotion/uat/preprod/20260906-1",
      "feature/promotion/uat/preprod/2026-09-06-1",
      "promotion-notes",
      "",
      undefined,
    ]) {
      assert.strictEqual(isPromotionBranchName(name), false, String(name));
    }
  });

  test("parses the declared Pull Request numbers", () => {
    assert.strictEqual(parsePromotionPullRequestIds(""), null);
    assert.strictEqual(parsePromotionPullRequestIds(null), null);
    assert.deepStrictEqual(
      parsePromotionPullRequestIds("```yaml\npromotionPullRequests: []\n```"),
      [],
    );
    assert.deepStrictEqual(
      parsePromotionPullRequestIds(
        '```yaml\npromotionPullRequests:\n  - 482\n  - "#487"\n  - "!491"\n  - 482\n  - nonsense\n```',
      ),
      [482, 487, 491],
    );
    // Any yaml block of the description, not only the first
    assert.deepStrictEqual(
      parsePromotionPullRequestIds(
        "```yaml\ndeploymentApexTestClasses: [A]\n```\ntext\n```yml\npromotionPullRequests: [12]\n```",
      ),
      [12],
    );
  });

  test("needs the flag, the naming convention and the key", () => {
    assert.strictEqual(
      isPromotionPullRequest(
        pr({
          number: 9,
          sourceBranch: PROMOTION_BRANCH,
          description: DECLARATION,
        }),
        ENABLED,
      ),
      true,
    );
    assert.strictEqual(
      isPromotionPullRequest(
        pr({ number: 9, sourceBranch: PROMOTION_BRANCH, description: "none" }),
        ENABLED,
      ),
      false,
    );
    // Named by hand: not a promotion branch even with the key
    assert.strictEqual(
      isPromotionPullRequest(
        pr({
          number: 9,
          sourceBranch: "promotion/2026-09",
          description: DECLARATION,
        }),
        ENABLED,
      ),
      false,
    );
    assert.strictEqual(
      isPromotionPullRequest(
        pr({ number: 9, sourceBranch: "feature/x", description: DECLARATION }),
        ENABLED,
      ),
      false,
    );
    assert.strictEqual(
      isPromotionPullRequest(
        pr({
          number: 9,
          sourceBranch: PROMOTION_BRANCH,
          description: DECLARATION,
        }),
        DISABLED,
      ),
      false,
    );
  });

  test("expands a window with the declared stories, one level, merged only", async () => {
    const promotion = pr({
      number: 900,
      sourceBranch: PROMOTION_BRANCH,
      targetBranch: "preprod",
      description: DECLARATION,
    });
    const known = new Map<number, PullRequest>([[482, pr({ number: 482 })]]);
    const fetched: number[] = [];
    const { all, added } = await expandPullRequestsWithPromotions(
      [promotion, pr({ number: 901, sourceBranch: "feature/other" })],
      ENABLED,
      known,
      async (number) => {
        fetched.push(number);
        return number === 487 ? pr({ number: 487, state: "open" }) : null;
      },
    );
    // 482 comes from the loaded windows, 487 is fetched but open, so skipped
    assert.deepStrictEqual(
      all.map((entry) => entry.number),
      [900, 901, 482],
    );
    assert.deepStrictEqual(fetched, [487]);
    assert.strictEqual(added.length, 1);
    assert.deepStrictEqual(added[0].carriedByPullRequest, {
      number: 900,
      sourceBranch: PROMOTION_BRANCH,
      webUrl: promotion.webUrl,
    });
    assert.strictEqual(promotion.isPromotion, true);
    assert.deepStrictEqual(promotion.promotionPullRequests, [482, 487]);
  });

  test("changes nothing when the feature is disabled", async () => {
    const window = [
      pr({
        number: 900,
        sourceBranch: PROMOTION_BRANCH,
        description: DECLARATION,
      }),
    ];
    let fetchCalls = 0;
    const { all, added } = await expandPullRequestsWithPromotions(
      window,
      DISABLED,
      new Map(),
      async () => {
        fetchCalls++;
        return null;
      },
    );
    assert.deepStrictEqual(all, window);
    assert.strictEqual(added.length, 0);
    assert.strictEqual(fetchCalls, 0);
    assert.strictEqual(window[0].isPromotion, undefined);
  });

  test("only a merged promotion named for the step proves its stories left", () => {
    const merged = pr({
      number: 900,
      sourceBranch: "promotion/uat/preprod/2026-09-06-1430",
      targetBranch: "preprod",
      description: DECLARATION,
    });
    assert.strictEqual(
      isMergedPromotionOfStep(merged, "uat", "preprod", ENABLED),
      true,
    );
    assert.strictEqual(
      isMergedPromotionOfStep(merged, "UAT", "Preprod", ENABLED),
      true,
    );
    // Still open: its stories are waiting in uat
    assert.strictEqual(
      isMergedPromotionOfStep(
        { ...merged, state: "open" },
        "uat",
        "preprod",
        ENABLED,
      ),
      false,
    );
    // Another step, no declaration, feature off
    assert.strictEqual(
      isMergedPromotionOfStep(merged, "integration", "uat", ENABLED),
      false,
    );
    assert.strictEqual(
      isMergedPromotionOfStep(
        { ...merged, description: "no block" },
        "uat",
        "preprod",
        ENABLED,
      ),
      false,
    );
    assert.strictEqual(
      isMergedPromotionOfStep(merged, "uat", "preprod", DISABLED),
      false,
    );
    assert.strictEqual(
      isPromotionBranchOfStep(
        "promotion/uat/preprod/2026-09-06-1",
        "uat",
        "preprod",
      ),
      true,
    );
    assert.strictEqual(
      isPromotionBranchOfStep(
        "promotion/uat/preprod-2/2026-09-06-1",
        "uat",
        "preprod",
      ),
      false,
    );
  });

  test("a story leaves uat once its promotion is merged, even when no window holds the promotion any more", async () => {
    // Real case (sfdx-hardis #2260): uat is only promoted through promotion branches, and preprod
    // went to production since. The promotion is in no window, the uat window never resets, and
    // its stories were counted as waiting in uat forever.
    const merged = pr({
      number: 900,
      sourceBranch: "promotion/uat/preprod/2026-09-14-0900",
      targetBranch: "preprod",
      description: DECLARATION,
      mergeDate: "2026-09-14T10:00:00Z",
    });
    const stillOpen = pr({
      number: 901,
      sourceBranch: "promotion/uat/preprod/2026-09-20-0900",
      targetBranch: "preprod",
      description: "```yaml\npromotionPullRequests: [490]\n```",
      state: "open",
    });
    const uatWindow = [
      pr({ number: 482, mergeDate: "2026-09-10T10:00:00Z" }),
      pr({ number: 487, mergeDate: "2026-09-05T10:00:00Z" }),
      pr({ number: 490, mergeDate: "2026-09-12T10:00:00Z" }),
      pr({ number: 495, mergeDate: "2026-09-13T10:00:00Z" }),
    ];
    const calls: any[] = [];
    const { promotions, unknownSteps, incompleteSteps } =
      await listMergedPromotionsOfSteps(
        [
          {
            sourceBranch: "uat",
            targetBranch: "preprod",
            pullRequests: uatWindow,
          },
          // An empty window and a branch without merge target are not asked about
          {
            sourceBranch: "integration",
            targetBranch: "uat",
            pullRequests: [],
          },
          {
            sourceBranch: "main",
            targetBranch: "",
            pullRequests: [pr({ number: 1 })],
          },
        ],
        ENABLED,
        async (sourceBranch, targetBranch, updatedAfter) => {
          calls.push([sourceBranch, targetBranch, updatedAfter?.toISOString()]);
          // Given twice, as when a window and the provider both know it: it counts once
          return { pullRequests: [merged, stillOpen, merged], complete: true };
        },
      );
    // One query, bounded by the oldest date of the window
    assert.deepStrictEqual(calls, [
      ["uat", "preprod", "2026-09-05T10:00:00.000Z"],
    ]);

    // Bitbucket gives the last update as merge date: a comment written on a story after its
    // promotion was merged must not push the bound past that promotion
    const commentedLater: any[] = [];
    await listMergedPromotionsOfSteps(
      [
        {
          sourceBranch: "uat",
          targetBranch: "preprod",
          pullRequests: [
            pr({
              number: 482,
              createdAt: "2026-09-01T08:00:00Z",
              mergeDate: "2026-09-25T10:00:00Z",
            }),
          ],
        },
      ],
      ENABLED,
      async (_sourceBranch, _targetBranch, updatedAfter) => {
        commentedLater.push(updatedAfter?.toISOString());
        return { pullRequests: [], complete: true };
      },
    );
    assert.deepStrictEqual(commentedLater, ["2026-09-01T08:00:00.000Z"]);
    assert.deepStrictEqual(unknownSteps, []);
    assert.deepStrictEqual(incompleteSteps, []);
    // The open promotion is left out. The merged one is kept as many times as it was given: the
    // index is what makes it count once.
    assert.deepStrictEqual(
      promotions.map((promotion) => promotion.number),
      [900, 900],
    );
    assert.deepStrictEqual(
      findPromotionsCarrying(482, buildPromotionIndex(promotions, ENABLED)).map(
        (promotion) => promotion.number,
      ),
      [900],
    );

    annotateAlreadyPromoted(
      uatWindow,
      "uat",
      buildPromotionIndex(promotions, ENABLED),
      ENABLED,
    );
    // 482 and 487 left with the merged promotion; 490 is carried by a promotion still open and
    // 495 by none, so both are still waiting in uat
    assert.deepStrictEqual(
      visiblePullRequests(uatWindow).map((story) => story.number),
      [490, 495],
    );
  });

  test("a provider that cannot list the promotions hides nothing, and says which step", async () => {
    const window = [pr({ number: 482 })];
    const steps = [
      { sourceBranch: "uat", targetBranch: "preprod", pullRequests: window },
    ];
    const unanswered = await listMergedPromotionsOfSteps(
      steps,
      ENABLED,
      async () => null,
    );
    assert.deepStrictEqual(unanswered, {
      promotions: [],
      unknownSteps: ["uat -> preprod"],
      incompleteSteps: [],
    });
    const failing = await listMergedPromotionsOfSteps(
      steps,
      ENABLED,
      async () => {
        throw new Error("rate limited");
      },
    );
    assert.deepStrictEqual(failing.unknownSteps, ["uat -> preprod"]);
    // Feature off: the provider is not even asked
    let asked = false;
    await listMergedPromotionsOfSteps(steps, DISABLED, async () => {
      asked = true;
      return { pullRequests: [], complete: true };
    });
    assert.strictEqual(asked, false);
  });

  test("a promotion listing cut at a page limit is used, and its step is reported", async () => {
    const merged = pr({
      number: 900,
      sourceBranch: "promotion/uat/preprod/2026-09-14-0900",
      targetBranch: "preprod",
      description: DECLARATION,
      mergeDate: "2026-09-14T10:00:00Z",
    });
    const answer = await listMergedPromotionsOfSteps(
      [
        {
          sourceBranch: "uat",
          targetBranch: "preprod",
          pullRequests: [pr({ number: 482 })],
        },
        {
          sourceBranch: "integration",
          targetBranch: "uat",
          pullRequests: [pr({ number: 482 })],
        },
      ],
      ENABLED,
      async (sourceBranch) =>
        sourceBranch === "uat"
          ? { pullRequests: [merged], complete: false }
          : { pullRequests: [], complete: true },
    );
    // What was found stays valid: the story still leaves uat
    assert.deepStrictEqual(
      answer.promotions.map((promotion) => promotion.number),
      [900],
    );
    assert.deepStrictEqual(answer.incompleteSteps, ["uat -> preprod"]);
    assert.deepStrictEqual(answer.unknownSteps, []);
  });

  test("flags the stories already shipped by a merged promotion Pull Request", () => {
    const merged = pr({
      number: 900,
      sourceBranch: PROMOTION_BRANCH,
      targetBranch: "preprod",
      description: DECLARATION,
      mergeDate: "2026-09-02T09:00:00Z",
    });
    const open = pr({
      number: 901,
      sourceBranch: "promotion/uat/preprod/2026-09-06-2",
      description: DECLARATION,
      state: "open",
    });
    // The descriptions are parsed once, whatever the number of stories to annotate
    const index = buildPromotionIndex([merged, open], ENABLED);
    assert.deepStrictEqual(
      findPromotionsCarrying(482, index).map((p) => p.number),
      [900],
    );
    assert.deepStrictEqual(
      findPromotionsCarrying(482, buildPromotionIndex([merged], DISABLED)),
      [],
    );

    const window = [pr({ number: 482 }), pr({ number: 3 })];
    annotateAlreadyPromoted(window, "uat", index, ENABLED);
    assert.deepStrictEqual(window[0].alreadyDeployedVia, [
      {
        number: 900,
        sourceBranch: PROMOTION_BRANCH,
        targetBranch: "preprod",
        webUrl: merged.webUrl,
        mergeDate: "2026-09-02T09:00:00Z",
      },
    ]);
    assert.strictEqual(window[1].alreadyDeployedVia, undefined);
  });

  test("only the Pull Requests that move other Pull Requests are left out", () => {
    const majors = ["integ", "uat", "preprod", "main"];
    const story = pr({
      number: 5,
      sourceBranch: "feature/x",
      targetBranch: "uat",
    });
    const fix = pr({
      number: 20,
      sourceBranch: "fix/PROJ-9",
      targetBranch: "uat",
    });
    // A retrofit brings the RUN stream back into the BUILD stream: that is work the reader wants
    // to see, like any feature or fix branch
    const retrofit = pr({
      number: 10,
      sourceBranch: "retrofit/from-main",
      targetBranch: "integ",
    });
    const majorToMajor = pr({
      number: 16,
      sourceBranch: "uat",
      targetBranch: "preprod",
    });
    const promotion = pr({
      number: 7,
      sourceBranch: "promotion/integ/uat/2026-09-06-1",
      targetBranch: "uat",
      description: DECLARATION,
    });
    const all = [story, fix, retrofit, majorToMajor, promotion];

    assert.strictEqual(isMajorToMajorPullRequest(majorToMajor, majors), true);
    assert.strictEqual(isMajorToMajorPullRequest(story, majors), false);

    assert.deepStrictEqual(
      userStoryPullRequests(all, majors, ENABLED).map((p) => p.number),
      [5, 20, 10],
    );
    assert.deepStrictEqual(
      userStoryPullRequests(all, majors, ENABLED, true).map((p) => p.number),
      [5, 20, 10, 16, 7],
    );

    // A merge between two major branches is plumbing in every pipeline, so it is left out even
    // for a project that never enabled promotion branches. The promotion/ branch is an ordinary
    // branch there, exactly as the deployment jobs treat it.
    assert.deepStrictEqual(
      userStoryPullRequests(all, majors, DISABLED).map((p) => p.number),
      [5, 20, 10, 7],
    );
    assert.strictEqual(
      isVehiclePullRequest(majorToMajor, majors, DISABLED),
      true,
    );
    assert.strictEqual(
      isVehiclePullRequest(promotion, majors, DISABLED),
      false,
    );
    assert.strictEqual(isVehiclePullRequest(promotion, majors, ENABLED), true);
    assert.strictEqual(isVehiclePullRequest(retrofit, majors, ENABLED), false);
  });

  // What expandPullRequestsWithPromotions leaves in the window a promotion was merged into
  const carriedBy = (number: number, promotionBranch: string): PullRequest => ({
    ...pr({ number }),
    carriedByPullRequest: {
      number: 900,
      sourceBranch: promotionBranch,
      webUrl: "https://git.example.com/pr/900",
    },
  });

  test("a story carried by a promotion is hidden in the branch it left and shown in the one it reached", () => {
    const integrationWindow = [pr({ number: 482 }), pr({ number: 500 })];
    const uatWindow = [
      carriedBy(482, "promotion/integration/uat/2026-09-06-1430"),
      pr({ number: 600 }),
    ];
    // Downstream first, as listMajorOrgs hands the windows over: the order does not matter
    enforceSinglePlacePerPullRequest(
      [
        { branchName: "uat", pullRequests: uatWindow },
        { branchName: "integration", pullRequests: integrationWindow },
      ],
      ENABLED,
    );
    assert.deepStrictEqual(
      visiblePullRequests(integrationWindow).map((story) => story.number),
      [500],
    );
    assert.deepStrictEqual(
      visiblePullRequests(uatWindow).map((story) => story.number),
      [482, 600],
    );
    // Nothing happens for a project that did not enable the feature
    const off = [pr({ number: 482 })];
    enforceSinglePlacePerPullRequest(
      [
        { branchName: "integration", pullRequests: off },
        {
          branchName: "uat",
          pullRequests: [
            carriedBy(482, "promotion/integration/uat/2026-09-06-1430"),
          ],
        },
      ],
      DISABLED,
    );
    assert.strictEqual(off[0].promotedAway, undefined);
  });

  test("a retrofitted hotfix stays visible in main and in integration", () => {
    // Merged into main, then brought back into integration by a retrofit: it is in production, and
    // it still has to travel from integration to uat. No promotion carried it, so the same number
    // in two windows hides nothing.
    const hotfixInMain = pr({
      number: 700,
      sourceBranch: "hotfix/PROJ-12",
      targetBranch: "main",
    });
    const hotfixInIntegration = pr({
      number: 700,
      sourceBranch: "hotfix/PROJ-12",
      targetBranch: "main",
    });
    const mainWindow = [hotfixInMain];
    const integrationWindow = [hotfixInIntegration, pr({ number: 500 })];
    enforceSinglePlacePerPullRequest(
      [
        { branchName: "integration", pullRequests: integrationWindow },
        { branchName: "uat", pullRequests: [] },
        { branchName: "preprod", pullRequests: [] },
        { branchName: "main", pullRequests: mainWindow },
      ],
      ENABLED,
    );
    assert.deepStrictEqual(
      visiblePullRequests(integrationWindow).map((story) => story.number),
      [700, 500],
    );
    assert.deepStrictEqual(
      visiblePullRequests(mainWindow).map((story) => story.number),
      [700],
    );
    // The promotion index agrees: no promotion declares the hotfix
    annotateAlreadyPromoted(
      integrationWindow,
      "integration",
      buildPromotionIndex([], ENABLED),
      ENABLED,
    );
    assert.notStrictEqual(hotfixInIntegration.promotedAway, true);
  });

  test("a story carried from integration to uat then from uat to preprod is shown in preprod only", () => {
    const integrationWindow = [pr({ number: 482 })];
    const uatWindow = [
      carriedBy(482, "promotion/integration/uat/2026-09-06-1430"),
    ];
    const preprodWindow = [
      carriedBy(482, "promotion/uat/preprod/2026-09-10-0900"),
    ];
    const windows = [
      { branchName: "integration", pullRequests: integrationWindow },
      { branchName: "uat", pullRequests: uatWindow },
      { branchName: "preprod", pullRequests: preprodWindow },
    ];
    enforceSinglePlacePerPullRequest(windows, ENABLED);
    assert.deepStrictEqual(
      windows.map((window) => visiblePullRequests(window.pullRequests).length),
      [0, 0, 1],
    );

    // Same answer from the promotion index alone, which is what decides once the go-live of
    // preprod has taken both promotions out of the windows
    const fromIntegration = pr({
      number: 900,
      sourceBranch: "promotion/integration/uat/2026-09-06-1430",
      targetBranch: "uat",
      description: DECLARATION,
    });
    const fromUat = pr({
      number: 901,
      sourceBranch: "promotion/uat/preprod/2026-09-10-0900",
      targetBranch: "preprod",
      description: DECLARATION,
    });
    const index = buildPromotionIndex([fromIntegration, fromUat], ENABLED);
    const byIndex = [
      { branchName: "integration", pullRequests: [pr({ number: 482 })] },
      { branchName: "uat", pullRequests: [pr({ number: 482 })] },
      { branchName: "preprod", pullRequests: [pr({ number: 482 })] },
    ];
    for (const window of byIndex) {
      annotateAlreadyPromoted(
        window.pullRequests,
        window.branchName,
        index,
        ENABLED,
      );
    }
    assert.deepStrictEqual(
      byIndex.map((window) => visiblePullRequests(window.pullRequests).length),
      [0, 0, 1],
    );
  });

  test("a promotion declaring another promotion by hand still reaches the User Stories", () => {
    // A promotion carries User Stories only, and hardis:project:promotion:create never declares
    // another promotion. A description edited by hand could: the expansion follows it down.
    const inner = pr({
      number: 900,
      sourceBranch: "promotion/uat/preprod/2026-09-06-1",
      targetBranch: "preprod",
      description: DECLARATION,
    });
    const outer = pr({
      number: 901,
      sourceBranch: "promotion/preprod/main/2026-09-10-1",
      targetBranch: "main",
      description: ["```yaml", "promotionPullRequests: [900]", "```"].join(
        "\n",
      ),
    });
    const known = new Map<number, PullRequest>([
      [900, inner],
      [482, pr({ number: 482 })],
      [487, pr({ number: 487 })],
    ]);
    return expandPullRequestsWithPromotions(
      [outer],
      ENABLED,
      known,
      async () => null,
    ).then(({ all }) => {
      assert.deepStrictEqual(
        all.map((p) => p.number),
        [901, 900, 482, 487],
      );
    });
  });

  test("the go-live list of a top branch goes through the same toggles as the branch window", () => {
    const js = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/webviews/lwc-ui/modules/s/pipeline/pipeline.js",
      ),
      "utf8",
    );
    // Selecting a release in the Go Live combobox used to list its Pull Requests unfiltered, so a
    // preprod -> main merge showed up with "Show promotion Pull Requests" off
    const goLiveHandler = js.slice(js.indexOf("returnGoLivePullRequests"));
    assert.ok(
      js.includes(
        "this._filterModalPullRequests(this.modalSourcePullRequests)",
      ),
      "the toggle handler must re-filter the current source list",
    );
    assert.ok(
      goLiveHandler.includes(
        "this.modalSourcePullRequests = data?.pullRequests || []",
      ),
      "the go-live result must become the source list of the modal",
    );
    assert.strictEqual(
      (js.match(/_populateModalFromPrs\(data\?\.pullRequests/g) || []).length,
      0,
      "no list may feed the branch modal without the toggles",
    );
  });

  test("a story a promotion carried away is listed in the branch it reached", () => {
    // promotion/uat/preprod carries 482 out of uat, so 482 is listed in preprod, not in uat
    const promotion = pr({
      number: 900,
      sourceBranch: PROMOTION_BRANCH,
      targetBranch: "preprod",
      description: DECLARATION,
      mergeDate: "2026-09-02T09:00:00Z",
    });
    const index = buildPromotionIndex([promotion], ENABLED);

    const uatWindow = [pr({ number: 482 }), pr({ number: 500 })];
    annotateAlreadyPromoted(uatWindow, "uat", index, ENABLED);
    assert.deepStrictEqual(
      visiblePullRequests(uatWindow).map((p) => p.number),
      [500],
    );

    // The very promotion that carried it, and the story it brought, stay visible in preprod
    const preprodWindow = [promotion, pr({ number: 482 })];
    annotateAlreadyPromoted(preprodWindow, "preprod", index, ENABLED);
    assert.deepStrictEqual(
      visiblePullRequests(preprodWindow).map((p) => p.number),
      [900, 482],
    );
  });
});

suite("An open promotion is drawn on the edge between its two branches", () => {
  const BRANCHES_AND_ORGS = [
    { branchName: "uat", level: 2, mergeTargets: ["preprod"], instanceUrl: "" },
    {
      branchName: "preprod",
      level: 1,
      mergeTargets: ["main"],
      instanceUrl: "",
    },
    { branchName: "main", level: 0, mergeTargets: [], instanceUrl: "" },
  ];

  function openPr(
    number: number,
    sourceBranch: string,
    targetBranch: string,
  ): PullRequest {
    return {
      id: number,
      number: number,
      title: `PR ${number}`,
      description: "",
      sourceBranch: sourceBranch,
      targetBranch: targetBranch,
      authorLabel: "someone",
      state: "open",
      webUrl: `https://git.example.com/pr/${number}`,
      jobsStatus: "success",
      createdAt: "2026-09-06T10:00:00Z",
    };
  }

  function diagram(pullRequests: PullRequest[], enabled: boolean): string {
    const builder = new BranchStrategyMermaidBuilder(
      BRANCHES_AND_ORGS,
      true,
      pullRequests,
      null,
      "light",
      3,
      { enabled: enabled, allowedSteps: [] },
    );
    return builder.build({ format: "string", withMermaidTag: false }) as string;
  }

  test("the promotion sits on the uat to preprod edge, not on a node of its own", () => {
    const out = diagram(
      [openPr(41, "promotion/uat/preprod/2026-09-06-1", "preprod")],
      true,
    );
    const edge = out
      .split("\n")
      .find(
        (line) => line.includes("uatBranch ") && line.includes("preprodBranch"),
      );
    assert.ok(edge, "the uat to preprod edge must exist");
    assert.ok(
      edge!.includes("#41"),
      `the promotion belongs on the edge: ${edge}`,
    );
    assert.ok(
      !out.includes("promotion_uat_preprod"),
      "no feature node should be created for the promotion branch",
    );
  });

  test("with the feature off it stays an ordinary feature branch", () => {
    const out = diagram(
      [openPr(42, "promotion/uat/preprod/2026-09-06-1", "preprod")],
      false,
    );
    const edge = out
      .split("\n")
      .find(
        (line) => line.includes("uatBranch ") && line.includes("preprodBranch"),
      );
    assert.ok(!edge!.includes("#42"), `the edge must stay free: ${edge}`);
    assert.ok(
      out.includes("#42"),
      "the Pull Request is still drawn, as a feature branch",
    );
  });

  test("a promotion retargeted by hand is not put on any edge", () => {
    const out = diagram(
      [openPr(43, "promotion/uat/preprod/2026-09-06-1", "main")],
      true,
    );
    const uatToPreprod = out
      .split("\n")
      .find(
        (line) => line.includes("uatBranch ") && line.includes("preprodBranch"),
      );
    assert.ok(!uatToPreprod!.includes("#43"), `${uatToPreprod}`);
    const preprodToMain = out
      .split("\n")
      .find(
        (line) =>
          line.includes("preprodBranch ") && line.includes("mainBranch"),
      );
    assert.ok(!preprodToMain!.includes("#43"), `${preprodToMain}`);
  });

  test("a User Story targeting a major branch keeps its own node", () => {
    const out = diagram([openPr(44, "feature/PROJ-1", "preprod")], true);
    assert.ok(out.includes("feature_PROJ-1Branch"), out);
  });
});
