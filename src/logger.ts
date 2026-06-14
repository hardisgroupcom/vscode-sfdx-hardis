import * as vscode from "vscode";

let loggerInstance: Logger;

// Cached value of the `vsCodeSfdxHardis.debugVsCodeSfdxHardis` setting so logPerf
// (called on every CLI command via [shell-perf]) does not re-read configuration
// each time. Refreshed when the setting changes so toggling needs no reload.
let perfDebugEnabled: boolean | null = null;
function isPerfDebugEnabled(): boolean {
  if (perfDebugEnabled === null) {
    perfDebugEnabled =
      vscode.workspace
        .getConfiguration("vsCodeSfdxHardis")
        .get("debugVsCodeSfdxHardis") === true;
    // Register once: keep the cached value in sync with the setting.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("vsCodeSfdxHardis.debugVsCodeSfdxHardis")
      ) {
        perfDebugEnabled =
          vscode.workspace
            .getConfiguration("vsCodeSfdxHardis")
            .get("debugVsCodeSfdxHardis") === true;
      }
    });
  }
  return perfDebugEnabled;
}

export class Logger {
  outputChannel: any;

  constructor(vsCodeWindow: any) {
    this.outputChannel = vsCodeWindow.createOutputChannel("SFDX Hardis");
    loggerInstance = this;
  }

  static showOutputChannel(): void {
    if (loggerInstance) {
      loggerInstance.outputChannel.show();
    }
  }

  static log(str: any): void {
    if (loggerInstance) {
      console.log(str);
      for (const line of str.toString().split("\n")) {
        loggerInstance.outputChannelLog(line);
      }
    } else {
      console.log(str);
    }
  }

  // Logs only when the `vsCodeSfdxHardis.debugVsCodeSfdxHardis` setting is true.
  // Used for verbose diagnostic/performance traces (e.g. [pipeline-perf],
  // [shell-perf], [status-perf]) so they stay silent for normal users.
  static logPerf(str: any): void {
    try {
      if (isPerfDebugEnabled()) {
        Logger.log(str);
      }
    } catch {
      // Configuration not available (e.g. before activation) — stay silent.
    }
  }

  outputChannelLog(str: string) {
    this.outputChannel.appendLine(str);
  }
}
