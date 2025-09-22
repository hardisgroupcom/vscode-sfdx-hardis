import * as vscode from "vscode";
import { Commands } from "../commands";
import { getWorkspaceRoot } from "../utils";
import { SfdxHardisConfigHelper } from "../utils/pipeline/sfdxHardisConfigHelper";
import { LwcPanelManager } from "../lwc-panel-manager";

export function  registerShowInstalledPackages(commands: Commands) {
    const workspaceRoot = getWorkspaceRoot();
    const sfdxHardisConfigHelper =
      SfdxHardisConfigHelper.getInstance(workspaceRoot);
    // Reusable loading packages function
    const loadInstalledPackages = async () => {
      // Show progress while loading config editor input
      const packages = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Loading installed packages...`,
          cancellable: false,
        },
        async () => {
          const allConfig = await sfdxHardisConfigHelper.getEditorInput(null);
          return allConfig?.config?.installedPackages || [];
        },
      );
      return packages;
    };

    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showInstalledPackages",
      async () => {
        const packages = await loadInstalledPackages();
        const panel = LwcPanelManager.getInstance().getOrCreatePanel(
          "s-installed-packages",
          { packages },
        );
        panel.updateTitle("Installed Packages");
        // Listen for save events from LWC
        // Register message handler to save configuration
        panel.onMessage(async (type, data) => {
          if (type === "saveSfdxHardisConfig") {
            try {
              const allConfig =
                await sfdxHardisConfigHelper.getEditorInput(null);
              allConfig.config.installedPackages = data.packages;
              await sfdxHardisConfigHelper.saveConfigFromEditor(allConfig);
              vscode.window.showInformationMessage(
                "Installed packages configuration saved successfully.",
              );
            } catch (error: any) {
              vscode.window.showErrorMessage(
                "Error saving installed packages configuration: " +
                  error.message,
              );
            }
          } else if (type === "refresh") {
            const packages = await loadInstalledPackages();
            panel.sendMessage({
              type: "initialize",
              data: { packages: packages },
            });
          }
        });
      },
    );
    commands.disposables.push(disposable);
  }