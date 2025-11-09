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

  async getActivePullRequestFromBranch(
    branchName: string,
  ): Promise<PullRequest | null> {
    if (!this.gitHubClient || !this.repoInfo) {
      return null;
    }
    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];
    try {
      const { data: pullRequests } = await this.gitHubClient.pulls.list({
        owner,
        repo,
        head: `${owner}:${branchName}`,
        state: "open",
        per_page: 1,
      });
      if (pullRequests.length === 0) {
        return null;
      }
      const converted = await this.convertAndCollectJobsList(pullRequests);
      return converted[0] || null;
    }
    catch (err) {
      Logger.log(
        `Error fetching active PR for branch ${branchName}: ${String(err)}`,
      );
      return null;
    }
  }

  async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string,
    targetBranchName: string,
    childBranchesNames: string[],
  ): Promise<PullRequest[]> {
    if (!this.gitHubClient || !this.repoInfo) {
      return [];
    }

    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];

    try {
      // Step 1: Find the last merged PR from currentBranch to targetBranch
      const { data: mergedPRs } = await this.gitHubClient.pulls.list({
        owner,
        repo,
        state: "closed",
        head: `${owner}:${currentBranchName}`,
        base: targetBranchName,
        sort: "updated",
        direction: "desc",
        per_page: 1,
      });

      const lastMergeToTarget = mergedPRs.find((pr) => pr.merged_at);

      // Step 2: Get commits since last merge
      const compareOptions: any = {
        owner,
        repo,
        base: lastMergeToTarget
          ? lastMergeToTarget.merge_commit_sha!
          : targetBranchName,
        head: currentBranchName,
        per_page: 100,
      };

      const { data: comparison } =
        await this.gitHubClient.repos.compareCommits(compareOptions);

      if (!comparison.commits || comparison.commits.length === 0) {
        return [];
      }

      const commitSHAs = new Set(comparison.commits.map((c) => c.sha));

      // Step 3: Get all merged PRs targeting currentBranch and child branches (parallelized)
      const allBranches = [currentBranchName, ...childBranchesNames];

      const prPromises = allBranches.map(async (branchName) => {
        try {
          const { data: prs } = await this.gitHubClient!.pulls.list({
            owner,
            repo,
            state: "closed",
            base: branchName,
            per_page: 100,
          });
          return prs.filter((pr) => pr.merged_at);
        } catch (err) {
          Logger.log(
            `Error fetching merged PRs for branch ${branchName}: ${String(err)}`,
          );
          return [];
        }
      });

      const prResults = await Promise.all(prPromises);
      const allMergedPRs: any[] = prResults.flat();

      // Step 4: Filter PRs whose merge commit is in our commit list
      const relevantPRs = allMergedPRs.filter((pr) => {
        return pr.merge_commit_sha && commitSHAs.has(pr.merge_commit_sha);
      });

      // Step 5: Remove duplicates
      const uniquePRsMap = new Map();
      for (const pr of relevantPRs) {
        if (!uniquePRsMap.has(pr.number)) {
          uniquePRsMap.set(pr.number, pr);
        }
      }

      const uniquePRs = Array.from(uniquePRsMap.values());

      // Step 6: Convert to PullRequest format with jobs
      return await this.convertAndCollectJobsList(uniquePRs);
    } catch (err) {
      Logger.log(
        `Error in listPullRequestsInBranchSinceLastMerge: ${String(err)}`,
      );
      return [];
    }
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
      mergeDate: pr.merged_at || undefined,
      createdAt: pr.created_at || undefined,
      updatedAt: pr.updated_at || undefined,
      jobsStatus: "unknown",
    };
  }

  getCreatePullRequestUrl(
    sourceBranch: string,
    targetBranch: string,
  ): string | null {
    if (!this.repoInfo?.webUrl) {
      return null;
    }
    // GitHub: https://github.com/owner/repo/compare/target...source?expand=1&title=MAJOR:%20sourceBranch%20to%20targetBranch
    const title = `MAJOR: ${sourceBranch} to ${targetBranch}`;
    return `${this.repoInfo.webUrl}/compare/${encodeURIComponent(targetBranch)}...${encodeURIComponent(sourceBranch)}?expand=1&title=${encodeURIComponent(title)}`;
  }
}
