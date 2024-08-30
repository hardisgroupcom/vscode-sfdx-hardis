import * as vscode from "vscode";
import { hasSfdxProjectJson } from "./utils";
import { Logger } from "./logger";

export class HardisDebugger {
  isDebugLogsActive = false;
  disposables: vscode.Disposable[] = [];

  constructor() {
    this.registerCommands();
    this.registerHandlers();
  }

  private registerCommands() {
    const cmdActivate = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.debug.activate",
      () => {
        this.activateDebugger();
      },
    );
    const cmdDeactivate = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.debug.deactivate",
      () => {
        this.deactivateDebugger();
      },
    );
    const cmdLaunch = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.debug.launch",
      () => {
        this.launchDebugger();
      },
    );
    const cmdLogTail = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.debug.logtail",
      () => {
        this.launchLogTail();
      },
    );
    const cmdToggleCheckpoint = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.toggleCheckpoint",
      () => {
        this.toggleCheckpoint();
      },
    );
    this.disposables.push(
      ...[cmdActivate, cmdDeactivate, cmdLaunch, cmdToggleCheckpoint],
    );
  }

  private registerHandlers() {
    const breakpointsHandler = vscode.debug.onDidChangeBreakpoints(
      async (breakpointChangeEvent) => {
        let requiresActivateDebugLogs = false;
        let requiresCheckpointUpload = false;
        for (const breakpoint of breakpointChangeEvent.added ||
          breakpointChangeEvent.changed ||
          []) {
          requiresActivateDebugLogs = true;
          if (breakpoint?.condition === "checkpoint") {
            requiresCheckpointUpload = true;
            break;
          }
        }
        if (requiresActivateDebugLogs) {
          await this.manageDebugLogsActivation();
        }
        if (requiresCheckpointUpload === true) {
          await this.runSfdxExtensionCommand("sf.create.checkpoints");
        }
      },
    );
    this.disposables.push(breakpointsHandler);
  }

  private async activateDebugger() {
    await this.runSfdxExtensionCommand("sf.start.apex.debug.logging");
    this.isDebugLogsActive = true;
  }

  private async deactivateDebugger() {
    await this.runSfdxExtensionCommand("sf.stop.apex.debug.logging");
    this.isDebugLogsActive = false;
  }

  private async toggleCheckpoint() {
    await this.runSfdxExtensionCommand("sf.toggle.checkpoint");
  }

  private async manageDebugLogsActivation() {
    if (this.isDebugLogsActive) {
      return;
    }
    await this.activateDebugger();
  }

  private async launchDebugger() {
    await this.runSfdxExtensionCommand("sf.apex.log.get");
    let launched = false;
    // Wait for user to select a log
    const listener = vscode.window.onDidChangeActiveTextEditor((textEditor) => {
      if (textEditor && textEditor?.document?.uri?.fsPath.endsWith(".log")) {
        launched = true;
        this.debugLogFile(textEditor.document.uri);
      }
      listener.dispose();
    });
    // Launch debugger from active log file opened in text editor
    setTimeout(() => {
      if (
        launched === false &&
        vscode.window.activeTextEditor?.document?.uri?.fsPath.endsWith(".log")
      ) {
        this.debugLogFile(vscode.window.activeTextEditor.document.uri);
        listener.dispose();
      }
    }, 5000);
  }

  private async launchLogTail() {
    await this.manageDebugLogsActivation();

    const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    const value = await new Promise<any>((resolve) => {
      quickpick.ignoreFocusOut = true;
      quickpick.title = "Please select the type of logs you want to display";
      quickpick.canSelectMany = false;
      quickpick.items = [
        { label: "Only logs from System.debug()" },
        { label: "All logs" },
      ];
      // Show quickpick item
      quickpick.show();
      // Handle user selection
      quickpick.onDidAccept(() => {
        if (quickpick.selectedItems.length > 0) {
          const value =
            quickpick.selectedItems[0].label === "All logs"
              ? "all"
              : "USER_DEBUG";
          resolve(value);
        }
      });
      // Handle ESCAPE key
      quickpick.onDidHide(() => resolve(["exitNow"]));
    });
    quickpick.dispose();

    if (value === "exitNow") {
      return;
    }
    let logTailCommand = "sf apex tail log --color";
    if (value === "USER_DEBUG") {
      logTailCommand += " | grep USER_DEBUG";
    }
    vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      logTailCommand,
    );
  }

  private debugLogFile(uri: vscode.Uri) {
    vscode.commands.executeCommand(
      "sf.launch.apex.replay.debugger.with.current.file",
      uri,
    );
  }

  private async runSfdxExtensionCommand(command: string) {
    let res;
    try {
      res = await vscode.commands.executeCommand(command);
    } catch (e: any) {
      Logger.log(`Error while running VsCode command ${command}`);
      Logger.log(`Error detail: ${e.message}`);
      if (!hasSfdxProjectJson({ recalc: true })) {
        // Missing apex sources
        vscode.window
          .showWarningMessage(
            "🦙 No local apex sources found. Click to retrieve them :)",
            "Retrieve Apex sources from org",
          )
          .then((selection) => {
            if (selection === "Retrieve Apex sources from org") {
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.execute-command",
                "sf hardis:org:retrieve:sources:dx -k ApexClass,ApexTrigger,ApexPage",
              );
            }
          });
      } else {
        // Salesforce extension command not found
        vscode.window.showWarningMessage(
          `🦙 Salesforce Extension pack command error. If it is installed, just wait for it to be initialized :)\nDetail: ${
            e.message || JSON.stringify(e)
          }`,
          "Close",
        );
      }
      return null;
    }
    return res;
  }

  dispose() {}
}
