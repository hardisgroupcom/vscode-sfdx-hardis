import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { t } from "../i18n/i18n";
import {
  BANNER_IMAGE_URL,
  WEBSITE_URL,
  DOCSITE_URL,
  WEBSITE_CONTACT_FORM_URL,
  EXTENSION_REPOSITORY_URL,
  EXTENSION_CHANGELOG_URL,
} from "../constants";
import {
  loadAllCustomCommandGroups,
  isAllCustomCommandsLoaded,
  CustomCommandMenu,
} from "../utils/sfdx-hardis-config-utils";

const EXTENSION_ID = "NicolasVuillamy.vscode-sfdx-hardis";

// Whitelist of navigation targets the Welcome LWC can request.
// Keys are the card/button ids sent in the `navigateTo` message.
export const WELCOME_NAVIGATION_TARGETS: Record<string, string> = {
  dataWorkbench: "vscode-sfdx-hardis.showDataWorkbench",
  documentationWorkbench: "vscode-sfdx-hardis.showDocumentationWorkbench",
  extensionConfig: "vscode-sfdx-hardis.showExtensionConfig",
  filesWorkbench: "vscode-sfdx-hardis.showFilesWorkbench",
  installedPackages: "vscode-sfdx-hardis.showInstalledPackages",
  metadataRetriever: "vscode-sfdx-hardis.showMetadataRetriever",
  orgMonitoring: "vscode-sfdx-hardis.showOrgMonitoring",
  orgsManager: "vscode-sfdx-hardis.openOrgsManager",
  pipeline: "vscode-sfdx-hardis.showPipeline",
  runAnonymousApex: "vscode-sfdx-hardis.runAnonymousApex",
  setup: "vscode-sfdx-hardis.showSetup",
};

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
      const extensionVersion =
        vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version ??
        "";
      let customMenus: CustomCommandMenu[] = [];
      const allCustomCommandsLoaded = isAllCustomCommandsLoaded();
      if (allCustomCommandsLoaded) {
        customMenus = (await loadAllCustomCommandGroups()).flatMap(
          (g) => g.menus,
        );
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
        repositoryUrl: EXTENSION_REPOSITORY_URL,
        whatsNewUrl: EXTENSION_CHANGELOG_URL,
        extensionVersion: extensionVersion,
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

      // If not all custom commands were ready, load them in the background and push once available
      if (!allCustomCommandsLoaded) {
        void (async () => {
          const allGroups = await loadAllCustomCommandGroups();
          const allMenus = allGroups.flatMap((g) => g.menus);
          if (!panel.isDisposed()) {
            panel.sendMessage({
              type: "updateCustomMenus",
              data: allMenus,
            });
          }
        })();
      }

      // Handle messages from the Welcome panel
      panel.onMessage(async (type: string, data: any) => {
        if (type === "navigateTo") {
          const targetCommand = WELCOME_NAVIGATION_TARGETS[data?.target];
          if (targetCommand) {
            vscode.commands.executeCommand(targetCommand);
          }
        }
      });
    },
  );
  command.disposables.push(disposable);
}
