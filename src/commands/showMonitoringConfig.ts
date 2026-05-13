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
  readCurrentMonitoringCommands,
  readMonitoringCommandsFromBranch,
  listAvailableBranches,
  saveMonitoringCommands,
  MonitoringCommandEntry,
} from "../utils/monitoringConfigUtils";

export function registerShowMonitoringConfig(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showMonitoringConfig",
    async () => {
      // Fetch catalog from CLI; if it fails, the user must upgrade sfdx-hardis
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

      const monitoringCommands = await readCurrentMonitoringCommands();
      const branches = await listAvailableBranches();
      const currentBranch = await getCurrentBranchName();

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-monitoring-config",
        {
          catalog,
          monitoringCommands,
          branches,
          currentBranch,
          docUrl: DOCSITE_URL + "/salesforce-monitoring-config-home/",
        },
      );
      panel.updateTitle(t("monitoringConfigWorkbench"));

      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "saveMonitoringConfig": {
            try {
              const list: MonitoringCommandEntry[] = Array.isArray(
                data?.monitoringCommands,
              )
                ? data.monitoringCommands
                : [];
              await saveMonitoringCommands(list);
              vscode.window.showInformationMessage(
                t("monitoringConfigSaved"),
              );
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
            try {
              const branchCommands =
                await readMonitoringCommandsFromBranch(branch);
              if (branchCommands.length === 0) {
                vscode.window.showWarningMessage(
                  t("monitoringConfigBranchEmpty", { branch }),
                );
              }
              panel.sendMessage({
                type: "branchConfigLoaded",
                data: {
                  branch,
                  monitoringCommands: branchCommands,
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
