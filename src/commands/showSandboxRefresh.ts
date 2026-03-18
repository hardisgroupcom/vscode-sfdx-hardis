import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { t } from "../i18n/i18n";

export function registerShowSandboxRefresh(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showSandboxRefresh",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      const panel = lwcManager.getOrCreatePanel("s-sandbox-refresh", {});
      panel.updateTitle(t("sandboxRefreshWizardTitle"));

      panel.clearExistingOnMessageListeners();
      panel.onMessage(async (type: string, _data: any) => {
        switch (type) {
          case "runPreRefresh": {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.execute-command",
              "sf hardis:org:refresh:before-refresh",
            );
            break;
          }
          case "runPostRefresh": {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.execute-command",
              "sf hardis:org:refresh:after-refresh",
            );
            break;
          }
          case "freezeUsers": {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.execute-command",
              "sf hardis:org:user:freeze",
            );
            break;
          }
          case "unfreezeUsers": {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.execute-command",
              "sf hardis:org:user:unfreeze",
            );
            break;
          }
          case "activateEmails": {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.execute-command",
              "sf hardis:org:user:activateinvalid",
            );
            break;
          }
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
