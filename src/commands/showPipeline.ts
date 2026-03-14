import * as vscode from "vscode";
import { PipelineDataProvider } from "../pipeline-data-provider";
import { Logger } from "../logger";
import { GitProvider } from "../utils/gitProviders/gitProvider";
import { LwcPanelManager } from "../lwc-panel-manager";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";
import { PullRequest } from "../utils/gitProviders/types";
import { TicketProvider } from "../utils/ticketProviders/ticketProvider";
import {
  deletePrePostCommand,
  listProjectApexScripts,
  listProjectDataWorkspaces,
  listProjectApexTestClasses,
  saveDeploymentApexTestClasses,
  savePrePostCommand,
} from "../utils/prePostCommandsUtils";
import { getCurrentGitBranch } from "../utils/pipeline/sfdxHardisConfig";
import {
  execCommandWithProgress,
  execSfdxJson,
  getWorkspaceRoot,
  readSfdxHardisConfig,
} from "../utils";
import { t } from "../i18n/i18n";
import path from "path";
import fs from "fs-extra";
import { listAllOrgs } from "../utils/orgUtils";

const SCHEDULABLE_CLASSES_CACHE_TTL_MS = 15 * 60 * 1000;
const schedulableClassesByOrgCache = new Map<
  string,
  { expiresAt: number; values: string[] }
>();
const communitiesByOrgCache = new Map<
  string,
  { expiresAt: number; values: string[] }
>();

async function getDefaultOrgUsername(): Promise<string> {
  try {
    const orgDisplay = await execSfdxJson("sf org display --json", {
      fail: false,
      output: false,
    });
    return (
      orgDisplay?.result?.username || orgDisplay?.result?.alias || "default"
    );
  } catch {
    return "default";
  }
}

async function fetchAndCacheOrgNames(
  cache: Map<string, { expiresAt: number; values: string[] }>,
  orgKey: string,
  now: number,
  command: string,
  filter?: (record: any) => boolean,
): Promise<string[]> {
  const result = await execSfdxJson(command, {
    fail: false,
    output: false,
  });
  const records = Array.isArray(result?.result?.records)
    ? result.result.records
    : [];
  const filtered = filter ? records.filter(filter) : records;
  const values = filtered
    .map((record: any) => String(record?.Name || "").trim())
    .filter((v: string) => v.length > 0);
  const uniqueSorted: string[] = [...new Set<string>(values)].sort(
    (a: string, b: string) => a.localeCompare(b),
  );
  if (uniqueSorted.length > 0) {
    cache.set(orgKey, {
      expiresAt: now + SCHEDULABLE_CLASSES_CACHE_TTL_MS,
      values: uniqueSorted,
    });
  }
  return uniqueSorted;
}

async function listSchedulableClassesFromDefaultOrg(): Promise<string[]> {
  const orgKey = await getDefaultOrgUsername();
  const now = Date.now();
  const cached = schedulableClassesByOrgCache.get(orgKey);
  if (cached && cached.expiresAt > now) {
    return cached.values;
  }
  const query =
    "SELECT Name, Body FROM ApexClass WHERE ManageableState = 'unmanaged' ORDER BY Name";
  const command = `sf data query --query "${query}" --use-tooling-api --json`;
  return fetchAndCacheOrgNames(
    schedulableClassesByOrgCache,
    orgKey,
    now,
    command,
    (record: any) =>
      String(record?.Body || "")
        .toLowerCase()
        .includes("schedulable"),
  );
}

async function listCommunitiesFromDefaultOrg(): Promise<string[]> {
  const orgKey = await getDefaultOrgUsername();
  const now = Date.now();
  const cached = communitiesByOrgCache.get(orgKey);
  if (cached && cached.expiresAt > now) {
    return cached.values;
  }
  const query = "SELECT Name FROM Network ORDER BY Name";
  const command = `sf data query --query "${query}" --json`;
  return fetchAndCacheOrgNames(communitiesByOrgCache, orgKey, now, command);
}

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
          imagePaths: {
            git: ["icons", "git.svg"],
            ticket: ["icons", "ticket.svg"],
            github: ["icons", "github.svg"],
            gitlab: ["icons", "gitlab.svg"],
            bitbucket: ["icons", "bitbucket.svg"],
            azure: ["icons", "azure.svg"],
            gitea: ["icons", "gitea.svg"],
            jira: ["icons", "jira.svg"],
            azureboards: ["icons", "azureboards.svg"],
          },
        },
      );

      panel.updateTitle(t("devOpsPipeline"));

      function showCommitReminder(prNumber: number, msg: string) {
        if (prNumber === -1) {
          vscode.window.showInformationMessage(msg);
        } else {
          const openGitLabel = t("openGit");
          vscode.window
            .showInformationMessage(msg, openGitLabel)
            .then((action) => {
              if (action === openGitLabel) {
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
              ? t("deploymentActionSavedDraft", { prLabel })
              : t("deploymentActionSaved", {
                  prLabel,
                  prNumber: data.prNumber,
                  updatedFile,
                });
          showCommitReminder(data.prNumber, msg);
        }
        // Delete Deployment Action
        else if (type === "deleteDeploymentAction") {
          const updatedFile = await deletePrePostCommand(
            data.prNumber,
            data.commandId,
            data.when,
          );
          Logger.log(
            `Deleted deployment action ${data.commandId} for PR #${data.prNumber}`,
          );
          if (updatedFile) {
            Logger.log(`Updated file after deletion: ${updatedFile}`);
          }
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
              ? t("apexTestsSavedDraft", { prLabel })
              : t("apexTestsSaved", {
                  prLabel,
                  prNumber: data.prNumber,
                  updatedFile,
                });
          showCommitReminder(data.prNumber, msg);
        }
        // Lazy-load Schedulable classes for schedule-batch deployment actions
        else if (type === "loadSchedulableClasses") {
          const requestId = data?.requestId || null;
          try {
            const values = await listSchedulableClassesFromDefaultOrg();
            panel.sendMessage({
              type: "returnSchedulableClasses",
              data: {
                requestId,
                values,
              },
            });
          } catch (error: any) {
            Logger.log(
              `Error loading schedulable classes with Tooling API: ${error?.message || error}`,
            );
            panel.sendMessage({
              type: "returnSchedulableClasses",
              data: {
                requestId,
                values: [],
              },
            });
          }
        }
        // Lazy-load communities for publish-community deployment actions
        else if (type === "loadCommunities") {
          const requestId = data?.requestId || null;
          try {
            const values = await listCommunitiesFromDefaultOrg();
            panel.sendMessage({
              type: "returnCommunities",
              data: {
                requestId,
                values,
              },
            });
          } catch (error: any) {
            Logger.log(`Error loading communities: ${error?.message || error}`);
            panel.sendMessage({
              type: "returnCommunities",
              data: {
                requestId,
                values: [],
              },
            });
          }
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
              t("errorGettingPrInfo", { prLabel }),
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
        // Open org via sf org open, preferring a known username when available
        else if (type === "openOrg") {
          const instanceUrl: string | undefined = data?.instanceUrl;
          const alias: string | undefined = data?.alias;
          const normalizeUrl = (url?: string) =>
            (url || "").replace(/\/*$/, "").toLowerCase();
          let targetOrgUsername: string | undefined;
          if (instanceUrl) {
            try {
              const orgs = await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: t("searchingOrgsForInstanceUrl"),
                  cancellable: false,
                },
                async () => {
                  return await listAllOrgs(false, true);
                },
              );
              const normalizedTarget = normalizeUrl(instanceUrl);
              const match = orgs.find(
                (org) => normalizeUrl(org.instanceUrl) === normalizedTarget,
              );
              if (match?.username) {
                targetOrgUsername = match.username;
              }
            } catch (error: any) {
              Logger.log(
                `Error while listing orgs for openOrg: ${error?.message || error}`,
              );
            }
          }

          let command: string | null = null;
          if (targetOrgUsername) {
            command = `sf org open --target-org ${targetOrgUsername}`;
          } else if (alias) {
            command = `sf org open --target-org ${alias}`;
          }

          if (command) {
            const progressLabel = targetOrgUsername
              ? t("openingOrgNamed", { name: targetOrgUsername })
              : alias
                ? t("openingOrgNamed", { name: alias })
                : t("openingOrg");
            try {
              await execCommandWithProgress(
                command,
                { fail: true, output: true, spinner: true },
                progressLabel,
              );
            } catch (error: any) {
              if (instanceUrl) {
                try {
                  await vscode.env.openExternal(vscode.Uri.parse(instanceUrl));
                  return;
                } catch (fallbackError: any) {
                  vscode.window.showErrorMessage(
                    t("failedToOpenOrgCliAndUrl", {
                      error: fallbackError?.message || fallbackError,
                    }),
                  );
                  return;
                }
              }
              vscode.window.showErrorMessage(
                t("failedToOpenOrg", { error: error?.message || error }),
              );
            }
          } else if (instanceUrl) {
            try {
              await vscode.env.openExternal(vscode.Uri.parse(instanceUrl));
            } catch (error: any) {
              vscode.window.showErrorMessage(
                t("failedToOpenOrgUrl", { error: error?.message || error }),
              );
            }
          } else {
            vscode.window.showWarningMessage(t("unableToOpenOrg"));
          }
        }
        // Authenticate or re-authenticate to Git provider
        else if (type === "connectToGit") {
          const gitProvider = await GitProvider.getInstance();
          if (!gitProvider) {
            vscode.window.showErrorMessage(t("noGitProviderDetected"));
            return;
          }
          Logger.log(
            `Authenticating to Git provider: ${gitProvider.repoInfo?.providerName} at ${gitProvider.repoInfo?.host}`,
          );
          let authRes: boolean | null = false;
          try {
            authRes = await gitProvider.authenticate();
          } catch (e) {
            const viewLogsLabel = t("viewLogs");
            vscode.window
              .showErrorMessage(t("gitProviderAuthError"), viewLogsLabel)
              .then((action) => {
                if (action === viewLogsLabel) {
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
              t("successfullyConnectedToGitProvider"),
            );
            pipelineProperties = await loadAllPipelineInfo({
              browseGitProvider: true,
              resetGit: true,
              withProgress: true,
            });
            panel.sendInitializationData(pipelineProperties);
          } else if (authRes === false) {
            const viewLogsLabel = t("viewLogs");
            vscode.window
              .showErrorMessage(t("failedConnectGitProvider"), viewLogsLabel)
              .then((action) => {
                if (action === viewLogsLabel) {
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
            const pipelineSettingsLabel = t("pipelineConfig");
            vscode.window
              .showErrorMessage(
                t("noTicketingProviderDetected"),
                pipelineSettingsLabel,
              )
              .then((action) => {
                if (action === pipelineSettingsLabel) {
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
            const viewLogsLabel = t("viewLogs");
            vscode.window
              .showErrorMessage(
                t("failedConnectToProvider", {
                  providerName: ticketProvider.providerName,
                }),
                viewLogsLabel,
              )
              .then((action) => {
                if (action === viewLogsLabel) {
                  Logger.showOutputChannel();
                }
              });
            return;
          }
          vscode.window.showInformationMessage(
            t("successfullyConnectedToProvider", {
              providerName: ticketProvider.providerName,
            }),
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
          const openRemoteLabel = t("openRemoteRepository");
          const disconnectLabel = t("disconnect");
          const choice = await vscode.window.showInformationMessage(
            t("connectedToProviderAction", { providerName }),
            { modal: true },
            openRemoteLabel,
            disconnectLabel,
          );
          if (choice === openRemoteLabel) {
            const gitProvider = await GitProvider.getInstance();
            const repoUrl = gitProvider?.repoInfo?.webUrl || "";
            if (!repoUrl) {
              vscode.window.showWarningMessage(
                t("noWebUrlForRepo", { providerName }),
              );
              return;
            }
            vscode.env.openExternal(vscode.Uri.parse(repoUrl));
          } else if (choice === disconnectLabel) {
            const gitProvider = await GitProvider.getInstance();
            if (gitProvider) {
              await gitProvider.disconnect();
              vscode.window.showInformationMessage(
                t("disconnectedFrom", { providerName }),
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
          const openProviderLabel = t("openProviderButton", { providerName });
          const disconnectLabel = t("disconnect");
          const choice = await vscode.window.showInformationMessage(
            t("connectedToProviderAction", { providerName }),
            { modal: true },
            openProviderLabel,
            disconnectLabel,
          );
          if (choice === openProviderLabel) {
            const ticketProvider = await TicketProvider.getInstance({
              reset: false,
              authenticate: false,
            });
            if (!ticketProvider) {
              vscode.window.showWarningMessage(
                t("unableToFindTicketingConnection"),
              );
              return;
            }
            const ticketingUrl = await ticketProvider.getTicketingWebUrl();
            if (!ticketingUrl) {
              vscode.window.showWarningMessage(
                t("noWebUrlForTicketing", { providerName }),
              );
              return;
            }
            vscode.env.openExternal(vscode.Uri.parse(ticketingUrl));
          } else if (choice === disconnectLabel) {
            const ticketProvider = await TicketProvider.getInstance({
              reset: false,
              authenticate: false,
            });

            if (ticketProvider) {
              await ticketProvider.disconnect();
              vscode.window.showInformationMessage(
                t("disconnectedFrom", { providerName }),
              );
            } else {
              vscode.window.showWarningMessage(
                t("unableToFindTicketingConnection"),
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

      // Determine theme for Mermaid diagram colors
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      const colorThemeConfig = config.get("theme.colorTheme", "light");
      const themeConfig = LwcUiPanel.resolveTheme(colorThemeConfig);
      const colorTheme = themeConfig.colorTheme;

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
        prButtonInfo.label = t("viewPullRequests");
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
                const commitAndPushLabel = t("commitAndPushFile", {
                  fileName: `.sfdx-hardis.${prNumber}.yml`,
                });
                const openGitLabel = t("openGit");
                vscode.window
                  .showInformationMessage(
                    t("draftActionsFileAssociated", {
                      prLabel: prButtonInfo.pullRequestLabel || "Pull Request",
                      prNumber: currentBranchPullRequest.number,
                    }),
                    commitAndPushLabel,
                    openGitLabel,
                  )
                  .then((action) => {
                    if (
                      action === commitAndPushLabel ||
                      action === openGitLabel
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
                title: t("prLabelNotCreatedYet", {
                  prLabel: prButtonInfo.pullRequestLabel,
                }),
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
          colorTheme: colorTheme,
        },
      );

      // Read displayFeatureBranches configuration
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
        projectCommunities: [],
        enableDeploymentApexTestClasses: enableDeploymentApexTestClasses,
        availableApexTestClasses: availableApexTestClasses,
      };
    };

    if (withProgress) {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("loadingPipelineInformation"),
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
  projectCommunities: any[];
  enableDeploymentApexTestClasses: boolean;
  availableApexTestClasses: string[];
};
