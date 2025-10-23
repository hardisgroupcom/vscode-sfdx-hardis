import * as vscode from "vscode";
import { PipelineDataProvider } from "../pipeline-data-provider";
import { Logger } from "../logger";
import { GitProvider } from "../utils/gitProviders/gitProvider";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";
import { PullRequest } from "../utils/gitProviders/types";
import { TicketProvider } from "../utils/ticketProviders/ticketProvider";

export function registerShowPipeline(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showPipeline",
    async () => {
      let pipelineProperties = await loadAllPipelineInfo({
        browseGitProvider: false,
        resetGit: false,
        withProgress: true,
      });
      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline",
        {
          ...pipelineProperties,
          firstDisplay: true,
        },
      );

      panel.sendMessage({
        type: "imageResources",
        data: {
          images: {
            git: panel.asWebviewUri(["icons", "git.svg"]),
            ticket: panel.asWebviewUri(["icons", "ticket.svg"]),
            github: panel.asWebviewUri(["icons", "github.svg"]),
            gitlab: panel.asWebviewUri(["icons", "gitlab.svg"]),
            bitbucket: panel.asWebviewUri(["icons", "bitbucket.svg"]),
            azure: panel.asWebviewUri(["icons", "azure.svg"]),
            gitea: panel.asWebviewUri(["icons", "gitea.svg"]),
            jira: panel.asWebviewUri(["icons", "jira.svg"]),
            azureboards: panel.asWebviewUri(["icons", "azureboards.svg"]),
          },
        },
      });

      panel.updateTitle("DevOps Pipeline");

      panel.onMessage(async (type, data) => {
        // Refresh
        if (type === "refreshPipeline") {
          pipelineProperties = await loadAllPipelineInfo({
            browseGitProvider: true,
            resetGit: false,
            withProgress: false,
          });
          panel.sendInitializationData(pipelineProperties);
        }
        // Update panel title
        else if (type === "updatePanelTitle") {
          panel.updateTitle(data.title);
        }
        // Open Package XML Panel
        else if (type === "showPackageXml") {
          // Handle package XML display requests from pipeline
          await showPackageXmlPanel(data);
        }
        // Update VS Code configuration
        else if (type === "updateVsCodeSfdxHardisConfiguration") {
          const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
          await config.update(
            data.configKey,
            data.value,
            vscode.ConfigurationTarget.Global,
          );
          Logger.log(
            `Updated configuration: ${data.configKey} = ${data.value}`,
          );
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
          let authRes: boolean | null = false;
          try {
            authRes = await gitProvider.authenticate();
          } catch (e) {
            vscode.window
              .showErrorMessage(
                "Error during Git provider authentication. Please check the logs for details.",
                "View logs",
              )
              .then((action) => {
                if (action === "View logs") {
                  Logger.showOutputChannel();
                }
              });
            Logger.log(
              `Error during Git provider authentication: ${String(e)}`,
            );
            return;
          }
          if (authRes === true) {
            vscode.window.showInformationMessage(
              "Successfully connected to Git provider.",
            );
            pipelineProperties = await loadAllPipelineInfo({
              browseGitProvider: true,
              resetGit: true,
              withProgress: true,
            });
            panel.sendInitializationData(pipelineProperties);
          } else if (authRes === false) {
            vscode.window
              .showErrorMessage(
                "Failed to connect to Git provider. Please check the logs for details.",
                "View logs",
              )
              .then((action) => {
                if (action === "View logs") {
                  Logger.showOutputChannel();
                }
              });
          }
        } else if (type === "connectToTicketing") {
          const ticketProvider = await TicketProvider.getInstance({
            reset: true,
            authenticate: true,
          });
          if (!ticketProvider) {
            vscode.window
              .showErrorMessage(
                "No supported Ticketing provider detected in the current project. You can define one in Pipeline Settings",
                "Pipeline Settings",
              )
              .then((action) => {
                if (action === "Pipeline Settings") {
                  vscode.commands.executeCommand(
                    "vscode-sfdx-hardis.showPipelineConfig",
                    null,
                    "Ticketing",
                  );
                }
              });
            return;
          }
          if (!ticketProvider.isAuthenticated) {
            vscode.window
              .showErrorMessage(
                `Failed to connect to ${ticketProvider.providerName}. Please check the logs for details.`,
                "View logs",
              )
              .then((action) => {
                if (action === "View logs") {
                  Logger.showOutputChannel();
                }
              });
            return;
          }
          vscode.window.showInformationMessage(
            `Successfully connected to ${ticketProvider.providerName}.`,
          );
          pipelineProperties = await loadAllPipelineInfo({
            browseGitProvider: true,
            resetGit: false,
            withProgress: true,
          });
          panel.sendInitializationData(pipelineProperties);
        }
      });
    },
  );
  commands.disposables.push(disposable);

  async function loadAllPipelineInfo(options: {
    browseGitProvider: boolean;
    resetGit: boolean;
    withProgress?: boolean;
  }): Promise<{
    pipelineData: any;
    gitAuthenticated: boolean;
    ticketAuthenticated?: boolean;
    ticketProviderName?: string;
    prButtonInfo: any;
    openPullRequests: PullRequest[];
    repoPlatformLabel: string;
    displayFeatureBranches: boolean;
  }> {
    const withProgress = options?.withProgress ?? true;

    const loadData = async () => {
      const browseGitProvider = options?.browseGitProvider ?? true;
      const resetGit = options?.resetGit ?? false;
      const gitProvider = await GitProvider.getInstance(resetGit);
      let openPullRequests: PullRequest[] = [];
      let gitAuthenticated = false;
      if (gitProvider?.isActive) {
        gitAuthenticated = true;
        if (browseGitProvider) {
          openPullRequests = await gitProvider.listOpenPullRequests();
        }
      }
      const pipelineDataProvider = new PipelineDataProvider();
      const pipelineData = await pipelineDataProvider.getPipelineData(
        gitAuthenticated,
        {
          openPullRequests: openPullRequests,
          browseGitProvider: browseGitProvider,
        },
      );
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

      // Read displayFeatureBranches configuration
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      const displayFeatureBranches =
        config.get<boolean>("pipelineDisplayFeatureBranches") ?? false;

      const ticketProvider = await TicketProvider.getInstance({
        reset: false,
        authenticate: false,
      });
      let ticketAuthenticated = false;
      let ticketProviderName = "";
      if (ticketProvider) {
        ticketProviderName = ticketProvider.providerName || "";
      }
      if (ticketProvider?.isAuthenticated) {
        ticketAuthenticated = true;
      }

      return {
        pipelineData: pipelineData,
        prButtonInfo: prButtonInfo,
        gitAuthenticated: gitAuthenticated,
        ticketAuthenticated: ticketAuthenticated,
        ticketProviderName: ticketProviderName,
        openPullRequests: openPullRequests,
        repoPlatformLabel: repoPlatformLabel,
        displayFeatureBranches: displayFeatureBranches,
      };
    };

    if (withProgress) {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading pipeline information...",
          cancellable: false,
        },
        loadData,
      );
    } else {
      return await loadData();
    }
  }
}
