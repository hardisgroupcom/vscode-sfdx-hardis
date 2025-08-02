import * as vscode from "vscode";

type MessageListener = (messageType: string, data: any) => void;

export class LwcUiPanel {
  private static currentPanels: Map<string, LwcUiPanel> = new Map();
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private lwcId: string;
  private disposables: vscode.Disposable[] = [];
  private messageListeners: MessageListener[] = [];
  private initializationData: any = null;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, lwcId: string, initData?: any) {
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
        // Notify local listeners first
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

  public static display(extensionUri: vscode.Uri, lwcId: string, initData?: any): LwcUiPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (LwcUiPanel.currentPanels.has(lwcId)) {
      const existingPanel = LwcUiPanel.currentPanels.get(lwcId)!;
      existingPanel.panel.reveal(column);
      // Send initialization data if provided
      if (initData) {
        existingPanel.sendInitializationData(initData);
      }
      return existingPanel;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      "lwcUi",
      "SFDX Hardis LWC UI",
      column || vscode.ViewColumn.One,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // Restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "out", "webviews"),
          vscode.Uri.joinPath(extensionUri, "node_modules", "@salesforce-ux", "design-system"),
        ],
      }
    );

    const lwcUiPanel = new LwcUiPanel(panel, extensionUri, lwcId, initData);
    LwcUiPanel.currentPanels.set(lwcId, lwcUiPanel);
    return lwcUiPanel;
  }

  public dispose() {
    LwcUiPanel.currentPanels.delete(this.lwcId);

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

  /**
   * Send initialization data to the webview
   * @param data The data to send to the webview for initialization
   */
  public sendInitializationData(data: any): void {
    this.initializationData = data;
    this.panel.webview.postMessage({
      type: 'initialize',
      data: data
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
   * Notify all registered message listeners
   * @param message The message received from the webview
   */
  private notifyMessageListeners(message: any): void {
    const messageType = message.type || 'unknown';
    const data = message.data || message;
    
    this.messageListeners.forEach(listener => {
      try {
        listener(messageType, data);
      } catch (error) {
        console.error('Error in LWC UI message listener:', error);
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
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webviews', 'lwc-ui.js')
    );

    // Get path to SLDS CSS (copied by webpack)
    const sldsStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'out',
        'webviews',
        'assets',
        'slds.css'
      )
    );

    // Get path to SLDS icons directory (copied by webpack)
    const sldsIconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'out',
        'webviews',
        'assets',
        'icons'
      )
    );

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    // Safely serialize initialization data
    const initDataJson = this.initializationData 
      ? JSON.stringify(this.initializationData).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
      : '{}';

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; connect-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <link href="${sldsStylesUri}" rel="stylesheet">
        <link rel="icons" href="${sldsIconsUri}">
        
        <title>SFDX Hardis LWC UI</title>
        <style>
          body { margin: 0; padding: 0; }
          #app { width: 100%; height: 100vh; }
        </style>
      </head>
      <body class="slds-scope">
        <div id="app" data-lwc-id="${this.lwcId}" data-init-data="${initDataJson}"></div>
        
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
