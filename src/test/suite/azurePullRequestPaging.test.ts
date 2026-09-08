import * as assert from "assert";
import { newAzureProviderStub } from "./azureProviderStub";

// Azure DevOps applies its own default page size (about 100) when no $top is passed, and the node
// API sends none unless it is given one. Every listing was therefore silently capped at that first
// page, with no way to tell a full answer from a truncated one: on a repository with thousands of
// Pull Requests a branch window could simply miss the ones it needed.
suite("Azure Pull Request listing bounds", () => {
  const buildProvider = (
    pagesByCall: (criteria: any, skip: number, top: number) => any[],
    calls: { criteria: any; skip: number; top: number }[] = [],
  ) => {
    const provider = newAzureProviderStub();
    provider.gitApi = {
      getPullRequests: async (
        _repo: string,
        criteria: any,
        _project: string,
        _maxCommentLength: any,
        skip: number,
        top: number,
      ) => {
        calls.push({ criteria, skip, top });
        return pagesByCall(criteria, skip, top);
      },
    };
    return provider;
  };

  const pullRequest = (id: number) => ({
    pullRequestId: id,
    title: `PR ${id}`,
    sourceRefName: "refs/heads/feature/x",
    targetRefName: "refs/heads/integration",
    status: "completed",
  });

  test("always asks for an explicit page size", async () => {
    const calls: any[] = [];
    const provider = buildProvider(() => [], calls);
    await provider.listPullRequestsPaged({ status: 3 }, "test");
    assert.strictEqual(calls.length, 1);
    assert.ok(
      calls[0].top > 0,
      "a $top must be sent, not left to the server default",
    );
  });

  test("walks the pages until a short one", async () => {
    const calls: any[] = [];
    // Two full pages then a short one
    const provider = buildProvider((_criteria, skip, top) => {
      if (skip === 0 || skip === top) {
        return Array.from({ length: top }, (_, i) => pullRequest(skip + i));
      }
      return [pullRequest(9999)];
    }, calls);

    const all = await provider.listPullRequestsPaged({ status: 3 }, "test");

    assert.strictEqual(calls.length, 3, "two full pages and the short one");
    assert.strictEqual(all.length, calls[0].top * 2 + 1);
    assert.strictEqual(
      calls[1].skip,
      calls[0].top,
      "the skip advances by one page",
    );
  });

  test("stops at the hard cap rather than crawling forever", async () => {
    const calls: any[] = [];
    // Every page is full: without a cap this would never end
    const provider = buildProvider(
      (_criteria, skip, top) =>
        Array.from({ length: top }, (_, i) => pullRequest(skip + i)),
      calls,
    );

    await provider.listPullRequestsPaged({ status: 3 }, "test");

    assert.ok(calls.length <= 20, `stopped after ${calls.length} pages`);
    assert.ok(calls.length > 1, "but it does page");
  });

  test("an empty first page ends the walk", async () => {
    const calls: any[] = [];
    const provider = buildProvider(() => [], calls);
    const all = await provider.listPullRequestsPaged({ status: 3 }, "test");
    assert.strictEqual(all.length, 0);
    assert.strictEqual(calls.length, 1);
  });

  suite("the time bound of a branch window", () => {
    test("bounds the listing to the Pull Requests closed since the oldest commit", async () => {
      const calls: any[] = [];
      const provider = buildProvider(() => [], calls);
      const oldest = new Date("2026-01-10T00:00:00Z");

      await provider.collectMergedPRsForCommits(
        ["integration"],
        new Set(["abc"]),
        "integration",
        oldest,
      );

      assert.strictEqual(calls[0].criteria.minTime.getTime(), oldest.getTime());
      // 2 = Closed: a Pull Request that carried a commit of the window cannot have closed before it
      assert.strictEqual(calls[0].criteria.queryTimeRangeType, 2);
    });

    test("asks without a time bound when the commits carry no date", async () => {
      const calls: any[] = [];
      const provider = buildProvider(() => [], calls);

      await provider.collectMergedPRsForCommits(
        ["integration"],
        new Set(["abc"]),
        "integration",
        undefined,
      );

      assert.strictEqual(calls[0].criteria.minTime, undefined);
      assert.strictEqual(calls[0].criteria.queryTimeRangeType, undefined);
    });

    test("takes the oldest commit and widens it by a margin", () => {
      const provider = buildProvider(() => []);
      const commits = [
        { committer: { date: "2026-03-01T00:00:00Z" } },
        { committer: { date: "2026-02-01T00:00:00Z" } },
        { author: { date: "2026-04-01T00:00:00Z" } },
      ];
      const bound: Date = provider.oldestCommitDateWithMargin(commits);
      const oldest = new Date("2026-02-01T00:00:00Z").getTime();
      assert.ok(
        bound.getTime() < oldest,
        "the bound must be widened, not exact",
      );
      const marginDays = (oldest - bound.getTime()) / (24 * 60 * 60 * 1000);
      assert.ok(
        marginDays >= 1 && marginDays <= 30,
        `margin was ${marginDays} days`,
      );
    });

    test("falls back to the author date when there is no committer date", () => {
      const provider = buildProvider(() => []);
      const bound = provider.oldestCommitDateWithMargin([
        { author: { date: "2026-05-05T00:00:00Z" } },
      ]);
      assert.ok(bound instanceof Date);
    });

    test("returns nothing usable when no commit carries a date", () => {
      const provider = buildProvider(() => []);
      assert.strictEqual(
        provider.oldestCommitDateWithMargin([{}, { author: {} }]),
        undefined,
      );
      assert.strictEqual(provider.oldestCommitDateWithMargin([]), undefined);
    });
  });
});
