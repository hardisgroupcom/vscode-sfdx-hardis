import * as vscode from "vscode";
import { Commands } from "../commands";
import { getExtensionConfigSections } from "../utils/extensionConfigUtils";
import { LwcPanelManager } from "../lwc-panel-manager";

export function registerShowExtensionConfig(commands: Commands) {
  // Show the extensionConfig LWC panel for editing extension settings
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showExtensionConfig",
    async () => {
      // Use utility to get config sections
      const sections = await getExtensionConfigSections(commands.extensionUri);

      const lwcManager = LwcPanelManager.getInstance();
      const panel = lwcManager.getOrCreatePanel("s-extension-config", {
        sections: sections,
      });
      
      // Open the LWC panel
      panel.onMessage(async (type: string, _data: any) => {
        if (type === "refresh") {
          // Re-load settings with fresh values
          const refreshedSections = await getExtensionConfigSections(commands.extensionUri);
          panel.sendMessage({ type: "initialize", data: { sections: refreshedSections } });
        }
      });
    },
  );
  commands.disposables.push(disposable);
}

