import treeKill from "tree-kill";
import * as vscode from "vscode";
import { LwcPanelManager } from "./lwc-panel-manager";
import { spawn } from "child_process";
import { stripAnsi } from "./utils";
import { Logger } from "./logger";

/**
 * CommandRunner handles all logic related to terminal management and command execution.
 * It is designed to be used by the Commands class.
 */
export class CommandRunner {
  private commandsInstance: any;
  private terminalStack: vscode.Terminal[] = [];
  private terminalIsRunning = false;
  private outputChannel?: vscode.OutputChannel;
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

  executeCommand(sfdxHardisCommand: string) {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    this.debugNodeJs = config.get("debugSfdxHardisCommands") ?? false;
    if (
      config.get("userInputCommandLineIfLWC") === "terminal" ||
      !sfdxHardisCommand.startsWith("sf hardis")
    ) {
      this.executeCommandTerminal(sfdxHardisCommand);
    } else {
      this.executeCommandBackground(sfdxHardisCommand);
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
    if (!command.startsWith("sf hardis") || command.includes("&&")) {
      if (type === "background") {
        if (this.commandsInstance?.logger) {
          this.commandsInstance.logger.log("Invalid command blocked");
        }
        vscode.window.showErrorMessage(
          `Blocked: Only 'sf hardis' commands without '&&' are allowed.\n${command}`,
        );
        return null;
      }
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
        vscode.window.showErrorMessage(
          "VsCode SFDX-Hardis is not initialized yet, please wait a few seconds before running this command again.\nIn the problem persists, update VsCode setting vsCodeSfdxHardis.userInputCommandLineIfLWC to 'terminal'",
        );
        return null;
      }
    }

    // Check for duplicate running command
    /* jscpd:ignore-start */
    const existing = this.activeCommands.get(cmd);
    if (existing) {
      // For background: process is not killed and not closed/errored
      if (
        existing.type === "background" &&
        existing.process &&
        !existing.process.killed &&
        !existing.process._closed
      ) {
        vscode.window.showErrorMessage(
          "No need to click multiple times on a menu, just be patient 🤗",
        );
        return null;
      }
      // For terminal: sentToTerminal is true
      if (existing.type === "terminal" && existing.sentToTerminal) {
        vscode.window.showErrorMessage(
          "No need to click multiple times on a menu, just be patient 🤗",
        );
        return null;
      }
    }
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

  executeCommandBackground(sfdxHardisCommand: string) {
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
    };
    if (this.debugNodeJs) {
      spawnOptions.env = { ...process.env, NODE_OPTIONS: "--inspect-brk" };
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
      vscode.window.showErrorMessage("Failed to start command: " + msg);
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
    let displayPopupMessage = `Initializing command ${preprocessedCommand}`;
    const wsIndex = displayPopupMessage.indexOf("--websocket");
    if (wsIndex !== -1) {
      displayPopupMessage = displayPopupMessage.substring(0, wsIndex).trim();
    }
    const skipAuthIndex = displayPopupMessage.indexOf("--skipauth");
    if (skipAuthIndex !== -1) {
      displayPopupMessage = displayPopupMessage
        .substring(0, skipAuthIndex)
        .trim();
    }
    if (this.debugNodeJs) {
      displayPopupMessage += " (debug mode)";
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
    });
    childProcess.on("close", (code: any) => {
      output.appendLine(`[Ended] ${preprocessedCommand} (exit code: ${code})`);
      this.activeCommands.delete(preprocessedCommand);
      closeProgress();
    });
    childProcess.on("error", (err: any) => {
      output.appendLine(`[Error] ${err.message}`);
      this.activeCommands.delete(preprocessedCommand);
      closeProgress();
    });
  }

  /**
   * Main entry point for executing a command in a terminal, handling terminal stack and LWC panel logic.
   */
  executeCommandTerminal(sfdxHardisCommand: string) {
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
                "🦙 It is recommended to use Git Bash as default terminal shell (do it in the opened dialog at the top of the screen)",
                "Download Git Bash",
                "Ignore",
                "Don't ask again",
              )
              .then(async (selection) => {
                if (selection === "Download Git Bash") {
                  vscode.env.openExternal(
                    vscode.Uri.parse("https://git-scm.com/downloads"),
                  );
                } else if (selection === "Don't ask again") {
                  await config.update("disableGitBashCheck", true);
                } else {
                  vscode.window.showInformationMessage(
                    "🦙 If you do not want to see this message anymore, set VsCode setting vsCodeSfdxHardis.disableGitBashCheck to true, or click on Don't ask again",
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
        this.runCommandInTerminal(sfdxHardisCommand);
      });
    } else {
      this.runCommandInTerminal(sfdxHardisCommand);
    }
  }

  /**
   * Runs a command in the latest terminal, handling all SFDX/Hardis specifics.
   */
  runCommandInTerminal(command: string) {
    const terminal = this.getLatestTerminal();
    if (!terminal) {
      vscode.window.showErrorMessage(
        "No terminal available to run the command.",
      );
      return;
    }
    terminal.show(false);

    if (this.terminalIsRunning) {
      vscode.window.showErrorMessage(
        "🦙 Wait for the current command to be completed before running a new one :)",
        "Close",
      );
      return;
    }
    // terminalIsRunning = true; //Comment until we find a way to detect that a command is running or not
    let cmd = this.preprocessAndValidateCommand(command, "terminal");
    if (!cmd) {
      return;
    }
    if (terminal?.name?.includes("powershell")) {
      cmd = cmd.replace(/ && /g, " ; ").replace(/echo y/g, "Write-Output 'y'");
    }
    if (this.debugNodeJs) {
      cmd = `NODE_OPTIONS=--inspect-brk ${cmd}`;
    }
    // Send command to terminal
    terminal.sendText(cmd);
    // Mark as sent to terminal (for duplicate prevention)
    this.activeCommands.set(cmd, { type: "terminal", sentToTerminal: true });
    vscode.commands.executeCommand("workbench.action.terminal.scrollToBottom");
    // Optionally, you could remove from activeCommands after a delay or on user action
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
