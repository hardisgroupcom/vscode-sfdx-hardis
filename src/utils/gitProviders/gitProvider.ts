import { SecretsManager } from "../secretsManager";

import simpleGit from "simple-git";
import { Gitlab } from "@gitbeaker/rest";
import type { PullRequest } from "./types";

export class GitProvider {

    static instance: GitProvider;

    static async getInstance(): Promise<GitProvider> {
        if (!this.instance) {
            this.instance = new GitProvider();
            await this.instance.initialize();
        }
        return this.instance;
    }

    isActive: boolean = false;
    gitlabClient: InstanceType<typeof Gitlab> | null = null;
    gitlabProjectId: string | null = null;

    async initialize() {
        // Check if we have info to connect to Gitlab using Gitbeaker
        const gitlabToken = await SecretsManager.getSecret("GITLAB_TOKEN");
        const git = simpleGit();
        const remotes = await git.getRemotes(true);
        if (remotes.length === 0) {
            return;
        }
        const remoteUrl = remotes[0].refs.fetch;
        if (gitlabToken && remoteUrl) {
            this.gitlabClient = new Gitlab({
                host: remoteUrl,
                token: gitlabToken
            });
            // Extract project Id from current git remote url
            const projectPathMatch = remoteUrl.match(new RegExp('[:/]([^/:]+/[^/]+)(\\.git)?$'));
            const projectPath = projectPathMatch ? projectPathMatch[1] : null;
            if (projectPath) {
                const projects = await this.gitlabClient.Projects.search(projectPath);
                if (projects.length > 0) {
                    this.gitlabProjectId = projects[0].id.toString();
                    this.isActive = true;
                }
            }
        }
    }

    static async listPullRequestsForBranch(branchName: string): Promise<PullRequest[]> {
        const instance = await this.getInstance();
        if (!instance.isActive) {
            return [];
        }
        const mergeRequests = await instance.gitlabClient!.MergeRequests.all({
            projectId: instance.gitlabProjectId!,
            targetBranch: branchName,
        });
        return mergeRequests;
    }
}

