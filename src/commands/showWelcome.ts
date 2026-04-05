import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { t } from "../i18n/i18n";
import {
  BANNER_IMAGE_URL,
  WEBSITE_URL,
  DOCSITE_URL,
  WEBSITE_CONTACT_FORM_URL,
} from "../constants";
import {
  listCustomCommands,
  isAllConfigLoaded,
  isPluginCommandsLoaded,
  listPluginCustomCommands,
  CustomCommandMenu,
} from "../utils/sfdx-hardis-config-utils";

export function registerShowWelcome(command: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showWelcome",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      // Get current setting value
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      const showWelcomeAtStartup = config.get("showWelcomeAtStartup", true);

      const colorThemeConfig = config.get("theme.colorTheme", "auto");
      const langSetting = config.get<string>("lang", "auto");
      const { colorTheme, colorContrast } =
        LwcPanelManager.resolveTheme(colorThemeConfig);
      let customMenus: CustomCommandMenu[] = [];
      let customMenusLoaded = false;
      if (isAllConfigLoaded()) {
        customMenus = (await listCustomCommands()).flatMap((g) => g.menus);
        customMenusLoaded = true;
      }

      const panel = lwcManager.getOrCreatePanel("s-welcome", {
        showWelcomeAtStartup: showWelcomeAtStartup,
        langSetting: langSetting,
        colorThemeConfig,
        colorTheme,
        colorContrast,
        customMenus: customMenus,
        bannerImageUrl:
          BANNER_IMAGE_URL !== false ? BANNER_IMAGE_URL : undefined,
        websiteUrl: WEBSITE_URL,
        docsiteUrl: DOCSITE_URL,
        contributersUrl: DOCSITE_URL + "/contributors/",
        contactFormUrl: WEBSITE_CONTACT_FORM_URL,
        imagePaths: {
          flagGlobe: ["icons", "flag-globe.svg"],
          flagDe: ["icons", "flag-de.svg"],
          flagEn: ["icons", "flag-uk.svg"],
          flagEs: ["icons", "flag-es.svg"],
          flagFr: ["icons", "flag-fr.svg"],
          flagJa: ["icons", "flag-ja.svg"],
          flagNl: ["icons", "flag-nl.svg"],
          flagPl: ["icons", "flag-pl.svg"],
          flagPtBR: ["icons", "flag-br.svg"],
          flagIt: ["icons", "flag-it.svg"],
          themeAuto: ["icons", "theme-auto.svg"],
          themeLight: ["icons", "theme-light.svg"],
          themeDark: ["icons", "theme-dark.svg"],
        },
      });
      panel.updateTitle(t("welcomeTitle"));

      // If config was not ready yet, load it in the background and push custom menus once available
      if (customMenusLoaded === false) {
        void (async () => {
          const groups = await listCustomCommands(); // awaits both configs
          const allMenus = groups.flatMap((g) => g.menus);
          // Also append plugin-provided menus if already available
          if (isPluginCommandsLoaded()) {
            const pluginGroups = await listPluginCustomCommands();
            allMenus.push(...pluginGroups.flatMap((g) => g.menus));
          }
          if (allMenus.length > 0 && !panel.isDisposed()) {
            panel.sendMessage({
              type: "updateCustomMenus",
              data: allMenus,
            });
          }
        })();
      }

      // Load plugin-provided custom commands independently (may take longer)
      if (!isPluginCommandsLoaded()) {
        void (async () => {
          const pluginGroups = await listPluginCustomCommands();
          if (pluginGroups.length > 0 && !panel.isDisposed()) {
            // Merge with current config-based menus
            const configMenus = isAllConfigLoaded()
              ? (await listCustomCommands()).flatMap((g) => g.menus)
              : [];
            const allMenus = [
              ...configMenus,
              ...pluginGroups.flatMap((g) => g.menus),
            ];
            panel.sendMessage({
              type: "updateCustomMenus",
              data: allMenus,
            });
          }
        })();
      } else {
        // Plugin commands already loaded: add them to initial custom menus if not already included
        const pluginGroups = await listPluginCustomCommands();
        if (pluginGroups.length > 0) {
          const pluginMenus = pluginGroups.flatMap((g) => g.menus);
          customMenus = [...customMenus, ...pluginMenus];
          if (!panel.isDisposed()) {
            panel.sendMessage({
              type: "updateCustomMenus",
              data: customMenus,
            });
          }
        }
      }

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
          case "navigateToDocumentationWorkbench":
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showDocumentationWorkbench",
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
