import * as vscode from "vscode";
import * as path from "path";
import {
  execCommandWithProgress,
  execSfdxJsonWithProgress,
  isWebVsCode,
} from "../utils";
import { Logger } from "../logger";

type MessageListener = (messageType: string, data: any) => void;

export class LwcUiPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private lwcId: string;
  private disposables: vscode.Disposable[] = [];
  private messageListeners: MessageListener[] = [];
  private initializationData: any = null;
  private _isDisposed: boolean = false;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    lwcId: string,
    initData?: any,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.lwcId = lwcId;
    this.initializationData = initData || null;

    // Set the webview's initial html content
    this.update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        // Handle built-in file operations first
        this.handleBuiltInMessages(message);

        // Then notify external listeners
        this.notifyMessageListeners(message);
      },
      null,
      this.disposables,
    );

    // Send initialization data to the webview after a short delay to ensure it's ready
    if (this.initializationData) {
      setTimeout(() => {
        this.sendInitializationData(this.initializationData);
      }, 100);
    }
  }

  public static display(
    extensionUri: vscode.Uri,
    lwcId: string,
    initData?: any,
  ): LwcUiPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      "lwcUi",
      "SFDX Hardis",
      column || vscode.ViewColumn.One,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // Retain context when hidden to preserve component state when switching tabs
        retainContextWhenHidden: true,

        // Restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "out", "webviews"),
          vscode.Uri.joinPath(extensionUri, "out", "assets"), // Add assets directory
          vscode.Uri.joinPath(
            extensionUri,
            "node_modules",
            "@salesforce-ux",
            "design-system",
          ),
          vscode.Uri.joinPath(extensionUri, "out", "resources"),
        ],
      },
    );

    // Set custom icon for the panel tab
    panel.iconPath = vscode.Uri.joinPath(
      extensionUri,
      "resources",
      "cloudity-logo.svg",
    );

    const lwcUiPanel = new LwcUiPanel(panel, extensionUri, lwcId, initData);
    lwcUiPanel.setPanelTitleFromLwcId();
    return lwcUiPanel;
  }

  /**
   * Update the panel title
   * @param title New title for the panel
   */
  public updateTitle(title: string): void {
    this.panel.title = title;
  }

  public asWebviewUri(path: string[]): string {
    const pathFull = ["out", "resources", "webviews", ...path];
    const resourceUri = vscode.Uri.joinPath(this.extensionUri, ...pathFull);
    return this.panel.webview.asWebviewUri(resourceUri).toString();
  }

  /**
   * Get the current panel title
   */
  public getTitle(): string {
    return this.panel.title;
  }

  public setPanelTitleFromLwcId() {
    const lwcDefinitions: {
      [key: string]: string;
    } = {
      "s-prompt-input": "Prompt Input",
      "s-command-execution": "Command Execution",
      "s-pipeline": "DevOps Pipeline",
      "s-pipeline-config": "Pipeline Settings",
      "s-extension-config": "Extension Settings",
      "s-data-workbench": "Data Import/Export Workbench",
      "s-files-workbench": "Files Import/Export Workbench",
      "s-setup": "Install Dependencies",
    };
    const panelTitle = lwcDefinitions[this.lwcId] || "SFDX Hardis";
    this.panel.title = panelTitle;
  }

  public dispose() {
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;
    this.notifyMessageListeners({
      type: "panelDisposed",
      data: {
        lwcId: this.lwcId,
      },
    });

    // Clean up our resources
    this.panel.dispose();

    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }

    // Clear message listeners
    this.messageListeners = [];
  }

  public isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Reveal the panel (bring it to focus)
   * @param column Optional column to reveal the panel in
   */
  public reveal(column?: vscode.ViewColumn): void {
    this.panel.reveal(column);
  }

  /**
   * Send initialization data to the webview
   * @param data The data to send to the webview for initialization
   */
  public sendInitializationData(data: any): void {
    this.initializationData = data;
    const vsCodeSfdxHardisConfiguration =
      vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    if (vsCodeSfdxHardisConfiguration) {
      data.vsCodeSfdxHardisConfiguration = vsCodeSfdxHardisConfiguration;
    }

    // Always add colorTheme to initialization data for consistent theme support
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis.theme");
    const colorThemeConfig = config.get("colorTheme", "auto");
    const { colorTheme, colorContrast } = LwcUiPanel.resolveTheme(colorThemeConfig);
    data.colorTheme = colorTheme;
    data.colorContrast = colorContrast;

    this.panel.webview.postMessage({
      type: "initialize",
      data: data,
    });
  }

  /**
   * Send a message to the webview
   * @param message The message to send
   */
  public sendMessage(message: any): void {
    this.panel.webview.postMessage(message);
  }

  /**
   * Register a message listener for this panel
   * @param listener Function that will be called when a message is received
   * @returns Function to unregister the listener
   */
  public onMessage(listener: MessageListener): () => void {
    this.messageListeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.messageListeners.indexOf(listener);
      if (index > -1) {
        this.messageListeners.splice(index, 1);
      }
    };
  }

  public clearExistingOnMessageListeners(): void {
    // Clear listeners previously added with onMessage method
    this.messageListeners = [];
  }

  /**
   * Handle built-in file operation messages from the webview
   * @param message The message received from the webview
   */
  private async handleBuiltInMessages(message: any): Promise<void> {
    const messageType = message.type;
    const data = message.data || message;

    try {
      switch (messageType) {
        case "checkFileExists":
          await this.handleFileExistsCheck(data.filePath, data.fileType);
          break;
        case "openFile":
          await this.handleFileOpen(data.filePath);
          break;
        case "openExternal":
          await this.handleOpenExternal(data.url || data);
          break;
        case "runVsCodeCommand":
          await this.handleRunVsCodeCommand(data);
          break;
        case "runCommand":
          await this.handleRunCommand(data);
          break;
        case "runInternalCommand":
          await this.handleRunInternalCommand(data);
          break;
        case "updateVsCodeSfdxHardisConfiguration":
          this.handleUpdateVsCodeSfdxHardisConfiguration(data);
          break;
        case "copyToClipboard":
          await this.handleCopyToClipboard(data);
          break;
      }
    } catch (error) {
      Logger.log(
        `Error handling built-in message ${messageType}:\n` +
          JSON.stringify(error),
      );
    }
  }

  private async handleCopyToClipboard(data: any): Promise<void> {
    const text: string =
      (data && typeof data.text === "string" ? data.text : null) ||
      (typeof data === "string" ? data : "");

    if (!text) {
      return;
    }

    // Avoid accidental massive clipboard payloads
    const clipped = text.length > 10000 ? text.slice(0, 10000) : text;
    await vscode.env.clipboard.writeText(clipped);
    vscode.window.showInformationMessage("Copied to clipboard.");

    // Optional ack (allows webview toast in the future)
    this.sendMessage({
      type: "copiedToClipboard",
      data: { length: clipped.length },
    });
  }

  /**
   * Handle VS Code command execution request from webview
   * @param data Object with a 'command' property (string)
   */
  private async handleRunVsCodeCommand(data: {
    command: string;
  }): Promise<void> {
    if (!data || !data.command || typeof data.command !== "string") {
      vscode.window.showErrorMessage("No VS Code command specified to run.");
      return;
    }
    try {
      await vscode.commands.executeCommand(data.command);
    } catch (error) {
      Logger.log("Error running VS Code command:\n" + JSON.stringify(error));
      vscode.window.showErrorMessage(
        `Failed to run VS Code command: ${data.command}`,
      );
    }
  }

  /**
   * Handle command execution request from webview
   * @param data Object with a 'command' property (string)
   */
  private async handleRunCommand(data: { command: string }): Promise<void> {
    vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      data.command,
    );
  }

  private async handleRunInternalCommand(data: {
    command: string;
    commandId: number;
    progressMessage: string;
  }): Promise<void> {
    if (!data || !data.command || typeof data.command !== "string") {
      vscode.window.showErrorMessage("No internal command specified to run.");
      return;
    }
    const command = data.command;
    if (
      !command.startsWith("sf ") ||
      command.includes("&&") ||
      command.includes("||")
    ) {
      vscode.window.showErrorMessage(
        "Only 'sfdx' or 'sf' commands can be run as internal commands.",
      );
      return;
    }
    let result: any = null;
    const progressMessage = data.progressMessage || "Running command...";
    try {
      if (data.command.includes("--json")) {
        result = await execSfdxJsonWithProgress(command, {}, progressMessage);
      } else {
        result = await execCommandWithProgress(command, {}, progressMessage);
      }
    } catch (error) {
      Logger.log("Error running internal command:\n" + JSON.stringify(error));
    }
    this.sendMessage({
      type: "commandResult",
      data: {
        command: command,
        commandId: data.commandId,
        result: result,
      },
    });
  }

  /**
   * Handle file existence check request from webview
   * @param filePath Path to the file to check
   * @param fileType Type of the file (csv or excel)
   */
  private resolveWorkspacePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const resolved = path.join(workspaceFolders[0].uri.fsPath, filePath);
      console.log(`Resolved relative path: ${filePath} -> ${resolved}`);
      return resolved;
    }
    return filePath;
  }

  private async handleFileExistsCheck(
    filePath: string,
    fileType: string,
  ): Promise<void> {
    try {
      const resolvedPath = this.resolveWorkspacePath(filePath);
      // Check if file exists
      const fileUri = vscode.Uri.file(resolvedPath);
      await vscode.workspace.fs.stat(fileUri);
      // File exists, send positive response with resolved path
      this.sendMessage({
        type: "fileExistsResponse",
        data: {
          filePath: resolvedPath, // Send back the resolved path
          fileType: fileType,
          exists: true,
        },
      });
    } catch {
      // File doesn't exist or other error, send negative response
      console.log(`File does not exist: ${filePath}`);
      this.sendMessage({
        type: "fileExistsResponse",
        data: {
          filePath: filePath,
          fileType: fileType,
          exists: false,
        },
      });
    }
  }

  /**
   * Handle file open request from webview
   * @param filePath Path to the file to open
   */
  private async handleFileOpen(filePathInit: string): Promise<void> {
    try {
      let filePath = filePathInit;
      let anchor = "";
      if (filePathInit.includes("#")) {
        const parts = filePathInit.split("#");
        filePath = parts[0];
        anchor = parts[1];
      }
      const resolvedPath = this.resolveWorkspacePath(filePath);
      // Check if file exists
      const fileUri = vscode.Uri.file(resolvedPath);
      await vscode.workspace.fs.stat(fileUri);
      // Check if it's an Excel file (or other binary file) that should be opened externally
      const fileExtension = path.extname(resolvedPath).toLowerCase();
      const binaryExtensions = [
        ".xlsx",
        ".xls",
        ".xlsm",
        ".xlsb",
        ".pdf",
        ".doc",
        ".docx",
        ".ppt",
        ".pptx",
      ];
      if (binaryExtensions.includes(fileExtension)) {
        if (isWebVsCode()) {
          const content = await vscode.workspace.fs.readFile(fileUri);
          const base64 = Buffer.from(content).toString("base64");
          this.sendMessage({
            type: "downloadFileFromPanel",
            data: {
              filePath: resolvedPath,
              fileName: path.basename(resolvedPath),
              base64: base64,
            },
          });
          Logger.log(`Sent download message for file: ${resolvedPath}`);
        } else {
          await vscode.env.openExternal(fileUri);
          Logger.log(`Opened file with default application: ${resolvedPath}`);
        }
      } else {
        // Open the file in VS Code for text files
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
        if (anchor) {
          // Find anchor text in document and scroll to it
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            let position = new vscode.Position(0, 0); // Default position
            const text = document.getText();
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(anchor)) {
                position = new vscode.Position(i, lines[i].indexOf(anchor));
                editor.revealRange(
                  new vscode.Range(position, position),
                  vscode.TextEditorRevealType.InCenter,
                );
                break;
              }
            }
          }
        }
        Logger.log(`Opened file in VS Code: ${resolvedPath}`);
      }
    } catch (error) {
      Logger.log("Error opening file:\n" + JSON.stringify(error));
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }

  /**
   * Handle external URL open request from webview
   * @param url URL to open in external browser
   */
  private async handleOpenExternal(url: string): Promise<void> {
    try {
      const uri = vscode.Uri.parse(url);
      await vscode.env.openExternal(uri);
    } catch (error) {
      Logger.log("Error opening external URL:\n" + JSON.stringify(error));
      vscode.window.showErrorMessage(`Failed to open URL: ${url}`);
    }
  }

  /**
   * Handle update of VS Code configuration from the webview
   * @param data Object with 'section' (string) and 'value' (any)
   */
  private async handleUpdateVsCodeSfdxHardisConfiguration(data: {
    configKey: string;
    value: any;
    addElements?: string[];
    removeElements?: string[];
  }): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      if (data.configKey.startsWith("vsCodeSfdxHardis.")) {
        data.configKey = data.configKey.replace("vsCodeSfdxHardis.", "");
      }
      // If addElements or removeElements are specified, treat the config value as an array
      if (data.addElements || data.removeElements) {
        let currentValue = config.get<any[]>(data.configKey);
        if (!Array.isArray(currentValue)) {
          currentValue = [];
        }
        if (data.addElements) {
          data.addElements.forEach((el) => {
            if (!currentValue!.includes(el)) {
              currentValue!.push(el);
            }
          });
        }
        if (data.removeElements) {
          currentValue = currentValue.filter(
            (el) => !data.removeElements!.includes(el),
          );
        }
        data.value = currentValue;
      }
      // Update the configuration value
      await config.update(
        data.configKey,
        data.value,
        vscode.ConfigurationTarget.Global,
      );

      // Show appropriate success message
      if (data.addElements || data.removeElements) {
        let message = `VsCode configuration '${data.configKey}' updated`;
        if (data.addElements && data.addElements.length > 0) {
          message += ` (added: ${data.addElements.join(", ")})`;
        }
        if (data.removeElements && data.removeElements.length > 0) {
          message += ` (removed: ${data.removeElements.join(", ")})`;
        }
        vscode.window.showInformationMessage(message);
      } else {
        vscode.window.showInformationMessage(
          `VsCode configuration '${data.configKey}' updated with value: ${data.value}`,
        );
      }
    } catch (error) {
      Logger.log(
        "Error updating VS Code configuration:\n" + JSON.stringify(error),
      );
      vscode.window.showErrorMessage(
        `Failed to update configuration: ${data.configKey}`,
      );
    }
  }

  /**
   * Notify all registered message listeners
   * @param message The message received from the webview
   */
  private notifyMessageListeners(message: any): void {
    const messageType = message.type || "unknown";
    const data = message.data || message;

    this.messageListeners.forEach((listener) => {
      try {
        listener(messageType, data);
      } catch (error) {
        Logger.log(
          "Error in LWC UI message listener:\n" + JSON.stringify(error),
        );
      }
    });
  }

  private update() {
    const webview = this.panel.webview;

    this.panel.title = "SFDX Hardis LWC UI";
    this.panel.webview.html = this.getHtmlForWebview(webview);
  }

  /**
   * Refresh the webview HTML (useful when configuration changes, like theme)
   */
  public refresh(data: any): void {
    if (data?.colorTheme) {
      this.sendMessage({
        type: "updateTheme",
        data
      });
    }
    else {
      this.update();
    }
  }

  /**
   * Resolve the theme to use based on the input and VS Code's active theme
   * @param theme The input theme, can be "auto", "dark", "light", "dark-high" or "light-high"
   * @returns An object with colorTheme and colorContrast properties
   */
  public static resolveTheme(theme: string): any {
    const resultTheme = {
      colorTheme: "light",
      colorContrast: ""
    }
    if (!theme || theme === "auto") {
      const vsCodeTheme = vscode.window.activeColorTheme.kind;
      switch (vsCodeTheme) {
        case vscode.ColorThemeKind.HighContrast:
          resultTheme.colorTheme = "dark";
          resultTheme.colorContrast = "high";
          break;
        case vscode.ColorThemeKind.Dark:
          resultTheme.colorTheme = "dark";
          break;
        case vscode.ColorThemeKind.HighContrastLight:
          resultTheme.colorTheme = "light";
          resultTheme.colorContrast = "high";
          break;
        case vscode.ColorThemeKind.Light:
        default:
          resultTheme.colorTheme = "light";
          break;
      }
    } else {
      const themeParts = theme.split("-", 2);
      resultTheme.colorTheme = themeParts[0];
      resultTheme.colorContrast = themeParts.length > 1 ? themeParts[1] : "";
    }

    return resultTheme;
  }

  private getHtmlForWebview(webview: vscode.Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webviews", "lwc-ui.js"),
    );

    // Get path to SLDS CSS (copied by webpack)
    const sldsStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "out",
        "assets",
        "styles",
        "salesforce-lightning-design-system.min.css",
      ),
    );

    // Get path to SLDS icons directory (copied by webpack)
    const sldsIconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "assets", "icons"),
    );

    // Global theme stylesheet (built/copied to out/assets/styles/global-theme.css by the build)
    const globalThemeCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "assets", "styles", "global-theme.css"),
    );

    // Determine theme based on configuration
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis.theme");
    const colorThemeConfig = config.get("colorTheme", "auto");
    const { colorTheme, colorContrast } = LwcUiPanel.resolveTheme(colorThemeConfig);
    const initData = this.initializationData || {};
    initData.colorTheme = colorTheme;
    initData.colorContrast = colorContrast;

    // Safely serialize initialization data
    const initDataJson = JSON.stringify(initData)
          .replace(/'/g, "&#39;")
          .replace(/"/g, "&quot;");

    const mermaidTheme = {
      clusterBkg: "#EAF5FC",
      edgeLabelBackground: "rgba(232,232,232, 0.8)"
    }
    if (colorTheme == "dark") {
      mermaidTheme.clusterBkg = "#333";
      mermaidTheme.edgeLabelBackground = "rgba(77, 77, 77, 0.5)";
    }

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <link href="${sldsStylesUri}" rel="stylesheet" type="text/css">
        <link rel="icons" href=${sldsIconsUri} />
        
        <title>SFDX Hardis LWC UI</title>
        <style>
          body { margin: 0; padding: 0; }
          #app { width: 100%; min-height: 100vh; height: auto; }
        </style>

        <!-- Global theme stylesheet: always included, handles both light and dark themes. -->
        <link rel="stylesheet" href="${globalThemeCssUri}">
      </head>
      <body class="slds-scope blue-back" data-theme="${colorTheme}" data-contrast="${colorContrast}">
        <div id="app" data-lwc-id="${this.lwcId}" data-init-data="${initDataJson}"></div>
        
        <script>
          // Set SLDS icons path for LWC components
          window.SLDS_ICONS_PATH = "${sldsIconsUri}";
        </script>
        <script src="${webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webviews", "mermaid.min.js"))}"></script>
        <script>
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: 'loose',
              themeVariables: {
                clusterBkg: "${mermaidTheme.clusterBkg}",
                edgeLabelBackground: "${mermaidTheme.edgeLabelBackground}"
              }
            });
        </script>
        <script src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
