import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Bitbucket } from "bitbucket";
import type { Schema } from "bitbucket";
import { ProviderDescription, PullRequest, Job, JobStatus } from "./types";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";
import { t } from "../../i18n/i18n";
import { showAuthFailureGuidance } from "../providerCredentials";

export class GitProviderBitbucket extends GitProvider {
  bitbucketClient: InstanceType<typeof Bitbucket> | null = null;
  workspace: string | null = null;
  repoSlug: string | null = null;
  secretTokenIdentifier: string = "";

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "Bitbucket",
      pullRequestLabel: t("pullRequestLabel"),
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pull-requests`
        : "",
    };
  }

  async disconnect(): Promise<void> {
    const secretKeys = [
      `${this.hostKey}_BITBUCKET_TOKEN`,
      `${this.hostKey}_BITBUCKET_EMAIL`,
    ];
    for (const key of secretKeys) {
      try {
        await SecretsManager.deleteSecret(key);
      } catch {
        // Ignore if secret doesn't exist
      }
    }

    this.bitbucketClient = null;
    this.workspace = null;
    this.repoSlug = null;
    this.isActive = false;
    Logger.log(
      `Disconnected from Bitbucket (${this.repoInfo?.host || "unknown host"})`,
    );
    await super.disconnect();
  }

  async authenticate(): Promise<boolean | null> {
    const ATLASSIAN_API_TOKEN_URL =
      "https://id.atlassian.com/manage-profile/security/api-tokens";
    // Repository-scoped access token URL: build from repoInfo when available
    const host = this.repoInfo?.host || "bitbucket.org";
    const owner = this.repoInfo?.owner || "";
    const repo = this.repoInfo?.repo || "";
    const repoAccessTokenUrl =
      owner && repo
        ? `https://${host}/${owner}/${repo}/admin/access-tokens`
        : "https://support.atlassian.com/bitbucket-cloud/docs/access-tokens/";

    const choice = await vscode.window.showQuickPick(
      [
        { label: t("useAccessToken"), value: "token" },
        { label: t("useEmailAndApiToken"), value: "basic" },
      ],
      {
        placeHolder: t("bitbucketAuthMethodPlaceholder"),
        ignoreFocusOut: true,
      },
    );
    if (!choice) {
      return null;
    }

    if (choice.value === "token") {
      return await this.authenticateWithToken(repoAccessTokenUrl);
    } else {
      return await this.authenticateWithEmailAndToken(ATLASSIAN_API_TOKEN_URL);
    }
  }

  private async authenticateWithToken(
    tokenUrl: string,
  ): Promise<boolean | null> {
    const token = await vscode.window.showInputBox({
      prompt: t("bitbucketEnterToken"),
      ignoreFocusOut: true,
      password: true,
      placeHolder: t("bitbucketCreateApiTokenAt", { url: tokenUrl }),
    });
    if (!token) {
      return null;
    }
    await SecretsManager.setSecret(this.hostKey + "_BITBUCKET_TOKEN", token);
    await SecretsManager.deleteSecret(this.hostKey + "_BITBUCKET_EMAIL").catch(
      () => {},
    );
    await this.initializeClient("", token);
    return this.isActive;
  }

  private async authenticateWithEmailAndToken(
    tokenUrl: string,
  ): Promise<boolean | null> {
    const email = await vscode.window.showInputBox({
      prompt: t("bitbucketEnterEmail"),
      ignoreFocusOut: true,
      placeHolder: t("emailPlaceholder"),
    });
    if (!email) {
      return null;
    }
    const token = await vscode.window.showInputBox({
      prompt: t("bitbucketEnterToken"),
      ignoreFocusOut: true,
      password: true,
      placeHolder: t("bitbucketCreateApiTokenAt", { url: tokenUrl }),
    });
    if (!token) {
      return null;
    }
    await SecretsManager.setSecret(this.hostKey + "_BITBUCKET_EMAIL", email);
    await SecretsManager.setSecret(this.hostKey + "_BITBUCKET_TOKEN", token);
    await this.initializeClient(email, token);
    return this.isActive;
  }

  async initialize() {
    this.secretTokenIdentifier = this.hostKey + "_BITBUCKET_TOKEN";
    const token =
      (await SecretsManager.getSecret(this.hostKey + "_BITBUCKET_TOKEN")) || "";
    const email =
      (await SecretsManager.getSecret(this.hostKey + "_BITBUCKET_EMAIL")) || "";

    if (token && this.repoInfo?.host && this.repoInfo.remoteUrl) {
      await this.initializeClient(email, token);
    }
  }

  private async initializeClient(email: string, token: string): Promise<void> {
    if (email) {
      this.bitbucketClient = new Bitbucket({
        auth: {
          username: email,
          password: token,
        },
      } as any);
    } else {
      this.bitbucketClient = new Bitbucket({
        auth: {
          token: token,
        },
      } as any);
    }

    // Extract workspace and repo slug from remote URL (common formats)
    // Examples:
    // git@bitbucket.org:workspace/repo.git
    // https://bitbucket.org/workspace/repo.git
    const match = this.repoInfo!.remoteUrl.match(
      new RegExp("[:/]([^/:]+/[^/]+)(.git)?$"),
    );
    const projectPath = match ? match[1] : null;
    if (projectPath) {
      const parts = projectPath.split("/");
      this.workspace = parts[0];
      this.repoSlug = parts[1];
      // validate credentials by requesting repository info
      try {
        await this.bitbucketClient.repositories.get({
          workspace: this.workspace,
          repo_slug: this.repoSlug,
        } as any);
        await this.logApiCall("repositories.get", { caller: "initialize" });
        this.isActive = true;
      } catch (err) {
        Logger.log(`Bitbucket repository access check failed: ${String(err)}`);
        this.isActive = false;
        const host = this.repoInfo?.host || "bitbucket.org";
        const repoTokenUrl =
          this.workspace && this.repoSlug
            ? `https://${host}/${this.workspace}/${this.repoSlug}/admin/access-tokens`
            : "https://support.atlassian.com/bitbucket-cloud/docs/access-tokens/";
        showAuthFailureGuidance({
          providerName: "Bitbucket",
          guidance: t("bitbucketAuthInfo"),
          createTokenUrl: repoTokenUrl,
          docUrl:
            "https://support.atlassian.com/bitbucket-cloud/docs/access-tokens/",
        });
      }
    } else {
      Logger.log(
        `Could not extract Bitbucket workspace/repo from remote URL: ${this.repoInfo!.remoteUrl}`,
      );
      this.isActive = false;
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
      await this.logApiCall("pullrequests.list", {
        caller: "listOpenPullRequests",
      });
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
      await this.logApiCall("pullrequests.list", {
        caller: "getActivePullRequestFromBranch",
        q: `source.branch.name = "${branchName}" AND state = "OPEN"`,
      });
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
      await this.logApiCall("pullrequests.list", {
        caller: "listPullRequestsInBranchSinceLastMerge",
        action: "findLastMerged",
        q: `source.branch.name = "${currentBranchName}" AND destination.branch.name = "${targetBranchName}" AND state = "MERGED"`,
      });

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
      await this.logApiCall("commits.list", {
        caller: "listPullRequestsInBranchSinceLastMerge",
        include: currentBranchName,
        exclude: lastMergeToTarget
          ? lastMergeToTarget.merge_commit?.hash
          : targetBranchName,
      });

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
          await this.logApiCall("pullrequests.list", {
            caller: "listPullRequestsInBranchSinceLastMerge",
            action: "fetchMergedPRs",
            q: `destination.branch.name = "${branchName}" AND state = "MERGED"`,
          });

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

  // Fetch build statuses for a Bitbucket PR.
  // Primary: commit statuses API (covers external CI like Jenkins, CircleCI, etc.)
  // Fallback: Bitbucket Pipelines (for repos using native Bitbucket CI)
  private async fetchLatestJobsForPullRequest(
    rawPr: any,
    pr: PullRequest,
  ): Promise<Job[]> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return [];
    }

    // Primary: commit statuses reported against the PR (Jenkins, external CI)
    try {
      const statusResponse =
        await this.bitbucketClient.repositories.listPullRequestStatuses({
          workspace: this.workspace,
          repo_slug: this.repoSlug,
          pull_request_id: rawPr.id, // rawPr.id is always a Bitbucket integer PR id
        } as any);
      await this.logApiCall("repositories.listPullRequestStatuses", {
        caller: "fetchLatestJobsForPullRequest",
        pull_request_id: pr.id,
      });
      const statuses = statusResponse?.data?.values ?? [];
      if (statuses.length > 0) {
        return statuses.map((s: any) => ({
          name: s.name || s.key || "Build",
          status: this.mapCommitStatusStateToJobStatus(s.state),
          webUrl: s.url || undefined,
          updatedAt: s.updated_on || undefined,
          raw: s,
        }));
      }
    } catch (err) {
      Logger.log(`Error fetching PR commit statuses: ${String(err)}`);
    }

    // Fallback: Bitbucket Pipelines
    try {
      const commit =
        rawPr && rawPr.source && rawPr.source.commit
          ? rawPr.source.commit.hash
          : undefined;
      const q = commit
        ? `target.commit.hash = "${commit}"`
        : `target.ref_name = "${pr.sourceBranch}"`;
      const response = await this.bitbucketClient.pipelines.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q,
        sort: "-created_on",
      } as any);
      await this.logApiCall("pipelines.list", {
        caller: "fetchLatestJobsForPullRequest",
        q,
      });
      const values = response?.data?.values ?? [];
      if (values.length === 0) {
        return [];
      }
      const pipeline: any = values[0];
      return [
        {
          name:
            pipeline?.target?.selector?.target ||
            pipeline.target?.type ||
            pipeline.uuid ||
            "Default pipeline name",
          status: this.mapPipelineStateToJobStatus(pipeline.state),
          webUrl: pipeline.links?.html?.href || undefined,
          updatedAt: pipeline.updated_on || undefined,
          raw: pipeline,
        },
      ];
    } catch (err) {
      Logger.log(
        `Error fetching jobs for PR on branch ${pr.sourceBranch}: ${String(err)}`,
      );
      return [];
    }
  }

  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return null;
    }

    // Primary: commit statuses for the latest commit on the branch (covers Jenkins, external CI)
    try {
      // listCommitsAt maps to /commits/{revision} — the canonical endpoint for branch commits
      const commitsResponse =
        await this.bitbucketClient.repositories.listCommitsAt({
          workspace: this.workspace,
          repo_slug: this.repoSlug,
          revision: branchName,
          pagelen: 1,
        } as any);
      await this.logApiCall("repositories.listCommitsAt", {
        caller: "getJobsForBranchLatestCommit",
        revision: branchName,
      });
      const latestCommit = commitsResponse?.data?.values?.[0]?.hash;
      if (latestCommit) {
        const statusResponse =
          await this.bitbucketClient.repositories.listCommitStatuses({
            workspace: this.workspace,
            repo_slug: this.repoSlug,
            commit: latestCommit,
          } as any);
        await this.logApiCall("repositories.listCommitStatuses", {
          caller: "getJobsForBranchLatestCommit",
          commit: latestCommit,
        });
        const statuses = statusResponse?.data?.values ?? [];
        if (statuses.length > 0) {
          const jobs: Job[] = statuses.map((s: any) => ({
            name: s.name || s.key || "Build",
            status: this.mapCommitStatusStateToJobStatus(s.state),
            webUrl: s.url || undefined,
            updatedAt: s.updated_on || undefined,
            raw: s,
          }));
          return { jobs, jobsStatus: this.computeJobsStatus(jobs) };
        }
      }
    } catch (e) {
      Logger.log(
        `Error fetching commit statuses for branch ${branchName}: ${String(e)}`,
      );
    }

    // Fallback: Bitbucket Pipelines
    try {
      const response = await this.bitbucketClient.pipelines.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q: `target.ref_name = "${branchName}"`,
        sort: "-created_on",
      } as any);
      await this.logApiCall("pipelines.list", {
        caller: "getJobsForBranchLatestCommit",
        q: `target.ref_name = "${branchName}"`,
      });
      const values = response?.data?.values ?? [];
      if (!values || values.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Exclude pipelines triggered by pull requests
      const commitPipelines = values.filter(
        (p: any) => p.trigger?.type !== "PULL_REQUEST",
      );
      if (commitPipelines.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      const pipeline: any = commitPipelines[0];
      const job: Job = {
        name:
          pipeline?.target?.selector?.target ||
          pipeline.target?.type ||
          pipeline.uuid ||
          "Default pipeline name",
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

  private mapPipelineStateToJobStatus(
    state: Schema.PipelineState | undefined,
  ): JobStatus {
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

  // Maps Bitbucket commit status state strings to JobStatus.
  // Used for external CI systems (Jenkins, CircleCI, etc.) that report via the commit status API.
  private mapCommitStatusStateToJobStatus(
    state: string | undefined,
  ): JobStatus {
    if (!state) {
      return "unknown";
    }
    switch (String(state).toUpperCase()) {
      case "SUCCESSFUL":
        return "success";
      case "FAILED":
        return "failed";
      case "INPROGRESS":
        return "running";
      case "STOPPED":
        return "failed";
      default:
        return "unknown";
    }
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
