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
      // Show progress while loading config editor input
      const pipelineData = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading pipeline information...",
          cancellable: false,
        },
        async () => {
          const pipelineDataProvider = new PipelineDataProvider();
          return await pipelineDataProvider.getPipelineData();
        },
      );

      let authenticated = false;
      let openPullRequests: PullRequest[] = [];
      const gitProvider = await GitProvider.getInstance();
      if (gitProvider?.isActive) {
        authenticated = true;
      }

      const prButtonInfo : any = {};
      if (gitProvider?.isActive && gitProvider.repoInfo) {
        const desc = gitProvider.describeGitProvider();
        prButtonInfo.url = desc.pullRequestsWebUrl;
        prButtonInfo.label = `View ${desc.pullRequestLabel}s on ${desc.providerLabel}`;
        prButtonInfo.icon = gitProvider.repoInfo.providerName ;
      } else {
        prButtonInfo.url = '';
        prButtonInfo.label = 'View Pull Requests';
        prButtonInfo.icon = '';
      }

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline",
        { pipelineData: pipelineData, prButtonInfo, gitAuthenticated: authenticated, openPullRequests: openPullRequests },
      );
      panel.updateTitle("DevOps Pipeline");

      panel.onMessage(async (type, data) => {
        // Refresh
        if (type === "refreshPipeline") {
          let authenticated = false;
          const gitProvider = await GitProvider.getInstance();
          if (gitProvider?.isActive) {
            authenticated = true;
          }
          const provider = new PipelineDataProvider();
          const newData = await provider.getPipelineData();
          panel.sendInitializationData({
            pipelineData: newData,
            prButtonInfo,
            gitAuthenticated: authenticated,
          });
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
            vscode.window.showErrorMessage("No supported Git provider detected in the current repository.");
            return;
          }
          Logger.log(`Authenticating to Git provider: ${gitProvider.repoInfo?.providerName} at ${gitProvider.repoInfo?.host}`);
          let authRes = false;
          try {
            authRes = await gitProvider.authenticate();
          } catch (e) {
            vscode.window.showErrorMessage("Error during Git provider authentication. Please check the logs for details.");
            Logger.log(`Error during Git provider authentication: ${String(e)}`);
            return;
          }
          if (authRes === true) {
            vscode.window.showInformationMessage("Successfully connected to Git provider.");
            panel.sendInitializationData({
              pipelineData,
              prButtonInfo,
              gitAuthenticated: true,
            });
          } else if (authRes === false) {
            vscode.window.showErrorMessage("Failed to connect to Git provider. Please check the logs for details.");
          }
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
