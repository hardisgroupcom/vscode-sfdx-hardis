import * as vscode from "vscode";
import GitUrlParse from "git-url-parse";
import moment = require("moment");
import {
  execSfdxJson,
  getGitMenusItems,
  getGitParentBranch,
  getSfdxProjectJson,
  isCachePreloaded,
  isGitMenusItemsLoaded,
  loadProjectSfdxHardisConfig,
  resetCache,
  setGitMenusItems,
  setOrgCache,
} from "./utils";
import { Logger } from "./logger";
import simpleGit from "simple-git";
import { ThemeUtils } from "./themeUtils";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";

export class HardisStatusProvider
  implements vscode.TreeDataProvider<StatusTreeItem>
{
  public themeUtils: ThemeUtils;
  constructor(private workspaceRoot: string) {
    this.themeUtils = new ThemeUtils();
  }

  getTreeItem(element: StatusTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StatusTreeItem): Thenable<StatusTreeItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage(
        "🦙 No info available until you open a Salesforce project",
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
      topic.id === "status-org"
        ? await this.getOrgItems({ devHub: false })
        : topic.id === "status-org-devhub"
          ? await this.getOrgItems({ devHub: true })
          : topic.id === "status-git"
            ? await this.getGitItems()
            : [];
    console.timeEnd("TreeViewItem_init_" + topic.id);
    Logger.log("Completed TreeViewItem_init_" + topic.id);
    for (const item of topicItems) {
      const options: any = {};
      if (item.iconId) {
        options.iconId = item.iconId;
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
          this.themeUtils,
          options,
        ),
      );
    }
    return items;
  }

  private async getOrgItems(options: any = {}): Promise<any[]> {
    const items: any = [];
    if (!isCachePreloaded()) {
      items.push(
        options.devHub
          ? {
              id: "org-info-devhub-loading",
              label: `DevHub info is loading...`,
              tooltip: "Click to select and authenticate to a DevHub org",
              command: "sf hardis:org:select --devhub",
              iconId: "loading",
            }
          : {
              id: "org-info-loading",
              label: `Default org info is loading...`,
              tooltip: "Click to select a default org",
              command: "sf hardis:org:select",
              iconId: "loading",
            },
      );
      return items;
    }
    let devHubUsername = "";
    let orgDisplayCommand = "sf org display";
    if (options.devHub) {
      const devHubAliasCommand = "sf config get target-dev-hub";
      const devHubAliasRes = await execSfdxJson(devHubAliasCommand, {
        fail: false,
        output: false,
        cacheSection: "project",
        cacheExpiration: 1000 * 60 * 60, // 1 hour
      });
      if (
        devHubAliasRes &&
        devHubAliasRes.result &&
        devHubAliasRes.result[0] &&
        devHubAliasRes.result[0].value
      ) {
        devHubUsername = devHubAliasRes.result[0].value;
        orgDisplayCommand += ` --target-org ${devHubUsername}`;
      } else {
        items.push({
          id: "org-not-connected-devhub",
          label: `Select a DevHub org`,
          tooltip: "Click to select and authenticate to a DevHub org",
          command: "sf hardis:org:select --devhub",
          iconId: "org:connect:devhub",
        });
        return items;
      }
    }
    const orgInfoResult = await execSfdxJson(orgDisplayCommand,  {
      fail: false,
      output: false,
      cacheSection: orgDisplayCommand.includes("--target-org") ? "orgs": "project",
      cacheExpiration: orgDisplayCommand.includes("--target-org") ? 1000 * 60 * 60 * 24 * 90 : 1000 * 60 * 15, // 90 days for named orgs, 15 minutes for default org
    });
    if (orgInfoResult.result || orgInfoResult.id) {
      const orgInfo = orgInfoResult.result || orgInfoResult;
      setOrgCache(orgInfo);
      if (orgInfo.instanceUrl) {
        items.push({
          id: "org-info-instance-url" + (options.devHub ? "-devhub" : ""),
          label: `${orgInfo.instanceUrl.replace("https://", "")}`,
          tooltip:
            "Click to open your " +
            (options.devHub ? "Dev Hub" : "default") +
            " org: " +
            orgInfo.instanceUrl,
          command:
            "sf org open" +
            (options.devHub ? ` --target-org ${devHubUsername}` : ""),
          iconId: "org",
        });
      }
      if (orgInfo.username) {
        items.push({
          id: "org-info-username" + (options.devHub ? "-devhub" : ""),
          label: `${orgInfo.username}`,
          tooltip:
            "Username on your remote Salesforce org: " +
            orgInfo.username +
            "\nClick to Open User Settings in Salesforce",
          command:
            "sf org open" +
            (options.devHub ? ` --target-org ${devHubUsername}` : "") +
            " --path lightning/settings/personal/PersonalInformation/home",
          iconId: "org:user",
        });
      }
      const orgDetailItem = {
        id: "org-info-expiration-date" + (options.devHub ? "-devhub" : ""),
        label: "",
        iconId: "org:setup",
        tooltip: "Click to open Setup in Salesforce",
        command:
          "sf org open" +
          (options.devHub ? ` --target-org ${devHubUsername}` : "") +
          " --path lightning/setup/SetupOneHome/home",
      };
      if (orgInfo.apiVersion) {
        const versionLabel = this.getVersionLabel(orgInfo.apiVersion);
        orgDetailItem.label += `${versionLabel} - v${orgInfo.apiVersion}`;
        const sfdxProjectJson = getSfdxProjectJson();
        if (sfdxProjectJson?.sourceApiVersion !== orgInfo.apiVersion) {
          orgDetailItem.label += " ⚠️";
          orgDetailItem.tooltip = `You org is with api version ${orgInfo.apiVersion} whereas your sfdx project is using api version ${sfdxProjectJson?.sourceApiVersion}.
Maybe update sourceApiVersion in your sfdx-project.json ? (but be careful if your production org is still using a previous version, you won't be able to deploy in it !)`;
        }
      }
      if (orgInfo.expirationDate) {
        const expiration = moment(orgInfo.expirationDate);
        const today = moment();
        const daysBeforeExpiration = expiration.diff(today, "days");
        orgDetailItem.label += ` (exp: ${orgInfo.expirationDate})`;
        orgDetailItem.tooltip += `You org will expire in ${daysBeforeExpiration} days`;
        if (daysBeforeExpiration < 0) {
          orgDetailItem.iconId = "org:expired";
          orgDetailItem.tooltip = `You org expired on ${orgInfo.expirationDate}. You need to create a new one.`;
          vscode.window.showErrorMessage(
            `🦙 ${orgDetailItem.tooltip}`,
            "Close",
          );
        } else if (daysBeforeExpiration < 3) {
          orgDetailItem.iconId = "org:expired:soon";
          orgDetailItem.tooltip = `You scratch org will expire in ${daysBeforeExpiration} days !!! Save your scratch org content and create a new one or your work will be lost !!!`;
          vscode.window.showErrorMessage(
            `🦙 ${orgDetailItem.tooltip}`,
            "Close",
          );
        } else if (daysBeforeExpiration < 7) {
          orgDetailItem.iconId = "org:expired:soon";
          orgDetailItem.tooltip = `Your scratch org will expire in ${daysBeforeExpiration} days. You should soon create a new scratch org to avoid loosing your work`;
          vscode.window.showWarningMessage(
            `🦙 ${orgDetailItem.tooltip}`,
            "Close",
          );
        }
      }
      if (orgDetailItem.label !== "") {
        items.push(orgDetailItem);
      }

      if (options.devHub) {
        // Scratch org pool info
        const config = await loadProjectSfdxHardisConfig();
        // Get pool info only if defined in config
        if (config?.poolConfig) {
          const poolViewRes = await execSfdxJson(
            "sf hardis:scratch:pool:view",
            { output: false, fail: false },
          );
          if (
            poolViewRes?.status === 0 &&
            (poolViewRes?.result?.availableScratchOrgs ||
              poolViewRes?.result?.availableScratchOrgs === 0)
          ) {
            items.push({
              id: "scratch-org-pool-view",
              label: `Pool: ${poolViewRes.result.availableScratchOrgs} available (max ${poolViewRes.result.maxScratchOrgs})`,
              tooltip: "View content of scratch org pool",
              command: "sf hardis:scratch:pool:view",
              iconId: "org:pool",
            });
          }
        }
      }
      items.push({
        id: "select-another-org" + (options.devHub ? "-devhub" : ""),
        label: `Select another ` + (options.devHub ? "DevHub Org" : "Org"),
        tooltip: "Click to select an org",
        command: "sf hardis:org:select" + (options.devHub ? " --devhub" : ""),
        iconId: "org:connect",
      });
    } else {
      items.push({
        id: "org-not-connected" + (options.devHub ? "-devhub" : ""),
        label: `Select an org`,
        tooltip: "Click to select and authenticate to an org",
        command: "sf hardis:org:select" + (options.devHub ? " --devhub" : ""),
        iconId: "org:connect",
      });
    }
    return items;
  }

  private getVersionLabel(apiVersion: string): string {
    const matches: Map<string, string> = new Map([
      ["54.0", "Spring '22"],
      ["55.0", "Summer '22"],
      ["56.0", "Winter '23"],
      ["57.0", "Spring '23"],
      ["58.0", "Summer '23"],
      ["59.0", "Winter '24"],
      ["60.0", "Spring '24"],
      ["61.0", "Summer '24"],
      ["62.0", "Winter '25"],
      ["63.0", "Spring '25"],
      ["64.0", "Summer '25"],
      ["65.0", "Winter '26"],
      ["66.0", "Spring '26"],
      ["67.0", "Summer '26"],
    ]);
    return matches.get(apiVersion) || "NEXT";
  }

  private async getGitItems(): Promise<any[]> {
    // Load in background
    if (!isGitMenusItemsLoaded()) {
      this.loadGitMenus().then((items) => {
        setGitMenusItems(items);
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshStatusView",
          true,
        );
      });
      const gitWaitingItems: any = [];
      gitWaitingItems.push({
        id: "git-info-loading",
        label: `Loading git info...`,
        iconId: "loading",
      });
      return gitWaitingItems;
    }
    // Git items are loaded
    const items: any[] = getGitMenusItems() as any[];
    return items;
  }

  private async loadGitMenus() {
    const items: any = [];
    const git = simpleGit(this.workspaceRoot);
    if (git && (await git.checkIsRepo()) === true) {
      let gitRemotesOrigins: any = [];
      try {
        const gitRemotes = await git.getRemotes(true);
        gitRemotesOrigins = gitRemotes.filter(
          (remote) => remote.name === "origin",
        );
      } catch {
        console.warn("[vscode-sfdx-hardis] No git repository found");
      }
      if (gitRemotesOrigins.length > 0) {
        const origin = gitRemotesOrigins[0];
        // Display repo
        if (origin) {
          const parsedGitUrl = GitUrlParse(origin.refs.fetch);
          let httpGitUrl =
            parsedGitUrl.toString("https") || origin?.refs?.fetch || "";
          items.push({
            id: "git-info-repo",
            label: `Repo: ${(httpGitUrl.split("/").pop() || "").replace(
              ".git",
              "",
            )}`,
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              httpGitUrl,
            )}`,
            iconId: "git:repo",
            tooltip: "Click to open git repo in browser - " + httpGitUrl,
          });
        } else {
          items.push({
            id: "git-info-repo",
            label: `Git not ready: click to refresh`,
            command: `vscode-sfdx-hardis.refreshStatusView`,
            iconId: "git:repo",
            tooltip:
              "Git was not ready when SFDX Hardis has been run, please click to refresh",
          });
        }
      }
      // Display branch & merge request info
      const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]);
      if (currentBranch) {
        let gitIconId = "git:branch";
        let gitLabel = `Branch: ${currentBranch}`;
        let gitTooltip = "This is the git branch you are currently working on";
        let gitCommand = "";
        const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
        if (
          currentBranch.includes("/") &&
          config.get("disableGitMergeRequiredCheck") !== true
        ) {
          // Check if current branch is not up to date with origin parent branch
          try {
            // Fetch parent branch to make it up to date
            const parentGitBranch = (await getGitParentBranch()) || "";
            await git.fetch("origin", parentGitBranch);
            // Get parent branch latest commit
            const parentLatestCommit = await git.revparse(
              `origin/${parentGitBranch}`,
            );
            // Check if parent branch has been updated since we created the branch
            const gitDiff = await git.diff([
              parentGitBranch || "",
              `origin/${parentGitBranch}`,
            ]);
            // Check if there is a commit in current branch containing the ref of the latest parent branch commit
            const currentBranchCommits = await git.log([currentBranch]);
            if (
              (gitDiff.length > 0 && currentBranchCommits?.all.length === 0) ||
              (currentBranchCommits?.all &&
                currentBranchCommits?.all.length > 0 &&
                !currentBranchCommits.all.some((currentBranchCommit) =>
                  currentBranchCommit.message.includes(parentLatestCommit),
                ))
            ) {
              // Display message if a merge might be required
              gitIconId = "git:branch:warning";
              gitLabel = `Branch: ${currentBranch} (not up to date with origin/${parentGitBranch})`;
              gitTooltip = `EXPERIMENTAL: There have been new commit(s) into parent branch origin/${parentGitBranch} since you created ${currentBranch}.
You might need to merge origin/${parentGitBranch} into your current local branch ${currentBranch}.
After merging, refresh VsCode SFDX-Hardis status panel to discard this warning
Note: Disable disableGitMergeRequiredCheck in settings to skip this check.`;
              gitCommand = `vscode-sfdx-hardis.openExternal https://sfdx-hardis.cloudity.com/salesforce-ci-cd-merge-parent-branch/`;
            }
          } catch {
            console.warn(
              "Unable to check if remote parent git branch is up to date",
            );
          }
        }
        // branch info
        items.push({
          id: "git-info-branch",
          label: gitLabel,
          iconId: gitIconId,
          tooltip: gitTooltip,
          command: gitCommand,
        });
          const userConfig = await getConfig("user");
          if (userConfig.mergeRequests) {
            const mergeRequests =
              userConfig.mergeRequests.filter(
                (mr: any) =>
                  mr !== null &&
                  mr.branch === currentBranch &&
                  (mr.url !== null || mr.urlCreate !== null),
              );
            // Existing merge request
            if (mergeRequests[0] && mergeRequests[0].url) {
              items.push({
                id: "git-merge-request-url",
                label: "Merge Request: Open",
                iconId: "git:pull-request",
                tooltip:
                  "Click to open merge request in browser\n" +
                  mergeRequests[0].url,
                command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
                  mergeRequests[0].url,
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
                  mergeRequests[0].urlCreate,
                )}`,
              });
            }
          }
      }
    }
    return items;
  }

  /**
   * List all topics
   */
  private listTopicElements(): StatusTreeItem[] {
    const items: StatusTreeItem[] = [];
    for (const item of this.listTopics()) {
      const options = {
        description: "",
        tooltip: "",
        iconId: "",
      };
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
        new StatusTreeItem(
          item.label,
          item.id,
          "",
          expanded,
          this.themeUtils,
          options,
        ),
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

  refresh(keepCache: boolean): void {
    if (!keepCache) {
      resetCache();
    }
    this.themeUtils = new ThemeUtils();
    this._onDidChangeTreeData.fire();
  }

  // List status topics
  private listTopics(): any {
    const topics = [
      {
        id: "status-org",
        label: "Current Org",
        defaultExpand: true,
      },
      {
        id: "status-git",
        label: "Git Status",
        defaultExpand: true,
      },
      {
        id: "status-org-devhub",
        label: "Current Dev Hub org",
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
    public readonly themeUtils: ThemeUtils,
    public readonly options = {
      iconId: "",
      description: "",
      tooltip: "",
    },
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
    }
    if (this.options?.iconId) {
      this.iconPath = this.themeUtils.getCommandIconPath(this.options.iconId);
    }
  }
}
