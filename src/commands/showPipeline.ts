import * as vscode from "vscode";
import { PipelineDataProvider } from "../pipeline-data-provider";
import { Logger } from "../logger";
import { GitProvider } from "../utils/gitProviders/gitProvider";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";
import { PullRequest } from "../utils/gitProviders/types";
import { TicketProvider } from "../utils/ticketProviders/ticketProvider";
import {
  listProjectApexScripts,
  listProjectDataWorkspaces,
  listProjectApexTestClasses,
  saveDeploymentApexTestClasses,
  savePrePostCommand,
} from "../utils/prePostCommandsUtils";
import { getCurrentGitBranch } from "../utils/pipeline/sfdxHardisConfig";
import { getWorkspaceRoot, readSfdxHardisConfig } from "../utils";
import path from "path";
import fs from "fs-extra";

export function registerShowPipeline(commands: Commands) {
  let loadInProgress: Promise<PipelineInfo> | null = null;

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

      function showCommitReminder(prNumber: number, msg: string) {
        if (prNumber === -1) {
          vscode.window.showInformationMessage(msg);
        } else {
          vscode.window
            .showInformationMessage(msg, "Open Git")
            .then((action) => {
              if (action === "Open Git") {
                vscode.commands.executeCommand("workbench.view.scm");
              }
            });
        }
      }

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
        // Show Metadata Retriever panel from pipeline quick action
        else if (type === "showMetadataRetriever") {
          try {
            await vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showMetadataRetriever",
            );
          } catch (e) {
            Logger.log(
              `Error executing showMetadataRetriever command: ${String(e)}`,
            );
          }
        }
        // Save Deployment Action
        else if (type === "saveDeploymentAction") {
          // call savePrePostCommand to save the command
          const updatedFile = await savePrePostCommand(
            data.prNumber,
            data.command,
          );
          Logger.log(
            `Saved deployment action for PR #${data.prNumber}: ${JSON.stringify(
              data.command,
            )}`,
          );
          const prLabel =
            pipelineProperties?.prButtonInfo?.pullRequestLabel ||
            "Pull Request";
          const msg =
            data.prNumber === -1
              ? `Deployment action saved in draft file for the future ${prLabel}.\nIt will be linked to the ${prLabel} once created.`
              : `Deployment action saved for ${prLabel} #${data.prNumber}.\nDon't forget to commit and push ${updatedFile}`;
          showCommitReminder(data.prNumber, msg);
        }
        // Save Deployment Apex Test Classes
        else if (type === "saveDeploymentApexTestClasses") {
          const updatedFile = await saveDeploymentApexTestClasses(
            data.prNumber,
            data.deploymentApexTestClasses,
          );
          Logger.log(
            `Saved deployment apex test classes for PR #${data.prNumber}: ${JSON.stringify(
              data.deploymentApexTestClasses,
            )}`,
          );
          const prLabel =
            pipelineProperties?.prButtonInfo?.pullRequestLabel ||
            "Pull Request";
          const msg =
            data.prNumber === -1
              ? `Apex tests configuration saved in draft file for the future ${prLabel}.\nIt will be linked to the ${prLabel} once created.`
              : `Apex tests configuration saved for ${prLabel} #${data.prNumber}.\nDon't forget to commit and push ${updatedFile}`;
          showCommitReminder(data.prNumber, msg);
        }
        // Get PR info for modal
        else if (type === "getPrInfoForModal") {
          const gitProvider = await GitProvider.getInstance();
          if (!gitProvider) {
            Logger.log("No Git provider available for getPrInfoForModal");
            return;
          }
          try {
            // Get full PR details with tickets and deployment actions
            let prList = [{ ...data.pullRequest }];
            prList =
              await gitProvider.completePullRequestsWithPrePostCommands(prList);
            prList = await gitProvider.completePullRequestsWithTickets(prList, {
              fetchDetails: true,
            });
            const prDetails = prList[0];
            if (prDetails) {
              panel.sendMessage({
                type: "returnGetPrInfoForModal",
                data: prDetails,
              });
            }
          } catch (e) {
            const prLabel =
              pipelineProperties?.prButtonInfo?.pullRequestLabel ||
              "Pull Request";
            Logger.log(`Error getting ${prLabel} info for modal: ${String(e)}`);
            vscode.window.showErrorMessage(
              `Error getting ${prLabel} info. Please check the logs for details.`,
            );
          }
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
        // Prompt user for Git provider action when already connected
        else if (type === "promptGitProviderAction") {
          const providerName = data?.providerName || "Git";
          const actions = ["Open Remote Repository", "Disconnect"];
          const choice = await vscode.window.showInformationMessage(
            `You are connected to ${providerName}. What would you like to do?`,
            { modal: true },
            ...actions,
          );
          if (choice === "Open Remote Repository") {
            const gitProvider = await GitProvider.getInstance();
            const repoUrl = gitProvider?.repoInfo?.webUrl || "";
            if (!repoUrl) {
              vscode.window.showWarningMessage(
                `No web URL found for the remote repository on ${providerName}.`,
              );
              return;
            }
            vscode.env.openExternal(vscode.Uri.parse(repoUrl));
          } else if (choice === "Disconnect") {
            const gitProvider = await GitProvider.getInstance();
            if (gitProvider) {
              await gitProvider.disconnect();
              vscode.window.showInformationMessage(
                `Disconnected from ${providerName}.`,
              );
              // Refresh pipeline with unauthenticated state
              pipelineProperties = await loadAllPipelineInfo({
                browseGitProvider: false,
                resetGit: true,
                withProgress: true,
              });
              panel.sendInitializationData(pipelineProperties);
            }
          }
        }
        // Prompt user for Ticketing provider action when already connected
        else if (type === "promptTicketProviderAction") {
          const providerName = data?.providerName || "Ticketing";

          const choice = await vscode.window.showInformationMessage(
            `You are connected to ${providerName}. What would you like to do?`,
            { modal: true },
            `Open ${providerName}`,
            "Disconnect",
          );
          if (choice === `Open ${providerName}`) {
            const ticketProvider = await TicketProvider.getInstance({
              reset: false,
              authenticate: false,
            });
            if (!ticketProvider) {
              vscode.window.showWarningMessage(
                `Unable to find active ticketing provider connection.`,
              );
              return;
            }
            const ticketingUrl = await ticketProvider.getTicketingWebUrl();
            if (!ticketingUrl) {
              vscode.window.showWarningMessage(
                `No web URL found for the ticketing provider ${providerName}.`,
              );
              return;
            }
            vscode.env.openExternal(vscode.Uri.parse(ticketingUrl));
          } else if (choice === "Disconnect") {
            const ticketProvider = await TicketProvider.getInstance({
              reset: false,
              authenticate: false,
            });

            if (ticketProvider) {
              await ticketProvider.disconnect();
              vscode.window.showInformationMessage(
                `Disconnected from ${providerName}.`,
              );
            } else {
              vscode.window.showWarningMessage(
                `Unable to find active ticketing provider connection.`,
              );
            }

            // Refresh pipeline with unauthenticated ticketing state
            pipelineProperties = await loadAllPipelineInfo({
              browseGitProvider: true,
              resetGit: false,
              withProgress: true,
            });
            panel.sendInitializationData(pipelineProperties);
          }
        }
      });
    },
  );
  commands.disposables.push(disposable);

  async function loadAllPipelineInfo(
    options: LoadPipelineOptions,
  ): Promise<PipelineInfo> {
    // If a load is already in progress, wait for it to complete
    if (loadInProgress) {
      Logger.log(
        "Pipeline load already in progress, waiting for completion...",
      );
      return await loadInProgress;
    }
    // Start new load and track it
    loadInProgress = processLoadAllPipelineInfo(options);
    try {
      const result = await loadInProgress;
      return result;
    } finally {
      // Clear the in-progress flag when done
      loadInProgress = null;
    }
  }

  async function processLoadAllPipelineInfo(
    options: LoadPipelineOptions,
  ): Promise<PipelineInfo> {
    const withProgress = options?.withProgress ?? true;

    const loadData = async () => {
      const browseGitProvider = options?.browseGitProvider ?? true;
      const resetGit = options?.resetGit ?? false;
      const gitProvider = await GitProvider.getInstance(resetGit);
      let openPullRequests: PullRequest[] = [];
      let gitAuthenticated = false;
      let currentBranchPullRequest: PullRequest | null = null;

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

      if (gitProvider?.isActive) {
        gitAuthenticated = true;
        if (browseGitProvider) {
          openPullRequests = await gitProvider.listOpenPullRequests();
          const currentGitBranch = await getCurrentGitBranch();
          if (currentGitBranch) {
            const prActionsFileDraft = path.join(
              getWorkspaceRoot(),
              "scripts",
              "actions",
              ".sfdx-hardis.draft.yml",
            );
            currentBranchPullRequest =
              await gitProvider.getActivePullRequestFromBranch(
                currentGitBranch,
              );
            if (currentBranchPullRequest) {
              if (fs.existsSync(prActionsFileDraft)) {
                // Rename draft file to associate it with the current PR
                const prNumber = currentBranchPullRequest.number;
                const prActionsFileNewName = path.join(
                  getWorkspaceRoot(),
                  "scripts",
                  "actions",
                  `.sfdx-hardis.${prNumber}.yml`,
                );
                await fs.rename(prActionsFileDraft, prActionsFileNewName);
                vscode.window
                  .showInformationMessage(
                    `Draft deployment actions file has been found and associated to ${prButtonInfo.pullRequestLabel || "Pull Request"} #${currentBranchPullRequest.number}. Don't forget to commit & push :)`,
                    `Commit & Push .sfdx-hardis.${prNumber}.yml`,
                    "Open Git",
                  )
                  .then((action) => {
                    if (
                      action === `Commit & Push .sfdx-hardis.${prNumber}.yml`
                      || action === "Open Git"
                    ) {
                      vscode.commands.executeCommand("workbench.view.scm");
                    }
                  });
              }
              // Complete with tickets and deployment actions
              const prList =
                await gitProvider.completePullRequestsWithPrePostCommands([
                  currentBranchPullRequest,
                ]);
              const prListWithTickets =
                await gitProvider.completePullRequestsWithTickets(prList, {
                  fetchDetails: true,
                });
              currentBranchPullRequest = prListWithTickets[0];
            } else {
              // No PR found for current branch but draft file exists
              currentBranchPullRequest = {
                id: "",
                authorLabel: "",
                jobsStatus: "unknown",
                number: -1,
                title: `${prButtonInfo.pullRequestLabel} not created yet`,
              };
              const prList =
                await gitProvider.completePullRequestsWithPrePostCommands([
                  currentBranchPullRequest,
                ]);
              currentBranchPullRequest = prList[0];
            }
          }
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

      const projectApexScripts = await listProjectApexScripts();
      const projectDataWorkspaces = await listProjectDataWorkspaces();

      // Read enableDeploymentApexTestClasses from config/.sfdx-hardis.yml
      const projectHardisConfig = await readSfdxHardisConfig();
      const enableDeploymentApexTestClasses =
        projectHardisConfig?.enableDeploymentApexTestClasses === true;

      const availableApexTestClasses = enableDeploymentApexTestClasses
        ? await listProjectApexTestClasses()
        : [];

      return {
        pipelineData: pipelineData,
        prButtonInfo: prButtonInfo,
        gitAuthenticated: gitAuthenticated,
        ticketAuthenticated: ticketAuthenticated,
        ticketProviderName: ticketProviderName,
        currentBranchPullRequest: currentBranchPullRequest,
        openPullRequests: openPullRequests,
        repoPlatformLabel: repoPlatformLabel,
        repoInfo: gitProvider?.repoInfo || null,
        displayFeatureBranches: displayFeatureBranches,
        projectApexScripts: projectApexScripts,
        projectSfdmuWorkspaces: projectDataWorkspaces,
        enableDeploymentApexTestClasses: enableDeploymentApexTestClasses,
        availableApexTestClasses: availableApexTestClasses,
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

type LoadPipelineOptions = {
  browseGitProvider: boolean;
  resetGit: boolean;
  withProgress?: boolean;
};

type PipelineInfo = {
  pipelineData: any;
  gitAuthenticated: boolean;
  ticketAuthenticated?: boolean;
  ticketProviderName?: string;
  prButtonInfo: any;
  currentBranchPullRequest?: PullRequest | null;
  openPullRequests: PullRequest[];
  repoPlatformLabel: string;
  repoInfo?: any;
  displayFeatureBranches: boolean;
  projectApexScripts: any[];
  projectSfdmuWorkspaces: any[];
  enableDeploymentApexTestClasses: boolean;
  availableApexTestClasses: string[];
};
