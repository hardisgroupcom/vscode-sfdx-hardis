import * as vscode from "vscode";
import { Commands } from "../commands";
import { getExtensionConfigSections } from "../utils/extensionConfigUtils";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";

export function registerShowExtensionConfig(commands: Commands) {
  // Show the extensionConfig LWC panel for editing extension settings
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showExtensionConfig",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();
      const panel = lwcManager.getOrCreatePanel("s-extension-config", {
        loading: true,
      });
      panel.updateTitle(t("extensionConfig"));

      const loadAndPush = async () => {
        panel.sendInitializationData({ loading: true });
        try {
          const sections = await getExtensionConfigSections(commands.extensionUri);
          panel.sendInitializationData({ sections: sections, loading: false });
        }
        catch (e: any) {
          Logger.log("[vscode-sfdx-hardis] Extension Config init failed: " + (e?.message || e));
          panel.sendInitializationData({ loading: false, loadError: String(e?.message || e) });
        }
      };

      // Open the LWC panel
      panel.onMessage(async (type: string, _data: any) => {
        if (type === "retryInit") {
          await loadAndPush();
          return;
        }
        if (type === "refresh") {
          // Re-load settings with fresh values
          const refreshedSections = await getExtensionConfigSections(
            commands.extensionUri,
          );
          panel.sendMessage({
            type: "initialize",
            data: { sections: refreshedSections },
          });
        }
      });
      loadAndPush();
    },
  );
  commands.disposables.push(disposable);
}
