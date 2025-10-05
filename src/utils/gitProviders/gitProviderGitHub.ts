import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Octokit } from "@octokit/rest";
import type { Endpoints } from "@octokit/types";
import { ProviderDescription, PullRequest, Job, JobStatus } from "./types";
import { Logger } from "../../logger";

export class GitProviderGitHub extends GitProvider {
  gitHubClient: InstanceType<typeof Octokit> | null = null;

  handlesNativeGitAuth(): boolean {
    return true;
  }

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "GitHub",
      pullRequestLabel: "Pull Request",
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pulls`
        : "",
    };
  }

  async authenticate(): Promise<boolean | null> {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      forceNewSession: true,
    });
    if (session.accessToken) {
      await this.initialize();
      return this.isActive;
    }
    return false;
  }

  async initialize() {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: false,
    });
    if (!session || !this.repoInfo?.host || !this.repoInfo.remoteUrl) {
      return;
    }
    try {
      this.gitHubClient = new Octokit({
        auth: session.accessToken,
        baseUrl:
          this.repoInfo.host === "github.com"
            ? undefined
            : `https://${this.repoInfo.host}/api/v3`,
      });
      // validate token by calling GET /user
      await this.gitHubClient.request("GET /user");
      this.isActive = true;
    } catch {
      this.gitHubClient = null;
      this.isActive = false;
    }
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    const [owner, repo] = [this.repoInfo!.owner, this.repoInfo!.repo];
    const { data: pullRequests } = await this.gitHubClient!.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 100,
    });
    return await this.convertAndCollectJobsList(pullRequests);
  }

  async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
    const [owner, repo] = [this.repoInfo!.owner, this.repoInfo!.repo];
    const { data: pullRequests } = await this.gitHubClient!.pulls.list({
      owner,
      repo,
      base: branchName,
      per_page: 100,
    });
    return await this.convertAndCollectJobsList(pullRequests);
  }

  // Helper to convert a raw GitHub PR and attach jobs/jobsStatus
  // Batch helper: convert an array of raw GitHub PRs and enrich each with jobs
  private async convertAndCollectJobsList(
    rawPrs: Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"],
  ): Promise<PullRequest[]> {
    if (!rawPrs || rawPrs.length === 0) {
      return [];
    }
    const converted: PullRequest[] = await Promise.all(
      rawPrs.map(async (r) => {
        const converted = this.convertToPullRequest(r);
        try {
          const jobs = await this.fetchLatestJobsForPullRequest(converted);
          converted.jobs = jobs;
          converted.jobsStatus = this.computeJobsStatus(jobs);
        } catch (e) {
          Logger.log(
            `Error fetching jobs for PR #${converted.number}: ${String(e)}`,
          );
        }
        return converted;
      }),
    );
    return converted;
  }

  // Fetch latest workflow run jobs for a pull request using the source branch
  private async fetchLatestJobsForPullRequest(pr: PullRequest): Promise<Job[]> {
    if (!this.gitHubClient || !this.repoInfo) {
      return [];
    }
    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];
    try {
      // List workflow runs for branch (head branch)
      const runsResp = await this.gitHubClient.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch: pr.sourceBranch,
        per_page: 10,
      });
      const runs =
        runsResp.data && runsResp.data.workflow_runs
          ? runsResp.data.workflow_runs
          : [];
      if (!runs || runs.length === 0) {
        return [];
      }
      // pick the most recent completed/in_progress run
      const run = runs[0];
      // fetch jobs for this run
      const jobsResp = await this.gitHubClient.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: run.id,
      });
      const jobs =
        jobsResp.data && jobsResp.data.jobs ? jobsResp.data.jobs : [];
      const converted: Job[] = jobs.map((j: any) => ({
        name: j.name || j.step_name || String(j.id || ""),
        status: (j.conclusion || j.status || "").toString(),
        webUrl: j.html_url || undefined,
        updatedAt: j.updated_at || j.completed_at || undefined,
        raw: j,
      }));
      return converted;
    } catch {
      return [];
    }
  }

  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    if (!this.gitHubClient || !this.repoInfo) {
      return null;
    }
    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];
    try {
      // List workflow runs for branch (most recent first)
      const runsResp = await this.gitHubClient.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch: branchName,
        per_page: 10,
      });
      const runs =
        runsResp.data && runsResp.data.workflow_runs
          ? runsResp.data.workflow_runs
          : [];
      if (!runs || runs.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Filter out workflow runs triggered by pull requests
      // Only keep runs triggered by direct commits (event: 'push', 'workflow_dispatch', 'schedule', etc.)
      // Exclude runs with event: 'pull_request'
      const commitRuns = runs.filter(
        (r) => r.event !== "pull_request" && r.event !== "pull_request_target",
      );

      if (commitRuns.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // pick the most recent commit-triggered run
      const run = commitRuns[0];
      // fetch jobs for this run
      const jobsResp = await this.gitHubClient.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: run.id,
      });
      const jobs =
        jobsResp.data && jobsResp.data.jobs ? jobsResp.data.jobs : [];
      const converted: Job[] = jobs.map((j: any) => ({
        name: j.name || j.step_name || String(j.id || ""),
        status: (j.conclusion || j.status || "").toString() as JobStatus,
        webUrl: j.html_url || undefined,
        updatedAt: j.updated_at || j.completed_at || undefined,
        raw: j,
      }));
      return { jobs: converted, jobsStatus: this.computeJobsStatus(converted) };
    } catch (e) {
      Logger.log(`Error fetching jobs for branch ${branchName}: ${String(e)}`);
      return null;
    }
  }

  convertToPullRequest(pr: any): PullRequest {
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      description: pr.body || "",
      state: pr.state as PullRequest["state"],
      authorLabel: pr.user?.login || pr.user?.name || "unknown",
      webUrl: pr.html_url,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      jobsStatus: "unknown",
    };
  }
}
