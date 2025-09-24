import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Gitlab } from "@gitbeaker/rest";
import { PullRequest } from "./types";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";

export class GitProviderGitlab extends GitProvider {

    gitlabClient: InstanceType<typeof Gitlab> | null = null;
    gitlabProjectId: string | null = null;
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
        this.secretTokenIdentifier = this.hostKey + '_TOKEN';
        const gitlabToken = await SecretsManager.getSecret(this.secretTokenIdentifier);
        if (gitlabToken && this.repoInfo?.host && this.repoInfo.remoteUrl) {
            this.gitlabClient = new Gitlab({
                host: this.repoInfo.host,
                token: gitlabToken
            });
            // Extract project Id from current git remote url
            const projectPathMatch = this.repoInfo.remoteUrl.match(new RegExp('[:/]([^/:]+/[^/]+)(\\.git)?$'));
            const projectPath = projectPathMatch ? projectPathMatch[1] : null;
            if (projectPath) {
                const projects = await this.gitlabClient.Projects.search(projectPath);
                if (projects.length > 0) {
                    this.gitlabProjectId = projects[0].id.toString();
                    // validate token by calling the user endpoint
                    try {
                        // Gitbeaker client should be able to call a simple endpoint; use the Users API if available
                        if (this.gitlabClient && this.gitlabClient.Users && typeof (this.gitlabClient as any).Users.current === 'function') {
                            await (this.gitlabClient as any).Users.current();
                        }
                        this.isActive = true;
                    }
                    catch {
                        this.isActive = false;
                    }
                }
            }
            else {
                Logger.log(`Could not extract GitLab project path from remote URL: ${this.repoInfo.remoteUrl}`);
                this.isActive = false;
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