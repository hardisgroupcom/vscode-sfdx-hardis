import * as assert from "assert";
import { Logger } from "../../logger";
import { pickLatestByDate } from "../../utils/gitProviders/latestByDate";
import { GitProviderGitHub } from "../../utils/gitProviders/gitProviderGitHub";
import { GitProviderGitea } from "../../utils/gitProviders/gitProviderGitea";
import { GitProviderGitlab } from "../../utils/gitProviders/gitProviderGitlab";
import { GitProviderBitbucket } from "../../utils/gitProviders/gitProviderBitbucket";
import { newAzureProviderStub } from "./azureProviderStub";

// Runs fn and returns what it logged
async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
  const original = Logger.log;
  const logs: string[] = [];
  (Logger as any).log = (message: any) => {
    logs.push(String(message));
  };
  try {
    await fn();
  } finally {
    (Logger as any).log = original;
  }
  return logs;
}

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY).toISOString();

// The window of a branch starts at its last merge into the next branch. Seen on a real GitLab
// repository: three merges of integration into uat, and somebody commented in 2026-09 on the one
// merged in 2025-10. "Sort by update, take one" answered that one, so the window started ten
// months too early. Listed here the way the providers answer: most recently updated first.
const DIRECT_MERGES = [
  {
    id: 10,
    mergedAt: "2025-10-02T09:00:00Z",
    updatedAt: "2026-09-15T14:00:00Z",
  },
  {
    id: 30,
    mergedAt: "2026-08-20T09:00:00Z",
    updatedAt: "2026-08-20T09:00:00Z",
  },
  {
    id: 20,
    mergedAt: "2026-03-10T09:00:00Z",
    updatedAt: "2026-03-10T09:00:00Z",
  },
];

suite(
  "The window of a branch starts at its last merge into the next branch",
  () => {
    test("the latest merge is the one merged last, not the one updated last", () => {
      assert.strictEqual(
        pickLatestByDate(DIRECT_MERGES, (merge) => merge.updatedAt)?.id,
        10,
        "what the providers used to be asked",
      );
      assert.strictEqual(
        pickLatestByDate(DIRECT_MERGES, (merge) => merge.mergedAt)?.id,
        30,
      );
    });

    test("an item without a date never wins, and no date at all keeps the provider order", () => {
      const items = [
        { id: 1, date: undefined as string | undefined },
        { id: 2, date: "2026-01-01T00:00:00Z" },
        { id: 3, date: "not a date" },
      ];
      assert.strictEqual(pickLatestByDate(items, (item) => item.date)?.id, 2);
      assert.strictEqual(pickLatestByDate(items, () => undefined)?.id, 1);
      assert.strictEqual(
        pickLatestByDate([] as typeof items, (item) => item.date),
        null,
      );
      // A Date is accepted as well as a string (Azure DevOps gives dates)
      assert.strictEqual(
        pickLatestByDate(
          [
            { id: 1, date: new Date("2026-01-01T00:00:00Z") },
            { id: 2, date: new Date("2026-02-01T00:00:00Z") },
          ],
          (item) => item.date,
        )?.id,
        2,
      );
    });

    test("GitHub compares from the merge commit of the last merged Pull Request", async () => {
      const listCalls: any[] = [];
      const compareCalls: any[] = [];
      const provider: any = Object.create(GitProviderGitHub.prototype);
      provider.repoInfo = { owner: "acme", repo: "repo" };
      provider.logApiCall = async () => {};
      provider.gitHubClient = {
        pulls: {
          list: async (params: any) => {
            listCalls.push(params);
            return {
              data: DIRECT_MERGES.map((merge) => ({
                number: merge.id,
                base: { ref: "uat" },
                head: { ref: "integration" },
                merged_at: merge.mergedAt,
                updated_at: merge.updatedAt,
                merge_commit_sha: `sha-${merge.id}`,
              })),
            };
          },
        },
        repos: {
          compareCommits: async (params: any) => {
            compareCalls.push(params);
            return { data: { commits: [], total_commits: 0 } };
          },
        },
      };
      await provider.listPullRequestsInBranchSinceLastMerge(
        "integration",
        "uat",
        [],
      );
      assert.strictEqual(listCalls[0].head, "acme:integration");
      assert.strictEqual(listCalls[0].base, "uat");
      assert.strictEqual(listCalls[0].per_page, 100, "not the first one only");
      assert.strictEqual(compareCalls[0].base, "sha-30");
    });

    test("GitHub: a closed Pull Request that was not merged is not a merge", async () => {
      const compareCalls: any[] = [];
      const provider: any = Object.create(GitProviderGitHub.prototype);
      provider.repoInfo = { owner: "acme", repo: "repo" };
      provider.logApiCall = async () => {};
      provider.gitHubClient = {
        pulls: {
          list: async () => ({
            data: [
              {
                number: 40,
                base: { ref: "uat" },
                head: { ref: "integration" },
                merged_at: null,
                updated_at: "2026-09-20T09:00:00Z",
                merge_commit_sha: "sha-40",
              },
            ],
          }),
        },
        repos: {
          compareCommits: async (params: any) => {
            compareCalls.push(params);
            return { data: { commits: [], total_commits: 0 } };
          },
        },
      };
      await provider.listPullRequestsInBranchSinceLastMerge(
        "integration",
        "uat",
        [],
      );
      // No merge yet: the window is everything integration has that uat does not
      assert.strictEqual(compareCalls[0].base, "uat");
    });

    test("GitLab picks the last merged request, and falls back to the update date only without any merge date", async () => {
      const calls: any[] = [];
      const build = (mergeRequests: any[]) => {
        const provider: any = Object.create(GitProviderGitlab.prototype);
        provider.gitlabProjectId = 42;
        provider.logApiCall = async () => {};
        provider.gitlabClient = {
          MergeRequests: {
            all: async (params: any) => {
              calls.push(params);
              return mergeRequests;
            },
          },
        };
        return provider;
      };
      const last = await build(
        DIRECT_MERGES.map((merge) => ({
          iid: merge.id,
          merged_at: merge.mergedAt,
          updated_at: merge.updatedAt,
        })),
      ).findLastMergedMR("integration", "uat");
      assert.strictEqual(last.iid, 30);
      assert.strictEqual(calls[0].sourceBranch, "integration");
      assert.strictEqual(calls[0].targetBranch, "uat");
      assert.strictEqual(calls[0].state, "merged");
      assert.strictEqual(calls[0].perPage, 100);
      assert.strictEqual(calls[0].maxPages, 1);

      // gitbeaker can camelize the answer
      const camelized = await build(
        DIRECT_MERGES.map((merge) => ({
          iid: merge.id,
          mergedAt: merge.mergedAt,
          updatedAt: merge.updatedAt,
        })),
      ).findLastMergedMR("integration", "uat");
      assert.strictEqual(camelized.iid, 30);

      const withoutMergeDates = await build(
        DIRECT_MERGES.map((merge) => ({
          iid: merge.id,
          updated_at: merge.updatedAt,
        })),
      ).findLastMergedMR("integration", "uat");
      assert.strictEqual(withoutMergeDates.iid, 10);

      assert.strictEqual(
        await build([]).findLastMergedMR("integration", "uat"),
        null,
      );
    });

    test("Azure DevOps picks the Pull Request closed last", async () => {
      const listCalls: any[] = [];
      let commitsCriteria: any;
      const provider = newAzureProviderStub();
      provider.gitApi = {
        getPullRequests: async (
          _repo: string,
          criteria: any,
          _project: string,
          _maxCommentLength: any,
          _skip: number,
          top: number,
        ) => {
          listCalls.push({ criteria, top });
          return DIRECT_MERGES.map((merge) => ({
            pullRequestId: merge.id,
            closedDate: new Date(merge.mergedAt),
            lastMergeSourceCommit: { commitId: `source-${merge.id}` },
          }));
        },
        getCommitsBatch: async (criteria: any) => {
          commitsCriteria = criteria;
          return [];
        },
      };
      // Whatever order the listing comes in: the fixture puts the oldest merge first
      await provider.listPullRequestsInBranchSinceLastMerge(
        "integration",
        "uat",
        [],
      );
      assert.ok(listCalls[0].top > 1, "more than the first one is asked for");
      assert.strictEqual(
        listCalls[0].criteria.sourceRefName,
        "refs/heads/integration",
      );
      assert.strictEqual(commitsCriteria.itemVersion.version, "source-30");
    });

    suite("Bitbucket, where a Pull Request has no merge date", () => {
      const build = (candidates: typeof DIRECT_MERGES) => {
        const calls = {
          list: [] as any[],
          getCommit: [] as string[],
          commits: [] as any[],
        };
        const provider: any = Object.create(GitProviderBitbucket.prototype);
        provider.workspace = "acme";
        provider.repoSlug = "repo";
        provider.logApiCall = async () => {};
        provider.bitbucketClient = {
          pullrequests: {
            list: async (params: any) => {
              calls.list.push(params);
              return {
                data: {
                  values: candidates.map((merge) => ({
                    id: merge.id,
                    // The only date a Bitbucket Pull Request carries
                    updated_on: merge.updatedAt,
                    merge_commit: { hash: `hash-${merge.id}` },
                  })),
                },
              };
            },
          },
          repositories: {
            getCommit: async (params: any) => {
              calls.getCommit.push(params.commit);
              const merge = candidates.find(
                (candidate) => `hash-${candidate.id}` === params.commit,
              );
              return { data: { date: merge?.mergedAt } };
            },
          },
          commits: {
            list: async (params: any) => {
              calls.commits.push(params);
              return { data: { values: [] } };
            },
          },
        };
        return { provider, calls };
      };

      test("the date of each merge commit decides", async () => {
        const { provider, calls } = build(DIRECT_MERGES);
        await provider.listPullRequestsInBranchSinceLastMerge(
          "integration",
          "uat",
          [],
        );
        assert.ok(
          calls.list[0].q.includes('source.branch.name = "integration"'),
          calls.list[0].q,
        );
        assert.ok(
          calls.list[0].q.includes('destination.branch.name = "uat"'),
          calls.list[0].q,
        );
        assert.strictEqual(calls.list[0].pagelen, 50);
        assert.deepStrictEqual([...calls.getCommit].sort(), [
          "hash-10",
          "hash-20",
          "hash-30",
        ]);
        assert.strictEqual(calls.commits[0].exclude, "hash-30");
      });

      test("a single candidate costs no extra call", async () => {
        const { provider, calls } = build([DIRECT_MERGES[0]]);
        await provider.listPullRequestsInBranchSinceLastMerge(
          "integration",
          "uat",
          [],
        );
        assert.deepStrictEqual(calls.getCommit, []);
        assert.strictEqual(calls.commits[0].exclude, "hash-10");
      });

      test("no merge yet: the window is compared with the target branch", async () => {
        const { provider, calls } = build([]);
        await provider.listPullRequestsInBranchSinceLastMerge(
          "integration",
          "uat",
          [],
        );
        assert.strictEqual(calls.commits[0].exclude, "uat");
      });

      test("when no merge commit can be read, the most recently updated stays", async () => {
        const { provider, calls } = build(DIRECT_MERGES);
        provider.bitbucketClient.repositories.getCommit = async () => {
          throw new Error("404 commit not found");
        };
        const logs = await captureLogs(() =>
          provider.listPullRequestsInBranchSinceLastMerge(
            "integration",
            "uat",
            [],
          ),
        );
        assert.strictEqual(calls.commits[0].exclude, "hash-10");
        assert.ok(
          logs.some((log) => log.includes("Unable to read the merge commit")),
          logs.join("\n"),
        );
      });
    });
  },
);

suite("A paged listing is never cut silently", () => {
  suite("GitHub commit comparison", () => {
    const build = (
      compareCommits: (params: any) => Promise<{ data: any }>,
    ): any => {
      const provider: any = Object.create(GitProviderGitHub.prototype);
      provider.repoInfo = { owner: "acme", repo: "repo" };
      provider.logApiCall = async () => {};
      provider.gitHubClient = { repos: { compareCommits } };
      return provider;
    };
    const commitsOfPage = (page: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ sha: `sha-${page}-${i}` }));

    test("walks the pages until every commit of the range is read", async () => {
      // GitHub answers the oldest commits of the range first and no more than a page of them:
      // one call lost the newest ones
      const calls: any[] = [];
      const provider = build(async (params) => {
        calls.push(params);
        return {
          data: {
            total_commits: 250,
            commits: commitsOfPage(params.page, params.page < 3 ? 100 : 50),
          },
        };
      });
      const commits = await provider.compareCommitsPaged("v1", "v2", "test");
      assert.strictEqual(commits.length, 250);
      assert.deepStrictEqual(
        calls.map((call) => call.page),
        [1, 2, 3],
      );
      assert.ok(calls[0].per_page <= 100, "a page size GitHub really serves");
      assert.strictEqual(commits[249].sha, "sha-3-49", "the newest is there");
    });

    test("a short range costs a single call", async () => {
      const calls: any[] = [];
      const provider = build(async (params) => {
        calls.push(params);
        return { data: { total_commits: 3, commits: commitsOfPage(1, 3) } };
      });
      assert.strictEqual(
        (await provider.compareCommitsPaged("v1", "v2", "test")).length,
        3,
      );
      assert.strictEqual(calls.length, 1);
    });

    test("the page cap is logged when it is reached", async () => {
      const calls: any[] = [];
      const provider = build(async (params) => {
        calls.push(params);
        return {
          data: {
            total_commits: 1000000,
            commits: commitsOfPage(params.page, 100),
          },
        };
      });
      let commits: any[] = [];
      const logs = await captureLogs(async () => {
        commits = await provider.compareCommitsPaged("v1", "v2", "the window");
      });
      assert.strictEqual(commits.length, calls.length * 100);
      assert.ok(calls.length > 10, "more than the 1000 commits of one call");
      assert.ok(
        logs.some(
          (log) =>
            log.includes("[the window]") &&
            log.includes(`stopped after ${calls.length} pages`) &&
            log.includes("v1...v2"),
        ),
        logs.join("\n"),
      );
    });

    test("a server that ignores the page parameter does not loop", async () => {
      const calls: any[] = [];
      const provider = build(async (params) => {
        calls.push(params);
        // The same commits again, whatever the page
        return { data: { total_commits: 500, commits: commitsOfPage(1, 100) } };
      });
      const commits = await provider.compareCommitsPaged("v1", "v2", "test");
      assert.strictEqual(commits.length, 100);
      assert.strictEqual(calls.length, 2);
    });
  });

  suite("GitHub and Gitea Pull Request listing", () => {
    const build = (
      prototype: any,
      list: (params: any) => Promise<{ data: any[] }>,
    ): any => {
      const provider: any = Object.create(prototype);
      provider.repoInfo = { owner: "acme", repo: "repo" };
      provider.logApiCall = async () => {};
      provider.gitHubClient = { pulls: { list } };
      // The conversion is a different concern, keep the raw shapes visible to the assertions
      provider.convertAndCollectJobsList = async (prs: any[]) => prs;
      return provider;
    };
    const closed = (
      number: number,
      base: string,
      head: string,
      updatedDaysAgo: number,
    ) => ({
      number,
      base: { ref: base },
      head: { ref: head },
      merged_at: daysAgo(updatedDaysAgo),
      updated_at: daysAgo(updatedDaysAgo),
      merge_commit_sha: `sha-${number}`,
    });
    const PROMOTION = "promotion/integration/uat/2026-09-06-1430";

    test("GitHub: the promotions of a step stopped at the page cap are reported incomplete, and logged", async () => {
      const pages: number[] = [];
      const provider = build(GitProviderGitHub.prototype, async (params) => {
        pages.push(params.page);
        return {
          data: Array.from({ length: 100 }, (_, i) =>
            closed(
              params.page * 100 + i,
              "uat",
              params.page === 1 && i === 0 ? PROMOTION : "feature/x",
              1,
            ),
          ),
        };
      });
      let answer: any;
      const logs = await captureLogs(async () => {
        answer = await provider.listMergedPromotionPullRequests(
          "integration",
          "uat",
        );
      });
      assert.strictEqual(answer.complete, false);
      // What was found before the cap is still returned
      assert.deepStrictEqual(
        answer.pullRequests.map((pr: any) => pr.number),
        [100],
      );
      assert.ok(
        logs.some(
          (log) =>
            log.includes("[listMergedPromotionPullRequests]") &&
            log.includes(`stopped after ${pages.length} pages`) &&
            log.includes("uat"),
        ),
        logs.join("\n"),
      );
    });

    test("GitHub: the window listing logs its page cap too", async () => {
      const provider = build(GitProviderGitHub.prototype, async (params) => ({
        data: Array.from({ length: 100 }, (_, i) =>
          closed(params.page * 100 + i, "integration", "feature/x", 1),
        ),
      }));
      const logs = await captureLogs(() =>
        provider.collectMergedPRsForCommits(
          ["integration"],
          new Set(),
          undefined,
        ),
      );
      assert.ok(
        logs.some(
          (log) =>
            log.includes("[collectMergedPRsForCommits]") &&
            log.includes("stopped after"),
        ),
        logs.join("\n"),
      );
    });

    test("GitHub: a complete listing says so", async () => {
      const provider = build(GitProviderGitHub.prototype, async () => ({
        data: [
          closed(7, "uat", PROMOTION, 1),
          closed(8, "uat", "feature/x", 1),
        ],
      }));
      const answer = await provider.listMergedPromotionPullRequests(
        "integration",
        "uat",
      );
      assert.strictEqual(answer.complete, true);
      assert.deepStrictEqual(
        answer.pullRequests.map((pr: any) => pr.number),
        [7],
      );
    });

    // Gitea answers 10 Pull Requests whatever per_page says, of every base branch, and not
    // sorted by update. Checked on gitea.com.
    const giteaPages: Record<number, any[]> = {
      1: [
        // Older than the bound, and placed before newer ones
        closed(1, "uat", "feature/old", 400),
        closed(2, "main", "feature/elsewhere", 1),
        closed(3, "uat", "feature/y", 2),
      ],
      2: [
        closed(4, "uat", PROMOTION, 3),
        // Named like a promotion of the step, merged into another branch
        closed(5, "main", PROMOTION, 3),
      ],
    };

    test("Gitea: the walk goes on after a short page and after an old Pull Request", async () => {
      const calls: any[] = [];
      const provider = build(GitProviderGitea.prototype, async (params) => {
        calls.push(params);
        return { data: giteaPages[params.page] || [] };
      });
      const answer = await provider.listMergedPromotionPullRequests(
        "integration",
        "uat",
        new Date(Date.now() - 30 * DAY),
      );
      assert.deepStrictEqual(
        calls.map((call) => call.page),
        [1, 2, 3],
        "only an empty page ends the walk",
      );
      assert.ok(calls[0].limit > 10, "the page size Gitea reads is sent");
      assert.strictEqual(answer.complete, true);
      assert.deepStrictEqual(
        answer.pullRequests.map((pr: any) => pr.number),
        [4],
        "the base branch is checked on each Pull Request",
      );
    });

    test("Gitea: the window listing keeps the Pull Requests of its branch only, across pages", async () => {
      const provider = build(GitProviderGitea.prototype, async (params) => ({
        data: giteaPages[params.page] || [],
      }));
      const found = await provider.collectMergedPRsForCommits(
        ["uat"],
        new Set(["sha-2", "sha-3", "sha-4", "sha-5"]),
        new Date(Date.now() - 30 * DAY),
      );
      assert.deepStrictEqual(found.map((pr: any) => pr.number).sort(), [3, 4]);
    });

    test("Gitea: the last merge between two branches is looked for in memory", async () => {
      const compareCalls: any[] = [];
      const provider = build(GitProviderGitea.prototype, async (params) => ({
        data:
          params.page === 1
            ? [
                closed(50, "main", "integration", 1),
                closed(51, "uat", "integration", 200),
                closed(52, "uat", "integration", 20),
                closed(53, "uat", "feature/z", 2),
              ]
            : [],
      }));
      provider.gitHubClient.repos = {
        compareCommits: async (params: any) => {
          compareCalls.push(params);
          return { data: { commits: [], total_commits: 0 } };
        },
      };
      await provider.listPullRequestsInBranchSinceLastMerge(
        "integration",
        "uat",
        [],
      );
      assert.strictEqual(compareCalls[0].base, "sha-52");
    });

    test("the go lives of a branch leave out the Pull Requests of the other branches", async () => {
      const provider = build(GitProviderGitea.prototype, async () => ({
        data: [
          {
            ...closed(60, "main", "preprod", 1),
            title: "go live",
            html_url: "",
          },
          {
            ...closed(61, "uat", "feature/x", 1),
            title: "story",
            html_url: "",
          },
        ],
      }));
      const goLives = await provider.fetchGoLives("main");
      assert.deepStrictEqual(
        goLives.map((goLive: any) => goLive.prNumber),
        [60],
      );
    });
  });

  suite("GitLab", () => {
    test("a listing that fills its last page is reported incomplete, and logged", async () => {
      const calls: any[] = [];
      const provider: any = Object.create(GitProviderGitlab.prototype);
      provider.gitlabProjectId = 42;
      provider.logApiCall = async () => {};
      provider.convertAndCollectJobsList = async (mrs: any[]) => mrs;
      provider.gitlabClient = {
        MergeRequests: {
          all: async (params: any) => {
            calls.push(params);
            return Array.from(
              { length: params.perPage * params.maxPages },
              (_, i) => ({
                iid: i + 1,
                source_branch:
                  i === 0
                    ? "promotion/integration/uat/2026-09-06-1430"
                    : "feature/x",
              }),
            );
          },
        },
      };
      let answer: any;
      const promotionLogs = await captureLogs(async () => {
        answer = await provider.listMergedPromotionPullRequests(
          "integration",
          "uat",
        );
      });
      assert.strictEqual(answer.complete, false);
      assert.deepStrictEqual(
        answer.pullRequests.map((mr: any) => mr.iid),
        [1],
      );
      assert.ok(
        promotionLogs.some(
          (log) =>
            log.includes("[listMergedPromotionPullRequests]") &&
            log.includes(`stopped after ${calls[0].maxPages} pages`),
        ),
        promotionLogs.join("\n"),
      );
      // The window listing goes through the same helper, so it says it as well
      const windowLogs = await captureLogs(() =>
        provider.collectMergedMRsForCommits(["uat"], new Set(), undefined),
      );
      assert.ok(
        windowLogs.some((log) =>
          log.includes("[collectMergedMRsForCommits] stopped after"),
        ),
        windowLogs.join("\n"),
      );
      assert.strictEqual(calls[1].perPage, calls[0].perPage);
      assert.strictEqual(calls[1].maxPages, calls[0].maxPages);
    });

    test("a short answer is complete", async () => {
      const provider: any = Object.create(GitProviderGitlab.prototype);
      provider.gitlabProjectId = 42;
      provider.logApiCall = async () => {};
      provider.convertAndCollectJobsList = async (mrs: any[]) => mrs;
      provider.gitlabClient = { MergeRequests: { all: async () => [] } };
      const answer = await provider.listMergedPromotionPullRequests(
        "integration",
        "uat",
      );
      assert.deepStrictEqual(answer, { pullRequests: [], complete: true });
    });
  });

  suite("Bitbucket", () => {
    const build = (list: (params: any) => Promise<any>): any => {
      const provider: any = Object.create(GitProviderBitbucket.prototype);
      provider.workspace = "acme";
      provider.repoSlug = "repo";
      provider.logApiCall = async () => {};
      provider.convertAndCollectJobsList = async (prs: any[]) => prs;
      provider.bitbucketClient = { pullrequests: { list } };
      return provider;
    };
    // A page that always announces another one
    const endless = async (params: any) => ({
      data: {
        next: "https://api.bitbucket.org/next",
        values: [
          {
            id: params.page,
            source: {
              branch: { name: "promotion/integration/uat/2026-09-06-1430" },
            },
          },
        ],
      },
    });

    test("the page walk logs its cap, naming what was being listed", async () => {
      const provider = build(endless);
      let answer: any;
      const logs = await captureLogs(async () => {
        answer = await provider.fetchAllPages(
          endless,
          {},
          "the commits of uat since abc123",
          3,
        );
      });
      assert.strictEqual(answer.values.length, 3);
      assert.strictEqual(answer.complete, false);
      assert.ok(
        logs.some(
          (log) =>
            log.includes("stopped after 3 pages") &&
            log.includes("the commits of uat since abc123"),
        ),
        logs.join("\n"),
      );
    });

    test("a walk that reaches the last page is complete and logs nothing", async () => {
      const provider = build(endless);
      let answer: any;
      const logs = await captureLogs(async () => {
        answer = await provider.fetchAllPages(
          async (params: any) => ({
            data: {
              next: params.page < 2 ? "more" : undefined,
              values: [{ id: params.page }],
            },
          }),
          {},
          "anything",
        );
      });
      assert.deepStrictEqual(answer, {
        values: [{ id: 1 }, { id: 2 }],
        complete: true,
      });
      assert.deepStrictEqual(logs, []);
    });

    test("the promotions of a step cut at the cap are reported incomplete", async () => {
      const queries: string[] = [];
      const provider = build(async (params) => {
        queries.push(params.q);
        return endless(params);
      });
      let answer: any;
      const logs = await captureLogs(async () => {
        answer = await provider.listMergedPromotionPullRequests(
          "integration",
          "uat",
        );
      });
      assert.strictEqual(answer.complete, false);
      assert.ok(answer.pullRequests.length > 0);
      assert.ok(
        queries[0].includes(
          'source.branch.name ~ "promotion/integration/uat/"',
        ),
        queries[0],
      );
      assert.ok(
        logs.some(
          (log) =>
            log.includes("the Pull Requests merged into uat") &&
            log.includes("listMergedPromotionPullRequests"),
        ),
        logs.join("\n"),
      );
    });
  });
});
