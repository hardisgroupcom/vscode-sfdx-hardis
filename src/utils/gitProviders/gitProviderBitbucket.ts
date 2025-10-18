import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Bitbucket } from "bitbucket";
import type { Schema } from "bitbucket";
import { ProviderDescription, PullRequest, Job, JobStatus } from "./types";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";

export class GitProviderBitbucket extends GitProvider {
  bitbucketClient: InstanceType<typeof Bitbucket> | null = null;
  workspace: string | null = null;
  repoSlug: string | null = null;
  secretTokenIdentifier: string = "";

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "Bitbucket",
      pullRequestLabel: "Pull Request",
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pull-requests`
        : "",
    };
  }

  async authenticate(): Promise<boolean | null> {
    const token = await vscode.window.showInputBox({
      prompt: "Enter your Bitbucket Token",
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

  async initialize() {
    // Use a secret token stored in SecretsManager similar to GitLab provider
    this.secretTokenIdentifier = this.hostKey + "_TOKEN";
    const token = await SecretsManager.getSecret(this.secretTokenIdentifier);
    if (token && this.repoInfo?.host && this.repoInfo.remoteUrl) {
      this.bitbucketClient = new Bitbucket({
        auth: {
          // Bitbucket accepts username/password or app passwords; use token in password with empty username
          token: token,
        },
      } as any);

      // Extract workspace and repo slug from remote URL (common formats)
      // Examples:
      // git@bitbucket.org:workspace/repo.git
      // https://bitbucket.org/workspace/repo.git
      const match = this.repoInfo.remoteUrl.match(
        new RegExp("[:/]([^/:]+/[^/]+)(.git)?$"),
      );
      const projectPath = match ? match[1] : null;
      if (projectPath) {
        const parts = projectPath.split("/");
        this.workspace = parts[0];
        this.repoSlug = parts[1];
        // validate token by requesting repository info
        try {
          await this.bitbucketClient.repositories.get({
            workspace: this.workspace,
            repo_slug: this.repoSlug,
          } as any);
          this.isActive = true;
        } catch (err) {
          Logger.log(
            `Bitbucket repository access check failed: ${String(err)}`,
          );
          this.isActive = false;
        }
      } else {
        Logger.log(
          `Could not extract Bitbucket workspace/repo from remote URL: ${this.repoInfo.remoteUrl}`,
        );
        this.isActive = false;
      }
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
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      return await this.convertAndCollectJobsList(values);
    } catch (err) {
      Logger.log(`Error fetching Bitbucket pull requests: ${String(err)}`);
      return [];
    }
  }

  async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return [];
    }
    try {
      // Bitbucket Cloud API: GET /repositories/{workspace}/{repo_slug}/pullrequests?q=source.branch.name="branchName"
      const response = await this.bitbucketClient.pullrequests.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q: `source.branch.name = "${branchName}"`,
      } as any);

      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      return await this.convertAndCollectJobsList(values);
    } catch (err) {
      Logger.log(`Error fetching Bitbucket pull requests: ${String(err)}`);
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
      mergeDate: (pr.state === "MERGED" && pr.updated_on) ? pr.updated_on : undefined,
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
    // Bitbucket: https://bitbucket.org/owner/repo/pull-requests/new?source=source&dest=target
    return `${this.repoInfo.webUrl}/pull-requests/new?source=${encodeURIComponent(sourceBranch)}&dest=${encodeURIComponent(targetBranch)}`;
  }

  // Fetch pipelines for a Bitbucket PR (Bitbucket Cloud). Best-effort: query pipelines by commit/branch
  private async fetchLatestJobsForPrBitbucket(
    rawPr: any,
    pr: PullRequest,
  ): Promise<Job[]> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return [];
    }
    try {
      // Try to find the commit hash
      const commit =
        rawPr && rawPr.source && rawPr.source.commit
          ? rawPr.source.commit.hash
          : undefined;
      // Query pipelines endpoint: GET /repositories/{workspace}/{repo_slug}/pipelines/?sort=-created_on&q=target.ref_name="branch"
      const q = commit
        ? `target.commit.hash = "${commit}"`
        : `target.ref_name = "${pr.sourceBranch}"`;
      const response = await this.bitbucketClient.pipelines.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q,
        sort: "-created_on",
      } as any);
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      if (!values || values.length === 0) {
        return [];
      }
      const pipeline = values[0];
      // Map pipeline steps to PullRequestJob if available
      const p: any = pipeline as any;
      const converted: Job[] = [
        {
          name: String((p && p.target && p.target.ref_name) || p.id || ""),
          status: String(
            (p &&
              p.state &&
              ((p.state.result && p.state.result.name) || p.state.name)) ||
              "",
          ) as Job["status"],
          webUrl:
            String(
              (p && p.links && p.links.html && p.links.html.href) || undefined,
            ) || undefined,
          updatedAt:
            String((p && (p.updated_on || p.created_on)) || undefined) ||
            undefined,
          raw: p,
        },
      ];
      return converted;
    } catch {
      return [];
    }
  }

  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    if (!this.bitbucketClient || !this.workspace || !this.repoSlug) {
      return null;
    }
    try {
      // Query pipelines for the branch
      const response = await this.bitbucketClient.pipelines.list({
        workspace: this.workspace,
        repo_slug: this.repoSlug,
        q: `target.ref_name = "${branchName}"`,
        sort: "-created_on",
      } as any);
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      if (!values || values.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Filter out pipelines triggered by pull requests
      // Only keep pipelines triggered by direct commits (trigger type: 'PUSH', 'MANUAL', 'SCHEDULE', etc.)
      // Exclude pipelines with trigger type: 'PULL_REQUEST'
      const commitPipelines = values.filter(
        (p: any) => p.trigger?.type !== "PULL_REQUEST",
      );

      if (commitPipelines.length === 0) {
        return { jobs: [], jobsStatus: "unknown" };
      }

      // Use the most recent commit-triggered pipeline
      const pipeline = commitPipelines[0];
      const p: any = pipeline as any;
      const job: Job = {
        name: String((p && p.target && p.target.ref_name) || p.id || ""),
        status: String(
          (p &&
            p.state &&
            ((p.state.result && p.state.result.name) || p.state.name)) ||
            "",
        ) as JobStatus,
        webUrl:
          String(
            (p && p.links && p.links.html && p.links.html.href) || undefined,
          ) || undefined,
        updatedAt:
          String((p && (p.updated_on || p.created_on)) || undefined) ||
          undefined,
        raw: p,
      };
      return { jobs: [job], jobsStatus: this.computeJobsStatus([job]) };
    } catch (e) {
      Logger.log(`Error fetching jobs for branch ${branchName}: ${String(e)}`);
      return null;
    }
  }

  // Helper to convert raw Bitbucket PR and attach jobs/jobsStatus
  // Batch helper: convert an array of raw Bitbucket PRs and enrich each with jobs
  private async convertAndCollectJobsList(
    rawPrs: Schema.PaginatedPullrequests["values"],
  ): Promise<PullRequest[]> {
    if (!rawPrs || rawPrs.length === 0) {
      return [];
    }
    const converted: PullRequest[] = await Promise.all(
      rawPrs.map(async (r) => {
        const conv = this.convertToPullRequest(r);
        try {
          const jobs = await this.fetchLatestJobsForPrBitbucket(r, conv);
          conv.jobs = jobs;
          conv.jobsStatus = this.computeJobsStatus(jobs);
        } catch (e) {
          Logger.log(
            `Error fetching jobs for PR #${conv.number}: ${String(e)}`,
          );
        }
        return conv;
      }),
    );
    return converted;
  }
}
