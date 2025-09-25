import simpleGit from "simple-git";
import type { ProviderDescription, ProviderName, PullRequest, RepoInfo } from "./types";
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
        // Accept nested group paths (e.g. group/subgroup/.../repo.git) and both HTTPS and SSH forms
        // Examples:
        //   https://gitlab.company.com/group/subgroup/repo.git
        //   git@gitlab.company.com:group/subgroup/repo.git
        //   https://dev.azure.company.com/org/project/_git/repo
        let host: string;
        let owner: string;
        let repo: string;

        // First try Azure DevOps specific pattern (handles _git path)
        const azureMatch = remoteUrl.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/_git\/([^/]+)(?:\.git)?$/);
        if (azureMatch) {
            // url: https://host/org/project/_git/repo
            host = azureMatch[1];
            owner = azureMatch[2];
            repo = azureMatch[4];
        } else {
            // Generic pattern: capture host and the full path after host
            const genericMatch = remoteUrl.match(/^(?:https:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?$/);
            if (!genericMatch) {
            return null;
            }
            host = genericMatch[1];
            const fullPath = genericMatch[2];
            const parts = fullPath.split('/').filter(Boolean);
            if (parts.length < 2) {
            return null;
            }
            repo = parts.pop() as string;
            owner = parts.join('/');
        }
        let providerName: ProviderName | null = null;
        const hostLower = host.toLowerCase();
        // Robust checks for common provider indicators (handles on-prem domains like gitlab.company.com)
        if (/(^|\.)gitlab(\.|$)/i.test(hostLower) || hostLower.includes('gitlab')) {
            providerName = 'gitlab';
        } else if (/(^|\.)github(\.|$)/i.test(hostLower) || hostLower.includes('github')) {
            providerName = 'github';
        } else if (hostLower.includes('dev.azure') || hostLower.includes('visualstudio') || hostLower.includes('azure')) {
            providerName = 'azure';
        } else if (/(^|\.)bitbucket(\.|$)/i.test(hostLower) || hostLower.includes('bitbucket')) {
            providerName = 'bitbucket';
        }
        if (!providerName) {
            Logger.log(`detectRepoInfo: unable to map provider for host=${host} remoteUrl=${remoteUrl} owner=${owner} repo=${repo}`);
            return null;
        }

        // Compute webUrl for repo homepage
        let webUrl = '';
        switch (providerName) {
                case 'github': {
                // https://github.com/owner/repo
                webUrl = `https://${host}/${owner}/${repo}`;
                break;
            }
            case 'gitlab': {
                // https://gitlab.company.com/group/subgroup/repo
                webUrl = `https://${host}/${owner}/${repo}`;
                break;
            }
            case 'bitbucket': {
                // https://bitbucket.org/owner/repo
                webUrl = `https://${host}/${owner}/${repo}`;
                break;
            }
            case 'azure': {
                // Azure DevOps: https://dev.azure.com/org/project/_git/repo
                // But homepage is usually https://dev.azure.com/org/project/_git/repo
                webUrl = `https://${host}/${owner}/${azureMatch ? azureMatch[3] + '/_git/' + repo : '_git/' + repo}`;
                break;
            }
            default: {
                webUrl = remoteUrl.replace(/\.git$/, '').replace(/^git@/, 'https://').replace(':', '/');
            }
        }
        return { providerName, host, owner, repo, remoteUrl, webUrl };
    }

    describeGitProvider(): ProviderDescription {
        Logger.log(`describeGitProvider not implemented on ${this.repoInfo?.providerName || 'unknown provider'}`);
        return {
            providerLabel: "",
            pullRequestLabel: ',',
            pullRequestsWebUrl: ''
        };
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

