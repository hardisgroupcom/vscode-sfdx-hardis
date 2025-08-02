import * as vscode from "vscode";

export class LwcUiPanel {
  private static currentPanels: Map<string, LwcUiPanel> = new Map();
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private lwcId: string;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, lwcId: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.lwcId = lwcId;

    // Set the webview's initial html content
    this.update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        // Instead of dispatching a DOM event, use VS Code's command system to broadcast the message
        vscode.commands.executeCommand("sfdxHardis.lwcUiMessage", message);
      },
      null,
      this.disposables
    );
  }

  public static display(extensionUri: vscode.Uri, lwcId: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (LwcUiPanel.currentPanels.has(lwcId)) {
      LwcUiPanel.currentPanels.get(lwcId)!.panel.reveal(column);
      return LwcUiPanel.currentPanels.get(lwcId);
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

    LwcUiPanel.currentPanels.set(lwcId, new LwcUiPanel(panel, extensionUri, lwcId));
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

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; connect-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <link href="${sldsStylesUri}" rel="stylesheet">
        <link rel="icons" href="${sldsIconsUri}">
        
        <title>SFDX Hardis LWC UI</title>
      </head>
      <body class="slds-scope">
        <div id="app" data-lwc-id="${this.lwcId}"></div>
        
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
