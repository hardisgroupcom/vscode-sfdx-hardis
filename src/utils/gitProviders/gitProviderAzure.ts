import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import {
  CreateTokenOption,
  GoLive,
  ProviderDescription,
  PullRequest,
  Job,
  JobStatus,
} from "./types";
import { mapAzureMergeStatus } from "./mergeStatus";
import * as azdev from "azure-devops-node-api";
import { GitApi } from "azure-devops-node-api/GitApi";
import {
  PullRequestStatus,
  GitPullRequest,
  GitStatusState,
} from "azure-devops-node-api/interfaces/GitInterfaces";
import { Logger } from "../../logger";
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from "../concurrency";
import {
  getCachedPullRequestDescription,
  repositoryKeyFromRemoteUrl,
  setCachedPullRequestDescription,
} from "../pullRequestDescriptionCache";
import { SecretsManager } from "../secretsManager";
import { BuildApi } from "azure-devops-node-api/BuildApi";
import { t } from "../../i18n/i18n";
import {
  promptForToken,
  showAuthFailureGuidance,
} from "../providerCredentials";

/**
 * Azure DevOps Git Provider
 *
 * Authentication:
 * - OAuth (Microsoft Account): Works for users in the same tenant
 * - Personal Access Token (PAT): Required for guest users or cross-tenant access
 *
 * Guest User Issue:
 * When a user from a different Azure AD tenant (e.g., user@external.com accessing an org
 * in different-tenant.com), OAuth tokens may fail with "TF400813: User is not authorized"
 * even though authentication succeeds. This is because the OAuth token doesn't grant
 * proper permissions for guest users.
 *
 * Solution:
 * The initialize() method will:
 * 1. First check for a stored PAT in VS Code secrets
 * 2. If found, use PAT authentication
 * 3. Otherwise, fall back to OAuth
 *
 * The authenticate() method offers users the choice between OAuth and PAT.
 */
export class GitProviderAzure extends GitProvider {
  private static readonly AZURE_DEVOPS_SCOPE =
    "499b84ac-1321-427f-aa17-267ca6975798/.default";

  connection: azdev.WebApi | null = null;
  gitApi: GitApi | null = null;
  buildApi: BuildApi | null = null;

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "Azure DevOps",
      pullRequestLabel: t("pullRequestLabel"),
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pullrequests`
        : "",
    };
  }

  handlesNativeGitAuth(): boolean {
    return true;
  }

  async disconnect(): Promise<void> {
    // Azure DevOps can use either OAuth (VS Code authentication) or PAT
    // Delete PAT if stored
    try {
      await SecretsManager.deleteSecret(this.hostKey + "_TOKEN");
    } catch {
      // Ignore if secret doesn't exist
    }

    // OAuth sessions are managed by VS Code and cannot be removed programmatically,
    // so remember the explicit disconnect to prevent initialize() from silently
    // re-connecting from the still-present session.
    await SecretsManager.setSecret(this.hostKey + "_DISCONNECTED", "true");
    this.connection = null;
    this.gitApi = null;
    this.buildApi = null;
    this.isActive = false;
    Logger.log(
      `Disconnected from Azure DevOps (${this.repoInfo?.host || "unknown host"})`,
    );
    await super.disconnect();
  }

  getCreateTokenOptions(): CreateTokenOption[] {
    const orgUrl = this.buildOrganizationUrl();
    const url = orgUrl
      ? `${orgUrl}/_usersSettings/tokens`
      : "https://dev.azure.com/_usersSettings/tokens";
    return [
      {
        id: "pat",
        label: t("createAzurePat"),
        url,
        scopesHint:
          "Code (Read & Write), Build (Read & Execute), Work Items (Read & Write)",
      },
    ];
  }

  async authenticate(): Promise<boolean | null> {
    const oauthLabel = t("azureDevOpsAuthOAuth");
    const patLabel = t("azureDevOpsAuthPAT");
    const choice = await vscode.window.showInformationMessage(
      t("azureDevOpsAuthMethod"),
      { modal: true },
      oauthLabel,
      patLabel,
    );

    if (!choice) {
      return null;
    }

    if (choice === patLabel) {
      return await this.authenticateWithPAT();
    }

    return await this.authenticateWithOAuth();
  }

  private async authenticateWithPAT(): Promise<boolean | null> {
    const token = await promptForToken({
      providerLabel: "Azure DevOps",
      inputPrompt: t("azureDevOpsEnterPAT"),
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

  private async authenticateWithOAuth(): Promise<boolean> {
    const session = await vscode.authentication.getSession(
      "microsoft",
      [GitProviderAzure.AZURE_DEVOPS_SCOPE],
      { forceNewSession: true },
    );

    if (!session?.accessToken) {
      return false;
    }

    await SecretsManager.deleteSecret(this.hostKey + "_DISCONNECTED").catch(
      () => {},
    );
    await this.initialize();
    return this.isActive;
  }

  async initialize() {
    const pat = await SecretsManager.getSecret(this.hostKey + "_TOKEN");
    let authHandler: any;
    if (pat) {
      authHandler = azdev.getPersonalAccessTokenHandler(pat);
    } else {
      // The native VS Code (OAuth) session cannot be removed programmatically, so
      // honor an explicit disconnect to avoid silently re-connecting from it.
      const disconnected = await SecretsManager.getSecret(
        this.hostKey + "_DISCONNECTED",
      );
      if (disconnected) {
        return;
      }
      authHandler = await this.getOAuthHandler();
    }

    if (!authHandler || !this.repoInfo) {
      return;
    }

    const orgUrl = this.buildOrganizationUrl();
    if (!orgUrl) {
      return;
    }

    this.connection = new azdev.WebApi(orgUrl, authHandler);

    try {
      this.gitApi = await this.connection.getGitApi();
      await this.logApiCall("connection.getGitApi", { caller: "initialize" });

      // Validate token by requesting repository info
      await this.gitApi.getRepository(this.repoInfo.repo, this.repoInfo.owner);
      await this.logApiCall("gitApi.getRepository", { caller: "initialize" });

      this.buildApi = await this.connection.getBuildApi();
      await this.logApiCall("connection.getBuildApi", { caller: "initialize" });

      this.isActive = true;
    } catch (e: any) {
      Logger.log(
        `Azure DevOps authentication failed: ${e?.message || String(e)}`,
      );
      this.gitApi = null;
      this.isActive = false;
      await showAuthFailureGuidance({
        providerName: "Azure DevOps",
        guidance: t("azureDevOpsAuthInfo"),
        retry: () => this.reauthenticateAndRefresh(),
        docUrl:
          "https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate",
        onlyIfPipelineConfigured: true,
      });
    }
  }

  private async getOAuthHandler(): Promise<any | null> {
    const session = await vscode.authentication.getSession(
      "microsoft",
      [GitProviderAzure.AZURE_DEVOPS_SCOPE],
      { createIfNone: false },
    );

    return session?.accessToken
      ? azdev.getBearerHandler(session.accessToken)
      : null;
  }

  private buildOrganizationUrl(): string | null {
    if (!this.repoInfo?.webUrl) {
      return null;
    }

    // Extract organization from webUrl (format: https://host/org/project/_git/repo)
    const match = this.repoInfo.webUrl.match(/^https?:\/\/([^/]+)\/([^/]+)/);
    if (!match) {
      return null;
    }

    const [, host, organization] = match;
    return `https://${host}/${organization}`;
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    if (!this.repoInfo || !this.gitApi) {
      return [];
    }
    try {
      const prs = await this.listPullRequestsPaged(
        { status: PullRequestStatus.Active },
        "listOpenPullRequests",
      );
      return await this.convertAndCollectJobsList(
        await this.completeTruncatedDescriptions(prs || []),
        "",
        {
          withJobs: true,
        },
      );
    } catch {
      return [];
    }
  }

  async getPullRequestByNumber(number: number): Promise<PullRequest | null> {
    if (!this.repoInfo || !this.gitApi) {
      return null;
    }
    try {
      const pullRequest = await this.gitApi.getPullRequestById(
        number,
        this.repoInfo.owner,
      );
      await this.logApiCall("getPullRequestById", {
        caller: "getPullRequestByNumber",
        number,
      });
      if (!pullRequest) {
        return null;
      }
      const branchName = (pullRequest.targetRefName || "").replace(
        "refs/heads/",
        "",
      );
      const converted = await this.convertAndCollectJobsList(
        [pullRequest],
        branchName,
        { withJobs: false },
      );
      return converted[0] || null;
    } catch (err) {
      Logger.log(`Error fetching PR ${number}: ${String(err)}`);
      return null;
    }
  }

  async getActivePullRequestFromBranch(
    branchName: string,
  ): Promise<PullRequest | null> {
    if (!this.repoInfo || !this.gitApi) {
      return null;
    }
    try {
      const prs = await this.gitApi.getPullRequests(
        this.repoInfo.repo,
        {
          sourceRefName: `refs/heads/${branchName}`,
          status: PullRequestStatus.Active,
        },
        this.repoInfo.owner,
        undefined,
        undefined,
        1, // top: only need the first one
      );
      await this.logApiCall("gitApi.getPullRequests", {
        caller: "getActivePullRequestFromBranch",
        sourceRefName: `refs/heads/${branchName}`,
        status: "Active",
      });
      if (!prs || prs.length === 0) {
        return null;
      }
      const converted = await this.convertAndCollectJobsList(
        prs.slice(0, 1),
        branchName,
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
    if (!this.repoInfo || !this.gitApi) {
      return [];
    }

    try {
      // Step 1: Find the last completed PR from currentBranch to targetBranch
      const lastMergedPRs = await this.gitApi.getPullRequests(
        this.repoInfo.repo,
        {
          sourceRefName: `refs/heads/${currentBranchName}`,
          targetRefName: `refs/heads/${targetBranchName}`,
          status: PullRequestStatus.Completed,
        },
        this.repoInfo.owner,
        undefined,
        undefined,
        1, // top: only need the latest one
      );
      await this.logApiCall("gitApi.getPullRequests", {
        caller: "listPullRequestsInBranchSinceLastMerge",
        action: "findLastMerged",
        sourceRefName: `refs/heads/${currentBranchName}`,
        targetRefName: `refs/heads/${targetBranchName}`,
        status: "Completed",
      });

      const lastMergedPrToTarget =
        lastMergedPRs && lastMergedPRs.length > 0 ? lastMergedPRs[0] : null;

      // Step 2: Get commits since last merge
      const commitsCriteria: any = {
        compareVersion: {
          version: currentBranchName,
          versionType: 0, // GitVersionType.Branch
        },
      };

      // If there was a previous merge, use the merge commit (from target branch) as the base comparison point
      if (lastMergedPrToTarget?.lastMergeSourceCommit?.commitId) {
        commitsCriteria.itemVersion = {
          version: lastMergedPrToTarget?.lastMergeSourceCommit?.commitId,
          versionType: 2, // GitVersionType.Commit
        };
      } else {
        // No previous merge, compare against target branch to get all commits
        // Just list all commits in currentBranch
        commitsCriteria.itemVersion = {
          version: targetBranchName,
          versionType: 0, // GitVersionType.Branch
        };
      }

      const commits = await this.gitApi.getCommitsBatch(
        commitsCriteria,
        this.repoInfo.repo,
        this.repoInfo.owner,
      );
      await this.logApiCall("gitApi.getCommitsBatch", {
        caller: "listPullRequestsInBranchSinceLastMerge",
        ...commitsCriteria,
      });

      if (!commits || commits.length === 0) {
        return [];
      }

      // Create a Set of commit IDs for fast lookup
      const commitIds = new Set(
        commits.map((c) => c.commitId).filter((id): id is string => !!id),
      );

      // Step 3-6: Get completed PRs targeting currentBranch and child branches,
      // keep those whose merge commit belongs to our commit list, dedupe, convert
      const allBranches = [currentBranchName, ...childBranchesNames];
      return await this.collectMergedPRsForCommits(
        allBranches,
        commitIds,
        currentBranchName,
        this.oldestCommitDateWithMargin(commits),
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
    if (!this.repoInfo || !this.gitApi) {
      return undefined;
    }
    try {
      const branch = await this.gitApi.getBranch(
        this.repoInfo.repo,
        branchName,
        this.repoInfo.owner,
      );
      await this.logApiCall("gitApi.getBranch", {
        caller: "getBranchLatestCommitId",
        branch: branchName,
      });
      return branch?.commit?.commitId;
    } catch (err) {
      Logger.log(
        `Error fetching latest commit for branch ${branchName}: ${String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * Lists the go lives (completed PRs into a top branch such as main/prod), most
   * recent first. Each completed PR into the branch is a go live; only the merge
   * commit and a few display fields are returned (no PR contents).
   */
  async fetchGoLives(branchName: string): Promise<GoLive[]> {
    if (!this.repoInfo || !this.gitApi) {
      return [];
    }
    try {
      const prs = await this.gitApi.getPullRequests(
        this.repoInfo.repo,
        {
          targetRefName: `refs/heads/${branchName}`,
          status: PullRequestStatus.Completed,
        },
        this.repoInfo.owner,
        undefined,
        undefined,
        100, // top: a page of recent promotions is plenty for the selector
      );
      await this.logApiCall("gitApi.getPullRequests", {
        caller: "fetchGoLives",
        targetRefName: `refs/heads/${branchName}`,
        status: "Completed",
      });
      return (prs || [])
        .filter((pr: any) => pr?.lastMergeCommit?.commitId)
        .map((pr: any) => ({
          id: pr.lastMergeCommit.commitId,
          prNumber: pr.pullRequestId,
          title: pr.title,
          mergeDate: pr.closedDate
            ? new Date(pr.closedDate).toISOString()
            : undefined,
          webUrl: this.buildPullRequestWebUrl(pr),
        }));
    } catch (err) {
      Logger.log(`Error fetching Azure go lives: ${String(err)}`);
      return [];
    }
  }

  /**
   * Lists the Pull Requests carried by a specific go live (merge commit
   * `mergeCommitId`) into a top branch. Commits introduced by the go live are
   * those reachable from the merge commit but not from its first parent (the
   * mainline before the go live), so other go lives are excluded.
   */
  async listPullRequestsInGoLive(
    branchName: string,
    childBranchesNames: string[],
    mergeCommitId: string,
  ): Promise<PullRequest[]> {
    if (!this.repoInfo || !this.gitApi || !mergeCommitId) {
      return [];
    }

    // Return the cached result: a given go live never changes
    const cacheKey = this.getLatestMergeCacheKey(
      branchName,
      childBranchesNames,
      mergeCommitId,
    );
    const cached = this.getCachedLatestMergePrs(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Step 1: Resolve the merge commit's first parent (the mainline before the
      // go live). Without it we cannot bound the go live, so bail out rather than
      // over-reporting every completed PR.
      let firstParent: string | undefined;
      try {
        const mergeCommit = await this.gitApi.getCommit(
          mergeCommitId,
          this.repoInfo.repo,
          this.repoInfo.owner,
        );
        await this.logApiCall("gitApi.getCommit", {
          caller: "listPullRequestsInGoLive",
          commitId: mergeCommitId,
        });
        firstParent = mergeCommit?.parents?.[0];
      } catch (err) {
        Logger.log(
          `Error fetching merge commit ${mergeCommitId}: ${String(err)}`,
        );
      }
      if (!firstParent) {
        return [];
      }

      // Step 2: Commits introduced by the go live (firstParent..mergeCommit)
      const commits = await this.gitApi.getCommitsBatch(
        {
          compareVersion: {
            version: mergeCommitId,
            versionType: 2, // GitVersionType.Commit
          },
          itemVersion: {
            version: firstParent,
            versionType: 2, // GitVersionType.Commit
          },
        } as any,
        this.repoInfo.repo,
        this.repoInfo.owner,
      );
      await this.logApiCall("gitApi.getCommitsBatch", {
        caller: "listPullRequestsInGoLive",
        compareVersion: mergeCommitId,
        itemVersion: firstParent,
      });
      if (!commits || commits.length === 0) {
        return [];
      }
      const commitIds = new Set(
        commits.map((c) => c.commitId).filter((id): id is string => !!id),
      );
      // The merge commit itself may not be part of the batch, so add it so the
      // go-live promotion PR matches too.
      commitIds.add(mergeCommitId);

      // Step 3-5: same matching as listPullRequestsInBranchSinceLastMerge
      const allBranches = [branchName, ...childBranchesNames];
      const result = await this.collectMergedPRsForCommits(
        allBranches,
        commitIds,
        branchName,
        this.oldestCommitDateWithMargin(commits),
      );
      this.setCachedLatestMergePrs(cacheKey, result);
      return result;
    } catch (err) {
      Logger.log(`Error in listPullRequestsInGoLive: ${String(err)}`);
      return [];
    }
  }

  /**
   * Shared tail of the "PRs in branch" queries: fetch all completed PRs targeting
   * each branch in `allBranches`, keep those whose merge (or source) commit id is
   * part of `commitIds`, dedupe by PR id and convert to the common PullRequest
   * shape.
   */
  private async collectMergedPRsForCommits(
    allBranches: string[],
    commitIds: Set<string>,
    convertBranchName: string,
    // Oldest commit of the window: the listing is bounded to the Pull Requests closed since then
    // rather than crawling the whole completed history of the branch
    closedSince?: Date,
  ): Promise<PullRequest[]> {
    const prResults = await mapWithConcurrency(
      allBranches,
      async (branchName) => {
        try {
          return await this.listPullRequestsPaged(
            {
              targetRefName: `refs/heads/${branchName}`,
              status: PullRequestStatus.Completed,
              ...(closedSince
                ? {
                    minTime: closedSince,
                    // 2 = Closed: a Pull Request that brought a commit of this window into the
                    // branch cannot have closed before that commit existed
                    queryTimeRangeType: 2,
                  }
                : {}),
            },
            "collectMergedPRsForCommits",
          );
        } catch (err) {
          Logger.log(
            `Error fetching completed PRs for branch ${branchName}: ${String(err)}`,
          );
          return [];
        }
      },
      DEFAULT_CONCURRENCY,
    );
    const allMergedPRs: any[] = prResults.flat();

    const relevantPRs = allMergedPRs.filter((pr) => {
      const mergeCommitId = pr.lastMergeCommit?.commitId;
      if (mergeCommitId && commitIds.has(mergeCommitId)) {
        return true;
      }
      // Also check the source commit (last commit from the PR branch before merge)
      const sourceCommitId = pr.lastMergeSourceCommit?.commitId;
      if (sourceCommitId && commitIds.has(sourceCommitId)) {
        return true;
      }
      return false;
    });

    const uniquePRsMap = new Map();
    for (const pr of relevantPRs) {
      if (!uniquePRsMap.has(pr.pullRequestId)) {
        uniquePRsMap.set(pr.pullRequestId, pr);
      }
    }
    const uniquePRs = await this.completeTruncatedDescriptions(
      Array.from(uniquePRsMap.values()),
    );

    return await this.convertAndCollectJobsList(uniquePRs, convertBranchName, {
      withJobs: false,
    });
  }

  /**
   * Azure DevOps truncates the description of a Pull Request returned by the LIST API at 400
   * characters, with no marker saying so. The DevOps Pipeline reads the `promotionPullRequests`
   * declaration of a promotion branch out of that description, and it sits below the navigation
   * block and the introduction, so on a promotion carrying more than a story or two it is cut off
   * entirely: the promotion expands into nothing, its stories are never marked as already
   * promoted, and the branch counters are wrong.
   *
   * The single Pull Request API returns the whole description, so it is read again for every
   * listed Pull Request whose description is long enough to have been cut. Mirrors
   * AzureDevopsProvider.completeTruncatedDescription in sfdx-hardis.
   */
  private static readonly LIST_DESCRIPTION_TRUNCATION_LENGTH = 400;

  private async completeTruncatedDescriptions(
    rawPrs: GitPullRequest[],
  ): Promise<GitPullRequest[]> {
    if (!this.gitApi || !this.repoInfo) {
      return rawPrs;
    }
    // One API call per Pull Request whose description was cut adds up fast on a repository with a
    // long history, and the description of a merged or abandoned Pull Request no longer moves. The
    // cache is shared with the sfdx-hardis CLI, and keyed on the state seen right now, so a
    // reopened Pull Request is read again.
    const repositoryKey = this.pullRequestCacheRepositoryKey();
    return await Promise.all(
      rawPrs.map(async (rawPr) => {
        const listed = rawPr.description || "";
        if (
          listed.length < GitProviderAzure.LIST_DESCRIPTION_TRUNCATION_LENGTH ||
          !rawPr.pullRequestId
        ) {
          return rawPr;
        }
        const cached = getCachedPullRequestDescription(
          "azure",
          repositoryKey,
          rawPr.pullRequestId,
          rawPr.status,
        );
        if (cached !== null) {
          return { ...rawPr, description: cached };
        }
        try {
          const full = await this.gitApi!.getPullRequestById(
            rawPr.pullRequestId,
            this.repoInfo!.owner,
          );
          const fullDescription = full?.description || "";
          if (fullDescription.length > listed.length) {
            setCachedPullRequestDescription(
              "azure",
              repositoryKey,
              rawPr.pullRequestId,
              rawPr.status,
              fullDescription,
            );
            return { ...rawPr, description: fullDescription };
          }
        } catch (err) {
          Logger.log(
            `Unable to read the full description of PR #${rawPr.pullRequestId}: ${String(err)}`,
          );
        }
        return rawPr;
      }),
    );
  }

  // Identifies the repository the cached descriptions belong to, from the git remote of the working
  // copy: that is the identifier the sfdx-hardis CLI agrees on, so the two share one cache.
  private pullRequestCacheRepositoryKey(): string {
    return repositoryKeyFromRemoteUrl(this.repoInfo?.remoteUrl || "");
  }

  private async convertAndCollectJobsList(
    rawPrs: GitPullRequest[],
    branchName: string,
    options: { withJobs: boolean },
  ): Promise<PullRequest[]> {
    if (rawPrs.length === 0) {
      return [];
    }
    // One getBuilds call for the whole batch rather than one per Pull Request: see
    // primePullRequestBuildIndex. Whatever it could not answer falls back to a per Pull Request
    // call below, bounded so a repository with hundreds of open Pull Requests does not fire
    // hundreds of simultaneous requests at the provider.
    if (options.withJobs === true) {
      await this.primePullRequestBuildIndex(rawPrs);
    }
    return await mapWithConcurrency(
      rawPrs,
      async (rawPr) => {
        const pr = this.convertToPullRequest(rawPr, branchName);
        if (options.withJobs === true) {
          try {
            pr.jobs = await this.fetchLatestJobsForPullRequest(rawPr, pr);
            pr.jobsStatus = this.computeJobsStatus(pr.jobs);
          } catch (e) {
            Logger.log(
              `Error fetching jobs for PR #${pr.number}: ${String(e)}`,
            );
          }
        }
        return pr;
      },
      DEFAULT_CONCURRENCY,
    );
  }

  /**
   * Azure DevOps applies its own default page size (about 100) when no $top is passed, and the
   * node API sends none unless it is given one. Every listing below was therefore silently capped
   * at that first page with no way to tell a full answer from a truncated one: on a repository
   * with thousands of Pull Requests a branch window could simply miss the ones it needed.
   *
   * These constants make the bound explicit, and listPullRequestsPaged walks the pages.
   */
  private static readonly PR_PAGE_SIZE = 200;
  // A stop so a pathological repository cannot turn one branch window into an unbounded crawl
  private static readonly PR_MAX_PAGES = 15;
  // A Pull Request closes after the commits it carries were written, but branches live long and
  // clocks drift, so the time bound is widened before it is used
  private static readonly PR_WINDOW_MARGIN_DAYS = 7;

  /** Walk the pages of a Pull Request listing, up to the explicit cap. */
  private async listPullRequestsPaged(
    searchCriteria: any,
    caller: string,
  ): Promise<GitPullRequest[]> {
    if (!this.gitApi || !this.repoInfo) {
      return [];
    }
    const all: GitPullRequest[] = [];
    for (let page = 0; page < GitProviderAzure.PR_MAX_PAGES; page++) {
      const skip = page * GitProviderAzure.PR_PAGE_SIZE;
      const prs = await this.gitApi.getPullRequests(
        this.repoInfo.repo,
        searchCriteria,
        this.repoInfo.owner,
        undefined, // maxCommentLength
        skip,
        GitProviderAzure.PR_PAGE_SIZE,
      );
      await this.logApiCall("gitApi.getPullRequests", {
        caller,
        skip,
        top: GitProviderAzure.PR_PAGE_SIZE,
        received: prs?.length || 0,
      });
      all.push(...(prs || []));
      // A short page is the last one
      if (!prs || prs.length < GitProviderAzure.PR_PAGE_SIZE) {
        return all;
      }
    }
    Logger.log(
      `[${caller}] stopped after ${GitProviderAzure.PR_MAX_PAGES} pages (${all.length} Pull Requests): the window may be incomplete`,
    );
    return all;
  }

  /**
   * The oldest date among a set of commits, widened by a margin, or undefined when none of them
   * carries a usable date. Used to bound a Pull Request listing in time instead of walking the
   * whole history of a branch.
   */
  private oldestCommitDateWithMargin(commits: any[]): Date | undefined {
    const times = (commits || [])
      .map((commit) =>
        new Date(
          commit?.committer?.date || commit?.author?.date || "",
        ).getTime(),
      )
      .filter((time) => !isNaN(time));
    if (times.length === 0) {
      return undefined;
    }
    const oldest = Math.min(...times);
    return new Date(
      oldest - GitProviderAzure.PR_WINDOW_MARGIN_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  /**
   * Fetch, in ONE call, the most recent Pull Request builds of the project and index them by the
   * Pull Request they belong to.
   *
   * Before this, every open Pull Request cost its own getBuilds call - a hundred open Pull
   * Requests meant a hundred round trips before the diagram could be drawn. Azure DevOps can
   * return the recent builds of every Pull Request at once (reasonFilter = PullRequest, ordered by
   * queue time), so one call covers the whole batch and only the Pull Requests missing from that
   * window still need a call of their own.
   *
   * The index is per instance and per refresh: a build that is still running has to be re-read.
   */
  private pullRequestBuildIndex: Map<string, any[]> | null = null;

  private async primePullRequestBuildIndex(
    rawPrs: GitPullRequest[],
  ): Promise<void> {
    // Truthiness, not `!== null`: the field is undefined until the first refresh primes it, and
    // an `undefined !== null` guard would skip the batch for the whole life of the provider
    if (this.pullRequestBuildIndex || !this.buildApi || !this.repoInfo) {
      return;
    }
    // Enough to cover the recent builds of a busy repository without asking for its whole history
    const BATCH_BUILDS_TOP = 500;
    const index = new Map<string, any[]>();
    this.pullRequestBuildIndex = index;
    if (rawPrs.length <= 1) {
      // A single Pull Request is cheaper to ask for directly
      return;
    }
    try {
      const builds = await this.buildApi.getBuilds(
        this.repoInfo.owner, // project
        undefined, // definitions
        undefined, // queues
        undefined, // buildNumber
        undefined, // minTime
        undefined, // maxTime
        undefined, // requestedFor
        256, // reasonFilter: BuildReason.PullRequest (256)
        undefined, // statusFilter
        undefined, // resultFilter
        undefined, // tagFilters
        undefined, // properties
        BATCH_BUILDS_TOP, // top
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        4, // queryOrder: QueueTimeDescending (4), so the newest build of a PR comes first
      );
      await this.logApiCall("buildApi.getBuilds", {
        caller: "primePullRequestBuildIndex",
        batchSize: rawPrs.length,
        top: BATCH_BUILDS_TOP,
      });
      for (const build of builds || []) {
        for (const key of this.buildIndexKeys(build)) {
          const existing = index.get(key);
          if (existing) {
            existing.push(build);
          } else {
            index.set(key, [build]);
          }
        }
      }
    } catch (e: any) {
      // The batch is an optimization: a failure only means every Pull Request pays its own call
      Logger.log(
        `Unable to prime the Pull Request build index: ${e?.message || String(e)}`,
      );
    }
  }

  // A build is looked up by the Pull Request it was triggered by, and by the commit it built, the
  // same two ways fetchLatestJobsForPullRequest matches them
  private buildIndexKeys(build: any): string[] {
    const keys: string[] = [];
    const prId =
      build?.triggerInfo?.["pr.number"] || build?.triggerInfo?.pullRequestId;
    if (prId) {
      keys.push(`pr:${String(prId)}`);
    }
    const sourceBranch = String(build?.sourceBranch || "");
    const refMatch = sourceBranch.match(/^refs\/pull\/(\d+)\/merge$/);
    if (refMatch) {
      keys.push(`pr:${refMatch[1]}`);
    }
    if (build?.sourceVersion) {
      keys.push(`commit:${String(build.sourceVersion).toLowerCase()}`);
    }
    return [...new Set(keys)];
  }

  // The builds the batch already knows for a Pull Request, newest first, or null when the batch
  // has nothing on it and a dedicated call is still needed
  private indexedBuildsForPullRequest(
    rawPr: GitPullRequest,
    pr: PullRequest,
  ): any[] | null {
    if (!this.pullRequestBuildIndex) {
      return null;
    }
    const byPr = pr.number
      ? this.pullRequestBuildIndex.get(`pr:${pr.number}`)
      : undefined;
    if (byPr && byPr.length > 0) {
      return byPr;
    }
    const commitId = rawPr.lastMergeSourceCommit?.commitId;
    const byCommit = commitId
      ? this.pullRequestBuildIndex.get(`commit:${commitId.toLowerCase()}`)
      : undefined;
    return byCommit && byCommit.length > 0 ? byCommit : null;
  }

  /** Forget the batched builds, so the next refresh re-reads the ones still running. */
  public resetPullRequestBuildIndex(): void {
    this.pullRequestBuildIndex = null;
  }

  private async fetchLatestJobsForPullRequest(
    rawPr: GitPullRequest,
    pr: PullRequest,
  ): Promise<Job[]> {
    if (!this.connection || !this.repoInfo) {
      return [];
    }

    try {
      // Served by the one batched call of primePullRequestBuildIndex whenever it covers this Pull
      // Request; only the ones outside that window still cost a call of their own
      const indexed = this.indexedBuildsForPullRequest(rawPr, pr);
      const builds = indexed ?? (await this.fetchBuildsForSinglePullRequest(pr));
      return await this.jobsFromBuilds(builds, rawPr, pr);
    } catch (e: any) {
      Logger.log(
        `Error fetching jobs for PR #${pr.number}: ${e?.message || String(e)}`,
      );
      return [];
    }
  }

  /** The builds of one Pull Request, when the batched index does not cover it. */
  private async fetchBuildsForSinglePullRequest(pr: PullRequest): Promise<any[]> {
    if (!this.buildApi || !this.repoInfo) {
      return [];
    }
    try {
      // Get builds triggered by this specific pull request
      // For PR builds, Azure DevOps uses refs/pull/{prId}/merge as the source branch
      // Use reasonFilter to only get PR-triggered builds
      const builds = await this.buildApi!.getBuilds(
        this.repoInfo.owner, // project
        undefined, // definitions
        undefined, // queues
        undefined, // buildNumber
        undefined, // minTime
        undefined, // maxTime
        undefined, // requestedFor
        256, // reasonFilter: BuildReason.PullRequest (256)
        undefined, // statusFilter
        undefined, // resultFilter
        undefined, // tagFilters
        undefined, // properties
        5, // top: limit results
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        4, // queryOrder: QueueTimeDescending (4) ensures most recently triggered build first
        pr.number ? `refs/pull/${pr.number}/merge` : undefined, // branchName: PR merge ref
      );
      await this.logApiCall("buildApi.getBuilds", {
        caller: "fetchBuildsForSinglePullRequest",
        prNumber: pr.number,
      });
      return builds || [];
    } catch (e: any) {
      Logger.log(
        `Error fetching builds for PR #${pr.number}: ${e?.message || String(e)}`,
      );
      return [];
    }
  }

  /** Turn the builds of a Pull Request into jobs, falling back on its statuses when it has none. */
  private async jobsFromBuilds(
    builds: any[],
    rawPr: GitPullRequest,
    pr: PullRequest,
  ): Promise<Job[]> {
    if (!this.repoInfo) {
      return [];
    }
    {
      // Filter builds that match this specific PR
      const matchingBuilds = (builds || []).filter((b: any) => {
        // Check if build was triggered by this PR
        const buildPrId =
          b.triggerInfo?.["pr.number"] || b.triggerInfo?.pullRequestId;
        if (buildPrId && pr.number) {
          return String(buildPrId) === String(pr.number);
        }

        // Fallback: the merge ref of the Pull Request. Azure names the source branch of a Pull
        // Request build `refs/pull/<id>/merge`, and some pipelines set no `pr.number` trigger
        // info at all: without this, their builds were dropped here and the chip showed no status
        // even though the build was right there.
        if (pr.number && b.sourceBranch === `refs/pull/${pr.number}/merge`) {
          return true;
        }

        // Fallback: match by commit ID
        const commitId = rawPr.lastMergeSourceCommit?.commitId;
        if (commitId && b.sourceVersion) {
          return b.sourceVersion.toLowerCase() === commitId.toLowerCase();
        }

        return false;
      });

      if (matchingBuilds.length === 0) {
        Logger.log(
          `No builds found for PR #${pr.number}, checking PR statuses`,
        );

        // Fallback: PR statuses (Jenkins, external CI)
        if (pr.number) {
          const prStatuses = await this.gitApi!.getPullRequestStatuses(
            this.repoInfo.repo,
            pr.number,
            this.repoInfo.owner,
          );
          await this.logApiCall("gitApi.getPullRequestStatuses", {
            caller: "fetchLatestJobsForPullRequest",
            prNumber: pr.number,
          });

          if (prStatuses && prStatuses.length > 0) {
            // Deduplicate by context name, keeping the most recent per context
            const latestByContext = new Map<string, any>();
            for (const s of prStatuses) {
              const key = s.context?.name || "external-ci";
              const existing = latestByContext.get(key);
              const existingTime = existing
                ? new Date(existing.creationDate || 0)
                : new Date(0);
              const sTime = new Date(s.creationDate || 0);
              if (sTime > existingTime) {
                latestByContext.set(key, s);
              }
            }
            return Array.from(latestByContext.values()).map((s: any) => ({
              name: s.context?.name || "external-ci",
              status: this.mapAzureGitStatusStateToJobStatus(s.state),
              webUrl: s.targetUrl || undefined,
              updatedAt: s.creationDate?.toISOString() || undefined,
              raw: s,
            }));
          }
        }

        return [];
      }

      // Return the most recent build
      const build = matchingBuilds[0];
      return [
        {
          name: build.definition?.name || String(build.id || ""),
          status: this.mapAzureBuildStatus(build),
          webUrl: build._links?.web?.href,
          updatedAt: (build.finishTime || build.queueTime)?.toISOString(),
          raw: build,
        },
      ];
    }
  }

  /**
   * Maps Azure DevOps build status and result to unified JobStatus
   *
   * Build Status (indicates current state):
   * - None (0), InProgress (1), Completed (2), Cancelling (4), Postponed (8), NotStarted (32), All (47)
   *
   * Build Result (indicates final outcome, only set when status is Completed):
   * - None (0), Succeeded (2), PartiallySucceeded (4), Failed (8), Canceled (32)
   *
   * Mapping logic (aggressive failure detection):
   * - InProgress → 'running'
   * - Completed + Succeeded → 'success'
   * - Completed + PartiallySucceeded → 'success' (completed with warnings)
   * - Completed + Failed → 'failed'
   * - Completed + Canceled → 'failed'
   * - Completed + (no result or unknown) → 'failed'
   * - NotStarted, Postponed → 'pending'
   * - Cancelling → 'failed'
   * - Any other combination → 'failed' (aggressive: unknown states treated as failures)
   */
  private mapAzureBuildStatus(build: any): JobStatus {
    const status = build.status;
    const result = build.result;

    // InProgress - build is running
    if (status === 1) {
      return "running";
    }

    // NotStarted or Postponed - build is queued/waiting
    if (status === 8 || status === 32) {
      return "pending";
    }

    // Completed - check result for final outcome
    if (status === 2) {
      if (result === 2) {
        // Succeeded
        return "success";
      }
      if (result === 4) {
        // PartiallySucceeded
        return "success";
      }
      // Any other result for completed builds is a failure
      // This includes: Failed (8), Canceled (32), None (0), or unknown values
      return "failed";
    }

    // Cancelling or any other status is treated as failure
    // This includes: Cancelling (4), None (0), All (47), or unknown values
    return "failed";
  }

  private mapAzureGitStatusStateToJobStatus(
    state: GitStatusState | undefined,
  ): JobStatus {
    switch (state) {
      case GitStatusState.Succeeded:
      case GitStatusState.PartiallySucceeded:
        return "success";
      case GitStatusState.Failed:
      case GitStatusState.Error:
        return "failed";
      case GitStatusState.Pending:
        return "pending";
      default:
        return "unknown";
    }
  }

  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    if (!this.connection || !this.repoInfo) {
      return null;
    }

    try {
      // Use server-side filtering with exact branch reference
      const builds = await this.buildApi!.getBuilds(
        this.repoInfo.owner, // project
        undefined, // definitions
        undefined, // queues
        undefined, // buildNumber
        undefined, // minTime
        undefined, // maxTime
        undefined, // requestedFor
        undefined, // reasonFilter: undefined = all except PullRequest
        undefined, // statusFilter
        undefined, // resultFilter
        undefined, // tagFilters
        undefined, // properties
        5, // top: limit results
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        4, // queryOrder: QueueTimeDescending (4) ensures most recently triggered build first
        `refs/heads/${branchName}`, // branchName: exact branch reference
      );
      await this.logApiCall("buildApi.getBuilds", {
        caller: "getJobsForBranchLatestCommit",
        branchName: `refs/heads/${branchName}`,
      });

      // Additional filter to exclude PR-triggered builds (reason code varies)
      const commitBuilds = (builds || []).filter(
        (b: any) => b.reason !== "pullRequest" && b.reason !== 256,
      );

      if (commitBuilds.length === 0) {
        // Fallback: commit statuses (Jenkins, external CI)
        try {
          const branchStats = await this.gitApi!.getBranch(
            this.repoInfo.repo,
            branchName,
            this.repoInfo.owner,
          );
          await this.logApiCall("gitApi.getBranch", {
            caller: "getJobsForBranchLatestCommit",
            branch: branchName,
          });
          const latestCommitId = branchStats?.commit?.commitId;
          if (!latestCommitId) {
            return { jobs: [], jobsStatus: "unknown" };
          }

          const statuses = await this.gitApi!.getStatuses(
            latestCommitId,
            this.repoInfo.repo,
            this.repoInfo.owner,
          );
          await this.logApiCall("gitApi.getStatuses", {
            caller: "getJobsForBranchLatestCommit",
            commitId: latestCommitId,
          });

          if (!statuses || statuses.length === 0) {
            return { jobs: [], jobsStatus: "unknown" };
          }

          const statusJobs: Job[] = statuses.map((s: any) => ({
            name: s.context?.name || "external-ci",
            status: this.mapAzureGitStatusStateToJobStatus(s.state),
            webUrl: s.targetUrl || undefined,
            updatedAt: s.creationDate?.toISOString() || undefined,
            raw: s,
          }));
          return {
            jobs: statusJobs,
            jobsStatus: this.computeJobsStatus(statusJobs),
          };
        } catch (e) {
          Logger.log(
            `Error fetching commit statuses for branch ${branchName}: ${String(e)}`,
          );
          return { jobs: [], jobsStatus: "unknown" };
        }
      }

      const build = commitBuilds[0];
      const job: Job = {
        name: build.definition?.name || String(build.id || ""),
        status: this.mapAzureBuildStatus(build),
        webUrl: build._links?.web?.href,
        updatedAt: (build.finishTime || build.queueTime)?.toISOString(),
        raw: build,
      };

      return { jobs: [job], jobsStatus: this.computeJobsStatus([job]) };
    } catch (e) {
      Logger.log(`Error fetching jobs for branch ${branchName}: ${String(e)}`);
      return null;
    }
  }

  convertToPullRequest(pr: any, branchName: string): PullRequest {
    const prConverted: PullRequest = {
      id: pr.pullRequestId || (pr as any).id,
      number: pr.pullRequestId || (pr as any).id,
      title: pr.title || "",
      description: pr.description || "",
      state: this.mapAzureStatusToState(pr),
      authorLabel:
        pr.createdBy?.displayName || pr.createdBy?.uniqueName || "unknown",
      webUrl: this.buildPullRequestWebUrl(pr),
      sourceBranch: pr.sourceRefName
        ? pr.sourceRefName.replace(/^refs\/heads\//, "")
        : branchName,
      targetBranch: pr.targetRefName
        ? pr.targetRefName.replace(/^refs\/heads\//, "")
        : "",
      mergeDate:
        pr.status === 3 && pr.closedDate
          ? pr.closedDate.toISOString()
          : undefined,
      createdAt: pr.creationDate ? pr.creationDate.toISOString() : undefined,
      updatedAt: pr.closedDate ? pr.closedDate.toISOString() : undefined,
      jobsStatus: "unknown",
      // Azure DevOps tests the merge of active Pull Requests on its own and returns the result in
      // the Pull Request list, so reading it costs nothing
      mergeStatus:
        pr.status === PullRequestStatus.Active
          ? mapAzureMergeStatus(pr)
          : undefined,
    };
    return prConverted;
  }

  /**
   * Builds the browser URL for a pull request
   * Format: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{prId}
   */
  private buildPullRequestWebUrl(pr: GitPullRequest): string {
    // First try to get the web link from the PR if available
    if (pr._links?.web?.href) {
      return pr._links.web.href;
    }

    // Construct from repoInfo if available
    if (this.repoInfo?.webUrl && pr.pullRequestId) {
      // repoInfo.webUrl format: https://dev.azure.com/org/project/_git/repo
      return `${this.repoInfo.webUrl}/pullrequest/${pr.pullRequestId}`;
    }

    // Fallback to API URL if nothing else works
    return pr.url || "";
  }

  /**
   * Maps Azure DevOps PR status to unified PullRequestStatus
   * Azure status values: NotSet (0), Active (1), Abandoned (2), Completed (3), All (4)
   * Mapping:
   * - Active (1) → 'open'
   * - Abandoned (2) → 'declined'
   * - Completed (3) → 'merged' if merge succeeded, otherwise 'closed'
   * - NotSet/other → 'open' (default)
   */
  private mapAzureStatusToState(pr: GitPullRequest): PullRequest["state"] {
    const status = pr.status;
    if (status === PullRequestStatus.Active) {
      return "open";
    }
    if (status === PullRequestStatus.Abandoned) {
      return "declined";
    }
    if (status === PullRequestStatus.Completed) {
      // Check if PR was actually merged or just closed
      // mergeStatus indicates if merge succeeded
      if (pr.mergeStatus === ("succeeded" as any)) {
        return "merged";
      }
      return "closed";
    }
    // Default for NotSet or unknown
    return "open";
  }

  getCreatePullRequestUrl(
    sourceBranch: string,
    targetBranch: string,
  ): string | null {
    if (
      !this.repoInfo?.webUrl ||
      !this.repoInfo?.owner ||
      !this.repoInfo?.repo
    ) {
      return null;
    }
    // Azure DevOps: https://dev.azure.com/org/project/_git/repo/pullrequestcreate?sourceRef=source&targetRef=target&title=MAJOR:%20sourceBranch%20to%20targetBranch
    const title = `MAJOR: ${sourceBranch} to ${targetBranch}`;
    return `${this.repoInfo.webUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(sourceBranch)}&targetRef=${encodeURIComponent(targetBranch)}&title=${encodeURIComponent(title)}`;
  }
}
