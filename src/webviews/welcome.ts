import * as fs from "fs-extra";
import * as vscode from "vscode";

export class WelcomePanel {
  disposables: vscode.Disposable[] = [];

  constructor() {
    this.registerCommands();
  }

  registerCommands() {
    this.registerWelcomeCommand();
  }

  registerWelcomeCommand() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.welcome",
      () => this.displayWelcomePanel(),
    );
    this.disposables.push(disposable);
  }

  displayWelcomePanel() {
    // Create and show panel
    const panel = vscode.window.createWebviewPanel(
      "sfdxHardisWelcome",
      "SFDX Hardis: Welcome",
      vscode.ViewColumn.One,
      {},
    );

    // And set its HTML content
    panel.webview.html = this.getWebviewContent();
  }

  getWebviewContent() {
    return `
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SFDX Hardis: Welcome</title>
</head>

<body>
    <img src="https://github.com/hardisgroupcom/vscode-sfdx-hardis/raw/main/docs/assets/images/hardis-banner.jpg" />

    <p>This extension runs CLI commands, so it relies on locally installed applications and sfdx plugins</p>

    <ul>
        <li><a href="https://nodejs.org/en/">Node.js</a> (must be manually installed)</li>
        <li><a href="https://git-scm.com/downloads">Git</a> (must be manually installed</li>
    </ul>

    <p>This extension works better using <strong>Git bash as terminal runner</strong>. Please select it as default Terminal runner</b>

    <p>Status panel shows you when a plugin is missing or needs to be updated (Click on Warning icon to launch the
        update plugin command)</p>

    <p>For commands documentation, please check <a
            href="https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis">online
            documentation</a></p>

    </p>
</body>

</html>
`;
  }
}
