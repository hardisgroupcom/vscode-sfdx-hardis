import * as assert from "assert";
import {
  classifyJobKind,
  jobDurationSeconds,
  pickJobTiming,
  pickUnfinishedJobsByKind,
} from "../../utils/pipeline/jobKindUtils";
import { GitProviderGitlab } from "../../utils/gitProviders/gitProviderGitlab";
import { GitProviderAzure } from "../../utils/gitProviders/gitProviderAzure";
import { GitProviderBitbucket } from "../../utils/gitProviders/gitProviderBitbucket";
import type { Job } from "../../utils/gitProviders/types";

/**
 * The jobs still running for a Pull Request, shown in the Validation, Code Quality and Deployment
 * tabs of its window before they post their comment: which tab a job belongs to, and how each
 * provider lists the jobs inside a pipeline with the link to each one.
 *
 * The provider classes need no API to map an answer, so the suites drive them on a bare
 * prototype holding a fake client, as the other provider suites do.
 */

function job(overrides: Partial<Job> & { name: string }): Job {
  return { status: "running", ...overrides };
}

suite("Running jobs of a Pull Request", () => {
  suite("time a job took", () => {
    const check = {
      name: "DeploymentCheck",
      startedAt: "2026-10-10T08:00:10.000Z",
      finishedAt: "2026-10-10T08:03:15.000Z",
    };
    const linter = {
      name: "MegaLinter",
      startedAt: "2026-10-10T08:00:05.000Z",
      finishedAt: "2026-10-10T08:09:00.000Z",
    };

    test("the job of the kind asked for is the one timed", () => {
      assert.strictEqual(
        jobDurationSeconds(pickJobTiming([check, linter], "validation")),
        185,
      );
      assert.strictEqual(
        jobDurationSeconds(pickJobTiming([check, linter], "codeQuality")),
        535,
      );
    });

    test("jobs nobody can tell apart are timed together, first start to last end", () => {
      const steps = [
        { ...check, name: "step-a" },
        { ...linter, name: "step-b" },
      ];
      assert.deepStrictEqual(pickJobTiming(steps, "validation"), {
        startedAt: "2026-10-10T08:00:05.000Z",
        finishedAt: "2026-10-10T08:09:00.000Z",
      });
    });

    test("a job that is not over has no duration, a skipped one does not count", () => {
      const running = { ...check, finishedAt: undefined };
      assert.strictEqual(
        jobDurationSeconds(pickJobTiming([running], "validation")),
        null,
      );
      assert.strictEqual(pickJobTiming([{ name: "Deployment" }]), null);
      assert.strictEqual(jobDurationSeconds(null), null);
      assert.strictEqual(
        jobDurationSeconds({
          startedAt: "2026-10-10T08:03:15.000Z",
          finishedAt: "2026-10-10T08:00:10.000Z",
        }),
        null,
      );
    });
  });

  suite("kind of a job", () => {
    test("tells the jobs of the CI files sfdx-hardis installs", () => {
      const expected: Record<string, string> = {
        // GitHub
        "Simulate Deployment (sfdx-hardis)": "validation",
        "Mega-Linter": "codeQuality",
        "Process Deployment (sfdx-hardis)": "deployment",
        // GitLab
        check_deploy_to_target_branch_org: "validation",
        check_deploy_to_current_branch_org: "validation",
        check_quality: "codeQuality",
        deploy_to_org: "deployment",
        // Azure
        DeploymentCheck: "validation",
        MegaLinter: "codeQuality",
        Deployment: "deployment",
        // Bitbucket
        "Simulate SFDX deployment": "validation",
        "Run MegaLinter": "codeQuality",
        "Deploy to major org": "deployment",
      };
      for (const [name, kind] of Object.entries(expected)) {
        assert.strictEqual(classifyJobKind(name), kind, name);
      }
    });

    test("leaves out what is none of the three", () => {
      for (const name of [
        "clean",
        "create_scratch_org",
        "test_apex",
        "",
        undefined,
      ]) {
        assert.strictEqual(classifyJobKind(name), "other", String(name));
      }
    });
  });

  suite("jobs shown for a run", () => {
    test("a pipeline gives its unfinished jobs, each one under its kind", () => {
      const run = job({
        name: "feature/x",
        webUrl: "https://git.example.com/pipelines/1",
        startedAt: "2026-10-10T08:00:00.000Z",
      });
      const picked = pickUnfinishedJobsByKind(
        [run],
        () => [
          job({ name: "check_quality", status: "success" }),
          job({
            name: "check_deploy_to_target_branch_org",
            webUrl: "https://git.example.com/jobs/2",
          }),
          job({ name: "clean", status: "pending" }),
        ],
        "validation",
      );
      assert.deepStrictEqual(
        picked.map((item) => [
          item.kind,
          item.name,
          item.webUrl,
          item.parentName,
        ]),
        [
          [
            "validation",
            "check_deploy_to_target_branch_org",
            "https://git.example.com/jobs/2",
            "feature/x",
          ],
        ],
      );
      // A job that did not start yet has the start of its pipeline
      assert.strictEqual(picked[0].startedAt, "2026-10-10T08:00:00.000Z");
    });

    test("a run that is one job already is told from its own name", () => {
      const picked = pickUnfinishedJobsByKind(
        [
          job({ name: "Mega-Linter" }),
          job({ name: "Simulate Deployment (sfdx-hardis)", status: "pending" }),
          job({ name: "Process Deployment (sfdx-hardis)", status: "success" }),
        ],
        () => [],
        "validation",
      );
      assert.deepStrictEqual(
        picked.map((item) => [item.kind, item.status]),
        [
          ["codeQuality", "running"],
          ["validation", "pending"],
        ],
      );
    });

    test("renamed jobs fall back on the run, in the tab of its context", () => {
      const run = job({ name: "refs/pull/12/merge" });
      const renamed = () => [job({ name: "step-a" }), job({ name: "step-b" })];
      assert.deepStrictEqual(
        pickUnfinishedJobsByKind([run], renamed, "validation").map(
          (item) => item.kind,
        ),
        ["validation"],
      );
      assert.deepStrictEqual(
        pickUnfinishedJobsByKind([run], renamed, "deployment").map(
          (item) => item.kind,
        ),
        ["deployment"],
      );
    });

    test("a run nobody can name is left out next to one that says what it does", () => {
      const runs = [
        job({ name: "Simulate Deployment (sfdx-hardis)", status: "success" }),
        job({ name: "CodeQL" }),
      ];
      assert.deepStrictEqual(
        pickUnfinishedJobsByKind(runs, () => [], "validation"),
        [],
      );
    });

    test("a pipeline only finishing a cleanup shows nothing", () => {
      const picked = pickUnfinishedJobsByKind(
        [job({ name: "main" })],
        () => [
          job({ name: "deploy_to_org", status: "success" }),
          job({ name: "clean" }),
        ],
        "deployment",
      );
      assert.deepStrictEqual(picked, []);
    });

    test("never sends the payload of the provider to the panel", () => {
      const picked = pickUnfinishedJobsByKind(
        [job({ name: "Mega-Linter", raw: { token: "secret" } })],
        () => [],
        "validation",
      );
      assert.strictEqual("raw" in picked[0], false);
    });
  });

  suite("jobs of a GitLab pipeline", () => {
    function provider(jobs: any[], calls: any[] = []): any {
      const stub: any = Object.create(GitProviderGitlab.prototype);
      stub.gitlabProjectId = 42;
      stub.logApiCall = async () => undefined;
      stub.gitlabClient = {
        Jobs: {
          all: async (projectId: number, options: any) => {
            calls.push({ projectId, options });
            return jobs;
          },
        },
      };
      return stub;
    }
    const pipeline = {
      name: "feature/x",
      status: "running" as const,
      webUrl: "https://gitlab.example.com/g/p/-/pipelines/900",
      raw: {
        id: 900,
        web_url: "https://gitlab.example.com/g/p/-/pipelines/900",
      },
    };

    test("each job has its own page, a job of a later stage is pending", async () => {
      const calls: any[] = [];
      const jobs = await provider(
        [
          {
            name: "check_quality",
            status: "running",
            web_url: "https://gitlab.example.com/g/p/-/jobs/1",
            started_at: "2026-10-10T08:01:00.000Z",
          },
          {
            name: "deploy_to_org",
            status: "created",
            web_url: "https://gitlab.example.com/g/p/-/jobs/2",
            created_at: "2026-10-10T08:00:00.000Z",
          },
          {
            name: "optional",
            status: "manual",
            web_url: "https://gitlab.example.com/g/p/-/jobs/3",
          },
        ],
        calls,
      ).listJobsOfRun(pipeline);
      assert.strictEqual(calls[0].options.pipelineId, 900);
      assert.deepStrictEqual(
        jobs.map((item: Job) => [item.name, item.status, item.webUrl]),
        [
          [
            "check_quality",
            "running",
            "https://gitlab.example.com/g/p/-/jobs/1",
          ],
          [
            "deploy_to_org",
            "pending",
            "https://gitlab.example.com/g/p/-/jobs/2",
          ],
          ["optional", "unknown", "https://gitlab.example.com/g/p/-/jobs/3"],
        ],
      );
      assert.strictEqual(jobs[0].startedAt, "2026-10-10T08:01:00.000Z");
    });

    test("a commit status of an external CI has no pipeline to open", async () => {
      const calls: any[] = [];
      const jobs = await provider([], calls).listJobsOfRun({
        name: "jenkins",
        status: "running",
        raw: { id: 7, target_url: "https://jenkins.example.com/job/1" },
      });
      assert.deepStrictEqual(jobs, []);
      assert.strictEqual(calls.length, 0);
    });
  });

  suite("jobs of an Azure DevOps build", () => {
    function provider(records: any[]): any {
      const stub: any = Object.create(GitProviderAzure.prototype);
      stub.repoInfo = { owner: "MyProject", repo: "my-repo" };
      stub.logApiCall = async () => undefined;
      stub.buildApi = { getBuildTimeline: async () => ({ records }) };
      return stub;
    }
    const build = {
      name: "Check Pull Request",
      status: "running" as const,
      webUrl: "https://dev.azure.com/org/MyProject/_build/results?buildId=55",
      raw: { id: 55, definition: { name: "Check Pull Request" } },
    };

    test("keeps the jobs of the timeline, each one linked to its log", async () => {
      const jobs = await provider([
        { type: "Stage", name: "__default", state: 1 },
        {
          type: "Job",
          id: "aaa-111",
          name: "DeploymentCheck",
          state: 1,
          startTime: new Date("2026-10-10T08:00:00.000Z"),
        },
        { type: "Job", id: "bbb-222", name: "MegaLinter", state: 0 },
        { type: "Job", id: "ccc-333", name: "Done", state: 2, result: 0 },
        { type: "Job", id: "ddd-444", name: "Skipped", state: 2, result: 4 },
        { type: "Job", id: "eee-555", name: "Broken", state: 2, result: 2 },
        { type: "Task", name: "Git Checkout", state: 2, result: 0 },
      ]).listJobsOfRun(build);
      assert.deepStrictEqual(
        jobs.map((item: Job) => [item.name, item.status]),
        [
          ["DeploymentCheck", "running"],
          ["MegaLinter", "pending"],
          ["Done", "success"],
          ["Skipped", "unknown"],
          ["Broken", "failed"],
        ],
      );
      assert.strictEqual(
        jobs[0].webUrl,
        "https://dev.azure.com/org/MyProject/_build/results?buildId=55&view=logs&j=aaa-111",
      );
      assert.strictEqual(jobs[0].startedAt, "2026-10-10T08:00:00.000Z");
    });

    test("a completed Pull Request that was merged is merged, however the status is given", () => {
      const stub: any = Object.create(GitProviderAzure.prototype);
      // Status: Active (1), Abandoned (2), Completed (3). The node client gives the merge
      // status as a number (Succeeded is 3), the REST API as its name
      assert.strictEqual(
        stub.mapAzureStatusToState({ status: 3, mergeStatus: 3 }),
        "merged",
      );
      assert.strictEqual(
        stub.mapAzureStatusToState({ status: 3, mergeStatus: "succeeded" }),
        "merged",
      );
      assert.strictEqual(
        stub.mapAzureStatusToState({ status: 3, mergeStatus: 2 }),
        "closed",
      );
      assert.strictEqual(stub.mapAzureStatusToState({ status: 1 }), "open");
      assert.strictEqual(stub.mapAzureStatusToState({ status: 2 }), "declined");
    });

    test("a status of an external CI has no build to open", async () => {
      const jobs = await provider([]).listJobsOfRun({
        name: "external-ci",
        status: "pending",
        raw: { id: 3, targetUrl: "https://ci.example.com/1" },
      });
      assert.deepStrictEqual(jobs, []);
    });
  });

  suite("steps of a Bitbucket pipeline", () => {
    function provider(steps: any[], calls: any[] = []): any {
      const stub: any = Object.create(GitProviderBitbucket.prototype);
      stub.workspace = "ws";
      stub.repoSlug = "repo";
      stub.repoInfo = { webUrl: "https://bitbucket.org/ws/repo" };
      stub.logApiCall = async () => undefined;
      stub.bitbucketClient = {
        pipelines: {
          listSteps: async (params: any) => {
            calls.push(params);
            return { data: { values: steps } };
          },
        },
      };
      return stub;
    }
    const steps = [
      {
        uuid: "{step-1}",
        name: "Run MegaLinter",
        state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
      },
      {
        uuid: "{step-2}",
        name: "Simulate SFDX deployment",
        state: { name: "IN_PROGRESS" },
        started_on: "2026-10-10T08:02:00.000Z",
      },
    ];

    test("a pipeline listed as itself is read by its uuid", async () => {
      const calls: any[] = [];
      const jobs = await provider(steps, calls).listJobsOfRun({
        name: "pull-requests",
        status: "running",
        raw: { uuid: "{pipe-9}", build_number: 31 },
      });
      assert.strictEqual(calls[0].pipeline_uuid, "{pipe-9}");
      assert.deepStrictEqual(
        jobs.map((item: Job) => [item.name, item.status, item.webUrl]),
        [
          [
            "Run MegaLinter",
            "success",
            "https://bitbucket.org/ws/repo/pipelines/results/31/steps/%7Bstep-1%7D",
          ],
          [
            "Simulate SFDX deployment",
            "running",
            "https://bitbucket.org/ws/repo/pipelines/results/31/steps/%7Bstep-2%7D",
          ],
        ],
      );
    });

    test("a pipeline listed as a commit status is read by its build number", async () => {
      const calls: any[] = [];
      await provider(steps, calls).listJobsOfRun({
        name: "Pipeline #31",
        status: "running",
        webUrl:
          "https://bitbucket.org/ws/repo/addon/pipelines/home#!/results/31",
        raw: {
          key: "abc",
          url: "https://bitbucket.org/ws/repo/addon/pipelines/home#!/results/31",
        },
      });
      assert.strictEqual(calls[0].pipeline_uuid, "31");
    });

    test("the status of another CI ending like a pipeline address opens no pipeline", async () => {
      const calls: any[] = [];
      const jobs = await provider(steps, calls).listJobsOfRun({
        name: "other-ci",
        status: "running",
        webUrl: "https://ci.example.com/builds/results/31",
        raw: { key: "other-ci" },
      });
      assert.deepStrictEqual(jobs, []);
      assert.strictEqual(calls.length, 0);
    });

    test("a merged Pull Request is dated by its merge commit, not by its last comment", () => {
      const convert = (raw: any) =>
        (provider(steps, []) as any).convertToPullRequest({
          id: 8,
          state: "MERGED",
          updated_on: "2026-10-10T15:48:33.000Z",
          ...raw,
        });
      assert.strictEqual(
        convert({
          merge_commit: { hash: "04a0", date: "2026-10-10T15:43:39.000Z" },
        }).mergeDate,
        "2026-10-10T15:43:39.000Z",
      );
      assert.strictEqual(
        convert({ merge_commit: { hash: "04a0" } }).mergeDate,
        "2026-10-10T15:48:33.000Z",
      );
    });

    test("the step of the kind asked for gives the time a comment's job took", async () => {
      const calls: any[] = [];
      const timed = [
        {
          name: "Run MegaLinter",
          started_on: "2026-10-10T08:00:00.000Z",
          completed_on: "2026-10-10T08:06:00.000Z",
        },
        {
          name: "Simulate SFDX deployment",
          started_on: "2026-10-10T08:00:00.000Z",
          completed_on: "2026-10-10T08:02:05.000Z",
        },
      ];
      const timing = await provider(timed, calls).getJobTiming(
        "https://bitbucket.org/ws/repo/pipelines/results/31",
        "validation",
      );
      assert.strictEqual(calls[0].pipeline_uuid, "31");
      assert.strictEqual(jobDurationSeconds(timing), 125);
      // The link of another repository, or of another CI, is not asked
      assert.strictEqual(
        await provider(timed, calls).getJobTiming(
          "https://jenkins.example.com/pipelines/results/31",
          "validation",
        ),
        null,
      );
      assert.strictEqual(calls.length, 1);
    });

    test("the slug of the repository has no .git, which the pipelines endpoints refuse", () => {
      for (const remoteUrl of [
        "https://bitbucket.org/ws/repo.git",
        "https://bitbucket.org/ws/repo",
        "git@bitbucket.org:ws/repo.git",
        "https://someone@bitbucket.org/ws/repo.git/",
      ]) {
        assert.deepStrictEqual(
          GitProviderBitbucket.workspaceAndSlug(remoteUrl),
          ["ws", "repo"],
          remoteUrl,
        );
      }
      assert.deepStrictEqual(
        GitProviderBitbucket.workspaceAndSlug(
          "https://bitbucket.org/ws/my.repo.git",
        ),
        ["ws", "my.repo"],
      );
      assert.strictEqual(GitProviderBitbucket.workspaceAndSlug(""), null);
    });

    test("a status of an external CI has no pipeline to open", async () => {
      const calls: any[] = [];
      const jobs = await provider(steps, calls).listJobsOfRun({
        name: "jenkins",
        status: "running",
        webUrl: "https://jenkins.example.com/job/1",
        raw: { key: "jenkins" },
      });
      assert.deepStrictEqual(jobs, []);
      assert.strictEqual(calls.length, 0);
    });
  });
});
