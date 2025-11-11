import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Bitbucket } from "bitbucket";
import type { Schema } from "bitbucket";
import { ProviderDescription, PullRequest, Job, JobStatus } from "./types";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";

export class GitProviderBitbucket extends GitProvider {
  bitbucketClient: InstanceType<typeof Bitbucket> | null = null;
  workspace: string | null = null;
  repoSlug: string | null = null;
  secretTokenIdentifier: string = "";

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "Bitbucket",
      pullRequestLabel: "Pull Request",
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pull-requests`
        : "",
    };
  }

  async authenticate(): Promise<boolean | null> {
    const token = await vscode.window.showInputBox({
      prompt: "Enter your Bitbucket Token",
      ignoreFocusOut: true,
      password: true,
    });
    if (token) {
      await SecretsManager.setSecret(this.secretTokenIdentifier, token);
      await this.initialize();
      return this.isActive;
    }
    return null;
  }

  async initialize() {
    // Use a secret token stored in SecretsManager similar to GitLab provider
    this.secretTokenIdentifier = this.hostKey + "_TOKEN";
    const token = await SecretsManager.getSecret(this.secretTokenIdentifier);
    if (token && this.repoInfo?.host && this.repoInfo.remoteUrl) {
      this.bitbucketClient = new Bitbucket({
        auth: {
          // Bitbucket accepts username/password or app passwords; use token in password with empty username
          token: token,
        },
      } as any);

      // Extract workspace and repo slug from remote URL (common formats)
      // Examples:
      // git@bitbucket.org:workspace/repo.git
      // https://bitbucket.org/workspace/repo.git
      const match = this.repoInfo.remoteUrl.match(
        new RegExp("[:/]([^/:]+/[^/]+)(.git)?$"),
      );
      const projectPath = match ? match[1] : null;
      if (projectPath) {
        const parts = projectPath.split("/");
        this.workspace = parts[0];
        this.repoSlug = parts[1];
        // validate token by requesting repository info
        try {
          await this.bitbucketClient.repositories.get({
            workspace: this.workspace,
            repo_slug: this.repoSlug,
          } as any);
          await this.logApiCall("repositories.get", { caller: "initialize" });
          this.isActive = true;
        } catch (err) {
          Logger.log(
            `Bitbucket repository access check failed: ${String(err)}`,
          );
          this.isActive = false;
        }
      } else {
        Logger.log(
          `Could not extract Bitbucket workspace/repo from remote URL: ${this.repoInfo.remoteUrl}`,
        );
        this.isActive = false;
      }
    }
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return [];
    }
    try {
      // Bitbucket Cloud API: GET /repositories/{workspace}/{repo_slug}/pullrequests
      const response = await this.bitbucketClient.pullrequests.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
      } as any);
      await this.logApiCall("pullrequests.list", { caller: "listOpenPullRequests" });
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      return await this.convertAndCollectJobsList(values, { withJobs: true });
    } catch (err) {
      Logger.log(`Error fetching Bitbucket pull requests: ${String(err)}`);
      return [];
    }
  }

  async getActivePullRequestFromBranch(
    branchName: string,
  ): Promise<PullRequest | null> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return null;
    }
    try {
      const response = await this.bitbucketClient.pullrequests.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q: `source.branch.name = "${branchName}" AND state = "OPEN"`,
      } as any);
      await this.logApiCall("pullrequests.list", { caller: "getActivePullRequestFromBranch", q: `source.branch.name = "${branchName}" AND state = "OPEN"` });
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      if (!values || values.length === 0) {
        return null;
      }
      const converted = await this.convertAndCollectJobsList(
        values.slice(0, 1),
        { withJobs: true },
      );
      return converted[0] || null;
    } catch (err) {
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
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return [];
    }

    try {
      // Step 1: Find the last merged PR from currentBranch to targetBranch
      const lastMergeResponse = await this.bitbucketClient.pullrequests.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q: `source.branch.name = "${currentBranchName}" AND destination.branch.name = "${targetBranchName}" AND state = "MERGED"`,
      } as any);
      await this.logApiCall("pullrequests.list", { caller: "listPullRequestsInBranchSinceLastMerge", action: "findLastMerged", q: `source.branch.name = "${currentBranchName}" AND destination.branch.name = "${targetBranchName}" AND state = "MERGED"` });

      const lastMergePRs =
        lastMergeResponse &&
        lastMergeResponse.data &&
        lastMergeResponse.data.values
          ? lastMergeResponse.data.values
          : [];
      const lastMergeToTarget =
        lastMergePRs.length > 0 ? lastMergePRs[0] : null;

      // Step 2: Get commits between branches
      const commitsResponse = await this.bitbucketClient.commits.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        include: currentBranchName,
        exclude: lastMergeToTarget
          ? lastMergeToTarget.merge_commit?.hash
          : targetBranchName,
      } as any);
      await this.logApiCall("commits.list", { caller: "listPullRequestsInBranchSinceLastMerge", include: currentBranchName });

      const commits =
        commitsResponse && commitsResponse.data && commitsResponse.data.values
          ? commitsResponse.data.values
          : [];

      if (commits.length === 0) {
        return [];
      }

      const commitHashes = new Set(commits.map((c: any) => c.hash));

      // Step 3: Get all merged PRs targeting currentBranch and child branches (parallelized)
      const allBranches = [currentBranchName, ...childBranchesNames];

      const prPromises = allBranches.map(async (branchName) => {
        try {
          const response = await this.bitbucketClient!.pullrequests.list({
            workspace: this.workspace!,
            repo_slug: this.repoSlug!,
            q: `destination.branch.name = "${branchName}" AND state = "MERGED"`,
          } as any);
          await this.logApiCall("pullrequests.list", { caller: "listPullRequestsInBranchSinceLastMerge", action: "fetchMergedPRs", q: `destination.branch.name = "${branchName}" AND state = "MERGED"` });

          const values =
            response && response.data && response.data.values
              ? response.data.values
              : [];
          return values;
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
        const mergeCommitHash = pr.merge_commit?.hash;
        return mergeCommitHash && commitHashes.has(mergeCommitHash);
      });

      // Step 5: Remove duplicates
      const uniquePRsMap = new Map();
      for (const pr of relevantPRs) {
        if (!uniquePRsMap.has(pr.id)) {
          uniquePRsMap.set(pr.id, pr);
        }
      }

      const uniquePRs = Array.from(uniquePRsMap.values());

      // Step 6: Convert to PullRequest format with jobs
      return await this.convertAndCollectJobsList(uniquePRs, {
        withJobs: false,
      });
    } catch (err) {
      Logger.log(
        `Error in listPullRequestsInBranchSinceLastMerge: ${String(err)}`,
      );
      return [];
    }
  }

  convertToPullRequest(pr: any): PullRequest {
    return {
      id: pr.id,
      number: pr.id,
      title: pr.title,
      description: pr.description || "",
      state: (pr.state || "").toLowerCase() as PullRequest["state"],
      authorLabel: pr.author?.display_name || pr.author?.username || "unknown",
      webUrl: pr.links?.html?.href || pr.links?.self?.href || "",
      sourceBranch: pr.source?.branch?.name || "",
      targetBranch: pr.destination?.branch?.name || "",
      mergeDate:
        pr.state === "MERGED" && pr.updated_on ? pr.updated_on : undefined,
      createdAt: pr.created_on || undefined,
      updatedAt: pr.updated_on || undefined,
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
    // Bitbucket: https://bitbucket.org/owner/repo/pull-requests/new?source=source&dest=target&title=MAJOR:%20sourceBranch%20to%20targetBranch
    const title = `MAJOR: ${sourceBranch} to ${targetBranch}`;
    return `${this.repoInfo.webUrl}/pull-requests/new?source=${encodeURIComponent(sourceBranch)}&dest=${encodeURIComponent(targetBranch)}&title=${encodeURIComponent(title)}`;
  }

  // Fetch pipelines for a Bitbucket PR (Bitbucket Cloud). Best-effort: query pipelines by commit/branch
  private async fetchLatestJobsForPullRequest(
    rawPr: any,
    pr: PullRequest,
  ): Promise<Job[]> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return [];
    }
    try {
      // Try to find the commit hash
      const commit =
        rawPr && rawPr.source && rawPr.source.commit
          ? rawPr.source.commit.hash
          : undefined;
      // Query pipelines endpoint: GET /repositories/{workspace}/{repo_slug}/pipelines/?sort=-created_on&q=target.ref_name="branch"
      const q = commit
        ? `target.commit.hash = "${commit}"`
        : `target.ref_name = "${pr.sourceBranch}"`;
      const response = await this.bitbucketClient.pipelines.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q,
        sort: "-created_on",
      } as any);
      await this.logApiCall("pipelines.list", { caller: "fetchLatestJobsForPullRequest" });
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      if (!values || values.length === 0) {
        return [];
      }
      const pipeline = values[0];
      // Map pipeline steps to PullRequestJob if available
      const p: any = pipeline as any;
      const converted: Job[] = [
        {
          name: String((p && p.target && p.target.ref_name) || p.id || ""),
          status: String(
            (p &&
              p.state &&
              ((p.state.result && p.state.result.name) || p.state.name)) ||
              "",
          ) as Job["status"],
          webUrl:
            String(
              (p && p.links && p.links.html && p.links.html.href) || undefined,
            ) || undefined,
          updatedAt:
            String((p && (p.updated_on || p.created_on)) || undefined) ||
            undefined,
          raw: p,
        },
      ];
      return converted;
    } catch {
      return [];
    }
  }

  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return null;
    }
    try {
      // Query pipelines for the branch
      const response = await this.bitbucketClient.pipelines.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q: `target.ref_name = "${branchName}"`,
        sort: "-created_on",
      } as any);
      await this.logApiCall("pipelines.list", { caller: "getJobsForBranchLatestCommit", q: `target.ref_name = "${branchName}"` });
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      if (!values || values.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Filter out pipelines triggered by pull requests
      // Only keep pipelines triggered by direct commits (trigger type: 'PUSH', 'MANUAL', 'SCHEDULE', etc.)
      // Exclude pipelines with trigger type: 'PULL_REQUEST'
      const commitPipelines = values.filter(
        (p: any) => p.trigger?.type !== "PULL_REQUEST",
      );

      if (commitPipelines.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Use the most recent commit-triggered pipeline
      const pipeline1 = commitPipelines[0];
      const pipeline = pipeline1 as any;
      const job: Job = {
        name: pipeline?.target?.selector?.target || pipeline.target?.type || pipeline.uuid || "Default pipeline name",
        status: this.mapPipelineStateToJobStatus(pipeline.state),
        webUrl: pipeline.links?.html?.href || undefined,
        updatedAt: pipeline.updated_on || undefined,
        raw: pipeline,
      };
      return { jobs: [job], jobsStatus: this.computeJobsStatus([job]) };
    } catch (e) {
      Logger.log(`Error fetching jobs for branch ${branchName}: ${String(e)}`);
      return null;
    }
  }

  private mapPipelineStateToJobStatus(state: Schema.PipelineState | undefined): JobStatus {
    if (!state) {
      return "unknown";
    }
    // Bitbucket Pipeline state structure:
    // - state.name: Current stage (e.g., "PENDING", "IN_PROGRESS", "COMPLETED")
    // - state.result.name: Final result (e.g., "SUCCESSFUL", "FAILED", "STOPPED", "ERROR")
    // Priority: check result first for completed pipelines, then stage
    const stateAny = state as any;
    const resultName = stateAny.result?.name;
    const stageName = stateAny.name;
    const statusString = resultName || stageName;
    if (!statusString) {
      return "unknown";
    }
    const statusLower = String(statusString).toLowerCase();
    // Map Bitbucket pipeline states to JobStatus
    // Stage states
    if (statusLower === "pending" || statusLower === "queued") {
      return "pending";
    }
    if (statusLower === "in_progress" || statusLower === "running") {
      return "running";
    }
    // Result states (for completed pipelines)
    if (statusLower === "successful" || statusLower === "passed") {
      return "success";
    }
    if (
      statusLower === "failed" ||
      statusLower === "error" ||
      statusLower === "stopped" ||
      statusLower === "expired" ||
      statusLower === "unhandled"
    ) {
      return "failed";
    }
    // If completed but no clear result
    if (statusLower === "completed") {
      return "unknown";
    }
    return "unknown";
  }

  // Helper to convert raw Bitbucket PR and attach jobs/jobsStatus
  // Batch helper: convert an array of raw Bitbucket PRs and enrich each with jobs
  private async convertAndCollectJobsList(
    rawPrs: Schema.PaginatedPullrequests["values"],
    options: { withJobs: boolean },
  ): Promise<PullRequest[]> {
    if (!rawPrs || rawPrs.length === 0) {
      return [];
    }
    const converted: PullRequest[] = await Promise.all(
      rawPrs.map(async (r) => {
        const conv = this.convertToPullRequest(r);
        if (options.withJobs === true) {
          try {
            const jobs = await this.fetchLatestJobsForPullRequest(r, conv);
            conv.jobs = jobs;
            conv.jobsStatus = this.computeJobsStatus(jobs);
          } catch (e) {
            Logger.log(
              `Error fetching jobs for PR #${conv.number}: ${String(e)}`,
            );
          }
        }
        return conv;
      }),
    );
    return converted;
  }
}
