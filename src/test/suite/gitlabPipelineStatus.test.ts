import * as assert from "assert";
import { GitProviderGitlab } from "../../utils/gitProviders/gitProviderGitlab";

/**
 * Which pipeline says what a GitLab merge request's CI is doing, when several ran on its head
 * commit.
 *
 * The first case is a real pair taken from a project: a promotion branch is pushed to the server,
 * so it runs its own branch pipeline (`push`, a deployment job) next to the detached merge request
 * pipeline (`merge_request_event`, the validation jobs). GitLab shows the merge request one, which
 * was green, while the DevOps Pipeline diagram drew the chip red because it reported the worst of
 * the two.
 *
 * The provider methods are private and the class needs no API here, so the suite drives them on a
 * bare prototype, like the Azure suites do with newAzureProviderStub.
 */
const provider: any = Object.create(GitProviderGitlab.prototype);

function pipeline(overrides: {
  id: number;
  status: string;
  source: string;
  updated_at?: string;
}): any {
  return {
    ref: "some-branch",
    web_url: `https://gitlab.example.com/pipelines/${overrides.id}`,
    updated_at: "2026-09-08T20:00:00.000Z",
    ...overrides,
  };
}

suite("GitLab pipeline status of a merge request", () => {
  test("keeps the merge request pipeline when a branch pipeline failed on the same commit", () => {
    const chosen = provider.pickMergeRequestPipeline([
      pipeline({
        id: 390815,
        status: "success",
        source: "merge_request_event",
        updated_at: "2026-09-08T20:54:30.256Z",
      }),
      pipeline({
        id: 390814,
        status: "failed",
        source: "push",
        updated_at: "2026-09-08T20:49:55.034Z",
      }),
    ]);
    assert.strictEqual(chosen.id, 390815);
  });

  test("keeps the merge request pipeline when it is the failing one", () => {
    const chosen = provider.pickMergeRequestPipeline([
      pipeline({
        id: 2,
        status: "failed",
        source: "merge_request_event",
        updated_at: "2026-09-08T21:00:00.000Z",
      }),
      pipeline({
        id: 1,
        status: "success",
        source: "push",
        updated_at: "2026-09-08T20:00:00.000Z",
      }),
    ]);
    assert.strictEqual(chosen.status, "failed");
  });

  test("keeps the newest merge request pipeline when a run was retried", () => {
    const chosen = provider.pickMergeRequestPipeline([
      pipeline({
        id: 10,
        status: "failed",
        source: "merge_request_event",
        updated_at: "2026-09-08T20:00:00.000Z",
      }),
      pipeline({
        id: 11,
        status: "success",
        source: "merge_request_event",
        updated_at: "2026-09-08T21:00:00.000Z",
      }),
    ]);
    assert.strictEqual(chosen.id, 11);
  });

  test("falls back to the newest pipeline when the project runs no merge request pipelines", () => {
    const chosen = provider.pickMergeRequestPipeline([
      pipeline({
        id: 20,
        status: "failed",
        source: "push",
        updated_at: "2026-09-08T20:00:00.000Z",
      }),
      pipeline({
        id: 21,
        status: "success",
        source: "push",
        updated_at: "2026-09-08T21:00:00.000Z",
      }),
    ]);
    assert.strictEqual(chosen.id, 21);
  });

  test("does not trust the order the API answered in", () => {
    const chosen = provider.newestPipeline([
      pipeline({
        id: 30,
        status: "failed",
        source: "push",
        updated_at: "2026-09-01T10:00:00.000Z",
      }),
      pipeline({
        id: 31,
        status: "success",
        source: "push",
        updated_at: "2026-09-08T10:00:00.000Z",
      }),
    ]);
    assert.strictEqual(chosen.id, 31);
  });

  test("answers nothing when no pipeline ran, so the chip stays unknown instead of green", () => {
    assert.strictEqual(provider.pickMergeRequestPipeline([]), null);
    assert.strictEqual(provider.pickMergeRequestPipeline(undefined), null);
  });

  // The deployment status of a major branch is read by getJobsForBranchLatestCommit, which filters
  // the merge request pipelines out before asking for the newest one: the validation pipeline of a
  // merge request open on that branch must never be mistaken for its deployment.
  test("a deployment status is read from the branch pipelines only", () => {
    const pipelines = [
      pipeline({
        id: 41,
        status: "failed",
        source: "merge_request_event",
        updated_at: "2026-09-08T22:00:00.000Z",
      }),
      pipeline({
        id: 40,
        status: "success",
        source: "push",
        updated_at: "2026-09-08T21:00:00.000Z",
      }),
    ];
    const commitPipelines = pipelines.filter(
      (p) => p.source !== "merge_request_event",
    );
    const chosen = provider.newestPipeline(commitPipelines);
    assert.strictEqual(chosen.id, 40);
    assert.strictEqual(chosen.status, "success");
  });
});
