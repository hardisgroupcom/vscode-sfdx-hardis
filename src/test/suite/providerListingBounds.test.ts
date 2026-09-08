import * as assert from "assert";
import { GitProviderGitHub } from "../../utils/gitProviders/gitProviderGitHub";
import { GitProviderGitlab } from "../../utils/gitProviders/gitProviderGitlab";
import { GitProviderBitbucket } from "../../utils/gitProviders/gitProviderBitbucket";

// A branch window only ever needs the Pull Requests touched since its oldest commit, yet each
// provider used to read the whole merged history of every branch, all branches at once. These
// tests pin the two properties that keep that cheap: the listing carries a time bound, and the
// fan-out is queued instead of fired in one burst.
suite("Pull Request listing bounds and fan-out", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const iso = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * DAY).toISOString();

  // Records how many list calls were in flight at the same time
  const inFlightTracker = () => {
    const state = { current: 0, peak: 0 };
    return {
      state,
      async run<T>(fn: () => Promise<T>): Promise<T> {
        state.current++;
        state.peak = Math.max(state.peak, state.current);
        await new Promise((resolve) => setTimeout(resolve, 2));
        state.current--;
        return await fn();
      },
    };
  };

  const manyBranches = Array.from({ length: 30 }, (_, i) => `branch-${i}`);

  suite("GitHub", () => {
    const buildProvider = (list: (params: any) => Promise<{ data: any[] }>) => {
      const provider: any = Object.create(GitProviderGitHub.prototype);
      provider.repoInfo = { owner: "acme", repo: "repo" };
      provider.gitHubClient = { pulls: { list } };
      provider.logApiCall = async () => {};
      // The conversion is a different concern, keep the raw shapes visible to the assertions
      provider.convertAndCollectJobsList = async (prs: any[]) => prs;
      return provider;
    };

    test("asks for the largest page GitHub actually serves, newest updates first", async () => {
      const calls: any[] = [];
      const provider = buildProvider(async (params) => {
        calls.push(params);
        return { data: [] };
      });
      await provider.collectMergedPRsForCommits(
        ["integration"],
        new Set(),
        undefined,
      );
      assert.strictEqual(calls.length, 1);
      // per_page 1000 was silently truncated to 100, which made a partial answer look complete
      assert.strictEqual(calls[0].per_page, 100);
      assert.strictEqual(calls[0].sort, "updated");
      assert.strictEqual(calls[0].direction, "desc");
    });

    test("walks past the first page instead of stopping at 100", async () => {
      const pages: number[] = [];
      const pr = (n: number) => ({
        number: n,
        merged_at: iso(1),
        updated_at: iso(1),
        merge_commit_sha: `sha-${n}`,
      });
      const provider = buildProvider(async (params) => {
        pages.push(params.page);
        // Two full pages then a short one
        if (params.page <= 2) {
          return {
            data: Array.from({ length: 100 }, (_, i) =>
              pr(params.page * 100 + i),
            ),
          };
        }
        return { data: [pr(9001)] };
      });
      const wanted = new Set(["sha-9001"]);
      const found = await provider.collectMergedPRsForCommits(
        ["integration"],
        wanted,
        undefined,
      );
      assert.deepStrictEqual(pages, [1, 2, 3]);
      assert.strictEqual(
        found.length,
        1,
        "the match lived past the first page",
      );
    });

    test("stops at the first Pull Request older than the window", async () => {
      const pages: number[] = [];
      const provider = buildProvider(async (params) => {
        pages.push(params.page);
        const old = params.page >= 2;
        return {
          data: Array.from({ length: 100 }, (_, i) => ({
            number: params.page * 100 + i,
            merged_at: iso(old ? 400 : 1),
            updated_at: iso(old ? 400 : 1),
            merge_commit_sha: `sha-${params.page}-${i}`,
          })),
        };
      });
      await provider.collectMergedPRsForCommits(
        ["integration"],
        new Set(),
        new Date(Date.now() - 30 * DAY),
      );
      assert.deepStrictEqual(
        pages,
        [1, 2],
        "page 2 is entirely older than the window, so there is no page 3 to read",
      );
    });

    test("queues the per branch listings instead of firing them all at once", async () => {
      const tracker = inFlightTracker();
      const provider = buildProvider(async () =>
        tracker.run(async () => ({ data: [] })),
      );
      await provider.collectMergedPRsForCommits(
        manyBranches,
        new Set(),
        undefined,
      );
      assert.ok(
        tracker.state.peak < manyBranches.length,
        `all ${manyBranches.length} listings were in flight at once`,
      );
    });
  });

  suite("GitLab", () => {
    const buildProvider = (all: (params: any) => Promise<any[]>) => {
      const provider: any = Object.create(GitProviderGitlab.prototype);
      provider.gitlabProjectId = 42;
      provider.gitlabClient = { MergeRequests: { all } };
      provider.logApiCall = async () => {};
      provider.convertAndCollectJobsList = async (mrs: any[]) => mrs;
      return provider;
    };

    test("bounds the listing in time and in pages", async () => {
      const calls: any[] = [];
      const provider = buildProvider(async (params) => {
        calls.push(params);
        return [];
      });
      const since = new Date(Date.now() - 30 * DAY);
      await provider.collectMergedMRsForCommits(
        ["integration"],
        new Set(),
        since,
      );
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].updatedAfter, since.toISOString());
      // gitbeaker walks every page unless it is told not to
      assert.ok(calls[0].maxPages > 0, "a page cap must be sent to gitbeaker");
    });

    test("still works when the window has no dated commit", async () => {
      const calls: any[] = [];
      const provider = buildProvider(async (params) => {
        calls.push(params);
        return [];
      });
      await provider.collectMergedMRsForCommits(
        ["integration"],
        new Set(),
        undefined,
      );
      assert.strictEqual(calls[0].updatedAfter, undefined);
    });

    test("queues the per branch listings instead of firing them all at once", async () => {
      const tracker = inFlightTracker();
      const provider = buildProvider(async () => tracker.run(async () => []));
      await provider.collectMergedMRsForCommits(
        manyBranches,
        new Set(),
        undefined,
      );
      assert.ok(
        tracker.state.peak < manyBranches.length,
        `all ${manyBranches.length} listings were in flight at once`,
      );
    });

    test("the margin puts the bound before the oldest commit of the window", () => {
      const provider: any = Object.create(GitProviderGitlab.prototype);
      const oldest = new Date(Date.now() - 10 * DAY);
      const bound = provider.oldestCommitDateWithMargin([
        { created_at: new Date().toISOString() },
        { created_at: oldest.toISOString() },
      ]);
      assert.ok(bound instanceof Date);
      assert.ok(
        bound.getTime() < oldest.getTime(),
        "the bound must sit before the oldest commit, not on it",
      );
    });
  });

  suite("Bitbucket", () => {
    const buildProvider = (list: (params: any) => Promise<any>) => {
      const provider: any = Object.create(GitProviderBitbucket.prototype);
      provider.workspace = "acme";
      provider.repoSlug = "repo";
      provider.bitbucketClient = { pullrequests: { list } };
      provider.logApiCall = async () => {};
      provider.convertAndCollectJobsList = async (prs: any[]) => prs;
      return provider;
    };

    test("carries the time bound in the query", async () => {
      const queries: string[] = [];
      const provider = buildProvider(async (params) => {
        queries.push(params.q);
        return { data: { values: [] } };
      });
      const since = new Date(Date.now() - 30 * DAY);
      await provider.collectMergedPRsForCommits(["integration"], [], since);
      assert.strictEqual(queries.length, 1);
      assert.ok(queries[0].includes('state = "MERGED"'), queries[0]);
      assert.ok(
        queries[0].includes(`updated_on >= "${since.toISOString()}"`),
        `the query must bound the merged history: ${queries[0]}`,
      );
    });

    test("leaves the query alone when the window has no dated commit", async () => {
      const queries: string[] = [];
      const provider = buildProvider(async (params) => {
        queries.push(params.q);
        return { data: { values: [] } };
      });
      await provider.collectMergedPRsForCommits(["integration"], [], undefined);
      assert.ok(!queries[0].includes("updated_on"), queries[0]);
    });

    test("queues the per branch page walks instead of firing them all at once", async () => {
      const tracker = inFlightTracker();
      const provider = buildProvider(async () =>
        tracker.run(async () => ({ data: { values: [] } })),
      );
      await provider.collectMergedPRsForCommits(manyBranches, [], undefined);
      assert.ok(
        tracker.state.peak < manyBranches.length,
        `all ${manyBranches.length} page walks were in flight at once`,
      );
    });
  });
});
