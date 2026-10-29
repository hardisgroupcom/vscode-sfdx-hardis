import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { t } from "../i18n/i18n";
import { Logger } from "../logger";
import {
  BANNER_IMAGE_URL,
  WEBSITE_URL,
  DOCSITE_URL,
  WEBSITE_CONTACT_FORM_URL,
  WHATS_NEW_URL,
  EXTENSION_MARKETPLACE_URL,
  EXTENSION_OPENVSX_URL,
  SFDX_HARDIS_REPOSITORY_URL,
} from "../constants";
import {
  isAllConfigLoaded,
  isPluginCommandsLoaded,
  listCustomCommands,
  listPluginCustomCommands,
  CustomCommandsGroup,
  CustomCommandMenu,
} from "../utils/sfdx-hardis-config-utils";
import { CacheManager } from "../utils/cache-manager";
import {
  dismissPrerequisitesModalForSession,
  getCachedDependenciesStatus,
  isPrerequisitesModalDismissed,
  refreshDependenciesStatus,
} from "../utils/dependenciesStatus";

const EXTENSION_ID = "NicolasVuillamy.vscode-sfdx-hardis";
const QUICK_START_COLLAPSED_PREF = "welcomeQuickStartCollapsed";
const WELCOME_STARTUP_DELAY_MS = 2000;
const WELCOME_READY_TIMEOUT_MS = 15000;

// Whitelist of navigation targets the Welcome LWC can request.
// Keys are the card/button ids sent in the `navigateTo` message.
export const WELCOME_NAVIGATION_TARGETS: Record<string, string> = {
  dataWorkbench: "vscode-sfdx-hardis.showDataWorkbench",
  documentationWorkbench: "vscode-sfdx-hardis.showDocumentationWorkbench",
  extensionConfig: "vscode-sfdx-hardis.showExtensionConfig",
  filesWorkbench: "vscode-sfdx-hardis.showFilesWorkbench",
  // The guinea pig of the tagline, clicked five times, or the Konami code
  guineaRun: "vscode-sfdx-hardis.openGuineaRun",
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
      // The project menus (a local YAML read) and the plugin menus (`sf plugins`,
      // then one call per plugin) load independently: whichever is ready is shown
      // now, and the other is pushed to the page when it arrives.
      const configReady = isAllConfigLoaded();
      const pluginsReady = isPluginCommandsLoaded();
      let configMenus: CustomCommandMenu[] = configReady
        ? withPosition(await listCustomCommands())
        : [];
      let pluginMenus: CustomCommandMenu[] = pluginsReady
        ? withPosition(await listPluginCustomCommands())
        : [];
      const customMenus = [...configMenus, ...pluginMenus];

      const panel = lwcManager.getOrCreatePanel("s-welcome", {
        showWelcomeAtStartup: showWelcomeAtStartup,
        dependenciesStatus: getCachedDependenciesStatus(),
        dependenciesModalDismissed: isPrerequisitesModalDismissed(),
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
        whatsNewUrl: WHATS_NEW_URL,
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
          guineaPig: ["guinea-pig-small.webp"],
          themeAuto: ["icons", "theme-auto.svg"],
          themeLight: ["icons", "theme-light.svg"],
          themeDark: ["icons", "theme-dark.svg"],
        },
      });
      panel.updateTitle(t("welcomeTitle"));

      const pushMenus = () => {
        if (!panel.isDisposed()) {
          panel.sendMessage({
            type: "updateCustomMenus",
            data: [...configMenus, ...pluginMenus],
          });
        }
      };
      if (!configReady) {
        void listCustomCommands()
          .then((groups) => {
            configMenus = withPosition(groups);
            pushMenus();
          })
          .catch(() => undefined);
      }
      if (!pluginsReady) {
        void listPluginCustomCommands()
          .then((groups) => {
            pluginMenus = withPosition(groups);
            pushMenus();
          })
          .catch(() => undefined);
      }

      // Never block the Welcome page on the dependencies computation: it
      // renders immediately with the last cached value (or "checking"), and
      // refreshDependenciesStatus() pushes the fresh value to this panel once
      // ready (see src/utils/dependenciesStatus.ts)
      void refreshDependenciesStatus();

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
        } else if (type === "dismissPrerequisitesModal") {
          dismissPrerequisitesModalForSession();
        }
      });
    },
  );
  command.disposables.push(disposable);
}

/**
 * Opens the Welcome page when VS Code starts.
 * A webview created while VS Code is still restoring its window can fail with
 * "Could not register service worker: The document is in an invalid state":
 * the page then stays blank. So the page opens once the window has the focus
 * and has settled, and is reopened once if it never finished loading.
 */
export async function openWelcomeAtStartup(): Promise<void> {
  await waitForWindowFocus();
  await new Promise((resolve) => setTimeout(resolve, WELCOME_STARTUP_DELAY_MS));
  await vscode.commands.executeCommand("vscode-sfdx-hardis.showWelcome");
  const panel = LwcPanelManager.getInstance().getPanel("s-welcome");
  if (!panel) {
    return;
  }
  const ready = await panel.waitForPageReady(WELCOME_READY_TIMEOUT_MS);
  // A hidden page does not load until it is shown: nothing to repair there.
  if (ready || panel.isDisposed() || !panel.isVisible()) {
    return;
  }
  Logger.log(
    `Welcome page did not load within ${WELCOME_READY_TIMEOUT_MS / 1000}s, opening it again`,
  );
  LwcPanelManager.getInstance().disposePanel("s-welcome");
  await vscode.commands.executeCommand("vscode-sfdx-hardis.showWelcome");
}

let welcomeStatusBarItem: vscode.StatusBarItem | undefined;

// Cloudity icon in the status bar, opening the Welcome page when clicked.
// The glyph comes from the icon font declared in package.json (contributes.icons)
export function registerWelcomeStatusBarItem(command: Commands) {
  welcomeStatusBarItem = vscode.window.createStatusBarItem(
    "sfdxHardis.welcome",
    vscode.StatusBarAlignment.Left,
    // Just left of the default org badge (priority 200, see hardis-colors.ts)
    201,
  );
  welcomeStatusBarItem.name = "SFDX Hardis: Welcome";
  welcomeStatusBarItem.text = "$(cloudity-logo)";
  welcomeStatusBarItem.command = "vscode-sfdx-hardis.showWelcome";
  command.disposables.push(welcomeStatusBarItem);
  refreshWelcomeStatusBarItem();
}

// Called again when vsCodeSfdxHardis.showWelcomeStatusBarItem or the language changes
export function refreshWelcomeStatusBarItem() {
  if (!welcomeStatusBarItem) {
    return;
  }
  welcomeStatusBarItem.tooltip = t("welcomeStatusBarTooltip");
  const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  if (config.get<boolean>("showWelcomeStatusBarItem", true)) {
    welcomeStatusBarItem.show();
  } else {
    welcomeStatusBarItem.hide();
  }
}

// The insertion position declared by customCommandsPosition travels with each
// menu, so the Welcome page places custom menus above or below the built-in
// cards the way the Commands tree does
function withPosition(groups: CustomCommandsGroup[]): CustomCommandMenu[] {
  return groups.flatMap((g) =>
    (g.menus || []).map((menu) => ({
      ...menu,
      position: g.position || "last",
    })),
  );
}

// Resolves at once when the window has the focus, else when it gets it
function waitForWindowFocus(): Promise<void> {
  if (vscode.window.state.focused) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const listener = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        listener.dispose();
        resolve();
      }
    });
  });
}
