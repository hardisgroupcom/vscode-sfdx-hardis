import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { ProviderDescription, PullRequest, PullRequestJob } from "./types";
import * as azdev from "azure-devops-node-api";
import { GitApi } from "azure-devops-node-api/GitApi";
import { PullRequestStatus, GitPullRequest } from "azure-devops-node-api/interfaces/GitInterfaces";
import { Logger } from "../../logger";

export class GitProviderAzure extends GitProvider {
  connection: azdev.WebApi | null = null;
  gitApi: GitApi | null = null;

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "Azure DevOps",
      pullRequestLabel: "Pull Request",
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pullrequests`
        : "",
    };
  }

  handlesNativeGitAuth(): boolean {
    return true;
  }

  async authenticate(): Promise<boolean|null> {
    const session = await vscode.authentication.getSession(
      "microsoft",
      ["vso.code"],
      { forceNewSession: true },
    );
    if (session.accessToken) {
      await this.initialize();
      return this.isActive;
    }
    return false;
  }

  async initialize() {
    // Get an Azure DevOps auth session. Request code scope to read repositories.
    const session = await vscode.authentication.getSession(
      "microsoft",
      ["vso.code"],
      { createIfNone: false },
    );
    if (!session || !this.repoInfo) {
      return;
    }

    // Create a connection using the personal access token from the session
    // azure-devops-node-api expects a token as Basic auth with empty username
    const orgUrl = this.buildOrganizationUrl();
    if (!orgUrl) {
      return;
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(
      session.accessToken,
    );
    this.connection = new azdev.WebApi(orgUrl, authHandler);
    try {
      this.gitApi = await this.connection.getGitApi();
      // Validate token by requesting repository info (lightweight)
      if (this.repoInfo) {
        await this.gitApi.getRepository(
          this.repoInfo.repo,
          this.repoInfo.owner,
        );
      }
      this.isActive = true;
    } catch {
      // keep inactive on error
      this.gitApi = null;
      this.isActive = false;
    }
  }

  private buildOrganizationUrl(): string | null {
    // Typical hosted URL: https://dev.azure.com/{organization}
    // If repoInfo.host contains dev.azure.com, we use that format.
    if (!this.repoInfo) {
      return null;
    }
    const host = this.repoInfo.host;
    const organization = this.repoInfo.owner;

    if (host.includes("dev.azure")) {
      return `https://${host}/${organization}`;
    }

    // For on-premise Azure DevOps Server, remoteUrl may include collection/project — fall back to host root
    return `https://${host}`;
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    if (!this.repoInfo || !this.gitApi) {
      return [];
    }
    const repoIdOrName = this.repoInfo.repo;
    const project = this.repoInfo.owner; // best-effort: owner treated as project/organization
    try {
      const prSearch = await this.gitApi.getPullRequests(
        repoIdOrName,
        { status: PullRequestStatus.Active },
        project,
      );
      return await this.convertAndCollectJobsList(prSearch || [], "");
    } catch {
      return [];
    }
  }

  async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
    if (!this.repoInfo || !this.gitApi) {
      return [];
    }

    const repoIdOrName = this.repoInfo.repo;
    const project = this.repoInfo.owner; // best-effort: owner treated as project/organization

    try {
      const prSearch = await this.gitApi.getPullRequests(
        repoIdOrName,
        { sourceRefName: `refs/heads/${branchName}` },
        project,
      );
      return await this.convertAndCollectJobsList(prSearch || [], branchName);
    } catch {
      return [];
    }
  }

  // Fetch latest build(s) for Azure DevOps PR. Best-effort: try to match by commitId or branch.
  private async fetchLatestJobsForPullRequestAzure(rawPr: GitPullRequest, pr: PullRequest): Promise<PullRequestJob[]> {
    if (!this.connection || !this.repoInfo) {
      return [];
    }
    try {
      const buildApi = await this.connection.getBuildApi();
      const project = this.repoInfo.owner;
      // Prefer commitId if available
      const commitId = rawPr.lastMergeSourceCommit?.commitId || rawPr.lastMergeSourceCommit?.commitId;
      let builds: any[] = [];
      try {
        // Get recent builds and filter by sourceVersion or branch
        const recent = await buildApi.getBuilds(project, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 20);
        builds = (recent || []).filter((b: any) => {
          if (commitId && b.sourceVersion) {
            return String(b.sourceVersion).toLowerCase() === String(commitId).toLowerCase();
          }
          if (pr.sourceBranch && b.sourceBranch) {
            return b.sourceBranch.endsWith(pr.sourceBranch);
          }
          return false;
        });
      } catch {
        // ignore
      }
      if (!builds || builds.length === 0) {
        return [];
      }
      const build = builds[0];
      // Map the build to a PullRequestJob
      const job: PullRequestJob = {
        name: build.definition?.name || String(build.id || ""),
        status: (build.status || build.result || "").toString(),
        webUrl: build._links?.web?.href || undefined,
        updatedAt: build.finishTime || build.queueTime || undefined,
        raw: build,
      };
      return [job];
    } catch {
      return [];
    }
  }

  // Helper to convert raw Azure PR and attach jobs/jobsStatus
  // Batch helper: convert an array of raw Azure PRs and enrich each with jobs
  private async convertAndCollectJobsList(rawPrs: GitPullRequest[], branchName: string): Promise<PullRequest[]> {
    if (!rawPrs || rawPrs.length === 0) {
      return [];
    }
    const converted: PullRequest[] = await Promise.all(
      rawPrs.map(async (r) => {
        const convertedPr = this.convertToPullRequest(r, branchName);
        try {
          const jobs = await this.fetchLatestJobsForPullRequestAzure(r, convertedPr);
          convertedPr.jobs = jobs;
          convertedPr.jobsStatus = this.computeJobsStatus(jobs);
        } catch (e) {
          Logger.log(`Error fetching jobs for PR #${convertedPr.number}: ${String(e)}`);
        }
        return convertedPr;
      }),
    );
    return converted;
  }

  convertToPullRequest(pr: any, branchName: string): PullRequest {
    return {
      id: pr.pullRequestId || (pr as any).id,
      number: pr.pullRequestId || (pr as any).id,
      title: pr.title || "",
      description: pr.description || "",
      state: (
        (pr.status || "") as string
      ).toLowerCase() as PullRequest["state"],
      authorLabel:
        pr.createdBy?.displayName || pr.createdBy?.uniqueName || "unknown",
      webUrl: pr._links?.web?.href || pr.url || "",
      sourceBranch: pr.sourceRefName
        ? pr.sourceRefName.replace(/^refs\/heads\//, "")
        : branchName,
      targetBranch: pr.targetRefName
        ? pr.targetRefName.replace(/^refs\/heads\//, "")
        : "",
      jobsStatus: "unknown",
    };
  }
}
