import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { execSfdxJson, hasSfdxProjectJson } from "./utils";

export class HardisColors {
  sfdxConfigPaths = [".sf/config.json", ".sfdx/sfdx-config.json"];
  disposables: vscode.Disposable[] = [];
  currentDefaultOrg: string | undefined = undefined;
  currentDefaultOrgDomain: string | undefined = undefined;

  // Initialize file watchers only if we are in a sfdx project
  constructor() {}

  async init() {
    if (hasSfdxProjectJson() && vscode.workspace.workspaceFolders) {
      this.applyColor(null);
      this.registerFileSystemWatchers();
      for (const sfdxConfigPath of this.sfdxConfigPaths) {
        const sfdxConfigFullPath = path.join(
          vscode.workspace.workspaceFolders[0].uri.fsPath,
          sfdxConfigPath
        );
        if (fs.existsSync(sfdxConfigFullPath)) {
          await this.manageColor(sfdxConfigFullPath);
          break;
        }
      }
    } else {
      this.dispose();
    }
  }

  // Watch sfdx config files in order to detect changes of default org
  registerFileSystemWatchers() {
    if (vscode.workspace.workspaceFolders) {
      for (const sfdxConfigPath of this.sfdxConfigPaths) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            vscode.workspace.workspaceFolders[0],
            `**/${sfdxConfigPath}`
          )
        );
        watcher.onDidCreate((uri) => this.manageColor(uri.fsPath));
        watcher.onDidChange((uri) => this.manageColor(uri.fsPath));
        this.disposables.push(watcher);
      }
    }
  }

  // Read file and check if it has to be colored
  async manageColor(file: string) {
    const fileContent = await fs.readJSON(file);
    const fileDefaultOrg =
      fileContent["target-org"] || fileContent["defaultusername"];
    if (fileDefaultOrg !== this.currentDefaultOrg) {
      this.currentDefaultOrg = fileDefaultOrg;
      const orgColor = await this.getCurrentDefaultOrgColor();
      this.applyColor(orgColor);
    }
  }

  // Get org color :)
  async getCurrentDefaultOrgColor() {
    // https://salesforce.stackexchange.com/questions/297452/determine-if-authorized-org-with-salesforcedx-is-developer-or-production
    // Detect if sandbox or not
    const orgRes = await execSfdxJson(
      `sfdx force:data:soql:query -q "SELECT IsSandbox,OrganizationType FROM Organization LIMIT 1" --target-org ${this.currentDefaultOrg}`,
      {
        fail: false,
        output: true,
      }
    );
    if (orgRes?.result?.records?.length === 1) {
      const org = orgRes.result.records[0];
      if (org.IsSandbox === true) {
          // We are in a sandbox
          return "#1a660a"; // green !
      }
      else if (org.OrganizationType === 'Enterprise Edition') {
        // We are in production !!
        vscode.window.showWarningMessage("Your default org is a PRODUCTION org, be careful what you do :)");
        return "#c73a24"; // red !
      }
      // Dev org, trial org...
      return "#2f53a8"; // blue
    }
    // Default color
    return null;
  }

  // Apply color to current VsCode Workspace config
  applyColor(color: string | null) {
    if (vscode.workspace.workspaceFolders) {
      const config = vscode.workspace.getConfiguration();
      const colorCustomization: any = config.get(
        "workbench.colorCustomizations"
      );
      colorCustomization["statusBar.background"] = color || undefined;
      colorCustomization["activityBar.background"] = color || undefined;
      config.update(
        "workbench.colorCustomizations",
        colorCustomization,
        vscode.ConfigurationTarget.Workspace
      );
    }
  }

  // Remove custom colors when quitting the extension or VsCode
  dispose() {
    this.disposables.map((disposable) => disposable.dispose());
    this.applyColor(null);
  }
}
