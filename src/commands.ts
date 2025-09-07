import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { getExtensionConfigSections } from "./utils/extensionConfigUtils";
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisStatusProvider } from "./hardis-status-provider";
import { HardisPluginsProvider } from "./hardis-plugins-provider";
import { LocalWebSocketServer } from "./hardis-websocket-server";
import { getPythonCommand, getWorkspaceRoot, execSfdxJson } from "./utils";
import axios from "axios";
import TelemetryReporter from "@vscode/extension-telemetry";
import { ThemeUtils } from "./themeUtils";
import { exec } from "child_process";
import { LwcPanelManager } from "./lwc-panel-manager";
import { CommandRunner } from "./command-runner";
import { PipelineDataProvider } from "./pipeline-data-provider";
import { getPullRequestButtonInfo } from "./utils/gitPrButtonUtils";
import { SfdxHardisConfigHelper } from "./utils/pipeline/sfdxHardisConfigHelper";
import { Logger } from "./logger";
import { listAllOrgs } from "./utils/orgUtils";
import { listMajorOrgs } from "./utils/orgConfigUtils";

export class Commands {
  private readonly extensionUri: vscode.Uri;
  hardisCommandsProvider: HardisCommandsProvider | null = null;
  hardisStatusProvider: HardisStatusProvider | null = null;
  hardisPluginsProvider: HardisPluginsProvider | null = null;
  reporter: TelemetryReporter | null = null;
  disposables: vscode.Disposable[] = [];
  disposableWebSocketServer: LocalWebSocketServer | null = null;
  commandRunner: CommandRunner;

  constructor(
    extensionUri: vscode.Uri,
    hardisCommandsProvider: HardisCommandsProvider,
    hardisStatusProvider: HardisStatusProvider,
    hardisPluginsProvider: HardisPluginsProvider,
    reporter: TelemetryReporter,
  ) {
    this.extensionUri = extensionUri;
    this.hardisCommandsProvider = hardisCommandsProvider;
    this.hardisStatusProvider = hardisStatusProvider;
    this.hardisPluginsProvider = hardisPluginsProvider;
    this.reporter = reporter;
    this.commandRunner = new CommandRunner(this);
    this.registerCommands();
  }

  registerCommands() {
    this.registerExecuteCommand();
    this.registerOpenValidationLink();
    this.registerOpenReportsFolder();
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
    this.registerShowPipeline();
    this.registerShowExtensionConfig();
    this.registerShowPipelineConfig();
    this.registerShowInstalledPackages();
    this.registerShowOrgsManager();
    this.registerRunLocalHtmlDocPages();
  }

  registerShowOrgsManager() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openOrgsManager",
      async () => {
        const lwcManager = LwcPanelManager.getInstance();
        // Load orgs using orgUtils
        try {
          const orgs = await this.loadOrgsWithProgress(
            false,
            "Loading Salesforce orgs...\n(it can be long, make some cleaning to make it faster 🙃)",
          );

          const panel = lwcManager.getOrCreatePanel("s-org-manager", {
            orgs: orgs,
          });
          panel.updateTitle("Orgs Manager");

          // Track the last requested 'all' flag so it persists between operations
          let currentAllFlag = false;

          panel.onMessage(async (type: string, data: any) => {
            if (type === "refreshOrgsFromUi") {
              const allFlag = !!(data && data.all === true);
              currentAllFlag = allFlag;
              const newOrgs = await this.loadOrgsWithProgress(allFlag);
              panel.sendInitializationData({ orgs: newOrgs });
            } else if (type === "connectOrg") {
              // run hardis:org:select
              const username = data.username;
              const command = `sf hardis:org:select --username "${username || ""}"`;
              this.commandRunner.executeCommand(command);
            } else if (type === "forgetOrgs") {
              try {
                const usernames = data?.usernames || [];
                if (usernames.length === 0) {
                  vscode.window.showInformationMessage(
                    "No orgs selected to forget.",
                  );
                  return;
                }

                const result = await this.forgetOrgsWithProgress(
                  usernames,
                  `Forgetting ${usernames.length} org(s)...`,
                );

                // send back result and refresh list
                const newOrgs = await this.loadOrgsWithProgress(currentAllFlag);
                panel.sendInitializationData({ orgs: newOrgs });
                vscode.window.showInformationMessage(
                  `Forgot ${result.successUsernames.length} org(s).`,
                );
              } catch (error: any) {
                vscode.window.showErrorMessage(
                  `Error forgetting orgs: ${error?.message || error}`,
                );
              }
            } else if (type === "removeRecommended") {
              // If LWC sent usernames, use them; otherwise fallback to detection
              let usernames: string[] = [];
              if (
                data &&
                Array.isArray(data.usernames) &&
                data.usernames.length > 0
              ) {
                usernames = data.usernames.filter(Boolean);
              }

              if (usernames.length === 0) {
                vscode.window.showInformationMessage(
                  "No recommended orgs found to remove.",
                );
                return;
              }

              try {
                const confirm = await vscode.window.showWarningMessage(
                  `This will forget ${usernames.length} orgs (disconnected, deleted or expired). Are you sure?`,
                  {},
                  "Yes",
                  "No",
                );
                if (confirm !== "Yes") {
                  return;
                }

                const result = await this.forgetOrgsWithProgress(
                  usernames,
                  `Forgetting ${usernames.length} recommended org(s)...`,
                );
                vscode.window.showInformationMessage(
                  `Forgot ${result.successUsernames.length} recommended org(s).`,
                );
                const newOrgs = await this.loadOrgsWithProgress(currentAllFlag);
                panel.sendInitializationData({ orgs: newOrgs });
              } catch (error: any) {
                vscode.window.showErrorMessage(
                  `Error removing recommended orgs: ${error?.message || error}`,
                );
              }
            }
          });
        } catch (error: any) {
          Logger.log("Error opening orgs manager:\n" + JSON.stringify(error));
          vscode.window.showErrorMessage(
            "Failed to open Org Manager: " + (error?.message || error),
          );
        }
      },
    );
    this.disposables.push(disposable);
  }

  // Helper: forget given org usernames with a VS Code progress notification and per-org steps
  private async forgetOrgsWithProgress(usernames: string[], title: string) {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: title,
        cancellable: true,
      },
      async (progress, token) => {
        const successUsernames: string[] = [];
        const errorUsernames: string[] = [];
        const total = usernames.length;
        let cancelled = false;

        // When the user cancels, set a flag so we stop after the current iteration
        token.onCancellationRequested(() => {
          cancelled = true;
        });

        for (let i = 0; i < total; i++) {
          if (cancelled) {
            // Stop processing further orgs when cancelled by the user
            break;
          }
          const u = usernames[i];
          const increment = Math.round(100 / total);
          progress.report({
            message: `Forgetting ${u} (${i + 1}/${total})`,
            increment,
          });
          try {
            await execSfdxJson(`sf org logout --target-org ${u} --noprompt`);
            successUsernames.push(u);
          } catch (err) {
            void err;
            errorUsernames.push(u);
          }
        }

        return { successUsernames, errorUsernames, cancelled };
      },
    );
  }

  // Helper: load orgs with a progress notification; preserves return value from listAllOrgs(all)
  private async loadOrgsWithProgress(all: boolean = false, title?: string) {
    const t =
      title ||
      (all ? "Loading all Salesforce orgs..." : "Loading Salesforce orgs...");
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t,
        cancellable: false,
      },
      async () => {
        return await listAllOrgs(all);
      },
    );
  }

  registerShowExtensionConfig() {
    // Show the extensionConfig LWC panel for editing extension settings
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showExtensionConfig",
      async () => {
        // Use utility to get config sections
        const sections = await getExtensionConfigSections(this.extensionUri);

        const lwcManager = LwcPanelManager.getInstance();
        const panel = lwcManager.getOrCreatePanel("s-extension-config", {
          sections: sections,
        });
        // Open the LWC panel
        panel.onMessage(async (type: string, _data: any) => {
          if (type === "refresh") {
            // Re-send current settings
            for (const section of sections) {
              for (const entry of section.entries) {
                entry.value = vscode.workspace
                  .getConfiguration()
                  .get(entry.key);
              }
            }
            panel.sendMessage({ type: "initialize", data: { sections } });
          }
        });
      },
    );
    this.disposables.push(disposable);
  }

  // Terminal logic moved to CommandRunner

  registerExecuteCommand() {
    // Execute SFDX Hardis command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.execute-command",
      (sfdxHardisCommand: string) => {
        // Use CommandRunner for all terminal and LWC panel logic
        this.commandRunner.executeCommand(sfdxHardisCommand);
      },
    );
    this.disposables.push(disposable);
  }

  registerRefreshCommandsView() {
    // Refresh commands tree
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.refreshCommandsView",
      async (keepCache: boolean = false) => {
        await this.hardisCommandsProvider?.refresh(keepCache);
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
      async (keepCache: boolean = false) =>
        await this.hardisStatusProvider?.refresh(keepCache),
    );
    this.disposables.push(disposable);
  }

  registerRefreshPluginsView() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.refreshPluginsView",
      async (keepCache: boolean = false) =>
        await this.hardisPluginsProvider?.refresh(keepCache),
    );
    this.disposables.push(disposable);
  }

  registerNewTerminalCommand() {
    // New terminal command
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.newTerminal",
      () => {
        this.commandRunner.createNewTerminal();
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

  /* jscpd:ignore-start */
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
  /* jscpd:ignore-end */

  registerShowPipeline() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showPipeline",
      async () => {
        // Show progress while loading config editor input
        const pipelineData = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Loading pipeline information...",
            cancellable: false,
          },
          async () => {
            const pipelineDataProvider = new PipelineDataProvider();
            return await pipelineDataProvider.getPipelineData();
          },
        );

        // Calculate PR button info using utility
        const repoPath =
          vscode.workspace.workspaceFolders &&
          vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : process.cwd();
        let prButtonInfo = null;
        try {
          prButtonInfo = await getPullRequestButtonInfo(repoPath);
        } catch (e) {
          Logger.log("Error getting PR button info:\n" + JSON.stringify(e));
        }

        const panel = LwcPanelManager.getInstance().getOrCreatePanel(
          "s-pipeline",
          { pipelineData: pipelineData, prButtonInfo },
        );
        panel.updateTitle("DevOps Pipeline");

        // Register message handler for refreshpipeline and runCommand
        panel.onMessage(async (type, _data) => {
          if (type === "refreshpipeline") {
            const provider = new PipelineDataProvider();
            const newData = await provider.getPipelineData();
            panel.sendInitializationData({
              pipelineData: newData,
              prButtonInfo,
            });
          }
        });
      },
    );
    this.disposables.push(disposable);
  }

  registerShowPipelineConfig() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showPipelineConfig",
      async (branchName: string | null) => {
        const workspaceRoot = getWorkspaceRoot();
        const sfdxHardisConfigHelper =
          SfdxHardisConfigHelper.getInstance(workspaceRoot);

        // Load available branches from major orgs
        const majorOrgs = await listMajorOrgs();
        const availableBranches = majorOrgs.map((org) => org.branchName);

        // Show progress while loading config editor input
        const configEditorInput = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: branchName
              ? `Loading pipeline settings for ${branchName}...`
              : "Loading global pipeline settings...",
            cancellable: false,
          },
          async () => {
            const input =
              await sfdxHardisConfigHelper.getEditorInput(branchName);
            // Add available branches to the input
            input.availableBranches = availableBranches;
            return input;
          },
        );

        const panel = LwcPanelManager.getInstance().getOrCreatePanel(
          "s-pipeline-config",
          configEditorInput,
        );
        panel.updateTitle(
          branchName ? `Settings - ${branchName}` : "Global Pipeline Settings",
        );

        // Register message handlers
        panel.onMessage(async (type, data) => {
          if (type === "saveSfdxHardisConfig") {
            try {
              await sfdxHardisConfigHelper.saveConfigFromEditor(data);
              vscode.window.showInformationMessage(
                "Configuration saved successfully.",
              );
            } catch (error: any) {
              vscode.window.showErrorMessage(
                "Error saving configuration: " + error.message,
              );
            }
          } else if (type === "loadPipelineConfig") {
            // Handle request to load config for different branch
            try {
              const newBranchName = data.branchName;
              const newConfigEditorInput = await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: newBranchName
                    ? `Loading pipeline settings for ${newBranchName}...`
                    : "Loading global pipeline settings...",
                  cancellable: false,
                },
                async () => {
                  const input =
                    await sfdxHardisConfigHelper.getEditorInput(newBranchName);
                  // Add available branches to the input
                  input.availableBranches = availableBranches;
                  return input;
                },
              );

              // Update panel title and send new data to LWC
              panel.updateTitle(
                newBranchName
                  ? `Settings - ${newBranchName}`
                  : "Global Pipeline Settings",
              );
              panel.sendInitializationData(newConfigEditorInput);
            } catch (error: any) {
              vscode.window.showErrorMessage(
                "Error loading configuration: " + error.message,
              );
            }
          }
        });
      },
    );
    this.disposables.push(disposable);
  }

  registerShowInstalledPackages() {
    const workspaceRoot = getWorkspaceRoot();
    const sfdxHardisConfigHelper =
      SfdxHardisConfigHelper.getInstance(workspaceRoot);
    // Reusable loading packages function
    const loadInstalledPackages = async () => {
      // Show progress while loading config editor input
      const packages = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Loading installed packages...`,
          cancellable: false,
        },
        async () => {
          const allConfig = await sfdxHardisConfigHelper.getEditorInput(null);
          return allConfig?.config?.installedPackages || [];
        },
      );
      return packages;
    };

    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showInstalledPackages",
      async () => {
        const packages = await loadInstalledPackages();
        const panel = LwcPanelManager.getInstance().getOrCreatePanel(
          "s-installed-packages",
          { packages },
        );
        panel.updateTitle("Installed Packages");
        // Listen for save events from LWC
        // Register message handler to save configuration
        panel.onMessage(async (type, data) => {
          if (type === "saveSfdxHardisConfig") {
            try {
              const allConfig =
                await sfdxHardisConfigHelper.getEditorInput(null);
              allConfig.config.installedPackages = data.packages;
              await sfdxHardisConfigHelper.saveConfigFromEditor(allConfig);
              vscode.window.showInformationMessage(
                "Installed packages configuration saved successfully.",
              );
            } catch (error: any) {
              vscode.window.showErrorMessage(
                "Error saving installed packages configuration: " +
                  error.message,
              );
            }
          } else if (type === "refresh") {
            const packages = await loadInstalledPackages();
            panel.sendMessage({
              type: "initialize",
              data: { packages: packages },
            });
          }
        });
      },
    );
    this.disposables.push(disposable);
  }

  registerRunLocalHtmlDocPages() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.runLocalHtmlDocPages",
      async () => {
        // Check how python is installed
        const pythonCommand = await getPythonCommand();
        if (!pythonCommand) {
          vscode.window
            .showErrorMessage(
              "🦙 Python is not installed or not available in PATH. Please install Python to run the local documentation server.",
              "Download and install Python",
            )
            .then((selection) => {
              if (selection === "Download and install Python") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://www.python.org/downloads/"),
                );
              }
            });
          return;
        }
        const command = `${pythonCommand} -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists && mkdocs serve --verbose`;
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.execute-command",
          command,
        );
        // Display a progress vscode UI message while the server starts (check that the server is started by pinging localhost:8000)
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title:
              "Starting local documentation server...\n(it can take a while 😱)",
            cancellable: true,
          },
          async (progress, token) => {
            return new Promise<void>((resolve, reject) => {
              let isResolved = false;
              const interval = setInterval(() => {
                axios
                  .get("http://localhost:8000", { timeout: 2000 })
                  .then(() => {
                    if (!isResolved) {
                      isResolved = true;
                      clearInterval(interval);
                      progress.report({
                        message:
                          "Local documentation server is running at http://localhost:8000",
                      });
                      vscode.env.openExternal(
                        vscode.Uri.parse("http://localhost:8000"),
                      );
                      resolve();
                    }
                  })
                  .catch(() => {
                    // Server not started yet or not reachable
                  });
              }, 3000);
              token.onCancellationRequested(() => {
                if (!isResolved) {
                  isResolved = true;
                  clearInterval(interval);
                  reject();
                }
              });
            });
          },
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
          ((quickpick.title = "Please select a configuration file to open"),
            (quickpick.canSelectMany = false));
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
