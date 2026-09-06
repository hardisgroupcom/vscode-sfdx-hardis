import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";
import { PullRequest } from "../../utils/gitProviders/types";
import {
  annotateAlreadyPromoted,
  buildPromotionIndex,
  expandPullRequestsWithPromotions,
  findPromotionsCarrying,
  getPromotionBranchConfig,
  isMajorToMajorPullRequest,
  isMergedPullRequest,
  isPromotionBranchName,
  isPromotionPullRequest,
  isRetrofitPullRequest,
  parsePromotionBranchName,
  parsePromotionPullRequestIds,
  userStoryPullRequests,
  visiblePullRequests,
} from "../../utils/pipeline/promotionBranchUtils";

const ENABLED = { enabled: true };
const DISABLED = { enabled: false };
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
    // The CLI reads the merged branch config, so a single branch file may switch it on
    assert.deepStrictEqual(field!.scopes, ["global", "branch"]);
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
    assert.deepStrictEqual(getPromotionBranchConfig([{}]), { enabled: false });
    assert.deepStrictEqual(
      getPromotionBranchConfig([{}, { enablePromotionBranches: true }]),
      { enabled: true },
    );
    assert.strictEqual(
      getPromotionBranchConfig([{ enablePromotionBranches: "true" }]).enabled,
      false,
    );
  });

  test("parses promotion/<source>/<target>/<YYYY-MM-DD>-<counter> and nothing else", () => {
    assert.deepStrictEqual(parsePromotionBranchName(PROMOTION_BRANCH), {
      sourceBranch: "uat",
      targetBranch: "preprod",
      date: "2026-09-06",
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

  test("lists and counters show User Stories only, unless promotions are asked for", () => {
    const majors = ["integ", "uat", "preprod", "main"];
    const story = pr({ number: 5, sourceBranch: "feature/x", targetBranch: "uat" });
    const promotion = pr({
      number: 7,
      sourceBranch: "promotion/integ/uat/2026-09-06-1",
      targetBranch: "uat",
      description: DECLARATION,
    });
    const majorToMajor = pr({ number: 16, sourceBranch: "uat", targetBranch: "preprod" });
    const retrofit = pr({ number: 10, sourceBranch: "retrofit/from-main", targetBranch: "integ" });
    assert.strictEqual(isMajorToMajorPullRequest(majorToMajor, majors), true);
    assert.strictEqual(isMajorToMajorPullRequest(story, majors), false);
    assert.strictEqual(isRetrofitPullRequest(retrofit), true);
    assert.strictEqual(isRetrofitPullRequest(pr({ number: 1, sourceBranch: "retrofit-notes" })), false);
    assert.deepStrictEqual(
      userStoryPullRequests([story, promotion, majorToMajor, retrofit], majors).map((p) => p.number),
      [5],
    );
    assert.deepStrictEqual(
      userStoryPullRequests([story, promotion, majorToMajor, retrofit], majors, true).map((p) => p.number),
      [5, 7, 16, 10],
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
    assert.deepStrictEqual(
      visiblePullRequests(uatWindow, true).map((p) => p.number),
      [482, 500],
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
