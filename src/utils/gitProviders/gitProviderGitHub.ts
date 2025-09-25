import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Octokit } from "@octokit/rest";
import { ProviderDescription, PullRequest } from "./types";

export class GitProviderGitHub extends GitProvider {

    gitHubClient: InstanceType<typeof Octokit> | null = null;

    handlesNativeGitAuth(): boolean {
        return true;
    }

    describeGitProvider(): ProviderDescription {
        return {
            providerLabel: "GitHub",
            pullRequestLabel: 'Pull Request',
            pullRequestsWebUrl: this.repoInfo?.webUrl ? `${this.repoInfo.webUrl}/pulls` : '',
        };
    }

    async authenticate(): Promise<boolean> {
        const session = await vscode.authentication.getSession("github", ["repo"], { forceNewSession: true });
        if (session.accessToken) {
            await this.initialize();
            return this.isActive;
        }
        return false;
    }

    async initialize() {
        const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: false });
        if (!session || !this.repoInfo?.host || !this.repoInfo.remoteUrl) {
            return;
        }
        try {
            this.gitHubClient = new Octokit({
                auth: session.accessToken,
                baseUrl: this.repoInfo.host === 'github.com' ? undefined : `https://${this.repoInfo.host}/api/v3`
            });
            // validate token by calling GET /user
            await this.gitHubClient.request('GET /user');
            this.isActive = true;
        }
        catch {
            this.gitHubClient = null;
            this.isActive = false;
        }
    }

    async listOpenPullRequests(): Promise<PullRequest[]> {
        const [owner, repo] = [this.repoInfo!.owner, this.repoInfo!.repo];
        const { data: pullRequests } = await this.gitHubClient!.pulls.list({
            owner,
            repo,
            state: 'open',
            per_page: 10000,
        });
        const pullRequestsConverted: PullRequest[] = pullRequests.map(pr => this.convertToPullRequest(pr));
        return pullRequestsConverted;
    }

    async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
        const [owner, repo] = [this.repoInfo!.owner, this.repoInfo!.repo];
        const { data: pullRequests } = await this.gitHubClient!.pulls.list({
            owner,
            repo,
            base: branchName,
            per_page: 10000,
        });
        const pullRequestsConverted: PullRequest[] = pullRequests.map(pr => this.convertToPullRequest(pr));
        return pullRequestsConverted;
    }

    convertToPullRequest(pr: any): PullRequest {
        return {
            id: pr.id,
            number: pr.number,
            title: pr.title,
            description: pr.body || '',
            state: pr.state as PullRequest["state"],
            authorLabel: pr.user?.login || pr.user?.name || 'unknown',
            webUrl: pr.html_url,
            sourceBranch: pr.head.ref,
            targetBranch: pr.base.ref,
        }
    }

}