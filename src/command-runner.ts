import treeKill from "tree-kill";
import * as vscode from "vscode";
import { LwcPanelManager } from "./lwc-panel-manager";
import { t } from "./i18n/i18n";
import { isCommandAllowedByCustomOrPluginRegistry } from "./utils/sfdx-hardis-config-utils";
import { spawn } from "child_process";
import {
  containsCertificateIssue,
  getGitBashPath,
  promptToDisableTlsIfNeeded,
  stripAnsi,
} from "./utils";
import { Logger } from "./logger";

const SF_STANDARD_COMMANDS = [
  "sf agent",
  "sf alias",
  "sf apex",
  "sf api",
  "sf cmdt",
  "sf code-analyzer",
  "sf community",
  "sf config",
  "sf data",
  "sf dev",
  "sf doctor",
  "sf flow",
  "sf force",
  "sf info",
  "sf lightning",
  "sf logic",
  "sf org",
  "sf package1",
  "sf package",
  "sf plugins",
  "sf project",
  "sf schema",
  "sf sobject",
  "sf template",
  "sf ui-bundle",
];

/**
 * CommandRunner handles all logic related to terminal management and command execution.
 * It is designed to be used by the Commands class.
 */
export class CommandRunner {
  private commandsInstance: any;
  private terminalStack: vscode.Terminal[] = [];
  private terminalIsRunning = false;
  private outputChannel?: vscode.OutputChannel;
  private allowNextDuplicateCommand = false;
  private debugNodeJs = false;
  /**
   * Map of active commands: key is command string, value is { type: 'background'|'terminal', process?: ChildProcess, sentToTerminal?: boolean }
   */
  private activeCommands: Map<
    string,
    { type: "background" | "terminal"; process?: any; sentToTerminal?: boolean }
  > = new Map();

  constructor(commandsInstance: any) {
    this.commandsInstance = commandsInstance;
    // Optionally, sync terminalStack with commandsInstance if needed
    if (Array.isArray(commandsInstance.terminalStack)) {
      this.terminalStack = commandsInstance.terminalStack;
    }
  }

  /**
   * Returns the latest terminal in the stack.
   */
  getLatestTerminal(): vscode.Terminal | undefined {
    return this.terminalStack[this.terminalStack.length - 1];
  }

  private isCommandAllowedInBackground(command: string): boolean {
    const trimmedCommand = command.trimStart();
    if (
      trimmedCommand.startsWith("sf hardis") ||
      trimmedCommand.startsWith("npm install @salesforce/")
    ) {
      return true;
    }
    if (trimmedCommand.startsWith("sf ")) {
      return (
        this.isSfStandardCommand(trimmedCommand) ||
        isCommandAllowedByCustomOrPluginRegistry(trimmedCommand)
      );
    }
    return false;
  }

  private isSfStandardCommand(command: string): boolean {
    const trimmedCommand = command.trimStart();
    return SF_STANDARD_COMMANDS.some((prefix) =>
      trimmedCommand.startsWith(prefix),
    );
  }

  executeCommand(sfdxHardisCommand: string, extraEnv?: Record<string, string>) {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    this.debugNodeJs = config.get("debugSfdxHardisCommands") ?? false;
    const trimmedCommand = sfdxHardisCommand.trimStart();
    const isNpmInstallSf = trimmedCommand.startsWith(
      "npm install @salesforce/",
    );
    const isBackgroundMode =
      config.get("userInputCommandLineIfLWC") === "background";
    const isHardisCommand = trimmedCommand.startsWith("sf hardis");
    const isCustomOrPluginCommand =
      !isHardisCommand &&
      isCommandAllowedByCustomOrPluginRegistry(trimmedCommand);

    if (
      !this.isSfStandardCommand(trimmedCommand) &&
      !isHardisCommand &&
      !isCustomOrPluginCommand &&
      !isNpmInstallSf
    ) {
      vscode.window.showErrorMessage(t("commandNotAllowedOnlyRegistered"));
      return;
    }

    // For custom/plugin commands: check autorunCommands and offer "Always authorize" option
    if (isCustomOrPluginCommand) {
      const autorunCommands = config.get<string[]>("autorunCommands", []);
      const isAutorun = autorunCommands.some((cmd) =>
        trimmedCommand.startsWith(cmd.trim()),
      );

      if (isAutorun) {
        // Skip prompt and run according to active mode
        this.executeCommandUsingCurrentMode(
          isBackgroundMode,
          sfdxHardisCommand,
          extraEnv,
        );
        return;
      }

      // Not in autorun list — ask for confirmation with "Always authorize" option
      vscode.window
        .showWarningMessage(
          t("customOrPluginCommandAuthorizationPrompt", {
            command: trimmedCommand,
          }),
          t("allowOnce"),
          t("alwaysAllow"),
          t("cancel"),
        )
        .then(async (selection) => {
          if (selection === t("allowOnce")) {
            this.executeCommandUsingCurrentMode(
              isBackgroundMode,
              sfdxHardisCommand,
              extraEnv,
            );
          } else if (selection === t("alwaysAllow")) {
            // Add command to autorunCommands
            const updated = [...autorunCommands, trimmedCommand];
            await config.update(
              "autorunCommands",
              updated,
              vscode.ConfigurationTarget.Global,
            );
            this.executeCommandUsingCurrentMode(
              isBackgroundMode,
              sfdxHardisCommand,
              extraEnv,
            );
          }
        });
      return;
    }

    if (!isBackgroundMode) {
      this.executeCommandTerminal(sfdxHardisCommand, extraEnv);
      return;
    }

    // For sf hardis commands: check background mode allowlist
    if (!this.isCommandAllowedInBackground(sfdxHardisCommand)) {
      // This should not happen for sf hardis commands, but handle gracefully
      vscode.window.showErrorMessage(t("hardisCommandNotAllowedInBackground"));
      return;
    }

    this.executeCommandBackground(sfdxHardisCommand, extraEnv);
  }

  private executeCommandUsingCurrentMode(
    isBackgroundMode: boolean,
    command: string,
    extraEnv?: Record<string, string>,
  ) {
    if (isBackgroundMode && this.isCommandAllowedInBackground(command)) {
      this.executeCommandBackground(command, extraEnv);
    } else {
      this.executeCommandTerminal(command, extraEnv);
    }
  }

  /**
   * Preprocess, validate, and send telemetry for a command. Returns the processed command or null if invalid.
   */
  preprocessAndValidateCommand(
    command: string,
    type: "background" | "terminal" = "background",
    process?: any,
  ): string | null {
    // Block dangerous or invalid commands
    if (
      !(
        command.trimStart().startsWith("sf ") ||
        command.trimStart().startsWith("npm install @salesforce/")
      ) ||
      command.includes("&&") ||
      command.includes("||")
    ) {
      if (type === "background") {
        if (this.commandsInstance?.logger) {
          this.commandsInstance.logger.log("Invalid command blocked");
        }
        vscode.window.showErrorMessage(
          t("blockedOnlySfCommandsNoLogicalOperators", { command }),
        );
        return null;
      }
    }

    if (type === "background" && !this.isCommandAllowedInBackground(command)) {
      vscode.window.showErrorMessage(
        t("blockedBackgroundModeOnlyHardisOrRegisteredCustom"),
      );
      return null;
    }
    let cmd = command;
    // Add --skipauth argument when necessary
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    if (
      config.get("disableDefaultOrgAuthenticationCheck") === true &&
      cmd.startsWith("sf hardis") &&
      !cmd.includes("hardis:org:configure:monitoring") &&
      !cmd.includes("--skipauth") &&
      !cmd.includes("&&")
    ) {
      cmd += ` --skipauth`;
    }
    // Add --websocket argument when necessary
    if (
      (cmd.startsWith("sf hardis") ||
        cmd.includes("sf hardis:work:ws --event")) &&
      !cmd.includes("--websocket") &&
      (!cmd.includes("&&") ||
        cmd.endsWith("sf hardis:work:ws --event refreshPlugins"))
    ) {
      let webSocketAlive = false;
      if (
        this.commandsInstance.disposableWebSocketServer &&
        this.commandsInstance.disposableWebSocketServer.websocketHostPort !==
          null
      ) {
        cmd += ` --websocket ${this.commandsInstance.disposableWebSocketServer.websocketHostPort}`;
        webSocketAlive = true;
      }
      if (type === "background" && !webSocketAlive) {
        vscode.window.showErrorMessage(t("vscodeSfdxHardisNotInitializedYet"));
        return null;
      }
    }

    // Check for duplicate running command
    /* jscpd:ignore-start */
    const existing = this.activeCommands.get(cmd);
    if (
      existing &&
      !cmd.includes("hardis:project:configure:auth") &&
      this.allowNextDuplicateCommand === false
    ) {
      // For background: process is not killed and not closed/errored
      if (
        existing.type === "background" &&
        existing.process &&
        !existing.process.killed &&
        !existing.process._closed
      ) {
        this.showDuplicateCommandWarning();
        return null;
      }
      // For terminal: command was sent to terminal less than 3 seconds ago (heuristic to avoid false positives)
      if (existing.type === "terminal") {
        this.showDuplicateCommandWarning();
        return null;
      }
    }
    this.allowNextDuplicateCommand = false;
    /* jscpd:ignore-end */
    // Telemetry: Send only the 2 first portions of the command
    if (this.commandsInstance.reporter) {
      const truncatedCommand = cmd.split(" ").slice(0, 2).join(" ");
      this.commandsInstance.reporter.sendTelemetryEvent("command", {
        command: truncatedCommand,
      });
    }
    // Register as active
    if (type === "background" && process) {
      this.activeCommands.set(cmd, { type, process });
    } else if (type === "terminal") {
      this.activeCommands.set(cmd, { type, sentToTerminal: true });
    }
    return cmd;
  }

  showDuplicateCommandWarning() {
    const buttonMsg = t("runDuplicateCommandAnyway");
    vscode.window
      .showErrorMessage(t("duplicateCommandWarning"), buttonMsg)
      .then((selection) => {
        if (selection === buttonMsg) {
          this.allowNextDuplicateCommand = true;
        }
      });
  }

  executeCommandBackground(
    sfdxHardisCommand: string,
    extraEnv?: Record<string, string>,
  ) {
    // Preprocess, validate, and send telemetry, and register as active
    let preprocessedCommand: string | null = null;
    preprocessedCommand = this.preprocessAndValidateCommand(
      sfdxHardisCommand,
      "background",
    );
    if (!preprocessedCommand) {
      return;
    }
    // Use spawn to run the command in the background
    const commandParts = preprocessedCommand.split(" ");
    const command = commandParts[0];
    let childProcess: any;
    const spawnOptions: any = {
      shell: true,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
      env: { ...process.env },
    };
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    const langSetting = config.get<string>("lang", "auto");
    if (langSetting && langSetting !== "auto" && !extraEnv?.SFDX_HARDIS_LANG) {
      spawnOptions.env.SFDX_HARDIS_LANG = langSetting;
    }
    if (config.get("disableTlsRejectUnauthorized") === true) {
      spawnOptions.env = {
        ...spawnOptions.env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      };
    }
    if (this.debugNodeJs && !extraEnv?.NODE_OPTIONS) {
      spawnOptions.env = {
        ...spawnOptions.env,
        NODE_OPTIONS: "--inspect-brk",
      };
    }
    // Merge any caller-supplied extra env vars (e.g. PROMPTS_LANGUAGE from doc workbench)
    if (extraEnv && typeof extraEnv === "object") {
      spawnOptions.env = { ...spawnOptions.env, ...extraEnv };
    }
    const gitBashPath = getGitBashPath();
    if (process.platform === "win32" && gitBashPath) {
      spawnOptions.shell = gitBashPath;
    }
    try {
      childProcess = spawn(command!, commandParts.slice(1), spawnOptions);
    } catch (e) {
      let msg = "";
      if (e && typeof e === "object" && "message" in e) {
        msg = (e as any).message;
      } else {
        msg = String(e);
      }
      vscode.window.showErrorMessage(t("failedToStartCommand", { msg }));
      return;
    }
    // Register as active now that process exists
    this.activeCommands.set(preprocessedCommand, {
      type: "background",
      process: childProcess,
    });
    // Create or show a VS Code output channel for background command output
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel(
        "SFDX Hardis Commands",
      );
    }
    const output = this.outputChannel;

    output.appendLine(`[Started] ${preprocessedCommand}`);

    // Show a blue progress notification at the bottom right, with cancel support
    let progressResolve: (() => void) | undefined;
    let progressClosed = false;
    let killed = false;
    // Start the progress notification
    let displayCommandForPopup = preprocessedCommand;
    const wsIndex = displayCommandForPopup.indexOf("--websocket");
    if (wsIndex !== -1) {
      displayCommandForPopup = displayCommandForPopup
        .substring(0, wsIndex)
        .trim();
    }
    const skipAuthIndex = displayCommandForPopup.indexOf("--skipauth");
    if (skipAuthIndex !== -1) {
      displayCommandForPopup = displayCommandForPopup
        .substring(0, skipAuthIndex)
        .trim();
    }
    let displayPopupMessage = t("initializingCommand", {
      command: displayCommandForPopup,
    });
    if (this.debugNodeJs) {
      displayPopupMessage += " " + t("debugMode");
    }
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: displayPopupMessage,
        cancellable: true,
      },
      (progress, token) =>
        new Promise<void>((resolve) => {
          progressResolve = () => {
            if (!progressClosed) {
              progressClosed = true;
              resolve();
            }
          };
          token.onCancellationRequested(() => {
            if (!killed) {
              killed = true;
              if (childProcess && childProcess.pid) {
                try {
                  treeKill(childProcess.pid, "SIGTERM", (err) => {
                    if (err) {
                      output.appendLine(
                        `[Cancelled by user] Error killing child process: ${err.message}`,
                      );
                    } else {
                      output.appendLine(
                        `[Cancelled by user] Successfully killed ${preprocessedCommand}`,
                      );
                    }
                    progressResolve && progressResolve();
                  });
                } catch (error: any) {
                  output.appendLine(
                    "[Cancelled by user] Error killing child process:" +
                      error.message,
                  );
                  progressResolve && progressResolve();
                }
              } else {
                progressResolve && progressResolve();
              }
            }
          });
        }),
    );
    function closeProgress() {
      if (progressResolve) {
        progressResolve();
      }
    }
    function handleLogLine(cleanLine: string) {
      if (cleanLine?.startsWith("WS Client started")) {
        closeProgress();
      }
    }
    const stderrLines: string[] = [];
    let certificatePromptTriggered = false;
    const tryNotifyCertificateIssue = (message?: string) => {
      if (certificatePromptTriggered) {
        return;
      }
      if (!containsCertificateIssue(message)) {
        return;
      }
      certificatePromptTriggered = true;
      void promptToDisableTlsIfNeeded(message);
    };

    // Handle output and errors
    childProcess.stdout?.on("data", (data: any) => {
      let clean = stripAnsi(data.toString());
      output.append(clean);
      handleLogLine(clean);
    });
    childProcess.stderr?.on("data", (data: any) => {
      let clean = stripAnsi(data.toString());
      output.append(`[stderr] ${clean}`);
      handleLogLine(clean);
      stderrLines.push(clean);
      tryNotifyCertificateIssue(clean);
    });
    childProcess.on("close", (code: any) => {
      output.appendLine(`[Ended] ${preprocessedCommand} (exit code: ${code})`);
      this.activeCommands.delete(preprocessedCommand);
      closeProgress();
      if (code && code !== 0) {
        tryNotifyCertificateIssue(stderrLines.join("\n"));
      }
      // Send message to panel if still marked as active and running
      setTimeout(() => {
        const panelManager = LwcPanelManager.getInstance();
        if (!panelManager) {
          return;
        }
        panelManager.sendMessageToAllPanels({
          type: "backgroundCommandEnded",
          data: {
            command: preprocessedCommand,
            commandShort: preprocessedCommand
              .replace("sf ", "")
              .split("--")[0]
              .trim(),
            exitCode: code,
            stderrLines: stderrLines,
          },
        });
      }, 3000);
    });
    childProcess.on("error", (err: any) => {
      output.appendLine(`[Error] ${err.message}`);
      this.activeCommands.delete(preprocessedCommand);
      closeProgress();
      tryNotifyCertificateIssue(err?.message || "");
    });
  }

  /**
   * Main entry point for executing a command in a terminal, handling terminal stack and LWC panel logic.
   */
  executeCommandTerminal(
    sfdxHardisCommand: string,
    extraEnv?: Record<string, string>,
  ) {
    // Filter killed terminals
    this.terminalStack = this.terminalStack.filter(
      (terminal: vscode.Terminal) =>
        vscode.window.terminals.filter(
          (vsTerminal) => vsTerminal.processId === terminal.processId,
        ).length > 0,
    );
    // Sync with parent
    this.commandsInstance.terminalStack = this.terminalStack;

    // Check if any LWC panel is running a command
    let panelIsBusy = false;
    try {
      const panelManager = LwcPanelManager.getInstance();
      const activeIds = panelManager.getActivePanelIds();
      for (const id of activeIds) {
        if (id.startsWith("s-command-execution-")) {
          const panel = panelManager.getPanel(id);
          if (panel && panel.getTitle && typeof panel.getTitle === "function") {
            const title = panel.getTitle();
            if (title.includes("Running")) {
              panelIsBusy = true;
            }
            break;
          }
        }
      }
    } catch {
      Logger.log(
        "Error checking LWC panel status, assuming no panels are busy.",
      );
    }

    if (
      panelIsBusy ||
      this.terminalStack.length === 0 ||
      vscode.window.terminals.length === 0
    ) {
      // Check bash is the default terminal if we are on windows
      if (process.platform === "win32") {
        const terminalConfig = vscode.workspace.getConfiguration("terminal");
        const selectedTerminal: string =
          terminalConfig.integrated?.shell?.windows ||
          terminalConfig.integrated?.defaultProfile?.windows ||
          "";
        if (!selectedTerminal.toLowerCase().includes("bash")) {
          const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
          if (config.get("disableGitBashCheck") !== true) {
            vscode.commands.executeCommand(
              "workbench.action.terminal.selectDefaultShell",
            );
            vscode.window
              .showWarningMessage(
                t("gitBashRecommendedAsDefaultTerminal"),
                t("downloadGitBash"),
                t("ignore"),
                t("dontAskAgain"),
              )
              .then(async (selection) => {
                if (selection === t("downloadGitBash")) {
                  vscode.env.openExternal(
                    vscode.Uri.parse("https://git-scm.com/downloads"),
                  );
                } else if (selection === t("dontAskAgain")) {
                  await config.update("disableGitBashCheck", true);
                } else {
                  vscode.window.showInformationMessage(
                    t("disableGitBashCheckHint"),
                  );
                }
              });
            return;
          }
        }
      }
      vscode.commands.executeCommand(
        "workbench.action.terminal.newInActiveWorkspace",
        "SFDX Hardis",
      );
      new Promise((resolve) => setTimeout(resolve, 4000)).then(() => {
        const newTerminal =
          vscode.window.terminals[vscode.window.terminals.length - 1];
        this.terminalStack.push(newTerminal);
        this.commandsInstance.terminalStack = this.terminalStack;
        this.runCommandInTerminal(sfdxHardisCommand, extraEnv);
      });
    } else {
      this.runCommandInTerminal(sfdxHardisCommand, extraEnv);
    }
  }

  /**
   * Runs a command in the latest terminal, handling all SFDX/Hardis specifics.
   */
  runCommandInTerminal(command: string, extraEnv?: Record<string, string>) {
    const terminal = this.getLatestTerminal();
    if (!terminal) {
      vscode.window.showErrorMessage(t("noTerminalAvailableToRunCommand"));
      return;
    }
    terminal.show(false);

    if (this.terminalIsRunning) {
      vscode.window.showErrorMessage(t("waitForCurrentCommand"), t("close"));
      return;
    }
    // terminalIsRunning = true; //Comment until we find a way to detect that a command is running or not
    let cmd = this.preprocessAndValidateCommand(command, "terminal");
    if (!cmd) {
      return;
    }
    if (this.debugNodeJs && !extraEnv?.NODE_OPTIONS) {
      cmd = `NODE_OPTIONS=--inspect-brk ${cmd}`;
    }
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    if (config.get("disableTlsRejectUnauthorized") === true) {
      cmd = `NODE_TLS_REJECT_UNAUTHORIZED=0 ${cmd}`;
    }
    const langSetting = config.get<string>("lang", "auto");
    if (
      langSetting &&
      langSetting !== "auto" &&
      !extraEnv?.SFDX_HARDIS_LANG &&
      cmd.trimStart().startsWith("sf hardis")
    ) {
      cmd = `SFDX_HARDIS_LANG=${langSetting} ${cmd}`;
    }
    if (extraEnv && typeof extraEnv === "object") {
      const envPrefix = Object.entries(extraEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      if (envPrefix) {
        cmd = `${envPrefix} ${cmd}`;
      }
    }
    if (terminal?.name?.includes("powershell")) {
      cmd = cmd.replace(/ && /g, " ; ").replace(/echo y/g, "Write-Output 'y'");
    }
    // Send command to terminal
    terminal.sendText(cmd);
    // Mark as sent to terminal (for duplicate prevention)
    this.activeCommands.set(cmd, { type: "terminal", sentToTerminal: true });
    vscode.commands.executeCommand("workbench.action.terminal.scrollToBottom");
    // Remove from activeCommands after a delay
    setTimeout(() => {
      this.activeCommands.delete(cmd);
    }, 3000);
  }

  /**
   * Creates a new terminal and adds it to the stack.
   */
  /* jscpd:ignore-start */
  createNewTerminal() {
    vscode.commands.executeCommand(
      "workbench.action.terminal.newInActiveWorkspace",
      "SFDX Hardis",
    );
    new Promise((resolve) => setTimeout(resolve, 4000)).then(() => {
      const newTerminal =
        vscode.window.terminals[vscode.window.terminals.length - 1];
      this.terminalStack.push(newTerminal);
      this.commandsInstance.terminalStack = this.terminalStack;
    });
  }
  /* jscpd:ignore-end */
}
