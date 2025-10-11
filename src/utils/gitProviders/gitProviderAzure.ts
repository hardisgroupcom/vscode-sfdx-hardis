import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { ProviderDescription, PullRequest, Job, JobStatus } from "./types";
import * as azdev from "azure-devops-node-api";
import { GitApi } from "azure-devops-node-api/GitApi";
import {
  PullRequestStatus,
  GitPullRequest,
} from "azure-devops-node-api/interfaces/GitInterfaces";
import { Logger } from "../../logger";
import { SecretsManager } from "../secretsManager";

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
  private static readonly AZURE_DEVOPS_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';
  
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

  async authenticate(): Promise<boolean | null> {
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Use Microsoft Account (OAuth)', value: 'oauth' },
        { label: 'Use Personal Access Token (PAT)', value: 'pat' }
      ],
      {
        placeHolder: 'How would you like to authenticate to Azure DevOps?',
        ignoreFocusOut: true
      }
    );

    if (!choice) {
      return null;
    }

    if (choice.value === 'pat') {
      return await this.authenticateWithPAT();
    }
    
    return await this.authenticateWithOAuth();
  }

  private async authenticateWithPAT(): Promise<boolean | null> {
    const orgUrl = this.buildOrganizationUrl();
    const patUrl = orgUrl ? `${orgUrl}/_usersSettings/tokens` : 'https://dev.azure.com/_usersSettings/tokens';
    
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your Azure DevOps Personal Access Token with Code (Read & Write) scope',
      ignoreFocusOut: true,
      password: true,
      placeHolder: `Create a PAT at: ${patUrl}`
    });
    
    if (!token) {
      return null;
    }
    
    await SecretsManager.setSecret(this.hostKey + "_TOKEN", token);
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
    
    await this.initialize();
    return this.isActive;
  }

  async initialize() {
    const pat = await SecretsManager.getSecret(this.hostKey + "_TOKEN");
    const authHandler = pat 
      ? azdev.getPersonalAccessTokenHandler(pat)
      : await this.getOAuthHandler();

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
      
      // Validate token by requesting repository info
      await this.gitApi.getRepository(this.repoInfo.repo, this.repoInfo.owner);
      
      this.isActive = true;
    } 
    catch (e: any) {
      Logger.log(`Azure DevOps authentication failed: ${e?.message || String(e)}`);
      this.gitApi = null;
      this.isActive = false;
    }
  }

  private async getOAuthHandler(): Promise<any | null> {
    const session = await vscode.authentication.getSession(
      "microsoft",
      [GitProviderAzure.AZURE_DEVOPS_SCOPE],
      { createIfNone: false },
    );
    
    return session?.accessToken ? azdev.getBearerHandler(session.accessToken) : null;
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
    return this.listPullRequestsWithCriteria({ status: PullRequestStatus.Active });
  }

  async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
    return this.listPullRequestsWithCriteria(
      { sourceRefName: `refs/heads/${branchName}` },
      branchName
    );
  }

  private async listPullRequestsWithCriteria(
    searchCriteria: any,
    branchName: string = ""
  ): Promise<PullRequest[]> {
    if (!this.repoInfo || !this.gitApi) {
      return [];
    }

    try {
      const prs = await this.gitApi.getPullRequests(
        this.repoInfo.repo,
        searchCriteria,
        this.repoInfo.owner,
      );
      return await this.convertAndEnrichPullRequests(prs || [], branchName);
    } 
    catch {
      return [];
    }
  }

  private async convertAndEnrichPullRequests(
    rawPrs: GitPullRequest[],
    branchName: string,
  ): Promise<PullRequest[]> {
    if (rawPrs.length === 0) {
      return [];
    }

    return await Promise.all(
      rawPrs.map(async (rawPr) => {
        const pr = this.convertToPullRequest(rawPr, branchName);
        try {
          pr.jobs = await this.fetchLatestJobsForPullRequest(rawPr, pr);
          pr.jobsStatus = this.computeJobsStatus(pr.jobs);
        } 
        catch (e) {
          Logger.log(`Error fetching jobs for PR #${pr.number}: ${String(e)}`);
        }
        return pr;
      }),
    );
  }

  private async fetchLatestJobsForPullRequest(
    rawPr: GitPullRequest,
    pr: PullRequest,
  ): Promise<Job[]> {
    if (!this.connection || !this.repoInfo) {
      return [];
    }

    try {
      const buildApi = await this.connection.getBuildApi();
      const commitId = rawPr.lastMergeSourceCommit?.commitId;
      
      const builds = await buildApi.getBuilds(
        this.repoInfo.owner,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        20,
      );

      const matchingBuilds = (builds || []).filter((b: any) => {
        if (commitId && b.sourceVersion) {
          return b.sourceVersion.toLowerCase() === commitId.toLowerCase();
        }
        if (pr.sourceBranch && b.sourceBranch) {
          return b.sourceBranch.endsWith(pr.sourceBranch);
        }
        return false;
      });

      if (matchingBuilds.length === 0) {
        return [];
      }

      const build = matchingBuilds[0];
      return [{
        name: build.definition?.name || String(build.id || ""),
        status: (build.status || build.result || "").toString() as JobStatus,
        webUrl: build._links?.web?.href,
        updatedAt: (build.finishTime || build.queueTime)?.toISOString(),
        raw: build,
      }];
    } 
    catch {
      return [];
    }
  }
  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    if (!this.connection || !this.repoInfo) {
      return null;
    }

    try {
      const buildApi = await this.connection.getBuildApi();
      const builds = await buildApi.getBuilds(
        this.repoInfo.owner,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        10,
      );

      // Filter: branch match + exclude PR-triggered builds
      const commitBuilds = (builds || []).filter(
        (b: any) => 
          b.sourceBranch?.endsWith(branchName) && 
          b.reason !== "pullRequest"
      );

      if (commitBuilds.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      const build = commitBuilds[0];
      const job: Job = {
        name: build.definition?.name || String(build.id || ""),
        status: (build.status || build.result || "").toString() as JobStatus,
        webUrl: build._links?.web?.href,
        updatedAt: (build.finishTime || build.queueTime)?.toISOString(),
        raw: build,
      };
      
      return { jobs: [job], jobsStatus: this.computeJobsStatus([job]) };
    } 
    catch (e) {
      Logger.log(`Error fetching jobs for branch ${branchName}: ${String(e)}`);
      return null;
    }
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

  getCreatePullRequestUrl(
    sourceBranch: string,
    targetBranch: string,
  ): string | null {
    if (!this.repoInfo?.webUrl || !this.repoInfo?.owner || !this.repoInfo?.repo) {
      return null;
    }
    // Azure DevOps: https://dev.azure.com/org/project/_git/repo/pullrequestcreate?sourceRef=source&targetRef=target
    return `${this.repoInfo.webUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(sourceBranch)}&targetRef=${encodeURIComponent(targetBranch)}`;
  }
}
