import * as fs from "fs";
import { GitProvider } from "./gitProvider";
import type {
  CreateTokenOption,
  GoLive,
  Job,
  JobStatus,
  ProviderDescription,
  PullRequest,
} from "./types";

/**
 * Mock git provider used exclusively by the UI integration tests and the
 * documentation screenshot harness (yarn test:ui / yarn screenshots).
 *
 * It is only instantiated when BOTH conditions are met (see
 * GitProvider.buildInstance):
 *  - VSCODE_SFDX_HARDIS_UI_TEST === "true" (extension launched by the harness)
 *  - SFDX_HARDIS_MOCK_GIT_PROVIDER_FILE points to a JSON fixture
 *
 * The fixture provides everything a real provider would fetch from its API:
 * repository info, open pull requests (with CI jobs), merged pull requests
 * per branch and go-lives. This is what lets the DevOps Pipeline panel show
 * feature branches, PR chips and running jobs in the documentation
 * screenshots, where outbound HTTP is blocked.
 */
export class GitProviderMock extends GitProvider {
  private fixture: any = {};

  static async buildFromFixtureFile(
    fixtureFile: string,
  ): Promise<GitProviderMock> {
    const provider = new GitProviderMock();
    provider.fixture = JSON.parse(
      await fs.promises.readFile(fixtureFile, "utf8"),
    );
    provider.repoInfo = provider.fixture.repoInfo || null;
    provider.hostKey = (provider.repoInfo?.host || "mock")
      .replace(/\./g, "_")
      .toUpperCase();
    await provider.initialize();
    return provider;
  }

  async initialize(): Promise<void> {
    this.isActive = true;
  }

  handlesNativeGitAuth(): boolean {
    return true;
  }

  async authenticate(): Promise<boolean | null> {
    return true;
  }

  describeGitProvider(): ProviderDescription {
    return (
      this.fixture.providerDescription || {
        providerLabel: "GitHub",
        pullRequestLabel: "Pull Request",
        pullRequestsWebUrl: `${this.repoInfo?.webUrl || ""}/pulls`,
      }
    );
  }

  getCreateTokenOptions(): CreateTokenOption[] {
    return [];
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    return this.fixture.openPullRequests || [];
  }

  async getActivePullRequestFromBranch(
    branchName: string,
  ): Promise<PullRequest | null> {
    return (
      (this.fixture.openPullRequests || []).find(
        (pullRequest: PullRequest) => pullRequest.sourceBranch === branchName,
      ) || null
    );
  }

  async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string,
    _targetBranchName: string,
    _childBranchesNames: string[],
  ): Promise<PullRequest[]> {
    const byBranch = this.fixture.mergedPullRequestsByBranch || {};
    return byBranch[currentBranchName] || [];
  }

  async getJobsForBranchLatestCommit(
    branchName: string,
  ): Promise<{ jobs: Job[]; jobsStatus: JobStatus } | null> {
    const byBranch = this.fixture.branchJobs || {};
    return byBranch[branchName] || null;
  }

  async getBranchLatestCommitId(
    branchName: string,
  ): Promise<string | undefined> {
    const byBranch = this.fixture.branchTips || {};
    return byBranch[branchName];
  }

  async fetchGoLives(_branchName: string): Promise<GoLive[]> {
    return this.fixture.goLives || [];
  }

  async listPullRequestsInGoLive(
    _branchName: string,
    _childBranchesNames: string[],
    goLiveId: string,
  ): Promise<PullRequest[]> {
    const byGoLive = this.fixture.pullRequestsByGoLive || {};
    return byGoLive[goLiveId] || [];
  }

  getCreatePullRequestUrl(
    sourceBranch: string,
    targetBranch: string,
  ): string | null {
    const webUrl = this.repoInfo?.webUrl || "";
    return `${webUrl}/compare/${targetBranch}...${sourceBranch}`;
  }
}
