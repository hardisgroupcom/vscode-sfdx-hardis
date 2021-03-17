// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
//import *  from './commands/vscode-sfdx-hardis.execute-command';
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisStatusProvider } from "./hardis-status-provider";

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

  // Install dependencies command
  const disposableInstall = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.install",
    () => {
      const commands = [
        "npm install sfdx-cli@7.85.1 -g",
        "echo y|sfdx plugins:install sfdx-hardis",
        "echo y|sfdx plugins:install sfdx-essentials",
        "echo y|sfdx plugins:install sfpowerkit",
        "echo y|sfdx plugins:install sfdx-git-delta",
      ];
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.execute-command",
        commands.join("\n")
      );
    }
  );
  context.subscriptions.push(disposableInstall);

  // Register Hardis Commands tree data provider
  let currentWorkspaceFolderUri = ".";
  if ((vscode.workspace.workspaceFolders?.length || 0) > 0) {
    currentWorkspaceFolderUri = (vscode.workspace.workspaceFolders || [])[0].uri
      .path;
  }
  const disposableTreeCommands = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-commands",
    new HardisCommandsProvider(currentWorkspaceFolderUri)
  );
  context.subscriptions.push(disposableTreeCommands);

  const disposableTreeInfo = vscode.window.registerTreeDataProvider(
    "sfdx-hardis-status",
    new HardisStatusProvider(currentWorkspaceFolderUri)
  );
  context.subscriptions.push(disposableTreeInfo);

  // Request user to install/upgrade dependencies
  vscode.window
    .showInformationMessage(
      "Do you want to install/upgrade SFDX Hardis dependent tools ? \n(If your install is recent, you probably do not need to do that)",
      "Yes",
      "No"
    )
    .then((selection) => {
      if (selection === "Yes") {
        vscode.commands.executeCommand("vscode-sfdx-hardis.install");
      }
    });
}

// this method is called when your extension is deactivated
export function deactivate() {}
