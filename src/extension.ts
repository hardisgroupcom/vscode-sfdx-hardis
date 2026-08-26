// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import type TelemetryReporter from "@vscode/extension-telemetry";
import { Commands } from "./commands";
//import *  from './commands/vscode-sfdx-hardis.execute-command';
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisDebugger } from "./hardis-debugger";
import { HardisPluginsProvider } from "./hardis-plugins-provider";
import { HardisStatusProvider } from "./hardis-status-provider";
import { LocalWebSocketServer } from "./hardis-websocket-server";
import { LwcPanelManager } from "./lwc-panel-manager";
import { Logger } from "./logger";
import { getWorkspaceRoot, preLoadCache } from "./utils";
import { HardisColors } from "./hardis-colors";
import { CacheManager } from "./utils/cache-manager";
import { runSalesforceCliMcpServer } from "./utils/mcpUtils";
import { SecretsManager } from "./utils/secretsManager";
import { getExtensionConfigSections } from "./utils/extensionConfigUtils";
import { startEventLoopMonitor } from "./utils/eventLoopMonitor";
import { setNodeCompileCacheDir } from "./utils/sfPerformanceUtils";
import * as path from "path";
import * as fs from "fs";
import {
  getAllTranslations,
  getCurrentLocale,
  initI18n,
  reinitI18n,
} from "./i18n/i18n";

let refreshInterval: any = null;
let reporter: TelemetryReporter | null = null;
let welcomeShownThisSession = false; // Flag to track if welcome was shown this session

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Large cached values are offloaded to files under globalStorage: globalState
  // itself is serialized synchronously on every update, so it must stay small
  CacheManager.init(context.globalState, context.globalStorageUri.fsPath);
  CacheManager.clearExpired();
  SecretsManager.init(context);
  // Node compile cache shared by every sf command started by the extension
  try {
    const compileCacheDir = path.join(
      context.globalStorageUri.fsPath,
      "node-compile-cache",
    );
    fs.mkdirSync(compileCacheDir, { recursive: true });
    setNodeCompileCacheDir(compileCacheDir);
  } catch (e: any) {
    Logger.log(`Could not prepare the node compile cache: ${e?.message}`);
  }

  // Initialize i18n system early
  initI18n();

  new Logger(vscode.window);
  // Diagnostic: watch for extension-host event-loop stalls during the async
  // startup work (CLI spawn storm, etc.). Silent unless the
  // `vsCodeSfdxHardis.debugVsCodeSfdxHardis` setting is enabled.
  startEventLoopMonitor(context);
  console.time("Hardis_Activate");
  const timeInit = Date.now();
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  Logger.log("VsCode SFDX Hardis activation is starting...");

  // Get current workspace
  const currentWorkspaceFolderUri = getWorkspaceRoot();

  // Call cli commands before their result is used, to improve startup performances
  preLoadCache();

  // Register Commands tree view (createTreeView registers the data provider,
  // a separate registerTreeDataProvider call for the same view id is redundant)
  const hardisCommandsProvider = new HardisCommandsProvider(
    currentWorkspaceFolderUri,
  );
  const treeView = vscode.window.createTreeView("sfdx-hardis-commands", {
    treeDataProvider: hardisCommandsProvider,
    showCollapseAll: false,
  });

  treeView.onDidChangeVisibility((e) => {
    if (e.visible && !welcomeShownThisSession) {
      // Check if the setting is enabled
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      const showWelcomeAtStartup = config.get("showWelcomeAtStartup", true);

      if (showWelcomeAtStartup) {
        welcomeShownThisSession = true;
        // Delay slightly to ensure the tree view is fully rendered
        setTimeout(() => {
          vscode.commands.executeCommand("vscode-sfdx-hardis.showWelcome");
        }, 500);
      }
    }
  });

  context.subscriptions.push(treeView);

  // Register Status TreeView
  const hardisStatusProvider = new HardisStatusProvider(
    currentWorkspaceFolderUri,
  );
  const disposableTreeInfo = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-status",
    hardisStatusProvider,
  );
  context.subscriptions.push(disposableTreeInfo);

  // Register Status TreeView
  const hardisPluginsProvider = new HardisPluginsProvider(
    currentWorkspaceFolderUri,
  );
  const disposableTreePlugins = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-plugins",
    hardisPluginsProvider,
  );
  context.subscriptions.push(disposableTreePlugins);

  // Register common commands (telemetry reporter is attached later, see below)
  const commands = new Commands(
    context.extensionUri,
    hardisCommandsProvider,
    hardisStatusProvider,
    hardisPluginsProvider,
    null,
  );
  context.subscriptions.push(...commands.disposables);

  // Initialize LWC Panel Manager
  LwcPanelManager.getInstance(context);

  // Initialize colors
  const hardisColors = new HardisColors(context);
  context.subscriptions.push(hardisColors);
  hardisColors.init();

  // Initialize Hardis Debugger commands
  const hardisDebugger = new HardisDebugger();
  context.subscriptions.push(...hardisDebugger.disposables);

  // Manage WebSocket server to communicate with sfdx-hardis cli plugin.
  // Started immediately: commands run right after activation used to be
  // rejected ("not initialized yet") during a previous arbitrary 5s delay.
  async function startWebSocketServer() {
    // Kill previously launched server if existing
    if (commands.disposableWebSocketServer) {
      commands.disposableWebSocketServer.dispose();
    }
    try {
      commands.disposableWebSocketServer = new LocalWebSocketServer(context);
      context.subscriptions.push(commands.disposableWebSocketServer);
      await commands.disposableWebSocketServer.start();
      return commands.disposableWebSocketServer;
    } catch (e: any) {
      Logger.log("Error while launching WebSocket Server: " + e.message);
      vscode.window.showWarningMessage(
        "Local WebSocket Server was unable to start.\nUser prompts will be in the terminal.",
      );
      return null;
    }
  }

  async function manageWebSocketServer() {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    const userInput = config.get("userInput");
    if (userInput === "ui-lwc" || userInput === "ui") {
      if (
        commands.disposableWebSocketServer === null ||
        commands.disposableWebSocketServer === undefined
      ) {
        startWebSocketServer()
          .then(() => Logger.log("sfdx-hardis Websocket OK"))
          .catch((e) => Logger.log("sfdx-hardis Websocket KO: " + e.message));
      } else if (commands.disposableWebSocketServer) {
        // WebSocket server is already running, do nothing
        await commands.disposableWebSocketServer.refreshConfig();
        Logger.log("Reinitialized WebSocketServer config");
      }
    } else {
      if (
        commands.disposableWebSocketServer !== null &&
        commands.disposableWebSocketServer !== undefined
      ) {
        commands.disposableWebSocketServer.dispose();
      }
    }
  }

  manageWebSocketServer();

  async function startMcpServerIfConfigured() {
    // Auto-start Salesforce CLI MCP server
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    const autoStartMcp = config.get("mcp.autoStartSalesforceCliMcp");
    if (autoStartMcp) {
      runSalesforceCliMcpServer()
        .then(() =>
          Logger.log("Salesforce CLI MCP server start attempted on activation"),
        )
        .catch((e) =>
          Logger.log(
            "Error starting Salesforce CLI MCP server on activation: " +
              e.message,
          ),
        );
    }
  }

  startMcpServerIfConfigured();

  // Catch event configuration changes
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("vsCodeSfdxHardis")) {
      // Change user input
      if (event.affectsConfiguration("vsCodeSfdxHardis.userInput")) {
        manageWebSocketServer();
      }
      // Enable / Disable org colors
      if (
        event.affectsConfiguration("vsCodeSfdxHardis.disableVsCodeColors") ||
        event.affectsConfiguration("vsCodeSfdxHardis.orgColorMode") ||
        event.affectsConfiguration("vsCodeSfdxHardis.showOrgStatusBarItem") ||
        event.affectsConfiguration("vsCodeSfdxHardis.colorUpdateLocation")
      ) {
        hardisColors.init();
      }
      // Enable / Disable start MCP Server at startup
      if (
        event.affectsConfiguration(
          "vsCodeSfdxHardis.mcp.autoStartSalesforceCliMcp",
        )
      ) {
        startMcpServerIfConfigured();
      }
      // Re-initialize i18n when language setting changes
      if (event.affectsConfiguration("vsCodeSfdxHardis.lang")) {
        reinitI18n();
        // Refresh tree views to show translated labels
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshCommandsView",
          true,
        );
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshStatusView",
          true,
        );
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshPluginsView",
          true,
        );
      }
      // Send message to opened LWC panels to update their configuration
      const vsCodeSfdxHardisConfiguration =
        vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      LwcPanelManager.getInstance(context).sendMessageToAllPanels({
        type: "vsCodeSfdxHardisConfigurationChanged",
        data: { vsCodeSfdxHardisConfiguration, event },
      });
    }

    // Change theme
    if (
      event.affectsConfiguration("vsCodeSfdxHardis.theme.menuIconType") ||
      event.affectsConfiguration("vsCodeSfdxHardis.theme.emojisInSections")
    ) {
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshCommandsView",
        true,
      );
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshStatusView",
        true,
      );
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshPluginsView",
        true,
      );
    }

    // Change UI theme: refresh all opened panels
    if (
      event.affectsConfiguration("vsCodeSfdxHardis.theme.colorTheme") ||
      event.affectsConfiguration("vsCodeSfdxHardis.lang")
    ) {
      // Reload fresh configuration data for extension config panel

      const config = vscode.workspace.getConfiguration(
        "vsCodeSfdxHardis.theme",
      );
      const colorThemeConfig = config.get("colorTheme", "auto");
      const { colorTheme, colorContrast } =
        LwcPanelManager.resolveTheme(colorThemeConfig);
      const refreshParams: any = { colorTheme, colorContrast };
      if (event.affectsConfiguration("vsCodeSfdxHardis.lang")) {
        reinitI18n();
        refreshParams.translations = getAllTranslations();
        refreshParams.locale = getCurrentLocale();
      }
      getExtensionConfigSections(context.extensionUri)
        .then((_) => {
          LwcPanelManager.getInstance(context).refreshAllPanels(refreshParams);
        })
        .catch((err) => {
          Logger.log("Error refreshing panels with new theme: " + err.message);
        });
    }
  });

  // Listen for VS Code theme changes (when user switches between light/dark/high-contrast)
  vscode.window.onDidChangeActiveColorTheme(() => {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis.theme");
    const colorThemeConfig = config.get("colorTheme", "auto");

    if (!colorThemeConfig || colorThemeConfig === "auto") {
      const lwcManager = LwcPanelManager.getInstance(context);
      const { colorTheme, colorContrast } =
        LwcPanelManager.resolveTheme(colorThemeConfig);

      // Send theme update to all active panels
      lwcManager.sendMessageToAllPanels({
        type: "updateTheme",
        data: { colorTheme, colorContrast },
      });
    }
  });

  // Refresh commands if a sfdx-project.json has been added.
  // (must use .some(): the previous .filter() call was always truthy, so ANY
  // created/renamed file wiped the CLI cache and re-triggered the whole
  // startup CLI storm - the main cause of recurring cold starts)
  vscode.workspace.onDidCreateFiles((event) => {
    if (event.files.some((uri) => uri.fsPath.endsWith("sfdx-project.json"))) {
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshCommandsView",
        true,
      );
    }
  });

  // Refresh commands if a sfdx-project.json has been added
  vscode.workspace.onDidRenameFiles((event) => {
    if (
      event.files.some((rename) =>
        rename.newUri.fsPath.endsWith("sfdx-project.json"),
      )
    ) {
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshCommandsView",
        true,
      );
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshStatusView",
        true,
      );
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshPluginsView",
        true,
      );
    }
  });

  // Refresh Plugins and Status every 4h
  refreshInterval = setInterval(() => {
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
  }, 14400000);

  console.timeEnd("Hardis_Activate");
  const activationTimeSeconds = (Date.now() - timeInit) / 1000;

  // Warm up what the first command click would otherwise wait for: the
  // git/ticketing credentials passed to sf hardis commands, the direct launch
  // path of the installed CLI, and @salesforce/core for the in-process
  // commands. Deferred and lazily imported so activation itself stays fast.
  setTimeout(() => {
    import("./utils/providerCredentials")
      .then((mod) => mod.refreshProviderCredentialEnvCache())
      .catch((e: any) =>
        Logger.log("Could not warm up provider credentials: " + e?.message),
      );
    import("./utils/sfLauncher")
      .then((mod) => mod.prewarmSfDirectLaunch())
      .catch((e: any) =>
        Logger.log("Could not resolve the sf direct launch: " + e?.message),
      );
    import("./utils/sfCoreInProcess")
      .then((mod) => mod.prewarmSfCoreWorker())
      .catch((e: any) =>
        Logger.log("Could not preload @salesforce/core: " + e?.message),
      );
  }, 3000);

  // Check for Salesforce Extensions settings killing the performances.
  // Deferred and lazily imported: it must never delay the activation, and runs
  // after the startup notifications so it does not compete with them.
  setTimeout(() => {
    import("./utils/salesforceSettingsCheck")
      .then((mod) => mod.checkSalesforceConflictDetectionSetting(context))
      .catch((e: any) =>
        Logger.log(
          "Could not check Salesforce Extensions settings: " + e?.message,
        ),
      );
  }, 8000);

  // Anonymous telemetry respecting VsCode Guidelines -> https://code.visualstudio.com/api/extension-guides/telemetry
  // Deferred: applicationinsights/OpenTelemetry are among the heaviest modules
  // of the bundle and nothing needs telemetry during the first seconds.
  setTimeout(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { default: TelemetryReporterClass } = await import(
        "@vscode/extension-telemetry"
      );
      reporter = new TelemetryReporterClass(
        "cf83e6dc-2621-4cb6-b92b-30905d1c8476", // gitleaks:allow - public Application Insights telemetry key, intentionally embedded
      );
      context.subscriptions.push(reporter);
      commands.reporter = reporter;
      reporter.sendTelemetryEvent(
        "startup",
        {},
        { startupTimeSeconds: activationTimeSeconds },
      );
    } catch (e: any) {
      Logger.log("Could not initialize telemetry reporter: " + e?.message);
    }
  }, 10000);

  // Extension exports, used by UI integration tests to observe internal state
  // (see src/test/ui). NOT a public API: shape may change at any time.
  return {
    commands,
    hardisCommandsProvider,
    hardisStatusProvider,
    hardisPluginsProvider,
    getLwcPanelManager: () => LwcPanelManager.getInstance(),
    activationTimeSeconds,
  };
}

// this method is called when your extension is deactivated
export function deactivate() {
  // Clear refresh interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}
