import * as vscode from "vscode";
import { Commands } from "../commands";
import { getWorkspaceRoot } from "../utils";
import { SfdxHardisConfigHelper } from "../utils/pipeline/sfdxHardisConfigHelper";
import { listMajorOrgs } from "../utils/orgConfigUtils";
import { LwcPanelManager } from "../lwc-panel-manager";

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

      // Load available branches from major orgs
      const majorOrgs = await listMajorOrgs();
      const availableBranches = majorOrgs.map((org) => org.branchName);

      // Show progress while loading config editor input
      const configEditorInput = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: branchName
            ? `Loading pipeline settings for ${branchName}...`
            : "Loading global pipeline settings...",
          cancellable: false,
        },
        async () => {
          const input = await sfdxHardisConfigHelper.getEditorInput(branchName);
          // Add available branches to the input
          input.availableBranches = availableBranches;
          return input;
        },
      );

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline-config",
        {
          ...configEditorInput,
          initialSectionSelected: initialSectionSelected,
        },
      );
      panel.updateTitle(
        branchName ? `Settings - ${branchName}` : "Global Pipeline Settings",
      );

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
                title: newBranchName
                  ? `Loading pipeline settings for ${newBranchName}...`
                  : "Loading global pipeline settings...",
                cancellable: false,
              },
              async () => {
                const input =
                  await sfdxHardisConfigHelper.getEditorInput(newBranchName);
                // Add available branches to the input
                input.availableBranches = availableBranches;
                return input;
              },
            );

            // Update panel title and send new data to LWC
            panel.updateTitle(
              newBranchName
                ? `Settings - ${newBranchName}`
                : "Global Pipeline Settings",
            );
            panel.sendInitializationData(newConfigEditorInput);
          } catch (error: any) {
            vscode.window.showErrorMessage(
              "Error loading configuration: " + error.message,
            );
          }
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
