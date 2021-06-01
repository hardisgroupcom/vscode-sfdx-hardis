import * as vscode from "vscode";

export class HardisDebugger {
  constructor() {
    this.registerCommands();
  }

  private registerCommands() {
    vscode.commands.registerCommand("vscode-sfdx-hardis.debug.activate", () => {
      this.activateDebugger();
    });
    vscode.commands.registerCommand(
      "vscode-sfdx-hardis.debug.deactivate",
      () => {
        this.deactivateDebugger();
      }
    );
    vscode.commands.registerCommand("vscode-sfdx-hardis.debug.launch", () => {
      this.launchDebugger();
    });
  }

  private activateDebugger() {
    vscode.commands.executeCommand("sfdx.force.start.apex.debug.logging");
  }

  private deactivateDebugger() {
    vscode.commands.executeCommand("sfdx.force.stop.apex.debug.logging");
  }

  private async launchDebugger() {
    await vscode.commands.executeCommand("sfdx.force.apex.log.get");
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

  dispose() {}
}
