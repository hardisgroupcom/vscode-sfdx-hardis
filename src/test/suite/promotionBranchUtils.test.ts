import * as assert from "assert";
import { PullRequest } from "../../utils/gitProviders/types";
import {
  annotateAlreadyPromoted,
  expandPullRequestsWithPromotions,
  findPromotionsCarrying,
  getPromotionBranchConfig,
  isPromotionBranchName,
  isPromotionPullRequest,
  parsePromotionPullRequestIds,
} from "../../utils/pipeline/promotionBranchUtils";

const ENABLED = { enabled: true, prefix: "promotion" };
const DISABLED = { enabled: false, prefix: "promotion" };
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
  test("reads the switch from the project config or any branch config", () => {
    assert.deepStrictEqual(getPromotionBranchConfig([{}]), {
      enabled: false,
      prefix: "promotion",
    });
    assert.deepStrictEqual(
      getPromotionBranchConfig([{}, { enablePromotionBranches: true }]),
      { enabled: true, prefix: "promotion" },
    );
    assert.strictEqual(
      getPromotionBranchConfig([{ promotionBranchPrefix: "release/" }]).prefix,
      "release",
    );
    assert.strictEqual(
      getPromotionBranchConfig([{ enablePromotionBranches: "true" }]).enabled,
      false,
    );
  });

  test("matches the prefix/name convention only", () => {
    assert.strictEqual(isPromotionBranchName("promotion/2026-09"), true);
    assert.strictEqual(isPromotionBranchName("Promotion/2026-09"), true);
    assert.strictEqual(isPromotionBranchName("promotion-notes"), false);
    assert.strictEqual(isPromotionBranchName("promotion/"), false);
    assert.strictEqual(isPromotionBranchName("release/1.4", "release"), true);
    assert.strictEqual(isPromotionBranchName(undefined), false);
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

  test("needs the flag, the prefix and the key", () => {
    assert.strictEqual(
      isPromotionPullRequest(
        pr({ number: 9, sourceBranch: "promotion/x", description: DECLARATION }),
        ENABLED,
      ),
      true,
    );
    assert.strictEqual(
      isPromotionPullRequest(
        pr({ number: 9, sourceBranch: "promotion/x", description: "none" }),
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
        pr({ number: 9, sourceBranch: "promotion/x", description: DECLARATION }),
        DISABLED,
      ),
      false,
    );
  });

  test("expands a window with the declared stories, one level, merged only", async () => {
    const promotion = pr({
      number: 900,
      sourceBranch: "promotion/x",
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
      sourceBranch: "promotion/x",
      webUrl: promotion.webUrl,
    });
    assert.strictEqual(promotion.isPromotion, true);
    assert.deepStrictEqual(promotion.promotionPullRequests, [482, 487]);
  });

  test("changes nothing when the feature is disabled", async () => {
    const window = [
      pr({ number: 900, sourceBranch: "promotion/x", description: DECLARATION }),
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
      sourceBranch: "promotion/x",
      targetBranch: "preprod",
      description: DECLARATION,
      mergeDate: "2026-09-02T09:00:00Z",
    });
    const open = pr({
      number: 901,
      sourceBranch: "promotion/y",
      description: DECLARATION,
      state: "open",
    });
    assert.deepStrictEqual(
      findPromotionsCarrying(482, [merged, open], ENABLED).map((p) => p.number),
      [900],
    );
    assert.deepStrictEqual(findPromotionsCarrying(482, [merged], DISABLED), []);

    const window = [pr({ number: 482 }), pr({ number: 3 })];
    annotateAlreadyPromoted(window, [merged, open], ENABLED);
    assert.deepStrictEqual(window[0].alreadyDeployedVia, [
      {
        number: 900,
        sourceBranch: "promotion/x",
        targetBranch: "preprod",
        webUrl: merged.webUrl,
        mergeDate: "2026-09-02T09:00:00Z",
      },
    ]);
    assert.strictEqual(window[1].alreadyDeployedVia, undefined);
  });
});
