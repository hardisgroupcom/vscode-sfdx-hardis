import * as vscode from "vscode";
import * as npmApi from "npm-api";
import * as path from "path";
import moment = require("moment");
import { execCommand, execSfdxJson } from "./utils";
const npm = new npmApi();

let nodeInstallOk = false;
let gitInstallOk = false;

export class HardisStatusProvider
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
    console.time("TreeViewItem_init_" + topic.id);
    const topicItems: any[] =
      topic.id === "status-org"
        ? await this.getOrgItems({ devHub: false })
        : topic.id === "status-org-devhub"
        ? await this.getOrgItems({ devHub: true })
        : topic.id === "status-git"
        ? await this.getGitItems()
        : topic.id === "status-plugins"
        ? await this.getPluginsItems()
        : [];
    console.timeEnd("TreeViewItem_init_" + topic.id);
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

  private async getOrgItems(options: any = {}): Promise<any[]> {
    const items: any = [];
    let devHubUsername = "";
    let orgDisplayCommand = "sfdx force:org:display";
    if (options.devHub) {
      const devHubAliasCommand = "sfdx force:config:get defaultdevhubusername";
      const devHubAliasRes = await execSfdxJson(devHubAliasCommand, this, {
        fail: false,
        output: false,
      });
      if (
        devHubAliasRes &&
        devHubAliasRes.result &&
        devHubAliasRes.result[0] &&
        devHubAliasRes.result[0].value
      ) {
        devHubUsername = devHubAliasRes.result[0].value;
        orgDisplayCommand += ` --targetusername ${devHubUsername}`;
      } else {
        items.push({
          id: "org-not-connected-devhub",
          label: `Select a DevHub org`,
          tooltip: "Click to select and authenticate to a DevHub org",
          command: "sfdx hardis:org:select --devhub",
          icon: "select.svg",
        });
        return items;
      }
    }
    const orgInfoResult = await execSfdxJson(orgDisplayCommand, this, {
      fail: false,
      output: false,
    });
    if (orgInfoResult.result || orgInfoResult.id) {
      const orgInfo = orgInfoResult.result || orgInfoResult;
      if (orgInfo.username) {
        items.push({
          id: "org-info-instance-url" + (options.devHub ? "-devhub" : ""),
          label: `${orgInfo.instanceUrl}`,
          tooltip: "URL of your remote Salesforce org",
          command:
            "sfdx force:org:open" +
            (options.devHub ? ` --targetusername ${devHubUsername}` : ""),
          icon: "salesforce.svg",
        });
      }
      if (orgInfo.instanceUrl) {
        items.push({
          id: "org-info-username" + (options.devHub ? "-devhub" : ""),
          label: `${orgInfo.username}`,
          tooltip: "Username on your remote Salesforce org",
        });
      }
      if (orgInfo.expirationDate) {
        const expiration = moment(orgInfo.expirationDate);
        const today = moment();
        const daysBeforeExpiration = expiration.diff(today, "days");
        const item: any = {
          id: "org-info-expiration-date" + (options.devHub ? "-devhub" : ""),
          label: `Expires on ${orgInfo.expirationDate}`,
          tooltip: `You org will expire in ${daysBeforeExpiration} days`,
        };
        if (daysBeforeExpiration < 0) {
          item.icon = "warning-red.svg";
          item.tooltip = `You org expired on ${orgInfo.expirationDate}. You need to create a new one.`;
          vscode.window.showErrorMessage(item.tooltip);
        } else if (daysBeforeExpiration < 3) {
          item.icon = "warning-red.svg";
          item.tooltip = `You scratch org will expire in ${daysBeforeExpiration} days !!! Save your scratch org content and create a new one or your work will be lost !!!`;
          vscode.window.showErrorMessage(item.tooltip);
        } else if (daysBeforeExpiration < 7) {
          item.icon = "warning.svg";
          item.tooltip = `Your scratch org will expire in ${daysBeforeExpiration} days. You should soon create a new scratch org to avoid loosing your work`;
          vscode.window.showWarningMessage(item.tooltip);
        }
        items.push(item);
      }
      items.push({
        id: "select-another-org" + (options.devHub ? "-devhub" : ""),
        label: `Select another ` + (options.devHub ? "DevHub Org" : "Org"),
        tooltip: "Click to select an org",
        command: "sfdx hardis:org:select" + (options.devHub ? " --devhub" : ""),
        icon: "select.svg",
      });
    } else {
      items.push({
        id: "org-not-connected" + (options.devHub ? "-devhub" : ""),
        label: `Select an org`,
        tooltip: "Click to select and authenticate to an org",
        command: "sfdx hardis:org:select" + (options.devHub ? " --devhub" : ""),
        icon: "select.svg",
      });
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
      if (repo?.state?.remotes) {
        const origin = repo.state.remotes.filter(
          (remote: any) => remote.name === "origin"
        )[0];
        // Display repo
        if (origin) {
          items.push({
            id: "git-info-repo",
            label: `Repo: ${origin.fetchUrl
              .split("/")
              .pop()
              .replace(".git", "")}`,
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              origin.fetchUrl
            )}`,
            icon: "git.svg",
            tooltip: "Click to open git repo in browser - " + origin.fetchUrl,
          });
        } else {
          items.push({
            id: "git-info-repo",
            label: `Git not ready: click to refresh`,
            command: `vscode-sfdx-hardis.refreshStatusView`,
            icon: "git.svg",
            tooltip:
              "Git was not ready when SFDX Hardis has been run, please click to refresh",
          });
        }
      }
      // Display branch & merge request info
      if (repo?.state?.HEAD) {
        // branch info
        const head = repo.state.HEAD;
        const { name: branch } = head;
        items.push({
          id: "git-info-branch",
          label: `Branch: ${branch}`,
          icon: "git-branch.svg",
          tooltip: "This is the git branch you are currently working on",
        });
        // Merge request info
        const mergeRequestRes = await execSfdxJson(
          "sfdx hardis:config:get --level user",
          this,
          { fail: false, output: true }
        );
        if (mergeRequestRes?.result?.config?.mergeRequests) {
          const mergeRequests =
            mergeRequestRes.result.config.mergeRequests.filter(
              (mr: any) =>
                mr !== null &&
                mr.branch === branch &&
                (mr.url !== null || mr.urlCreate !== null)
            );
          // Existing merge request
          if (mergeRequests[0] && mergeRequests[0].url) {
            items.push({
              id: "git-merge-request-url",
              label: "Merge Request: Open",
              icon: "merge.svg",
              tooltip:
                "Click to open merge request in browser\n" +
                mergeRequests[0].url,
              command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
                mergeRequests[0].url
              )}`,
            });
          }
          // Create merge request URL
          else if (mergeRequests[0] && mergeRequests[0].urlCreate) {
            items.push({
              id: "git-merge-request-create-url",
              label: "Merge Request: Create",
              icon: "merge.svg",
              tooltip:
                "Click to create merge request in browser\n" +
                mergeRequests[0].urlCreate,
              command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
                mergeRequests[0].urlCreate
              )}`,
            });
          }
        }
      }
    }
    return items;
  }

  private async getPluginsItems(): Promise<any[]> {
    const items: any = [];

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
        vscode.window
          .showWarningMessage(
            "You need Node.js installed on your computer. Please download and install it (version 14 minimum)",
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
        vscode.window
          .showWarningMessage(
            `You have a too old version (${nodeVersionMatch[1]}) of Node.js installed on your computer. Please download and install it (version 14 minimum)`,
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

    // Check git version
    if (gitInstallOk === false) {
      const gitVersionStdOut: string = (
        await execCommand("git --version", this, { output: true, fail: false })
      ).stdout || "error";
      const gitVersionMatch = /git version ([0-9]+)\./gm.exec(gitVersionStdOut);
      if (!gitVersionMatch) {
        vscode.window
          .showWarningMessage(
            "You need Git installed on your computer. Please download and install it (select GIT BASH in options)",
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
    const sfdxCliItem = {
      id: `sfdx-cli-info`,
      label: `sfdx-cli v${sfdxCliVersion}`,
      command: "",
      tooltip: `Latest version of sfdx-cli is installed`,
      icon: "success.svg",
    };
    let sfdxCliOutdated = false;
    if (sfdxCliVersion !== latestSfdxCliVersion) {
      sfdxCliOutdated = true;
      sfdxCliItem.label =
        sfdxCliItem.label.includes("missing") &&
        !sfdxCliItem.label.includes("(link)")
          ? sfdxCliItem.label
          : sfdxCliItem.label + " (upgrade available)";
      sfdxCliItem.command = `npm install sfdx-cli -g`;
      sfdxCliItem.tooltip = `Click to upgrade sfdx-cli to ${latestSfdxCliVersion}`;
      sfdxCliItem.icon = "warning.svg";
    }
    items.push(sfdxCliItem);
    // get currently installed plugins
    const sfdxPlugins = (
      await execCommand("sfdx plugins", this, { output: true, fail: false })
    ).stdout;
    // Check installed plugins status version
    const pluginPromises = plugins.map(async (plugin) => {
      // Check latest plugin version
      const latestPluginVersion = await npm.repo(plugin.name).prop("version");
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
        pluginItem.command = `echo y|sfdx plugins:install ${plugin.name}`;
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
            command = command + ` && sfdx hardis:work:ws --event refreshStatus`;
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
      {
        id: "status-org-devhub",
        label: "Current Dev Hub org",
        icon: "salesforce.svg",
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
