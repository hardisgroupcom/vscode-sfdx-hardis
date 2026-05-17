import * as vscode from "vscode";
import simpleGit from "simple-git";
import { Commands } from "../commands";
import { getWorkspaceRoot } from "../utils";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { DOCSITE_URL } from "../constants";
import {
  fetchMonitoringCatalog,
  readCurrentMonitoringConfig,
  readMonitoringConfigFromBranch,
  listAvailableBranches,
  saveMonitoringConfig,
  MonitoringCommandEntry,
  NotificationConfigEntry,
  MonitoringUserConfig,
} from "../utils/monitoringConfigUtils";

let _gitHeadWatcher: vscode.FileSystemWatcher | null = null;

export function registerShowMonitoringConfig(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showMonitoringConfig",
    async () => {
      let catalog;
      try {
        catalog = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t("loadingMonitoringConfig"),
            cancellable: false,
          },
          async () => fetchMonitoringCatalog(),
        );
      } catch (error: any) {
        Logger.log("Error fetching monitoring catalog: " + error?.message);
        vscode.window.showErrorMessage(t("monitoringConfigCatalogUnavailable"));
        return;
      }

      const userConfig = await readCurrentMonitoringConfig();
      const branches = await listAvailableBranches();
      const currentBranch = await getCurrentBranchName();

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-monitoring-config",
        {
          catalog,
          monitoringCommands: userConfig.monitoringCommands,
          notificationConfig: userConfig.notificationConfig,
          branches,
          currentBranch,
          docUrl: DOCSITE_URL + "/salesforce-monitoring-config-home/",
        },
      );
      panel.updateTitle(t("monitoringConfigWorkbench"));

      if (_gitHeadWatcher) {
        _gitHeadWatcher.dispose();
        _gitHeadWatcher = null;
      }
      _gitHeadWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(getWorkspaceRoot(), ".git/HEAD"),
      );
      _gitHeadWatcher.onDidChange(async () => {
        if (panel.isDisposed()) {
          _gitHeadWatcher?.dispose();
          _gitHeadWatcher = null;
          return;
        }
        try {
          const newBranch = await getCurrentBranchName();
          const newUserConfig = await readCurrentMonitoringConfig();
          panel.sendMessage({
            type: "branchChanged",
            data: {
              currentBranch: newBranch,
              monitoringCommands: newUserConfig.monitoringCommands,
              notificationConfig: newUserConfig.notificationConfig,
            },
          });
        } catch (error: any) {
          Logger.log("Error reloading monitoring config on branch change: " + error?.message);
        }
      });
      LwcPanelManager.getInstance().setDisposalCallback("s-monitoring-config", () => {
        _gitHeadWatcher?.dispose();
        _gitHeadWatcher = null;
      });

      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "saveMonitoringConfig": {
            try {
              const monitoringCommands: MonitoringCommandEntry[] = Array.isArray(
                data?.monitoringCommands,
              )
                ? data.monitoringCommands
                : [];
              const notificationConfig: NotificationConfigEntry[] = Array.isArray(
                data?.notificationConfig,
              )
                ? data.notificationConfig
                : [];
              const payload: MonitoringUserConfig = {
                monitoringCommands,
                notificationConfig,
              };
              await saveMonitoringConfig(payload);
            } catch (error: any) {
              Logger.log(
                "Error saving monitoring config: " + error?.message,
              );
              vscode.window.showErrorMessage(
                t("monitoringConfigSaveError", {
                  error: error?.message || String(error),
                }),
              );
            }
            break;
          }
          case "loadFromBranch": {
            const branch = data?.branch;
            if (!branch || typeof branch !== "string") {
              return;
            }
            const confirmed = await vscode.window.showWarningMessage(
              t("confirmCopyFromBranch", { branch }),
              { modal: true },
              t("yesLabel"),
            );
            if (!confirmed) {
              return;
            }
            try {
              const branchConfig = await readMonitoringConfigFromBranch(branch);
              if (
                branchConfig.monitoringCommands.length === 0 &&
                branchConfig.notificationConfig.length === 0
              ) {
                vscode.window.showWarningMessage(
                  t("monitoringConfigBranchEmpty", { branch }),
                );
              }
              panel.sendMessage({
                type: "branchConfigLoaded",
                data: {
                  branch,
                  monitoringCommands: branchConfig.monitoringCommands,
                  notificationConfig: branchConfig.notificationConfig,
                },
              });
            } catch (error: any) {
              Logger.log(
                `Error loading config from branch ${branch}: ${error?.message}`,
              );
              vscode.window.showErrorMessage(
                t("monitoringConfigBranchLoadError", { branch }),
              );
            }
            break;
          }
          default:
            break;
        }
      });
    },
  );
  commands.disposables.push(disposable);
}

async function getCurrentBranchName(): Promise<string | null> {
  try {
    const git = simpleGit(getWorkspaceRoot());
    const status = await git.status();
    return status.current || null;
  } catch (e) {
    Logger.log(`Error reading current branch: ${e}`);
    return null;
  }
}
