import * as vscode from "vscode";
import * as path from "path";
import { HardisCommandsProvider } from "./hardis-commands-provider";
import { HardisStatusProvider } from "./hardis-status-provider";
import { HardisPluginsProvider } from "./hardis-plugins-provider";
import { LocalWebSocketServer } from "./hardis-websocket-server";
import { openFolderInExplorer } from "./utils";
import TelemetryReporter from "@vscode/extension-telemetry";
import { ThemeUtils } from "./themeUtils";
import { CommandRunner } from "./command-runner";
import { runSalesforceCliMcpServer } from "./utils/mcpUtils";
import { registerShowWelcome } from "./commands/showWelcome";
import { registerShowOrgsManager } from "./commands/showOrgsManager";
import { registerShowPipeline } from "./commands/showPipeline";
import { registerShowSetup } from "./commands/showSetup";
import { registerShowPipelineConfig } from "./commands/showPipelineConfig";
import { registerShowInstalledPackages } from "./commands/showInstalledPackages";
import { registerShowOrgMonitoring } from "./commands/showOrgMonitoring";
import { registerShowFilesWorkbench } from "./commands/showFilesWorkbench";
import { registerOpenKeyFile } from "./commands/openKeyFile";
import { registerRunLocalHtmlDocPages } from "./commands/runLocalHtmlDoc";
import { registerShowExtensionConfig } from "./commands/showExtensionConfig";
import { LwcPanelManager } from "./lwc-panel-manager";
import { registerRunAnonymousApex } from "./commands/runAnonymousApex";
import { registerShowMetadataRetriever } from "./commands/showMetadataRetriever";
import { registerShowPackageXml } from "./commands/packageXml";

export class Commands {
  public readonly extensionUri: vscode.Uri;
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
    this.registerShowMessage();
    this.registerSelectExtensionTheme();
    this.registerSimulateDeployment();
    this.registerGeneratePackageXmlDoc();
    this.registerGenerateFlowDocumentation();
    this.registerGenerateFlowVisualGitDiff();
    this.registerRunSalesforceCliMcpServer();
    registerShowExtensionConfig(this);
    registerOpenKeyFile(this);
    registerShowPipeline(this);
    registerShowWelcome(this);
    registerShowSetup(this);
    registerShowPipelineConfig(this);
    registerShowInstalledPackages(this);
    registerShowOrgsManager(this);
    registerShowOrgMonitoring(this);
    registerShowFilesWorkbench(this);
    registerRunLocalHtmlDocPages(this);
    registerRunAnonymousApex(this);
    registerShowMetadataRetriever(this);
    registerShowPackageXml(this);
  }

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
      async (keepCache: boolean = false) => {
        await this.hardisPluginsProvider?.refresh(keepCache);
        // Reopen setup only if it is already open
        const panelManager = LwcPanelManager.getInstance();
        // Pipeline config
        const setupPanel = panelManager.getPanel("s-setup");
        if (setupPanel) {
          setupPanel.sendMessage({
            type: "refresh",
          });
        }
      },
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
        openFolderInExplorer(reportFolderPath);
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

  registerRunSalesforceCliMcpServer() {
    // Register command to start/stop MCP server
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.runSalesforceCliMcpServer",
      async () => {
        await runSalesforceCliMcpServer();
      },
    );
    this.disposables.push(disposable);
  }
}
