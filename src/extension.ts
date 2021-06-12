// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";
//import *  from './commands/vscode-sfdx-hardis.execute-command';
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisDebugger } from "./hardis-debugger";
import { HardisStatusProvider } from "./hardis-status-provider";
import { WebSocketServer } from "./hardis-websocket-server";
import { getWorkspaceRoot } from "./utils";

let refreshInterval: any = null;
let disposableWebSocketServer: WebSocketServer;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.time("Hardis_Activate");
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
    if (
      command.startsWith("sfdx hardis:") &&
      disposableWebSocketServer &&
      disposableWebSocketServer.websocketHostPort !== null
    ) {
      command += ` --websocket ${disposableWebSocketServer.websocketHostPort}`;
    }
    // Adapt command to powershell if necessary
    if (terminal?.name?.includes("powershell")) {
      command = command.replace(/ && /g, " ; ").replace(/echo y/g, 'echo "y"');
    }
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
          const selectedTerminal =
            terminalConfig.integrated?.shell?.windows || "";
          if (!selectedTerminal.includes("bash")) {
            const config =
              vscode.workspace.getConfiguration("vsCodeSfdxHardis");
            if (config.get("disableGitBashCheck") !== true) {
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
                  } else {
                    vscode.window.showInformationMessage(
                      "If you do not want to see this message anymore, set VsCode setting vsCodeSfdxHardis.disableGitBashCheck to true"
                    );
                  }
                });
              return;
            }
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
  const currentWorkspaceFolderUri = getWorkspaceRoot();
  const hardisCommandsProvider = new HardisCommandsProvider(
    currentWorkspaceFolderUri
  );
  const disposableTreeCommands = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-commands",
    hardisCommandsProvider
  );
  context.subscriptions.push(disposableTreeCommands);
  // Refresh commands tree
  vscode.commands.registerCommand(
    "vscode-sfdx-hardis.refreshCommandsView",
    () => hardisCommandsProvider.refresh()
  );
  // New terminal command
  vscode.commands.registerCommand("vscode-sfdx-hardis.newTerminal", () => {
    vscode.commands.executeCommand(
      "workbench.action.terminal.newInActiveWorkspace",
      "SFDX Hardis"
    );
    new Promise((resolve) => setTimeout(resolve, 4000)).then(() => {
      const newTerminal =
        vscode.window.terminals[vscode.window.terminals.length - 1];
      terminalStack.push(newTerminal);
    });
  });

  // Open external command
  vscode.commands.registerCommand("vscode-sfdx-hardis.openExternal", (url) =>
    vscode.env.openExternal(url)
  );

  // Initialize Hardis Debugger commands
  const hardisDebugger = new HardisDebugger();
  context.subscriptions.push(hardisDebugger);

  // Open key file command
  vscode.commands.registerCommand(
    "vscode-sfdx-hardis.openKeyFile",
    async () => {
      const keyFileList = [
        {
          file: "config/.sfdx-hardis.yml",
          label: "sfdx-hardis main configuration file",
        },
        {
          file: "manifest/package.xml",
          label: "List of all deployed metadatas",
        },
        {
          file: "manifest/packageDeployOnce.xml",
          label:
            "List of metadatas that will be deployed only if not existing in the target org",
        },
        {
          file: "config/project-scratch-def.json",
          label: "Scratch org creation definition file",
        },
        { file: "sfdx-project.json", label: "Sfdx Project config file" },
      ];
      const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
      const value = await new Promise<any>((resolve) => {
        quickpick.ignoreFocusOut = true;
        (quickpick.title = "Please select a configuration file to open"),
          (quickpick.canSelectMany = false);
        quickpick.items = keyFileList
          .filter((choice: any) =>
            fs.existsSync(currentWorkspaceFolderUri + path.sep + choice.file)
          )
          .map((choice: any) => {
            const quickPickItem: vscode.QuickPickItem = {
              label: choice.file,
              detail: choice.label,
            };
            return quickPickItem;
          });
        quickpick.show();
        quickpick.onDidHide(() => resolve(null));
        quickpick.onDidAccept(() => {
          if (quickpick.selectedItems.length > 0) {
            const values = quickpick.selectedItems.map((item) => {
              return keyFileList.filter((choice: any) => {
                return item.label === choice.file;
              })[0].file;
            });
            resolve(values);
          }
          resolve(null);
        });
      });
      quickpick.dispose();
      if (value) {
        var openPath = vscode.Uri.parse(
          "file:///" + currentWorkspaceFolderUri + "/" + value
        );
        vscode.workspace.openTextDocument(openPath).then((doc) => {
          vscode.window.showTextDocument(doc);
        });
      }
    }
  );

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

  function startWebSocketServer() {
    return new Promise((resolve) => {
      disposableWebSocketServer = new WebSocketServer();
      disposableWebSocketServer.start();
      context.subscriptions.push(disposableWebSocketServer);
      resolve(disposableWebSocketServer);
    });
  }

  async function manageWebSocketServer() {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    if (config.get("userInput") === "ui") {
      if (
        disposableWebSocketServer === null ||
        disposableWebSocketServer === undefined
      ) {
        startWebSocketServer();
      }
    } else {
      if (
        disposableWebSocketServer !== null &&
        disposableWebSocketServer !== undefined
      ) {
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
