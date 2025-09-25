import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Gitlab } from "@gitbeaker/rest";
import { ProviderDescription, PullRequest } from "./types";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";

export class GitProviderGitlab extends GitProvider {

    gitlabClient: InstanceType<typeof Gitlab> | null = null;
    gitlabProjectPath: string | null = null;
    gitlabProjectId: number | null = null;
    secretTokenIdentifier: string = '';

    async authenticate(): Promise<boolean> {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Gitlab PAT (Personal Access Token)',
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

    describeGitProvider(): ProviderDescription {
        return {
            providerLabel: "GitLab",
            pullRequestLabel: 'Merge Request',
            pullRequestsWebUrl: this.repoInfo?.webUrl ? `${this.repoInfo.webUrl}/-/merge_requests` : '',
        };
    }

    async initialize() {
        // Check if we have info to connect to Gitlab using Gitbeaker
        this.isActive = false;
        this.secretTokenIdentifier = this.hostKey + '_TOKEN';
        const gitlabToken = await SecretsManager.getSecret(this.secretTokenIdentifier);
        if (gitlabToken && this.repoInfo?.host && this.repoInfo?.remoteUrl) {
            const host = this.repoInfo.host === 'gitlab.com' ? 'https://gitlab.com' : `https://${this.repoInfo.host}`;
            this.gitlabClient = new Gitlab({
                host: host ,
                token: gitlabToken
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
            }
            else if (httpsMatch && httpsMatch[1]) {
                this.gitlabProjectPath = httpsMatch[1];
            }
            else {
                this.gitlabProjectPath = null;
            }
            if (this.gitlabProjectPath) {
                try {
                    // validate token by calling the user endpoint first
                    const currentUser = await this.gitlabClient.Users.showCurrentUser();
                    if (currentUser && currentUser.id) {
                        // Find related project Id
                        const project = await this.gitlabClient.Projects.show(this.gitlabProjectPath);
                        if (project && project.id) {
                            this.gitlabProjectId = project.id;
                            this.isActive = true;
                        }
                        else {
                            Logger.log(`Could not find Gitlab project for path: ${this.gitlabProjectPath}`);
                        }
                    }
                    else {
                        Logger.log(`Gitlab authentication failed: could not fetch current user with provided token.`);
                    }
                } catch (err) {
                    Logger.log(`Gitlab access check failed: ${String(err)}`);
                }
            }
            else {
                Logger.log(`Could not extract GitLab project path from remote URL: ${this.repoInfo.remoteUrl}`);
            }
        }
    }

    getNameForPullRequest(): string {
        return 'Merge Request';
    }

    async listOpenPullRequests(): Promise<PullRequest[]> {
        if (!this.gitlabClient || !this.gitlabProjectId) {
            return [];
        }
        const mergeRequests = await this.gitlabClient!.MergeRequests.all({
            projectId: this.gitlabProjectId!,
            state: 'opened',
        });
        const pullRequestsConverted: PullRequest[] = mergeRequests.map(mr => this.convertToPullRequest(mr));
        return pullRequestsConverted;
    }

    async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
        const mergeRequests = await this.gitlabClient!.MergeRequests.all({
            projectId: this.gitlabProjectId!,
            targetBranch: branchName,
        });
        const pullRequestsConverted: PullRequest[] = mergeRequests.map(mr => this.convertToPullRequest(mr));
        return pullRequestsConverted;
    }

    convertToPullRequest(mr: any): PullRequest {
        return {
            id: mr.id,
            number: mr.iid,
            title: mr.title,
            description: String(mr.description),
            state: (
                mr.state === 'opened'
                ? 'open'
                : mr.state === 'merged'
                ? 'merged'
                : mr.state === 'closed'
                ? 'closed'
                : mr.state) as PullRequest["state"],
            webUrl: String(mr.web_url),
            sourceBranch: String(mr.source_branch),
            targetBranch: String(mr.target_branch),
        };
    }

}