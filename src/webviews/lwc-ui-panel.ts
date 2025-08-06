import * as vscode from "vscode";
import * as path from "path";

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
    initData?: any
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
      this.disposables
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
    initData?: any
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
            "design-system"
          ),
        ],
      }
    );

    // Set custom icon for the panel tab
    panel.iconPath = vscode.Uri.joinPath(extensionUri, "resources", "cloudity-logo.svg");

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
    };
    const panelTitle = lwcDefinitions[this.lwcId] || "SFDX Hardis";
    this.panel.title = panelTitle;
  }

  public dispose() {
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;

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

  /**
   * Handle built-in file operation messages from the webview
   * @param message The message received from the webview
   */
  private async handleBuiltInMessages(message: any): Promise<void> {
    const messageType = message.type;
    const data = message.data || message;

    try {
      switch (messageType) {
        case 'checkFileExists':
          await this.handleFileExistsCheck(data.filePath, data.fileType);
          break;
        case 'downloadFile':
          await this.handleFileDownload(data.filePath, data.fileName);
          break;
        case 'openFile':
          await this.handleFileOpen(data.filePath);
          break;
        case 'openExternal':
          await this.handleOpenExternal(data.url || data);
          break;
      }
    } catch (error) {
      console.error(`Error handling built-in message ${messageType}:`, error);
    }
  }

  /**
   * Handle file existence check request from webview
   * @param filePath Path to the file to check
   * @param fileType Type of the file (csv or excel)
   */
  private async handleFileExistsCheck(filePath: string, fileType: string): Promise<void> {
    try {
      let resolvedPath = filePath;
      
      // If it's a relative path, resolve it relative to the workspace
      if (!path.isAbsolute(filePath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          resolvedPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
          console.log(`Resolved relative path: ${filePath} -> ${resolvedPath}`);
        }
      }
      
      // Check if file exists
      const fileUri = vscode.Uri.file(resolvedPath);
      await vscode.workspace.fs.stat(fileUri);
      
      // File exists, send positive response with resolved path
      this.sendMessage({
        type: "fileExistsResponse",
        data: {
          filePath: resolvedPath, // Send back the resolved path
          fileType: fileType,
          exists: true
        }
      });
    } catch {
      // File doesn't exist or other error, send negative response
      console.log(`File does not exist: ${filePath}`);
      this.sendMessage({
        type: "fileExistsResponse",
        data: {
          filePath: filePath,
          fileType: fileType,
          exists: false
        }
      });
    }
  }

  /**
   * Handle file download request from webview
   * @param filePath Path to the file to download
   * @param fileName Suggested filename for download
   */
  private async handleFileDownload(filePath: string, fileName: string): Promise<void> {
    try {
      let resolvedPath = filePath;
      
      // If it's a relative path, resolve it relative to the workspace
      if (!path.isAbsolute(filePath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          resolvedPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
          console.log(`Resolved relative path for download: ${filePath} -> ${resolvedPath}`);
        }
      }
      
      // Check if file exists
      const fileUri = vscode.Uri.file(resolvedPath);
      await vscode.workspace.fs.stat(fileUri);
      
      // Show save dialog
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: {
          'Excel Files': ['xlsx', 'xls'],
          'CSV Files': ['csv'],
          'All Files': ['*']
        }
      });
      
      if (saveUri) {
        // Copy the file to the selected location
        await vscode.workspace.fs.copy(fileUri, saveUri, { overwrite: true });
        vscode.window.showInformationMessage(`File downloaded successfully to ${saveUri.fsPath}`);
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      vscode.window.showErrorMessage(`Failed to download file: ${error}`);
    }
  }

  /**
   * Handle file open request from webview
   * @param filePath Path to the file to open
   */
  private async handleFileOpen(filePath: string): Promise<void> {
    try {
      let resolvedPath = filePath;
      
      // If it's a relative path, resolve it relative to the workspace
      if (!path.isAbsolute(filePath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          resolvedPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
          console.log(`Resolved relative path for open: ${filePath} -> ${resolvedPath}`);
        }
      }
      
      // Check if file exists
      const fileUri = vscode.Uri.file(resolvedPath);
      await vscode.workspace.fs.stat(fileUri);
      
      // Check if it's an Excel file (or other binary file) that should be opened externally
      const fileExtension = path.extname(resolvedPath).toLowerCase();
      const binaryExtensions = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.pdf', '.doc', '.docx', '.ppt', '.pptx'];
      
      if (binaryExtensions.includes(fileExtension)) {
        // Open with default Windows application
        await vscode.env.openExternal(fileUri);
        console.log(`Opened file with default application: ${resolvedPath}`);
      } else {
        // Open the file in VS Code for text files
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
        console.log(`Opened file in VS Code: ${resolvedPath}`);
      }
    } catch (error) {
      console.error('Error opening file:', error);
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
      console.error('Error opening external URL:', error);
      vscode.window.showErrorMessage(`Failed to open URL: ${url}`);
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
        console.error("Error in LWC UI message listener:", error);
      }
    });
  }

  private update() {
    const webview = this.panel.webview;

    this.panel.title = "SFDX Hardis LWC UI";
    this.panel.webview.html = this.getHtmlForWebview(webview);
  }

  private getHtmlForWebview(webview: vscode.Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webviews", "lwc-ui.js")
    );

    // Get path to SLDS CSS (copied by webpack)
    const sldsStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "out",
        "assets",
        "styles",
        "salesforce-lightning-design-system.min.css"
      )
    );

    // Get path to SLDS icons directory (copied by webpack)
    const sldsIconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "assets", "icons")
    );

    // Safely serialize initialization data
    const initDataJson = this.initializationData
      ? JSON.stringify(this.initializationData)
          .replace(/'/g, "&#39;")
          .replace(/"/g, "&quot;")
      : "{}";

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
          #app { width: 100%; height: 100vh; }
        </style>
      </head>
      <body class="slds-scope">
        <div id="app" data-lwc-id="${this.lwcId}" data-init-data="${initDataJson}"></div>
        
        <script>
          // Set SLDS icons path for LWC components
          window.SLDS_ICONS_PATH = "${sldsIconsUri}";
        </script>
        <script src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
