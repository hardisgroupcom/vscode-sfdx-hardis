import * as assert from "assert";
import { GitProviderAzure } from "../../utils/gitProviders/gitProviderAzure";

// Azure DevOps truncates the description of a Pull Request returned by the LIST API at 400
// characters and says nothing about it. The DevOps Pipeline reads the promotionPullRequests
// declaration of a promotion branch out of that description, and it sits below the navigation
// block and the introduction: on a promotion carrying more than a story or two it is cut off, the
// promotion expands into nothing and its stories are never marked as already promoted.
suite("GitProviderAzure list description truncation", () => {
  // Reaches the private helper without going near the network
  const complete = async (
    provider: any,
    rawPrs: any[],
  ): Promise<any[]> => provider.completeTruncatedDescriptions(rawPrs);

  const buildProvider = (
    getPullRequestById: (id: number, project: string) => Promise<any>,
    calls: number[] = [],
  ) => {
    const provider = Object.create(GitProviderAzure.prototype);
    provider.repoInfo = { owner: "acme", repo: "sfdx-project" };
    provider.gitApi = {
      getPullRequestById: async (id: number, project: string) => {
        calls.push(id);
        return getPullRequestById(id, project);
      },
    };
    return provider;
  };

  test("reads the full Pull Request when the listed description could have been cut", async () => {
    const truncated = "x".repeat(400);
    const full =
      truncated + "\n\n```yaml\npromotionPullRequests: [12, 34]\n```";
    const calls: number[] = [];
    const provider = buildProvider(async () => ({ description: full }), calls);

    const completed = await complete(provider, [
      { pullRequestId: 77, description: truncated },
    ]);

    assert.deepStrictEqual(calls, [77]);
    assert.strictEqual(completed[0].description, full);
  });

  test("keeps every other property of the listed Pull Request", async () => {
    const truncated = "y".repeat(420);
    const provider = buildProvider(async () => ({
      description: truncated + " and the rest",
    }));

    const completed = await complete(provider, [
      {
        pullRequestId: 5,
        description: truncated,
        sourceRefName: "refs/heads/promotion/uat/preprod/2026-09-08-1",
        lastMergeCommit: { commitId: "abc1234" },
      },
    ]);

    assert.strictEqual(
      completed[0].sourceRefName,
      "refs/heads/promotion/uat/preprod/2026-09-08-1",
    );
    assert.strictEqual(completed[0].lastMergeCommit.commitId, "abc1234");
    assert.strictEqual(completed[0].description, truncated + " and the rest");
  });

  test("does not call the API for a description short enough to be complete", async () => {
    const calls: number[] = [];
    const provider = buildProvider(
      async () => ({ description: "never read" }),
      calls,
    );

    const completed = await complete(provider, [
      { pullRequestId: 5, description: "short one" },
    ]);

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(completed[0].description, "short one");
  });

  test("keeps the listed description when the API answers with a shorter one", async () => {
    const truncated = "z".repeat(405);
    const provider = buildProvider(async () => ({ description: "shorter" }));

    const completed = await complete(provider, [
      { pullRequestId: 5, description: truncated },
    ]);

    assert.strictEqual(completed[0].description, truncated);
  });

  test("keeps the listed description when the API call fails", async () => {
    const truncated = "w".repeat(400);
    const provider = buildProvider(async () => {
      throw new Error("TF401019");
    });

    const completed = await complete(provider, [
      { pullRequestId: 5, description: truncated },
    ]);

    assert.strictEqual(completed[0].description, truncated);
  });

  test("handles a Pull Request listed without a description", async () => {
    const calls: number[] = [];
    const provider = buildProvider(async () => ({}), calls);

    const completed = await complete(provider, [{ pullRequestId: 5 }]);

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(completed[0].description, undefined);
  });

  test("completes several Pull Requests in one pass", async () => {
    const truncated = "q".repeat(400);
    const calls: number[] = [];
    const provider = buildProvider(
      async (id: number) => ({ description: `${truncated} full of ${id}` }),
      calls,
    );

    const completed = await complete(provider, [
      { pullRequestId: 1, description: truncated },
      { pullRequestId: 2, description: "short" },
      { pullRequestId: 3, description: truncated },
    ]);

    assert.deepStrictEqual(calls.sort(), [1, 3]);
    assert.ok(completed[0].description.endsWith("full of 1"));
    assert.strictEqual(completed[1].description, "short");
    assert.ok(completed[2].description.endsWith("full of 3"));
  });
});
