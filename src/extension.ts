// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { Commands } from "./commands";
//import *  from './commands/vscode-sfdx-hardis.execute-command';
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisDebugger } from "./hardis-debugger";
import { HardisPluginsProvider } from "./hardis-plugins-provider";
import { HardisStatusProvider } from "./hardis-status-provider";
import { WebSocketServer } from "./hardis-websocket-server";
import { Logger } from "./logger";
import { getWorkspaceRoot, preLoadCache } from "./utils";
import { WelcomePanel } from "./webviews/welcome";
import { HardisColors } from "./hardis-colors";

let refreshInterval: any = null;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  new Logger(vscode.window);
  console.time("Hardis_Activate");
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  Logger.log("VsCode SFDX Hardis has been activated");
  const currentWorkspaceFolderUri = getWorkspaceRoot();

  // Call cli commands before their result is used, to improve startup performances
  preLoadCache();

  // Initialize Welcome Webview
  const welcomeWebview = new WelcomePanel();
  context.subscriptions.push(...welcomeWebview.disposables);

  // Register Commands tree data provider
  const hardisCommandsProvider = new HardisCommandsProvider(
    currentWorkspaceFolderUri
  );
  const disposableTreeCommands = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-commands",
    hardisCommandsProvider
  );
  context.subscriptions.push(disposableTreeCommands);

  // Register Status TreeView
  const hardisStatusProvider = new HardisStatusProvider(
    currentWorkspaceFolderUri
  );
  const disposableTreeInfo = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-status",
    hardisStatusProvider
  );
  context.subscriptions.push(disposableTreeInfo);

  // Register Status TreeView
  const hardisPluginsProvider = new HardisPluginsProvider(
    currentWorkspaceFolderUri
  );
  const disposableTreePlugins = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-plugins",
    hardisPluginsProvider
  );
  context.subscriptions.push(disposableTreePlugins);

  // Register common commands
  const commands = new Commands(
    hardisCommandsProvider,
    hardisStatusProvider,
    hardisPluginsProvider
  );
  context.subscriptions.push(...commands.disposables);

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
        // Wait a while to run WebSocket server, as it can be time consuming
        commands.disposableWebSocketServer = new WebSocketServer();
        commands.disposableWebSocketServer.start();
        context.subscriptions.push(commands.disposableWebSocketServer);
        resolve(commands.disposableWebSocketServer);
      }, 5000);
    });
  }

  async function manageWebSocketServer() {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    if (config.get("userInput") === "ui") {
      if (
        commands.disposableWebSocketServer === null ||
        commands.disposableWebSocketServer === undefined
      ) {
        startWebSocketServer();
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

  // Catch event configuration changes
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('vsCodeSfdxHardis')) {
      if (event.affectsConfiguration('vsCodeSfdxHardis.userInput')) {
        manageWebSocketServer();
      }
      if (event.affectsConfiguration('vsCodeSfdxHardis.disableVsCodeColors')) {
        hardisColors.init();
      }
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
        rename.newUri.fsPath.includes("sfdx-project.json")
      )
    ) {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshCommandsView");
    }
  });

  // Refresh Plugins and Status every 6h
  refreshInterval = setInterval(() => {
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
  }, 21600000);

  console.timeEnd("Hardis_Activate");
}

// this method is called when your extension is deactivated
export function deactivate() {
  // Clear refresh interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}
