// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
//import *  from './commands/vscode-sfdx-hardis.execute-command';
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisStatusProvider } from "./hardis-status-provider";
import { WebSocketServer } from "./hardis-websocket-server";

let refreshInterval: any = null ;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("VsCode SFDX Hardis has been activated");

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let terminalStack: vscode.Terminal[] = [];
  let terminalIsRunning = false;
  function getLatestTerminal() {
    return terminalStack[terminalStack.length - 1];
  }
  function runCommandInTerminal(command: string) {
    const terminal = getLatestTerminal();
    // Show and focus terminal
    terminal.show(false);

    // Run command on terminal only if there is not already a command running
    if (terminalIsRunning) {
      vscode.window.showErrorMessage(
        "Wait for the current command to be completed before running a new one :)",
        "Close"
      );
      return;
    }
    // terminalIsRunning = true; //Comment until we find a way to detect that a command is running or not
    terminal.sendText(command);
    // Scrolldown the terminal
    vscode.commands.executeCommand("workbench.action.terminal.scrollToBottom");
  }

  // Execute SFDX Hardis command
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.execute-command",
    (sfdxHardisCommand: string) => {
      // Filter killed terminals
      terminalStack = terminalStack.filter(
        (terminal) =>
          vscode.window.terminals.filter(
            (vsTerminal) => vsTerminal.processId === terminal.processId
          ).length > 0
      );
      // Create new terminal if necessary
      if (terminalStack.length === 0 || vscode.window.terminals.length === 0) {
        // Check bash is the default terminal if we are on windows
        if (process.platform === "win32") {
          const terminalConfig = vscode.workspace.getConfiguration("terminal");
          const bash = terminalConfig.integrated?.shell?.windows || "";
          if (!bash.includes("bash")) {
            vscode.commands.executeCommand(
              "workbench.action.terminal.selectDefaultShell"
            );
            vscode.window
              .showInformationMessage(
                "You need git bash selected as default terminal shell (do it in the opened dialog at the top of the screen)",
                "Download Git Bash",
                "Ignore"
              )
              .then((selection) => {
                if (selection === "Download Git Bash") {
                  vscode.env.openExternal(
                    vscode.Uri.parse("https://git-scm.com/downloads")
                  );
                }
              });
            return;
          }
        }
        /* Create terminal
      const terminalOptions: vscode.TerminalOptions = {
        name: 'SFDX Hardis',
        cwd: (vscode.workspace.workspaceFolders) ? vscode.workspace.workspaceFolders[0].uri.path : process.cwd()
      };*/
        //const newTerminal = vscode.window.createTerminal(terminalOptions);
        vscode.commands.executeCommand(
          "workbench.action.terminal.newInActiveWorkspace",
          "SFDX Hardis"
        );
        new Promise((resolve) => setTimeout(resolve, 4000)).then(() => {
          vscode.commands.executeCommand(
            "workbench.action.toggleMaximizedPanel"
          );
          const newTerminal =
            vscode.window.terminals[vscode.window.terminals.length - 1];
          terminalStack.push(newTerminal);
          runCommandInTerminal(sfdxHardisCommand);
        });
      } else {
        // Run command in active terminal
        runCommandInTerminal(sfdxHardisCommand);
      }
    }
  );
  context.subscriptions.push(disposable);

  // Register Hardis Commands & Status tree data providers
  let currentWorkspaceFolderUri = ".";
  if ((vscode.workspace.workspaceFolders?.length || 0) > 0) {
    currentWorkspaceFolderUri = (vscode.workspace.workspaceFolders || [])[0].uri
      .path;
  }
  const hardisCommandsProvider = new HardisCommandsProvider(
    currentWorkspaceFolderUri
  );
  const disposableTreeCommands = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-commands",
    hardisCommandsProvider
  );
  vscode.commands.registerCommand("vscode-sfdx-hardis.refreshCommandsView", () =>
    hardisCommandsProvider.refresh()
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
  vscode.commands.registerCommand("vscode-sfdx-hardis.refreshStatusView", () =>
    hardisStatusProvider.refresh()
  );
  context.subscriptions.push(disposableTreeInfo);

  // Manage WebSocket server to communicate with sfdx-hardis cli plugin
  let disposableWebSocketServer: any = null;

  function startWebSocketServer() {
    disposableWebSocketServer = new WebSocketServer();
    context.subscriptions.push(disposableWebSocketServer);
  }

  function manageWebSocketServer() {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    if (config.get("userInput") === "ui") {
      if (disposableWebSocketServer === null) {
        startWebSocketServer();
      }
    } else {
      if (disposableWebSocketServer !== null) {
        disposableWebSocketServer.dispose();
      }
    }
  }

  manageWebSocketServer();

  // Catch event configuration changes
  vscode.workspace.onDidChangeConfiguration((event) => {
    manageWebSocketServer();
  });

  // Refresh Status every 30 mn
  refreshInterval = setInterval(() => {
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView")
  },1800000);
}

// this method is called when your extension is deactivated
export function deactivate() {
  // Clear refresh interval 
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}
