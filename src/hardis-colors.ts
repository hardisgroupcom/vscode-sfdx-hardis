import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { execSfdxJson, getUsernameInstanceUrl, hasSfdxProjectJson, loadFromLocalConfigFile, readSfdxHardisConfig, writeSfdxHardisConfig } from "./utils";

const PRODUCTION_EDITIONS = [
  "Team Edition",
  "Professional Edition",
  "Enterprise Edition",
  "Personal Edition",
  "Unlimited Edition",
  "Contact Manager Edition",
  "Base Edition",
];

export class HardisColors {
  sfdxConfigPaths = [".sf/config.json", ".sfdx/sfdx-config.json"];
  disposables: vscode.Disposable[] = [];
  majorOrgInstanceUrls: string[] = [];
  currentDefaultOrg: string | undefined = undefined;
  currentDefaultOrgDomain: string | undefined | null = undefined;

  // Initialize file watchers only if we are in a sfdx project
  constructor() { }

  async init() {
    this.dispose();
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");

    // Manage color only if not disabled and in a sfdx project context
    if (hasSfdxProjectJson() && vscode.workspace.workspaceFolders && config.get("disableVsCodeColors") !== true) {
      // Watch config files
      this.registerFileSystemWatchers();
      await this.initColor();
    }
  }

  // Set color at initialization by reading sfdx local file(s)
  async initColor() {
    if (vscode.workspace.workspaceFolders) {
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

  registerColorPickerCommand() {
    // Refresh commands tree
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.selectColorForOrg",
      async () => {
        if (this.currentDefaultOrgDomain) {
          const sfdxHardisConfig = await readSfdxHardisConfig();
          const orgCustomColors = sfdxHardisConfig.orgCustomColors || {};
          const color = "#eb34de";
          orgCustomColors[this.currentDefaultOrgDomain] = color;
          await writeSfdxHardisConfig("orgCustomColors", color);
          await this.initColor();
        }
        else {
          vscode.window.showWarningMessage(
            "🦙 You need to select a default org to define a color for it :)",
            "Close"
          );
        }
      }
    );
    this.disposables.push(disposable);
  }

  // Read file and check if it has to be colored
  async manageColor(file: string) {
    const fileContent = await fs.readJSON(file);
    const fileDefaultOrg =
      fileContent["target-org"] || fileContent["defaultusername"];
    if (fileDefaultOrg !== this.currentDefaultOrg) {
      this.currentDefaultOrg = fileDefaultOrg;
      this.currentDefaultOrgDomain = await getUsernameInstanceUrl(this.currentDefaultOrg || "");
      const orgColor = await this.getCurrentDefaultOrgColor();
      this.applyColor(orgColor);
    }
  }

  // Get org color :)
  async getCurrentDefaultOrgColor() {
    // Get user customized color directly in config/.sfdx-hardis.yml
    const sfdxHardisConfig = await readSfdxHardisConfig();
    const orgCustomColors = sfdxHardisConfig.orgCustomColors || {};
    if (orgCustomColors[this.currentDefaultOrgDomain || ""]) {
      return orgCustomColors[this.currentDefaultOrgDomain || ""];
    }
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
        // We are in a dev sandbox or scratch org !
        const isMajorOrg = await this.isMajorOrg(this.currentDefaultOrg || "");
        if (isMajorOrg) {
          vscode.window.showWarningMessage(
            "🦙 Your default org is a MAJOR org, be careful because CI Server are supposed to deploy here, not you :)",
            "Close"
          );
          return "#a66004"; // orange !
        }
        return "#04590c"; // green !
      } else if (PRODUCTION_EDITIONS.includes(org.OrganizationType)) {
        // We are in production !!
        vscode.window.showWarningMessage(
          "🦙 Your default org is a PRODUCTION org, be careful what you do :)",
          "Close"
        );
        return "#8c1004"; // red !
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

  async isMajorOrg(orgInstanceUrl: string) {
    const majorOrgInstanceUrls = await this.listMajorOrgsInstanceUrls();
    if (majorOrgInstanceUrls.includes(orgInstanceUrl)) {
      return true;
    }
    return false;
  }

  // Use instanceUrl list where deployments are made by CI server, not manually (their auth config is in .sfdh-hardis config)
  async listMajorOrgsInstanceUrls() {
    // Use cache
    if (this.majorOrgInstanceUrls.length > 0) {
      return this.majorOrgInstanceUrls;
    }
    // Read config files
    if (vscode.workspace.workspaceFolders) {
      const sfdxHardisConfigFilesPattern = new vscode.RelativePattern(
        vscode.workspace.workspaceFolders[0],
        `**/.sfdx-hardis*.yml`
      );
      const fileUris = await vscode.workspace.findFiles(sfdxHardisConfigFilesPattern);
      const orgInstanceUrls = [];
      for (const fileUri of fileUris) {
        const sfdxHardisConfig = await loadFromLocalConfigFile(fileUri.fsPath);
        if (sfdxHardisConfig.instanceUrl) {
          orgInstanceUrls.push(sfdxHardisConfig.instanceUrl);
        }
      }
      this.majorOrgInstanceUrls = orgInstanceUrls;
      return this.majorOrgInstanceUrls;
    }
    return [];
  }

  // Remove custom colors when quitting the extension or VsCode
  dispose() {
    this.currentDefaultOrg = undefined;
    this.currentDefaultOrgDomain = undefined;
    this.majorOrgInstanceUrls = [];
    this.disposables.map((disposable) => disposable.dispose());
    this.applyColor(null);
  }
}
