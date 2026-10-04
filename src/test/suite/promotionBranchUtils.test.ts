import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";
import {
  listMergedPromotionsOfSteps,
  orderWindowsUpstreamFirst,
} from "../../utils/orgConfigUtils";
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
  isMergedPullRequest,
  isVehiclePullRequest,
  isPromotionBranchName,
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

  test("the list of the branch window only ticks what can go in the next promotion", () => {
    const pipeline = readModuleFile("pipeline", "pipeline.js");
    const list = readModuleFile("pullRequestList", "pullRequestList.js");
    // s/pipeline marks each row, and takes back only the numbers it marked
    const window = Object.assign(
      new Function(
        `return {
          ${extractMember(pipeline, "get modalPrListRows()")},
          ${extractMember(pipeline, "handleModalPrSelect(event)")}
        };`,
      )(),
      {
        modalPullRequests: [
          { id: "a", number: 124 },
          { id: "b", number: 125, isVehicle: true },
          { id: "c", number: 122 },
        ],
        ["_isSelectableForPromotion"]: (pr: any) => pr.isVehicle !== true,
      },
    );
    const rows = window.modalPrListRows;
    assert.deepStrictEqual(
      rows.map((row: any) => row.selectable),
      [true, false, true],
    );
    // The same rows at each render, or every row would be drawn again
    assert.strictEqual(window.modalPrListRows, rows);
    window.handleModalPrSelect({ detail: { numbers: [124, 125] } });
    assert.deepStrictEqual(window.modalSelectedPrNumbers, [124]);
    assert.deepStrictEqual(window.modalSelectedPrIds, ["a"]);

    // s/pullRequestList: a checkbox on the rows that can be ticked only, and the checkbox above
    // the list acts on what the filter shows
    const sent: number[][] = [];
    const view = Object.assign(
      new Function(
        "safeWebUrl",
        "CustomEvent",
        `return {
          ${extractMember(list, "get rows()")},
          ${extractMember(list, "get _tickable()")},
          ${extractMember(list, "get allTicked()")},
          ${extractMember(list, "handleSelectAll(event)")},
          ${extractMember(list, "handleSelectRow(event)")},
          ${extractMember(list, "_select(numbers)")}
        };`,
      )(
        (value: string) => value || "",
        function (this: any, _name: string, init: any) {
          this.detail = init.detail;
        },
      ),
      {
        selectable: true,
        showStatus: false,
        filtered: rows,
        ["_selectedNumbers"]: [] as number[],
        t: (key: string) => key,
        dispatchEvent: (event: any) => sent.push(event.detail.numbers),
      },
    );
    assert.deepStrictEqual(
      view.rows.map((row: any) => [row.showCheckbox, row.showCheckboxGap]),
      [
        [true, false],
        [false, true],
        [true, false],
      ],
    );
    view.handleSelectAll({ target: { checked: true } });
    assert.deepStrictEqual(sent.pop(), [124, 122]);
    assert.strictEqual(view.allTicked, true);
    // The filter now shows #122 only: unticking what is shown keeps #124 ticked
    view.filtered = [rows[2]];
    view.handleSelectAll({ target: { checked: false } });
    assert.deepStrictEqual(sent.pop(), [124]);
    view.handleSelectRow({
      target: { checked: true, dataset: { prNumber: "122" } },
    });
    assert.deepStrictEqual(sent.pop(), [124, 122]);
    // Without the promotion button, no checkbox at all
    view.selectable = false;
    assert.deepStrictEqual(
      view.rows.map((row: any) => row.showCheckbox || row.showCheckboxGap),
      [false],
    );
  });

  test("merges and promotions are a filter of the list, with their count", () => {
    const pipeline = readModuleFile("pipeline", "pipeline.js");
    const html = readModuleFile("pipeline", "pipeline.html");
    const view = Object.assign(
      new Function(
        `return {
          ${extractMember(pipeline, "get modalVehicleCount()")},
          ${extractMember(pipeline, "handleToggleModalPromotionPrs(event)")}
        };`,
      )(),
      {
        modalMode: "branch",
        modalBranchName: "uat",
        modalSourcePullRequests: [
          { number: 1 },
          { number: 2, vehicle: true },
          { number: 3, vehicle: true, promotedAway: true },
        ],
        modalSelectedPrNumbers: [1],
        ["_isPromotionOrMajorPr"]: (pr: any) => pr.vehicle === true,
        ["_filterModalPullRequests"]: (prs: any[]) => prs,
        ["_populateModalFromPrs"]: () => undefined,
      },
    );
    // A vehicle a promotion took away is not in this window: it is not counted
    assert.strictEqual(view.modalVehicleCount, 1);
    view.handleToggleModalPromotionPrs({ detail: { shown: true } });
    assert.strictEqual(view.modalShowPromotionPrs, true);
    assert.deepStrictEqual(view.modalSelectedPrNumbers, []);
    view.handleToggleModalPromotionPrs({ detail: { shown: false } });
    assert.strictEqual(view.modalShowPromotionPrs, false);
    // One Pull Request of a window is not a branch window: no chip
    view.modalMode = "singlePR";
    assert.strictEqual(view.modalVehicleCount, 0);
    assert.match(
      html,
      /<s-pull-request-list[\s\S]*?pull-requests=\{modalPrListRows\}[\s\S]*?selectable=\{modalPrsSelectable\}[\s\S]*?vehicle-count=\{modalVehicleCount\}[\s\S]*?ontogglevehicles=\{handleToggleModalPromotionPrs\}/,
    );
    // The switch of the title bar is gone
    assert.doesNotMatch(html, /i18n\.showPromotionPrs\}/);
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

  test("a story is listed in one branch only, even after the promotion left its window", () => {
    // The index knows nothing here (no promotion in any loaded window), which is what happens once
    // a go-live resets the window the promotion was merged into
    const uatWindow = [pr({ number: 482 }), pr({ number: 500 })];
    const preprodWindow = [pr({ number: 482 }), pr({ number: 600 })];
    enforceSinglePlacePerPullRequest(
      [
        { branchName: "uat", pullRequests: uatWindow },
        { branchName: "preprod", pullRequests: preprodWindow },
      ],
      ENABLED,
    );
    // The downstream window wins: 482 stays in preprod and leaves uat
    assert.strictEqual(uatWindow[0].promotedAway, true);
    // Only the upstream copy is flagged: the others are left untouched
    assert.notStrictEqual(uatWindow[1].promotedAway, true);
    assert.notStrictEqual(preprodWindow[0].promotedAway, true);
    // Nothing happens for a project that did not enable the feature
    const off = [pr({ number: 482 })];
    enforceSinglePlacePerPullRequest(
      [
        { branchName: "uat", pullRequests: off },
        { branchName: "preprod", pullRequests: [pr({ number: 482 })] },
      ],
      DISABLED,
    );
    assert.strictEqual(off[0].promotedAway, undefined);
  });

  test("a promotion that left every window still takes its stories out of the branch it came from", async () => {
    // The repository of issue sfdx-hardis#2260: uat was last merged into preprod directly months
    // ago, the stories reach preprod through promotion branches only, and preprod has gone live
    // since. The promotion is in no loaded window any more (preprod's was reset by the go-live,
    // main shows the latest go-live only), yet the 63 stories it carried were still counted in uat.
    const carried = pr({ number: 482, createdAt: "2026-09-01T08:00:00Z" });
    const pending = pr({ number: 500, createdAt: "2026-09-20T08:00:00Z" });
    const promotion = pr({
      number: 900,
      sourceBranch: PROMOTION_BRANCH,
      targetBranch: "preprod",
      description: DECLARATION,
      mergeDate: "2026-09-14T09:00:00Z",
    });
    const otherStep = pr({
      number: 901,
      sourceBranch: "promotion/integration/uat/2026-09-14-1",
      targetBranch: "preprod",
      description: "```yaml\npromotionPullRequests: [500]\n```",
      mergeDate: "2026-09-14T09:00:00Z",
    });
    const calls: Array<{ target: string; updatedAfter?: Date }> = [];
    const majorOrgs = [
      {
        branchName: "uat",
        mergeTargets: ["preprod"],
        pullRequestsInBranchSinceLastMerge: [carried, pending],
      },
      {
        branchName: "preprod",
        mergeTargets: ["main"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 600 })],
      },
      // Nothing waiting in integration: nothing to subtract, so no provider call for uat
      {
        branchName: "integration",
        mergeTargets: ["uat"],
        pullRequestsInBranchSinceLastMerge: [],
      },
    ];
    const fetched = await listMergedPromotionsOfSteps(
      majorOrgs,
      async (target, updatedAfter) => {
        calls.push({ target, updatedAfter });
        return target === "preprod" ? [promotion, otherStep] : [];
      },
      ENABLED,
    );
    // One call per target branch, bounded by the oldest Pull Request of the source window
    assert.deepStrictEqual(calls.map((call) => call.target).sort(), [
      "main",
      "preprod",
    ]);
    assert.strictEqual(
      calls
        .find((call) => call.target === "preprod")!
        .updatedAfter?.toISOString(),
      "2026-09-01T08:00:00.000Z",
    );
    // Only a promotion of the uat -> preprod step counts: the one named for another step does not
    assert.deepStrictEqual(
      fetched.map((p) => p.number),
      [900],
    );

    const index = buildPromotionIndex(fetched, ENABLED);
    annotateAlreadyPromoted(
      majorOrgs[0].pullRequestsInBranchSinceLastMerge,
      "uat",
      index,
      ENABLED,
    );
    assert.strictEqual(carried.promotedAway, true);
    assert.notStrictEqual(pending.promotedAway, true);
    assert.deepStrictEqual(
      visiblePullRequests(majorOrgs[0].pullRequestsInBranchSinceLastMerge).map(
        (p) => p.number,
      ),
      [500],
    );

    // A promotion a window already holds is not returned twice, and the feature off asks nothing
    const known = new Map<number, PullRequest>([[900, promotion]]);
    assert.deepStrictEqual(
      await listMergedPromotionsOfSteps(
        majorOrgs,
        async () => [promotion],
        ENABLED,
        known,
      ),
      [],
    );
    let asked = 0;
    assert.deepStrictEqual(
      await listMergedPromotionsOfSteps(
        majorOrgs,
        async () => {
          asked++;
          return [promotion];
        },
        DISABLED,
      ),
      [],
    );
    assert.strictEqual(asked, 0);
  });

  test("the windows reach the invariant upstream first, whatever order listMajorOrgs used", () => {
    // listMajorOrgs sorts by level DESCENDING, so it hands the windows over downstream first.
    // Passing that order to enforceSinglePlacePerPullRequest made the upstream window win: a story
    // a promotion had just carried into uat was marked promotedAway in uat while
    // annotateAlreadyPromoted had already marked it in integration, so it disappeared from both.
    const carriedIntoUat = pr({ number: 497 });
    const leftInIntegration = pr({ number: 497 });
    const majorOrgsAsListed = [
      { branchName: "main", level: 100, pullRequests: [] as PullRequest[] },
      { branchName: "preprod", level: 90, pullRequests: [] as PullRequest[] },
      { branchName: "uat", level: 70, pullRequests: [carriedIntoUat] },
      {
        branchName: "integration",
        level: 50,
        pullRequests: [leftInIntegration],
      },
    ];
    assert.deepStrictEqual(
      orderWindowsUpstreamFirst(majorOrgsAsListed).map((org) => org.branchName),
      ["integration", "uat", "preprod", "main"],
    );
    enforceSinglePlacePerPullRequest(
      orderWindowsUpstreamFirst(majorOrgsAsListed),
      ENABLED,
    );
    // The branch the promotion reached keeps the story, the one it left does not
    assert.notStrictEqual(carriedIntoUat.promotedAway, true);
    assert.strictEqual(leftInIntegration.promotedAway, true);
  });

  test("a promotion carrying another promotion reaches the User Stories", () => {
    // preprod -> main declares the uat -> preprod promotion, which declares the stories: the flow
    // hardis:project:promotion:create produces on a four level pipeline
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

  test("a Pull Request number appears in a single window of the pipeline", () => {
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
