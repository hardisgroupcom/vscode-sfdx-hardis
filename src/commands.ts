import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisStatusProvider } from "./hardis-status-provider";
import { HardisPluginsProvider } from "./hardis-plugins-provider";
import { LocalWebSocketServer } from "./hardis-websocket-server";
import { getWorkspaceRoot } from "./utils";
import TelemetryReporter from "@vscode/extension-telemetry";
import { ThemeUtils } from "./themeUtils";
import { exec } from "child_process";

export class Commands {
  hardisCommandsProvider: HardisCommandsProvider | null = null;
  hardisStatusProvider: HardisStatusProvider | null = null;
  hardisPluginsProvider: HardisPluginsProvider | null = null;
  reporter: TelemetryReporter | null = null;
  disposables: vscode.Disposable[] = [];
  terminalStack: vscode.Terminal[] = [];
  terminalIsRunning = false;
  disposableWebSocketServer: LocalWebSocketServer | null = null;

  constructor(
    hardisCommandsProvider: HardisCommandsProvider,
    hardisStatusProvider: HardisStatusProvider,
    hardisPluginsProvider: HardisPluginsProvider,
    reporter: TelemetryReporter,
  ) {
    this.hardisCommandsProvider = hardisCommandsProvider;
    this.hardisStatusProvider = hardisStatusProvider;
    this.hardisPluginsProvider = hardisPluginsProvider;
    this.reporter = reporter;
    this.registerCommands();
  }

  registerCommands() {
    this.registerExecuteCommand();
    this.registerOpenValidationLink();
    this.registerOpenReportsFolder();
    this.registerOpenExtensionSettings();
    this.registerNewTerminalCommand();
    this.registerRefreshCommandsView();
    this.registerRefreshStatusView();
    this.registerRefreshPluginsView();
    this.registerOpenExternal();
    this.registerShowCommandDetail();
    this.registerOpenCommandHelp();
    this.registerOpenPluginHelp();
    this.registerOpenKeyFile();
    this.registerShowMessage();
    this.registerSelectExtensionTheme();
    this.registerSimulateDeployment();
    this.registerGeneratePackageXmlDoc();
    this.registerGenerateFlowDocumentation();
    this.registerGenerateFlowVisualGitDiff();
  }

  getLatestTerminal() {
    return this.terminalStack[this.terminalStack.length - 1];
  }

  runCommandInTerminal(command: string) {
    const terminal = this.getLatestTerminal();
    // Show and focus terminal
    terminal.show(false);

    // Run command on terminal only if there is not already a command running
    if (this.terminalIsRunning) {
      vscode.window.showErrorMessage(
        "🦙 Wait for the current command to be completed before running a new one :)",
        "Close",
      );
      return;
    }
    // terminalIsRunning = true; //Comment until we find a way to detect that a command is running or not
    if (command.startsWith("sf hardis")) {
      // Add --skipauth argument when necessary
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      if (
        config.get("disableDefaultOrgAuthenticationCheck") === true &&
        !command.includes("hardis:org:configure:monitoring") &&
        !command.includes("--skipauth") &&
        !command.includes("&&")
      ) {
        command += ` --skipauth`;
      }
    }
    // Add --websocket argument when necessary
    if (
      (command.startsWith("sf hardis") ||
        command.includes("sf hardis:work:ws --event")) &&
      this.disposableWebSocketServer &&
      this.disposableWebSocketServer.websocketHostPort !== null &&
      !command.includes("--websocket") &&
      (!command.includes("&&") ||
        command.endsWith("sf hardis:work:ws --event refreshPlugins"))
    ) {
      command += ` --websocket ${this.disposableWebSocketServer.websocketHostPort}`;
    }
    // Adapt command to powershell if necessary
    if (terminal?.name?.includes("powershell")) {
      command = command
        .replace(/ && /g, " ; ")
        .replace(/echo y/g, "Write-Output 'y'");
    }
    terminal.sendText(command);
    // Scrolldown the terminal
    vscode.commands.executeCommand("workbench.action.terminal.scrollToBottom");
    // Telemetry: Send only the 2 first portions of the command
    // Examples: "sf hardis:work:new" , "sf plugins:install"
    if (this.reporter) {
      const truncatedCommand = command.split(" ").slice(0, 2).join(" ");
      this.reporter.sendTelemetryEvent("command", {
        command: truncatedCommand,
      });
    }
  }

  registerExecuteCommand() {
    // Execute SFDX Hardis command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.execute-command",
      (sfdxHardisCommand: string) => {
        // Filter killed terminals
        this.terminalStack = this.terminalStack.filter(
          (terminal) =>
            vscode.window.terminals.filter(
              (vsTerminal) => vsTerminal.processId === terminal.processId,
            ).length > 0,
        );
        // Create new terminal if necessary
        if (
          this.terminalStack.length === 0 ||
          vscode.window.terminals.length === 0
        ) {
          // Check bash is the default terminal if we are on windows
          if (process.platform === "win32") {
            const terminalConfig =
              vscode.workspace.getConfiguration("terminal");
            const selectedTerminal: string =
              terminalConfig.integrated?.shell?.windows ||
              terminalConfig.integrated?.defaultProfile?.windows ||
              "";
            if (!selectedTerminal.toLowerCase().includes("bash")) {
              const config =
                vscode.workspace.getConfiguration("vsCodeSfdxHardis");
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
          /* Create terminal
                  const terminalOptions: vscode.TerminalOptions = {
                    name: 'SFDX Hardis',
                    cwd: (vscode.workspace.workspaceFolders) ? vscode.workspace.workspaceFolders[0].uri.path : process.cwd()
                  };*/
          //const newTerminal = vscode.window.createTerminal(terminalOptions);
          vscode.commands.executeCommand(
            "workbench.action.terminal.newInActiveWorkspace",
            "SFDX Hardis",
          );
          new Promise((resolve) => setTimeout(resolve, 4000)).then(() => {
            /* vscode.commands.executeCommand(
                            "workbench.action.toggleMaximizedPanel"
                        );*/
            const newTerminal =
              vscode.window.terminals[vscode.window.terminals.length - 1];
            this.terminalStack.push(newTerminal);
            this.runCommandInTerminal(sfdxHardisCommand);
          });
        } else {
          // Run command in active terminal
          this.runCommandInTerminal(sfdxHardisCommand);
        }
      },
    );
    this.disposables.push(disposable);
  }

  registerRefreshCommandsView() {
    // Refresh commands tree
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.refreshCommandsView",
      (keepCache: boolean = false) => {
        this.hardisCommandsProvider?.refresh(keepCache);
        // Reload window if Salesforce Extensions are not active
        const toReload = vscode.extensions.all.filter(
          (extension) =>
            extension.id === "salesforce.salesforcedx-vscode-core" &&
            extension.isActive === false,
        );
        if (toReload.length > 0 && keepCache === false) {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      },
    );
    this.disposables.push(disposable);
  }

  registerRefreshStatusView() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.refreshStatusView",
      (keepCache: boolean = false) =>
        this.hardisStatusProvider?.refresh(keepCache),
    );
    this.disposables.push(disposable);
  }

  registerRefreshPluginsView() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.refreshPluginsView",
      (keepCache: boolean = false) =>
        this.hardisPluginsProvider?.refresh(keepCache),
    );
    this.disposables.push(disposable);
  }

  registerNewTerminalCommand() {
    // New terminal command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.newTerminal",
      () => {
        vscode.commands.executeCommand(
          "workbench.action.terminal.newInActiveWorkspace",
          "SFDX Hardis",
        );
        new Promise((resolve) => setTimeout(resolve, 4000)).then(() => {
          const newTerminal =
            vscode.window.terminals[vscode.window.terminals.length - 1];
          this.terminalStack.push(newTerminal);
        });
      },
    );
    this.disposables.push(disposable);
  }

  registerOpenExternal() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openExternal",
      (url) => vscode.env.openExternal(url),
    );
    this.disposables.push(disposable);
  }

  registerShowCommandDetail() {
    // Popup info about a command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showCommandDetail",
      (item) => {
        const commandDetail =
          item.tooltip + "\n\nCommand: " + item.hardisCommand;
        const messageButtons = ["Run command"];
        if (item.options.helpUrl) {
          messageButtons.push("Open Online Help");
        }
        // messageButtons.push("Close"); // a cancel button is already automatically added by VsCode
        vscode.window
          .showInformationMessage(
            `🦙 ${commandDetail}`,
            { modal: true },
            ...messageButtons,
          )
          .then((selection) => {
            if (selection === "Run command") {
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.execute-command",
                item.hardisCommand,
              );
            } else if (selection === "Open Online Help") {
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.openCommandHelp",
                item,
              );
            }
          });
      },
    );
    this.disposables.push(disposable);
  }

  registerOpenCommandHelp() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openCommandHelp",
      (item) => {
        if (item.options.helpUrl) {
          vscode.env.openExternal(item.options.helpUrl);
        } else {
          vscode.window.showInformationMessage(
            "🦙 No help url has been defined for this command",
          );
        }
      },
    );
    this.disposables.push(disposable);
  }

  registerOpenPluginHelp() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openPluginHelp",
      (item) => vscode.env.openExternal(item.options.helpUrl),
    );
    this.disposables.push(disposable);
  }

  registerShowMessage() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showMessage",
      (msg: string, level = "info") => {
        if (level === "error") {
          vscode.window.showErrorMessage(msg);
        } else {
          vscode.window.showInformationMessage(msg);
        }
      },
    );
    this.disposables.push(disposable);
  }

  registerOpenValidationLink() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openValidationLink",
      async () => {
        const inputBoxOptions: vscode.InputBoxOptions = {
          prompt: "Please paste your Salesforce validation link here",
          placeHolder: "Enter Outlook encoded link here",
          ignoreFocusOut: true,
        };
        const encodedUrl = await vscode.window.showInputBox(inputBoxOptions);
        const afterUrl = encodedUrl?.split("url=")[1];
        const beforeAndAmp = afterUrl?.split("&amp")[0];
        const decodedUrl = decodeURIComponent(beforeAndAmp || "");
        if (decodedUrl !== "") {
          vscode.commands.executeCommand(
            "vscode-sfdx-hardis.openExternal",
            decodedUrl,
          );
        } else {
          vscode.window.showErrorMessage(
            "🦙 This URL is not a valid Outlook validation link",
            "Close",
          );
        }
      },
    );
    this.disposables.push(disposable);
  }

  registerSelectExtensionTheme() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.selectExtensionTheme",
      async () => {
        await ThemeUtils.promptUpdateConfiguration();
      },
    );
    this.disposables.push(disposable);
  }

  registerOpenExtensionSettings() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openExtensionSettings",
      async () => {
        vscode.commands.executeCommand("workbench.action.openGlobalSettings", {
          query: "Hardis",
        });
      },
    );
    this.disposables.push(disposable);
  }

  registerOpenReportsFolder() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openReportsFolder",
      async () => {
        const reportFolderPath = path.join(
          vscode.workspace?.workspaceFolders?.at(0)?.uri.fsPath ||
            process.cwd(),
          "hardis-report",
        );
        const platform = process.platform;
        if (platform === "win32") {
          exec(`explorer "${reportFolderPath}"`);
        } else if (platform === "darwin") {
          exec(`open "${reportFolderPath}"`);
        } else if (platform === "linux") {
          exec(`xdg-open "${reportFolderPath}"`);
        } else {
          vscode.window.showErrorMessage(`Unsupported platform ${platform}`);
        }
      },
    );
    this.disposables.push(disposable);
  }

  registerSimulateDeployment() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.simulateMetadataDeployment",
      async (uri: vscode.Uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const command = `sf hardis:project:deploy:simulate --source-dir "${relativePath}"`;
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.execute-command",
          command,
        );
      },
    );
    this.disposables.push(disposable);
  }

  registerGeneratePackageXmlDoc() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.generatePackageXmlDoc",
      async (uri: vscode.Uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const command = `sf hardis:doc:packagexml2markdown --inputfile "${relativePath}"`;
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.execute-command",
          command,
        );
      },
    );
    this.disposables.push(disposable);
  }

  registerGenerateFlowDocumentation() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.generateFlowDocumentation",
      async (uri: vscode.Uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        if (!relativePath.endsWith(".flow-meta.xml")) {
          vscode.window.showWarningMessage(
            "This command only works with Flow files :)",
          );
          return;
        }
        const command = `sf hardis:doc:flow2markdown --inputfile "${relativePath}"`;
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.execute-command",
          command,
        );
      },
    );
    this.disposables.push(disposable);
  }

  registerGenerateFlowVisualGitDiff() {
    // Open external command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.flowVisualGitDiff",
      async (uri: vscode.Uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        if (!relativePath.endsWith(".flow-meta.xml")) {
          vscode.window.showWarningMessage(
            "This command only works with Flow files :)",
          );
          return;
        }
        const command = `sf hardis:project:generate:flow-git-diff --flow "${relativePath}"`;
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.execute-command",
          command,
        );
      },
    );
    this.disposables.push(disposable);
  }

  registerOpenKeyFile() {
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
            file: "manifest/destructiveChanges.xml",
            label: "List of all deleted metadatas",
          },
          {
            file: "manifest/package-no-overwrite.xml",
            label:
              "List of metadatas that will be deployed only if they are not already existing in the target org",
          },
          {
            file: "manifest/packageDeployOnce.xml",
            label:
              "List of metadatas that will be deployed only if they are not already existing in the target org",
          },
          {
            file: "config/project-scratch-def.json",
            label: "Scratch org creation definition file",
          },
          { file: "sfdx-project.json", label: "Sfdx Project config file" },
          { file: ".forceignore", label: "Files ignored by SFDX" },
          { file: ".gitignore", label: "Files ignored by Git" },
          { file: ".mega-linter.yml", label: "Mega-Linter configuration" },
        ];
        const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
        const currentWorkspaceFolderUri = getWorkspaceRoot();
        const value = await new Promise<any>((resolve) => {
          quickpick.ignoreFocusOut = true;
          (quickpick.title = "Please select a configuration file to open"),
            (quickpick.canSelectMany = false);
          quickpick.items = keyFileList
            .filter((choice: any) =>
              fs.existsSync(currentWorkspaceFolderUri + path.sep + choice.file),
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
            "file:///" + currentWorkspaceFolderUri + "/" + value,
          );
          vscode.workspace.openTextDocument(openPath).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
        }
      },
    );
  }
}
