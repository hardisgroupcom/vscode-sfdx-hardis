import * as vscode from "vscode";
import { execSfdxJson, hasSfdxProjectJson } from "./utils";
import { Logger } from "./logger";
import { t } from "./i18n/i18n";

const REPLAY_DEBUG_LEVEL_PREFIX = "ReplayDebuggerLevels";
const TRACE_FLAG_DURATION_MS = 30 * 60 * 1000;

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
      ...[
        cmdActivate,
        cmdDeactivate,
        cmdLaunch,
        cmdLogTail,
        cmdToggleCheckpoint,
      ],
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
          // Pass if breakpoint is not a SourceBreakpoint on Apex class
          if (
            !(breakpoint instanceof vscode.SourceBreakpoint) ||
            !breakpoint.location.uri.fsPath.endsWith(".cls")
          ) {
            continue;
          }
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

  private async activateDebugger(): Promise<boolean> {
    try {
      const userId = await this.getCurrentUserId();
      const debugLevelId = await this.getReplayDebuggerLevelId();
      const traceFlag = await this.getDeveloperLogTraceFlag(userId);
      const startDate = new Date();
      const expirationDate = this.getTraceFlagExpiration(
        traceFlag?.ExpirationDate,
        startDate,
      );

      const traceFlagValues =
        `DebugLevelId=${debugLevelId} ` +
        `StartDate=${startDate.toISOString()} ` +
        `ExpirationDate=${expirationDate.toISOString()}`;

      if (traceFlag) {
        await this.runSfJsonCommand(
          `sf data update record --use-tooling-api ` +
            `--sobject TraceFlag ` +
            `--record-id ${traceFlag.Id} ` +
            `--values "${traceFlagValues}"`,
          "Unable to update the Apex TraceFlag.",
        );
      } else {
        await this.runSfJsonCommand(
          `sf data create record --use-tooling-api ` +
            `--sobject TraceFlag ` +
            `--values "TracedEntityId=${userId} ` +
            `LogType=DEVELOPER_LOG ${traceFlagValues}"`,
          "Unable to create the Apex TraceFlag.",
        );
      }

      this.isDebugLogsActive = true;
      return true;
    } catch (error: any) {
      this.isDebugLogsActive = false;
      this.displayDebugLogTracingError("activate", error);
      return false;
    }
  }

  private async deactivateDebugger(): Promise<boolean> {
    try {
      const userId = await this.getCurrentUserId();
      const traceFlag = await this.getDeveloperLogTraceFlag(userId);

      if (traceFlag) {
        await this.runSfJsonCommand(
          `sf data delete record --use-tooling-api ` +
            `--sobject TraceFlag ` +
            `--record-id ${traceFlag.Id}`,
          "Unable to delete the Apex TraceFlag.",
        );
      }

      this.isDebugLogsActive = false;
      return true;
    } catch (error: any) {
      this.displayDebugLogTracingError("deactivate", error);
      return false;
    }
  }

  private async toggleCheckpoint() {
    await this.runSfdxExtensionCommand("sf.toggle.checkpoint");
  }

  private async manageDebugLogsActivation(): Promise<boolean> {
    if (this.isDebugLogsActive) {
      return true;
    }

    return await this.activateDebugger();
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
    const interval = setInterval(() => {
      if (
        launched === false &&
        vscode.window.activeTextEditor?.document?.uri?.fsPath.endsWith(".log")
      ) {
        launched = true;
        this.debugLogFile(vscode.window.activeTextEditor.document.uri);
        listener.dispose();
        clearInterval(interval);
      } else if (launched === true) {
        clearInterval(interval);
      }
    }, 500);
  }

  private async launchLogTail() {
    const tracingIsActive = await this.manageDebugLogsActivation();

    if (!tracingIsActive) {
      return;
    }

    const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    const allLogsLabel = t("allLogsLabel");
    const value = await new Promise<any>((resolve) => {
      quickpick.ignoreFocusOut = true;
      quickpick.title = "Please select the type of logs you want to display";
      quickpick.canSelectMany = false;
      quickpick.items = [
        { label: t("onlyLogsFromSystemDebug") },
        { label: allLogsLabel },
      ];
      // Show quickpick item
      quickpick.show();
      // Handle user selection
      quickpick.onDidAccept(() => {
        if (quickpick.selectedItems.length > 0) {
          const value =
            quickpick.selectedItems[0].label === allLogsLabel
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
    let logTailCommand = "sf apex tail log --color --skip-trace-flag";
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

  private async getCurrentUserId(): Promise<string> {
    const orgDisplayResult = await this.runSfJsonCommand(
      "sf org display",
      "Unable to display the current Salesforce org.",
    );

    const username = orgDisplayResult?.result?.username;

    if (!username) {
      throw new Error(
        "Unable to determine the username of the current Salesforce org.",
      );
    }

    const userQueryResult = await this.runSfJsonCommand(
      `sf data query --query ` +
        `"SELECT Id FROM User ` +
        `WHERE Username = '${this.escapeSoqlString(username)}' ` +
        `LIMIT 1"`,
      `Unable to query the Salesforce user record for ${username}.`,
    );

    const userId = userQueryResult?.result?.records?.[0]?.Id;

    if (!userId) {
      throw new Error(
        `Unable to determine the Salesforce user ID for ${username}.`,
      );
    }

    return userId;
  }

  private async getReplayDebuggerLevelId(): Promise<string> {
    const debugLevelQueryResult = await this.runSfJsonCommand(
      `sf data query --use-tooling-api --query ` +
        `"SELECT Id FROM DebugLevel ` +
        `WHERE DeveloperName LIKE '${REPLAY_DEBUG_LEVEL_PREFIX}%' ` +
        `AND CreatedDate <= ${new Date().toISOString()} ` +
        `ORDER BY CreatedDate DESC ` +
        `LIMIT 1"`,
      "Unable to query Replay Debugger log levels.",
    );

    let debugLevelId = debugLevelQueryResult?.result?.records?.[0]?.Id;

    if (!debugLevelId) {
      const debugLevelName = `${REPLAY_DEBUG_LEVEL_PREFIX}${Date.now()}`;

      const createResult = await this.runSfJsonCommand(
        `sf data create record --use-tooling-api ` +
          `--sobject DebugLevel ` +
          `--values "DeveloperName=${debugLevelName} ` +
          `MasterLabel=${debugLevelName} ` +
          `ApexCode=FINEST Visualforce=FINER"`,
        "Unable to create the Replay Debugger log level.",
      );

      debugLevelId = createResult?.result?.id;
    } else {
      await this.runSfJsonCommand(
        `sf data update record --use-tooling-api ` +
          `--sobject DebugLevel ` +
          `--record-id ${debugLevelId} ` +
          `--values "ApexCode=FINEST Visualforce=FINER"`,
        "Unable to update the Replay Debugger log level.",
      );
    }

    if (!debugLevelId) {
      throw new Error(
        "Unable to determine the Replay Debugger log level ID.",
      );
    }

    return debugLevelId;
  }

  private async getDeveloperLogTraceFlag(
    userId: string,
  ): Promise<any | null> {
    const traceFlagQueryResult = await this.runSfJsonCommand(
      `sf data query --use-tooling-api --query ` +
        `"SELECT Id, ExpirationDate FROM TraceFlag ` +
        `WHERE LogType = 'DEVELOPER_LOG' ` +
        `AND TracedEntityId = '${userId}' ` +
        `AND CreatedDate <= ${new Date().toISOString()} ` +
        `ORDER BY CreatedDate DESC ` +
        `LIMIT 1"`,
      "Unable to query the current user's Apex TraceFlag.",
    );

    return traceFlagQueryResult?.result?.records?.[0] ?? null;
  }

  private getTraceFlagExpiration(
    currentExpirationDate: string | undefined,
    startDate: Date,
  ): Date {
    const requestedExpirationDate = new Date(
      startDate.getTime() + TRACE_FLAG_DURATION_MS,
    );

    if (!currentExpirationDate) {
      return requestedExpirationDate;
    }

    const existingExpirationDate = new Date(currentExpirationDate);

    return existingExpirationDate > requestedExpirationDate
      ? existingExpirationDate
      : requestedExpirationDate;
  }

  private async runSfJsonCommand(
    command: string,
    errorMessage: string,
  ): Promise<any> {
    const result = await execSfdxJson(command, {
      fail: false,
      output: false,
      spinner: false,
    });

    if (result?.status !== 0) {
      throw new Error(
        result?.message || result?.errorMessage || errorMessage,
      );
    }

    return result;
  }

  private displayDebugLogTracingError(
    action: "activate" | "deactivate",
    error: any,
  ): void {
    const detail = error?.message || JSON.stringify(error);

    Logger.log(`Unable to ${action} Apex debug log tracing.`);
    Logger.log(`Error detail: ${detail}`);

    vscode.window.showWarningMessage(
      t("salesforceExtensionPackError", { detail }),
      t("close"),
    );
  }

  private escapeSoqlString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  private async runSfdxExtensionCommand(command: string) {
    let res;
    try {
      res = await vscode.commands.executeCommand(command);
    } catch (e: any) {
      Logger.log(`Error while running VsCode command ${command}`);
      Logger.log(`Error detail: ${e.message}`);

      if (!hasSfdxProjectJson({ recalc: true })) {
        // Missing Apex sources
        vscode.window
          .showWarningMessage(
            t("noLocalApexSources"),
            t("retrieveApexSourcesFromOrg"),
          )
          .then((selection) => {
            if (selection === t("retrieveApexSourcesFromOrg")) {
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.execute-command",
                "sf hardis:org:retrieve:sources:dx -k ApexClass,ApexTrigger,ApexPage",
              );
            }
          });
      } else {
        // Salesforce extension command not found
        vscode.window.showWarningMessage(
          t("salesforceExtensionPackError", {
            detail: e.message || JSON.stringify(e),
          }),
          t("close"),
        );
      }

      return null;
    }
    return res;
  }

  dispose() {}
}
