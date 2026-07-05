import { GitProvider } from "./gitProvider";
import { Gitlab } from "@gitbeaker/rest";
import type {
  MergeRequestSchemaWithBasicLabels,
  Camelize,
} from "@gitbeaker/rest";
import {
  CreateTokenOption,
  GoLive,
  ProviderDescription,
  PullRequest,
  Job,
  JobStatus,
} from "./types";
import { SecretsManager } from "../secretsManager";
import { CacheManager } from "../cache-manager";
import { Logger } from "../../logger";
import { t } from "../../i18n/i18n";
import {
  promptForToken,
  showAuthFailureGuidance,
} from "../providerCredentials";

export class GitProviderGitlab extends GitProvider {
  gitlabClient: InstanceType<typeof Gitlab> | null = null;
  gitlabProjectPath: string | null = null;
  gitlabProjectId: number | null = null;
  secretTokenIdentifier: string = "";

  getCreateTokenOptions(): CreateTokenOption[] {
    if (!this.repoInfo?.host) {
      return [];
    }
    return [
      {
        id: "pat",
        label: t("createGitlabPat"),
        url: `https://${this.repoInfo.host}/-/user_settings/personal_access_tokens?name=sfdx-hardis&scopes=api,read_user,read_repository,write_repository`,
        scopesHint: "api, read_user, read_repository, write_repository",
      },
    ];
  }

  async authenticate(): Promise<boolean | null> {
    const token = await promptForToken({
      providerLabel: "GitLab",
      inputPrompt: t("gitlabEnterPAT"),
      createTokenOptions: this.getCreateTokenOptions(),
    });
    if (token) {
      await SecretsManager.setSecret(this.secretTokenIdentifier, token);
      await this.initialize();
      return this.isActive;
    }
    return null;
  }

  async disconnect(): Promise<void> {
    // GitLab uses PAT tokens stored in secrets
    // Delete the stored token
    if (this.secretTokenIdentifier) {
      try {
        await SecretsManager.deleteSecret(this.secretTokenIdentifier);
      } catch {
        // Ignore if secret doesn't exist
      }
    } else if (this.repoInfo?.host) {
      // Fallback if secretTokenIdentifier wasn't set
      const hostKey = this.repoInfo.host.replace(/\./g, "_").toUpperCase();
      try {
        await SecretsManager.deleteSecret(`${hostKey}_TOKEN`);
      } catch {
        // Ignore if secret doesn't exist
      }
    }

    // Drop the cached project id (computed from host + path, both still set here)
    // so a future reconnect re-validates instead of trusting a stale entry.
    if (this.gitlabProjectPath) {
      await CacheManager.delete("orgs", this.gitlabProjectIdCacheKey());
    }

    this.gitlabClient = null;
    this.gitlabProjectPath = null;
    this.gitlabProjectId = null;
    this.isActive = false;
    Logger.log(
      `Disconnected from GitLab (${this.repoInfo?.host || "unknown host"})`,
    );
    await super.disconnect();
  }

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "GitLab",
      pullRequestLabel: t("mergeRequestLabel"),
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/-/merge_requests`
        : "",
    };
  }

  async initialize() {
    // Check if we have info to connect to Gitlab using Gitbeaker
    this.isActive = false;
    this.secretTokenIdentifier = this.hostKey + "_TOKEN";
    const gitlabToken = await SecretsManager.getSecret(
      this.secretTokenIdentifier,
    );
    if (gitlabToken && this.repoInfo?.host && this.repoInfo?.remoteUrl) {
      const host =
        this.repoInfo.host === "gitlab.com"
          ? "https://gitlab.com"
          : `https://${this.repoInfo.host}`;
      this.gitlabClient = new Gitlab({
        host: host,
        token: gitlabToken,
      });
      // Extract project path from current git remote url, supporting nested groups
      // Examples:
      // - https://gitlab.com/group/project.git => group/project
      // - git@gitlab.com:group/project.git => group/project
      // - https://gitlab.hardis-group.com/busalesforce/hardis-group-interne/hardis-sfdx-official => busalesforce/hardis-group-interne/hardis-sfdx-official
      // - git@gitlab.hardis-group.com:busalesforce/hardis-group-interne/hardis-sfdx-official.git => busalesforce/hardis-group-interne/hardis-sfdx-official

      const remoteUrl = this.repoInfo.remoteUrl;

      // Match both SSH and HTTPS, with or without .git, and support nested groups
      // SSH: git@gitlab.com:group/subgroup/project.git
      // HTTPS: https://gitlab.com/group/subgroup/project.git
      // HTTPS (no .git): https://gitlab.hardis-group.com/busalesforce/hardis-group-interne/hardis-sfdx-official
      const sshMatch = remoteUrl.match(/^git@[^:]+:([^ ]+?)(\.git)?$/);
      const httpsMatch = remoteUrl.match(/^https?:\/\/[^/]+\/(.+?)(\.git)?$/);

      if (sshMatch && sshMatch[1]) {
        this.gitlabProjectPath = sshMatch[1];
      } else if (httpsMatch && httpsMatch[1]) {
        this.gitlabProjectPath = httpsMatch[1];
      } else {
        this.gitlabProjectPath = null;
      }
      if (this.gitlabProjectPath) {
        await this.resolveGitlabAccess();
      } else {
        Logger.log(
          `Could not extract GitLab project path from remote URL: ${this.repoInfo.remoteUrl}`,
        );
      }
      if (!this.isActive) {
        showAuthFailureGuidance({
          providerName: "GitLab",
          guidance: t("gitlabAuthInfo"),
          retry: () => this.reauthenticateAndRefresh(),
          docUrl:
            "https://docs.gitlab.com/user/profile/personal_access_tokens/",
        });
      }
    }
  }

  // Cache key for the (stable) GitLab project id, scoped to host + project path.
  // Stored in the long-lived "orgs" cache section so it survives hard refreshes;
  // it is self-healed by the background re-validation on each initialize().
  private gitlabProjectIdCacheKey(): string {
    return `gitlabProjectId:${this.repoInfo?.host}:${this.gitlabProjectPath}`;
  }

  // Validate the GitLab token and resolve the project id. The token is ALWAYS
  // re-checked (Users.showCurrentUser) so isActive reflects whether the token is
  // still valid on every init. The project id is stable, so when it is cached we
  // skip the extra Projects.show lookup; otherwise both calls run in parallel
  // (≈halves cold init time) and the resolved id is cached for next time.
  private async resolveGitlabAccess(): Promise<boolean> {
    if (!this.gitlabClient || !this.gitlabProjectPath) {
      return false;
    }
    const cacheKey = this.gitlabProjectIdCacheKey();
    const cachedProjectId = CacheManager.get<number>("orgs", cacheKey);
    const PROJECT_ID_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
    try {
      if (cachedProjectId) {
        // Project id known — only verify the token is still valid.
        const currentUser = await this.gitlabClient.Users.showCurrentUser();
        await this.logApiCall("Users.showCurrentUser", {
          caller: "initialize",
        });
        if (!currentUser || !currentUser.id) {
          Logger.log(
            `Gitlab authentication failed: could not fetch current user with provided token.`,
          );
          // Token no longer valid — drop the cached id so a later init re-resolves.
          await CacheManager.delete("orgs", cacheKey);
          return false;
        }
        this.gitlabProjectId = cachedProjectId;
        this.isActive = true;
        // Refresh the cache TTL while the token remains valid.
        await CacheManager.set(
          "orgs",
          cacheKey,
          cachedProjectId,
          PROJECT_ID_TTL_MS,
        );
        return true;
      }

      // No cached project id: validate the token and resolve the project id in
      // parallel, distinguishing "invalid token" from "no access to project".
      const [userResult, projectResult] = await Promise.allSettled([
        this.gitlabClient.Users.showCurrentUser(),
        this.gitlabClient.Projects.show(this.gitlabProjectPath),
      ]);
      await this.logApiCall("Users.showCurrentUser", { caller: "initialize" });
      await this.logApiCall("Projects.show", { caller: "initialize" });
      const currentUser =
        userResult.status === "fulfilled" ? userResult.value : null;
      const project =
        projectResult.status === "fulfilled" ? projectResult.value : null;
      if (!currentUser || !currentUser.id) {
        Logger.log(
          `Gitlab authentication failed: could not fetch current user with provided token.`,
        );
        return false;
      }
      if (!project || !project.id) {
        // Token is valid but the user cannot access this project.
        Logger.log(
          `Gitlab authentication succeeded, but project '${this.gitlabProjectPath}' is not accessible with this token (insufficient access or wrong path).`,
        );
        return false;
      }
      this.gitlabProjectId = project.id;
      this.isActive = true;
      await CacheManager.set("orgs", cacheKey, project.id, PROJECT_ID_TTL_MS);
      return true;
    } catch (err) {
      Logger.log(`Gitlab access check failed: ${String(err)}`);
      return false;
    }
  }

  getNameForPullRequest(): string {
    return "Merge Request";
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    if (!this.gitlabClient || !this.gitlabProjectId) {
      return [];
    }
    const mergeRequests = await this.gitlabClient!.MergeRequests.all({
      projectId: this.gitlabProjectId!,
      state: "opened",
      perPage: 100,
    });
    await this.logApiCall("MergeRequests.all", {
      caller: "listOpenPullRequests",
      state: "opened",
    });
    return await this.convertAndCollectJobsList(mergeRequests, {
      withJobs: true,
    });
  }

  async getActivePullRequestFromBranch(
    branchName: string,
  ): Promise<PullRequest | null> {
    if (!this.gitlabClient || !this.gitlabProjectId) {
      return null;
    }
    try {
      const mergeRequests = await this.gitlabClient.MergeRequests.all({
        projectId: this.gitlabProjectId,
        sourceBranch: branchName,
        state: "opened",
        perPage: 2,
        orderBy: "updated_at",
        sort: "desc",
      });
      await this.logApiCall("MergeRequests.all", {
        caller: "getActivePullRequestFromBranch",
        sourceBranch: branchName,
        state: "opened",
      });
      if (!mergeRequests || mergeRequests.length === 0) {
        return null;
      }
      const converted = await this.convertAndCollectJobsList(mergeRequests, {
        withJobs: true,
      });
      return converted[0] || null;
    } catch (err) {
      Logger.log(
        `Error fetching active MR for branch ${branchName}: ${String(err)}`,
      );
      return null;
    }
  }

  // The goal if this method is to list all MRs that have been merged in branch name, but also those who has been merged in branches at previous level
  // For example, on a pipeline integ -> uat -> preprod -> prod
  // If we call this method with branch name uat, we need to have the MRs merged in uat, but also the MRs merged to integ (whose commits are present in uat) since the last MR merged between uat and preprod
  async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string, // ex: uat
    targetBranchName: string, // ex: preprod
    childBranchesNames: string[], // ex: [integ]
  ): Promise<PullRequest[]> {
    if (!this.gitlabClient || !this.gitlabProjectId) {
      return [];
    }

    try {
      // Step 1: Find the last merge from currentBranch to targetBranch
      const lastMergeToTarget = await this.findLastMergedMR(
        currentBranchName,
        targetBranchName,
      );

      // Step 2: Get all commits in currentBranch since that merge (or all if no previous merge)
      const commitsSinceLastMerge = await this.getCommitsSinceLastMerge(
        currentBranchName,
        lastMergeToTarget,
      );

      if (commitsSinceLastMerge.length === 0) {
        return [];
      }

      // Create a Set of commit SHAs for fast lookup
      const commitSHAs = new Set(commitsSinceLastMerge.map((c) => c.id));

      // Step 3-6: Get merged MRs targeting currentBranch and child branches,
      // keep those whose merge commit belongs to our commit list, dedupe, convert
      const allBranches = [currentBranchName, ...childBranchesNames];
      return await this.collectMergedMRsForCommits(allBranches, commitSHAs);
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
    if (!this.gitlabClient || !this.gitlabProjectId) {
      return undefined;
    }
    try {
      const branch = await this.gitlabClient.Branches.show(
        this.gitlabProjectId,
        branchName,
      );
      await this.logApiCall("Branches.show", {
        caller: "getBranchLatestCommitId",
        branch: branchName,
      });
      return (branch as any)?.commit?.id;
    } catch (err) {
      Logger.log(
        `Error fetching latest commit for branch ${branchName}: ${String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * Lists the go lives (merges into a top branch such as main/prod), most recent
   * first. Each merged MR into the branch is a go live; only the merge commit and
   * a few display fields are returned (no MR contents).
   */
  async fetchGoLives(branchName: string): Promise<GoLive[]> {
    if (!this.gitlabClient || !this.gitlabProjectId) {
      return [];
    }
    try {
      const mergedMRs = await this.gitlabClient.MergeRequests.all({
        projectId: this.gitlabProjectId,
        targetBranch: branchName,
        state: "merged",
        orderBy: "updated_at",
        sort: "desc",
        perPage: 100,
        maxPages: 1,
      });
      await this.logApiCall("MergeRequests.all", {
        caller: "fetchGoLives",
        targetBranch: branchName,
      });
      return mergedMRs
        .map((mr: any) => {
          const id = String(mr.mergeCommitSha || mr.merge_commit_sha || "");
          return {
            id,
            prNumber: mr.iid,
            title: mr.title,
            mergeDate: mr.mergedAt || mr.merged_at || mr.updatedAt,
            webUrl: mr.webUrl || mr.web_url || "",
          };
        })
        .filter((g) => g.id);
    } catch (err) {
      Logger.log(`Error fetching GitLab go lives: ${String(err)}`);
      return [];
    }
  }

  /**
   * Lists the Merge Requests carried by a specific go live (merge commit
   * `mergeCommitSha`) into a top branch. Commits introduced by the go live are
   * those reachable from the merge commit but not from its first parent (the
   * mainline before the go live), so other go lives are excluded.
   */
  async listPullRequestsInGoLive(
    branchName: string,
    childBranchesNames: string[],
    mergeCommitSha: string,
  ): Promise<PullRequest[]> {
    if (!this.gitlabClient || !this.gitlabProjectId || !mergeCommitSha) {
      return [];
    }

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
      // over-reporting every merged MR.
      let firstParent: string | undefined;
      try {
        const mergeCommit = await this.gitlabClient.Commits.show(
          this.gitlabProjectId,
          mergeCommitSha,
        );
        await this.logApiCall("Commits.show", {
          caller: "listPullRequestsInGoLive",
          sha: mergeCommitSha,
        });
        const parentIds =
          (mergeCommit as any).parent_ids ||
          (mergeCommit as any).parentIds ||
          [];
        firstParent = parentIds[0];
      } catch (err) {
        Logger.log(
          `Error fetching merge commit ${mergeCommitSha}: ${String(err)}`,
        );
      }
      if (!firstParent) {
        return [];
      }

      // Step 2: Commits introduced by the go live (straight diff
      // firstParent..mergeCommit)
      const comparison = await this.gitlabClient.Repositories.compare(
        this.gitlabProjectId,
        firstParent,
        mergeCommitSha,
        { straight: true },
      );
      await this.logApiCall("Repositories.compare", {
        caller: "listPullRequestsInGoLive",
        from: firstParent,
        to: mergeCommitSha,
      });
      const comparedCommits: any[] = (comparison as any).commits || [];
      if (comparedCommits.length === 0) {
        return [];
      }
      const commitSHAs = new Set<string>(
        comparedCommits.map((c) => c.id as string),
      );
      // The merge commit itself may not be part of the compare result, so add it
      // so the go-live promotion MR matches too.
      commitSHAs.add(mergeCommitSha);

      // Step 3-5: same matching as listPullRequestsInBranchSinceLastMerge
      const allBranches = [branchName, ...childBranchesNames];
      const result = await this.collectMergedMRsForCommits(
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
   * Shared tail of the "MRs in branch" queries: fetch all merged MRs targeting
   * each branch in `allBranches`, keep those whose merge (or last) commit SHA is
   * part of `commitSHAs`, dedupe by MR iid and convert to the common PullRequest
   * shape.
   */
  private async collectMergedMRsForCommits(
    allBranches: string[],
    commitSHAs: Set<string>,
  ): Promise<PullRequest[]> {
    const mrPromises = allBranches.map(async (branchName) => {
      try {
        const mergedMRs = await this.gitlabClient!.MergeRequests.all({
          projectId: this.gitlabProjectId!,
          targetBranch: branchName,
          state: "merged",
          perPage: 100,
        });
        await this.logApiCall("MergeRequests.all", {
          caller: "collectMergedMRsForCommits",
          action: "fetchMergedMRs",
          targetBranch: branchName,
        });
        return mergedMRs;
      } catch (err) {
        Logger.log(
          `Error fetching merged MRs for branch ${branchName}: ${String(err)}`,
        );
        return [];
      }
    });

    const mrResults = await Promise.all(mrPromises);
    const allMergedMRs: Array<
      | MergeRequestSchemaWithBasicLabels
      | Camelize<MergeRequestSchemaWithBasicLabels>
    > = mrResults.flat();

    const relevantMRs = allMergedMRs.filter((mr) => {
      const mergeCommitSha = (mr.mergeCommitSha || mr.merge_commit_sha) as
        string | undefined;
      if (mergeCommitSha && commitSHAs.has(mergeCommitSha)) {
        return true;
      }
      // Also check if the MR's SHA (last commit before merge) is in our commits
      const sha = mr.sha as string | undefined;
      if (sha && commitSHAs.has(sha)) {
        return true;
      }
      return false;
    });

    const uniqueMRsMap = new Map<number, (typeof relevantMRs)[0]>();
    for (const mr of relevantMRs) {
      if (mr.iid && !uniqueMRsMap.has(mr.iid)) {
        uniqueMRsMap.set(mr.iid, mr);
      }
    }
    const uniqueMRs = Array.from(uniqueMRsMap.values());

    return await this.convertAndCollectJobsList(uniqueMRs, {
      withJobs: false,
    });
  }

  /**
   * Find the last merge request that was merged from sourceBranch to targetBranch
   */
  private async findLastMergedMR(
    sourceBranch: string,
    targetBranch: string,
  ): Promise<
    | MergeRequestSchemaWithBasicLabels
    | Camelize<MergeRequestSchemaWithBasicLabels>
    | null
  > {
    try {
      const mergedMRs = await this.gitlabClient!.MergeRequests.all({
        projectId: this.gitlabProjectId!,
        sourceBranch: sourceBranch,
        targetBranch: targetBranch,
        state: "merged",
        orderBy: "updated_at",
        sort: "desc",
        perPage: 1,
        maxPages: 1,
      });
      await this.logApiCall("MergeRequests.all", {
        caller: "findLastMergedMR",
        sourceBranch,
        targetBranch,
      });

      return mergedMRs.length > 0 ? mergedMRs[0] : null;
    } catch (err) {
      Logger.log(
        `Error finding last merged MR from ${sourceBranch} to ${targetBranch}: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * Get all commits in the branch since the last merge (or all commits if no previous merge)
   */
  private async getCommitsSinceLastMerge(
    branchName: string,
    lastMerge:
      | MergeRequestSchemaWithBasicLabels
      | Camelize<MergeRequestSchemaWithBasicLabels>
      | null,
  ): Promise<any[]> {
    try {
      const options: any = {
        refName: branchName,
        perPage: 100,
      };

      // If there was a previous merge, get commits since that merge commit
      if (lastMerge) {
        const mergeCommitSha =
          lastMerge.mergeCommitSha || lastMerge.merge_commit_sha;
        if (mergeCommitSha) {
          // Get commits since the merge commit
          options.since = lastMerge.mergedAt || lastMerge.merged_at;
        }
      }

      const commits = await this.gitlabClient!.Commits.all(
        this.gitlabProjectId!,
        options,
      );
      await this.logApiCall("Commits.all", {
        caller: "getCommitsSinceLastMerge",
        ...options,
      });

      return commits || [];
    } catch (err) {
      Logger.log(
        `Error fetching commits for branch ${branchName}: ${String(err)}`,
      );
      return [];
    }
  }

  // Batch helper: convert an array of raw merge requests and enrich each with jobs
  private async convertAndCollectJobsList(
    rawMrs: Array<
      | MergeRequestSchemaWithBasicLabels
      | Camelize<MergeRequestSchemaWithBasicLabels>
    >,
    options: { withJobs: boolean },
  ): Promise<PullRequest[]> {
    if (!rawMrs || rawMrs.length === 0) {
      return [];
    }
    const converted: PullRequest[] = await Promise.all(
      rawMrs.map(async (mr) => {
        const pr = this.convertToPullRequest(mr);
        if (options.withJobs === true) {
          try {
            const jobs = await this.fetchLatestJobsForPullRequest(mr);
            pr.jobs = jobs;
            pr.jobsStatus = this.computeJobsStatus(jobs);
          } catch (e) {
            Logger.log(
              `Error fetching jobs for MR !${pr.number}: ${String(e)}`,
            );
          }
        }
        return pr;
      }),
    );
    return converted;
  }

  // Fetch jobs for the latest pipeline related to the merge request.
  // Prefer mr.head_pipeline if available, otherwise try pipelines by SHA or MR pipelines endpoint.
  private async fetchLatestJobsForPullRequest(
    mr:
      | MergeRequestSchemaWithBasicLabels
      | Camelize<MergeRequestSchemaWithBasicLabels>,
  ): Promise<Job[]> {
    try {
      const projectId = this.gitlabProjectId!;
      const mrIid = mr.iid!;
      // Collect pipelines for the merge request (Gitbeaker: MergeRequests.pipelines)
      let pipelines: any[] = [];
      try {
        // @ts-ignore - method signature may differ across gitbeaker versions
        pipelines = await this.gitlabClient?.Pipelines.all(projectId, {
          sha: mr.sha,
          perPage: 5,
          maxPages: 1,
          orderBy: "updated_at",
          sort: "desc",
        });
        await this.logApiCall("Pipelines.all", {
          caller: "fetchLatestJobsForPullRequest",
          pr: mrIid,
          sha: mr.sha,
        });
      } catch (e) {
        Logger.log(`Error fetching pipelines for MR !${mrIid}: ${String(e)}`);
        return [];
      }

      if (!Array.isArray(pipelines) || pipelines.length === 0) {
        // Fallback: commit statuses (Jenkins, etc.)
        const sha = mr.sha;
        if (sha) {
          try {
            // @ts-ignore - Commits.allStatuses is part of gitbeaker but may be missing from some type versions
            const statuses: any[] =
              (await this.gitlabClient!.Commits.allStatuses(
                projectId,
                String(sha),
              )) || [];
            await this.logApiCall("Commits.allStatuses", {
              caller: "fetchLatestJobsForPullRequest",
              sha,
            });
            return this.mapGitLabCommitStatusesToJobs(statuses);
          } catch (e) {
            Logger.log(
              `Error fetching commit statuses for MR !${mrIid}: ${String(e)}`,
            );
          }
        }
        return [];
      }

      const converted: Job[] = pipelines.map((p: any) => ({
        name: p.ref || p.sha || String(p.id || ""),
        status: this.mapGitLabPipelineStatusToJobStatus(p.status),
        webUrl: p.web_url || p.webUrl || undefined,
        updatedAt: p.updated_at || p.updatedAt || undefined,
        raw: p,
      }));

      return converted;
    } catch (e) {
      Logger.log(`Unexpected error fetching MR pipelines: ${String(e)}`);
      return [];
    }
  }

  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    if (!this.gitlabClient || !this.gitlabProjectId) {
      return null;
    }
    try {
      const projectId = this.gitlabProjectId;
      // Fetch pipelines for the branch (most recent first)
      let pipelines: any[] = [];
      try {
        // @ts-ignore - method signature may differ across gitbeaker versions
        pipelines = await this.gitlabClient.Pipelines.all(projectId, {
          ref: branchName,
          orderBy: "updated_at",
          sort: "desc",
          perPage: 5,
          maxPages: 1,
        });
        await this.logApiCall("Pipelines.all", {
          caller: "getJobsForBranchLatestCommit",
          ref: branchName,
          perPage: 10,
        });
      } catch (e) {
        Logger.log(
          `Error fetching pipelines for branch ${branchName}: ${String(e)}`,
        );
        return null;
      }

      if (!Array.isArray(pipelines) || pipelines.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Filter out pipelines triggered by merge requests
      // Only keep pipelines triggered by direct commits (source: 'push', 'web', 'api', 'schedule', etc.)
      // Exclude pipelines with source: 'merge_request_event'
      const commitPipelines = pipelines.filter(
        (p) => p.source !== "merge_request_event",
      );

      if (commitPipelines.length === 0) {
        // Fallback: commit statuses (Jenkins, etc.)
        try {
          const commits = await this.gitlabClient!.Commits.all(projectId, {
            refName: branchName,
            perPage: 1,
          });
          await this.logApiCall("Commits.all", {
            caller: "getJobsForBranchLatestCommit",
            action: "getLatestCommitSha",
          });
          const latestCommitSha = (commits as any[])[0]?.id;
          if (!latestCommitSha) {
            return { jobs: [], jobsStatus: "unknown" };
          }
          // @ts-ignore - Commits.allStatuses is part of gitbeaker but may be missing from some type versions
          const statuses: any[] =
            (await this.gitlabClient!.Commits.allStatuses(
              projectId,
              String(latestCommitSha),
            )) || [];
          await this.logApiCall("Commits.allStatuses", {
            caller: "getJobsForBranchLatestCommit",
            sha: latestCommitSha,
          });
          const statusJobs = this.mapGitLabCommitStatusesToJobs(statuses);
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

      // Use the most recent commit-triggered pipeline
      const pipeline = commitPipelines[0];
      const converted: Job[] = [
        {
          name: pipeline.ref || pipeline.sha || String(pipeline.id || ""),
          status: this.mapGitLabPipelineStatusToJobStatus(pipeline.status),
          webUrl: pipeline.web_url || pipeline.webUrl || undefined,
          updatedAt: pipeline.updated_at || pipeline.updatedAt || undefined,
          raw: pipeline,
        },
      ];

      return { jobs: converted, jobsStatus: this.computeJobsStatus(converted) };
    } catch (e) {
      Logger.log(`Unexpected error fetching branch pipelines: ${String(e)}`);
      return null;
    }
  }

  private mapGitLabPipelineStatusToJobStatus(status: string): JobStatus {
    switch ((status || "").toLowerCase()) {
      case "success":
        return "success";
      case "failed":
      case "canceled":
        return "failed";
      case "running":
        return "running";
      case "pending":
      case "created":
      case "waiting_for_resource":
      case "preparing":
      case "scheduled":
        return "pending";
      default:
        return "unknown";
    }
  }

  // Map GitLab commit statuses (Jenkins, etc.) to Job[].
  // Deduplicates by name, keeping the latest entry per context name.
  private mapGitLabCommitStatusesToJobs(statuses: any[]): Job[] {
    const latestByName = new Map<string, any>();
    for (const s of statuses) {
      const key = s.name || "external-ci";
      const existing = latestByName.get(key);
      const existingTime = existing
        ? new Date(existing.finished_at || existing.created_at || 0)
        : new Date(0);
      const sTime = new Date(s.finished_at || s.created_at || 0);
      if (sTime > existingTime) {
        latestByName.set(key, s);
      }
    }
    return Array.from(latestByName.values()).map((s: any) => ({
      name: s.name || "external-ci",
      status: this.mapGitLabPipelineStatusToJobStatus(s.status),
      webUrl: s.target_url || undefined,
      updatedAt: s.finished_at || s.created_at || undefined,
      raw: s,
    }));
  }

  convertToPullRequest(mr: any): PullRequest {
    return {
      id: mr.id,
      number: mr.iid,
      title: mr.title,
      description: String(mr.description),
      state: (mr.state === "opened"
        ? "open"
        : mr.state === "merged"
          ? "merged"
          : mr.state === "closed"
            ? "closed"
            : mr.state) as PullRequest["state"],
      webUrl: String(mr.web_url),
      authorLabel: mr.author?.username || mr.author?.name || "unknown",
      sourceBranch: String(mr.source_branch),
      targetBranch: String(mr.target_branch),
      mergeDate: mr.merged_at || undefined,
      createdAt: mr.created_at || undefined,
      updatedAt: mr.updated_at || undefined,
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
    // GitLab: https://gitlab.com/owner/repo/-/merge_requests/new?merge_request[source_branch]=source&merge_request[target_branch]=target&merge_request[title]=MAJOR:%20sourceBranch%20to%20targetBranch
    const title = `MAJOR: ${sourceBranch} to ${targetBranch}`;
    return `${this.repoInfo.webUrl}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(sourceBranch)}&merge_request[target_branch]=${encodeURIComponent(targetBranch)}&merge_request[title]=${encodeURIComponent(title)}`;
  }
}
