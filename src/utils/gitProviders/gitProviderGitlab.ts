import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Gitlab } from "@gitbeaker/rest";
import { PullRequest } from "./types";
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

    async initialize() {
        // Check if we have info to connect to Gitlab using Gitbeaker
        this.isActive = false;
        this.secretTokenIdentifier = this.hostKey + '_TOKEN';
        const gitlabToken = await SecretsManager.getSecret(this.secretTokenIdentifier);
        if (gitlabToken && this.repoInfo?.host && this.repoInfo?.remoteUrl) {
            const host = this.repoInfo.host === 'gitlab.com' ? 'https://gitlab.com' : `https://${this.repoInfo.host}`;
            this.gitlabClient = new Gitlab({
                host: host,
                token: gitlabToken
            });
            // Extract project Id from current git remote url
            const projectPathMatch = this.repoInfo.remoteUrl.match(new RegExp('[:/]([^/:]+/[^/]+)(\\.git)?$'));
            const projectPath = projectPathMatch ? projectPathMatch[1] : null;
            if (projectPath) {
                try {
                    // validate token by calling the user endpoint first
                    const currentUser = await this.gitlabClient.Users.showCurrentUser();
                    if (currentUser && currentUser.id) {
                        this.gitlabProjectPath = projectPath.replace(/\.git$/, '');
                        // Find related project Id
                        const project = await this.gitlabClient.Projects.show(encodeURIComponent(this.gitlabProjectPath));
                        if (project && project.id) {
                            this.gitlabProjectId = project.id;
                            this.isActive = true;
                        }
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

    async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
        const mergeRequests = await this.gitlabClient!.MergeRequests.all({
            projectId: this.gitlabProjectId!,
            targetBranch: branchName,
        });
        const pullRequestsConverted: PullRequest[] = mergeRequests.map(mr => ({
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
        }));
        return pullRequestsConverted;
    }

}