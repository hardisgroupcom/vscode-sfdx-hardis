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
  resetCache,
  setGitMenusItems,
  setOrgCache,
} from "./utils";
import { Logger } from "./logger";
import simpleGit from "simple-git";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";
import { LwcPanelManager } from "./lwc-panel-manager";
import { t } from "./i18n/i18n";
import { DOCSITE_URL } from "./constants";
import { ThemeUtils } from "./utils/themeUtils";
import { loadProjectSfdxHardisConfig } from "./utils/sfdx-hardis-config-utils";
import { CacheManager } from "./utils/cache-manager";

// Module-level flag: true while the background scratch-pool fetch is in flight
let SCRATCH_POOL_LOADING = false;
// Module-level flag: true once the scratch-pool result has been inserted into the tree
let SCRATCH_POOL_LOADED = false;

const GIT_FETCH_TTL_MS = 5 * 60 * 1000; // 5 minutes
const GIT_FETCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (CacheManager TTL)

export class HardisStatusProvider implements vscode.TreeDataProvider<StatusTreeItem> {
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
        t("noInfoAvailableUntilProjectOpen"),
      );
      return Promise.resolve([]);
    }

    if (element) {
      return this.getTopicElements(element);
    } else {
      return Promise.resolve(this.listTopicElements());
    }
  }

  public static refreshOrgRelatedUis() {
    vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
    // Refresh Orgs Manager panel if existing
    const panelManager = LwcPanelManager.getInstance();
    const orgManagerPanel = panelManager.getPanel("s-org-manager");
    if (orgManagerPanel) {
      orgManagerPanel.sendMessage({
        type: "refreshOrgs",
      });
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
              label: t("loadingDevHubInfo"),
              tooltip: t("clickToSelectAndAuthenticateDevHub"),
              command: "sf hardis:org:select --devhub --set-default",
              iconId: "loading",
            }
          : {
              id: "org-info-loading",
              label: t("loadingDefaultOrgInfo"),
              tooltip: t("clickToSelectDefaultOrg"),
              command: "sf hardis:org:select --set-default",
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
          label: t("selectADevHubOrg"),
          tooltip: t("clickToSelectAndAuthenticateDevHub"),
          command: "sf hardis:org:select --devhub",
          iconId: "org:connect:devhub",
        });
        return items;
      }
    }
    const orgInfoResult = await execSfdxJson(orgDisplayCommand, {
      fail: false,
      output: false,
      cacheSection: orgDisplayCommand.includes("--target-org")
        ? "orgs"
        : "project",
      cacheExpiration: orgDisplayCommand.includes("--target-org")
        ? 1000 * 60 * 60 * 24 * 90
        : 1000 * 60 * 15, // 90 days for named orgs, 15 minutes for default org
    });
    if (orgInfoResult.result || orgInfoResult.id) {
      const orgInfo = orgInfoResult.result || orgInfoResult;
      setOrgCache(orgInfo);
      const isDisconnected =
        orgInfo.connectedStatus &&
        !orgInfo.connectedStatus
          .toString()
          .toLowerCase()
          .match(/connected|authorized/);
      const reconnectCommand =
        "sf hardis:org:select --reconnect --set-default" +
        (options.devHub ? " --devhub" : "") +
        (orgInfo.username ? ` --username ${orgInfo.username}` : "") +
        (orgInfo.instanceUrl ? ` --instance-url ${orgInfo.instanceUrl}` : "");
      if (orgInfo.instanceUrl) {
        items.push({
          id: "org-info-instance-url" + (options.devHub ? "-devhub" : ""),
          label: `${isDisconnected ? "⛓️‍💥 " : ""}${orgInfo.instanceUrl.replace("https://", "")}`,
          tooltip: isDisconnected
            ? t("orgDisconnectedTooltip")
            : t("clickToOpenOrgUrl", {
                orgType: options.devHub ? "Dev Hub" : "default",
                url: orgInfo.instanceUrl,
              }),
          command: isDisconnected
            ? reconnectCommand
            : "sf org open" +
              (options.devHub ? ` --target-org ${devHubUsername}` : ""),
          iconId: "org",
        });
      }
      if (orgInfo.username) {
        items.push({
          id: "org-info-username" + (options.devHub ? "-devhub" : ""),
          label: `${isDisconnected ? "⛓️‍💥 " : ""}${orgInfo.username}`,
          tooltip: isDisconnected
            ? t("orgDisconnectedTooltip")
            : t("usernameTooltip", { username: orgInfo.username }),
          command: isDisconnected
            ? reconnectCommand
            : "sf org open" +
              (options.devHub ? ` --target-org ${devHubUsername}` : "") +
              " --path lightning/settings/personal/PersonalInformation/home",
          iconId: "org:user",
        });
      }
      const orgDetailItem = {
        id: "org-info-expiration-date" + (options.devHub ? "-devhub" : ""),
        label: "",
        iconId: "org:setup",
        tooltip: t("clickToOpenSetup"),
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
          orgDetailItem.tooltip = t("apiVersionMismatchTooltip", {
            orgVersion: orgInfo.apiVersion,
            projectVersion: sfdxProjectJson?.sourceApiVersion,
          });
        }
      }
      if (orgInfo.expirationDate) {
        const expiration = moment(orgInfo.expirationDate);
        const today = moment();
        const daysBeforeExpiration = expiration.diff(today, "days");
        orgDetailItem.label += ` ${t("orgExpiresLabel", { expirationDate: orgInfo.expirationDate })}`;
        orgDetailItem.tooltip += t("orgExpiresInNDays", {
          days: daysBeforeExpiration,
        });
        if (daysBeforeExpiration < 0) {
          orgDetailItem.iconId = "org:expired";
          orgDetailItem.tooltip = t("orgExpired", {
            expirationDate: orgInfo.expirationDate,
          });
          vscode.window.showErrorMessage(
            `🦙 ${orgDetailItem.tooltip}`,
            t("close"),
          );
        } else if (daysBeforeExpiration < 3) {
          orgDetailItem.iconId = "org:expired:soon";
          orgDetailItem.tooltip = t("orgExpiringDangerously", {
            days: daysBeforeExpiration,
          });
          vscode.window.showErrorMessage(
            `🦙 ${orgDetailItem.tooltip}`,
            t("close"),
          );
        } else if (daysBeforeExpiration < 7) {
          orgDetailItem.iconId = "org:expired:soon";
          orgDetailItem.tooltip = t("orgExpiringSoon", {
            days: daysBeforeExpiration,
          });
          vscode.window.showWarningMessage(
            `🦙 ${orgDetailItem.tooltip}`,
            t("close"),
          );
        }
      }
      if (orgDetailItem.label !== "") {
        items.push(orgDetailItem);
      }

      if (options.devHub) {
        // Scratch org pool info — rendered in the background to avoid blocking first paint
        const config = await loadProjectSfdxHardisConfig();
        // Only fetch pool info when poolConfig is defined in project config
        if (config?.poolConfig) {
          if (SCRATCH_POOL_LOADED) {
            // Background fetch already completed — read the cached result
            const cachedPoolRes = CacheManager.get<any>(
              "project",
              "scratchPoolView",
            );
            if (
              cachedPoolRes?.status === 0 &&
              (cachedPoolRes?.result?.availableScratchOrgs ||
                cachedPoolRes?.result?.availableScratchOrgs === 0)
            ) {
              items.push({
                id: "scratch-org-pool-view",
                label: t("poolAvailable", {
                  available: cachedPoolRes.result.availableScratchOrgs,
                  max: cachedPoolRes.result.maxScratchOrgs,
                }),
                tooltip: t("poolTooltip"),
                command: "sf hardis:scratch:pool:view",
                iconId: "org:pool",
              });
            }
          } else if (!SCRATCH_POOL_LOADING) {
            // Start background fetch; do not block first paint
            SCRATCH_POOL_LOADING = true;
            void (async () => {
              try {
                const poolViewRes = await execSfdxJson(
                  "sf hardis:scratch:pool:view",
                  { output: false, fail: false },
                );
                await CacheManager.set(
                  "project",
                  "scratchPoolView",
                  poolViewRes,
                  1000 * 60 * 15,
                );
                SCRATCH_POOL_LOADED = true;
              } catch (e) {
                Logger.log(
                  "[vscode-sfdx-hardis] scratch pool view failed: " + String(e),
                );
                SCRATCH_POOL_LOADED = true;
              } finally {
                SCRATCH_POOL_LOADING = false;
                vscode.commands.executeCommand(
                  "vscode-sfdx-hardis.refreshStatusView",
                  true,
                );
              }
            })();
          }
        }
      }
      items.push({
        id: "select-another-org" + (options.devHub ? "-devhub" : ""),
        label: options.devHub
          ? t("selectAnotherDevHubOrg")
          : t("selectAnotherOrg"),
        tooltip: t("clickToSelectOrg"),
        command:
          "sf hardis:org:select  --set-default" +
          (options.devHub ? " --devhub" : ""),
        iconId: "org:connect",
      });
    } else {
      items.push({
        id: "org-not-connected" + (options.devHub ? "-devhub" : ""),
        label: t("selectAnOrg"),
        tooltip: t("clickToSelectAndAuthenticateOrg"),
        command:
          "sf hardis:org:select  --set-default" +
          (options.devHub ? " --devhub" : ""),
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
        label: t("loadingGitInfo"),
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
    let isRepo = false;
    try {
      isRepo = git && (await git.checkIsRepo()) === true;
    } catch {
      // Not a git repository or git not available
    }

    if (!isRepo) {
      items.push({
        id: "git-clone-repo",
        label: t("cloneARepository"),
        command: "vscode:git.clone",
        iconId: "git:clone",
        tooltip: t("cloneRepositoryTooltip"),
      });
      return items;
    }

    if (isRepo) {
      let gitRemotesOrigins: any = [];
      try {
        const gitRemotes = await git.getRemotes(true);
        gitRemotesOrigins = gitRemotes.filter(
          (remote) => remote.name === "origin",
        );
      } catch {
        Logger.log("No git repository found");
      }
      if (gitRemotesOrigins.length > 0) {
        const origin = gitRemotesOrigins[0];
        // Display repo
        if (origin) {
          const parsedGitUrl = GitUrlParse(origin.refs.fetch);
          const httpGitUrl =
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
            tooltip: t("clickToOpenGitRepoWithUrl", { url: httpGitUrl }),
          });
        } else {
          items.push({
            id: "git-info-repo",
            label: t("gitNotReadyClickToRefresh"),
            command: `vscode-sfdx-hardis.refreshStatusView`,
            iconId: "git:repo",
            tooltip: t("clickToRefreshGit"),
          });
        }
      }
      // Display branch & merge request info — use purely LOCAL git state for first paint
      let currentBranch: string | null = null;
      try {
        currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]);
      } catch {
        // Unable to determine current branch
      }
      if (currentBranch) {
        // Phase 1: local branch row (neutral, no network)
        const gitIconId = "git:branch";
        const gitLabel = t("branchLabel", { branch: currentBranch });
        const gitTooltip = t("isCurrentGitBranch");
        const gitCommand = "";
        items.push({
          id: "git-info-branch",
          label: gitLabel,
          iconId: gitIconId,
          tooltip: gitTooltip,
          command: gitCommand,
        });

        // Phase 1: local log + userConfig merge requests (no network)
        const userConfig = await getConfig("user");
        if (userConfig.mergeRequests) {
          const mergeRequests = userConfig.mergeRequests.filter(
            (mr: any) =>
              mr !== null &&
              mr.branch === currentBranch &&
              (mr.url !== null || mr.urlCreate !== null),
          );
          // Existing merge request
          if (mergeRequests[0] && mergeRequests[0].url) {
            items.push({
              id: "git-merge-request-url",
              label: t("openMergeRequest"),
              iconId: "git:pull-request",
              tooltip:
                t("clickToOpenMergeRequest") + "\n" + mergeRequests[0].url,
              command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
                mergeRequests[0].url,
              )}`,
            });
          }
          // Create merge request URL
          else if (mergeRequests[0] && mergeRequests[0].urlCreate) {
            items.push({
              id: "git-merge-request-create-url",
              label: t("createMergeRequest"),
              icon: "merge.svg",
              tooltip:
                t("clickToCreateMergeRequest") +
                "\n" +
                mergeRequests[0].urlCreate,
              command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
                mergeRequests[0].urlCreate,
              )}`,
            });
          }
        }

        // Phase 2 (background): fetch + diff check — only when branch contains "/"
        const vsConfig = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
        if (
          currentBranch.includes("/") &&
          vsConfig.get("disableGitMergeRequiredCheck") !== true
        ) {
          // Capture branch name for the closure
          const branchForFetch = currentBranch;
          void (async () => {
            try {
              const parentGitBranch = (await getGitParentBranch()) || "";
              // Throttle: skip fetch if it ran recently for this branch
              const fetchCacheKey = `gitFetchAt:${branchForFetch}`;
              const lastFetchAt = CacheManager.get<number>(
                "project",
                fetchCacheKey,
              );
              const now = Date.now();
              if (!lastFetchAt || now - lastFetchAt >= GIT_FETCH_TTL_MS) {
                await git.fetch("origin", parentGitBranch);
                await CacheManager.set(
                  "project",
                  fetchCacheKey,
                  now,
                  GIT_FETCH_CACHE_TTL_MS,
                );
              }
              // Get parent branch latest commit (uses local ref after fetch)
              const parentLatestCommit = await git.revparse(
                `origin/${parentGitBranch}`,
              );
              // Check if parent branch has been updated since we created the branch
              const gitDiff = await git.diff([
                parentGitBranch || "",
                `origin/${parentGitBranch}`,
              ]);
              // Check if there is a commit in current branch containing the ref of the latest parent branch commit
              const currentBranchCommits = await git.log([branchForFetch]);
              const mergeNeeded =
                (gitDiff.length > 0 &&
                  currentBranchCommits?.all.length === 0) ||
                (currentBranchCommits?.all &&
                  currentBranchCommits?.all.length > 0 &&
                  !currentBranchCommits.all.some((currentBranchCommit) =>
                    currentBranchCommit.message.includes(parentLatestCommit),
                  ));
              if (mergeNeeded) {
                // Re-read current GIT_MENUS and patch the branch row with warning decoration
                const currentItems: any[] = (getGitMenusItems() as any[]) || [];
                // Guard: only patch if the menu is populated and the branch row
                // is present. Avoids wiping GIT_MENUS if phase 1 has not yet
                // stored its items (would otherwise overwrite with an empty list).
                const hasBranchRow = currentItems.some(
                  (item: any) => item.id === "git-info-branch",
                );
                if (!hasBranchRow) {
                  return;
                }
                const patchedItems = currentItems.map((item: any) => {
                  if (item.id === "git-info-branch") {
                    return {
                      ...item,
                      iconId: "git:branch:warning",
                      label: t("branchNotUpToDate", {
                        branch: branchForFetch,
                        parent: parentGitBranch,
                      }),
                      tooltip: t("branchMergeNeededTooltip", {
                        branch: branchForFetch,
                        parent: parentGitBranch,
                      }),
                      command: `vscode-sfdx-hardis.openExternal ${DOCSITE_URL}/salesforce-ci-cd-merge-parent-branch/`,
                    };
                  }
                  return item;
                });
                setGitMenusItems(patchedItems);
                vscode.commands.executeCommand(
                  "vscode-sfdx-hardis.refreshStatusView",
                  true,
                );
              }
            } catch {
              Logger.log(
                "Unable to check if remote parent git branch is up to date",
              );
            }
          })();
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

  async refresh(keepCache: boolean): Promise<void> {
    if (!keepCache) {
      await resetCache();
      // Reset scratch pool flags so the background fetch reruns on hard refresh
      SCRATCH_POOL_LOADING = false;
      SCRATCH_POOL_LOADED = false;
    }
    this.themeUtils = new ThemeUtils();
    this._onDidChangeTreeData.fire();
  }

  // List status topics
  private listTopics(): any {
    const topics = [
      {
        id: "status-org",
        label: t("currentOrg"),
        defaultExpand: true,
      },
      {
        id: "status-git",
        label: t("gitStatus"),
        defaultExpand: true,
      },
      {
        id: "status-org-devhub",
        label: t("currentDevHubOrg"),
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
      } else if (hardisCommand.startsWith("vscode:")) {
        const vsCommandParts = hardisCommand.replace(/^vscode:/, "").split(" ");
        const commandId = vsCommandParts.shift() || "";
        this.command = {
          title: label,
          command: commandId,
          arguments: vsCommandParts.length > 0 ? vsCommandParts : undefined,
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
