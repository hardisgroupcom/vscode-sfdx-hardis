import * as assert from "assert";
import {
  classifyJobKind,
  isMajorBranchCheckName,
} from "../../utils/pipeline/jobKindUtils";
import {
  buildMajorBranchCheckView,
  computeMajorBranchCheckState,
  getMajorBranchCheckValidityHours,
  isMajorBranchCheckEnabled,
} from "../../utils/pipeline/majorBranchCheckUtils";
import { BranchStrategyMermaidBuilder } from "../../utils/pipeline/branchStrategyMermaidBuilder";
import {
  GitProviderGitlab,
  pickGitlabBranchDeploymentPipelines,
} from "../../utils/gitProviders/gitProviderGitlab";
import { GitProviderGitHub } from "../../utils/gitProviders/gitProviderGitHub";
import { pickAzureBranchDeploymentBuilds } from "../../utils/gitProviders/gitProviderAzure";
import { pickBitbucketBranchDeploymentPipelines } from "../../utils/gitProviders/gitProviderBitbucket";
import { GitProviderMock } from "../../utils/gitProviders/gitProviderMock";
import type { MajorBranchCheck } from "../../utils/gitProviders/types";
import { newAzureProviderStub } from "./azureProviderStub";
import { newBitbucketProviderStub } from "./bitbucketProviderStub";

/** The commit statuses were read once, and only the Jenkins deployment is left: the check is out. */
async function assertOnlyJenkinsDeployment(
  stub: any,
  calls: { statuses: number },
  branch: string,
): Promise<void> {
  const result = await stub.getJobsForBranchLatestCommit(branch);
  assert.strictEqual(calls.statuses, 1);
  assert.strictEqual(result.jobsStatus, "success");
  assert.deepStrictEqual(
    result.jobs.map((job: any) => job.name),
    ["jenkins-deploy"],
  );
}

/**
 * The major branch deployment check (sfdx-hardis enableMajorBranchDeploymentCheck): a scheduled
 * CI job simulates the deployment of each major branch into its own org.
 *
 * Two things are covered. The deployment arrow of a branch never shows that job, nor any other
 * scheduled or API run, whether the feature is on or not: a nightly check used to replace the
 * status of the last real deployment on the arrow. And when the feature is on, the last check is
 * read from each provider and drawn on the node of the branch.
 *
 * The providers are driven on bare prototypes holding fake clients, like the other provider
 * suites do.
 */

suite("Major branch deployment check", () => {
  suite("name of the job", () => {
    const checkNames = [
      // GitLab
      "check_deploy_to_current_branch_org",
      // GitHub: the workflow, and one matrix job per branch
      "Check Major Branch Deployment (sfdx-hardis)",
      "Check Major Branch Deployment (integration)",
      // Azure: the pipeline and its job
      "Check Major Branch Deployment",
      "MajorBranchDeploymentCheck",
      // Bitbucket: the custom pipeline and its step
      "check-major-branch-deployment",
      // Jenkins, named by the project
      "jenkins major branch check",
      "Simulate current branch deployment",
      "validate-major_branch",
    ];

    test("tells the check of every CI, and calls it a validation", () => {
      for (const name of checkNames) {
        assert.strictEqual(isMajorBranchCheckName(name), true, name);
        assert.strictEqual(classifyJobKind(name), "validation", name);
      }
    });

    test("leaves out the deployment and the checks of a Pull Request", () => {
      for (const name of [
        "check_deploy_to_target_branch_org",
        "deploy_to_org",
        "Simulate Deployment (sfdx-hardis)",
        "Process Deployment (sfdx-hardis)",
        "Deploy to major org",
        "DeploymentCheck",
        "major branch",
        "",
        undefined,
      ]) {
        assert.strictEqual(isMajorBranchCheckName(name), false, String(name));
      }
      assert.strictEqual(
        classifyJobKind("Process Deployment (sfdx-hardis)"),
        "deployment",
      );
    });
  });

  suite("state of a check", () => {
    const now = new Date("2026-11-05T12:00:00.000Z");
    const finished: MajorBranchCheck = {
      status: "success",
      name: "check_deploy_to_current_branch_org",
      webUrl: "https://gitlab.example.com/g/p/-/jobs/7",
      startedAt: "2026-11-05T02:00:00.000Z",
      finishedAt: "2026-11-05T02:04:10.000Z",
    };

    test("a recent check is fresh, with its duration", () => {
      assert.deepStrictEqual(
        computeMajorBranchCheckState(finished, null, 24, now),
        {
          status: "success",
          stale: false,
          staleReason: null,
          durationSeconds: 250,
        },
      );
    });

    test("a check older than the validity is stale", () => {
      const state = computeMajorBranchCheckState(finished, null, 6, now);
      assert.strictEqual(state.stale, true);
      assert.strictEqual(state.staleReason, "age");
    });

    test("a deployment that finished after the check started makes it stale", () => {
      const state = computeMajorBranchCheckState(
        { ...finished, status: "failed" },
        {
          name: "deploy",
          status: "success",
          updatedAt: "2026-11-05T09:00:00.000Z",
        },
        24,
        now,
      );
      assert.strictEqual(state.stale, true);
      assert.strictEqual(state.staleReason, "deployedAfter");
      // A deployment still running does not count yet, nor an older one
      for (const deployment of [
        {
          name: "deploy",
          status: "running" as const,
          updatedAt: "2026-11-05T09:00:00.000Z",
        },
        {
          name: "deploy",
          status: "success" as const,
          updatedAt: "2026-11-04T20:00:00.000Z",
        },
      ]) {
        assert.strictEqual(
          computeMajorBranchCheckState(finished, deployment, 24, now).stale,
          false,
        );
      }
    });

    test("a check running or queued is never stale", () => {
      for (const status of ["running", "pending"] as const) {
        const state = computeMajorBranchCheckState(
          {
            ...finished,
            status,
            startedAt: "2026-10-01T02:00:00.000Z",
            finishedAt: undefined,
          },
          {
            name: "deploy",
            status: "success",
            updatedAt: "2026-11-05T09:00:00.000Z",
          },
          1,
          now,
        );
        assert.strictEqual(state.stale, false, status);
        assert.strictEqual(state.durationSeconds, null, status);
      }
    });

    test("an invalid validity falls back to 24 hours", () => {
      for (const value of [undefined, "abc", 0, -3, null]) {
        assert.strictEqual(
          getMajorBranchCheckValidityHours({
            majorBranchDeploymentCheckValidityHours: value,
          }),
          24,
          String(value),
        );
      }
      assert.strictEqual(
        getMajorBranchCheckValidityHours({
          majorBranchDeploymentCheckValidityHours: 48,
        }),
        48,
      );
      // 30 hours old: stale with 24, fresh with 48, stale again with an invalid 0
      const old = {
        ...finished,
        finishedAt: "2026-11-04T06:00:00.000Z",
      };
      assert.strictEqual(
        computeMajorBranchCheckState(old, null, 48, now).stale,
        false,
      );
      assert.strictEqual(
        computeMajorBranchCheckState(old, null, 0, now).stale,
        true,
      );
    });

    test("only an explicit true turns the feature on", () => {
      assert.strictEqual(
        isMajorBranchCheckEnabled({ enableMajorBranchDeploymentCheck: true }),
        true,
      );
      for (const config of [
        {},
        null,
        { enableMajorBranchDeploymentCheck: "true" },
        { enableMajorBranchDeploymentCheck: false },
      ]) {
        assert.strictEqual(isMajorBranchCheckEnabled(config), false);
      }
    });

    test("the panel receives the fields it reads by name", () => {
      assert.deepStrictEqual(
        Object.keys(buildMajorBranchCheckView(finished, null, 24, now) || {}),
        [
          "status",
          "name",
          "webUrl",
          "startedAt",
          "finishedAt",
          "durationSeconds",
          "stale",
          "staleReason",
        ],
      );
      assert.strictEqual(buildMajorBranchCheckView(null, null, 24, now), null);
    });
  });

  suite("node of a branch in the diagram", () => {
    const branches = [
      { branchName: "integration", level: 50, mergeTargets: ["uat"] },
      { branchName: "uat", level: 70, mergeTargets: ["preprod"] },
      { branchName: "preprod", level: 90, mergeTargets: ["main"] },
      { branchName: "main", level: 100, mergeTargets: [] },
      { branchName: "hotfix", level: 40, mergeTargets: ["main"] },
    ].map((branch) => ({
      ...branch,
      instanceUrl: "",
      jobs: [],
      jobsStatus: "unknown",
    }));
    const view = (status: string, stale = false): any => ({
      status,
      name: "check",
      webUrl: "https://ci.example.com/1",
      stale,
      staleReason: stale ? "age" : null,
      durationSeconds: null,
    });

    function diagram(checks: Record<string, any>, onlyMajor = false): string {
      return new BranchStrategyMermaidBuilder(
        branches,
        true,
        [],
        null,
        "light",
        3,
        undefined,
        checks,
      ).build({
        format: "string",
        withMermaidTag: false,
        onlyMajorBranches: onlyMajor,
      }) as string;
    }

    test("each status of the check gives its class, only the used ones are defined", () => {
      const text = diagram({
        integration: view("success"),
        uat: view("failed"),
        preprod: view("running"),
        main: view("success", true),
        hotfix: view("failed", true),
      });
      for (const [node, cls] of [
        ["integrationBranch", "gitBranchCheckSuccess"],
        ["uatBranch", "gitBranchCheckFailed"],
        ["preprodBranch", "gitBranchCheckRunning"],
        ["mainBranch", "gitBranchCheckSuccessStale"],
        ["hotfixBranch", "gitBranchCheckFailedStale"],
      ]) {
        assert.match(
          text,
          new RegExp(`${node}\\(".*"\\):::${cls}\\b`),
          `${node} ${cls}`,
        );
        assert.match(text, new RegExp(`classDef ${cls} `), cls);
      }
      assert.doesNotMatch(text, /classDef gitMajor /);
      // The status does not rely on the color alone
      // (the ring class keeps the dot visible on a fill of its own color)
      assert.match(
        text,
        /hardis-node-dot hardis-node-check-dot hardis-status-failed/,
      );
      // The tooltip tells the check, not "Show <branch>"
      assert.doesNotMatch(text, /"Show integration"/);
      // The unit host loads no translation: t() answers the key there
      assert.match(
        text,
        /click uatBranch call handleMermaidClick\(\) "(?!Show )[^"]+"/,
      );
      assert.match(
        text,
        /click mainBranch call handleMermaidClick\(\) "[^"]*(stale|Stale)[^"]*"/,
      );
    });

    test("a queued check is drawn as a running one", () => {
      assert.match(
        diagram({ integration: view("pending") }),
        /integrationBranch\(".*"\):::gitBranchCheckRunning/,
      );
    });

    test("without the feature or without a check, the nodes are unchanged", () => {
      const off = diagram({});
      assert.match(off, /integrationBranch\(".*"\):::gitMajor/);
      assert.match(off, /mainBranch\(".*"\):::gitMain/);
      assert.doesNotMatch(off, /gitBranchCheck|hardis-node-dot/);
      assert.match(off, /"Show integration"/);
      const unknown = diagram({ integration: view("unknown"), uat: null });
      assert.match(unknown, /integrationBranch\(".*"\):::gitMajor/);
      assert.match(unknown, /uatBranch\(".*"\):::gitMajor/);
    });

    test("the diagram of the major branches keeps the branches with a check", () => {
      const text = diagram({ integration: view("success") }, true);
      assert.match(text, /integrationBranch\(".*"\):::gitBranchCheckSuccess/);
      assert.match(text, /uatBranch\(".*"\):::gitMajor/);
    });
  });

  suite("GitLab", () => {
    function pipeline(id: number, source: string, extra: any = {}): any {
      return {
        id,
        source,
        status: "success",
        ref: "integration",
        web_url: `https://gitlab.example.com/g/p/-/pipelines/${id}`,
        updated_at: `2026-11-0${Math.min(id, 9)}T02:00:00.000Z`,
        ...extra,
      };
    }

    function provider(options: {
      pipelines: any[];
      jobs?: Record<number, any[]>;
      statuses?: any[];
    }) {
      const calls = {
        pipelines: [] as any[],
        jobs: [] as number[],
        statuses: 0,
      };
      const stub: any = Object.create(GitProviderGitlab.prototype);
      stub.gitlabProjectId = 42;
      stub.logApiCall = async () => undefined;
      stub.gitlabClient = {
        Pipelines: {
          all: async (_projectId: number, params: any) => {
            calls.pipelines.push(params);
            return options.pipelines;
          },
        },
        Jobs: {
          all: async (_projectId: number, params: any) => {
            calls.jobs.push(params.pipelineId);
            return (options.jobs || {})[params.pipelineId] || [];
          },
        },
        Commits: {
          all: async () => [{ id: "abc123" }],
          allStatuses: async () => {
            calls.statuses++;
            return options.statuses || [];
          },
        },
      };
      return { stub, calls };
    }

    test("the arrow leaves out the scheduled pipelines, keeps the manual, API and trigger ones", () => {
      const selection = pickGitlabBranchDeploymentPipelines([
        pipeline(5, "schedule", { status: "failed" }),
        pipeline(4, "api"),
        pipeline(3, "trigger"),
        pipeline(2, "web"),
        pipeline(1, "push"),
      ]);
      assert.deepStrictEqual(
        selection.pipelines.map((item) => item.id),
        [4, 3, 2, 1],
      );
      assert.strictEqual(selection.readCommitStatuses, false);
    });

    test("an API pipeline that ran the check is not a deployment, an API deployment is", async () => {
      const { stub, calls } = provider({
        pipelines: [
          pipeline(5, "api", { status: "failed" }),
          pipeline(4, "trigger"),
          pipeline(1, "push", { status: "failed" }),
        ],
        jobs: {
          5: [{ name: "check_deploy_to_current_branch_org", status: "failed" }],
          4: [{ name: "deploy_to_org", status: "success" }],
        },
      });
      const result = await stub.getJobsForBranchLatestCommit("integration");
      assert.strictEqual(result.jobsStatus, "success");
      assert.strictEqual(result.jobs[0].raw.id, 4);
      assert.deepStrictEqual(calls.jobs, [5, 4]);
    });

    test("the arrow and the check of a branch share one list of pipelines", async () => {
      const { stub, calls } = provider({
        pipelines: [pipeline(2, "schedule"), pipeline(1, "push")],
        jobs: {
          2: [
            { name: "check_deploy_to_current_branch_org", status: "success" },
          ],
        },
      });
      await Promise.all([
        stub.getJobsForBranchLatestCommit("integration"),
        stub.getMajorBranchDeploymentCheck("integration"),
      ]);
      assert.strictEqual(calls.pipelines.length, 1);
    });

    test("a check run again under the same pipeline id is read again", async () => {
      const scheduled = pipeline(7, "schedule", { status: "failed" });
      const jobs: Record<number, any[]> = {
        7: [{ name: "check_deploy_to_current_branch_org", status: "failed" }],
      };
      const { stub, calls } = provider({ pipelines: [scheduled], jobs });
      assert.strictEqual(
        (await stub.getMajorBranchDeploymentCheck("integration")).status,
        "failed",
      );
      // Retried: same id, new update date, the job now passes
      scheduled.status = "success";
      scheduled.updated_at = "2026-11-08T03:00:00.000Z";
      jobs[7] = [
        { name: "check_deploy_to_current_branch_org", status: "success" },
      ];
      assert.strictEqual(
        (await stub.getMajorBranchDeploymentCheck("integration")).status,
        "success",
      );
      assert.deepStrictEqual(calls.jobs, [7, 7]);
    });

    test("only scheduled pipelines: the arrow is unknown, the commit statuses are not read", async () => {
      const { stub, calls } = provider({
        pipelines: [pipeline(3, "schedule", { status: "failed" })],
        statuses: [{ name: "jenkins", status: "success" }],
      });
      const result = await stub.getJobsForBranchLatestCommit("integration");
      assert.deepStrictEqual(result, { jobs: [], jobsStatus: "unknown" });
      assert.strictEqual(calls.statuses, 0);
      assert.strictEqual(calls.pipelines[0].perPage, 20);
    });

    test("a nightly check newer than the deployment does not replace it", async () => {
      const { stub } = provider({
        pipelines: [
          pipeline(9, "schedule", { status: "failed" }),
          pipeline(2, "push", { status: "success" }),
        ],
      });
      const result = await stub.getJobsForBranchLatestCommit("integration");
      assert.strictEqual(result.jobsStatus, "success");
      assert.strictEqual(result.jobs[0].raw.id, 2);
    });

    test("only merge request pipelines: the commit statuses are read, without the check", async () => {
      const { stub, calls } = provider({
        pipelines: [pipeline(3, "merge_request_event", { status: "failed" })],
        statuses: [
          {
            name: "jenkins-deploy",
            status: "success",
            finished_at: "2026-11-05T01:00:00Z",
          },
          {
            name: "jenkins major branch check",
            status: "failed",
            finished_at: "2026-11-05T02:00:00Z",
          },
        ],
      });
      await assertOnlyJenkinsDeployment(stub, calls, "integration");
    });

    test("the check is the job of the newest scheduled pipeline, its jobs read once when over", async () => {
      const { stub, calls } = provider({
        pipelines: [
          pipeline(8, "push"),
          pipeline(7, "schedule", { status: "failed" }),
        ],
        jobs: {
          7: [
            { name: "check_quality", status: "success" },
            {
              name: "check_deploy_to_current_branch_org",
              status: "failed",
              web_url: "https://gitlab.example.com/g/p/-/jobs/71",
              started_at: "2026-11-07T02:00:00.000Z",
              finished_at: "2026-11-07T02:05:00.000Z",
            },
          ],
        },
      });
      const check = await stub.getMajorBranchDeploymentCheck("integration");
      assert.deepStrictEqual(check, {
        status: "failed",
        name: "check_deploy_to_current_branch_org",
        webUrl: "https://gitlab.example.com/g/p/-/jobs/71",
        startedAt: "2026-11-07T02:00:00.000Z",
        finishedAt: "2026-11-07T02:05:00.000Z",
      });
      await stub.getMajorBranchDeploymentCheck("integration");
      assert.deepStrictEqual(calls.jobs, [7]);
    });

    test("a skipped or manual check job is not the check; a running pipeline is asked again", async () => {
      const { stub, calls } = provider({
        pipelines: [
          pipeline(6, "web", { status: "running" }),
          pipeline(5, "schedule"),
        ],
        jobs: {
          6: [{ name: "check_deploy_to_current_branch_org", status: "manual" }],
          5: [
            {
              name: "check_deploy_to_current_branch_org",
              status: "running",
              started_at: "2026-11-05T02:00:00.000Z",
            },
          ],
        },
      });
      const check = await stub.getMajorBranchDeploymentCheck("integration");
      assert.strictEqual(check.status, "running");
      assert.strictEqual(check.finishedAt, undefined);
      await stub.getMajorBranchDeploymentCheck("integration");
      assert.deepStrictEqual(calls.jobs, [6, 5, 6]);
    });

    test("a Jenkins check is read from the commit statuses", async () => {
      const { stub } = provider({
        pipelines: [pipeline(1, "push")],
        statuses: [
          {
            name: "Jenkins major branch check",
            status: "success",
            target_url: "https://jenkins.example.com/job/check/12",
            created_at: "2026-11-05T02:00:00Z",
            finished_at: "2026-11-05T02:03:00Z",
          },
        ],
      });
      const check = await stub.getMajorBranchDeploymentCheck("integration");
      assert.strictEqual(check.status, "success");
      assert.strictEqual(
        check.webUrl,
        "https://jenkins.example.com/job/check/12",
      );
    });
  });

  suite("GitHub", () => {
    let lastId = 0;
    function run(overrides: Record<string, any> = {}): any {
      lastId++;
      return {
        id: lastId,
        workflow_id: 10,
        name: "Process Deployment (sfdx-hardis)",
        event: "push",
        head_branch: "preprod",
        status: "completed",
        conclusion: "success",
        created_at: "2026-11-04T08:00:00Z",
        updated_at: "2026-11-04T08:02:00Z",
        html_url: `https://github.com/acme/repo/actions/runs/${lastId}`,
        ...overrides,
      };
    }

    // checkWorkflowRuns: the runs of check-major-branch-deploy.yml, or a 404 when not given
    function provider(
      runs: any[],
      jobsByRun: Record<number, any[]> = {},
      checkWorkflowRuns?: any[],
    ) {
      const calls = {
        workflowRuns: 0,
        checkWorkflow: [] as string[],
        jobs: [] as number[],
      };
      const stub: any = Object.create(GitProviderGitHub.prototype);
      stub.repoInfo = { owner: "acme", repo: "repo" };
      stub.logApiCall = async () => undefined;
      stub.gitHubClient = {
        repos: {
          listCommits: async () => ({ data: [{ sha: "5bccb39" }] }),
          listCommitStatusesForRef: async () => ({ data: [] }),
        },
        actions: {
          listWorkflowRuns: async (params: any) => {
            calls.checkWorkflow.push(params.workflow_id);
            if (!checkWorkflowRuns) {
              throw Object.assign(new Error("Not Found"), { status: 404 });
            }
            return { data: { workflow_runs: checkWorkflowRuns } };
          },
          listWorkflowRunsForRepo: async () => {
            calls.workflowRuns++;
            return { data: { workflow_runs: runs } };
          },
          listJobsForWorkflowRun: async (params: any) => {
            calls.jobs.push(params.run_id);
            return { data: { jobs: jobsByRun[params.run_id] || [] } };
          },
        },
      };
      return { stub, calls };
    }

    test("the arrow leaves out the scheduled runs and the check, whatever started it", async () => {
      const deployment = run();
      const { stub } = provider([
        run({
          event: "schedule",
          conclusion: "failure",
          created_at: "2026-11-05T02:00:00Z",
        }),
        run({
          name: "Check Major Branch Deployment (sfdx-hardis)",
          event: "workflow_dispatch",
          conclusion: "failure",
          created_at: "2026-11-05T03:00:00Z",
        }),
        run({ event: "repository_dispatch", conclusion: "failure" }),
        deployment,
      ]);
      const result = await stub.getJobsForBranchLatestCommit("preprod");
      assert.strictEqual(result.jobsStatus, "success");
      assert.deepStrictEqual(
        result.jobs.map((job: any) => job.webUrl),
        [deployment.html_url],
      );
    });

    test("the check of a branch is its matrix job, the runs listed once for every branch", async () => {
      const checkRun = run({
        name: "Check Major Branch Deployment (sfdx-hardis)",
        event: "schedule",
        head_branch: "main",
        conclusion: "failure",
      });
      const { stub, calls } = provider(
        [run({ name: "Mega-Linter" }), checkRun],
        {
          [checkRun.id]: [
            {
              name: "Check Major Branch Deployment (uat)",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/acme/repo/actions/runs/1/job/11",
              started_at: "2026-11-05T02:00:00Z",
              completed_at: "2026-11-05T02:06:00Z",
            },
            {
              name: "Check Major Branch Deployment (preprod)",
              status: "completed",
              conclusion: "cancelled",
              html_url: "https://github.com/acme/repo/actions/runs/1/job/12",
              started_at: "2026-11-05T02:00:00Z",
              completed_at: "2026-11-05T02:01:00Z",
            },
          ],
        },
      );
      const preprod = await stub.getMajorBranchDeploymentCheck("preprod");
      const uat = await stub.getMajorBranchDeploymentCheck("uat");
      const integration =
        await stub.getMajorBranchDeploymentCheck("integration");
      assert.strictEqual(preprod.status, "failed");
      assert.strictEqual(
        preprod.webUrl,
        "https://github.com/acme/repo/actions/runs/1/job/12",
      );
      assert.strictEqual(uat.status, "success");
      assert.strictEqual(uat.finishedAt, "2026-11-05T02:06:00Z");
      assert.strictEqual(integration, null);
      assert.strictEqual(calls.workflowRuns, 1);
      assert.deepStrictEqual(calls.jobs, [checkRun.id]);
    });

    test("the runs of the check workflow are listed first, a branch with a slash is found", async () => {
      const checkRun = run({
        name: "Check Major Branch Deployment (sfdx-hardis)",
        event: "schedule",
        head_branch: "main",
      });
      const { stub, calls } = provider(
        [],
        {
          [checkRun.id]: [
            {
              name: "Check Major Branch Deployment (release/uat)",
              status: "completed",
              conclusion: "success",
            },
          ],
        },
        [checkRun],
      );
      // Named after its config file, or after its git branch
      const fromConfig =
        await stub.getMajorBranchDeploymentCheck("release__uat");
      const fromGit = await stub.getMajorBranchDeploymentCheck("release/uat");
      assert.strictEqual(fromConfig.status, "success");
      assert.strictEqual(fromGit.status, "success");
      assert.deepStrictEqual(calls.checkWorkflow, [
        "check-major-branch-deploy.yml",
      ]);
      assert.strictEqual(calls.workflowRuns, 0);
    });

    test("a commit status of an external CI has no run to open", async () => {
      const { stub, calls } = provider([]);
      const jobs = await stub.listJobsOfRun({
        name: "jenkins",
        status: "running",
        raw: { id: 4, context: "jenkins" },
      });
      assert.deepStrictEqual(jobs, []);
      assert.deepStrictEqual(calls.jobs, []);
    });
  });

  suite("Azure DevOps", () => {
    function build(overrides: Record<string, any> = {}): any {
      return {
        id: 1,
        reason: 2, // IndividualCI
        status: 2, // Completed
        result: 2, // Succeeded
        definition: { name: "Deployment" },
        queueTime: new Date("2026-11-04T08:00:00.000Z"),
        startTime: new Date("2026-11-04T08:00:10.000Z"),
        finishTime: new Date("2026-11-04T08:05:00.000Z"),
        _links: {
          web: {
            href: "https://dev.azure.com/acme/Project/_build/results?buildId=1",
          },
        },
        ...overrides,
      };
    }

    function provider(
      builds: any[],
      jobRecordsByBuild: Record<number, any[]> = {},
    ) {
      const calls = { getBuilds: [] as any[][] };
      const stub = newAzureProviderStub();
      stub.connection = {};
      stub.buildApi = {
        getBuilds: async (...args: any[]) => {
          calls.getBuilds.push(args);
          return builds;
        },
        getBuildTimeline: async (_project: string, buildId: number) => ({
          records: jobRecordsByBuild[buildId] || [],
        }),
      };
      stub.gitApi = {
        getBranch: async () => ({ commit: { commitId: "abc" } }),
        getStatuses: async () => [],
      };
      return { stub, calls };
    }

    test("the arrow leaves out the scheduled builds and the check, whatever the reason format", () => {
      const kept = pickAzureBranchDeploymentBuilds([
        build({ id: 7, reason: 8 }),
        build({ id: 6, reason: "schedule" }),
        build({ id: 5, reason: 16 }),
        build({ id: 4, reason: "scheduleForced" }),
        build({ id: 3, reason: 256 }),
        build({
          id: 2,
          reason: 1,
          definition: { name: "Check Major Branch Deployment" },
        }),
        build({ id: 1 }),
      ]);
      assert.deepStrictEqual(
        kept.map((item: any) => item.id),
        [1],
      );
    });

    test("the arrow reads the 10 newest builds of the branch", async () => {
      const { stub, calls } = provider([
        build({ id: 9, reason: 8, result: 8 }),
        build({ id: 1 }),
      ]);
      const result = await stub.getJobsForBranchLatestCommit("uat");
      assert.strictEqual(result.jobsStatus, "success");
      assert.strictEqual(result.jobs[0].raw.id, 1);
      // top is the 13th argument of getBuilds
      assert.strictEqual(calls.getBuilds[0][12], 10);
    });

    test("a renamed check pipeline started by hand is not a deployment", async () => {
      const { stub, calls } = provider(
        [
          build({
            id: 3,
            reason: 1,
            definition: { name: "Nightly org drift" },
          }),
          build({ id: 1 }),
        ],
        {
          3: [
            {
              type: "Job",
              name: "MajorBranchDeploymentCheck",
              state: 2,
              result: 0,
            },
          ],
        },
      );
      const [arrow, check] = await Promise.all([
        stub.getJobsForBranchLatestCommit("uat"),
        stub.getMajorBranchDeploymentCheck("uat"),
      ]);
      assert.strictEqual(arrow.jobs[0].raw.id, 1);
      assert.strictEqual(check.name, "MajorBranchDeploymentCheck");
      // One list of builds for both
      assert.strictEqual(calls.getBuilds.length, 1);
    });

    test("the check is the newest build of the check pipeline", async () => {
      const { stub } = provider([
        build({ id: 3 }),
        build({
          id: 2,
          reason: 8,
          status: 1, // InProgress
          result: undefined,
          finishTime: undefined,
          definition: { name: "Check Major Branch Deployment" },
          _links: {
            web: {
              href: "https://dev.azure.com/acme/Project/_build/results?buildId=2",
            },
          },
        }),
      ]);
      const check = await stub.getMajorBranchDeploymentCheck("uat");
      assert.deepStrictEqual(check, {
        status: "running",
        name: "Check Major Branch Deployment",
        webUrl: "https://dev.azure.com/acme/Project/_build/results?buildId=2",
        startedAt: "2026-11-04T08:00:10.000Z",
        finishedAt: undefined,
      });
    });
  });

  suite("Bitbucket", () => {
    function pipeline(
      buildNumber: number,
      overrides: Record<string, any> = {},
    ): any {
      return {
        uuid: `{pipe-${buildNumber}}`,
        build_number: buildNumber,
        target: {
          type: "pipeline_ref_target",
          ref_name: "uat",
          selector: { type: "branches", pattern: "uat" },
        },
        trigger: { name: "PUSH" },
        state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
        created_on: "2026-11-04T08:00:00.000Z",
        completed_on: "2026-11-04T08:06:00.000Z",
        ...overrides,
      };
    }
    const customCheck = (buildNumber: number, overrides: any = {}) =>
      pipeline(buildNumber, {
        target: {
          type: "pipeline_ref_target",
          ref_name: "uat",
          selector: {
            type: "custom",
            pattern: "check-major-branch-deployment",
          },
        },
        trigger: { name: "SCHEDULE" },
        state: { name: "COMPLETED", result: { name: "FAILED" } },
        ...overrides,
      });

    // pipelines: an Error when Bitbucket refuses to list them
    function provider(pipelines: any[] | Error, statuses: any[] = []) {
      const calls = { statuses: 0, list: [] as any[] };
      const stub = newBitbucketProviderStub({
        pipelines: {
          list: async (params: any) => {
            calls.list.push(params);
            if (pipelines instanceof Error) {
              throw pipelines;
            }
            return { data: { values: pipelines } };
          },
          listSteps: async () => ({ data: { values: [] } }),
        },
        repositories: {
          listCommitsAt: async () => ({ data: { values: [{ hash: "abc" }] } }),
          listCommitStatuses: async () => {
            calls.statuses++;
            return { data: { values: statuses } };
          },
        },
      });
      return { stub, calls };
    }

    test("the arrow reads the pipelines first and keeps the pushes to the branch", async () => {
      const { stub, calls } = provider([
        customCheck(12),
        pipeline(11, { trigger: { name: "SCHEDULE" } }),
        pipeline(10, {
          target: { type: "pipeline_pullrequest_target", ref_name: "uat" },
        }),
        pipeline(9, {
          state: { name: "COMPLETED", result: { name: "FAILED" } },
        }),
      ]);
      const result = await stub.getJobsForBranchLatestCommit("uat");
      assert.strictEqual(result.jobsStatus, "failed");
      assert.strictEqual(result.jobs[0].raw.build_number, 9);
      assert.strictEqual(result.jobs[0].name, "uat");
      assert.strictEqual(calls.statuses, 0);
      assert.strictEqual(
        pickBitbucketBranchDeploymentPipelines([pipeline(1)], "main").length,
        0,
      );
    });

    test("pipelines that cannot be read: the commit statuses of Jenkins are still read", async () => {
      const { stub, calls } = provider(new Error("403 pipeline:read"), [
        {
          name: "jenkins-deploy",
          state: "SUCCESSFUL",
          url: "https://jenkins.example.com/job/deploy/3",
        },
      ]);
      const result = await stub.getJobsForBranchLatestCommit("uat");
      assert.strictEqual(calls.statuses, 1);
      assert.strictEqual(result.jobsStatus, "success");
    });

    test("no push pipeline: the commit statuses are read, without the ones of the pipelines left out", async () => {
      const { stub, calls } = provider(
        [customCheck(12)],
        [
          {
            name: "Pipeline #12",
            state: "FAILED",
            url: "https://bitbucket.org/ws/repo/pipelines/results/12",
          },
          {
            name: "jenkins-deploy",
            state: "SUCCESSFUL",
            url: "https://jenkins.example.com/job/deploy/3",
          },
          {
            name: "Jenkins major branch check",
            state: "FAILED",
            url: "https://jenkins.example.com/job/check/4",
          },
        ],
      );
      await assertOnlyJenkinsDeployment(stub, calls, "uat");
    });

    test("the check is the newest run of the custom pipeline", async () => {
      const { stub } = provider([pipeline(13), customCheck(12)]);
      const check = await stub.getMajorBranchDeploymentCheck("uat");
      assert.deepStrictEqual(check, {
        status: "failed",
        name: "check-major-branch-deployment",
        webUrl: "https://bitbucket.org/ws/repo/pipelines/results/12",
        startedAt: "2026-11-04T08:00:00.000Z",
        finishedAt: "2026-11-04T08:06:00.000Z",
      });
    });
  });

  suite("mock provider of the UI tests", () => {
    test("serves the check of the fixture, null for a branch without one", async () => {
      const stub: any = Object.create(GitProviderMock.prototype);
      const check = {
        status: "success",
        name: "check",
        webUrl: "https://ci.example.com/1",
      };
      stub.fixture = { majorBranchChecks: { uat: check } };
      assert.deepStrictEqual(
        await stub.getMajorBranchDeploymentCheck("uat"),
        check,
      );
      assert.strictEqual(
        await stub.getMajorBranchDeploymentCheck("main"),
        null,
      );
      stub.fixture = {};
      assert.strictEqual(await stub.getMajorBranchDeploymentCheck("uat"), null);
    });
  });
});
