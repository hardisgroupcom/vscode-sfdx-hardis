import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Bitbucket } from 'bitbucket';
import { ProviderDescription, PullRequest } from "./types";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";

export class GitProviderBitbucket extends GitProvider {

    bitbucketClient: InstanceType<typeof Bitbucket> | null = null;
    workspace: string | null = null;
    repoSlug: string | null = null;
    secretTokenIdentifier: string = '';

    describeGitProvider(): ProviderDescription {
        return {
            providerLabel: "Bitbucket",
            pullRequestLabel: 'Pull Request',
            pullRequestsWebUrl: this.repoInfo?.webUrl ? `${this.repoInfo.webUrl}/pull-requests` : '',
        };
    }

    async authenticate(): Promise<boolean> {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Bitbucket Token',
            ignoreFocusOut: true,
            password: true
        });
        if (token) {
            await SecretsManager.setSecret(this.secretTokenIdentifier, token);
            await this.initialize();
            return this.isActive;
        }
        return false;
    }

    async initialize() {
        // Use a secret token stored in SecretsManager similar to GitLab provider
        this.secretTokenIdentifier = this.hostKey + '_TOKEN';
        const token = await SecretsManager.getSecret(this.secretTokenIdentifier);
        if (token && this.repoInfo?.host && this.repoInfo.remoteUrl) {
            this.bitbucketClient = new Bitbucket({
                auth: {
                    // Bitbucket accepts username/password or app passwords; use token in password with empty username
                    token: token
                }
            } as any);

            // Extract workspace and repo slug from remote URL (common formats)
            // Examples:
            // git@bitbucket.org:workspace/repo.git
            // https://bitbucket.org/workspace/repo.git
            const match = this.repoInfo.remoteUrl.match(new RegExp('[:/]([^/:]+/[^/]+)(.git)?$'));
            const projectPath = match ? match[1] : null;
            if (projectPath) {
                const parts = projectPath.split('/');
                this.workspace = parts[0];
                this.repoSlug = parts[1];
                // validate token by requesting repository info
                try {
                    await this.bitbucketClient.repositories.get({ workspace: this.workspace, repo_slug: this.repoSlug } as any);
                    this.isActive = true;
                }
                catch (err) {
                    Logger.log(`Bitbucket repository access check failed: ${String(err)}`);
                    this.isActive = false;
                }
            }
            else {
                Logger.log(`Could not extract Bitbucket workspace/repo from remote URL: ${this.repoInfo.remoteUrl}`);
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
                repo_slug: this.repoSlug
            } as any);
            const values = (response && response.data && response.data.values) ? response.data.values : [];
            const converted: PullRequest[] = values.map((pr: any) => this.convertToPullRequest(pr));
            return converted;
        }   catch (err) {
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
                q: `source.branch.name = "${branchName}"`
            } as any);

            const values = (response && response.data && response.data.values) ? response.data.values : [];
            const converted: PullRequest[] = values.map((pr: any) => this.convertToPullRequest(pr));
            return converted;
        }
        catch (err) {
            Logger.log(`Error fetching Bitbucket pull requests: ${String(err)}`);
            return [];
        }
    }

    convertToPullRequest(pr: any): PullRequest {
        return {
                id: pr.id,
                number: pr.id,
                title: pr.title,
                description: pr.description || '',
                state: (pr.state || '').toLowerCase() as PullRequest['state'],
                authorLabel: pr.author?.display_name || pr.author?.username || 'unknown',
                webUrl: pr.links?.html?.href || pr.links?.self?.href || '',
                sourceBranch: pr.source?.branch?.name || '',
                targetBranch: pr.destination?.branch?.name || ''
            }
        }

}
