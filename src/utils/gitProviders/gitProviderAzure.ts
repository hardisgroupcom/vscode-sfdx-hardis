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
      
      // Get builds triggered by this specific pull request
      // For PR builds, Azure DevOps uses refs/pull/{prId}/merge as the source branch
      // Use reasonFilter to only get PR-triggered builds
      const builds = await buildApi.getBuilds(
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
        20, // top: limit results
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        undefined, // queryOrder
        pr.number ? `refs/pull/${pr.number}/merge` : undefined, // branchName: PR merge ref
      );

      // Filter builds that match this specific PR
      const matchingBuilds = (builds || []).filter((b: any) => {
        // Check if build was triggered by this PR
        const buildPrId = b.triggerInfo?.['pr.number'] || b.triggerInfo?.pullRequestId;
        if (buildPrId && pr.number) {
          return String(buildPrId) === String(pr.number);
        }
        
        // Fallback: match by commit ID
        const commitId = rawPr.lastMergeSourceCommit?.commitId;
        if (commitId && b.sourceVersion) {
          return b.sourceVersion.toLowerCase() === commitId.toLowerCase();
        }
        
        return false;
      });

      if (matchingBuilds.length === 0) {
        Logger.log(`No builds found for PR #${pr.number}`);
        return [];
      }

      // Return the most recent build
      const build = matchingBuilds[0];
      return [{
        name: build.definition?.name || String(build.id || ""),
        status: this.mapAzureBuildStatus(build),
        webUrl: build._links?.web?.href,
        updatedAt: (build.finishTime || build.queueTime)?.toISOString(),
        raw: build,
      }];
    } 
    catch(e: any) {
      Logger.log(`Error fetching jobs for PR #${pr.number}: ${e?.message || String(e)}`);
      return [];
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
      if (result === 2) { // Succeeded
        return "success";
      }
      if (result === 4) { // PartiallySucceeded
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
        status: this.mapAzureBuildStatus(build),
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
      jobsStatus: "unknown",
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
      if (pr.mergeStatus === "succeeded" as any) {
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
    if (!this.repoInfo?.webUrl || !this.repoInfo?.owner || !this.repoInfo?.repo) {
      return null;
    }
    // Azure DevOps: https://dev.azure.com/org/project/_git/repo/pullrequestcreate?sourceRef=source&targetRef=target
    return `${this.repoInfo.webUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(sourceBranch)}&targetRef=${encodeURIComponent(targetBranch)}`;
  }
}
