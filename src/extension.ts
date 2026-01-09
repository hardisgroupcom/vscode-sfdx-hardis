// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import TelemetryReporter from "@vscode/extension-telemetry";
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

let refreshInterval: any = null;
let reporter;
let welcomeShownThisSession = false; // Flag to track if welcome was shown this session

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  CacheManager.init(context.globalState);
  CacheManager.clearExpired();
  SecretsManager.init(context);

  new Logger(vscode.window);
  console.time("Hardis_Activate");
  const timeInit = Date.now();
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  Logger.log("VsCode SFDX Hardis activation is starting...");

  // Get current workspace
  const currentWorkspaceFolderUri = getWorkspaceRoot();

  // Call cli commands before their result is used, to improve startup performances
  preLoadCache();

  // Register Commands tree data provider
  const hardisCommandsProvider = new HardisCommandsProvider(
    currentWorkspaceFolderUri,
  );
  const disposableTreeCommands = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-commands",
    hardisCommandsProvider,
  );
  context.subscriptions.push(disposableTreeCommands);

  // Auto-show Welcome panel when tree view becomes visible (once per session)
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

  // Anonymous telemetry respecting VsCode Guidelines -> https://code.visualstudio.com/api/extension-guides/telemetry
  reporter = new TelemetryReporter("cf83e6dc-2621-4cb6-b92b-30905d1c8476");
  context.subscriptions.push(reporter);

  // Register common commands
  const commands = new Commands(
    context.extensionUri,
    hardisCommandsProvider,
    hardisStatusProvider,
    hardisPluginsProvider,
    reporter,
  );
  context.subscriptions.push(...commands.disposables);

  // Initialize LWC Panel Manager
  LwcPanelManager.getInstance(context);

  // Initialize colors
  const hardisColors = new HardisColors();
  context.subscriptions.push(hardisColors);
  hardisColors.init();

  // Initialize Hardis Debugger commands
  const hardisDebugger = new HardisDebugger();
  context.subscriptions.push(...hardisDebugger.disposables);

  // Manage WebSocket server to communicate with sfdx-hardis cli plugin
  function startWebSocketServer() {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Kill previously launched server if existing
        if (commands.disposableWebSocketServer) {
          commands.disposableWebSocketServer.dispose();
        }
        // Wait a while to run WebSocket server, as it can be time consuming
        try {
          commands.disposableWebSocketServer = new LocalWebSocketServer(
            context,
          );
          commands.disposableWebSocketServer.start();
          context.subscriptions.push(commands.disposableWebSocketServer);
          resolve(commands.disposableWebSocketServer);
        } catch (e: any) {
          Logger.log("Error while launching WebSocket Server: " + e.message);
          vscode.window.showWarningMessage(
            "Local WebSocket Server was unable to start.\nUser prompts will be in the terminal.",
          );
        }
      }, 5000);
    });
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
      if (event.affectsConfiguration("vsCodeSfdxHardis.disableVsCodeColors")) {
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
      event.affectsConfiguration("vsCodeSfdxHardis.theme.colorTheme")
    ) {
      // Reload fresh configuration data for extension config panel
      
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis.theme");
      const colorThemeConfig = config.get("colorTheme", "auto");
      const { colorTheme, colorContrast } = LwcPanelManager.resolveTheme(colorThemeConfig);
      
      getExtensionConfigSections(context.extensionUri).then((sections) => {
        LwcPanelManager.getInstance(context).refreshAllPanels({
          colorTheme,
          colorContrast 
        });
      }).catch((err) => {
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
      const { colorTheme, colorContrast } = LwcPanelManager.resolveTheme(colorThemeConfig);
      
      // Send theme update to all active panels
      lwcManager.sendMessageToAllPanels({
        type: "updateTheme",
        data: { colorTheme, colorContrast }
      });
    }
  });

  // Refresh commands if a sfdx-Project.json has been added
  vscode.workspace.onDidCreateFiles((event) => {
    if (event.files.filter((uri) => uri.fsPath.includes("sfdx-project.json"))) {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshCommandsView");
    }
  });

  // Refresh commands if a sfdx-Project.json has been added
  vscode.workspace.onDidRenameFiles((event) => {
    if (
      event.files.filter((rename) =>
        rename.newUri.fsPath.includes("sfdx-project.json"),
      )
    ) {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshCommandsView");
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
    }
  });

  // Refresh Plugins and Status every 4h
  refreshInterval = setInterval(() => {
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
  }, 14400000);

  console.timeEnd("Hardis_Activate");
  const timeSpent = (timeInit - Date.now()) / 1000;
  reporter.sendTelemetryEvent("startup", {}, { startupTimeSeconds: timeSpent });
}

// this method is called when your extension is deactivated
export function deactivate() {
  // Clear refresh interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}
