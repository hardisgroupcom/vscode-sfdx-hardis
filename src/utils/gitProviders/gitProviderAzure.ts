import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { ProviderDescription, PullRequest } from "./types";
import * as azdev from 'azure-devops-node-api';
import { GitApi } from 'azure-devops-node-api/GitApi';
import { PullRequestStatus } from "azure-devops-node-api/interfaces/GitInterfaces";

export class GitProviderAzure extends GitProvider {

    connection: azdev.WebApi | null = null;
    gitApi: GitApi | null = null;

    describeGitProvider(): ProviderDescription {
        return {
            providerLabel: "Azure DevOps",
            pullRequestLabel: 'Pull Request',
            pullRequestsWebUrl: this.repoInfo?.webUrl ? `${this.repoInfo.webUrl}/pullrequests` : '',
        };
    }

    handlesNativeGitAuth(): boolean {
        return true;
    }

    async authenticate(): Promise<boolean> {
        const session = await vscode.authentication.getSession("microsoft", ["vso.code"], { forceNewSession: true });
        if (session.accessToken) {
            await this.initialize();
            return this.isActive;
        }
        return false;
    }

    async initialize() {
        // Get an Azure DevOps auth session. Request code scope to read repositories.
        const session = await vscode.authentication.getSession("microsoft", ["vso.code"], { createIfNone: false });
        if (!session || !this.repoInfo) {
            return;
        }

        // Create a connection using the personal access token from the session
        // azure-devops-node-api expects a token as Basic auth with empty username
        const orgUrl = this.buildOrganizationUrl();
        if (!orgUrl) {
            return;
        }

        const authHandler = azdev.getPersonalAccessTokenHandler(session.accessToken);
        this.connection = new azdev.WebApi(orgUrl, authHandler);
        try {
            this.gitApi = await this.connection.getGitApi();
            // Validate token by requesting repository info (lightweight)
            if (this.repoInfo) {
                await this.gitApi.getRepository(this.repoInfo.repo, this.repoInfo.owner);
            }
            this.isActive = true;
        }
        catch {
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

        if (host.includes('dev.azure')) {
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
            const prSearch = await this.gitApi.getPullRequests(repoIdOrName, { status: PullRequestStatus.Active }, project);
            const converted: PullRequest[] = (prSearch || []).map(pr => this.convertToPullRequest(pr,''));
            return converted;
        }
        catch {
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
            const prSearch = await this.gitApi.getPullRequests(repoIdOrName, { sourceRefName: `refs/heads/${branchName}` }, project);
            const converted: PullRequest[] = (prSearch || []).map(pr => this.convertToPullRequest(pr,branchName));
            return converted;
        }
        catch {
            return [];
        }
    }

    convertToPullRequest(pr: any,branchName: string): PullRequest {
        return {
                id: pr.pullRequestId || (pr as any).id,
                number: pr.pullRequestId || (pr as any).id,
                title: pr.title || '',
                description: pr.description || '',
                state: ((pr.status || '') as string).toLowerCase() as PullRequest['state'],
                webUrl: pr._links?.web?.href || pr.url || '',
                sourceBranch: pr.sourceRefName ? pr.sourceRefName.replace(/^refs\/heads\//, '') : branchName,
                targetBranch: pr.targetRefName ? pr.targetRefName.replace(/^refs\/heads\//, '') : ''
            }
    }


}
