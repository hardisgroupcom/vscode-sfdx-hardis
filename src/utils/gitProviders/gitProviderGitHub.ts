import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Octokit } from "@octokit/rest";
import type { Endpoints } from "@octokit/types";
import {
  CreateTokenOption,
  GoLive,
  ProviderDescription,
  PullRequest,
  Job,
  JobStatus,
} from "./types";
import { Logger } from "../../logger";
import { SecretsManager } from "../secretsManager";
import { t } from "../../i18n/i18n";
import {
  promptForToken,
  showAuthFailureGuidance,
} from "../providerCredentials";

export class GitProviderGitHub extends GitProvider {
  gitHubClient: InstanceType<typeof Octokit> | null = null;

  handlesNativeGitAuth(): boolean {
    return true;
  }

  getCreateTokenOptions(): CreateTokenOption[] {
    // Use GitHub fine-grained tokens only (not classic). The creation page is
    // /settings/personal-access-tokens/new (GitHub Enterprise Server 3.10+ supports it).
    // The user must grant the token access to this repository, then set the permissions
    // below. "Workflows" is intentionally NOT requested (it would allow editing workflow
    // definitions); "Metadata: Read" is added automatically by GitHub.
    const host = this.repoInfo?.host || "github.com";
    const repoSlug =
      this.repoInfo?.owner && this.repoInfo?.repo
        ? `${this.repoInfo.owner}/${this.repoInfo.repo}`
        : this.repoInfo?.repo || "";
    return [
      {
        id: "pat",
        label: t("createGithubPat"),
        url: `https://${host}/settings/personal-access-tokens/new`,
        creationHint: repoSlug
          ? t("githubTokenRepositoryHint", { repo: repoSlug })
          : undefined,
        scopesHint:
          "Contents (Read and write), Pull requests (Read and write), Issues (Read and write), Actions (Read and write), Commit statuses (Read)",
      },
    ];
  }

  async disconnect(): Promise<void> {
    // GitHub can use either VS Code's embedded authentication (session managed by
    // VS Code, not deleted here) or a stored personal access token. Remove the PAT.
    try {
      await SecretsManager.deleteSecret(this.hostKey + "_TOKEN");
    } catch {
      // Ignore if secret doesn't exist
    }
    // Forget the explicit built-in sign-in so the native session is no longer reused.
    await SecretsManager.deleteSecret(
      this.hostKey + "_GITHUB_BUILTIN_AUTH",
    ).catch(() => {});
    // The native VS Code session cannot be removed programmatically, so remember the
    // explicit disconnect to prevent initialize() from silently re-connecting from it.
    await SecretsManager.setSecret(this.hostKey + "_DISCONNECTED", "true");
    this.gitHubClient = null;
    this.isActive = false;
    Logger.log(
      `Disconnected from GitHub (${this.repoInfo?.host || "unknown host"})`,
    );
    await super.disconnect();
  }

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "GitHub",
      pullRequestLabel: t("pullRequestLabel"),
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pulls`
        : "",
    };
  }

  async authenticate(): Promise<boolean | null> {
    const builtInLabel = t("githubAuthBuiltIn");
    const tokenLabel = t("githubAuthToken");
    const choice = await vscode.window.showInformationMessage(
      t("githubAuthMethod"),
      { modal: true },
      builtInLabel,
      tokenLabel,
    );
    if (!choice) {
      return null;
    }
    if (choice === tokenLabel) {
      return await this.authenticateWithToken();
    }
    return await this.authenticateWithBuiltIn();
  }

  private async authenticateWithBuiltIn(): Promise<boolean> {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      forceNewSession: true,
    });
    if (session?.accessToken) {
      // Remember that the user explicitly chose the built-in VS Code sign-in, so
      // initialize() may reuse the native session on later loads (and so an ambient
      // session the user never opted into does not make GitHub look connected).
      await SecretsManager.setSecret(
        this.hostKey + "_GITHUB_BUILTIN_AUTH",
        "true",
      );
      // Drop any stored PAT so initialize() relies on the native VS Code session,
      // and clear the disconnect flag so initialize() may use the session again.
      await SecretsManager.deleteSecret(this.hostKey + "_TOKEN").catch(
        () => {},
      );
      await SecretsManager.deleteSecret(this.hostKey + "_DISCONNECTED").catch(
        () => {},
      );
      await this.initialize();
      return this.isActive;
    }
    return false;
  }

  private async authenticateWithToken(): Promise<boolean | null> {
    const token = await promptForToken({
      providerLabel: "GitHub",
      inputPrompt: t("githubEnterPAT"),
      createTokenOptions: this.getCreateTokenOptions(),
    });
    if (!token) {
      return null;
    }
    await SecretsManager.setSecret(this.hostKey + "_TOKEN", token);
    await SecretsManager.deleteSecret(this.hostKey + "_DISCONNECTED").catch(
      () => {},
    );
    await this.initialize();
    return this.isActive;
  }

  async initialize() {
    if (!this.repoInfo?.host || !this.repoInfo.remoteUrl) {
      return;
    }
    // Prefer a stored personal access token; otherwise fall back to the native
    // VS Code GitHub session — unless the user explicitly disconnected (the native
    // session cannot be removed programmatically, so we honor a disconnect flag).
    let accessToken = await SecretsManager.getSecret(this.hostKey + "_TOKEN");
    if (!accessToken) {
      const disconnected = await SecretsManager.getSecret(
        this.hostKey + "_DISCONNECTED",
      );
      if (disconnected) {
        return;
      }
      // Only reuse the native VS Code GitHub session when the user explicitly chose
      // the built-in sign-in. Otherwise an ambient VS Code session (often present for
      // unrelated reasons) would make GitHub appear connected before the user opted
      // in — unlike the PAT-only providers, which stay disconnected until connected.
      const builtInAuth = await SecretsManager.getSecret(
        this.hostKey + "_GITHUB_BUILTIN_AUTH",
      );
      if (!builtInAuth) {
        return;
      }
      const session = await vscode.authentication.getSession(
        "github",
        ["repo"],
        { createIfNone: false },
      );
      accessToken = session?.accessToken;
    }
    if (!accessToken) {
      return;
    }
    try {
      this.gitHubClient = new Octokit({
        auth: accessToken,
        baseUrl:
          this.repoInfo.host === "github.com"
            ? undefined
            : `https://${this.repoInfo.host}/api/v3`,
      });
      // validate token by calling GET /user
      await this.gitHubClient.request("GET /user");
      await this.logApiCall("GET /user", { caller: "initialize" });
      this.isActive = true;
    } catch {
      this.gitHubClient = null;
      this.isActive = false;
      const isEnterprise =
        this.repoInfo?.host && this.repoInfo.host !== "github.com";
      showAuthFailureGuidance({
        providerName: isEnterprise ? "GitHub Enterprise" : "GitHub",
        guidance: t("githubEnterpriseAuthInfo"),
        retry: () => this.reauthenticateAndRefresh(),
        docUrl:
          "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
      });
    }
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    const [owner, repo] = [this.repoInfo!.owner, this.repoInfo!.repo];
    const { data: pullRequests } = await this.gitHubClient!.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 1000,
    });
    await this.logApiCall("pulls.list", {
      caller: "listOpenPullRequests",
      state: "open",
    });
    return await this.convertAndCollectJobsList(pullRequests, {
      withJobs: true,
    });
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
      await this.logApiCall("pulls.list", {
        caller: "getActivePullRequestFromBranch",
        head: `${owner}:${branchName}`,
        state: "open",
      });
      if (pullRequests.length === 0) {
        return null;
      }
      const converted = await this.convertAndCollectJobsList(pullRequests, {
        withJobs: true,
      });
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
      await this.logApiCall("pulls.list", {
        caller: "listPullRequestsInBranchSinceLastMerge",
        action: "findLastMerged",
        sourceBranch: currentBranchName,
        targetBranch: targetBranchName,
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
        per_page: 1000,
      };

      const { data: comparison } =
        await this.gitHubClient.repos.compareCommits(compareOptions);
      await this.logApiCall("repos.compareCommits", {
        caller: "listPullRequestsInBranchSinceLastMerge",
        base: compareOptions.base,
        head: compareOptions.head,
      });

      if (!comparison.commits || comparison.commits.length === 0) {
        return [];
      }

      const commitSHAs = new Set(comparison.commits.map((c) => c.sha));

      // Step 3-6: Get merged PRs targeting currentBranch and child branches,
      // keep those whose merge commit belongs to our commit list, dedupe, convert
      const allBranches = [currentBranchName, ...childBranchesNames];
      return await this.collectMergedPRsForCommits(allBranches, commitSHAs);
    } catch (err) {
      Logger.log(
        `Error in listPullRequestsInBranchSinceLastMerge: ${String(err)}`,
      );
      return [];
    }
  }

  async getBranchLatestCommitId(
    branchName: string,
  ): Promise<string | undefined> {
    if (!this.gitHubClient || !this.repoInfo) {
      return undefined;
    }
    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];
    try {
      const { data: branch } = await this.gitHubClient.repos.getBranch({
        owner,
        repo,
        branch: branchName,
      });
      await this.logApiCall("repos.getBranch", {
        caller: "getBranchLatestCommitId",
        branch: branchName,
      });
      return branch?.commit?.sha;
    } catch (err) {
      Logger.log(
        `Error fetching latest commit for branch ${branchName}: ${String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * Lists the go lives (merges into a top branch such as main/prod), most recent
   * first. Each merged PR into the branch is a go live; only the merge commit and
   * a few display fields are returned (no PR contents).
   */
  async fetchGoLives(branchName: string): Promise<GoLive[]> {
    if (!this.gitHubClient || !this.repoInfo) {
      return [];
    }
    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];
    try {
      const { data: closedPRs } = await this.gitHubClient.pulls.list({
        owner,
        repo,
        state: "closed",
        base: branchName,
        sort: "updated",
        direction: "desc",
        per_page: 100,
      });
      await this.logApiCall("pulls.list", {
        caller: "fetchGoLives",
        targetBranch: branchName,
      });
      return closedPRs
        .filter((pr) => pr.merged_at && pr.merge_commit_sha)
        .map((pr) => ({
          id: pr.merge_commit_sha as string,
          prNumber: pr.number,
          title: pr.title,
          mergeDate: pr.merged_at || undefined,
          webUrl: pr.html_url || "",
        }));
    } catch (err) {
      Logger.log(`Error fetching GitHub go lives: ${String(err)}`);
      return [];
    }
  }

  /**
   * Lists the Pull Requests carried by a specific go live (merge commit
   * `mergeCommitSha`) into a top branch. Commits introduced by the go live are
   * those reachable from the merge commit but not from its first parent (the
   * mainline before the go live), so other go lives are excluded.
   */
  async listPullRequestsInGoLive(
    branchName: string,
    childBranchesNames: string[],
    mergeCommitSha: string,
  ): Promise<PullRequest[]> {
    if (!this.gitHubClient || !this.repoInfo || !mergeCommitSha) {
      return [];
    }

    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];

    // Return the cached result: a given go live never changes
    const cacheKey = this.getLatestMergeCacheKey(
      branchName,
      childBranchesNames,
      mergeCommitSha,
    );
    const cached = this.latestMergePrCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Step 1: Resolve the merge commit's first parent (the mainline before the
      // go live). Without it we cannot bound the go live, so bail out rather than
      // over-reporting every merged PR.
      let firstParent: string | undefined;
      try {
        const { data: mergeCommit } = await this.gitHubClient.repos.getCommit({
          owner,
          repo,
          ref: mergeCommitSha,
        });
        await this.logApiCall("repos.getCommit", {
          caller: "listPullRequestsInGoLive",
          ref: mergeCommitSha,
        });
        firstParent = mergeCommit.parents?.[0]?.sha;
      } catch (err) {
        Logger.log(
          `Error fetching merge commit ${mergeCommitSha}: ${String(err)}`,
        );
      }
      if (!firstParent) {
        return [];
      }

      // Step 2: Commits introduced by the go live
      const { data: comparison } = await this.gitHubClient.repos.compareCommits(
        {
          owner,
          repo,
          base: firstParent,
          head: mergeCommitSha,
          per_page: 1000,
        },
      );
      await this.logApiCall("repos.compareCommits", {
        caller: "listPullRequestsInGoLive",
        base: firstParent,
        head: mergeCommitSha,
      });
      if (!comparison.commits || comparison.commits.length === 0) {
        return [];
      }
      const commitSHAs = new Set(comparison.commits.map((c) => c.sha));
      // The merge commit itself is the head of the comparison range, not part of
      // comparison.commits, so add it so the go-live promotion PR matches too.
      commitSHAs.add(mergeCommitSha);

      // Step 3-5: same matching as listPullRequestsInBranchSinceLastMerge
      const allBranches = [branchName, ...childBranchesNames];
      const result = await this.collectMergedPRsForCommits(
        allBranches,
        commitSHAs,
      );
      this.latestMergePrCache.set(cacheKey, result);
      return result;
    } catch (err) {
      Logger.log(`Error in listPullRequestsInGoLive: ${String(err)}`);
      return [];
    }
  }

  /**
   * Shared tail of the "PRs in branch" queries: fetch all merged PRs targeting
   * each branch in `allBranches`, keep those whose merge commit SHA is part of
   * `commitSHAs`, dedupe by PR number and convert to the common PullRequest shape.
   */
  private async collectMergedPRsForCommits(
    allBranches: string[],
    commitSHAs: Set<string>,
  ): Promise<PullRequest[]> {
    const [owner, repo] = [this.repoInfo!.owner, this.repoInfo!.repo];

    const prPromises = allBranches.map(async (branchName) => {
      try {
        const { data: prs } = await this.gitHubClient!.pulls.list({
          owner,
          repo,
          state: "closed",
          base: branchName,
          per_page: 1000,
        });
        await this.logApiCall("pulls.list", {
          caller: "collectMergedPRsForCommits",
          action: "fetchMergedPRs",
          targetBranch: branchName,
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

    const relevantPRs = allMergedPRs.filter((pr) => {
      return pr.merge_commit_sha && commitSHAs.has(pr.merge_commit_sha);
    });

    const uniquePRsMap = new Map();
    for (const pr of relevantPRs) {
      if (!uniquePRsMap.has(pr.number)) {
        uniquePRsMap.set(pr.number, pr);
      }
    }
    const uniquePRs = Array.from(uniquePRsMap.values());

    return await this.convertAndCollectJobsList(uniquePRs, {
      withJobs: false,
    });
  }

  // Helper to convert a raw GitHub PR and attach jobs/jobsStatus
  // Batch helper: convert an array of raw GitHub PRs and enrich each with jobs
  private async convertAndCollectJobsList(
    rawPrs: Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"],
    options: { withJobs: boolean },
  ): Promise<PullRequest[]> {
    if (!rawPrs || rawPrs.length === 0) {
      return [];
    }
    const converted: PullRequest[] = await Promise.all(
      rawPrs.map(async (r) => {
        const converted = this.convertToPullRequest(r);
        if (options.withJobs === true) {
          try {
            const jobs = await this.fetchLatestJobsForPullRequest(converted);
            converted.jobs = jobs;
            converted.jobsStatus = this.computeJobsStatus(jobs);
          } catch (e) {
            Logger.log(
              `Error fetching jobs for PR #${converted.number}: ${String(e)}`,
            );
          }
        }
        return converted;
      }),
    );
    return converted;
  }

  // Fetch latest workflow run jobs for a pull request using the source branch.
  // Primary: GitHub Actions workflow runs. Fallback: commit statuses (Jenkins, CircleCI, etc.)
  protected async fetchLatestJobsForPullRequest(
    pr: PullRequest,
  ): Promise<Job[]> {
    if (!this.gitHubClient || !this.repoInfo) {
      return [];
    }
    const [owner, repo] = [this.repoInfo.owner, this.repoInfo.repo];
    try {
      // Get the latest commit SHA from the source branch
      const commitsResp = await this.gitHubClient.repos.listCommits({
        owner,
        repo,
        sha: pr.sourceBranch,
        per_page: 1,
      });
      await this.logApiCall("repos.listCommits", {
        caller: "fetchLatestJobsForPullRequest",
        sha: pr.sourceBranch,
      });

      if (!commitsResp.data || commitsResp.data.length === 0) {
        return [];
      }
      const latestCommitSha = commitsResp.data[0].sha;

      // Primary: GitHub Actions workflow runs
      const runsResp = await this.gitHubClient.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        head_sha: latestCommitSha,
        event: "pull_request",
        per_page: 50,
      });
      await this.logApiCall("actions.listWorkflowRunsForRepo", {
        caller: "fetchLatestJobsForPullRequest",
        event: "pull_request",
      });
      const runs = runsResp.data && runsResp.data.workflow_runs;

      // If there are multiple attempts for the same run, pick the latest attempt for each name
      const latestAttempts = this.filterLatestRunByName(runs);

      // Put any job containing "simulate" at the beginning of the list
      latestAttempts.sort((a, b) => {
        const aIsSimulate = a.name?.toLowerCase().includes("simulate") ? 1 : 0;
        const bIsSimulate = b.name?.toLowerCase().includes("simulate") ? 1 : 0;
        return bIsSimulate - aIsSimulate;
      });

      if (latestAttempts.length > 0) {
        return this.mapWorkflowRunsToJobs(latestAttempts);
      }

      // Fallback: commit statuses (Jenkins, CircleCI, etc.)
      const statusesResp =
        await this.gitHubClient.repos.listCommitStatusesForRef({
          owner,
          repo,
          ref: latestCommitSha,
          per_page: 50,
        });
      await this.logApiCall("repos.listCommitStatusesForRef", {
        caller: "fetchLatestJobsForPullRequest",
        ref: latestCommitSha,
      });
      return this.mapCommitStatusesToJobs(statusesResp.data || []);
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
      // Get latest commit of the branch
      const commitsResp = await this.gitHubClient.repos.listCommits({
        owner,
        repo,
        sha: branchName,
        per_page: 1,
      });
      await this.logApiCall("repos.listCommits", {
        caller: "getJobsForBranchLatestCommit",
        sha: branchName,
      });
      if (commitsResp.data.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }
      const latestCommitSha = commitsResp.data[0].sha;
      // List workflow runs for the commit
      const runsResp = await this.gitHubClient.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        head_sha: latestCommitSha,
        exclude_pull_requests: true,
        per_page: 10,
      });
      await this.logApiCall("actions.listWorkflowRunsForRepo", {
        caller: "getJobsForBranchLatestCommit",
        exclude_pull_requests: true,
      });
      const runs =
        runsResp.data && runsResp.data.workflow_runs
          ? runsResp.data.workflow_runs
          : [];

      if (runs.length === 0) {
        // Fallback: commit statuses (Jenkins, CircleCI, etc.)
        const statusesResp =
          await this.gitHubClient.repos.listCommitStatusesForRef({
            owner,
            repo,
            ref: latestCommitSha,
            per_page: 50,
          });
        await this.logApiCall("repos.listCommitStatusesForRef", {
          caller: "getJobsForBranchLatestCommit",
          ref: latestCommitSha,
        });
        const statusJobs = this.mapCommitStatusesToJobs(
          statusesResp.data || [],
        );
        return {
          jobs: statusJobs,
          jobsStatus: this.computeJobsStatus(statusJobs),
        };
      }

      // If there are multiple attempts for the same run, pick the latest attempt for each name
      const latestAttempts = this.filterLatestRunByName(runs);

      // Put any job containing "deploy" at the beginning of the list
      latestAttempts.sort((a, b) => {
        const aIsDeploy =
          a.name?.toLowerCase().includes("deploy") &&
          !a.name?.toLowerCase().includes("simulate")
            ? 1
            : 0;
        const bIsDeploy =
          b.name?.toLowerCase().includes("deploy") &&
          !b.name?.toLowerCase().includes("simulate")
            ? 1
            : 0;
        return bIsDeploy - aIsDeploy;
      });

      // pick the most recent commit-triggered run
      const converted: Job[] = this.mapWorkflowRunsToJobs(latestAttempts);
      return { jobs: converted, jobsStatus: this.computeJobsStatus(converted) };
    } catch (e) {
      Logger.log(`Error fetching jobs for branch ${branchName}: ${String(e)}`);
      return null;
    }
  }

  private mapWorkflowRunsToJobs(latestAttempts: any[]): Job[] {
    return latestAttempts.map(
      (
        j: Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["response"]["data"]["workflow_runs"][0],
      ) => ({
        name: j.name!,
        status: this.convertJobStatusToJobStatus(
          j.status || j.conclusion || "",
        ),
        webUrl: j.html_url,
        updatedAt: j.updated_at,
        raw: j,
      }),
    );
  }

  private filterLatestRunByName(runs: any[]) {
    const latestAttemptsMap: Map<
      string,
      Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["response"]["data"]["workflow_runs"][0]
    > = new Map();
    for (const run of runs) {
      const existing = latestAttemptsMap.get(run.name!);
      if (
        !existing ||
        new Date(run.created_at) > new Date(existing.created_at)
      ) {
        latestAttemptsMap.set(run.name!, run);
      }
    }
    const latestAttempts = Array.from(latestAttemptsMap.values());
    return latestAttempts;
  }

  private convertJobStatusToJobStatus(status: string): JobStatus {
    switch (status.toLowerCase()) {
      case "success":
      case "completed":
        return "success";
      case "failure":
      case "failed":
      case "cancelled":
        return "failed";
      case "in_progress":
        return "running";
      case "queued":
      case "pending":
        return "pending";
      default:
        return "unknown";
    }
  }

  // Map GitHub commit statuses (Jenkins, CircleCI, etc.) to Job[]
  // Deduplicates by context name, keeping the latest entry per context.
  protected mapCommitStatusesToJobs(statuses: any[]): Job[] {
    const latestByContext = new Map<string, any>();
    for (const s of statuses) {
      const key = s.context || "external-ci";
      const existing = latestByContext.get(key);
      if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
        latestByContext.set(key, s);
      }
    }
    return Array.from(latestByContext.values()).map((s: any) => ({
      name: s.context || "external-ci",
      status: this.convertCommitStatusToJobStatus(s.state),
      webUrl: s.target_url || undefined,
      updatedAt: s.updated_at || undefined,
      raw: s,
    }));
  }

  protected convertCommitStatusToJobStatus(state: string): JobStatus {
    switch ((state || "").toLowerCase()) {
      case "success":
        return "success";
      case "failure":
      case "error":
        return "failed";
      case "pending":
        return "pending";
      default:
        return "unknown";
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
