import * as vscode from "vscode";
import { Commands } from "../commands";
import { getWorkspaceRoot } from "../utils";
import { SfdxHardisConfigHelper } from "../utils/pipeline/sfdxHardisConfigHelper";
import { listMajorOrgs } from "../utils/orgConfigUtils";
import { LwcPanelManager } from "../lwc-panel-manager";
import {
  listProjectApexScripts,
  listProjectApexTestClasses,
  listProjectDataWorkspaces,
} from "../utils/prePostCommandsUtils";
import { handleDeploymentActionPickerMessage } from "../utils/pipeline/deploymentActionPickers";
import {
  buildFunctionCommandFlags,
  getCachedCustomFunctions,
  loadCheckedCustomFunctions,
  quote,
  runFunctionCommand,
} from "../utils/customFunctionsUtils";
import { t } from "../i18n/i18n";
import { readSfdxHardisConfig } from "../utils/sfdx-hardis-config-utils";

export function registerShowPipelineConfig(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showPipelineConfig",
    async (
      branchName: string | null,
      initialSectionSelected: string | null,
    ) => {
      const workspaceRoot = getWorkspaceRoot();
      const sfdxHardisConfigHelper =
        SfdxHardisConfigHelper.getInstance(workspaceRoot);

      // Custom functions are deployment action types, so the editor of this panel needs the
      // catalog, with runtimes checked so the Functions tab can flag a missing interpreter.
      // Listing them costs a whole sfdx-hardis start (several seconds): the panel never waits
      // for it. A catalog already checked for the current configuration is shown at once and
      // checked again in the background (an interpreter may have been installed since), else
      // the tab shows a spinner until the background load sends it.
      const cachedCustomFunctions = getCachedCustomFunctions({
        withRuntimes: true,
      });
      let customFunctions = cachedCustomFunctions ?? [];
      let customFunctionsLoading = cachedCustomFunctions === null;

      // The notification shows as soon as the menu is clicked, and covers every step
      const {
        configEditorInput,
        availableBranches,
        availableApexTestClasses,
        projectApexScripts,
        projectSfdmuWorkspaces,
      } = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: loadingTitle(branchName),
          cancellable: false,
        },
        async () => {
          // Local reads only: they run together
          const [
            input,
            majorOrgs,
            apexTestClasses,
            apexScripts,
            sfdmuWorkspaces,
          ] = await Promise.all([
            sfdxHardisConfigHelper.getEditorInput(branchName),
            listMajorOrgs(),
            readSfdxHardisConfig().then((projectHardisConfig) =>
              projectHardisConfig?.enableDeploymentApexTestClasses === true
                ? listProjectApexTestClasses()
                : [],
            ),
            // Lists proposed by the deployment action editor, which the deployment
            // actions of this panel open just like the DevOps Pipeline panel does
            listProjectApexScripts(),
            listProjectDataWorkspaces(),
          ]);
          return {
            configEditorInput: input,
            availableBranches: majorOrgs.map((org) => org.branchName),
            availableApexTestClasses: apexTestClasses,
            projectApexScripts: apexScripts,
            projectSfdmuWorkspaces: sfdmuWorkspaces,
          };
        },
      );
      configEditorInput.availableBranches = availableBranches;
      configEditorInput.availableApexTestClasses = availableApexTestClasses;
      configEditorInput.projectApexScripts = projectApexScripts;
      configEditorInput.projectSfdmuWorkspaces = projectSfdmuWorkspaces;
      configEditorInput.customFunctions = customFunctions;
      configEditorInput.customFunctionsLoading = customFunctionsLoading;

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline-config",
        {
          ...configEditorInput,
          initialSectionSelected: initialSectionSelected,
        },
      );
      panel.updateTitle(
        branchName
          ? t("pipelineSettingsBranch", { branchName })
          : t("globalPipelineSettings"),
      );

      // Each read of the catalog gets a number and only the latest one updates the panel: a
      // background read started before a save never replaces the list the save reloaded. The
      // result also goes into the initialization data, which a webview still booting receives
      // once ready (a message posted before is dropped) and a branch switch sends again.
      let latestCatalogRead = 0;
      const readCatalog = async (
        messageType: "customFunctionsLoaded" | "customFunctionsRefreshed",
        showLoading: boolean,
      ): Promise<void> => {
        const catalogRead = ++latestCatalogRead;
        if (showLoading) {
          customFunctionsLoading = true;
          panel.mergeInitializationData({ customFunctionsLoading });
        }
        const functions = await loadCheckedCustomFunctions();
        if (catalogRead !== latestCatalogRead) {
          return;
        }
        customFunctions = functions;
        customFunctionsLoading = false;
        panel.mergeInitializationData({
          customFunctions,
          customFunctionsLoading,
        });
        panel.sendMessage({ type: messageType, data: { customFunctions } });
      };
      void readCatalog("customFunctionsLoaded", customFunctionsLoading);

      // Register message handlers
      panel.onMessage(async (type, data) => {
        if (type === "saveSfdxHardisConfig") {
          try {
            await sfdxHardisConfigHelper.saveConfigFromEditor(data);
            vscode.window.showInformationMessage(
              "Configuration saved successfully.",
            );
          } catch (error: any) {
            vscode.window.showErrorMessage(
              "Error saving configuration: " + error.message,
            );
          }
        } else if (type === "loadPipelineConfig") {
          // Handle request to load config for different branch
          try {
            const newBranchName = data.branchName;
            const newConfigEditorInput = await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: loadingTitle(newBranchName),
                cancellable: false,
              },
              async () => {
                const input =
                  await sfdxHardisConfigHelper.getEditorInput(newBranchName);
                // Add available branches to the input
                input.availableBranches = availableBranches;
                input.availableApexTestClasses = availableApexTestClasses;
                input.projectApexScripts = projectApexScripts;
                input.projectSfdmuWorkspaces = projectSfdmuWorkspaces;
                // Current state: the background load may still be running
                input.customFunctions = customFunctions;
                input.customFunctionsLoading = customFunctionsLoading;
                return input;
              },
            );

            // Update panel title and send new data to LWC
            panel.updateTitle(
              newBranchName
                ? t("pipelineSettingsBranch", { branchName: newBranchName })
                : t("globalPipelineSettings"),
            );
            panel.sendInitializationData(newConfigEditorInput);
          } catch (error: any) {
            vscode.window.showErrorMessage(
              "Error loading configuration: " + error.message,
            );
          }
        } else if (type === "saveCustomFunction") {
          // The CLI is the engine: the panel never writes customFunctions itself, it runs
          // the same command a terminal user would.
          const isCreate = data.mode === "create";
          const command =
            `sf hardis:project:function:${isCreate ? "create" : "update"} --agent ` +
            buildFunctionCommandFlags(
              data.customFunction,
              isCreate ? "create" : "update",
            );
          const saved = await runFunctionCommand(
            command,
            isCreate
              ? t("customFunctionCreated", { id: data.customFunction.id })
              : t("customFunctionUpdated", { id: data.customFunction.id }),
          );
          if (saved) {
            await readCatalog("customFunctionsRefreshed", true);
          }
        } else if (type === "deleteCustomFunction") {
          const usedByActions = data.force === true;
          const command =
            `sf hardis:project:function:delete --agent --id ${quote(data.functionId)}` +
            (usedByActions ? " --force" : "");
          const deleted = await runFunctionCommand(
            command,
            t("customFunctionDeleted", { id: data.functionId }),
          );
          if (deleted) {
            await readCatalog("customFunctionsRefreshed", true);
          }
        } else if (type === "refreshCustomFunctions") {
          await readCatalog("customFunctionsRefreshed", true);
        } else {
          // Lazy-loaded lists of the deployment action editor
          await handleDeploymentActionPickerMessage(panel, type, data);
        }
      });
    },
  );
  commands.disposables.push(disposable);
}

function loadingTitle(branchName: string | null): string {
  return branchName
    ? t("loadingPipelineSettingsForBranch", { branchName })
    : t("loadingGlobalPipelineSettings");
}
