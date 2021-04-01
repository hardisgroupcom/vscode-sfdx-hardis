import * as vscode from "vscode";
import * as path from "path";
import { execCommand, execSfdxJson } from "./utils";

export class HardisStatusProvider
  implements vscode.TreeDataProvider<StatusTreeItem> {
  constructor(private workspaceRoot: string) {}

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
    const topicItems: any[] =
      topic.id === "status-org"
        ? await this.getOrgItems()
        : topic.id === "status-git"
        ? await this.getGitItems()
        : topic.id === "status-plugins"
        ? await this.getPluginsItems()
        : [];
    for (const item of topicItems) {
      const options: any = {};
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
      if (item.description) {
        options.description = item.description;
      }
      if (item.tooltip) {
        options.tooltip = item.tooltip;
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
    const orgDisplayCommand = "sfdx force:org:display";
    const orgInfoResult = await execSfdxJson(orgDisplayCommand, this, {
      fail: false,
      output: false,
    });
    if (orgInfoResult.result) {
      const orgInfo = orgInfoResult.result;
      if (orgInfo.expirationDate) {
        items.push({
          id: "org-info-expiration-date",
          label: `Expires on ${orgInfo.expirationDate}`,
          tooltip: "You org will be available until this date",
        });
      }
      if (orgInfo.alias !== "MY_ORG") {
        items.push({
          id: "org-info-alias",
          label: `${orgInfo.alias}`,
          tooltip:
            "Alias of the org that you are currently connected to from Vs Code",
        });
      }
      if (orgInfo.username) {
        items.push({
          id: "org-info-instance-url",
          label: `${orgInfo.instanceUrl}`,
          tooltip: "URL of your remote Salesforce org",
        });
      }
      if (orgInfo.instanceUrl) {
        items.push({
          id: "org-info-username",
          label: `${orgInfo.username}`,
          tooltip: "Username on your remote Salesforce org",
        });
      }
    }
    return items;
  }

  private async getGitItems(): Promise<any[]> {
    const items = [];
    const gitExtensionAll = vscode.extensions.getExtension("vscode.git");
    if (gitExtensionAll) {
      const gitExtension = gitExtensionAll.exports;
      const api = gitExtension.getAPI(1);
      const repo = api.repositories[0];
      if (repo?.state?.HEAD) {
        const head = repo.state.HEAD;
        const { name: branch } = head;
        items.push({
          id: "git-info-branch",
          label: `Branch: ${branch}`,
          tooltip: "This is the git branch you are currently working on",
        });
      } else {
        items.push({
          id: "git-info-branch",
          label: `Unknown`,
          tooltip: `Git is not ready yet, or your folder is not a repository (maybe click on the refresh button near "Status" ?)`,
        });
      }
    }
    return items;
  }

  private async getPluginsItems(): Promise<any[]> {
    const items: any = [];
    const plugins = [
      { name: "sfdx-hardis" },
      { name: "sfdx-essentials" },
      { name: "sfpowerkit" },
      { name: "sfdmu" },
      { name: "sfdx-git-delta" },
      { name: "texei-sfdx-plugin" },
    ];
    const outdated: any[] = [];
    // get currently installed plugins
    const sfdxPlugins = (
      await execCommand("sfdx plugins", this, { output: true, fail: false })
    ).stdout;
    // Check installed plugins status version
    const pluginPromises = plugins.map(async (plugin) => {
      // Check latest plugin version
      const latestPluginVersion = (
        await execCommand(`npm show ${plugin.name} version`, this, {
          fail: false,
        })
      ).stdout;
      let pluginLabel = plugin.name;
      const regexVersion = new RegExp(`${plugin.name} (.*)`, "gm");
      const versionMatches = [...sfdxPlugins.matchAll(regexVersion)];
      if (versionMatches.length > 0) {
        pluginLabel += ` v${versionMatches[0][1]}`;
      } else {
        pluginLabel += " (missing)";
      }
      const pluginItem = {
        id: `plugin-info-${plugin.name}`,
        label: pluginLabel,
        command: "",
        tooltip: `Latest version of SFDX plugin ${plugin.name} is installed`,
        icon: "success.svg",
      };
      if (!sfdxPlugins.includes(`${plugin.name} ${latestPluginVersion}`)) {
        pluginItem.label = pluginItem.label.includes("missing") && !pluginItem.label.includes("(link)")
          ? pluginItem.label
          : pluginItem.label + "(outdated)";
        pluginItem.command = `echo y|sfdx plugins:install ${plugin.name}`;
        pluginItem.tooltip = `Click to upgrade SFDX plugin ${plugin.name} to ${latestPluginVersion}`;
        pluginItem.icon = "warning.svg";
        outdated.push(plugin);
      }
      items.push(pluginItem);
    });
    // Await parallel promises to be completed
    await Promise.all(pluginPromises);
    // Propose user to upgrade if necessary
    if (outdated.length > 0) {
      vscode.window
        .showInformationMessage(
          "Some plugins are not up to date, please click to upgrade, then wait for the process to be completed before performing actions",
          "Upgrade plugins"
        )
        .then((selection) => {
          if (selection === "Upgrade plugins") {
            const command = outdated
              .map((plugin) => `echo y|sfdx plugins:install ${plugin.name}`)
              .join(" && ");
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.execute-command",
              command
            );
          }
        });
    }
    return items.sort((a: any, b: any) => (a.label > b.label ? 1 : -1));
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
        tooltip: "",
      };
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
      if (item.description) {
        options.description = item.description;
      }
      if (item.tooltip) {
        options.tooltip = item.tooltip;
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

  // Manage refresh
  private _onDidChangeTreeData: vscode.EventEmitter<
    StatusTreeItem | undefined | null | void
  > = new vscode.EventEmitter<StatusTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    StatusTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // List status topics
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
        id: "status-plugins",
        label: "Plugins",
        icon: "plugins.svg",
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
      tooltip: "",
    }
  ) {
    super(label, collapsibleState);
    this.id = id;
    if (options.description) {
      this.description = options.description;
    }
    if (options.tooltip) {
      this.tooltip = options.tooltip;
    }
    if (hardisCommand !== "" && hardisCommand !== null) {
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
    }
  }
}
