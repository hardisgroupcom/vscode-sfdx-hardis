import simpleGit from "simple-git";
import type {
  ProviderDescription,
  ProviderName,
  PullRequest,
  Job,
  RepoInfo,
  JobStatus,
} from "./types";
import { getWorkspaceRoot } from "../../utils";
import { Logger } from "../../logger";
import { SecretsManager } from "../secretsManager";
import { TicketProvider } from "../ticketProviders/ticketProvider";
import { Ticket } from "../ticketProviders/types";
import { listPrePostCommandsForPullRequest } from "../prePostCommandsUtils";

export class GitProvider {
  static instance: GitProvider;

  isActive: boolean = false;
  repoInfo: RepoInfo | null = null;
  hostKey: string = "";

  static async getInstance(reset = false): Promise<GitProvider | null> {
    if (!this.instance || reset === true) {
      const gitInfo = await GitProvider.detectRepoInfo();
      if (!gitInfo) {
        return null;
      }
      switch (gitInfo.providerName) {
        case "gitlab":
          this.instance = new (
            await import("./gitProviderGitlab")
          ).GitProviderGitlab();
          break;
        case "github":
          this.instance = new (
            await import("./gitProviderGitHub")
          ).GitProviderGitHub();
          break;
        case "azure":
          this.instance = new (
            await import("./gitProviderAzure")
          ).GitProviderAzure();
          break;
        case "bitbucket":
          this.instance = new (
            await import("./gitProviderBitbucket")
          ).GitProviderBitbucket();
          break;
        default:
          return null;
      }
      this.instance.repoInfo = gitInfo;
      Logger.log(
        `Detected git provider: ${gitInfo.providerName} (${gitInfo.host}), repo: ${gitInfo.owner}/${gitInfo.repo}`,
      );
      this.instance.hostKey = gitInfo.host.replace(/\./g, "_").toUpperCase();
      await this.instance.initialize();
    }
    return this.instance;
  }

  static async detectRepoInfo(): Promise<RepoInfo | null> {
    const git = simpleGit(getWorkspaceRoot());
    const remotes = await git.getRemotes(true);
    if (remotes.length === 0) {
      return null;
    }
    const remoteUrl = remotes[0].refs.fetch;
    // Match GitLab, GitHub, Azure DevOps, Bitbucket remote URLs
    // Accept nested group paths (e.g. group/subgroup/.../repo.git) and both HTTPS and SSH forms
    // Examples:
    //   https://gitlab.company.com/group/subgroup/repo.git
    //   git@gitlab.company.com:group/subgroup/repo.git
    //   https://dev.azure.company.com/org/project/_git/repo
    let host: string;
    let owner: string;
    let repo: string;

    // First try Azure DevOps specific pattern (handles _git path)
    // Match: https://[username@]host/org/project/_git/repo
    const azureMatch = remoteUrl.match(
      /^https:\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/([^/]+)\/_git\/([^/]+)(?:\.git)?$/,
    );
    if (azureMatch) {
      // url: https://[username@]host/org/project/_git/repo
      // For Azure DevOps, we need the project name for API calls
      // Store: host (without username), project (as owner since API expects project), repo
      host = azureMatch[1]; // host without username
      owner = decodeURIComponent(azureMatch[3]); // project name (API expects this, decode URL encoding)
      repo = decodeURIComponent(azureMatch[4]);
    } else {
      // Generic pattern: capture host and the full path after host
      // Also handle optional username: https://[username@]host or git@host
      const genericMatch = remoteUrl.match(
        /^(?:https:\/\/(?:[^@]+@)?|git@)([^/:]+)[/:](.+?)(?:\.git)?$/,
      );
      if (!genericMatch) {
        return null;
      }
      host = genericMatch[1]; // host without username
      const fullPath = genericMatch[2];
      const parts = fullPath.split("/").filter(Boolean);
      if (parts.length < 2) {
        return null;
      }
      repo = decodeURIComponent(parts.pop() as string);
      owner = decodeURIComponent(parts.join("/"));
    }
    let providerName: ProviderName | null = null;
    const hostLower = host.toLowerCase();
    // Robust checks for common provider indicators (handles on-prem domains like gitlab.company.com)
    if (/(^|\.)gitlab(\.|$)/i.test(hostLower) || hostLower.includes("gitlab")) {
      providerName = "gitlab";
    } else if (
      /(^|\.)github(\.|$)/i.test(hostLower) ||
      hostLower.includes("github")
    ) {
      providerName = "github";
    } else if (
      hostLower.includes("dev.azure") ||
      hostLower.includes("visualstudio") ||
      hostLower.includes("azure")
    ) {
      providerName = "azure";
    } else if (
      /(^|\.)bitbucket(\.|$)/i.test(hostLower) ||
      hostLower.includes("bitbucket")
    ) {
      providerName = "bitbucket";
    }
    if (!providerName) {
      Logger.log(
        `detectRepoInfo: unable to map provider for host=${host} remoteUrl=${remoteUrl} owner=${owner} repo=${repo}`,
      );
      return null;
    }

    // Compute webUrl for repo homepage
    let webUrl = "";
    switch (providerName) {
      case "github": {
        // https://github.com/owner/repo
        webUrl = `https://${host}/${owner}/${repo}`;
        break;
      }
      case "gitlab": {
        // https://gitlab.company.com/group/subgroup/repo
        webUrl = `https://${host}/${owner}/${repo}`;
        break;
      }
      case "bitbucket": {
        // https://bitbucket.org/owner/repo
        webUrl = `https://${host}/${owner}/${repo}`;
        break;
      }
      case "azure": {
        // Azure DevOps: https://dev.azure.com/org/project/_git/repo
        // webUrl needs both organization and project
        if (azureMatch) {
          const organization = decodeURIComponent(azureMatch[2]);
          const project = decodeURIComponent(azureMatch[3]);
          const repoName = decodeURIComponent(azureMatch[4]);
          webUrl = `https://${host}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoName)}`;
        } else {
          webUrl = `https://${host}/${encodeURIComponent(owner)}/_git/${encodeURIComponent(repo)}`;
        }
        break;
      }
      default: {
        webUrl = remoteUrl
          .replace(/\.git$/, "")
          .replace(/^git@/, "https://")
          .replace(":", "/");
      }
    }
    return { providerName, host, owner, repo, remoteUrl, webUrl };
  }

  describeGitProvider(): ProviderDescription {
    Logger.log(
      `describeGitProvider not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
    return {
      providerLabel: "",
      pullRequestLabel: ",",
      pullRequestsWebUrl: "",
    };
  }

  async authenticate(): Promise<boolean | null> {
    Logger.log(
      `authenticate not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
    return false;
  }

  async initialize() {
    Logger.log(
      `initialize not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
  }

  async getJobsForBranchLatestCommit(
    _branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    Logger.log(
      `getJobsForBranch not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
    return null;
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    Logger.log(
      `listOpenPullRequests not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
    return [];
  }

  async getActivePullRequestFromBranch(
    _branchName: string,
  ): Promise<PullRequest | null> {
    Logger.log(
      `getActivePullRequestFromBranch not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
    return null;
  }

  async listPullRequestsInBranchSinceLastMerge(
    _currentBranchName: string,
    _targetBranchName: string,
    _childBranchesNames: string[],
  ): Promise<PullRequest[]> {
    Logger.log(
      `listPullRequestsInBranchSinceLastMerge not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
    return [];
  }

  handlesNativeGitAuth(): boolean {
    return false;
  }

  async completePullRequestsWithTickets(
    _pullRequests: PullRequest[],
    options: { fetchDetails: boolean } = { fetchDetails: false },
  ): Promise<PullRequest[]> {
    const ticketProvider = await TicketProvider.getInstance({
      reset: false,
      authenticate: false,
    });
    if (!ticketProvider) {
      return _pullRequests;
    }
    for (const pr of _pullRequests) {
      const allpullRequestRelatedStrings = [
        pr.title,
        pr.description,
        pr.sourceBranch,
      ];
      const concatenated = allpullRequestRelatedStrings
        .filter(Boolean)
        .join("\n");
      const tickets: Ticket[] =
        await ticketProvider.getTicketsFromString(concatenated);
      pr.relatedTickets = tickets;
    }
    if (options.fetchDetails && ticketProvider.isAuthenticated) {
      // Make unique list of tickets from all PRs
      const uniqueTicketsMap: Map<string, Ticket> = new Map();
      for (const pr of _pullRequests) {
        if (pr.relatedTickets) {
          for (const ticket of pr.relatedTickets) {
            if (!uniqueTicketsMap.has(ticket.id)) {
              uniqueTicketsMap.set(ticket.id, ticket);
            }
          }
        }
      }
      // Fetch details for each unique ticket
      const uniqueTickets = Array.from(uniqueTicketsMap.values());
      const detailedResults = await Promise.all(
        uniqueTickets.map(async (t) => {
          try {
            const updated = await ticketProvider.completeTicketDetails(t);
            return updated ?? t;
          } catch (err: any) {
            Logger.log(
              `completeTicketDetails failed for ticket=${t.id}: ${err?.message || err}`,
            );
            return t;
          }
        }),
      );
      for (const ticket of detailedResults) {
        uniqueTicketsMap.set(ticket.id, ticket);
      }
      // Update details back to PRs
      for (const pr of _pullRequests) {
        if (pr.relatedTickets) {
          pr.relatedTickets = pr.relatedTickets.map(
            (t) => uniqueTicketsMap.get(t.id) || t,
          );
        }
      }
    }
    return _pullRequests;
  }

  async completePullRequestsWithPrePostCommands(
    pullRequests: PullRequest[],
  ): Promise<PullRequest[]> {
    for (const pr of pullRequests) {
      const prePostCommands = await listPrePostCommandsForPullRequest(pr);
      pr.deploymentActions = prePostCommands;
    }
    return pullRequests;
  }

  /**
   * Compute aggregated jobs status from a list of jobs. Priority order:
   * - if any job.status === 'running' => 'running'
   * - else if any job.status === 'failed' => 'failed'
   * - else if any job.status === 'pending' => 'pending'
   * - else if all jobs are 'success' => 'success'
   * - else => 'unknown'
   */
  computeJobsStatus(
    jobs?: Job[],
  ): "running" | "pending" | "success" | "failed" | "unknown" {
    if (!jobs || jobs.length === 0) {
      return "unknown";
    }
    let hasFailed = false;
    let hasPending = false;
    let allSuccess = true;
    for (const j of jobs) {
      const s = (j && j.status) || "";
      const st = String(s).toLowerCase();
      if (st === "running") {
        return "running";
      }
      if (st === "failed" || st === "failure" || st === "error") {
        hasFailed = true;
        allSuccess = false;
      } else if (st === "pending") {
        hasPending = true;
        allSuccess = false;
      } else if (st === "success" || st === "passed" || st === "ok") {
        // keep allSuccess true unless other flags set
      } else {
        // unknown status
        allSuccess = false;
      }
    }
    if (hasFailed) {
      return "failed";
    }
    if (hasPending) {
      return "pending";
    }
    if (allSuccess) {
      return "success";
    }
    return "unknown";
  }

  async storeSecretToken(token: string): Promise<void> {
    if (!this.isActive || this.handlesNativeGitAuth()) {
      return;
    }
    const secretIdentifier = this.hostKey + "_TOKEN";
    await SecretsManager.setSecret(secretIdentifier, token);
  }

  /**
   * Generate a URL to create a new pull/merge request from source to target branch.
   * @param sourceBranch The source branch name
   * @param targetBranch The target branch name
   * @returns The URL to create a PR, or null if not supported
   */
  getCreatePullRequestUrl(
    _sourceBranch: string,
    _targetBranch: string,
  ): string | null {
    Logger.log(
      `getCreatePullRequestUrl not implemented on ${this.repoInfo?.providerName || "unknown provider"}`,
    );
    return null;
  }
}
