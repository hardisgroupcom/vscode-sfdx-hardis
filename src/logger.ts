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

// A single log call can carry a multi-MB CLI output (e.g. a failed
// `sf plugins install ...` dump): each line is one appendLine RPC to the
// renderer, so an oversized message freezes the extension host. Capped here so
// every caller is covered, success and error paths alike.
const MAX_LOGGED_CHARS = 100_000;

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
    let text = String(str ?? "");
    if (text.length > MAX_LOGGED_CHARS) {
      text =
        text.slice(0, MAX_LOGGED_CHARS) +
        `\n[vscode-sfdx-hardis] ... output truncated in this log (${text.length} characters total)`;
    }
    if (loggerInstance) {
      console.log(text);
      for (const line of text.split("\n")) {
        loggerInstance.outputChannelLog(line);
      }
    } else {
      console.log(text);
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
