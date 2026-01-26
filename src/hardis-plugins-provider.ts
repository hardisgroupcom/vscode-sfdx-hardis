import * as vscode from "vscode";
import {
  execCommand,
  getNpmLatestVersion,
  getWorkspaceRoot,
  isCachePreloaded,
  isProjectSfdxConfigLoaded,
  loadExternalSfdxHardisConfiguration,
  loadProjectSfdxHardisConfig,
  NODE_JS_MINIMUM_VERSION,
  RECOMMENDED_SFDX_CLI_VERSION,
  RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
  resetCache,
  execCommandWithProgress,
} from "./utils";
import { Logger } from "./logger";
import which from "which";
import { ThemeUtils } from "./themeUtils";
import { SetupHelper } from "./utils/setupUtils";
import { isMergeDriverEnabled } from "./utils/gitMergeDriverUtils";

let nodeInstallOk = false;
let gitInstallOk = false;

export class HardisPluginsProvider implements vscode.TreeDataProvider<StatusTreeItem> {
  protected themeUtils: ThemeUtils;
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
      topic.id === "status-plugins-sfdx"
        ? await this.getPluginsItems()
        : topic.id === "status-plugins-core"
          ? await this.getCoreItems()
          : topic.id === "status-vscode-extensions"
            ? await this.getExtensionsItems()
            : [];
    console.timeEnd("TreeViewItem_init_" + topic.id);
    Logger.log("Completed TreeViewItem_init_" + topic.id);
    for (const item of topicItems) {
      const options: any = {};
      if (item.status) {
        options.status = item.status;
      }
      if (item.description) {
        options.description = item.description;
      }
      if (item.tooltip) {
        options.tooltip = item.tooltip;
      }
      if (item.helpUrl) {
        options.helpUrl = item.helpUrl;
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

  private async getCoreItems(): Promise<any[]> {
    const items: any = [];
    const nodeItem = isCachePreloaded()
      ? {
          id: `plugin-info-node`,
          label: "Node.js",
          command: `echo "Nothing to do here 😁"`,
          tooltip: `Node.js is installed`,
          status: "dependency-ok",
          helpUrl: "https://nodejs.org/en/",
        }
      : {
          id: `plugin-info-node`,
          label: "Node.js",
          status: "loading",
          helpUrl: "https://nodejs.org/en/",
        };
    // Check node.js version
    if (isCachePreloaded() && nodeInstallOk === false) {
      const nodeVersionStdOut: string =
        (
          await execCommand("node --version", {
            output: true,
            fail: false,
            cacheSection: "app",
          })
        ).stdout ||
        process.env.NODE_PATH ||
        "error";
      const nodeVersionMatch = /v([0-9]+)\.(.*)/gm.exec(nodeVersionStdOut);
      if (!nodeVersionMatch) {
        nodeItem.status = "dependency-missing";
        nodeItem.tooltip = "Node.js is missing";
        ((nodeItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://nodejs.org/en/",
        )}`),
          vscode.window
            .showWarningMessage(
              `🦙 You need Node.js installed on your computer. Please download and install it (version ${NODE_JS_MINIMUM_VERSION}), then restart VsCode.`,
              "Download and install Node.js LTS",
            )
            .then((selection) => {
              if (selection === "Download and install Node.js LTS") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://nodejs.org/en/"),
                );
              }
            }));
      } else if (
        parseInt(nodeVersionMatch[1]) < NODE_JS_MINIMUM_VERSION &&
        !process.env.PATH?.includes("/home/codebuilder/")
      ) {
        nodeItem.label += " v" + nodeVersionMatch[1];
        nodeItem.status = "dependency-warning";
        nodeItem.tooltip = "Node.js is outdated";
        ((nodeItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://nodejs.org/en/",
        )}`),
          vscode.window
            .showWarningMessage(
              `🦙 You have a too old version (${nodeVersionMatch[1]}) of Node.js installed on your computer. Please download and install it (version ${NODE_JS_MINIMUM_VERSION}), then restart VsCode.`,
              "Download and install Node.js LTS",
            )
            .then((selection) => {
              if (selection === "Download and install Node.js LTS") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://nodejs.org/en/"),
                );
              }
            }));
      } else {
        nodeItem.label +=
          " v" + nodeVersionMatch[1] + "." + nodeVersionMatch.slice(2).join("");
        nodeInstallOk = true;
      }
    }
    items.push(nodeItem);

    // Check git version
    const gitItem = isCachePreloaded()
      ? {
          id: `plugin-info-git`,
          label: "Git",
          command: `echo "Nothing to do here 😁"`,
          tooltip: `Git is installed`,
          status: "dependency-ok",
          helpUrl: "https://git-scm.com/",
        }
      : {
          id: `plugin-info-git`,
          label: "Git",
          status: "loading",
          helpUrl: "https://git-scm.com/",
        };
    if (isCachePreloaded() && gitInstallOk === false) {
      const gitVersionStdOut: string =
        (
          await execCommand("git --version", {
            output: true,
            fail: false,
            cacheSection: "app",
          })
        ).stdout || "error";
      const gitVersionMatch = /git version ([0-9]+)\.(.*)/gm.exec(
        gitVersionStdOut,
      );
      if (!gitVersionMatch) {
        gitItem.status = "dependency-missing";
        gitItem.tooltip = "Git is missing";
        ((gitItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://git-scm.com/downloads",
        )}`),
          vscode.window
            .showWarningMessage(
              "🦙 You need Git installed on your computer. Please download and install it (select GIT BASH in options), then restart VsCode",
              "Download and install Git",
            )
            .then((selection) => {
              if (selection === "Download and install Git") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://git-scm.com/downloads"),
                );
              }
            }));
      } else {
        gitItem.label +=
          " v" + gitVersionMatch[1] + "." + gitVersionMatch.slice(2).join("");
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
      {
        name: "@salesforce/plugin-packaging",
        altName: "packaging",
        helpUrl: "https://www.npmjs.com/package/@salesforce/plugin-packaging",
      },
      {
        name: "sfdx-hardis",
        helpUrl: "https://sfdx-hardis.cloudity.com/",
      },
      { name: "sfdmu", helpUrl: "https://help.sfdmu.com/" },
      {
        name: "sfdx-git-delta",
        helpUrl: "https://github.com/scolladon/sfdx-git-delta",
      },
      {
        name: "sf-git-merge-driver",
        helpUrl: "https://github.com/scolladon/sf-git-merge-driver",
      },
      // {
      //   name: "texei-sfdx-plugin",
      //   helpUrl: "https://texei.github.io/texei-sfdx-plugin/",
      // },
    ];

    // Display temporary list until cache is preloaded
    if (!isCachePreloaded()) {
      items.push({
        id: `sfdx-cli-info`,
        label: `@salesforce/cli`,
        status: "loading",
        helpUrl:
          "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
      });
      for (const plugin of plugins) {
        const pluginItem = {
          id: `plugin-info-${plugin.name}`,
          label: `${plugin.name}`,
          status: "loading",
          helpUrl: plugin.helpUrl,
        };
        items.push(pluginItem);
      }
      return items.sort((a: any, b: any) => (a.label > b.label ? 1 : -1));
    }

    // Complete with local config plugins
    await this.loadAdditionalPlugins(plugins);

    const outdated: any[] = [];
    // check sfdx-cli version
    const sfdxCliVersionStdOut: string = (
      await execCommand("sf --version", {
        output: true,
        fail: false,
        cacheSection: "app",
        cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
      })
    ).stdout;
    let sfdxCliVersionMatch = /sfdx-cli\/([^\s]+)/gm.exec(sfdxCliVersionStdOut);
    let sfdxCliVersion = "(missing)";
    let legacySfdx = false;
    if (sfdxCliVersionMatch) {
      sfdxCliVersion = sfdxCliVersionMatch[1];
      legacySfdx = true;
    } else {
      sfdxCliVersionMatch = /@salesforce\/cli\/([^\s]+)/gm.exec(
        sfdxCliVersionStdOut,
      );
      if (sfdxCliVersionMatch) {
        sfdxCliVersion = sfdxCliVersionMatch[1];
      }
    }

    let latestSfdxCliVersion;
    try {
      latestSfdxCliVersion = await getNpmLatestVersion("@salesforce/cli");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      Logger.log(`Error while fetching latest version for @salesforce/cli`);
      return [];
    }

    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    const recommendedSfdxCliVersion =
      config.get("ignoreSfdxCliRecommendedVersion") === true
        ? latestSfdxCliVersion
        : RECOMMENDED_SFDX_CLI_VERSION || latestSfdxCliVersion;
    const sfdxCliItem = {
      id: `sfdx-cli-info`,
      label: `@salesforce/cli v${sfdxCliVersion}`,
      command: `echo "Nothing to do here 😁"`,
      tooltip: `Recommended version of @salesforce/cli is installed`,
      status: "dependency-ok",
      helpUrl:
        "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
    };
    let sfdxCliOutdated = false;
    if (sfdxCliVersion !== recommendedSfdxCliVersion) {
      // Check if sfdx is installed using npm and not the windows installer
      let sfdxPath = "";
      try {
        sfdxPath = await which("sf");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_e) {
        sfdxPath = "missing";
      }
      if (legacySfdx) {
        sfdxCliItem.label = "Upgrade to @salesforce/cli";
        sfdxCliItem.command = `npm uninstall sfdx-cli --global && npm install @salesforce/cli --global`;
        sfdxCliItem.tooltip = `sfdx is deprecated: Install the latest Salesforce CLI, please click to make the upgrade`;
        sfdxCliItem.status = "dependency-error";
      } else if (
        !sfdxPath.includes("npm") &&
        !sfdxPath.includes("node") &&
        !sfdxPath.includes("nvm") &&
        !sfdxPath.includes("/home/codebuilder/") &&
        !(
          sfdxPath.includes("/usr/local/bin") && process.platform === "darwin"
        ) &&
        sfdxPath !== "missing"
      ) {
        sfdxCliItem.label =
          sfdxCliItem.label + " (WRONGLY INSTALLED in " + sfdxPath + ")";
        sfdxCliItem.command = `echo "You need to install Salesforce CLI using Node.JS. First, you need to uninstall Salesforce DX / Salesforce CI using Windows -> Programs -> Uninstall (or equivalent on MAC)"`;
        sfdxCliItem.tooltip = `First, you need to uninstall Salesforce DX / Salesforce CLI from Windows -> Programs -> Uninstall program (or equivalent on MAC)`;
        sfdxCliItem.status = "dependency-error";
      } else {
        // sfdx-cli is just outdated
        sfdxCliOutdated = true;
        sfdxCliItem.label =
          sfdxCliItem.label.includes("missing") &&
          !sfdxCliItem.label.includes("(link)")
            ? sfdxCliItem.label
            : sfdxCliItem.label + " (upgrade available)";
        sfdxCliItem.command = `npm install @salesforce/cli@${recommendedSfdxCliVersion} -g`;
        sfdxCliItem.tooltip = `Click to upgrade @salesforce/cli to ${recommendedSfdxCliVersion}`;
        sfdxCliItem.status = "dependency-warning";
      }
    }
    items.push(sfdxCliItem);
    // get currently installed plugins
    let sfdxPlugins =
      (
        await execCommand("sf plugins", {
          output: true,
          fail: false,
          cacheSection: "app",
          cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
        })
      ).stdout || "";
    // Remove everything after "Uninstalled JIT", including it
    const uninstalledJitIndex = sfdxPlugins.indexOf("Uninstalled JIT");
    if (uninstalledJitIndex > -1) {
      sfdxPlugins = sfdxPlugins.substring(0, uninstalledJitIndex).trim();
    }
    // Check installed plugins status version
    const pluginPromises = plugins.map(async (plugin) => {
      // Special check for sfdx-hardis version
      if (plugin.name === "sfdx-hardis") {
        let installedVersion = null;
        // Match semver (e.g., 1.2.3, 1.2.3-beta, 1.2.3-alpha.1, etc.)
        const regex = new RegExp(
          `${plugin.name} (\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?)`,
          "gm",
        );
        const match = regex.exec(sfdxPlugins);
        if (match && match[1]) {
          installedVersion = match[1];
        }
        if (
          installedVersion &&
          ((RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION !== "beta" &&
            this.compareVersions(
              installedVersion,
              RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
            ) < 0) ||
            (RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION === "beta" &&
              !installedVersion.includes("(beta)")))
        ) {
          const versionToInstall =
            RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION === "beta"
              ? "beta"
              : "latest";
          const errorMessageForUSer =
            RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION === "beta"
              ? `You are using VsCode sfdx-hardis pre-release version. Please install beta version of sfdx-hardis plugin to benefit from new features.\nRun: sf plugins:install sfdx-hardis@beta`
              : `Your sfdx-hardis plugin version (${installedVersion}) is outdated. Please upgrade to latest version to benefit from new features.\nRun: sf plugins:install sfdx-hardis@${versionToInstall}`;
          vscode.window
            .showErrorMessage(errorMessageForUSer, "Upgrade now")
            .then((selection) => {
              if (selection === "Upgrade now") {
                vscode.commands.executeCommand(
                  "vscode-sfdx-hardis.execute-command",
                  `echo y|sf plugins:install sfdx-hardis@${versionToInstall} && sf hardis:work:ws --event refreshPlugins`,
                );
              }
            });
        }
      }

      // Check latest plugin version
      let latestPluginVersion;
      try {
        latestPluginVersion = await getNpmLatestVersion(plugin.name);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        Logger.log(`Error while fetching latest version for ${plugin.name}`);
        return;
      }
      let pluginLabel = plugin.name;
      let isPluginMissing = false;
      const regexVersion = new RegExp(
        `${plugin.altName || plugin.name} (.*)`,
        "gm",
      );
      const versionMatches = [...sfdxPlugins.matchAll(regexVersion)];
      if (versionMatches.length > 0) {
        pluginLabel += ` v${versionMatches[0][1]}`;
      } else {
        pluginLabel += " (missing)";
        isPluginMissing = true;
      }
      const pluginItem = {
        id: `plugin-info-${plugin.name}`,
        label: pluginLabel,
        command: `echo "Nothing to do here 😁"`,
        tooltip: `Latest version of SFDX plugin ${plugin.name} is installed`,
        status: "dependency-ok",
        helpUrl: plugin.helpUrl,
      };
      if (
        !sfdxPlugins.includes(`${plugin.name} ${latestPluginVersion}`) &&
        !sfdxPlugins.includes(
          `${plugin.altName || "nope"} ${latestPluginVersion}`,
        )
      ) {
        pluginItem.label =
          pluginItem.label.includes("(beta)") ||
          pluginItem.label.includes("(alpha)")
            ? pluginItem.label + " (PREVIEW)"
            : pluginItem.label.includes("(link)")
              ? pluginItem.label.replace("(link)", "(localdev)")
              : pluginItem.label.includes("missing")
                ? pluginItem.label
                : pluginItem.label + " (upgrade available)";
        pluginItem.command = `echo y|sf plugins:install ${plugin.name} && sf hardis:work:ws --event refreshPlugins`;
        pluginItem.tooltip = `Click to upgrade SFDX plugin ${plugin.name} to ${latestPluginVersion}`;
        if (!pluginItem.label.includes("(localdev)")) {
          pluginItem.status = isPluginMissing
            ? "dependency-missing"
            : pluginItem.label.includes("(PREVIEW)")
              ? "dependency-preview"
              : "dependency-warning";
          if (!pluginItem.label.includes("(PREVIEW)")) {
            outdated.push(plugin);
          }
        }
      }
      if (pluginItem.label.includes("(localdev)")) {
        pluginItem.status = "dependency-local";
        pluginItem.tooltip = `You are using locally developed version of ${plugin.name}`;
      }
      items.push(pluginItem);
    });
    // Await parallel promises to be completed
    await Promise.allSettled(pluginPromises);
    // Propose user to upgrade if necessary
    let mergeDriverWasEnabled = false;
    if (outdated.some((plugin) => plugin.name === "sf-git-merge-driver")) {
      const mergeDriverStatus = await isMergeDriverEnabled(getWorkspaceRoot());
      mergeDriverWasEnabled = mergeDriverStatus === true;
    }
    if (outdated.length > 0) {
      const command = this.buildUpgradeCommand(
        outdated,
        plugins,
        legacySfdx,
        sfdxCliOutdated,
        mergeDriverWasEnabled,
      );
      const setupHelper = SetupHelper.getInstance();
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      if (
        config.get("autoUpdateDependencies") === true &&
        !setupHelper.hasUpdatesInProgress()
      ) {
        setupHelper.setUpdateInProgress(true, command);
        execCommandWithProgress(
          command,
          { fail: false, output: true },
          `Automatically upgrading dependencies with command: ${command}`,
        )
          .then(() => {
            setupHelper.setUpdateInProgress(false, command);
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.refreshPluginsView",
            );
          })
          .catch(() => {
            setupHelper.setUpdateInProgress(false, command);
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.refreshPluginsView",
            );
          });
      } else if (!setupHelper.hasUpdatesInProgress()) {
        vscode.window
          .showWarningMessage(
            "🦙 Some plugins are not up to date, please click to upgrade, then wait for the process to be completed before performing actions",
            "Upgrade plugins",
          )
          .then((selection) => {
            if (selection === "Upgrade plugins") {
              if (config.get("userInput") === "ui-lwc") {
                vscode.commands.executeCommand("vscode-sfdx-hardis.showSetup");
                return;
              }
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.execute-command",
                command,
              );
            }
          });
      }
    }
    return items.sort((a: any, b: any) => (a.label > b.label ? 1 : -1));
  }

  private buildUpgradeCommand(
    outdated: any[],
    plugins: any,
    legacySfdx: boolean,
    sfdxCliOutdated: boolean,
    mergeDriverWasEnabled: boolean,
  ): string {
    let command = outdated
      .map((plugin) => `echo y|sf plugins:install ${plugin.name}`)
      .join(" && ");
    if (legacySfdx) {
      command =
        "npm uninstall sfdx-cli --global && npm install @salesforce/cli --global && " +
        plugins
          .map((plugin: any) => `echo y|sf plugins:install ${plugin.name}`)
          .join(" && ");
    } else if (sfdxCliOutdated === true) {
      command = "npm install @salesforce/cli -g && " + command;
    }
    if (mergeDriverWasEnabled) {
      command =
        "sf git merge driver disable && " +
        command +
        " && sf git merge driver enable";
    }
    command = command + ` && sf hardis:work:ws --event refreshPlugins`;
    return command;
  }

  // Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b
  private compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na < nb) {
        return -1;
      }
      if (na > nb) {
        return 1;
      }
    }
    return 0;
  }

  private async loadAdditionalPlugins(
    plugins: (
      | { name: string; altName: string; helpUrl: string }
      | { name: string; helpUrl: string; altName?: undefined }
    )[],
  ) {
    // Handle faster display by getting config in background then refresh the commands panel
    if (!isProjectSfdxConfigLoaded()) {
      loadProjectSfdxHardisConfig().then(() =>
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshCommandsView",
          true,
        ),
      );
    }
    // Config is already loaded here
    const projectConfig = await loadProjectSfdxHardisConfig();
    plugins.push(...(projectConfig.customPlugins || []));
    // Complete with remote config plugins
    const remoteConfig = await loadExternalSfdxHardisConfiguration();
    plugins.push(...(remoteConfig.customPlugins || []));
  }

  // Check for required VsCode extensions
  private async getExtensionsItems(): Promise<any[]> {
    const items: any = [];
    const extensions = [
      {
        id: "salesforce.salesforcedx-vscode",
        label: "Salesforce Extensions Pack",
      },
    ];
    for (const extension of extensions) {
      const extensionItem = {
        id: extension.id,
        label: extension.label,
        command: `echo "Nothing to do here 😁"`,
        tooltip: `${extension.label} is installed`,
        status: "dependency-ok",
      };
      let extInstance = vscode.extensions.getExtension(extension.id);
      if (!extInstance && extension.id === "salesforce.salesforcedx-vscode") {
        extInstance = vscode.extensions.getExtension(
          "salesforce.salesforcedx-vscode-expanded",
        );
      }
      if (!extInstance) {
        extensionItem.command = `code --install-extension ${extension.id}`;
        extensionItem.tooltip = `Click to install VsCode Extension ${extension.label}`;
        extensionItem.status = "dependency-warning";
        vscode.window
          .showWarningMessage(
            `🦙 VsCode extension ${extension.label} is missing, click to install it`,
            `Install ${extension.label}`,
          )
          .then((selection) => {
            if (selection === `Install ${extension.label}`) {
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.execute-command",
                extensionItem.command,
              );
            }
          });
      }
      items.push(extensionItem);
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
        helpUrl: "",
        status: "",
      };
      if (item.description) {
        options.description = item.description;
      }
      if (item.tooltip) {
        options.tooltip = item.tooltip;
      }
      if (options.helpUrl) {
        options.helpUrl = item.helpUrl;
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
    }
    this.themeUtils = new ThemeUtils();
    this._onDidChangeTreeData.fire();
  }

  // List status topics
  private listTopics(): any {
    const topics = [
      {
        id: "status-plugins-sfdx",
        label: "SF CLI & Plugins",
        defaultExpand: true,
      },
      {
        id: "status-plugins-core",
        label: "Core",
        defaultExpand: true,
      },
      {
        id: "status-vscode-extensions",
        label: "VsCode Extensions",
        defaultExpand: true,
      },
    ].map((topic) => {
      topic.label = this.themeUtils.buildSectionLabel(topic.id, topic.label);
      return topic;
    });
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
      status: "",
      description: "",
      tooltip: "",
      helpUrl: "",
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
    if (options?.status) {
      this.iconPath = this.themeUtils.getCommandIconPath(options.status);
    }
    // Manage context menu tag
    this.contextValue = options.helpUrl
      ? "SFDXHARDIS_CONTEXT_PLUGIN"
      : undefined;
  }
}
