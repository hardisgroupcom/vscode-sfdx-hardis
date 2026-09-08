import * as assert from "assert";
import { GitProviderAzure } from "../../utils/gitProviders/gitProviderAzure";

// Every open Pull Request used to cost its own getBuilds call, so a repository with a hundred open
// Pull Requests made a hundred round trips before the DevOps Pipeline could be drawn. One call now
// brings back the recent Pull Request builds of the project, and only the Pull Requests it does
// not cover still need one of their own.
suite("Azure Pull Request build batching", () => {
  const build = (options: {
    prNumber?: number;
    sourceBranch?: string;
    sourceVersion?: string;
    id?: number;
    name?: string;
  }) => ({
    id: options.id ?? 1,
    definition: { name: options.name ?? "CI" },
    status: 2, // Completed
    result: 2, // Succeeded
    sourceBranch: options.sourceBranch,
    sourceVersion: options.sourceVersion,
    triggerInfo: options.prNumber ? { "pr.number": String(options.prNumber) } : {},
    _links: { web: { href: "https://build/1" } },
    queueTime: new Date("2026-09-08T00:00:00Z"),
    finishTime: new Date("2026-09-08T00:05:00Z"),
  });

  const buildProvider = (
    builds: any[],
    counters: { batch: number; single: number; statuses: number },
  ) => {
    const provider: any = Object.create(GitProviderAzure.prototype);
    provider.repoInfo = {
      owner: "Project",
      repo: "repo",
      remoteUrl: "https://dev.azure.com/acme/Project/_git/repo",
      host: "dev.azure.com",
      webUrl: "https://dev.azure.com/acme/Project/_git/repo",
      providerName: "azure",
    };
    provider.connection = {};
    provider.buildApi = {
      getBuilds: async (...args: any[]) => {
        // The batched call passes no branchName (the last argument of the single-PR call)
        const branchName = args[17];
        if (branchName === undefined) {
          counters.batch++;
          return builds;
        }
        counters.single++;
        return builds.filter((b) => b.sourceBranch === branchName);
      },
    };
    provider.gitApi = {
      getPullRequestStatuses: async () => {
        counters.statuses++;
        return [];
      },
    };
    provider.logApiCall = async () => {};
    return provider;
  };

  const rawPr = (number: number, commitId?: string) => ({
    pullRequestId: number,
    title: `PR ${number}`,
    description: "",
    status: "active",
    sourceRefName: `refs/heads/feature/${number}`,
    targetRefName: "refs/heads/integration",
    lastMergeSourceCommit: commitId ? { commitId } : undefined,
  });

  test("reads the builds of many Pull Requests in a single call", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const builds = [1, 2, 3, 4].map((n) =>
      build({ prNumber: n, sourceBranch: `refs/pull/${n}/merge`, id: n }),
    );
    const provider = buildProvider(builds, counters);

    const prs = await provider.convertAndCollectJobsList(
      [rawPr(1), rawPr(2), rawPr(3), rawPr(4)],
      "integration",
      { withJobs: true },
    );

    assert.strictEqual(counters.batch, 1, "exactly one batched call");
    assert.strictEqual(counters.single, 0, "no per Pull Request call was needed");
    assert.strictEqual(prs.length, 4);
    for (const pr of prs) {
      assert.strictEqual(pr.jobsStatus, "success", `PR #${pr.number}`);
    }
  });

  // The batched index can match on the merge ref alone, which the per Pull Request path cannot:
  // there, a build carrying neither trigger info nor a source version is not attributed
  test("matches a build by its merge ref when the trigger info is missing", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const builds = [
      build({ sourceBranch: "refs/pull/7/merge", id: 7 }), // no triggerInfo
      build({ prNumber: 8, sourceBranch: "refs/pull/8/merge", id: 8 }),
    ];
    const provider = buildProvider(builds, counters);

    const prs = await provider.convertAndCollectJobsList(
      [rawPr(7), rawPr(8)],
      "integration",
      { withJobs: true },
    );

    assert.strictEqual(counters.batch, 1);
    assert.strictEqual(prs[0].jobsStatus, "success", "matched on refs/pull/7/merge");
    assert.strictEqual(prs[1].jobsStatus, "success");
  });

  test("matches a build by the commit it built", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const builds = [build({ sourceVersion: "ABCDEF", id: 9 })];
    const provider = buildProvider(builds, counters);

    const prs = await provider.convertAndCollectJobsList(
      [rawPr(9, "abcdef"), rawPr(10, "999999")],
      "integration",
      { withJobs: true },
    );

    assert.strictEqual(prs[0].jobsStatus, "success", "matched on the commit id");
    // #10 is not in the batch, so it falls back to its own call and then to the statuses
    assert.strictEqual(prs[1].jobsStatus, "unknown");
  });

  test("falls back to a dedicated call only for the Pull Requests the batch misses", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const builds = [
      build({ prNumber: 1, sourceBranch: "refs/pull/1/merge", id: 1 }),
      // #2 is older than the batch window and only reachable by its own call
      build({ sourceBranch: "refs/pull/2/merge", id: 2, prNumber: 2 }),
    ];
    // The batch only returns the first one; the single call can still find the second
    const provider = buildProvider(builds, counters);
    provider.buildApi.getBuilds = async (...args: any[]) => {
      const branchName = args[17];
      if (branchName === undefined) {
        counters.batch++;
        return [builds[0]];
      }
      counters.single++;
      return builds.filter((b) => b.sourceBranch === branchName);
    };

    const prs = await provider.convertAndCollectJobsList(
      [rawPr(1), rawPr(2)],
      "integration",
      { withJobs: true },
    );

    assert.strictEqual(counters.batch, 1);
    assert.strictEqual(counters.single, 1, "only the uncovered Pull Request pays a call");
    assert.strictEqual(prs[0].jobsStatus, "success");
    assert.strictEqual(prs[1].jobsStatus, "success");
  });

  test("does not batch for a single Pull Request", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const builds = [build({ prNumber: 3, sourceBranch: "refs/pull/3/merge" })];
    const provider = buildProvider(builds, counters);

    await provider.convertAndCollectJobsList([rawPr(3)], "integration", {
      withJobs: true,
    });

    assert.strictEqual(counters.batch, 0, "one Pull Request is cheaper asked for directly");
    assert.strictEqual(counters.single, 1);
  });

  test("makes no build call at all when jobs are not requested", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const provider = buildProvider([], counters);

    await provider.convertAndCollectJobsList([rawPr(1), rawPr(2)], "integration", {
      withJobs: false,
    });

    assert.strictEqual(counters.batch, 0);
    assert.strictEqual(counters.single, 0);
  });

  test("a failing batch call degrades to the per Pull Request path", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const builds = [
      build({ prNumber: 1, sourceBranch: "refs/pull/1/merge" }),
      build({ prNumber: 2, sourceBranch: "refs/pull/2/merge" }),
    ];
    const provider = buildProvider(builds, counters);
    provider.buildApi.getBuilds = async (...args: any[]) => {
      const branchName = args[17];
      if (branchName === undefined) {
        counters.batch++;
        throw new Error("the batch is refused");
      }
      counters.single++;
      return builds.filter((b) => b.sourceBranch === branchName);
    };

    const prs = await provider.convertAndCollectJobsList(
      [rawPr(1), rawPr(2)],
      "integration",
      { withJobs: true },
    );

    assert.strictEqual(counters.single, 2, "every Pull Request falls back");
    assert.strictEqual(prs[0].jobsStatus, "success");
    assert.strictEqual(prs[1].jobsStatus, "success");
  });

  test("the index is dropped on demand, so a running build is re-read", async () => {
    const counters = { batch: 0, single: 0, statuses: 0 };
    const builds = [1, 2].map((n) =>
      build({ prNumber: n, sourceBranch: `refs/pull/${n}/merge`, id: n }),
    );
    const provider = buildProvider(builds, counters);

    await provider.convertAndCollectJobsList([rawPr(1), rawPr(2)], "integration", {
      withJobs: true,
    });
    assert.strictEqual(counters.batch, 1);

    // Without the reset, a second pass reuses the index and asks for nothing
    await provider.convertAndCollectJobsList([rawPr(1), rawPr(2)], "integration", {
      withJobs: true,
    });
    assert.strictEqual(counters.batch, 1, "the index is reused within a refresh");

    provider.resetPullRequestBuildIndex();
    await provider.convertAndCollectJobsList([rawPr(1), rawPr(2)], "integration", {
      withJobs: true,
    });
    assert.strictEqual(counters.batch, 2, "the reset forces a new batch");
  });
});
