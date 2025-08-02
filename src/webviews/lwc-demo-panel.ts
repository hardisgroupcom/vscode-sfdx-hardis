import * as vscode from "vscode";

export class LwcDemoPanel {
  private static currentPanel: LwcDemoPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set the webview's initial html content
    this.update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (LwcDemoPanel.currentPanel) {
      LwcDemoPanel.currentPanel.panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      "lwcDemo",
      "SFDX Hardis LWC Demo",
      column || vscode.ViewColumn.One,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "out", "webviews"),
          vscode.Uri.joinPath(extensionUri, "node_modules", "@salesforce-ux", "design-system"),
        ],
      }
    );

    LwcDemoPanel.currentPanel = new LwcDemoPanel(panel, extensionUri);
  }

  public dispose() {
    LwcDemoPanel.currentPanel = undefined;

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

    this.panel.title = "SFDX Hardis LWC Demo";
    this.panel.webview.html = this.getHtmlForWebview(webview);
  }

  private getHtmlForWebview(webview: vscode.Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webviews', 'lwc-demo.js')
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

    // Get path to SLDS SVG sprites (copied by webpack in the icons directory)
    const sldsUtilitySymbolsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'out',
        'webviews',
        'assets',
        'icons',
        'utility-sprite',
        'svg',
        'symbols.svg'
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
        
        <title>SFDX Hardis LWC Demo</title>
        
        <style>
          body {
            margin: 0;
            padding: 20px;
            font-family: 'Salesforce Sans', Arial, sans-serif;
            background: #f3f3f3;
            min-height: 100vh;
          }
          
          #app {
            max-width: 800px;
            margin: 0 auto;
          }
        </style>
        <script nonce="${nonce}">
          // Configure LWC runtime for synthetic shadow DOM
          window.lwcRuntimeFlags = {
            ENABLE_SYNTHETIC_SHADOW_SUPPORT_FOR_TEMPLATE: true,
            ENABLE_SYNTHETIC_SHADOW_SUPPORT_FOR_STYLE: true
          };
          
          // Make SLDS utility symbols URI available globally
          window.SLDS_UTILITY_SYMBOLS_URI = '${sldsUtilitySymbolsUri}';
          
          // Ensure SLDS is loaded before LWC initialization
          window.addEventListener('DOMContentLoaded', function() {
            console.log('DOM loaded, SLDS styles should be available');
          });
        </script>
      </head>
      <body class="slds-scope">
        <div id="app"></div>
        
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
