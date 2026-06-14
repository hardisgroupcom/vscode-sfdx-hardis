import * as vscode from "vscode";
import {
  execCommand,
  getNpmLatestVersion,
  getSfdxHardisInstallTag,
  getWorkspaceRoot,
  isCachePreloaded,
  isExtensionPreRelease,
  resetCache,
  execCommandWithProgress,
} from "./utils";
import { Logger } from "./logger";
import { ThemeUtils } from "./utils/themeUtils";
import { t } from "./i18n/i18n";
import {
  SetupHelper,
  buildSfCliUpgradeCommand,
  isNativeSfCliInstall,
  resolveSfCliPath,
} from "./utils/setupUtils";
import { isMergeDriverEnabled } from "./utils/gitMergeDriverUtils";
import {
  NODE_JS_MINIMUM_VERSION,
  RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
  RECOMMENDED_SFDX_CLI_VERSION,
  DOCSITE_URL,
} from "./constants";
import {
  isAllConfigLoaded,
  listCustomPlugins,
  listPluginsProvidingHardisCommands,
} from "./utils/sfdx-hardis-config-utils";

let nodeInstallOk = false;
let gitInstallOk = false;
// Per-session guards for core dependency prompts
let nodeMissingPromptShown = false;
let gitMissingPromptShown = false;

// Two-phase plugin rendering flags — mirroring the GIT_MENUS pattern
// null  = not started yet; false = in progress; true = detail pass completed
let PLUGINS_DETAIL_LOADED: boolean | null = null;
// Placeholder items from phase 1 (installed versions, no upgrade info yet)
let PLUGINS_PHASE1_ITEMS: any[] | null = null;
// Finalised items from phase 2 (with upgrade decorations)
let PLUGINS_DETAIL_ITEMS: any[] | null = null;
// Per-session guards: prevent repeated dialogs across re-renders
let PLUGINS_OUTDATED_PROMPT_SHOWN = false;
let PLUGINS_SFDXHARDIS_PROMPT_SHOWN = false;
let PLUGINS_AUTO_UPGRADE_STARTED = false;
// Guard against concurrent background detail passes
let PLUGINS_DETAIL_IN_FLIGHT = false;

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
    const downloadNodeLtsLabel = t("downloadAndInstallNodeJsLts");
    const downloadGitLabel = t("downloadAndInstallGit");
    const nodeItem = isCachePreloaded()
      ? {
          id: `plugin-info-node`,
          label: "Node.js",
          command: `echo "Nothing to do here 😁"`,
          tooltip: t("nodeJsInstalled"),
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
        nodeItem.tooltip = t("nodeJsMissing");
        nodeItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://nodejs.org/en/",
        )}`;
        if (!nodeMissingPromptShown) {
          nodeMissingPromptShown = true;
          vscode.window
            .showWarningMessage(
              t("nodeNotInstalled", { version: NODE_JS_MINIMUM_VERSION }),
              downloadNodeLtsLabel,
            )
            .then((selection) => {
              if (selection === downloadNodeLtsLabel) {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://nodejs.org/en/"),
                );
              }
            });
        }
      } else if (
        parseInt(nodeVersionMatch[1]) < NODE_JS_MINIMUM_VERSION &&
        !process.env.PATH?.includes("/home/codebuilder/")
      ) {
        nodeItem.label += " v" + nodeVersionMatch[1];
        nodeItem.status = "dependency-warning";
        nodeItem.tooltip = t("nodeJsOutdated");
        nodeItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://nodejs.org/en/",
        )}`;
        if (!nodeMissingPromptShown) {
          nodeMissingPromptShown = true;
          vscode.window
            .showWarningMessage(
              t("nodeVersionTooOld", {
                currentVersion: nodeVersionMatch[1],
                recommendedVersion: NODE_JS_MINIMUM_VERSION,
              }),
              downloadNodeLtsLabel,
            )
            .then((selection) => {
              if (selection === downloadNodeLtsLabel) {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://nodejs.org/en/"),
                );
              }
            });
        }
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
          tooltip: t("gitInstalled"),
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
        gitItem.tooltip = t("gitMissing");
        gitItem.command = `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
          "https://git-scm.com/downloads",
        )}`;
        if (!gitMissingPromptShown) {
          gitMissingPromptShown = true;
          vscode.window
            .showWarningMessage(t("gitNotInstalled"), downloadGitLabel)
            .then((selection) => {
              if (selection === downloadGitLabel) {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://git-scm.com/downloads"),
                );
              }
            });
        }
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
    // --- Build the static plugin list (same every call) ---
    const plugins = [
      {
        name: "@salesforce/plugin-packaging",
        altName: "packaging",
        helpUrl: "https://www.npmjs.com/package/@salesforce/plugin-packaging",
      },
      {
        name: "sfdx-hardis",
        helpUrl: DOCSITE_URL,
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
      const loadingItems: any[] = [];
      loadingItems.push({
        id: `sfdx-cli-info`,
        label: `@salesforce/cli`,
        status: "loading",
        helpUrl:
          "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
      });
      for (const plugin of plugins) {
        loadingItems.push({
          id: `plugin-info-${plugin.name}`,
          label: `${plugin.name}`,
          status: "loading",
          helpUrl: plugin.helpUrl,
        });
      }
      return loadingItems.sort((a: any, b: any) => (a.label > b.label ? 1 : -1));
    }

    // --- Phase 2 complete: return final decorated items ---
    if (PLUGINS_DETAIL_LOADED === true && PLUGINS_DETAIL_ITEMS !== null) {
      return PLUGINS_DETAIL_ITEMS;
    }

    // --- Phase 2 in flight: return phase-1 placeholder items ---
    if (PLUGINS_DETAIL_LOADED === false && PLUGINS_PHASE1_ITEMS !== null) {
      return PLUGINS_PHASE1_ITEMS;
    }

    // --- Phase 1: build items from cached sf --version + sf plugins immediately ---
    // Mark detail pass as in progress before any await to prevent concurrent launches
    PLUGINS_DETAIL_LOADED = false;

    // Complete with local config plugins (may trigger a background refresh if config not ready)
    await this.loadAdditionalPlugins(plugins);

    // Read sf --version and sf plugins from cache (both are cached 1 day after first call)
    const [sfVersionResult, sfPluginsResult] = await Promise.allSettled([
      execCommand("sf --version", {
        output: true,
        fail: false,
        cacheSection: "app",
        cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
      }),
      execCommand("sf plugins", {
        output: true,
        fail: false,
        cacheSection: "app",
        cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
      }),
    ]);

    // Parse sf --version output
    const sfdxCliVersionStdOut: string =
      sfVersionResult.status === "fulfilled"
        ? sfVersionResult.value.stdout
        : "";
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

    // Get installed plugins output
    let sfdxPlugins: string =
      sfPluginsResult.status === "fulfilled"
        ? sfPluginsResult.value.stdout || ""
        : "";
    // Remove everything after "Uninstalled JIT", including it
    const uninstalledJitIndex = sfdxPlugins.indexOf("Uninstalled JIT");
    if (uninstalledJitIndex > -1) {
      sfdxPlugins = sfdxPlugins.substring(0, uninstalledJitIndex).trim();
    }

    // Build phase-1 items: installed versions, neutral status (no upgrade info yet)
    const phase1Items: any[] = [];

    // CLI item with installed version — upgrade decoration deferred to phase 2
    const sfdxCliItemPhase1 = {
      id: `sfdx-cli-info`,
      label: `@salesforce/cli v${sfdxCliVersion}`,
      command: `echo "Nothing to do here 😁"`,
      tooltip: t("sfCliRecommendedInstalled"),
      status: "dependency-ok",
      helpUrl:
        "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
    };
    phase1Items.push(sfdxCliItemPhase1);

    // Plugin items with installed versions — upgrade info deferred to phase 2
    for (const plugin of plugins) {
      let pluginLabel = (plugin as any).isCommunity
        ? `${plugin.name} ${t("communityPluginLabel")}`
        : plugin.name;
      const regexVersion = new RegExp(
        `${(plugin as any).altName || plugin.name} (.*)`,
        "gm",
      );
      const versionMatches = [...sfdxPlugins.matchAll(regexVersion)];
      if (versionMatches.length > 0) {
        pluginLabel += ` v${versionMatches[0][1]}`;
      } else {
        pluginLabel += t("pluginMissingSuffix");
      }
      phase1Items.push({
        id: `plugin-info-${plugin.name}`,
        label: pluginLabel,
        command: `echo "Nothing to do here 😁"`,
        tooltip: t("sfdxPluginLatestInstalled", { plugin: plugin.name }),
        status: "dependency-ok",
        helpUrl: plugin.helpUrl,
      });
    }

    // Sort community plugins to end; apply label sort
    phase1Items.sort(
      (a: any, b: any) => (a.isCommunity ? 1 : 0) - (b.isCommunity ? 1 : 0),
    );
    PLUGINS_PHASE1_ITEMS = phase1Items.sort(
      (a: any, b: any) => (a.label > b.label ? 1 : -1),
    );

    // --- Phase 2: background detail pass (npm latest versions + upgrade decorations) ---
    if (!PLUGINS_DETAIL_IN_FLIGHT) {
      PLUGINS_DETAIL_IN_FLIGHT = true;
      void this.runPluginsDetailPass(
        plugins,
        sfdxPlugins,
        sfdxCliVersion,
        legacySfdx,
      );
    }

    return PLUGINS_PHASE1_ITEMS;
  }

  /**
   * Background detail pass: fetch npm latest versions, apply upgrade decorations,
   * fire prompts (once per session), then call refreshPluginsView(true) to replace
   * the phase-1 placeholders with the final decorated rows.
   */
  private async runPluginsDetailPass(
    plugins: any[],
    sfdxPlugins: string,
    sfdxCliVersion: string,
    legacySfdx: boolean,
  ): Promise<void> {
    try {
      const items: any[] = [];

      const [latestSfdxCliVersionResult, sfVersionResult] = await Promise.allSettled([
        getNpmLatestVersion("@salesforce/cli"),
        execCommand("sf --version", {
          output: true,
          fail: false,
          cacheSection: "app",
          cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
        }),
      ]);

      // getNpmLatestVersion never rejects; a null value means "unknown" (cold/offline)
      const latestSfdxCliVersion: string | null =
        latestSfdxCliVersionResult.status === "fulfilled"
          ? latestSfdxCliVersionResult.value
          : null;
      if (latestSfdxCliVersionResult.status === "rejected") {
        Logger.log(`Error while fetching latest version for @salesforce/cli`);
      }

      // Re-parse sf --version in case of late cache population
      const sfdxCliVersionStdOut: string =
        sfVersionResult.status === "fulfilled"
          ? sfVersionResult.value.stdout
          : "";
      let sfdxCliVersionMatchDetail = /sfdx-cli\/([^\s]+)/gm.exec(sfdxCliVersionStdOut);
      let sfdxCliVersionDetail = sfdxCliVersion;
      let legacySfdxDetail = legacySfdx;
      if (sfdxCliVersionMatchDetail) {
        sfdxCliVersionDetail = sfdxCliVersionMatchDetail[1];
        legacySfdxDetail = true;
      } else {
        sfdxCliVersionMatchDetail = /@salesforce\/cli\/([^\s]+)/gm.exec(
          sfdxCliVersionStdOut,
        );
        if (sfdxCliVersionMatchDetail) {
          sfdxCliVersionDetail = sfdxCliVersionMatchDetail[1];
        }
      }

      const vsConfig = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      // When latestSfdxCliVersion is null (offline/cold cache), fall back to
      // RECOMMENDED_SFDX_CLI_VERSION only — never use null as the target version.
      const recommendedSfdxCliVersion: string | null =
        vsConfig.get("ignoreSfdxCliRecommendedVersion") === true
          ? latestSfdxCliVersion
          : RECOMMENDED_SFDX_CLI_VERSION || latestSfdxCliVersion;

      const sfdxCliItem = {
        id: `sfdx-cli-info`,
        label: `@salesforce/cli v${sfdxCliVersionDetail}`,
        command: `echo "Nothing to do here 😁"`,
        tooltip: t("sfCliRecommendedInstalled"),
        status: "dependency-ok",
        helpUrl:
          "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
      };
      let sfdxCliOutdated = false;
      const upgradeAvailableText = t("upgradeAvailableSuffix");
      // Resolve `sf` path once for upgrade command and bulk upgrade prefix
      const sfdxPath = await resolveSfCliPath();
      // Only compare versions when we have a known target; skip if latest is unknown
      if (recommendedSfdxCliVersion !== null && sfdxCliVersionDetail !== recommendedSfdxCliVersion) {
        if (legacySfdxDetail) {
          sfdxCliItem.label = t("upgradeToSalesforceCli");
          sfdxCliItem.command = `npm uninstall sfdx-cli --global && npm install @salesforce/cli --global && sf hardis:work:ws --event refreshPlugins`;
          sfdxCliItem.tooltip = t("sfdxDeprecatedTooltip");
          sfdxCliItem.status = "dependency-error";
        } else {
          sfdxCliOutdated = true;
          sfdxCliItem.label =
            sfdxCliItem.label.includes("missing") &&
            !sfdxCliItem.label.includes("(link)")
              ? sfdxCliItem.label
              : sfdxCliItem.label + upgradeAvailableText;
          sfdxCliItem.command =
            buildSfCliUpgradeCommand(sfdxPath, recommendedSfdxCliVersion) +
            ` && sf hardis:work:ws --event refreshPlugins`;
          sfdxCliItem.tooltip = t("clickToUpgradeSfCliTo", {
            version: recommendedSfdxCliVersion,
          });
          sfdxCliItem.status = "dependency-warning";
        }
      } else if (isNativeSfCliInstall(sfdxPath)) {
        sfdxCliItem.tooltip = t("depSfCliNativeInstallNote");
      }
      items.push(sfdxCliItem);

      // Check installed plugins with npm latest version comparison
      const outdated: any[] = [];
      const pluginPromises = plugins.map(async (plugin) => {
        // Special check for sfdx-hardis version — show prompt once per session
        if (plugin.name === "sfdx-hardis" && !PLUGINS_SFDXHARDIS_PROMPT_SHOWN) {
          let installedVersion = null;
          const regex = new RegExp(
            `${plugin.name} (\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?)`,
            "gm",
          );
          const match = regex.exec(sfdxPlugins);
          if (match && match[1]) {
            installedVersion = match[1];
          }
          const sfdxHardisInstallTag = getSfdxHardisInstallTag();
          if (
            installedVersion &&
            ((isExtensionPreRelease() && !installedVersion.includes("alpha")) ||
              (RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION !== "beta" &&
                !isExtensionPreRelease() &&
                this.compareVersions(
                  installedVersion,
                  RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
                ) < 0) ||
              (RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION === "beta" &&
                !installedVersion.includes("(beta)")))
          ) {
            PLUGINS_SFDXHARDIS_PROMPT_SHOWN = true;
            const versionToInstall = sfdxHardisInstallTag;
            const upgradeNowLabel = t("upgradeNow");
            const errorMessageForUSer = isExtensionPreRelease()
              ? t("sfdxHardisPreReleaseAlphaMessage")
              : RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION === "beta"
                ? t("sfdxHardisPreReleaseBetaMessage")
                : t("sfdxHardisPluginOutdated", {
                    version: installedVersion,
                    versionToInstall,
                  });
            vscode.window
              .showErrorMessage(errorMessageForUSer, upgradeNowLabel)
              .then((selection) => {
                if (selection === upgradeNowLabel) {
                  vscode.commands.executeCommand(
                    "vscode-sfdx-hardis.execute-command",
                    `echo y|sf plugins:install sfdx-hardis@${versionToInstall} && sf hardis:work:ws --event refreshPlugins`,
                  );
                }
              });
          }
        }

        // Check latest plugin version (may be null when offline / cold cache)
        const latestPluginVersion: string | null = await getNpmLatestVersion(plugin.name);
        if (latestPluginVersion === null) {
          Logger.log(`Latest version for ${plugin.name} is not yet available (cold/offline)`);
        }
        let pluginLabel = (plugin as any).isCommunity
          ? `${plugin.name} ${t("communityPluginLabel")}`
          : plugin.name;
        let isPluginMissing = false;
        const previewLabel = t("pluginPreviewLabel");
        const regexVersion = new RegExp(
          `${(plugin as any).altName || plugin.name} (.*)`,
          "gm",
        );
        const versionMatches = [...sfdxPlugins.matchAll(regexVersion)];
        if (versionMatches.length > 0) {
          pluginLabel += ` v${versionMatches[0][1]}`;
        } else {
          pluginLabel += t("pluginMissingSuffix");
          isPluginMissing = true;
        }
        const pluginItem = {
          id: `plugin-info-${plugin.name}`,
          label: pluginLabel,
          command: `echo "Nothing to do here 😁"`,
          tooltip: t("sfdxPluginLatestInstalled", { plugin: plugin.name }),
          status: "dependency-ok",
          helpUrl: plugin.helpUrl,
        };
        // Only show upgrade decoration when we have a known latest version
        if (
          latestPluginVersion !== null &&
          !sfdxPlugins.includes(`${plugin.name} ${latestPluginVersion}`) &&
          !sfdxPlugins.includes(
            `${(plugin as any).altName || "nope"} ${latestPluginVersion}`,
          )
        ) {
          pluginItem.label =
            pluginItem.label.includes("(beta)") ||
            pluginItem.label.includes("(alpha)")
              ? pluginItem.label + " " + previewLabel
              : pluginItem.label.includes("(link)")
                ? pluginItem.label.replace("(link)", "(localdev)")
                : isPluginMissing
                  ? pluginItem.label
                  : pluginItem.label + upgradeAvailableText;
          const installTag =
            plugin.name === "sfdx-hardis" ? getSfdxHardisInstallTag() : "latest";
          pluginItem.command = `echo y|sf plugins:install ${plugin.name}@${installTag} && sf hardis:work:ws --event refreshPlugins`;
          pluginItem.tooltip = t("clickToUpgradeSfdxPluginTo", {
            plugin: plugin.name,
            version: latestPluginVersion,
          });
          if (!pluginItem.label.includes("(localdev)")) {
            pluginItem.status = isPluginMissing
              ? "dependency-missing"
              : pluginItem.label.includes(previewLabel)
                ? "dependency-preview"
                : "dependency-warning";
            if (!pluginItem.label.includes(previewLabel)) {
              outdated.push(plugin);
            }
          }
        }
        if (pluginItem.label.includes("(localdev)")) {
          pluginItem.status = "dependency-local";
          pluginItem.tooltip = t("usingLocallyDevelopedPlugin", {
            plugin: plugin.name,
          });
        }
        items.push(pluginItem);
      });
      // Await parallel promises to be completed
      await Promise.allSettled(pluginPromises);

      // Ensure community/custom plugins are always displayed at the end
      items.sort(
        (a: any, b: any) => (a.isCommunity ? 1 : 0) - (b.isCommunity ? 1 : 0),
      );

      // Propose user to upgrade if necessary — once per session
      let mergeDriverWasEnabled = false;
      if (outdated.some((plugin) => plugin.name === "sf-git-merge-driver")) {
        const mergeDriverStatus = await isMergeDriverEnabled(getWorkspaceRoot());
        mergeDriverWasEnabled = mergeDriverStatus === true;
      }
      if (outdated.length > 0) {
        const upgradeCommand = this.buildUpgradeCommand(
          outdated,
          plugins,
          legacySfdxDetail,
          sfdxCliOutdated,
          mergeDriverWasEnabled,
          sfdxPath,
          recommendedSfdxCliVersion ?? undefined,
        );
        const setupHelper = SetupHelper.getInstance();
        const vsConfigInner = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
        if (
          vsConfigInner.get("autoUpdateDependencies") === true &&
          !setupHelper.hasUpdatesInProgress() &&
          !PLUGINS_AUTO_UPGRADE_STARTED
        ) {
          PLUGINS_AUTO_UPGRADE_STARTED = true;
          setupHelper.setUpdateInProgress(true, upgradeCommand);
          execCommandWithProgress(
            upgradeCommand,
            { fail: false, output: true },
            t("autoUpgradingDependencies", { command: upgradeCommand }),
          )
            .then(() => {
              setupHelper.setUpdateInProgress(false, upgradeCommand);
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.refreshPluginsView",
              );
            })
            .catch(() => {
              setupHelper.setUpdateInProgress(false, upgradeCommand);
              vscode.commands.executeCommand(
                "vscode-sfdx-hardis.refreshPluginsView",
              );
            });
        } else if (!setupHelper.hasUpdatesInProgress() && !PLUGINS_OUTDATED_PROMPT_SHOWN) {
          PLUGINS_OUTDATED_PROMPT_SHOWN = true;
          const upgradePluginsLabel = t("upgradePlugins");
          vscode.window
            .showWarningMessage(t("somePluginsNotUpToDate"), upgradePluginsLabel)
            .then((selection) => {
              if (selection === upgradePluginsLabel) {
                if (vsConfigInner.get("userInput") === "ui-lwc") {
                  vscode.commands.executeCommand("vscode-sfdx-hardis.showSetup");
                  return;
                }
                vscode.commands.executeCommand(
                  "vscode-sfdx-hardis.execute-command",
                  upgradeCommand,
                );
              }
            });
        }
      }

      // Store final items and mark detail pass complete
      PLUGINS_DETAIL_ITEMS = items.sort(
        (a: any, b: any) => (a.label > b.label ? 1 : -1),
      );
      PLUGINS_DETAIL_LOADED = true;
    } catch (e) {
      Logger.log("[vscode-sfdx-hardis] runPluginsDetailPass failed: " + String(e));
      // Fall back to the phase-1 placeholders (installed versions, no upgrade
      // info) so getPluginsItems returns them via the LOADED===true branch.
      // Without this, DETAIL_ITEMS stays null and getPluginsItems would fall
      // through to phase 1 again and relaunch the detail pass — an infinite
      // refresh loop if the failure is deterministic.
      if (PLUGINS_DETAIL_ITEMS === null) {
        PLUGINS_DETAIL_ITEMS = PLUGINS_PHASE1_ITEMS ?? [];
      }
      PLUGINS_DETAIL_LOADED = true;
    } finally {
      PLUGINS_DETAIL_IN_FLIGHT = false;
      // Fire refresh so the final decorated rows replace the placeholders
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshPluginsView",
        true,
      );
    }
  }

  private buildUpgradeCommand(
    outdated: any[],
    plugins: any,
    legacySfdx: boolean,
    sfdxCliOutdated: boolean,
    mergeDriverWasEnabled: boolean,
    sfdxPath: string,
    recommendedSfdxCliVersion?: string,
  ): string {
    const hardisTag = getSfdxHardisInstallTag();
    let command = outdated
      .map((plugin) => {
        const tag = plugin.name === "sfdx-hardis" ? hardisTag : "latest";
        return `echo y|sf plugins:install ${plugin.name}@${tag}`;
      })
      .join(" && ");
    if (legacySfdx) {
      command =
        "npm uninstall sfdx-cli --global && npm install @salesforce/cli --global && " +
        plugins
          .map((plugin: any) => {
            const tag = plugin.name === "sfdx-hardis" ? hardisTag : "latest";
            return `echo y|sf plugins:install ${plugin.name}@${tag}`;
          })
          .join(" && ");
    } else if (sfdxCliOutdated === true) {
      // Pin the exact recommended/latest version rather than letting
      // buildSfCliUpgradeCommand fall back to @latest: the installed version is
      // compared against recommendedSfdxCliVersion, so installing a different
      // resolved version would keep showing the CLI as outdated.
      command =
        buildSfCliUpgradeCommand(sfdxPath, recommendedSfdxCliVersion) +
        " && " +
        command;
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
    if (!isAllConfigLoaded()) {
      // Config not ready yet: return without custom plugins and refresh once config is loaded.
      // A 60 s timeout ensures the refresh fires even if config loading stalls, preventing
      // the plugins panel from spinning forever.
      void (async () => {
        const TIMEOUT_MS = 60_000;
        try {
          await Promise.race([
            listCustomPlugins(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(new Error("listCustomPlugins timed out after 60 s")),
                TIMEOUT_MS,
              ),
            ),
          ]);
        } catch (e) {
          Logger.log(
            "[vscode-sfdx-hardis] loadAdditionalPlugins: config load timed out or failed – " +
              (e instanceof Error ? e.message : String(e)),
          );
        }
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshPluginsView",
          true,
        );
      })();
      return;
    }
    const [customPlugins, hardisCommandsPlugins] = await Promise.all([
      listCustomPlugins(),
      listPluginsProvidingHardisCommands(),
    ]);
    const pluginsToAdd = [...customPlugins, ...hardisCommandsPlugins];
    const existingNames = new Set(plugins.map((plugin) => plugin.name));
    for (const plugin of pluginsToAdd) {
      if (!existingNames.has(plugin.name)) {
        plugins.push({ ...(plugin as any), isCommunity: true });
        existingNames.add(plugin.name);
      }
    }
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
        tooltip: t("dependencyInstalled", { name: extension.label }),
        status: "dependency-ok",
      };
      let extInstance = vscode.extensions.getExtension(extension.id);
      if (!extInstance && extension.id === "salesforce.salesforcedx-vscode") {
        extInstance = vscode.extensions.getExtension(
          "salesforce.salesforcedx-vscode-expanded",
        );
      }
      if (!extInstance) {
        const installExtensionLabel = t("installVsCodeExtension", {
          name: extension.label,
        });
        extensionItem.command = `workbench.extensions.installExtension ${extension.id}`;
        extensionItem.tooltip = t("clickToInstallVsCodeExtension", {
          name: extension.label,
        });
        extensionItem.status = "dependency-warning";
        vscode.window
          .showWarningMessage(
            t("vsCodeExtensionMissingWarning", { name: extension.label }),
            installExtensionLabel,
          )
          .then((selection) => {
            if (selection === installExtensionLabel) {
              vscode.commands.executeCommand(
                "workbench.extensions.installExtension",
                extension.id,
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
      // Hard refresh: re-run the full two-phase detail pass and re-allow prompts
      PLUGINS_DETAIL_LOADED = null;
      PLUGINS_PHASE1_ITEMS = null;
      PLUGINS_DETAIL_ITEMS = null;
      PLUGINS_OUTDATED_PROMPT_SHOWN = false;
      PLUGINS_SFDXHARDIS_PROMPT_SHOWN = false;
      PLUGINS_AUTO_UPGRADE_STARTED = false;
      PLUGINS_DETAIL_IN_FLIGHT = false;
      nodeInstallOk = false;
      gitInstallOk = false;
      nodeMissingPromptShown = false;
      gitMissingPromptShown = false;
    }
    this.themeUtils = new ThemeUtils();
    this._onDidChangeTreeData.fire();
  }

  // List status topics
  private listTopics(): any {
    const topics = [
      {
        id: "status-plugins-sfdx",
        label: "sfCliAndPlugins",
        defaultExpand: true,
      },
      {
        id: "status-plugins-core",
        label: "coreLabel",
        defaultExpand: true,
      },
      {
        id: "status-vscode-extensions",
        label: "vsCodeExtensionsLabel",
        defaultExpand: true,
      },
    ].map((topic) => {
      topic.label = this.themeUtils.buildSectionLabel(topic.id, t(topic.label));
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
      if (
        hardisCommand.startsWith("vscode-sfdx-hardis") ||
        hardisCommand.startsWith("workbench.extensions.installExtension")
      ) {
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
