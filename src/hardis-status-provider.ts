import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSfdxJson } from "./utils";

export class HardisStatusProvider
  implements vscode.TreeDataProvider<StatusTreeItem> {
  constructor(private workspaceRoot: string) { }

  getTreeItem(element: StatusTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StatusTreeItem): Thenable<StatusTreeItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage(
        "No info available until you open a Salesforce project"
      );
      return Promise.resolve([]);
    }

    if (element) {
      return this.getTopicElements(element);
    } else {
      return Promise.resolve(this.listTopicElements());
    }
  }

  /**
   * List commands related to a topic
   */
  private async getTopicElements(topic: any): Promise<StatusTreeItem[]> {
    const items: StatusTreeItem[] = [];
    const topicItems: any[] = topic.id === 'status-org' ? await this.getOrgItems() :
      topic.id === 'status-git' ? await this.getGitItems() :
        topic.id === 'status-git' ? await this.getInstallItems() : []
      ;
    for (const item of topicItems) {
      const options: any = {};
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
      if (item.description) {
        options.description = item.description;
      }
      items.push(
        new StatusTreeItem(
          item.label,
          item.id,
          item.command || null,
          vscode.TreeItemCollapsibleState.None,
          options
        )
      );
    }
    return items;
  }

  private async getOrgItems(): Promise<any[]> {
    const items = [];
    const orgDisplayCommand = 'sfdx force:org:display';
    const orgInfoResult = await execSfdxJson(orgDisplayCommand, this, { fail: false, output: false });
    if (orgInfoResult.result) {
      const orgInfo = orgInfoResult.result;
      if (orgInfo.expirationDate) {
        items.push({ id: 'org-info-expiration-date', label: `Expires on ${orgInfo.expirationDate}`, tooltip: 'You org will be available until this date' })
      }
      if (orgInfo.alias !== 'MY_ORG') {
        items.push({ id: 'org-info-alias', label: `${orgInfo.alias}`, tooltip: 'Alias of the org that you are currently connected to from Vs Code' })
      }
      if (orgInfo.username) {
        items.push({ id: 'org-info-instance-url', label: `${orgInfo.username}`, tooltip: 'URL of your remote Salesforce org' })
      }
      if (orgInfo.instanceUrl) {
        items.push({ id: 'org-info-username', label: `${orgInfo.instanceUrl}`, tooltip: 'Username on your remote Salesforce org' })
      }
    }
    return items;
  }

  private async getGitItems(): Promise<any[]> {
    const items = [];
    const gitExtensionAll = vscode.extensions.getExtension('vscode.git');
    if (gitExtensionAll) {
      const gitExtension = gitExtensionAll.exports;
      const api = gitExtension.getAPI(1);
      const repo = api.repositories[0];
      if (repo?.state?.HEAD) {
        const head = repo.state.HEAD;
        const { name: branch } = head;
        items.push({ id: 'git-info-branch', label: `Branch: ${branch}`, description: 'This is the git branch you are currently working on' })
      }
      else {
        items.push({ id: 'git-info-branch', label: `Unknown`, description: 'Git is not ready yet, or your folder is not a repository' })
      }
    }
    return items;
  }

  private async getInstallItems(): Promise<any[]> {
    return []
  }

  /**
   * List all topics
   */
  private listTopicElements(): StatusTreeItem[] {
    const items: StatusTreeItem[] = [];
    for (const item of this.listTopics()) {
      const options = {
        icon: { light: "user.svg", dark: "user.svg" },
        description: "",
        tooltip: ""
      };
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
      if (item.description) {
        options.description = item.description;
      }
      const expanded = item.defaultExpand
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      items.push(
        new StatusTreeItem(item.label, item.id, "", expanded, options)
      );
    }
    return items;
  }

  private listTopics(): any {
    const topics = [
      {
        id: "status-org",
        label: "Current Org",
        icon: "salesforce.svg",
        defaultExpand: true,
      },
      {
        id: "status-git",
        label: "Git Status",
        icon: "git.svg",
        defaultExpand: true,
      },
      {
        id: "status-install",
        label: "Install",
        icon: "install.svg",
        defaultExpand: true,
      },
    ];
    return topics;
  }
}

// Build a tree item from data
class StatusTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly id: string,
    public readonly hardisCommand: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly options = {
      icon: { light: "salesforce.svg", dark: "salesforce.svg" },
      description: "",
      tooltip: ""
    }
  ) {
    super(label, collapsibleState);
    this.id = id;
    if (hardisCommand !== "" && hardisCommand != null) {
      this.command = {
        title: label,
        command: "vscode-sfdx-hardis.execute-command",
        arguments: [hardisCommand],
      };
      this.hardisCommand = hardisCommand;
      if (options.icon) {
        this.iconPath = options.icon;
        this.iconPath.light = path.join(
          __filename,
          "..",
          "..",
          "resources",
          this.iconPath.light.toString()
        );
        this.iconPath.dark = path.join(
          __filename,
          "..",
          "..",
          "resources",
          this.iconPath.dark.toString()
        );
      }
      if (options.description) {
        this.description = options.description;
      }
      if (options.tooltip) {
        this.tooltip = options.tooltip;
      }
    }
  }
}
