import * as vscode from "vscode";
import { Octokit } from "@octokit/rest";
import { ProviderDescription } from "./types";
import { GitProviderGitHub } from "./gitProviderGitHub";
import { SecretsManager } from "../secretsManager";
import { Logger } from "../../logger";

export class GitProviderGitea extends GitProviderGitHub {
  secretTokenIdentifier: string = "";

  handlesNativeGitAuth(): boolean {
    return false;
  }

  async disconnect(): Promise<void> {
    // Gitea uses PAT tokens stored in secrets, not VS Code embedded auth
    // Delete the stored token
    if (this.secretTokenIdentifier) {
      try {
        await SecretsManager.deleteSecret(this.secretTokenIdentifier);
      } catch {
        // Ignore if secret doesn't exist
      }
    } else if (this.repoInfo?.host) {
      // Fallback if secretTokenIdentifier wasn't set
      const hostKey = this.repoInfo.host.replace(/\./g, "_").toUpperCase();
      try {
        await SecretsManager.deleteSecret(`${hostKey}_TOKEN`);
      } catch {
        // Ignore if secret doesn't exist
      }
    }

    this.gitHubClient = null;
    this.isActive = false;
    Logger.log(
      `Disconnected from Gitea (${this.repoInfo?.host || "unknown host"})`,
    );
    await super.disconnect();
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

  async authenticate(): Promise<boolean | null> {
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
    return null;
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
