import * as vscode from "vscode";
import { PipelineDataProvider } from "../pipeline-data-provider";
import { Logger } from "../logger";
import { GitProvider } from "../utils/gitProviders/gitProvider";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";
import { PullRequest } from "../utils/gitProviders/types";

export function registerShowPipeline(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showPipeline",
    async () => {
      let pipelineProperties = await loadAllPipelineInfo();
      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline",
        pipelineProperties,
      );
      panel.updateTitle("DevOps Pipeline");

      panel.onMessage(async (type, data) => {
        // Refresh
        if (type === "refreshPipeline") {
          pipelineProperties = await loadAllPipelineInfo();
          panel.sendInitializationData(pipelineProperties);
        }
        // Open Package XML Panel
        else if (type === "showPackageXml") {
          // Handle package XML display requests from pipeline
          await showPackageXmlPanel(data);
        }
        // Authenticate or re-authenticate to Git provider
        else if (type === "connectToGit") {
          const gitProvider = await GitProvider.getInstance();
          if (!gitProvider) {
            vscode.window.showErrorMessage(
              "No supported Git provider detected in the current repository.",
            );
            return;
          }
          Logger.log(
            `Authenticating to Git provider: ${gitProvider.repoInfo?.providerName} at ${gitProvider.repoInfo?.host}`,
          );
          let authRes: boolean|null = false;
          try {
            authRes = await gitProvider.authenticate();
          } catch (e) {
            vscode.window.showErrorMessage(
              "Error during Git provider authentication. Please check the logs for details.",
            );
            Logger.log(
              `Error during Git provider authentication: ${String(e)}`,
            );
            return;
          }
          if (authRes === true) {
            vscode.window.showInformationMessage(
              "Successfully connected to Git provider.",
            );
            pipelineProperties = await loadAllPipelineInfo();
            panel.sendInitializationData(pipelineProperties);
          } else if (authRes === false) {
            vscode.window.showErrorMessage(
              "Failed to connect to Git provider. Please check the logs for details.",
            );
          }
        }
      });
    },
  );
  commands.disposables.push(disposable);

  async function loadAllPipelineInfo(): Promise<{
    pipelineData: any;
    gitAuthenticated: boolean;
    prButtonInfo: any;
    openPullRequests: PullRequest[];
    repoPlatformLabel: string;
  }> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading pipeline information...",
        cancellable: false,
      },
      async () => {
        const pipelineDataProvider = new PipelineDataProvider();
        const pipelineData = await pipelineDataProvider.getPipelineData();
        const gitProvider = await GitProvider.getInstance();
        let openPullRequests: PullRequest[] = [];
        let gitAuthenticated = false;
        if (gitProvider?.isActive) {
          gitAuthenticated = true;
          openPullRequests = await gitProvider.listOpenPullRequests();
        }
        const prButtonInfo: any = {};
        let repoPlatformLabel = "";
        if (gitProvider?.repoInfo) {
          const desc = gitProvider.describeGitProvider();
          prButtonInfo.url = desc.pullRequestsWebUrl;
          prButtonInfo.label = `View ${desc.pullRequestLabel}s on ${desc.providerLabel}`;
          prButtonInfo.icon = gitProvider.repoInfo.providerName;
          prButtonInfo.pullRequestLabel = desc.pullRequestLabel;
          repoPlatformLabel = desc.providerLabel;
        } else {
          prButtonInfo.url = "";
          prButtonInfo.label = "View Pull Requests";
          prButtonInfo.icon = "";
        }

        return {
          pipelineData: pipelineData,
          prButtonInfo: prButtonInfo,
          gitAuthenticated: gitAuthenticated,
          openPullRequests: openPullRequests,
          repoPlatformLabel: repoPlatformLabel
        };
      },
    );
  }
}
