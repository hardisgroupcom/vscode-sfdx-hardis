import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Octokit } from "@octokit/rest";
import type { Endpoints } from "@octokit/types";
import {
  CreateTokenOption,
  GoLive,
  ProviderDescription,
  PullRequest,
  PullRequestSearchResult,
  Job,
  JobStatus,
} from "./types";
import { Logger } from "../../logger";
import { PROVIDER_BATCH_PROFILES, mapWithConcurrency } from "../concurrency";
import { SecretsManager, SecretSource } from "../secretsManager";
import { PROVIDER_ENV_VAR_NAMES } from "../envFileCredentials";
import { t } from "../../i18n/i18n";
import {
  promptForToken,
  showAuthFailureGuidance,
} from "../providerCredentials";
import { mapGitHubMergeable } from "./mergeStatus";

type WorkflowRun =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["response"]["data"]["workflow_runs"][0];

export class GitProviderGitHub extends GitProvider {
  // A Pull Request updated before the oldest commit of a window cannot belong to it. Widened by a
  // margin: branches live long and clocks drift.
  private static readonly PR_WINDOW_MARGIN_DAYS = 7;
  // GitHub never returns more than 100 per page whatever is asked for
  private static readonly PR_PAGE_SIZE = 100;
  // Stop rather than walk a huge closed history when no time bound applies
  private static readonly PR_MAX_PAGES = 10;

  private oldestCommitDateWithMargin(commits: any[]): Date | undefined {
    const times = (commits || [])
      .map((commit) =>
        new Date(
          commit?.commit?.committer?.date || commit?.commit?.author?.date || "",
        ).getTime(),
      )
      .filter((time) => !isNaN(time));
    if (times.length === 0) {
      return undefined;
    }
    return new Date(
      Math.min(...times) -
        GitProviderGitHub.PR_WINDOW_MARGIN_DAYS * 24 * 60 * 60 * 1000,
    );
  }

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
    const resolvedToken = await SecretsManager.resolveSecret(
      this.hostKey + "_TOKEN",
      PROVIDER_ENV_VAR_NAMES.githubToken,
    );
    let accessToken = resolvedToken?.value;
    const credentialSource: SecretSource | undefined = resolvedToken?.source;
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
      await showAuthFailureGuidance({
        providerName: isEnterprise ? "GitHub Enterprise" : "GitHub",
        guidance: t("githubEnterpriseAuthInfo"),
        retry: () => this.reauthenticateAndRefresh(),
        docUrl:
          "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
        onlyIfPipelineConfigured: true,
        credentialSource,
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
    const converted = await this.convertAndCollectJobsList(pullRequests, {
      withJobs: true,
    });
    await this.completeWithMergeStatus(converted);
    return converted;
  }

  /**
   * Fill mergeStatus on open Pull Requests. GitHub keeps mergeable out of the REST list (it is
   * computed in the background, per Pull Request), but GraphQL returns it for the whole list at
   * once: one request for the page, whatever the number of Pull Requests. Pull Requests GitHub
   * has not finished testing come back UNKNOWN and simply show nothing until the next refresh.
   *
   * Only for GitHub itself: Gitea reuses this class over a REST-only API, and already carries
   * mergeable in its list payload.
   */
  protected async completeWithMergeStatus(
    pullRequests: PullRequest[],
  ): Promise<void> {
    if (
      !this.gitHubClient ||
      !this.repoInfo ||
      this.repoInfo.providerName !== "github" ||
      pullRequests.length === 0
    ) {
      return;
    }
    try {
      const response: any = await this.gitHubClient.graphql(
        `query mergeStatus($owner: String!, $repo: String!, $count: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequests(states: OPEN, first: $count, orderBy: { field: CREATED_AT, direction: DESC }) {
              nodes { number mergeable }
            }
          }
        }`,
        {
          owner: this.repoInfo.owner,
          repo: this.repoInfo.repo,
          count: Math.min(Math.max(pullRequests.length, 1), 100),
        },
      );
      await this.logApiCall("graphql pullRequests.mergeable", {
        caller: "completeWithMergeStatus",
        count: pullRequests.length,
      });
      const nodes = response?.repository?.pullRequests?.nodes || [];
      const mergeableByNumber = new Map<number, any>(
        nodes.map((node: any) => [node?.number, node?.mergeable]),
      );
      for (const pullRequest of pullRequests) {
        if (!mergeableByNumber.has(Number(pullRequest.number))) {
          continue;
        }
        pullRequest.mergeStatus = mapGitHubMergeable(
          mergeableByNumber.get(Number(pullRequest.number)),
        );
      }
    } catch (e) {
      // Merge conflict display is a bonus on the diagram: a token without GraphQL access, or a
      // GitHub Enterprise without the endpoint, must not cost the pipeline its Pull Requests
      Logger.log(
        `Unable to read merge conflict status from GitHub: ${String(e)}`,
      );
    }
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

  async getPullRequestByNumber(
    number: number,
    options?: { withJobs?: boolean },
  ): Promise<PullRequest | null> {
    if (!this.gitHubClient || !this.repoInfo) {
      return null;
    }
    try {
      const { data: pullRequest } = await this.gitHubClient.pulls.get({
        owner: this.repoInfo.owner,
        repo: this.repoInfo.repo,
        pull_number: number,
      });
      await this.logApiCall("pulls.get", {
        caller: "getPullRequestByNumber",
        number,
      });
      const converted = await this.convertAndCollectJobsList(
        [pullRequest as any],
        { withJobs: options?.withJobs === true },
      );
      return converted[0] || null;
    } catch (err) {
      Logger.log(`Error fetching PR #${number}: ${String(err)}`);
      return null;
    }
  }

  /**
   * One GraphQL search for the whole lookup: the REST search returns issues, without the
   * branches, and would need one more call per result.
   *
   * GitHub matches whole words of the title and the body, not parts of them, and does not search
   * branch names. Closed Pull Requests that were not merged cannot be excluded in the query (there
   * is no "open or merged" qualifier), so they are asked for and dropped here.
   *
   * Only for GitHub itself: Gitea reuses this class over a REST-only API and has its own search.
   */
  async searchPullRequests(
    query: string,
    options?: { limit?: number },
  ): Promise<PullRequestSearchResult | null> {
    if (
      !this.gitHubClient ||
      !this.repoInfo ||
      this.repoInfo.providerName !== "github"
    ) {
      return null;
    }
    const limit = this.searchLimit(options);
    const searchQuery = this.buildSearchQuery(query);
    if (!searchQuery) {
      return { pullRequests: [], truncated: false };
    }
    try {
      const response: any = await this.gitHubClient.graphql(
        `query searchPullRequests($q: String!, $count: Int!) {
          search(type: ISSUE, query: $q, first: $count) {
            nodes {
              ... on PullRequest {
                number title state merged mergedAt createdAt updatedAt url body
                headRefName baseRefName
                author { login }
              }
            }
          }
        }`,
        {
          q: searchQuery,
          // Twice the limit, because the closed ones are only dropped once they are received
          count: Math.min(limit * 2, GitProviderGitHub.PR_PAGE_SIZE),
        },
      );
      await this.logApiCall("graphql search", {
        caller: "searchPullRequests",
        limit,
      });
      const nodes: any[] = response?.search?.nodes || [];
      const pullRequests = nodes
        // An empty node is a result that is not a Pull Request
        .filter((node) => node?.number && node?.headRefName)
        .filter((node) => node.state === "OPEN" || node.merged === true)
        .map((node) => this.convertToPullRequest(this.searchNodeToRest(node)));
      return this.buildSearchResult(pullRequests, limit);
    } catch (err) {
      Logger.log(`Error searching GitHub Pull Requests: ${String(err)}`);
      return { pullRequests: [], truncated: false };
    }
  }

  /**
   * The GitHub search string of a text typed by the user, or an empty string when there is
   * nothing to search. Each word goes between double quotes, so that a word shaped like a
   * qualifier ("repo:other/repository", "is:closed") is searched as text and cannot widen the
   * search to another repository.
   */
  private buildSearchQuery(query: string): string {
    const words = String(query || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => `"${word.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    if (words.length === 0) {
      return "";
    }
    return `repo:${this.repoInfo!.owner}/${this.repoInfo!.repo} is:pr ${words.join(" ")} in:title,body`;
  }

  // A Pull Request node of the GraphQL search, in the shape the REST API gives it
  private searchNodeToRest(node: any): any {
    return {
      // The search does not return the REST id, the number is unique in the repository
      id: node.number,
      number: node.number,
      title: node.title,
      body: node.body,
      state: node.state === "OPEN" ? "open" : "closed",
      merged_at: node.merged === true ? node.mergedAt : null,
      created_at: node.createdAt,
      updated_at: node.updatedAt,
      html_url: node.url,
      user: { login: node.author?.login },
      head: { ref: node.headRefName },
      base: { ref: node.baseRefName },
    };
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
      return await this.collectMergedPRsForCommits(
        allBranches,
        commitSHAs,
        this.oldestCommitDateWithMargin(comparison.commits),
      );
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
    const cached = this.getCachedLatestMergePrs(cacheKey);
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
        this.oldestCommitDateWithMargin(comparison.commits),
      );
      this.setCachedLatestMergePrs(cacheKey, result);
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
    // Oldest commit of the window: Pull Requests updated before that cannot belong to it
    updatedAfter?: Date,
  ): Promise<PullRequest[]> {
    const prResults = await mapWithConcurrency(
      allBranches,
      async (branchName) =>
        await this.fetchMergedPullRequestsRaw(
          branchName,
          updatedAfter,
          "collectMergedPRsForCommits",
        ),
      PROVIDER_BATCH_PROFILES.github,
    );
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

  async listMergedPullRequestsIntoBranch(
    targetBranchName: string,
    updatedAfter?: Date,
  ): Promise<PullRequest[]> {
    if (!this.gitHubClient || !this.repoInfo) {
      return [];
    }
    const merged = await this.fetchMergedPullRequestsRaw(
      targetBranchName,
      updatedAfter,
      "listMergedPullRequestsIntoBranch",
    );
    return await this.convertAndCollectJobsList(merged, { withJobs: false });
  }

  /**
   * The merged Pull Requests targeting one branch, newest update first, down to `updatedAfter`.
   * Never throws: a branch that cannot be read is an empty list and a log line.
   */
  private async fetchMergedPullRequestsRaw(
    branchName: string,
    updatedAfter: Date | undefined,
    caller: string,
  ): Promise<any[]> {
    const [owner, repo] = [this.repoInfo!.owner, this.repoInfo!.repo];
    try {
      // GitHub caps a page at 100 whatever is asked for, so the previous per_page: 1000 was
      // not "everything in one call", it was "the first 100 by creation date and never mind
      // the rest". Sorted by update date instead, the walk can stop at the first page that
      // predates the window: correct where the old single call silently truncated, and far
      // cheaper than reading the whole closed history.
      const merged: any[] = [];
      for (let page = 1; page <= GitProviderGitHub.PR_MAX_PAGES; page++) {
        const { data: prs } = await this.gitHubClient!.pulls.list({
          owner,
          repo,
          state: "closed",
          base: branchName,
          per_page: GitProviderGitHub.PR_PAGE_SIZE,
          sort: "updated",
          direction: "desc",
          page,
        });
        await this.logApiCall("pulls.list", {
          caller,
          action: "fetchMergedPRs",
          targetBranch: branchName,
          page,
          received: prs.length,
        });
        let reachedBound = false;
        for (const pr of prs) {
          const updated = new Date(
            pr.updated_at || pr.merged_at || 0,
          ).getTime();
          if (updatedAfter && updated < updatedAfter.getTime()) {
            // Sorted newest first, so everything after this point is older still
            reachedBound = true;
            break;
          }
          if (pr.merged_at) {
            merged.push(pr);
          }
        }
        if (reachedBound || prs.length < GitProviderGitHub.PR_PAGE_SIZE) {
          break;
        }
      }
      return merged;
    } catch (err) {
      Logger.log(
        `Error fetching merged PRs for branch ${branchName}: ${String(err)}`,
      );
      return [];
    }
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
    // Bounded: Promise.all over every Pull Request fires one status call each at once, and GitHub
    // answers a burst like that with secondary rate limits that cost more than the queue saves
    const converted: PullRequest[] = await mapWithConcurrency(
      rawPrs,
      async (r) => {
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
      },
      PROVIDER_BATCH_PROFILES.github,
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
      const runs = runsResp.data?.workflow_runs || [];

      // If there are multiple attempts for the same run, pick the latest attempt for each name.
      // Every check of the Pull Request counts, as on its GitHub page, apart from skipped ones
      const latestAttempts = this.leaveOutSkippedRuns(
        this.filterLatestRunByName(runs),
      );

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
        // Only empties the pull_requests array of each run, to keep the answer small: the runs a
        // Pull Request started are still listed, and pickDeploymentRuns leaves them out
        exclude_pull_requests: true,
        // Newest first, and the checks of a Pull Request opened after the push are newer than the
        // deployment run: a short page could leave it out
        per_page: 50,
      });
      await this.logApiCall("actions.listWorkflowRunsForRepo", {
        caller: "getJobsForBranchLatestCommit",
        exclude_pull_requests: true,
      });
      const deploymentRuns = this.pickDeploymentRuns(
        runsResp.data?.workflow_runs || [],
        branchName,
      );

      if (deploymentRuns.length === 0) {
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

      const converted: Job[] = this.mapWorkflowRunsToJobs(deploymentRuns);
      return { jobs: converted, jobsStatus: this.computeJobsStatus(converted) };
    } catch (e) {
      Logger.log(`Error fetching jobs for branch ${branchName}: ${String(e)}`);
      return null;
    }
  }

  /**
   * The runs whose result the deployment arrow of a major branch shows, out of every run GitHub
   * lists for the latest commit of the branch.
   *
   * That list also holds runs that are not the deployment of the branch: the checks of a Pull
   * Request open from it toward the next branch (they run on the same commit), MegaLinter, and the
   * runs of another branch whose latest commit is the same. Counting them drew a deployment that
   * worked red as soon as one of them failed. So only the runs the branch started itself are kept,
   * the latest of each workflow, and among them the deployment workflows: a name with "deploy" but
   * not "simulate", like Process Deployment (sfdx-hardis). When no workflow is named that way, all
   * of them are kept, as GitLab, Azure and Bitbucket show the whole pipeline of the branch.
   */
  private pickDeploymentRuns(
    runs: WorkflowRun[],
    branchName: string,
  ): WorkflowRun[] {
    const branchRuns = runs.filter(
      (run) =>
        !(run.event || "").startsWith("pull_request") &&
        // A missing value is kept: Gitea serves the same API and may leave it out
        (!run.head_branch || run.head_branch === branchName),
    );
    const latestRuns = this.filterLatestRunByName(branchRuns);
    const deploymentRuns = latestRuns.filter((run) => {
      const name = (run.name || "").toLowerCase();
      return name.includes("deploy") && !name.includes("simulate");
    });
    // Once the deployment runs are chosen, so that a skipped deployment never hands the arrow to
    // another workflow
    return this.leaveOutSkippedRuns(
      deploymentRuns.length > 0 ? deploymentRuns : latestRuns,
    );
  }

  /**
   * A skipped or neutral run says nothing about the commit, and GitHub does not count it as a
   * failure on the Pull Request page either. It is left out, unless nothing else ran: then the chip
   * says unknown rather than green.
   */
  private leaveOutSkippedRuns(runs: WorkflowRun[]): WorkflowRun[] {
    const counted = runs.filter(
      (run) =>
        !["skipped", "neutral"].includes((run.conclusion || "").toLowerCase()),
    );
    return counted.length > 0 ? counted : runs;
  }

  private mapWorkflowRunsToJobs(runs: WorkflowRun[]): Job[] {
    return runs.map((run) => ({
      name: run.name!,
      status: this.convertWorkflowRunToJobStatus(run),
      webUrl: run.html_url,
      updatedAt: run.updated_at,
      startedAt: run.run_started_at || run.created_at,
      raw: run,
    }));
  }

  /**
   * GitHub fills `status` on every run, and "completed" only says that the run is over: whether it
   * passed is in `conclusion`. Reading `status || conclusion` drew every finished run green, the
   * failed and cancelled ones included (vscode-sfdx-hardis#529).
   */
  private convertWorkflowRunToJobStatus(run: WorkflowRun): JobStatus {
    switch ((run.status || "").toLowerCase()) {
      case "in_progress":
        return "running";
      case "queued":
      case "pending":
      case "waiting":
      case "requested":
      case "action_required":
        return "pending";
      default:
        // "completed", or no status at all: how the run ended is in its conclusion
        return this.convertWorkflowConclusionToJobStatus(run.conclusion);
    }
  }

  private convertWorkflowConclusionToJobStatus(
    conclusion: string | null | undefined,
  ): JobStatus {
    switch ((conclusion || "").toLowerCase()) {
      case "success":
        return "success";
      case "failure":
      case "cancelled":
      case "timed_out":
      case "startup_failure":
        return "failed";
      case "action_required":
        // Waits for someone to approve the run
        return "pending";
      default:
        // neutral, skipped, stale, or not finished yet: neither green nor red
        return "unknown";
    }
  }

  private filterLatestRunByName(runs: WorkflowRun[]): WorkflowRun[] {
    const latestAttemptsMap: Map<string, WorkflowRun> = new Map();
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
      // GitHub only returns "open" and "closed": a merged Pull Request is a closed one with a
      // merge date, and every consumer of the aggregated shape expects "merged"
      state: (pr.merged_at ? "merged" : pr.state) as PullRequest["state"],
      authorLabel: pr.user?.login || pr.user?.name || "unknown",
      webUrl: pr.html_url,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      mergeDate: pr.merged_at || undefined,
      createdAt: pr.created_at || undefined,
      updatedAt: pr.updated_at || undefined,
      jobsStatus: "unknown",
      // Gitea sends mergeable in its Pull Request list, GitHub does not: on GitHub this stays
      // undefined and completeWithMergeStatus fills it for the open ones in a single query
      mergeStatus:
        pr.merged_at || pr.mergeable === undefined || pr.mergeable === null
          ? undefined
          : mapGitHubMergeable(pr.mergeable),
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
