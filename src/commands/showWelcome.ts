import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { t } from "../i18n/i18n";
import {
  BANNER_IMAGE_URL,
  WEBSITE_URL,
  DOCSITE_URL,
  WEBSITE_CONTACT_FORM_URL,
  EXTENSION_CHANGELOG_URL,
  EXTENSION_MARKETPLACE_URL,
  EXTENSION_OPENVSX_URL,
  SFDX_HARDIS_REPOSITORY_URL,
} from "../constants";
import {
  loadAllCustomCommandGroups,
  isAllCustomCommandsLoaded,
  CustomCommandMenu,
} from "../utils/sfdx-hardis-config-utils";
import { CacheManager } from "../utils/cache-manager";

const EXTENSION_ID = "NicolasVuillamy.vscode-sfdx-hardis";
const QUICK_START_COLLAPSED_PREF = "welcomeQuickStartCollapsed";

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
  searchCommands: "vscode-sfdx-hardis.searchCommands",
  setup: "vscode-sfdx-hardis.showSetup",
};

// VS Code forks (VSCodium, code-server, Gitpod, Theia…) ship extensions from
// Open VSX instead of the Visual Studio Marketplace. There is no public API
// exposing the gallery in use, so detect known forks by app name and default
// to the Visual Studio Marketplace otherwise.
export function getMarketplaceRatingUrl(): string {
  const appName = (vscode.env.appName || "").toLowerCase();
  const openVsxBasedApps = [
    "vscodium",
    "codium",
    "code - oss",
    "code-oss",
    "code-server",
    "gitpod",
    "theia",
  ];
  if (openVsxBasedApps.some((name) => appName.includes(name))) {
    return EXTENSION_OPENVSX_URL;
  }
  return EXTENSION_MARKETPLACE_URL;
}

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
        quickStartCollapsed:
          CacheManager.getPreference<boolean>(QUICK_START_COLLAPSED_PREF) ===
          true,
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
        repositoryUrl: SFDX_HARDIS_REPOSITORY_URL,
        marketplaceUrl: getMarketplaceRatingUrl(),
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
        } else if (type === "setQuickStartCollapsed") {
          void CacheManager.setPreference(
            QUICK_START_COLLAPSED_PREF,
            data?.collapsed === true,
          );
        }
      });
    },
  );
  command.disposables.push(disposable);
}
