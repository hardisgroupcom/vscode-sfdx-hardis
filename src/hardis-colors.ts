import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import {
  execSfdxJson,
  getUsernameInstanceUrl,
  hasSfdxProjectJson,
  loadFromLocalConfigFile,
  readSfdxHardisConfig,
  writeSfdxHardisConfig,
} from "./utils";

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
  initializing: boolean = true;

  // Initialize file watchers only if we are in a sfdx project
  constructor() {}

  async init() {
    this.initializing = true;
    this.reset();
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");

    // Manage color only if not disabled and in a sfdx project context
    if (
      hasSfdxProjectJson() &&
      vscode.workspace.workspaceFolders &&
      config.get("disableVsCodeColors") !== true
    ) {
      // Watch config files
      this.registerFileSystemWatchers();
      this.registerColorPickerCommand();
      await this.initColor();
      this.initializing = false;
    }
  }

  // Set color at initialization by reading sfdx local file(s)
  async initColor() {
    if (vscode.workspace.workspaceFolders) {
      for (const sfdxConfigPath of this.sfdxConfigPaths) {
        const sfdxConfigFullPath = path.join(
          vscode.workspace.workspaceFolders[0].uri.fsPath,
          sfdxConfigPath,
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
            `**/${sfdxConfigPath}`,
          ),
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
          const customOrgColors = sfdxHardisConfig.customOrgColors || {};
          const color = await this.promptColor(this.currentDefaultOrgDomain);
          if (!color) {
            return;
          }
          customOrgColors[this.currentDefaultOrgDomain] = color;
          await writeSfdxHardisConfig("customOrgColors", customOrgColors);
          this.applyColor(color);
        } else {
          vscode.window.showWarningMessage(
            "🦙 You need to select a default org to define a color for it :)",
            "Close",
          );
        }
      },
    );
    this.disposables.push(disposable);
  }

  // Prompt color to user
  // Will be replaced by color picker once available in VsCode API: https://github.com/microsoft/vscode/pull/178242
  async promptColor(org: string) {
    const inputBoxOptions: vscode.InputBoxOptions = {
      prompt: `Please enter a color code for ${org} (type "color picker" in google to get one)`,
      placeHolder: "Example: #0335fc",
      ignoreFocusOut: true,
      validateInput: (text) => {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(text)
          ? null
          : "This is not a valid color code ! (ex: #0335fc)"; // return null if validates
      },
    };
    try {
      const color = await vscode.window.showInputBox(inputBoxOptions);
      return color;
    } catch (e) {
      return null;
    }
  }

  // Read file and check if it has to be colored
  async manageColor(file: string) {
    const fileContent = await fs.readJSON(file);
    const fileDefaultOrg =
      fileContent["target-org"] || fileContent["defaultusername"];
    if (fileDefaultOrg !== this.currentDefaultOrg) {
      this.currentDefaultOrg = fileDefaultOrg;
      this.currentDefaultOrgDomain = await getUsernameInstanceUrl(
        this.currentDefaultOrg || "",
      );
      const orgColor = await this.getCurrentDefaultOrgColor();
      this.applyColor(orgColor);
      // Refresh status panel when colors is changed except at initialization
      if (this.initializing === false) {
        vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
      }
    }
  }

  // Get org color :)
  async getCurrentDefaultOrgColor() {
    // Get user customized color directly in config/.sfdx-hardis.yml
    let forcedColor = null;
    const sfdxHardisConfig = await readSfdxHardisConfig();
    const customOrgColors = sfdxHardisConfig.customOrgColors || {};
    if (customOrgColors[this.currentDefaultOrgDomain || ""]) {
      forcedColor = customOrgColors[this.currentDefaultOrgDomain || ""];
    }
    // https://salesforce.stackexchange.com/questions/297452/determine-if-authorized-org-with-salesforcedx-is-developer-or-production
    // Detect if sandbox or not
    const orgRes = await execSfdxJson(
      `sfdx force:data:soql:query -q "SELECT IsSandbox,OrganizationType FROM Organization LIMIT 1" --target-org ${this.currentDefaultOrg}`,
      {
        fail: false,
        output: true,
      },
    );
    if (orgRes?.result?.records?.length === 1) {
      const org = orgRes.result.records[0];
      if (org.IsSandbox === true) {
        // We are in a dev sandbox or scratch org !
        const isMajorOrg = await this.isMajorOrg(
          this.currentDefaultOrgDomain || "",
        );
        if (isMajorOrg) {
          vscode.window.showWarningMessage(
            "🦙 Your default org is a MAJOR org, be careful because the CI/CD Server is supposed to deploy here, not you :)",
            "Close",
          );
          return forcedColor || "#a66004"; // orange !
        }
        return forcedColor || "#04590c"; // green !
      } else if (PRODUCTION_EDITIONS.includes(org.OrganizationType)) {
        // We are in production !!
        vscode.window.showWarningMessage(
          "🦙 Your default org is a PRODUCTION org, be careful what you do :)",
          "Close",
        );
        return forcedColor || "#8c1004"; // red !
      }
      // Dev org, trial org...
      return forcedColor || "#2f53a8"; // blue
    }
    // Default color
    return forcedColor || null;
  }

  // Apply color to current VsCode Workspace config
  applyColor(color: string | null) {
    if (vscode.workspace.workspaceFolders) {
      const config = vscode.workspace.getConfiguration();
      const colorCustomization: any = config.get(
        "workbench.colorCustomizations",
      );
      colorCustomization["statusBar.background"] = color || undefined;
      colorCustomization["activityBar.background"] = color || undefined;
      config.update(
        "workbench.colorCustomizations",
        colorCustomization,
        vscode.ConfigurationTarget.Workspace,
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

  // Use instanceUrl list where deployments are made by CI server, not manually (their auth config is in .sfdx-hardis config)
  async listMajorOrgsInstanceUrls() {
    // Use cache
    if (this.majorOrgInstanceUrls.length > 0) {
      return this.majorOrgInstanceUrls;
    }
    // Read config files
    if (vscode.workspace.workspaceFolders) {
      const sfdxHardisConfigFilesPattern = new vscode.RelativePattern(
        vscode.workspace.workspaceFolders[0],
        `**/.sfdx-hardis*.yml`,
      );
      const fileUris = await vscode.workspace.findFiles(
        sfdxHardisConfigFilesPattern,
      );
      const orgInstanceUrls = [];
      for (const fileUri of fileUris) {
        const sfdxHardisConfig = await loadFromLocalConfigFile(fileUri.fsPath);
        if (sfdxHardisConfig.instanceUrl) {
          orgInstanceUrls.push(sfdxHardisConfig.instanceUrl.replace(/\/$/, "")); // remove trailing slash if here
        }
      }
      this.majorOrgInstanceUrls = orgInstanceUrls;
      return this.majorOrgInstanceUrls;
    }
    return [];
  }

  reset() {
    this.currentDefaultOrg = undefined;
    this.currentDefaultOrgDomain = undefined;
    this.majorOrgInstanceUrls = [];
    this.disposables.map((disposable) => disposable.dispose());
    this.applyColor(null);
  }

  // Remove custom colors when quitting the extension or VsCode
  dispose() {
    this.reset();
  }
}
