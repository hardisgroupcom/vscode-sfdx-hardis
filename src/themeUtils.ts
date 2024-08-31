import path from "path";
import * as vscode from "vscode";

export class ThemeUtils {
  public emojisInSections: boolean = true;
  public menuIconType: "vscode" | "hardis" = "hardis";
  public allTopicEmojis: any;
  public allCommandIcons: any;

  constructor() {
    this.allTopicEmojis = this.getAllTopicEmojis();
    this.allCommandIcons = this.getAllCommandIcons();
  }

  public buildSectionLabel(sectionId: string, label: string) {
    return this.emojisInSections
      ? this.allTopicEmojis[sectionId] + " " + label
      : label;
  }

  public getCommandIconPath(command: string) {
    const icon =
      this.allCommandIcons[command][this.menuIconType] ||
      this.allCommandIcons["default"][this.menuIconType];
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

  public getAllTopicEmojis(): any {
    return {
      "cicd-simple": "🙂",
      "cicd-advanced": "😎",
      data: "🚚",
      files: "📂",
      debug: "🐞",
      "org-operations": "🛠️",
      "org-monitoring": "🔬",
      "metadata-analysis": "⚗️",
      "setup-config": "⚙️",
      packaging: "📦",
      "nerdy-stuff": "🤓",
      help: "♾️",
    };
  }

  public getAllCommandIcons(): any {
    return {
      default: { vscode: "run", hardis: "default.svg" },
      "hardis:work:new": { vscode: "new-file", hardis: "" },
      "scratch:pull-from-org-to-git": { vscode: "cloud-download", hardis: "" },
      "hardis:work:save": { vscode: "save", hardis: "" },
      "hardis:work:resetselection": { vscode: "history", hardis: "" },
      "scratch:push-from-git-to-org": { vscode: "cloud-upload", hardis: "" },
      "package:install": { vscode: "package", hardis: "" },
      "org:retrieve:packageconfig": { vscode: "package", hardis: "" },
      "project:clean:references": { vscode: "flame", hardis: "" },
      "scratch:create": { vscode: "file-directory-create", hardis: "" },
      "scratch:create:new": { vscode: "file-directory-create", hardis: "" },
      "org:password:generate": { vscode: "lock", hardis: "" },
      "org:connect": { vscode: "globe", hardis: "" },
      "source:retrieve": { vscode: "cloud-download", hardis: "" },
      "org:retrieve:sources:analytics": { vscode: "pie-chart", hardis: "" },
      "force:source:tracking:clear": { vscode: "trash", hardis: "" },
      "force:source:tracking:reset": { vscode: "warning", hardis: "" },
      "org:data:export": { vscode: "cloud-download", hardis: "" },
      "org:data:import": { vscode: "cloud-upload", hardis: "" },
      "org:data:delete": { vscode: "trash", hardis: "" },
      "org:data:configure": { vscode: "gear", hardis: "" },
      "org:files:export": { vscode: "cloud-download", hardis: "" },
      "org:files:import": { vscode: "cloud-upload", hardis: "" },
      "org:files:configure": { vscode: "gear", hardis: "" },
      "hardis:debug:run": { vscode: "debug-console", hardis: "" },
      "hardis:debug:activate": { vscode: "breakpoints-activate", hardis: "" },
      "hardis:debug:deactivate": { vscode: "debug-disconnect", hardis: "" },
      "org:purge:apexlog": { vscode: "trash", hardis: "" },
      "org:apex:log:tail": { vscode: "inspect", hardis: "" },
      "hardis:debug:importapex": { vscode: "cloud-download", hardis: "" },
      "org:user:freeze": { vscode: "", hardis: "freeze.svg" },
      "org:user:unfreeze": { vscode: "", hardis: "unfreeze.svg" },
      "org:purge:flow": { vscode: "", hardis: "flow.svg" },
      "hardis:scratch:delete": { vscode: "", hardis: "trash.svg" },
      "hardis:org:user:activateinvalid": { vscode: "", hardis: "user.svg" },
      "hardis:org:monitor:backup": { vscode: "", hardis: "backup.svg" },
      "hardis:org:diagnose:audittrail": { vscode: "", hardis: "monitoring.svg" },
      "org:test:apex": { vscode: "", hardis: "test.svg" },
      "hardis:org:monitor:limits": { vscode: "", hardis: "gauge.svg" },
      "org:diagnose:legacyapi": { vscode: "", hardis: "old.svg" },
      "hardis:org:diagnose:unusedusers": { vscode: "", hardis: "dollar.svg" },
      "hardis:org:diagnose:unusedlicenses": { vscode: "", hardis: "dollar.svg" }, 
      "hardis:lint:access": { vscode: "", hardis: "password.svg" },
      "hardis:lint:unusedmetadatas": { vscode: "", hardis: "trash.svg" },
      "hardis:lint:metadatastatus": { vscode: "", hardis: "flow.svg" },
      "hardis:lint:missingattributes": { vscode: "", hardis: "doc.svg" },
      "project:audit:duplicatefiles": { "vscode": "", "hardis": "duplicate.svg" },
      "project:metadata:findduplicates": { "vscode": "", "hardis": "duplicate.svg" },
      "project:audit:apiversion": { "vscode": "", "hardis": "extract.svg" },
      "project:audit:callincallout": { "vscode": "", "hardis": "http.svg" },
      "project:audit:remotesites": { "vscode": "", "hardis": "remote.svg" },
      "configure:auth:deployment": { "vscode": "", "hardis": "configure.svg" },
      "configure:auth:devhub": { "vscode": "", "hardis": "configure.svg" },
      "org:configure:monitoring": { "vscode": "", "hardis": "monitoring.svg" },
      "scratch:pool:create": { "vscode": "", "hardis": "pool.svg" },
      "project:create": { "vscode": "", "hardis": "new.svg" },
      "hardis:package:create": { "vscode": "", "hardis": "package.svg" },
      "hardis:package:version:list": { "vscode": "", "hardis": "package.svg" },
      "hardis:package:version:create": { "vscode": "", "hardis": "package.svg" },
      "project:generate:gitdelta": { "vscode": "", "hardis": "git.svg" },
      "org:generate:packagexmlfull": { "vscode": "", "hardis": "package.svg" },
      "org:retrieve:sources:dx2": { "vscode": "", "hardis": "pull.svg" },
      "org:retrieve:sources:dx": { "vscode": "", "hardis": "pull.svg" },
      "org:retrieve:sources:metadata": { "vscode": "", "hardis": "pull.svg" },
      "package:mergexml": { "vscode": "", "hardis": "merge.svg" },
      "org:logout": { "vscode": "", "hardis": "logout.svg" },
      "git:login": { "vscode": "", "hardis": "git.svg" },
      "contact:us": { "vscode": "", "hardis": "help.svg" },
      "help:commands": { "vscode": "", "hardis": "help.svg" },
      "help:cicd": { "vscode": "", "hardis": "help.svg" },
      "question": { "vscode": "", "hardis": "help.svg" },
      "hardis": { "vscode": "", "hardis": "help.svg" }
    };
  }
}
