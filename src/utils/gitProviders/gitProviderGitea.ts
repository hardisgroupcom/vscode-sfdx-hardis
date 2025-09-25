import * as vscode from "vscode";
import { Octokit } from "@octokit/rest";
import { ProviderDescription } from "./types";
import { GitProviderGitHub } from "./gitProviderGitHub";
import { SecretsManager } from "../secretsManager";

export class GitProviderGitea extends GitProviderGitHub {
  secretTokenIdentifier: string = "";

  handlesNativeGitAuth(): boolean {
    return false;
  }

  describeGitProvider(): ProviderDescription {
    return {
      providerLabel: "Gitea",
      pullRequestLabel: "Pull Request",
      pullRequestsWebUrl: this.repoInfo?.webUrl
        ? `${this.repoInfo.webUrl}/pulls`
        : "",
    };
  }

  async authenticate(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      prompt: "Enter your Gitea PAT (Personal Access Token)",
      ignoreFocusOut: true,
      password: true,
    });
    if (token) {
      await SecretsManager.setSecret(this.secretTokenIdentifier, token);
      await this.initialize();
      return this.isActive;
    }
    return false;
  }

  async initialize() {
    this.secretTokenIdentifier = this.hostKey + "_TOKEN";
    const giteaToken = await SecretsManager.getSecret(
      this.secretTokenIdentifier,
    );
    if (!giteaToken || !this.repoInfo?.host || !this.repoInfo.remoteUrl) {
      return;
    }
    try {
      this.gitHubClient = new Octokit({
        auth: giteaToken,
        baseUrl: (this.repoInfo.host = `https://${this.repoInfo.host}/api/v3`),
      });
      // validate token by calling GET /user
      await this.gitHubClient.request("GET /user");
      this.isActive = true;
    } catch {
      this.gitHubClient = null;
      this.isActive = false;
    }
  }
}
