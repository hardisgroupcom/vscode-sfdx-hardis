import * as vscode from "vscode";
import { hasSfdxProjectJson } from "./utils";

export class HardisDebugger {
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
      }
    );
    const cmdDeactivate = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.debug.deactivate",
      () => {
        this.deactivateDebugger();
      }
    );
    const cmdLaunch = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.debug.launch",
      () => {
        this.launchDebugger();
      }
    );
    const cmdToggleCheckpoint = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.toggleCheckpoint",
      () => {
        this.toggleCheckpoint();
      }
    );
    this.disposables.push(
      ...[cmdActivate, cmdDeactivate, cmdLaunch, cmdToggleCheckpoint]
    );
  }

  private registerHandlers() {
    const breakpointsHandler = vscode.debug.onDidChangeBreakpoints(
      async (breakpointChangeEvent) => {
        let requiresCheckpointUpload = false;
        for (const breakpoint of breakpointChangeEvent.added ||
          breakpointChangeEvent.changed ||
          []) {
          if (breakpoint?.condition === "checkpoint") {
            requiresCheckpointUpload = true;
            break;
          }
        }
        if (requiresCheckpointUpload === true) {
          await this.runSfdxExtensionCommand("sfdx.create.checkpoints");
        }
      }
    );
    this.disposables.push(breakpointsHandler);
  }

  private async activateDebugger() {
    await this.runSfdxExtensionCommand("sfdx.force.start.apex.debug.logging");
  }

  private async deactivateDebugger() {
    await this.runSfdxExtensionCommand("sfdx.force.stop.apex.debug.logging");
  }

  private async toggleCheckpoint() {
    await this.runSfdxExtensionCommand("sfdx.toggle.checkpoint");
  }

  private async launchDebugger() {
    await this.runSfdxExtensionCommand("sfdx.force.apex.log.get");
    let launched = false;
    const listener = vscode.window.onDidChangeActiveTextEditor((textEditor) => {
      if (textEditor && textEditor?.document?.uri?.fsPath.endsWith(".log")) {
        launched = true;
        this.debugLogFile(textEditor.document.uri);
        listener.dispose();
      }
    });
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

  private debugLogFile(uri: vscode.Uri) {
    vscode.commands.executeCommand("sfdx.launch.replay.debugger.logfile", uri);
  }

  private async runSfdxExtensionCommand(command: string) {
    let res;
    try {
      res = await vscode.commands.executeCommand(command);
    } catch (e) {
      if (!hasSfdxProjectJson({ recalc: true })) {
        // Missing apex sources
        vscode.window
          .showWarningMessage(
            "No local apex sources found. Click to retrieve them :)",
            "Retrieve Apex sources from org"
          )
          .then((selection) => {
            if (selection === "Retrieve Apex sources from org") {
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.execute-command",
                "sfdx hardis:org:retrieve:sources:dx -k ApexClass,ApexTrigger,ApexPage"
              );
            }
          });
      } else {
        // Salesforce extension command not found
        vscode.window.showWarningMessage(
          `Salesforce Extension pack command not found. If it is installed, just wait for it to be initialized :)`
        );
      }
      return null;
    }
    return res;
  }

  dispose() {}
}
