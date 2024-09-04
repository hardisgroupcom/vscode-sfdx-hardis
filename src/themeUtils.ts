import path from "path";
import * as vscode from "vscode";

export class ThemeUtils {
  public emojisInSections: boolean;
  public menuIconType: "vscode" | "hardis";
  public allTopicEmojis: any;
  public allCommandIcons: any;

  constructor() {
    const { emojisInSections, menuIconType } =
      ThemeUtils.getThemeConfiguration();
    this.emojisInSections = emojisInSections;
    this.menuIconType = menuIconType;
    this.allTopicEmojis = this.getAllTopicEmojis();
    this.allCommandIcons = this.getAllCommandIcons();
  }

  public buildSectionLabel(sectionId: string, label: string) {
    return this.emojisInSections && this.allTopicEmojis[sectionId]
      ? label + " " + this.allTopicEmojis[sectionId]
      : label;
  }

  public getCommandIconPath(command: string) {
    const icon = this.allCommandIcons[command]
      ? this.allCommandIcons[command][this.menuIconType] ||
        this.allCommandIcons["default"][this.menuIconType]
      : this.allCommandIcons["default"][this.menuIconType];
    if (icon.endsWith(".svg")) {
      // Use SVG
      return {
        light: path.join(__filename, "..", "..", "resources", String(icon)),
        dark: path.join(__filename, "..", "..", "resources", String(icon)),
      };
    }
    // Or use vscode Theme icon
    return new vscode.ThemeIcon(icon);
  }

  public static getThemeConfiguration(): {
    emojisInSections: boolean;
    menuIconType: "vscode" | "hardis";
  } {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis.theme");
    return {
      emojisInSections: config.get("emojisInSections", true),
      menuIconType: config.get("menuIconType", "hardis"),
    };
  }

  public static async promptUpdateConfiguration(): Promise<void> {
    const themeChoices: vscode.QuickPickItem[] = [
      { label: "hardis", detail: "Colored SVG Icons" },
      { label: "vscode", detail: "Standard Visual Studio Code Icons" },
    ];
    const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    const menuIconType = await new Promise<any>((resolve, reject) => {
      quickpick.ignoreFocusOut = true;
      quickpick.title = "Please select a theme to use";
      quickpick.canSelectMany = false;
      quickpick.items = themeChoices;
      // Show quickpick item
      quickpick.show();
      // Handle ESCAPE key
      quickpick.onDidHide(() => resolve(null));
      // Handle user selection
      quickpick.onDidAccept(() => {
        if (quickpick.selectedItems.length > 0) {
          const value = quickpick.selectedItems[0].label;
          quickpick.dispose();
          resolve(value);
        }
        quickpick.dispose();
        resolve(null);
      });
    });
    const quickpick2 = vscode.window.createQuickPick<vscode.QuickPickItem>();
    const emojisChoices: vscode.QuickPickItem[] = [
      { label: "With Emojis", detail: "Display section titles with emojis" },
      { label: "Without Emojis", detail: "Hide emojis in section title" },
    ];
    const emojisInSections = await new Promise<any>((resolve, reject) => {
      quickpick2.ignoreFocusOut = true;
      quickpick2.title = "Please select a theme to use";
      quickpick2.canSelectMany = false;
      quickpick2.items = emojisChoices;
      // Show quickpick item
      quickpick2.show();
      // Handle user selection
      quickpick2.onDidAccept(() => {
        if (quickpick2.selectedItems.length > 0) {
          const value = quickpick2.selectedItems[0].label;
          quickpick2.dispose();
          resolve(value);
        }
        quickpick2.dispose();
        resolve(null);
      });
      // Handle ESCAPE key
      quickpick2.onDidHide(() => resolve(null));
    });
    if (menuIconType === null || emojisInSections === null) {
      return;
    }
    // Update configuration
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis.theme");
    if (config.get("menuIconType") !== menuIconType) {
      await config.update(
        "menuIconType",
        menuIconType,
        vscode.ConfigurationTarget.Global,
      );
    }
    if (
      config.get("emojisInSections") !==
      (emojisInSections === "With Emojis" ? true : false)
    ) {
      await config.update(
        "emojisInSections",
        emojisInSections === "With Emojis" ? true : false,
        vscode.ConfigurationTarget.Global,
      );
    }
  }

  public getAllTopicEmojis(): any {
    return {
      "cicd-simple": "🙂",
      "cicd-advanced": "😎",
      "cicd-misc": "🥸",
      data: "🚚",
      files: "📂",
      debug: "🐞",
      "org-operations": "🛠️",
      "org-monitoring": "🔬",
      "metadata-analysis": "⚗️",
      "setup-config": "⚙️",
      packaging: "📦",
      "nerdy-stuff": "🤓",
      "extension-settings": "🎨",
      help: "♾️",
      "status-plugins-sfdx": "🤖",
      "status-plugins-core": "🦾",
      "status-vscode-extensions": "🦿",
      "status-org": "☁️",
      "status-git": "🌱",
      "status-org-devhub": "⚓",
    };
  }

  public getAllCommandIcons(): any {
    return {
      default: { vscode: "run", hardis: "default.svg" },
      "hardis:work:new": { vscode: "new-file", hardis: "new.svg" },
      "scratch:pull-from-org-to-git": {
        vscode: "cloud-download",
        hardis: "pull.svg",
      },
      "hardis:work:save": { vscode: "save", hardis: "save.svg" },
      "hardis:work:resetselection": { vscode: "history", hardis: "reset.svg" },
      "scratch:push-from-git-to-org": {
        vscode: "cloud-upload",
        hardis: "push.svg",
      },
      "package:install": { vscode: "package", hardis: "package.svg" },
      "org:retrieve:packageconfig": {
        vscode: "cloud-download",
        hardis: "pull.svg",
      },
      "project:clean:references": { vscode: "flame", hardis: "clean.svg" },
      "scratch:create": {
        vscode: "file-directory-create",
        hardis: "salesforce.svg",
      },
      "scratch:create:new": {
        vscode: "file-directory-create",
        hardis: "salesforce.svg",
      },
      "org:password:generate": { vscode: "lock", hardis: "password.svg" },
      org: { vscode: "cloud", hardis: "salesforce.svg" },
      "git:repo": { vscode: "repo", hardis: "git.svg" },
      "git:branch": { vscode: "git-branch", hardis: "git.svg" },
      "git:branch:warning": { vscode: "warning", hardis: "warning.svg" },
      "git:pull-request": { vscode: "git-pull-request", hardis: "merge.svg" },
      "org:connect": { vscode: "globe", hardis: "select.svg" },
      "org:connect:devhub": { vscode: "globe", hardis: "select.svg" },
      "org:expired": { vscode: "error", hardis: "error.svg" },
      "org:expired:soon": { vscode: "warning", hardis: "warning.svg" },
      "org:user": { vscode: "account", hardis: "sf-user.svg" },
      "org:setup": { vscode: "gear", hardis: "sf-setup.svg" },
      "org:pool": { vscode: "radio-tower", hardis: "pool.svg" },
      "source:retrieve": { vscode: "cloud-download", hardis: "pull.svg" },
      "org:retrieve:sources:analytics": {
        vscode: "pie-chart",
        hardis: "pull.svg",
      },
      "force:source:tracking:clear": { vscode: "trash", hardis: "trash.svg" },
      "force:source:tracking:reset": {
        vscode: "warning",
        hardis: "warning.svg",
      },
      "org:data:export": { vscode: "cloud-download", hardis: "data.svg" },
      "org:data:import": { vscode: "cloud-upload", hardis: "data.svg" },
      "org:data:delete": { vscode: "trash", hardis: "trash.svg" },
      "org:data:configure": { vscode: "gear", hardis: "configure.svg" },
      "org:files:export": { vscode: "cloud-download", hardis: "file.svg" },
      "org:files:import": { vscode: "cloud-upload", hardis: "file.svg" },
      "org:files:configure": { vscode: "gear", hardis: "configure.svg" },
      "hardis:debug:run": { vscode: "debug-console", hardis: "debug.svg" },
      "hardis:debug:activate": {
        vscode: "breakpoints-activate",
        hardis: "toggle-on.svg",
      },
      "hardis:debug:deactivate": {
        vscode: "debug-disconnect",
        hardis: "toggle-off.svg",
      },
      "org:purge:apexlog": { vscode: "trash", hardis: "trash.svg" },
      "org:apex:log:tail": { vscode: "inspect", hardis: "log.svg" },
      "hardis:debug:importapex": {
        vscode: "cloud-download",
        hardis: "pull.svg",
      },
      "org:user:freeze": { vscode: "pinned", hardis: "freeze.svg" },
      "org:user:unfreeze": { vscode: "rocket", hardis: "unfreeze.svg" },
      "org:purge:flow": { vscode: "trash", hardis: "flow.svg" },
      "hardis:scratch:delete": { vscode: "trash", hardis: "trash.svg" },
      "hardis:org:user:activateinvalid": {
        vscode: "account",
        hardis: "user.svg",
      },
      "hardis:org:monitor:backup": { vscode: "save-all", hardis: "backup.svg" },
      "hardis:org:diagnose:audittrail": {
        vscode: "eye-watch",
        hardis: "monitoring.svg",
      },
      "org:test:apex": { vscode: "testing-run-all-icon", hardis: "test.svg" },
      "hardis:org:monitor:limits": { vscode: "eye-watch", hardis: "gauge.svg" },
      "org:diagnose:legacyapi": { vscode: "watch", hardis: "old.svg" },
      "hardis:org:diagnose:unusedusers": {
        vscode: "person",
        hardis: "dollar.svg",
      },
      "hardis:org:diagnose:unusedlicenses": {
        vscode: "cloud",
        hardis: "dollar.svg",
      },
      "hardis:lint:access": { vscode: "law", hardis: "password.svg" },
      "hardis:lint:unusedmetadatas": { vscode: "law", hardis: "trash.svg" },
      "hardis:lint:metadatastatus": { vscode: "law", hardis: "flow.svg" },
      "hardis:lint:missingattributes": { vscode: "law", hardis: "doc.svg" },
      "project:audit:duplicatefiles": {
        vscode: "law",
        hardis: "duplicate.svg",
      },
      "project:metadata:findduplicates": {
        vscode: "workspace-unknown",
        hardis: "duplicate.svg",
      },
      "project:audit:apiversion": { vscode: "law", hardis: "extract.svg" },
      "project:audit:callincallout": { vscode: "law", hardis: "http.svg" },
      "project:audit:remotesites": { vscode: "law", hardis: "remote.svg" },
      "configure:auth:deployment": { vscode: "gear", hardis: "configure.svg" },
      "configure:auth:devhub": { vscode: "gear", hardis: "configure.svg" },
      "org:configure:monitoring": { vscode: "gear", hardis: "monitoring.svg" },
      "scratch:pool:create": { vscode: "gear", hardis: "pool.svg" },
      "project:create": { vscode: "new-folder", hardis: "new.svg" },
      "hardis:package:create": { vscode: "plus", hardis: "package.svg" },
      "hardis:package:version:list": {
        vscode: "list-unordered",
        hardis: "package.svg",
      },
      "hardis:package:version:create": {
        vscode: "plus",
        hardis: "package.svg",
      },
      "project:generate:gitdelta": { vscode: "git-branch", hardis: "git.svg" },
      "org:generate:packagexmlfull": {
        vscode: "explorer-view-icon",
        hardis: "package.svg",
      },
      "org:retrieve:sources:dx2": {
        vscode: "cloud-download",
        hardis: "pull.svg",
      },
      "org:retrieve:sources:dx": {
        vscode: "cloud-download",
        hardis: "pull.svg",
      },
      "org:retrieve:sources:metadata": {
        vscode: "cloud-download",
        hardis: "pull.svg",
      },
      "package:mergexml": { vscode: "files", hardis: "merge.svg" },
      "org:logout": { vscode: "log-out", hardis: "logout.svg" },
      "git:login": { vscode: "log-in", hardis: "git.svg" },
      "extension:settings:theme": {
        vscode: "symbol-color",
        hardis: "colorPicker.svg",
      },
      "extension:settings:all": {
        vscode: "settings-editor-label-icon",
        hardis: "configure.svg",
      },
      "contact:us": { vscode: "question", hardis: "help.svg" },
      "help:commands": { vscode: "list-unordered", hardis: "help.svg" },
      "help:cicd": { vscode: "github-action", hardis: "help.svg" },
      question: { vscode: "question", hardis: "help.svg" },
      hardis: { vscode: "info", hardis: "help.svg" },
      "dependency-ok": { vscode: "check", hardis: "ok.svg" },
      "dependency-missing": { vscode: "error", hardis: "missing.svg" },
      "dependency-warning": { vscode: "warning", hardis: "warning.svg" },
      "dependency-preview": { vscode: "gear", hardis: "hammer-wrench.svg" },
      "dependency-error": { vscode: "error", hardis: "error.svg" },
      "dependency-local": { vscode: "gear", hardis: "hammer-wrench.svg" },
    };
  }
}
