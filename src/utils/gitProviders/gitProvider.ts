import simpleGit from "simple-git";
import type { ProviderName, PullRequest, RepoInfo } from "./types";
import { getWorkspaceRoot } from "../../utils";
import { Logger } from "../../logger";
import { SecretsManager } from "../secretsManager";

export class GitProvider {

    static instance: GitProvider;

    isActive: boolean = false;
    repoInfo: RepoInfo | null = null;
    hostKey: string = '';

    static async getInstance(): Promise<GitProvider|null> {
        if (!this.instance) {
            const gitInfo = await GitProvider.detectRepoInfo();
            if (!gitInfo) {
                return null;
            }
            switch (gitInfo.providerName) {
                case 'gitlab':
                    this.instance = new (await import('./gitProviderGitlab')).GitProviderGitlab();
                    break;
                case 'github':
                    this.instance = new (await import('./gitProviderGitHub')).GitProviderGitHub();
                    break;
                case 'azure':
                    this.instance = new (await import('./gitProviderAzure')).GitProviderAzure();
                    break;
                case 'bitbucket':
                    this.instance = new (await import('./gitProviderBitbucket')).GitProviderBitbucket();
                    break;
                default:
                    return null;
            }
            this.instance.repoInfo = gitInfo;
            Logger.log(`Detected git provider: ${gitInfo.providerName} (${gitInfo.host}), repo: ${gitInfo.owner}/${gitInfo.repo}`);
            this.instance.hostKey = gitInfo.host.replace(/\./g, '_').toUpperCase();
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
        const urlMatch = remoteUrl.match(new RegExp('^(?:https://|git@)([^/:]+)[/:]([^/]+)/([^/.]+)(\\.git)?$'));
        if (!urlMatch) {
            return null;
        }
        const host = urlMatch[1];
        const owner = urlMatch[2];
        const repo = urlMatch[3];
        let providerName: ProviderName | null = null;
        if (host.includes('gitlab')) {
            providerName = 'gitlab';
        } else if (host.includes('github')) {
            providerName = 'github';
        } else if (host.includes('dev.azure')) {
            providerName = 'azure';
        } else if (host.includes('bitbucket')) {
            providerName = 'bitbucket';
        }
        if (!providerName) {
            return null;
        }
        return { providerName, host, owner, repo, remoteUrl };
    }

    async authenticate(): Promise<boolean> {
        Logger.log(`authenticate not implemented on ${this.repoInfo?.providerName || 'unknown provider'}`);
        return false;
    }

    async initialize() {
        Logger.log(`initialize not implemented on ${this.repoInfo?.providerName || 'unknown provider'}`);
    }

    async listPullRequestsForBranch(_branchName: string): Promise<PullRequest[]> {
        Logger.log(`listPullRequestsForBranch not implemented on ${this.repoInfo?.providerName || 'unknown provider'}`);
        return [];
    }

    handlesNativeGitAuth(): boolean {
        return false;
    }

    async storeSecretToken(token: string): Promise<void> {
        if (!this.isActive || this.handlesNativeGitAuth()){
            return;
        }
        const secretIdentifier = this.hostKey + '_TOKEN';
        await SecretsManager.setSecret(secretIdentifier, token);
    }
}

