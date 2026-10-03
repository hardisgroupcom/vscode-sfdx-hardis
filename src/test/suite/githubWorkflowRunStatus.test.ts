import * as assert from "assert";
import { GitProviderGitHub } from "../../utils/gitProviders/gitProviderGitHub";

/**
 * What the DevOps Pipeline diagram says about GitHub Actions runs (vscode-sfdx-hardis#529).
 *
 * The issue: the deployment run of preprod failed, after a re-run, and the arrow from preprod to
 * its org still carried a green check. A finished run always has the status "completed" and keeps
 * how it ended in its conclusion, and the provider read the status first: every finished run was
 * green.
 *
 * With that fixed, the latest commit of a major branch would also have drawn its arrow red for
 * runs that are not its deployment: MegaLinter, and the checks of a Pull Request open from the
 * branch toward the next one, which run on the same commit. The arrow shows the deployment only,
 * like GitLab, Azure and Bitbucket already do.
 *
 * The provider methods are private and need no real client: the suite drives them on a bare
 * prototype with a stubbed Octokit, like providerListingBounds.test.ts does.
 */

const DEPLOYMENT = "Process Deployment (sfdx-hardis)";
const SIMULATION = "Simulate Deployment (sfdx-hardis)";
const MEGALINTER = "Mega-Linter";
const LATEST_COMMIT = "5bccb39";

let lastRunId = 0;

// A GitHub workflow run: by default the deployment of preprod, finished and successful
function run(overrides: Record<string, any> = {}): any {
  lastRunId++;
  return {
    id: lastRunId,
    name: DEPLOYMENT,
    event: "push",
    head_branch: "preprod",
    head_sha: LATEST_COMMIT,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    created_at: "2026-09-25T08:00:00Z",
    updated_at: "2026-09-25T08:02:24Z",
    html_url: `https://github.com/acme/repo/actions/runs/${lastRunId}`,
    ...overrides,
  };
}

function buildProvider(runs: any[], commitStatuses: any[] = []) {
  const calls = { workflowRuns: [] as any[], commitStatuses: 0 };
  const provider: any = Object.create(GitProviderGitHub.prototype);
  provider.repoInfo = { owner: "acme", repo: "repo" };
  provider.logApiCall = async () => {};
  provider.gitHubClient = {
    repos: {
      listCommits: async () => ({ data: [{ sha: LATEST_COMMIT }] }),
      listCommitStatusesForRef: async () => {
        calls.commitStatuses++;
        return { data: commitStatuses };
      },
    },
    actions: {
      listWorkflowRunsForRepo: async (params: any) => {
        calls.workflowRuns.push(params);
        return { data: { total_count: runs.length, workflow_runs: runs } };
      },
    },
  };
  return { provider, calls };
}

// The status the diagram gives to one run
function statusOf(overrides: Record<string, any>): string {
  const { provider } = buildProvider([]);
  return provider.mapWorkflowRunsToJobs([run(overrides)])[0].status;
}

async function deploymentOf(runs: any[]) {
  const { provider } = buildProvider(runs);
  return await provider.getJobsForBranchLatestCommit("preprod");
}

const namesOf = (jobs: any[]) => jobs.map((job) => job.name);

suite("GitHub Actions runs in the DevOps Pipeline", () => {
  suite("status of one run", () => {
    test("a failed run is failed, not green", () => {
      // The run of the issue: the push of preprod, run again, failed again
      assert.strictEqual(
        statusOf({
          status: "completed",
          conclusion: "failure",
          run_attempt: 2,
        }),
        "failed",
      );
    });

    test("a cancelled or timed out run, or one that could not start, is failed", () => {
      for (const conclusion of ["cancelled", "timed_out", "startup_failure"]) {
        assert.strictEqual(statusOf({ conclusion }), "failed", conclusion);
      }
    });

    test("a successful run is green", () => {
      assert.strictEqual(statusOf({ conclusion: "success" }), "success");
    });

    test("a run in progress is running, a queued or waiting one is pending", () => {
      assert.strictEqual(
        statusOf({ status: "in_progress", conclusion: null }),
        "running",
      );
      for (const status of ["queued", "pending", "waiting", "requested"]) {
        assert.strictEqual(
          statusOf({ status, conclusion: null }),
          "pending",
          status,
        );
      }
    });

    test("a run waiting for someone to approve it is pending", () => {
      assert.strictEqual(
        statusOf({ conclusion: "action_required" }),
        "pending",
      );
    });

    test("a finished run that did not pass is never green", () => {
      for (const conclusion of ["skipped", "neutral", "stale", null]) {
        assert.strictEqual(
          statusOf({ conclusion }),
          "unknown",
          String(conclusion),
        );
      }
    });

    test("a run without a status still says how it ended", () => {
      assert.strictEqual(
        statusOf({ status: null, conclusion: "failure" }),
        "failed",
      );
    });

    test("a run started again is running, whatever its previous attempt said", () => {
      assert.strictEqual(
        statusOf({
          status: "in_progress",
          conclusion: "failure",
          run_attempt: 2,
        }),
        "running",
      );
    });
  });

  suite("deployment status of a major branch", () => {
    test("a failed deployment is red when MegaLinter and the Pull Request checks passed", async () => {
      const result = await deploymentOf([
        run({ name: SIMULATION, event: "pull_request" }),
        run({ name: MEGALINTER, event: "pull_request" }),
        run({ name: MEGALINTER }),
        run({ conclusion: "failure", run_attempt: 2 }),
      ]);
      assert.strictEqual(result.jobsStatus, "failed");
      assert.deepStrictEqual(namesOf(result.jobs), [DEPLOYMENT]);
    });

    test("a deployment that worked stays green when MegaLinter failed on the push", async () => {
      const result = await deploymentOf([
        run({ name: MEGALINTER, conclusion: "failure" }),
        run(),
      ]);
      assert.strictEqual(result.jobsStatus, "success");
      assert.deepStrictEqual(namesOf(result.jobs), [DEPLOYMENT]);
    });

    test("the checks of a Pull Request toward the next branch do not count", async () => {
      // Opened from preprod toward main, they run on the same commit
      const failed = await deploymentOf([
        run({ name: SIMULATION, event: "pull_request", conclusion: "failure" }),
        run(),
      ]);
      assert.strictEqual(failed.jobsStatus, "success");
      const running = await deploymentOf([
        run({
          name: SIMULATION,
          event: "pull_request",
          status: "in_progress",
          conclusion: null,
        }),
        run(),
      ]);
      assert.strictEqual(running.jobsStatus, "success");
    });

    test("a run of another branch on the same commit does not count", async () => {
      const result = await deploymentOf([
        run({ head_branch: "uat", conclusion: "failure" }),
        run(),
      ]);
      assert.strictEqual(result.jobsStatus, "success");
      assert.strictEqual(result.jobs.length, 1);
    });

    test("the chip opens the deployment run", async () => {
      const deployment = run();
      const result = await deploymentOf([
        run({ name: MEGALINTER }),
        deployment,
      ]);
      assert.strictEqual(result.jobs[0].webUrl, deployment.html_url);
    });

    test("every deployment workflow of the branch counts", async () => {
      const result = await deploymentOf([
        run(),
        run({ name: "Deploy Experience Cloud site", conclusion: "failure" }),
      ]);
      assert.strictEqual(result.jobsStatus, "failed");
      assert.strictEqual(result.jobs.length, 2);
    });

    test("the latest run of a workflow wins", async () => {
      const result = await deploymentOf([
        run({ conclusion: "failure", created_at: "2026-09-25T08:00:00Z" }),
        run({
          event: "workflow_dispatch",
          conclusion: "success",
          created_at: "2026-09-25T09:00:00Z",
        }),
      ]);
      assert.strictEqual(result.jobsStatus, "success");
    });

    test("without a deployment workflow, all the runs of the branch count", async () => {
      const result = await deploymentOf([
        run({ name: "CI", conclusion: "failure" }),
        run({ name: "Release notes" }),
        run({ name: "Validate", event: "pull_request" }),
      ]);
      assert.strictEqual(result.jobsStatus, "failed");
      assert.deepStrictEqual(namesOf(result.jobs), ["CI", "Release notes"]);
    });

    test("a skipped deployment is unknown, never green from another workflow", async () => {
      const result = await deploymentOf([
        run({ name: MEGALINTER }),
        run({ conclusion: "skipped" }),
      ]);
      assert.strictEqual(result.jobsStatus, "unknown");
      assert.deepStrictEqual(namesOf(result.jobs), [DEPLOYMENT]);
    });

    test("a skipped workflow does not hide a deployment that worked", async () => {
      const result = await deploymentOf([
        run({ name: "Deploy documentation", conclusion: "skipped" }),
        run(),
      ]);
      assert.strictEqual(result.jobsStatus, "success");
      assert.deepStrictEqual(namesOf(result.jobs), [DEPLOYMENT]);
    });

    test("only Pull Request checks on the commit: the commit statuses are read instead", async () => {
      const pullRequestOnly = [
        run({ name: SIMULATION, event: "pull_request", conclusion: "failure" }),
      ];
      const none = buildProvider(pullRequestOnly);
      const withoutStatus =
        await none.provider.getJobsForBranchLatestCommit("preprod");
      assert.strictEqual(none.calls.commitStatuses, 1);
      assert.strictEqual(withoutStatus.jobsStatus, "unknown");
      assert.strictEqual(withoutStatus.jobs.length, 0);

      const jenkins = buildProvider(pullRequestOnly, [
        {
          context: "jenkins",
          state: "failure",
          updated_at: "2026-09-25T08:00:00Z",
        },
      ]);
      const withStatus =
        await jenkins.provider.getJobsForBranchLatestCommit("preprod");
      assert.strictEqual(withStatus.jobsStatus, "failed");
    });

    test("asks for a page long enough to reach the deployment behind the Pull Request checks", async () => {
      const { provider, calls } = buildProvider([run()]);
      await provider.getJobsForBranchLatestCommit("preprod");
      assert.strictEqual(calls.workflowRuns[0].head_sha, LATEST_COMMIT);
      assert.strictEqual(calls.workflowRuns[0].per_page, 50);
    });
  });

  suite("status of a Pull Request", () => {
    const pullRequest = {
      number: 12,
      sourceBranch: "preprod",
      targetBranch: "main",
    };

    test("a failed deployment simulation turns the Pull Request red", async () => {
      const { provider } = buildProvider([
        run({ name: MEGALINTER, event: "pull_request" }),
        run({ name: SIMULATION, event: "pull_request", conclusion: "failure" }),
      ]);
      const jobs = await provider.fetchLatestJobsForPullRequest(pullRequest);
      assert.strictEqual(provider.computeJobsStatus(jobs), "failed");
      // The simulation comes first: the chip and the Jobs column open it
      assert.strictEqual(jobs[0].name, SIMULATION);
    });

    test("a skipped workflow does not hide checks that passed", async () => {
      const { provider } = buildProvider([
        run({ name: SIMULATION, event: "pull_request" }),
        run({
          name: "Notify the team",
          event: "pull_request",
          conclusion: "skipped",
        }),
      ]);
      const jobs = await provider.fetchLatestJobsForPullRequest(pullRequest);
      assert.strictEqual(provider.computeJobsStatus(jobs), "success");
    });
  });
});
