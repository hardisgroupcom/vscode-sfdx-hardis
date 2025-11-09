import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Gitlab } from "@gitbeaker/rest";
import type {
  MergeRequestSchemaWithBasicLabels,
  Camelize,
} from "@gitbeaker/rest";
import { ProviderDescription, PullRequest, Job, JobStatus } from "./types";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";

export class GitProviderGitlab extends GitProvider {
  gitlabClient: InstanceType<typeof Gitlab> | null = null;
  gitlabProjectPath: string | null = null;
  gitlabProjectId: number | null = null;
  secretTokenIdentifier: string = "";

  async authenticate(): Promise<boolean | null> {
    const token = await vscode.window.showInputBox({
      prompt: "Enter your Gitlab PAT (Personal Access Token)",
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

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "GitLab",
      pullRequestLabel: "Merge Request",
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
        try {
          // validate token by calling the user endpoint first
          const currentUser = await this.gitlabClient.Users.showCurrentUser();
          if (currentUser && currentUser.id) {
            // Find related project Id
            const project = await this.gitlabClient.Projects.show(
              this.gitlabProjectPath,
            );
            if (project && project.id) {
              this.gitlabProjectId = project.id;
              this.isActive = true;
            } else {
              Logger.log(
                `Could not find Gitlab project for path: ${this.gitlabProjectPath}`,
              );
            }
          } else {
            Logger.log(
              `Gitlab authentication failed: could not fetch current user with provided token.`,
            );
          }
        } catch (err) {
          Logger.log(`Gitlab access check failed: ${String(err)}`);
        }
      } else {
        Logger.log(
          `Could not extract GitLab project path from remote URL: ${this.repoInfo.remoteUrl}`,
        );
      }
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
    });
    return await this.convertAndCollectJobsList(mergeRequests);
  }

  async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
    const mergeRequests = await this.gitlabClient!.MergeRequests.all({
      projectId: this.gitlabProjectId!,
      targetBranch: branchName,
    });
    return await this.convertAndCollectJobsList(mergeRequests);
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
        perPage: 1,
      });
      if (!mergeRequests || mergeRequests.length === 0) {
        return null;
      }
      const converted = await this.convertAndCollectJobsList(mergeRequests);
      return converted[0] || null;
    }
    catch (err) {
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

      // Step 3: Get all merged MRs targeting currentBranch and child branches (parallelized)
      const allBranches = [currentBranchName, ...childBranchesNames];

      const mrPromises = allBranches.map(async (branchName) => {
        try {
          const mergedMRs = await this.gitlabClient!.MergeRequests.all({
            projectId: this.gitlabProjectId!,
            targetBranch: branchName,
            state: "merged",
            perPage: 100,
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

      // Step 4: Filter MRs whose merge commit SHA is in our commit list
      const relevantMRs = allMergedMRs.filter((mr) => {
        // Check if the merge commit SHA is in our commits
        const mergeCommitSha = mr.mergeCommitSha || mr.merge_commit_sha;
        if (mergeCommitSha && commitSHAs.has(mergeCommitSha)) {
          return true;
        }

        // Also check if the MR's SHA (last commit before merge) is in our commits
        if (mr.sha && commitSHAs.has(mr.sha)) {
          return true;
        }

        return false;
      });

      // Step 5: Remove duplicates (same MR might be found through different branches)
      const uniqueMRsMap = new Map<number, (typeof relevantMRs)[0]>();
      for (const mr of relevantMRs) {
        if (mr.iid && !uniqueMRsMap.has(mr.iid)) {
          uniqueMRsMap.set(mr.iid, mr);
        }
      }

      const uniqueMRs = Array.from(uniqueMRsMap.values());

      // Step 6: Convert to PullRequest format with jobs
      return await this.convertAndCollectJobsList(uniqueMRs);
    } catch (err) {
      Logger.log(
        `Error in listPullRequestsInBranchSinceLastMerge: ${String(err)}`,
      );
      return [];
    }
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
  ): Promise<PullRequest[]> {
    if (!rawMrs || rawMrs.length === 0) {
      return [];
    }
    const converted: PullRequest[] = await Promise.all(
      rawMrs.map(async (mr) => {
        const pr = this.convertToPullRequest(mr);
        try {
          const jobs = await this.fetchLatestJobsForMergeRequest(mr);
          pr.jobs = jobs;
          pr.jobsStatus = this.computeJobsStatus(jobs);
        } catch (e) {
          Logger.log(`Error fetching jobs for MR !${pr.number}: ${String(e)}`);
        }
        return pr;
      }),
    );
    return converted;
  }

  // Fetch jobs for the latest pipeline related to the merge request.
  // Prefer mr.head_pipeline if available, otherwise try pipelines by SHA or MR pipelines endpoint.
  private async fetchLatestJobsForMergeRequest(
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
        });
      } catch (e) {
        Logger.log(`Error fetching pipelines for MR !${mrIid}: ${String(e)}`);
        return [];
      }

      if (!Array.isArray(pipelines) || pipelines.length === 0) {
        return [];
      }

      const converted: Job[] = pipelines.map((p: any) => {
        return {
          name: p.ref || p.sha || String(p.id || ""),
          status: (p.status || "").toString(),
          webUrl: p.web_url || p.webUrl || undefined,
          updatedAt: p.updated_at || p.updatedAt || undefined,
          raw: p,
        };
      });

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
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Use the most recent commit-triggered pipeline
      const pipeline = commitPipelines[0];
      const converted: Job[] = [
        {
          name: pipeline.ref || pipeline.sha || String(pipeline.id || ""),
          status: (pipeline.status || "").toString() as JobStatus,
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
