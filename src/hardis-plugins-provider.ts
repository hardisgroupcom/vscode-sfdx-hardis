import * as vscode from "vscode";
import * as npmApi from "npm-api";
import * as path from "path";
import { execCommand, RECOMMENDED_SFDX_CLI_VERSION } from "./utils";
import { Logger } from "./logger";
const npm = new npmApi();

let nodeInstallOk = false;
let gitInstallOk = false;

export class HardisPluginsProvider
  implements vscode.TreeDataProvider<StatusTreeItem>
{
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
    Logger.log("Starting TreeViewItem_init_" + topic.id + " ...");
    console.time("TreeViewItem_init_" + topic.id);
    const topicItems: any[] =
      topic.id === "status-plugins-sfdx"
        ? await this.getPluginsItems()
        : topic.id === "status-plugins-core"
        ? await this.getCoreItems()
        : [];
    console.timeEnd("TreeViewItem_init_" + topic.id);
    Logger.log("Completed TreeViewItem_init_" + topic.id);
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

  private async getCoreItems(): Promise<any[]> {
    const items: any = [];
    const nodeItem = {
      id: `plugin-info-node`,
      label: "Node.js",
      command: "",
      tooltip: `Node.js is installed`,
      icon: "success.svg",
    };
    // Check node.js version
    if (nodeInstallOk === false) {
      const nodeVersionStdOut: string =
        (
          await execCommand("node --version", this, {
            output: true,
            fail: false,
          })
        ).stdout ||
        process.env.NODE_PATH ||
        "error";
      const nodeVersionMatch = /v([0-9]+)\./gm.exec(nodeVersionStdOut);
      if (!nodeVersionMatch) {
        nodeItem.icon = "warning.svg";
        nodeItem.tooltip = "Node.js is missing";
        (nodeItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://nodejs.org/en/"
        )}`),
          vscode.window
            .showWarningMessage(
              "You need Node.js installed on your computer. Please download and install it (version 14 minimum), then restart VsCode",
              "Download and install Node.js LTS"
            )
            .then((selection) => {
              if (selection === "Download and install Node.js LTS") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://nodejs.org/en/")
                );
              }
            });
      } else if (parseInt(nodeVersionMatch[1]) < 14.0) {
        nodeItem.label += " v" + nodeVersionMatch;
        nodeItem.icon = "warning.svg";
        nodeItem.tooltip = "Node.js is outdated";
        (nodeItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://nodejs.org/en/"
        )}`),
          vscode.window
            .showWarningMessage(
              `You have a too old version (${nodeVersionMatch[1]}) of Node.js installed on your computer. Please download and install it (version 14 minimum), then restart VsCode`,
              "Download and install Node.js LTS"
            )
            .then((selection) => {
              if (selection === "Download and install Node.js LTS") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://nodejs.org/en/")
                );
              }
            });
      } else {
        nodeInstallOk = true;
      }
    }
    items.push(nodeItem);

    // Check git version
    const gitItem = {
      id: `plugin-info-git`,
      label: "Git",
      command: "",
      tooltip: `Git is installed`,
      icon: "success.svg",
    };
    if (gitInstallOk === false) {
      const gitVersionStdOut: string =
        (
          await execCommand("git --version", this, {
            output: true,
            fail: false,
          })
        ).stdout || "error";
      const gitVersionMatch = /git version ([0-9]+)\./gm.exec(gitVersionStdOut);
      if (!gitVersionMatch) {
        gitItem.icon = "warning.svg";
        gitItem.tooltip = "Git is missing";
        (gitItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://git-scm.com/downloads"
        )}`),
          vscode.window
            .showWarningMessage(
              "You need Git installed on your computer. Please download and install it (select GIT BASH in options), then restart VsCode",
              "Download and install Git"
            )
            .then((selection) => {
              if (selection === "Download and install Git") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://git-scm.com/downloads")
                );
              }
            });
      } else {
        gitInstallOk = true;
      }
    }
    items.push(gitItem);
    return items;
  }

  private async getPluginsItems(): Promise<any[]> {
    const items: any = [];

    // Check sfdx related installs
    const plugins = [
      { name: "sfdx-hardis" },
      { name: "sfdx-essentials" },
      { name: "sfpowerkit" },
      { name: "sfdmu" },
      { name: "sfdx-git-delta" },
      { name: "texei-sfdx-plugin" },
    ];
    const outdated: any[] = [];
    // check sfdx-cli version
    const sfdxCliVersionStdOut: string = (
      await execCommand("sfdx --version", this, { output: true, fail: false })
    ).stdout;
    const sfdxCliVersionMatch = /sfdx-cli\/([^\s]+)/gm.exec(
      sfdxCliVersionStdOut
    );
    let sfdxCliVersion = "(missing)";
    if (sfdxCliVersionMatch) {
      sfdxCliVersion = sfdxCliVersionMatch[1];
    }
    const latestSfdxCliVersion = await npm.repo("sfdx-cli").prop("version");
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    const recommendedSfdxCliVersion =
      config.get("ignoreSfdxCliRecommendedVersion") === true
        ? latestSfdxCliVersion
        : RECOMMENDED_SFDX_CLI_VERSION || latestSfdxCliVersion;
    const sfdxCliItem = {
      id: `sfdx-cli-info`,
      label: `sfdx-cli v${sfdxCliVersion}`,
      command: "",
      tooltip: `Recommended version of sfdx-cli is installed`,
      icon: "success.svg",
    };
    let sfdxCliOutdated = false;
    if (sfdxCliVersion !== recommendedSfdxCliVersion) {
      sfdxCliOutdated = true;
      sfdxCliItem.label =
        sfdxCliItem.label.includes("missing") &&
        !sfdxCliItem.label.includes("(link)")
          ? sfdxCliItem.label
          : sfdxCliItem.label + " (upgrade available)";
      sfdxCliItem.command = `npm install sfdx-cli@${recommendedSfdxCliVersion} -g`;
      sfdxCliItem.tooltip = `Click to upgrade sfdx-cli to ${recommendedSfdxCliVersion}`;
      sfdxCliItem.icon = "warning.svg";
    }
    items.push(sfdxCliItem);
    // get currently installed plugins
    const sfdxPlugins =
      (await execCommand("sfdx plugins", this, { output: true, fail: false }))
        .stdout || "";
    // Check installed plugins status version
    const pluginPromises = plugins.map(async (plugin) => {
      // Check latest plugin version
      let latestPluginVersion;
      try {
        latestPluginVersion = await npm.repo(plugin.name).prop("version");
      } catch (e) {
        console.error(`Error while fetching latest version for ${plugin.name}`);
        return;
      }
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
        pluginItem.label =
          pluginItem.label.includes("missing") &&
          !pluginItem.label.includes("(link)")
            ? pluginItem.label.replace("(link)", "(localdev)")
            : pluginItem.label + " (upgrade available)";
        pluginItem.command = `echo y|sfdx plugins:install ${plugin.name} && sfdx hardis:work:ws --event refreshPlugins`;
        pluginItem.tooltip = `Click to upgrade SFDX plugin ${plugin.name} to ${latestPluginVersion}`;
        if (!pluginItem.label.includes("(localdev)")) {
          pluginItem.icon = "warning.svg";
          outdated.push(plugin);
        }
      }
      items.push(pluginItem);
    });
    // Await parallel promises to be completed
    await Promise.all(pluginPromises);
    // Propose user to upgrade if necessary
    if (outdated.length > 0) {
      vscode.window
        .showWarningMessage(
          "Some plugins are not up to date, please click to upgrade, then wait for the process to be completed before performing actions",
          "Upgrade plugins"
        )
        .then((selection) => {
          if (selection === "Upgrade plugins") {
            let command = outdated
              .map((plugin) => `echo y|sfdx plugins:install ${plugin.name}`)
              .join(" && ");
            if (sfdxCliOutdated === true) {
              command = "npm install sfdx-cli -g && " + command;
            }
            command =
              command + ` && sfdx hardis:work:ws --event refreshPlugins`;
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
        id: "status-plugins-sfdx",
        label: "SFDX",
        icon: "plugins.svg",
        defaultExpand: true,
      },
      {
        id: "status-plugins-core",
        label: "Core",
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
      if (hardisCommand.startsWith("vscode-sfdx-hardis")) {
        this.command = {
          title: label,
          command: hardisCommand.split(" ")[0],
          arguments: [hardisCommand.split(" ")[1]],
        };
      } else {
        this.command = {
          title: label,
          command: "vscode-sfdx-hardis.execute-command",
          arguments: [hardisCommand],
        };
        this.hardisCommand = hardisCommand;
      }

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
