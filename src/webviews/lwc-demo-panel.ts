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

    // Get path to SLDS CSS
    const sldsStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'node_modules',
        '@salesforce-ux',
        'design-system',
        'assets',
        'styles',
        'salesforce-lightning-design-system.min.css'
      )
    );

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline';">
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
      </head>
      <body>
        <div id="app"></div>
        
        <!-- Hidden SVG sprites for SLDS icons -->
        <svg xmlns="http://www.w3.org/2000/svg" style="display: none;">
          <defs>
            <symbol id="utility-announcement" viewBox="0 0 520 520">
              <path d="M430 190c-17-54-64-90-120-90s-103 36-120 90h-40c-28 0-50 22-50 50v80c0 28 22 50 50 50h40c17 54 64 90 120 90s103-36 120-90h40c28 0 50-22 50-50v-80c0-28-22-50-50-50h-40zm-120 180c-33 0-60-27-60-60v-40c0-33 27-60 60-60s60 27 60 60v40c0 33-27 60-60 60z"/>
            </symbol>
            <symbol id="utility-add" viewBox="0 0 520 520">
              <path d="M460 230H290V60c0-17-13-30-30-30s-30 13-30 30v170H60c-17 0-30 13-30 30s13 30 30 30h170v170c0 17 13 30 30 30s30-13 30-30V290h170c17 0 30-13 30-30s-13-30-30-30z"/>
            </symbol>
            <symbol id="utility-dash" viewBox="0 0 520 520">
              <path d="M460 230H60c-17 0-30 13-30 30s13 30 30 30h400c17 0 30-13 30-30s-13-30-30-30z"/>
            </symbol>
            <symbol id="utility-refresh" viewBox="0 0 520 520">
              <path d="M260 60c-55 0-105 22-141 58l-26-26c-6-6-15-6-21 0s-6 15 0 21l70 70c6 6 15 6 21 0l70-70c6-6 6-15 0-21s-15-6-21 0l-25 25c27-27 64-43 104-43 80 0 145 65 145 145s-65 145-145 145c-62 0-115-39-135-94-3-8-12-12-20-9s-12 12-9 20c26 71 93 123 174 123 100 0 180-80 180-180S360 60 260 60z"/>
            </symbol>
          </defs>
        </svg>
        
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
