import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";

export function registerShowWelcome(command: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showWelcome",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      // Get current setting value
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      const showWelcomeAtStartup = config.get("showWelcomeAtStartup", true);

      const colorThemeConfig = config.get("theme.colorTheme", "auto");
      const { colorTheme, colorContrast } = LwcPanelManager.resolveTheme(colorThemeConfig);
      const panel = lwcManager.getOrCreatePanel("s-welcome", {
        showWelcomeAtStartup: showWelcomeAtStartup,
        colorTheme,
        colorContrast
      });
      panel.updateTitle("SFDX Hardis Welcome");

      // Handle messages from the Welcome panel
      panel.onMessage(async (type: string, _data: any) => {
        switch (type) {
          case "navigateToOrgsManager":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.openOrgsManager",
            );
            break;
          case "navigateToPipeline":
            vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline");
            break;
          case "navigateToMetadataRetriever":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showMetadataRetriever",
            );
            break;
          case "navigateToFilesWorkbench":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showFilesWorkbench",
            );
            break;
          case "navigateToDataWorkbench":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showDataWorkbench",
            );
            break;
          case "navigateToOrgMonitoring":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showOrgMonitoring",
            );
            break;
          case "navigateToExtensionConfig":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showExtensionConfig",
            );
            break;
          case "navigateToInstalledPackages":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showInstalledPackages",
            );
            break;
          case "navigateToDocumentation":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.runLocalHtmlDocPages",
            );
            break;
          case "navigateToSetup":
            vscode.commands.executeCommand("vscode-sfdx-hardis.showSetup");
            break;
          case "navigateToRunAnonymousApex":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.runAnonymousApex",
            );
            break;
          default:
            break;
        }
      });
    },
  );
  command.disposables.push(disposable);
}
