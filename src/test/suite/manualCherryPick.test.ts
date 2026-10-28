import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";
import { PullRequest } from "../../utils/gitProviders/types";
import { pr } from "./pullRequestFixture";
import {
  applyManualCherryPicks,
  buildPromotionIndex,
  EMPTY_PROMOTION_INDEX,
  enforceSinglePlacePerPullRequest,
  isManualCherryPickDetectionEnabled,
  listManualCherryPickSteps,
  ManualCherryPickStepResult,
  parseManualCherryPickResult,
  parsePromotionSteps,
  resolveManualCherryPickChain,
  userStoryPullRequests,
  visiblePullRequests,
} from "../../utils/pipeline/promotionBranchUtils";
import {
  listMovesStillInTargetWindow,
  loadManualCherryPicks,
  ManualCherryPickDeps,
  manualCherryPickCacheKey,
  windowsFingerprint,
} from "../../utils/pipeline/manualCherryPickUtils";
import {
  assertKeysTranslated,
  extractMember,
  readModuleFile,
} from "./lwcSourceUtils";

const ENABLED = {
  enabled: true,
  allowedSteps: parsePromotionSteps([{ source: "uat", target: "preprod" }]),
};
const DISABLED = { enabled: false, allowedSteps: ENABLED.allowedSteps };
const PROJECT_ON = {
  enablePromotionBranches: true,
  detectManualCherryPicks: true,
  allowedPromotionSteps: [{ source: "uat", target: "preprod" }],
};

// The JSON result of sf hardis:project:promotion:list-candidates --agent --json with
// detectManualCherryPicks on, as toCandidateSummary writes it
const LIST_CANDIDATES_RESULT = {
  sourceBranch: "uat",
  targetBranch: "preprod",
  candidates: [
    {
      pullRequests: [510],
      title: "Partly picked",
      partiallyCherryPicked: {
        foundCommits: ["aaaaaaa1", "aaaaaaa2"],
        totalCommits: 3,
        branch: "preprod",
        targetCommit: "bbbbbbbbbbbb",
      },
    },
    {
      pullRequests: [520],
      title: "Same title",
      probablyCherryPicked: {
        targetCommit: "cccccccccccc",
        subject: "Same title",
        branch: "preprod",
      },
    },
    { pullRequests: [530], title: "Nothing found" },
  ],
  alreadyPromoted: [
    {
      pullRequests: [482],
      alreadyPromotedBy: {
        pullRequest: "d1e2f3a4",
        branch: "preprod",
        url: "",
        merged: true,
        manualCherryPick: {
          signal: "cherry-pick-trailer",
          targetCommit: "d1e2f3a4b5c6",
        },
      },
    },
    {
      pullRequests: [487, "#488"],
      commit: "f0f0f0f0f0f0",
      alreadyPromotedBy: {
        pullRequest: "77",
        branch: "release/october",
        url: "https://git.example.com/pr/77",
        merged: true,
        manualCherryPick: {
          signal: "pull-request-commits",
          targetCommit: "e1e2e3e4e5e6",
          carrier: { pullRequest: 77, commits: ["5a5a5a5a5a5a"] },
        },
      },
    },
    // Carried by a promotion: not a manual cherry-pick, the promotion index places it
    {
      pullRequests: [490],
      alreadyPromotedBy: {
        pullRequest: "900",
        branch: "promotion/uat/preprod/2026-10-01-0900",
        url: "",
        merged: true,
      },
    },
  ],
};

function fakeDeps(overrides: Partial<ManualCherryPickDeps> = {}): {
  deps: ManualCherryPickDeps;
  calls: string[];
  cache: Map<string, ManualCherryPickStepResult>;
} {
  const calls: string[] = [];
  const cache = new Map<string, ManualCherryPickStepResult>();
  const deps: ManualCherryPickDeps = {
    workspaceRoot: "/repo",
    readTips: async (source, target) => {
      calls.push(`tips ${source} ${target}`);
      return { source: "1111111", target: "2222222" };
    },
    runListCandidates: async (source, target) => {
      calls.push(`cli ${source} ${target}`);
      return LIST_CANDIDATES_RESULT;
    },
    getCached: (key) => cache.get(key),
    setCached: async (key, value) => {
      cache.set(key, value);
    },
    isInRemoteBranch: async () => {
      calls.push("git rev-list");
      return false;
    },
    ...overrides,
  };
  return { deps, calls, cache };
}

suite("manual cherry-picks (detectManualCherryPicks)", () => {
  test("is a Beta setting of the Danger Zone, at project level, next to enablePromotionBranches", () => {
    const field = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.find(
      (entry) => entry.name === "detectManualCherryPicks",
    );
    assert.ok(field, "detectManualCherryPicks must be a configurable field");
    assert.deepStrictEqual(field!.scopes, ["global"]);
    const section = SfdxHardisConfigHelper.SECTIONS.find(
      (entry) => entry.label === "dangerZone",
    );
    assert.ok(section);
    const keys = section!.keys as string[];
    assert.strictEqual(
      keys.indexOf("detectManualCherryPicks"),
      keys.indexOf("enablePromotionBranches") + 1,
    );
    // Bundled by hand until sfdx-hardis main publishes it
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../resources/sfdx-hardis.jsonschema.json",
        ),
        "utf8",
      ),
    );
    const property = schema.properties.detectManualCherryPicks;
    assert.strictEqual(property?.type, "boolean");
    assert.strictEqual(property?.default, false);
    assert.ok(String(property?.title).includes("(Beta)"));
  });

  test("needs both enablePromotionBranches and detectManualCherryPicks", () => {
    assert.strictEqual(isManualCherryPickDetectionEnabled(PROJECT_ON), true);
    assert.strictEqual(
      isManualCherryPickDetectionEnabled({ detectManualCherryPicks: true }),
      false,
    );
    assert.strictEqual(
      isManualCherryPickDetectionEnabled({ enablePromotionBranches: true }),
      false,
    );
    assert.strictEqual(
      isManualCherryPickDetectionEnabled({
        enablePromotionBranches: true,
        detectManualCherryPicks: "true",
      }),
      false,
    );
    assert.strictEqual(isManualCherryPickDetectionEnabled(null), false);
  });

  test("asks about the allowed steps that are real edges of the pipeline only", () => {
    const orgs = [
      {
        branchName: "integration",
        mergeTargets: ["uat"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 1 })],
      },
      {
        branchName: "uat",
        mergeTargets: ["preprod", "uatrun"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 2 })],
      },
      {
        branchName: "preprod",
        mergeTargets: ["main"],
        pullRequestsInBranchSinceLastMerge: [],
      },
    ];
    const steps = parsePromotionSteps([
      { source: "UAT", target: "preprod" },
      // Not a merge target of uat: no edge, no call
      { source: "uat", target: "main" },
      // No target: every merge target of integration
      "integration",
      // An empty window has nothing to place
      { source: "preprod", target: "main" },
      // Not a branch of the pipeline
      { source: "hotfix", target: "main" },
    ]);
    assert.deepStrictEqual(listManualCherryPickSteps(orgs, steps), [
      { source: "uat", target: "preprod" },
      { source: "integration", target: "uat" },
    ]);
    // The CLI refuses to list candidates without allowedPromotionSteps: nothing is asked
    assert.deepStrictEqual(listManualCherryPickSteps(orgs, []), []);
  });

  test("reads the moved, partial and probable stories of the CLI answer", () => {
    const parsed = parseManualCherryPickResult(
      "uat",
      "preprod",
      LIST_CANDIDATES_RESULT,
    );
    assert.deepStrictEqual(parsed.moved, [
      {
        pullRequests: [482],
        // An answer of a CLI that does not name the carrier yet: nothing to follow
        rowCommit: "",
        carrierPullRequest: null,
        carrierCommits: [],
        carrierIsOwnStory: false,
        signal: "cherry-pick-trailer",
        targetCommit: "d1e2f3a4b5c6",
        // With the trailer signal there is no release Pull Request to name
        releasePullRequest: "",
        releaseBranch: "",
        releaseUrl: "",
      },
      {
        pullRequests: [487, 488],
        rowCommit: "f0f0f0f0f0f0",
        carrierPullRequest: 77,
        carrierCommits: ["5a5a5a5a5a5a"],
        carrierIsOwnStory: false,
        signal: "pull-request-commits",
        targetCommit: "e1e2e3e4e5e6",
        releasePullRequest: "77",
        releaseBranch: "release/october",
        releaseUrl: "https://git.example.com/pr/77",
      },
    ]);
    assert.deepStrictEqual(parsed.partial, [
      {
        pullRequests: [510],
        foundCommits: 2,
        totalCommits: 3,
        targetCommit: "bbbbbbbbbbbb",
      },
    ]);
    assert.deepStrictEqual(parsed.probable, [
      {
        pullRequests: [520],
        targetCommit: "cccccccccccc",
        subject: "Same title",
      },
    ]);
    // An older CLI answers without these fields: nothing to place
    assert.deepStrictEqual(
      parseManualCherryPickResult("uat", "preprod", { candidates: [] }),
      {
        sourceBranch: "uat",
        targetBranch: "preprod",
        moved: [],
        partial: [],
        probable: [],
      },
    );
  });

  test("a story goes as far as its carrier went: by number, or by commit when the row has none", () => {
    const steps = { integration: "uat", uat: "preprod" } as Record<
      string,
      string
    >;
    const integrationToUat = parseManualCherryPickResult(
      "integration",
      steps.integration,
      {
        alreadyPromoted: [
          {
            // Picked into a squashed release branch, merged into uat as !414
            pullRequests: [5],
            commit: "5555555555aa",
            alreadyPromotedBy: {
              pullRequest: "414",
              branch: "release/uat-1467",
              url: "",
              merged: true,
              manualCherryPick: {
                signal: "pull-request-commits",
                targetCommit: "1111111111aa",
                carrier: { pullRequest: 414, commits: ["414414414414"] },
              },
            },
          },
          {
            // Brought by a squashed integration -> uat merge (!270)
            pullRequests: [6],
            commit: "6666666666aa",
            alreadyPromotedBy: {
              pullRequest: "270",
              branch: "integration",
              url: "",
              merged: true,
              manualCherryPick: {
                signal: "pull-request-commits",
                targetCommit: "2222222222aa",
                carrier: { pullRequest: 270, commits: ["cf0b3cbf0000"] },
              },
            },
          },
        ],
      },
    );
    const preprodCarrier = {
      pullRequest: "421",
      branch: "release/preprod-1704",
      url: "",
      merged: true,
      manualCherryPick: {
        signal: "pull-request-commits",
        targetCommit: "3333333333aa",
        carrier: { pullRequest: 421, commits: ["421421421421"] },
      },
    };
    const uatToPreprod = parseManualCherryPickResult("uat", steps.uat, {
      alreadyPromoted: [
        // The release row of uat, found in preprod through !421
        {
          pullRequests: [414],
          commit: "414414414414",
          alreadyPromotedBy: preprodCarrier,
        },
        // The squashed merge between major branches: its number was dropped, its commit stays
        {
          pullRequests: [],
          commit: "cf0b3cbf0000",
          alreadyPromotedBy: preprodCarrier,
        },
      ],
    });
    assert.deepStrictEqual(
      resolveManualCherryPickChain(
        [integrationToUat, uatToPreprod],
        integrationToUat,
        integrationToUat.moved[0],
      ).map((hop) => hop.result.targetBranch),
      ["uat", "preprod"],
    );

    const windows = [
      {
        branchName: "integration",
        pullRequests: [
          pr({ number: 5, targetBranch: "integration" }),
          pr({ number: 6, targetBranch: "integration" }),
        ],
      },
      {
        branchName: "uat",
        pullRequests: [
          pr({ number: 414, sourceBranch: "release/uat-1467" }),
          pr({ number: 423, sourceBranch: "retrofit/x" }),
        ],
      },
      {
        branchName: "preprod",
        pullRequests: [
          pr({
            number: 421,
            sourceBranch: "release/preprod-1704",
            targetBranch: "preprod",
          }),
        ],
      },
    ];
    applyManualCherryPicks(
      windows,
      [integrationToUat, uatToPreprod],
      EMPTY_PROMOTION_INDEX,
      ENABLED,
    );

    const stories = (branch: string) =>
      userStoryPullRequests(
        visiblePullRequests(
          windows.find((entry) => entry.branchName === branch)!.pullRequests,
        ),
        ["integration", "uat", "preprod"],
        ENABLED,
      )
        .map((entry) => entry.number)
        .sort((a, b) => Number(a) - Number(b));
    assert.deepStrictEqual(stories("integration"), []);
    assert.deepStrictEqual(stories("uat"), [423]);
    assert.deepStrictEqual(stories("preprod"), [5, 6]);
    const placed = windows[2].pullRequests.find((entry) => entry.number === 5)!;
    assert.strictEqual(placed.manualCherryPick?.targetBranch, "preprod");
    assert.strictEqual(placed.manualCherryPick?.releasePullRequest, "421");
  });

  test("with the setting off, not one CLI or git call is made", async () => {
    const orgs = [
      {
        branchName: "uat",
        mergeTargets: ["preprod"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 482 })],
      },
    ];
    for (const [projectConfig, config] of [
      [{ ...PROJECT_ON, detectManualCherryPicks: false }, ENABLED],
      [{ enablePromotionBranches: true }, ENABLED],
      [PROJECT_ON, DISABLED],
    ] as Array<[any, typeof ENABLED]>) {
      const { deps, calls } = fakeDeps();
      assert.deepStrictEqual(
        await loadManualCherryPicks(orgs, projectConfig, config, deps),
        [],
      );
      assert.deepStrictEqual(calls, []);
    }
  });

  test("runs the steps in parallel, and an unchanged pipeline costs no CLI call", async () => {
    const orgs = [
      {
        branchName: "integration",
        mergeTargets: ["uat"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 1 })],
      },
      {
        branchName: "uat",
        mergeTargets: ["preprod"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 482 })],
      },
    ];
    const config = {
      enabled: true,
      allowedSteps: parsePromotionSteps(["integration > uat", "uat > preprod"]),
    };
    let running = 0;
    let maxRunning = 0;
    const { deps, calls, cache } = fakeDeps({
      runListCandidates: async (source, target) => {
        calls.push(`cli ${source} ${target}`);
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
        return LIST_CANDIDATES_RESULT;
      },
    });
    const first = await loadManualCherryPicks(orgs, PROJECT_ON, config, deps);
    assert.strictEqual(first.length, 2);
    assert.strictEqual(maxRunning, 2, "the steps must run in parallel");
    assert.strictEqual(
      calls.filter((call) => call.startsWith("cli")).length,
      2,
    );
    // Cached per step, per tips of origin/<source> and origin/<target>, and per windows
    assert.ok(
      cache.has(
        manualCherryPickCacheKey(
          "/repo",
          { source: "uat", target: "preprod" },
          { source: "1111111", target: "2222222" },
          windowsFingerprint(orgs, { source: "uat", target: "preprod" }),
        ),
      ),
    );

    calls.length = 0;
    const second = await loadManualCherryPicks(orgs, PROJECT_ON, config, deps);
    assert.deepStrictEqual(second, first);
    assert.strictEqual(
      calls.filter((call) => call.startsWith("cli")).length,
      0,
      "unchanged tips must not run the CLI again",
    );

    // A moved tip asks again, for that step only
    calls.length = 0;
    const moved = fakeDeps({
      readTips: async (source, target) => ({
        source: source === "uat" ? "3333333" : "1111111",
        target: target === "preprod" ? "2222222" : "2222222",
      }),
      runListCandidates: async (source, target) => {
        calls.push(`cli ${source} ${target}`);
        return LIST_CANDIDATES_RESULT;
      },
    });
    for (const [key, value] of cache) {
      moved.cache.set(key, value);
    }
    await loadManualCherryPicks(orgs, PROJECT_ON, config, moved.deps);
    assert.deepStrictEqual(calls, ["cli uat preprod"]);
  });

  test("a failed CLI call places nothing and is not cached", async () => {
    const orgs = [
      {
        branchName: "uat",
        mergeTargets: ["preprod"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 482 })],
      },
    ];
    const { deps, cache } = fakeDeps({ runListCandidates: async () => null });
    assert.deepStrictEqual(
      await loadManualCherryPicks(orgs, PROJECT_ON, ENABLED, deps),
      [],
    );
    assert.strictEqual(cache.size, 0);
  });

  test("a story cherry-picked by hand leaves the source window for the target one", () => {
    const story = pr({ number: 482, relatedTickets: [] });
    const promotedStory = pr({ number: 490 });
    const partial = pr({ number: 510 });
    const probable = pr({ number: 520 });
    const untouched = pr({ number: 530 });
    const uat = [story, promotedStory, partial, probable, untouched];
    const preprod = [pr({ number: 600, targetBranch: "preprod" })];
    const windows = [
      { branchName: "uat", pullRequests: uat },
      { branchName: "preprod", pullRequests: preprod },
    ];
    // A promotion of the step declares 490: it keeps its placement whatever the CLI says
    const promotion = pr({
      number: 900,
      sourceBranch: "promotion/uat/preprod/2026-10-01-0900",
      targetBranch: "preprod",
      description: "```yaml\npromotionPullRequests: [490]\n```",
      mergeDate: "2026-10-01T09:00:00Z",
    });
    const index = buildPromotionIndex([promotion], ENABLED);
    const result = parseManualCherryPickResult(
      "uat",
      "preprod",
      LIST_CANDIDATES_RESULT,
    );
    result.moved[0].pullRequests.push(490);

    applyManualCherryPicks(windows, [result], index, ENABLED);
    enforceSinglePlacePerPullRequest(windows, ENABLED);

    assert.strictEqual(story.promotedAway, true);
    assert.deepStrictEqual(
      visiblePullRequests(uat).map((p) => p.number),
      [490, 510, 520, 530],
    );
    const copy = preprod.find((p) => p.number === 482)!;
    assert.ok(copy, "the story is listed in the branch it reached");
    assert.notStrictEqual(copy.promotedAway, true);
    assert.deepStrictEqual(copy.manualCherryPick, {
      targetBranch: "preprod",
      signal: "cherry-pick-trailer",
      targetCommit: "d1e2f3a4b5c6",
    });
    // The release Pull Request that held 487 is named on the story
    assert.strictEqual(
      preprod.find((p) => p.number === 487),
      undefined,
      "487 is not in the uat window, so there is nothing to place",
    );
    // The promotion wins: 490 is not touched by the cherry-pick detection
    assert.strictEqual(promotedStory.manualCherryPick, undefined);
    // Partial and probable stay, flagged
    assert.deepStrictEqual(partial.partiallyCherryPicked, {
      targetBranch: "preprod",
      foundCommits: 2,
      totalCommits: 3,
      targetCommit: "bbbbbbbbbbbb",
    });
    assert.notStrictEqual(partial.promotedAway, true);
    assert.strictEqual(probable.probablyCherryPicked?.subject, "Same title");
    assert.notStrictEqual(probable.promotedAway, true);
    assert.strictEqual(untouched.partiallyCherryPicked, undefined);
    assert.strictEqual(untouched.probablyCherryPicked, undefined);
  });

  test("a cherry-pick that already left the target window is not listed there, and still leaves the source", () => {
    const story = pr({ number: 482 });
    const uat = [story];
    const preprod: PullRequest[] = [];
    applyManualCherryPicks(
      [
        { branchName: "uat", pullRequests: uat },
        { branchName: "preprod", pullRequests: preprod },
      ],
      [parseManualCherryPickResult("uat", "preprod", LIST_CANDIDATES_RESULT)],
      EMPTY_PROMOTION_INDEX,
      ENABLED,
      () => false,
    );
    assert.strictEqual(story.promotedAway, true);
    assert.deepStrictEqual(preprod, []);

    // Feature off: nothing moves
    const off = pr({ number: 482 });
    applyManualCherryPicks(
      [{ branchName: "uat", pullRequests: [off] }],
      [parseManualCherryPickResult("uat", "preprod", LIST_CANDIDATES_RESULT)],
      EMPTY_PROMOTION_INDEX,
      DISABLED,
    );
    assert.strictEqual(off.promotedAway, undefined);
    assert.strictEqual(off.manualCherryPick, undefined);
  });

  test("a cherry-pick is still waiting in the target branch until the next one holds it", async () => {
    const result = parseManualCherryPickResult(
      "uat",
      "preprod",
      LIST_CANDIDATES_RESULT,
    );
    const [byTrailer, byRelease] = result.moved;
    const asked: string[] = [];
    const orgs = (preprodWindow: PullRequest[], mergeTargets: string[]) => [
      {
        branchName: "preprod",
        mergeTargets,
        pullRequestsInBranchSinceLastMerge: preprodWindow,
      },
    ];
    // The release Pull Request is in the preprod window; the trailer commit is not in main yet
    let listed = await listMovesStillInTargetWindow(
      [result],
      orgs([pr({ number: 77, targetBranch: "preprod" })], ["main"]),
      async (commit, branch) => {
        asked.push(`${commit} ${branch}`);
        return false;
      },
    );
    assert.ok(listed.has(byTrailer));
    assert.ok(listed.has(byRelease));
    assert.deepStrictEqual(asked, ["d1e2f3a4b5c6 main"]);

    // preprod went live: the release Pull Request left its window, main holds both commits. The
    // story went to main with preprod: it is waiting there, not nowhere
    listed = await listMovesStillInTargetWindow(
      [result],
      orgs([], ["main"]),
      async () => true,
    );
    assert.strictEqual(listed.get(byTrailer), "main");
    assert.strictEqual(listed.get(byRelease), "main");

    // The release Pull Request left the window but nothing further holds its commit: as before,
    // it is listed nowhere
    listed = await listMovesStillInTargetWindow(
      [result],
      orgs([], ["main"]),
      async () => false,
    );
    assert.strictEqual(listed.get(byTrailer), "preprod");
    assert.strictEqual(listed.has(byRelease), false);

    // git cannot tell: the story is listed where the CLI says it is
    listed = await listMovesStillInTargetWindow(
      [result],
      orgs([], ["main"]),
      async () => null,
    );
    assert.ok(listed.has(byTrailer));
  });

  test("a story picked into uat goes on with uat: listed in the furthest branch holding it, one git call per branch", async () => {
    const result = parseManualCherryPickResult("integration", "uat", {
      alreadyPromoted: [
        {
          pullRequests: [5],
          alreadyPromotedBy: {
            pullRequest: "aaaaaaa1",
            branch: "uat",
            url: "",
            merged: true,
            manualCherryPick: {
              signal: "cherry-pick-trailer",
              targetCommit: "aaaaaaa1aaaa",
            },
          },
        },
        {
          pullRequests: [6],
          alreadyPromotedBy: {
            pullRequest: "bbbbbbb1",
            branch: "uat",
            url: "",
            merged: true,
            manualCherryPick: {
              signal: "cherry-pick-trailer",
              targetCommit: "bbbbbbb1bbbb",
            },
          },
        },
      ],
    });
    const orgs = [
      {
        branchName: "integration",
        mergeTargets: ["uat"],
        pullRequestsInBranchSinceLastMerge: [
          pr({ number: 5 }),
          pr({ number: 6 }),
        ],
      },
      {
        branchName: "uat",
        mergeTargets: ["preprod"],
        pullRequestsInBranchSinceLastMerge: [],
      },
      {
        branchName: "preprod",
        mergeTargets: ["main"],
        pullRequestsInBranchSinceLastMerge: [],
      },
      {
        branchName: "main",
        mergeTargets: [],
        pullRequestsInBranchSinceLastMerge: [],
      },
    ];
    const asked: string[] = [];
    // uat was merged into preprod since: both picks are in preprod, only the first one in main
    const listed = await listMovesStillInTargetWindow(
      [result],
      orgs,
      undefined,
      async (commits, branch) => {
        asked.push(`${branch}: ${commits.join(" ")}`);
        return new Map(
          commits.map((commit) => [
            commit,
            branch === "preprod" || commit === "aaaaaaa1aaaa",
          ]),
        );
      },
    );
    assert.deepStrictEqual(asked, [
      "preprod: aaaaaaa1aaaa bbbbbbb1bbbb",
      "main: aaaaaaa1aaaa bbbbbbb1bbbb",
    ]);
    assert.strictEqual(listed.get(result.moved[0]), "main");
    assert.strictEqual(listed.get(result.moved[1]), "preprod");

    const windows = orgs.map((org) => ({
      branchName: org.branchName,
      pullRequests: org.pullRequestsInBranchSinceLastMerge,
    }));
    applyManualCherryPicks(
      windows,
      [result],
      EMPTY_PROMOTION_INDEX,
      ENABLED,
      (_result, move) => listed.get(move) || false,
    );
    enforceSinglePlacePerPullRequest(windows, ENABLED);
    const visible = (branch: string) =>
      visiblePullRequests(
        windows.find((entry) => entry.branchName === branch)!.pullRequests,
      ).map((entry) => entry.number);
    // Listed once, where it is waiting
    assert.deepStrictEqual(visible("integration"), []);
    assert.deepStrictEqual(visible("uat"), []);
    assert.deepStrictEqual(visible("preprod"), [6]);
    assert.deepStrictEqual(visible("main"), [5]);
    // It still says where the cherry-pick was made
    const copy = windows[3].pullRequests.find((entry) => entry.number === 5)!;
    assert.strictEqual(copy.manualCherryPick?.targetBranch, "uat");
    assert.strictEqual(copy.manualCherryPickCopy, true);
  });

  test("a hotfix branched from the source branch with a fix of its own is not hidden as a vehicle", () => {
    const carrier = (pullRequest: number, own: boolean) => ({
      pullRequest,
      commits: [`${pullRequest}00000000`],
      ...(own
        ? { heldSourceBranchCommits: true, ownCommits: 1 }
        : { heldSourceBranchCommits: false, ownCommits: 0 }),
    });
    const result = parseManualCherryPickResult("integration", "uat", {
      alreadyPromoted: [
        {
          pullRequests: [5],
          alreadyPromotedBy: {
            pullRequest: "104",
            branch: "hotfix/h",
            url: "",
            merged: true,
            manualCherryPick: {
              signal: "pull-request-commits",
              targetCommit: "5555555555aa",
              carrier: carrier(104, true),
            },
          },
        },
        {
          pullRequests: [6],
          alreadyPromotedBy: {
            pullRequest: "101",
            branch: "release/1",
            url: "",
            merged: true,
            manualCherryPick: {
              signal: "pull-request-commits",
              targetCommit: "6666666666aa",
              carrier: carrier(101, false),
            },
          },
        },
      ],
    });
    assert.strictEqual(result.moved[0].carrierIsOwnStory, true);
    assert.strictEqual(result.moved[1].carrierIsOwnStory, false);
    const hotfix = pr({ number: 104, sourceBranch: "hotfix/h" });
    const release = pr({ number: 101, sourceBranch: "release/1" });
    const windows = [
      {
        branchName: "integration",
        pullRequests: [pr({ number: 5 }), pr({ number: 6 })],
      },
      { branchName: "uat", pullRequests: [hotfix, release] },
    ];
    applyManualCherryPicks(windows, [result], EMPTY_PROMOTION_INDEX, ENABLED);
    assert.strictEqual(hotfix.carriesManualCherryPicks, undefined);
    assert.strictEqual(release.carriesManualCherryPicks, true);
    assert.deepStrictEqual(
      userStoryPullRequests(
        visiblePullRequests(windows[1].pullRequests),
        ["integration", "uat"],
        ENABLED,
      )
        .map((entry) => entry.number)
        .sort((a, b) => Number(a) - Number(b)),
      [5, 6, 104],
    );
  });

  test("a Pull Request merged into a window since the last fetch asks the CLI again", async () => {
    const orgs = (uatWindow: PullRequest[]) => [
      {
        branchName: "uat",
        mergeTargets: ["preprod"],
        pullRequestsInBranchSinceLastMerge: [pr({ number: 482 })],
      },
      {
        branchName: "preprod",
        mergeTargets: ["main"],
        pullRequestsInBranchSinceLastMerge: uatWindow,
      },
    ];
    // The local tips never move: nothing fetched
    const { deps, calls } = fakeDeps();
    await loadManualCherryPicks(orgs([]), PROJECT_ON, ENABLED, deps);
    await loadManualCherryPicks(orgs([]), PROJECT_ON, ENABLED, deps);
    assert.strictEqual(
      calls.filter((call) => call.startsWith("cli")).length,
      1,
    );
    // A release Pull Request squash-merged into preprod, seen by the provider only
    await loadManualCherryPicks(
      orgs([
        pr({
          number: 77,
          targetBranch: "preprod",
          mergeDate: "2026-10-27T10:00:00Z",
        }),
      ]),
      PROJECT_ON,
      ENABLED,
      deps,
    );
    assert.strictEqual(
      calls.filter((call) => call.startsWith("cli")).length,
      2,
    );
  });

  test("a story listed through a cherry-pick is ticked through the release Pull Request that brought it", () => {
    const pipeline = readModuleFile("pipeline", "pipeline.js");
    const view = new Function(
      `return { ${extractMember(pipeline, "_promotionNumberOf(pr)")} };`,
    )();
    view._majorBranchNames = () => ["integration", "uat", "preprod", "main"];
    assert.strictEqual(view._promotionNumberOf({ number: 12 }), 12);
    const copy = (manualCherryPick: any) => ({
      number: 5,
      manualCherryPickCopy: true,
      manualCherryPick,
    });
    assert.strictEqual(
      view._promotionNumberOf(
        copy({ releasePullRequest: "77", releaseBranch: "release/october" }),
      ),
      77,
    );
    // Picked straight onto the branch, or squashed by a merge between major branches: no number
    // the promotion command knows, so it cannot be ticked
    assert.strictEqual(
      view._promotionNumberOf(copy({ targetCommit: "abc1234" })),
      null,
    );
    assert.strictEqual(
      view._promotionNumberOf(
        copy({ releasePullRequest: "270", releaseBranch: "integration" }),
      ),
      null,
    );
    // The selection passes each release Pull Request once
    assert.ok(
      extractMember(pipeline, "handleModalPrSelect(event)").includes(
        "this._promotionNumberOf(row)",
      ),
    );
    assert.ok(
      extractMember(pipeline, "_isSelectableForPromotion(pr)").includes(
        "this._promotionNumberOf(pr) !== null",
      ),
    );
  });

  test("the Pull Requests and Tickets tabs flag a cherry-picked story", () => {
    const pipeline = readModuleFile("pipeline", "pipeline.js");
    const view = Object.assign(
      new Function(
        `return { ${extractMember(pipeline, "_cherryPickInfo(pr)")} };`,
      )(),
      {
        t: (key: string, vars: any) => `${key} ${JSON.stringify(vars || {})}`,
      },
    );
    const moved = view._cherryPickInfo({
      manualCherryPick: {
        targetBranch: "preprod",
        signal: "pull-request-commits",
        targetCommit: "e1e2e3e4e5e6",
        releasePullRequest: "77",
        releaseBranch: "release/october",
      },
    });
    assert.ok(moved.label.startsWith("prManualCherryPick "));
    assert.ok(moved.title.startsWith("prManualCherryPickReleaseTooltip "));
    assert.ok(moved.title.includes('"sha":"e1e2e3e"'));
    assert.ok(moved.title.includes('"release":"#77 release/october"'));
    assert.strictEqual(moved.pillClass, "hardis-pill hardis-status-info");
    assert.ok(
      view
        ._cherryPickInfo({
          partiallyCherryPicked: {
            targetBranch: "preprod",
            foundCommits: 2,
            totalCommits: 3,
            targetCommit: "bbbbbbbbbbbb",
          },
        })
        .label.startsWith("prPartiallyCherryPicked "),
    );
    assert.ok(
      view
        ._cherryPickInfo({
          probablyCherryPicked: {
            targetBranch: "preprod",
            targetCommit: "cccccccccccc",
            subject: "Same title",
          },
        })
        .label.startsWith("prProbablyCherryPicked "),
    );
    assert.strictEqual(view._cherryPickInfo({ number: 1 }), null);

    // Both lists render the flag, with its tooltip
    assert.ok(
      readModuleFile("pullRequestList", "pullRequestList.html").includes(
        "title={row.cherryPickTitle}",
      ),
    );
    assert.ok(
      readModuleFile("ticketList", "ticketList.html").includes(
        "title={pr.cherryPickTitle}",
      ),
    );
    assertKeysTranslated([
      "prManualCherryPick",
      "prManualCherryPickReleaseTooltip",
      "prManualCherryPickTooltip",
      "prPartiallyCherryPicked",
      "prPartiallyCherryPickedTooltip",
      "prProbablyCherryPicked",
      "prProbablyCherryPickedTooltip",
    ]);
  });
});
