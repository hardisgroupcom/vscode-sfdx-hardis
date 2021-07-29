// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { Commands } from "./commands";
//import *  from './commands/vscode-sfdx-hardis.execute-command';
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisDebugger } from "./hardis-debugger";
import { HardisStatusProvider } from "./hardis-status-provider";
import { WebSocketServer } from "./hardis-websocket-server";
import { getWorkspaceRoot } from "./utils";
import { WelcomePanel } from "./webviews/welcome";

let refreshInterval: any = null;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.time("Hardis_Activate");
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("VsCode SFDX Hardis has been activated");
  const currentWorkspaceFolderUri = getWorkspaceRoot();

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

  // Register common commands
  const commands = new Commands(hardisCommandsProvider, hardisStatusProvider);
  context.subscriptions.push(...commands.disposables);

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
    manageWebSocketServer();
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

  // Refresh Status every 30 mn
  refreshInterval = setInterval(() => {
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
  }, 1800000);

  console.timeEnd("Hardis_Activate");
}

// this method is called when your extension is deactivated
export function deactivate() {
  // Clear refresh interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}
