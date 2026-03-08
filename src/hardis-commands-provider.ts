import * as vscode from "vscode";
import {
  hasSfdxProjectJson,
  isProjectSfdxConfigLoaded,
  loadExternalSfdxHardisConfiguration,
  loadProjectSfdxHardisConfig,
  resetCache,
} from "./utils";
import { ThemeUtils } from "./themeUtils";
import { t } from "./i18n/i18n";

export class HardisCommandsProvider implements vscode.TreeDataProvider<CommandTreeItem> {
  private allTopicsAndCommands: any = null;
  private themeUtils: ThemeUtils;
  constructor(private workspaceRoot: string) {
    this.themeUtils = new ThemeUtils();
  }

  getTreeItem(element: CommandTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandTreeItem): Thenable<CommandTreeItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage(
        t("noCommandsAvailableUntilFolderOpen"),
      );
      return Promise.resolve([]);
    }
    hasSfdxProjectJson({ recalc: true });
    if (element) {
      // VS Code can request children before the root nodes have finished loading.
      // Ensure the topics/commands cache is initialized to avoid null dereferences.
      return this.listTopicAndCommands().then(() =>
        Promise.resolve(this.getTopicCommands(element)),
      );
    }
    return this.listTopics();
  }

  /**
   * List commands related to a topic
   */
  private getTopicCommands(topic: any): CommandTreeItem[] {
    const items: CommandTreeItem[] = [];
    const matchingTopic = (this.getAllTopicsAndCommands() || []).filter(
      (topicItem: CommandTreeItem) => topicItem.id === topic.id,
    )[0];
    if (!matchingTopic || !matchingTopic.commands) {
      return items;
    }
    for (const item of matchingTopic.commands) {
      const options: any = {};
      if (item.description) {
        options.description = item.description;
      }
      if (item.tooltip) {
        options.tooltip = item.tooltip;
      }
      if (item.requiresProject) {
        options.requiresProject = item.requiresProject;
      }
      if (item.helpUrl) {
        options.helpUrl = item.helpUrl;
      }
      items.push(
        new CommandTreeItem(
          item.label,
          item.id,
          item.command,
          vscode.TreeItemCollapsibleState.None,
          this.themeUtils,
          options,
        ),
      );
    }
    return items;
  }

  // Manage refresh
  private _onDidChangeTreeData: vscode.EventEmitter<
    CommandTreeItem | undefined | null | void
  > = new vscode.EventEmitter<CommandTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    CommandTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  async refresh(keepCache: boolean): Promise<void> {
    this.allTopicsAndCommands = null;
    if (!keepCache) {
      await resetCache();
    }
    this.themeUtils = new ThemeUtils();
    this._onDidChangeTreeData.fire();
  }

  /**
   * List all topics
   */
  private async listTopics(): Promise<CommandTreeItem[]> {
    const items: CommandTreeItem[] = [];
    for (const item of await this.listTopicAndCommands()) {
      const options = {
        description: "",
        tooltip: "",
        requiresProject: false,
        helpUrl: "",
      };
      if (item.description) {
        options.description = item.description;
      }
      if (item.tooltip) {
        options.description = item.tooltip;
      }
      if (item.requiresProject) {
        options.requiresProject = item.requiresProject;
      }
      if (item.requiresProject) {
        options.helpUrl = item.helpUrl;
      }
      const expanded = item.defaultExpand
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      // Create section or command menu
      if (item.command) {
        // This is a command
        items.push(
          new CommandTreeItem(
            item.label,
            item.id,
            item.command,
            vscode.TreeItemCollapsibleState.None,
            this.themeUtils,
            options,
          ),
        );
      } else {
        // This is a section
        items.push(
          new CommandTreeItem(
            this.themeUtils.buildSectionLabel(item.id, item.label),
            item.id,
            "",
            expanded,
            this.themeUtils,
            options,
          ),
        );
      }
    }
    return items;
  }

  private getAllTopicsAndCommands(): any {
    return this.allTopicsAndCommands;
  }

  private async listTopicAndCommands(): Promise<any> {
    if (this.allTopicsAndCommands !== null) {
      return this.allTopicsAndCommands;
    }
    let hardisCommands = [
      {
        id: "vscode-sfdx-hardis.showWelcome",
        label: t("welcome"),
        command: "vscode-sfdx-hardis.showWelcome",
        requiresProject: false,
        helpUrl: "https://sfdx-hardis.cloudity.com/",
      },
      {
        id: "cicd-simple",
        label: t("ciCdSimple"),
        defaultExpand: true,
        commands: [
          {
            id: "vscode-sfdx-hardis.showPipeline",
            label: t("devOpsPipeline"),
            command: "vscode-sfdx-hardis.showPipeline",
            tooltip: t("devOpsPipelineTooltip"),
            requiresProject: false,
            helpUrl: "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/",
          },
          {
            id: "hardis:work:new",
            label: t("newUserStory"),
            command: "sf hardis:work:new",
            tooltip: t("newUserStoryTooltip"),
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/work/new/",
          },
          {
            id: "vscode-sfdx-hardis.showMetadataRetriever",
            label: t("metadataRetriever"),
            command: "vscode-sfdx-hardis.showMetadataRetriever",
            requiresProject: true,
            tooltip: t("metadataRetrieverTooltip"),
          },
          {
            id: "hardis:work:save",
            label: t("savePublishUserStory"),
            command: "sf hardis:work:save",
            tooltip: t("savePublishUserStoryTooltip"),
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/work/save/",
          },
          {
            id: "hardis:work:resetselection",
            label: t("resetSelectedListOfItemsToMerge"),
            command: "sf hardis:work:resetselection",
            tooltip: t("resetSelectedListTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/work/resetselection/",
          },
        ],
      },
      {
        id: "cicd-advanced",
        label: t("ciCdAdvanced"),
        commands: [
          {
            id: "vsCodeSfdxHardis.packageManager",
            label: t("installedPackagesManager"),
            tooltip: t("installedPackagesManagerTooltip"),
            command: "vscode-sfdx-hardis.showInstalledPackages",
            requiresProject: true,
          },
          {
            id: "project:clean:references",
            label: t("cleanSfdxProjectSources"),
            tooltip: t("cleanProjectTooltip"),
            command: "sf hardis:project:clean:references",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/clean/references/",
          },
          {
            id: "scratch:push-from-git-to-org",
            label: t("pushFromLocalFilesToSalesforceOrg"),
            tooltip: t("pushToSalesforceOrgTooltip"),
            command: "sf hardis:scratch:push",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/push/",
          },
          {
            id: "scratch:pull-from-org-to-git",
            label: t("pullFromSfOrgToLocalFiles"),
            tooltip: t("pullFromSfOrgToLocalFilesTooltip"),
            command: "sf hardis:scratch:pull",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/pull/",
          },
          {
            id: "force:source:tracking:clear",
            label: t("clearLocalSfdxTrackingFiles"),
            tooltip: t("removeTrackingFilesTooltip"),
            command: "sf project delete tracking",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_delete_tracking_unified",
          },
        ],
      },
      {
        id: "cicd-misc",
        label: t("ciCdMisc"),
        commands: [
          {
            id: "mcp:start-sf-cli-mcp-server",
            label: t("startSalesforceCLIMcpServer"),
            command: "vscode-sfdx-hardis.runSalesforceCliMcpServer",
            requiresProject: false,
          },
          {
            id: "scratch:create",
            label: t("createScratchOrg"),
            tooltip: t("createScratchOrgResumeTooltip"),
            command: "sf hardis:scratch:create",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/create/",
          },
          {
            id: "scratch:create:new",
            label: t("createScratchOrgForceNew"),
            tooltip: t("createNewScratchOrgTooltip"),
            command: "sf hardis:scratch:create --forcenew",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/create/",
          },
          {
            id: "package:install",
            label: t("installAPackage"),
            tooltip: t("installPackageTooltip"),
            command: "sf hardis:package:install",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/package/install/",
          },
          {
            id: "org:retrieve:packageconfig",
            label: t("retrievePackagesConfigFromOrg"),
            tooltip: t("retrievePackagesConfigFromOrgTooltip"),
            command: "sf hardis:org:retrieve:packageconfig",
          },
          {
            id: "org:password:generate",
            label: t("generateNewPassword"),
            command: "sf org generate password",
            tooltip: t("generateNewPasswordTooltip"),
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_passwd.htm",
          },
          {
            id: "org:connect",
            label: t("connectToSalesforceOrg"),
            tooltip: t("connectToOrgTooltip"),
            command: "sf hardis:org:connect",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/connect/",
          },
          {
            id: "source:retrieve",
            label: t("selectAndRetrieveSfdxSourcesFromOrg"),
            tooltip: t("selectAndRetrieveSourcesTooltip"),
            command: "sf hardis:source:retrieve",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/source/retrieve/",
          },
          {
            id: "org:retrieve:sources:analytics",
            label: t("retrieveAllCrmAnalyticsSources"),
            tooltip: t("retrieveAnalyticsSourcesTooltip"),
            command: "sf hardis:org:retrieve:sources:analytics",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/retrieve/sources/analytics/",
          },
          {
            id: "force:source:tracking:reset",
            label: t("clearLocalAndRemoteSfdxTrackingFiles"),
            tooltip: t("clearLocalAndRemoteTrackingTooltip"),
            command: "sf project reset tracking",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_reset_tracking_unified",
          },
          {
            id: "org:logout",
            label: t("logoutFromCurrentOrgAndDevHub"),
            command:
              "sf org logout --noprompt || true && sf config:unset target-org target-dev-hub -g && sf config:unset target-org target-dev-hub || true",
            tooltip: t("logoutFromOrgsTooltip"),

            helpText:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_org_commands_unified.htm#cli_reference_org_logout_unified",
          },
          {
            id: "git:login",
            label: t("loginAgainToGit"),
            command:
              "echo 'If you see and error, execute the same commands in PowerShell run as administrator' && git config --system --unset credential.helper && git config credential.helper store && git fetch",
            tooltip: t("gitLoginErrorsTooltip"),
          },
          {
            id: "git:pull-requests:extract",
            label: t("extractPullRequests"),
            command: "sf hardis:git:pull-requests:extract",
            tooltip: t("extractPullRequestsTooltip"),
          },
          {
            id: "project:generate:bypass",
            label: t("generateBypassCustomPermissions"),
            command: "sf hardis:project:generate:bypass",
            requiresProject: true,
            tooltip: t("generateBypassTooltip"),
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/generate/bypass/",
          },
          {
            id: "hardis:project:metadata:activate-decomposed",
            label: t("activateDecomposedFormat"),
            command: "sf hardis:project:metadata:activate-decomposed",
            requiresProject: true,
            tooltip: t("activateDecomposedTooltip"),
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/metadata/activate-decomposed/",
          },
        ],
      },
      {
        id: "data",
        label: t("dataImportExport"),
        icon: new vscode.ThemeIcon("database"),
        commands: [
          {
            id: "vscode-sfdx-hardis.showDataWorkbench",
            label: t("dataImportExportWorkbench"),
            tooltip: t("dataWorkbenchTooltip"),
            command: "vscode-sfdx-hardis.showDataWorkbench",
          },
          {
            id: "org:data:export",
            label: t("exportDataFromOrgWithSfdmu"),
            tooltip: t("exportDataTooltip"),
            command: "sf hardis:org:data:export",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/export/",
          },
          {
            id: "org:data:import",
            label: t("importDataToOrgWithSfdmu"),
            tooltip: t("importDataTooltip"),
            command: "sf hardis:org:data:import",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/import/",
          },
          {
            id: "org:data:delete",
            label: t("deleteDataFromOrgWithSfdmu"),
            tooltip: t("deleteDataTooltip"),
            command: "sf hardis:org:data:delete",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/delete/",
          },
          {
            id: "org:data:configure",
            label: t("createDataImportExportConfiguration"),
            tooltip: t("initSfdmuProjectTooltip"),
            command: "sf hardis:org:configure:data",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/configure/data/",
          },
          {
            id: "org:multi-org-query",
            label: t("multiOrgSoqlQueryReport"),
            tooltip: t("multiOrgQueryTooltip"),
            command: "sf hardis:org:multi-org-query",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/multi-org-query/",
          },
        ],
      },
      {
        id: "files",
        label: t("filesImportExport"),
        icon: new vscode.ThemeIcon("files"),
        commands: [
          {
            id: "vscode-sfdx-hardis.showFilesWorkbench",
            label: t("filesImportExportWorkbench"),
            tooltip: t("filesWorkbenchTooltip"),
            command: "vscode-sfdx-hardis.showFilesWorkbench",
          },
          {
            id: "org:files:export",
            label: t("exportFilesFromOrg"),
            tooltip: t("exportFilesTooltip"),
            command: "sf hardis:org:files:export",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/files/export/",
          },
          {
            id: "org:files:import",
            label: t("importFilesIntoOrg"),
            tooltip: t("importFilesTooltip"),
            command: "sf hardis:org:files:import",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/files/import/",
          },
          {
            id: "org:files:configure",
            label: t("createFilesExportConfiguration"),
            tooltip: t("initFileExportProjectTooltip"),
            command: "sf hardis:org:configure:files",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/configure/files/",
          },
        ],
      },
      {
        id: "debug",
        label: t("debugger"),
        commands: [
          {
            id: "hardis:debug:run",
            label: t("runDebugger"),
            tooltip: t("runDebuggerTooltip"),
            command: "vscode-sfdx-hardis.debug.launch",
          },
          {
            id: "hardis:debug:activate",
            label: t("activateDebugLogsTracing"),
            tooltip: t("activateDebugLogsTooltip"),
            command: "vscode-sfdx-hardis.debug.activate",
          },
          {
            id: "hardis:debug:deactivate",
            label: t("deactivateDebugLogsTracing"),
            tooltip: t("deactivateDebugLogsTooltip"),
            command: "vscode-sfdx-hardis.debug.deactivate",
          },
          {
            id: "org:purge:apexlog",
            label: t("purgeApexLogs"),
            tooltip: t("purgeApexLogsTooltip"),
            command: "sf hardis:org:purge:apexlog",
          },
          {
            id: "org:apex:log:tail",
            label: t("displayLiveLogsInTerminal"),
            tooltip: t("displayLiveLogsTooltip"),
            command: "vscode-sfdx-hardis.debug.logtail",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_apex_commands_unified.htm#cli_reference_apex_tail_log_unified",
          },
          {
            id: "hardis:debug:importapex",
            label: t("retrieveApexSourcesFromOrg"),
            tooltip: t("retrieveApexForDebugTooltip"),
            command:
              "sf hardis:org:retrieve:sources:dx -k ApexClass,ApexTrigger,ApexPage",
          },
        ],
      },
      {
        id: "org-operations",
        label: t("orgOperations"),
        commands: [
          {
            id: "vscode-sfdx-hardis.openOrgsManager",
            label: t("orgsManager"),
            tooltip: t("orgsManagerTooltip"),
            command: "vscode-sfdx-hardis.openOrgsManager",
          },
          {
            id: "org:user:freeze",
            label: t("freezeUsers"),
            tooltip: t("freezeUsersTooltip"),
            command: "sf hardis:org:user:freeze",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/user/freeze/",
          },
          {
            id: "org:user:unfreeze",
            label: t("unfreezeUsers"),
            tooltip: t("unfreezeUsersTooltip"),
            command: "sf hardis:org:user:unfreeze",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/user/unfreeze/",
          },
          {
            id: "org:purge:flow",
            label: t("purgeObsoleteFlowsVersions"),
            tooltip: t("purgeObsoleteFlowsTooltip"),
            command: "sf hardis:org:purge:flow",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/purge/flow/",
          },
          {
            id: "hardis:scratch:delete",
            label: t("deleteScratchOrgs"),
            tooltip: t("deleteScratchOrgsTooltip"),
            command: "sf hardis:scratch:delete",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/delete/",
          },
          {
            id: "hardis:org:user:activateinvalid",
            label: t("activateInvalidUserEmailsInSandbox"),
            tooltip: t("removeInvalidEmailsTooltip"),
            command: "sf hardis:org:user:activateinvalid",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/user/activateinvalid/",
          },
          {
            id: "hardis:org:refresh:before-refresh",
            label: t("sandboxRefreshBefore"),
            tooltip: t("sandboxRefreshBeforeTooltip"),
            command: "sf hardis:org:refresh:before-refresh",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/refresh/before-refresh/",
          },
          {
            id: "hardis:org:refresh:after-refresh",
            label: t("sandboxRefreshAfter"),
            tooltip: t("sandboxRefreshAfterTooltip"),
            command: "sf hardis:org:refresh:after-refresh",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/refresh/after-refresh/",
          },
        ],
      },
      {
        id: "org-monitoring",
        label: t("orgMonitoring"),
        commands: [
          {
            id: "vscode-sfdx-hardis.showOrgMonitoring",
            label: t("orgMonitoringWorkbench"),
            tooltip: t("orgMonitoringWorkbenchTooltip"),
            command: "vscode-sfdx-hardis.showOrgMonitoring",
            requiresProject: false,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/",
          },
          {
            id: "hardis:org:monitor:backup",
            label: t("metadatasBackup"),
            tooltip: t("metadatasBackupTooltip"),
            command: "sf hardis:org:monitor:backup",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/",
          },
          {
            id: "hardis:org:diagnose:audittrail",
            label: t("suspiciousAuditTrailActivities"),
            tooltip: t("suspiciousAuditTrailTooltip"),
            command: "sf hardis:org:diagnose:audittrail",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/",
          },
          {
            id: "org:test:apex",
            label: t("runApexTests"),
            command: "sf hardis:org:test:apex",
            tooltip: t("runApexTestsTooltip"),
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/test/apex/",
          },
          {
            id: "hardis:org:monitor:limits",
            label: t("checkOrgLimits"),
            command: "sf hardis:org:monitor:limits",
            tooltip: t("checkOrgLimitsTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/monitor/limits/",
          },
          {
            id: "hardis:org:diagnose:releaseupdates",
            label: t("checkReleaseUpdates"),
            command: "sf hardis:org:diagnose:releaseupdates",
            tooltip: t("checkReleaseUpdatesTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/releaseupdates/",
          },
          {
            id: "hardis:org:diagnose:unsecure-connected-apps",
            label: t("unsecuredConnectedApps"),
            tooltip: t("unsecuredConnectedAppsTooltip"),
            command: "sf hardis:org:diagnose:unsecure-connected-apps",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unsecure-connected-apps/",
          },
          {
            id: "hardis:org:monitor:health-check",
            label: t("securityHealthCheck"),
            tooltip: t("securityHealthCheckTooltip"),
            command: "sf hardis:org:monitor:health-check",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/monitor/health-check/",
          },
          {
            id: "org:diagnose:legacyapi",
            label: t("legacyApiVersionsUsage"),
            tooltip: t("detectLegacyApiTooltip"),
            command: "sf hardis:org:diagnose:legacyapi",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/",
          },
          {
            id: "hardis:org:diagnose:unusedusers",
            label: t("unusedUsers"),
            tooltip: t("unusedUsersTooltip"),
            command: "sf hardis:org:diagnose:unusedusers",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/salesforce-monitoring-inactive-users/",
          },
          {
            id: "hardis:org:diagnose:unusedlicenses",
            label: t("unusedPsLicensesBeta"),
            tooltip: t("unusedPsLicensesTooltip"),
            command: "sf hardis:org:diagnose:unusedlicenses",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses/",
          },
          {
            id: "hardis:org:diagnose:unused-apex-classes",
            label: t("unusedApexClasses"),
            tooltip: t("unusedApexClassesTooltip"),
            command: "sf hardis:org:diagnose:unused-apex-classes",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-apex-classes/",
          },
          {
            id: "hardis:org:diagnose:unused-connected-apps",
            label: t("unusedConnectedApps"),
            tooltip: t("unusedConnectedAppsTooltip"),
            command: "sf hardis:org:diagnose:unused-connected-apps",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-connected-apps/",
          },
          {
            id: "hardis:lint:access",
            label: t("metadataWithoutAccess"),
            tooltip: t("metadataWithoutAccessTooltip"),
            command: "sf hardis:lint:access",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/lint/access/",
          },
          {
            id: "hardis:lint:unusedmetadatas",
            label: t("unusedMetadatas"),
            tooltip: t("unusedMetadatasTooltip"),
            command: "sf hardis:lint:unusedmetadatas",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas/",
          },
          {
            id: "hardis:lint:metadatastatus",
            label: t("inactiveMetadatas"),
            tooltip: t("inactiveMetadatasTooltip"),
            command: "sf hardis:lint:metadatastatus",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus/",
          },
          {
            id: "hardis:lint:missingattributes",
            label: t("missingDescriptions"),
            tooltip: t("missingDescriptionsTooltip"),
            command: "sf hardis:lint:missingattributes",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/missingattributes/",
          },
          {
            id: "hardis:org:diagnose:storage-stats",
            label: t("dataStorageStatistics"),
            tooltip: t("dataStorageStatisticsTooltip"),
            command: "sf hardis:org:diagnose:storage-stats",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/storage-stats/",
          },
        ],
      },
      {
        id: "metadata-analysis",
        label: t("metadataAnalysis"),
        commands: [
          {
            id: "project:audit:duplicatefiles",
            label: t("detectDuplicateSfdxFiles"),
            tooltip: t("detectDuplicateSfdxFilesTooltip"),
            command: "sf hardis:project:audit:duplicatefiles",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/duplicatefiles/",
          },
          {
            id: "project:metadata:findduplicates",
            label: t("detectDuplicateValuesInMetadataFiles"),
            tooltip: t("detectDuplicateValuesTooltip"),
            command:
              "sf hardis:project:metadata:findduplicates -f force-app/**/*.xml",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/metadata/duplicatefiles/",
          },
          {
            id: "project:audit:apiversion",
            label: t("extractApiVersionsOfSources"),
            tooltip: t("extractApiVersionsTooltip"),
            command: "sf hardis:project:audit:apiversion",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/apiversion/",
          },
          {
            id: "project:audit:callincallout",
            label: t("listCallInAndCallOuts"),
            tooltip: t("listCallInAndCallOutsTooltip"),
            command: "sf hardis:project:audit:callincallout",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/callincallout/",
          },
          {
            id: "project:audit:remotesites",
            label: t("listRemoteSites"),
            tooltip: t("listRemoteSitesTooltip"),
            command: "sf hardis:project:audit:remotesites",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/remotesites/",
          },
          {
            id: "hardis:misc:custom-label-translations",
            label: t("extractCustomLabelTranslations"),
            tooltip: t("extractCustomLabelTranslationsTooltip"),
            command: "sf hardis:misc:custom-label-translations",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/misc/custom-label-translations/",
          },
          {
            id: "hardis:doc:object-field-usage",
            label: t("objectFieldUsage"),
            tooltip: t("objectFieldUsageTooltip"),
            command: "sf hardis:doc:object-field-usage",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/object/field/usage/",
          },
        ],
      },
      {
        id: "setup-config",
        label: t("setupConfiguration"),
        commands: [
          {
            id: "configure:auth:deployment",
            label: t("configureOrgCiAuth"),
            tooltip: t("configureOrgCiAuthTooltip"),
            command: "sf hardis:project:configure:auth",
          },
          {
            id: "configure:auth:devhub",
            label: t("configureDevHubCiAuth"),
            tooltip: t("configureDevHubCiAuthTooltip"),
            command: "sf hardis:project:configure:auth --devhub",
            requiresProject: true,
          },
          {
            id: "org:configure:monitoring",
            label: t("configureOrgMonitoring"),
            tooltip: t("configureOrgMonitoringTooltip"),
            command: "sf hardis:org:configure:monitoring",
          },
          {
            id: "scratch:pool:create",
            label: t("configureScratchOrgsPool"),
            tooltip: t("configureScratchOrgsPoolTooltip"),
            command: "sf hardis:scratch:pool:create",
          },
          {
            id: "project:create",
            label: t("createANewSfdxProject"),
            tooltip: t("createNewSfdxProjectTooltip"),
            command: "sf hardis:project:create",
          },
        ],
      },
      {
        id: "packaging",
        label: t("packaging"),
        commands: [
          {
            id: "hardis:package:create",
            label: t("createANewPackage"),
            tooltip: t("packagingTooltip"),
            command: "sf hardis:package:create",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:list",
            label: t("listPackageVersions"),
            tooltip: t("listPackageVersionsTooltip"),
            command: "sf hardis:package:version:list",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:create",
            label: t("createANewPackageVersion"),
            tooltip: t("createNewPackageVersionTooltip"),
            command: "sf hardis:package:version:create",
            requiresProject: true,
          },
        ],
      },
      {
        id: "doc",
        label: t("documentationGeneration"),
        commands: [
          {
            id: "vscode-sfdx-hardis.showDocumentationWorkbench",
            label: t("documentationWorkbench"),
            command: "vscode-sfdx-hardis.showDocumentationWorkbench",
            tooltip: t("documentationWorkbenchTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/salesforce-project-documentation/",
          },
          {
            id: "hardis:doc:project2markdown",
            label: t("projectDocumentation"),
            command: "sf hardis:doc:project2markdown",
            tooltip: t("projectDocumentationTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/",
          },
          {
            id: "hardis:doc:project2markdown-pdf",
            label: t("projectDocumentationPdf"),
            command: "sf hardis:doc:project2markdown --pdf",
            tooltip: t("projectDocumentationPdfTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/",
          },
          {
            id: "hardis:doc:project2markdown-history",
            label: t("projectDocumentationWithHistory"),
            command: "sf hardis:doc:project2markdown --with-history",
            tooltip: t("projectDocumentationWithHistoryTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/",
          },
          {
            id: "hardis-run-doc",
            label: t("runLocalHtmlDocPages"),
            command: "vscode-sfdx-hardis.runLocalHtmlDocPages",
            tooltip: t("runLocalHtmlDocTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/salesforce-project-documentation/",
          },
          {
            id: "hardis-upload-doc",
            label: t("uploadHtmlDocToSalesforce"),
            command: "sf hardis:doc:mkdocs-to-salesforce",
            tooltip: t("uploadHtmlDocToSalesforceTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/mkdocs-to-salesforce/",
          },
          {
            id: "hardis:doc:flow2markdown",
            label: t("flowsDocumentation"),
            command: "sf hardis:doc:flow2markdown",
            tooltip: t("flowsDocumentationTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/flow2markdown/",
          },
          {
            id: "hardis:doc:flow2markdown-pdf",
            label: t("flowsDocumentationPdf"),
            command: "sf hardis:doc:flow2markdown --pdf",
            tooltip: t("flowsDocumentationPdfTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/flow2markdown/",
          },
          {
            id: "hardis:project:generate:flow-git-diff",
            label: t("singleFlowVisualGitDiff"),
            command: "sf hardis:project:generate:flow-git-diff",
            tooltip: t("singleFlowVisualGitDiffTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/generate/flow-git-diff/",
          },
          {
            id: "hardis:doc:override-prompts",
            label: t("overridePromptTemplates"),
            command: "sf hardis:doc:override-prompts",
            tooltip: t("overridePromptTemplatesTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/override-prompts/",
          },
          {
            id: "hardis:doc:override-prompts-overwrite",
            label: t("overridePromptTemplatesOverwrite"),
            command: "sf hardis:doc:override-prompts --overwrite",
            tooltip: t("overridePromptTemplatesOverwriteTooltip"),
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/override-prompts/",
          },
        ],
      },
      {
        id: "nerdy-stuff",
        label: t("nerdyStuff"),
        commands: [
          {
            id: "project:generate:gitdelta",
            label: t("generatePackageXmlGitDelta"),
            tooltip: t("generatePackageXmlGitDeltaTooltip"),
            command: "sf hardis:project:generate:gitdelta",
          },
          {
            id: "org:generate:packagexmlfull",
            label: t("generateOrgFullPackageXml"),
            tooltip: t("generateOrgFullPackageXmlTooltip"),
            command: "sf hardis:org:generate:packagexmlfull",
          },
          {
            id: "org:retrieve:sources:dx2",
            label: t("retrieveDxSourcesFromOrg"),
            tooltip: t("retrieveDxSourcesFromOrgTooltip"),
            command: "sf hardis:org:retrieve:sources:dx2",
          },
          {
            id: "org:retrieve:sources:dx",
            label: t("retrieveAllDxSourcesFromOrg"),
            tooltip: t("retrieveAllDxSourcesTooltip"),
            command: "sf hardis:org:retrieve:sources:dx",
          },
          {
            id: "org:retrieve:sources:metadata",
            label: t("retrieveAllMetadataSourcesFromOrg"),
            tooltip: t("retrieveAllMetadataSourcesTooltip"),
            command: "sf hardis:org:retrieve:sources:metadata",
          },
          {
            id: "package:mergexml",
            label: t("mergePackageXmlFiles"),
            tooltip: t("mergePackageXmlFilesTooltip"),
            command: "sf hardis:package:mergexml",
          },
          {
            id: "execute-anonymous-apex",
            label: t("runAnonymousApexCode"),
            tooltip: t("runAnonymousApexTooltip"),
            command: "vscode-sfdx-hardis.runAnonymousApex",
          },
        ],
      },
      /*  {
        id: "extension-settings",
        label: "Extension settings",
        commands: [
          { Not working yet because of refresh issues
            id: "extension:settings:theme",
            label: "Select theme for menus",
            command: `vscode-sfdx-hardis.selectExtensionTheme`,
          },
          {
            id: "extension:settings:all",
            label: "Open all SFDX Hardis Settings",
            command: `workbench.action.openGlobalSettings hardis`,
          },
        ],
      },*/
      {
        id: "help",
        label: t("help"),
        commands: [
          {
            id: "contact:us",
            label: t("contactUsForHelp"),
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://cloudity.com/#form",
            )}`,
          },
          {
            id: "help:cicd",
            label: t("ciCdDocumentation"),
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/",
            )}`,
          },
          {
            id: "help:org-monitoring",
            label: t("orgMonitoringDocumentation"),
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/",
            )}`,
          },
          {
            id: "help:commands",
            label: t("allSfdxHardisCommandsDocumentation"),
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/commands/",
            )}`,
          },
          {
            id: "question",
            label: t("postIssueOnGithub"),
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://github.com/hardisgroupcom/sfdx-hardis/issues",
            )}`,
          },
          {
            id: "hardis",
            label: t("cloudityWebsite"),
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://www.cloudity.com?ref=sfdxhardis",
            )}`,
          },
        ],
      },
    ];
    hardisCommands = await this.completeWithCustomCommands(hardisCommands);
    this.allTopicsAndCommands = hardisCommands;
    return hardisCommands;
  }

  // Add custom commands defined within .sfdx-hardis.yml
  private async completeWithCustomCommands(hardisCommands: Array<any>) {
    // Handle faster display by getting config in background then refresh the commands panel
    if (!isProjectSfdxConfigLoaded()) {
      loadProjectSfdxHardisConfig().then(() =>
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshCommandsView",
          true,
        ),
      );
      return hardisCommands;
    }
    // Here config will already be loaded in cache
    const projectConfig = await loadProjectSfdxHardisConfig();
    // Commands defined in local .sfdx-hardis.yml
    if (projectConfig.customCommands) {
      const customCommandsPosition =
        projectConfig.customCommandsPosition || "last";
      hardisCommands = this.addCommands(
        projectConfig.customCommands,
        customCommandsPosition,
        hardisCommands,
      );
    }
    // Commands defined in remote config file .sfdx-hardis.yml
    const remoteConfig = await loadExternalSfdxHardisConfiguration();
    if (remoteConfig.customCommands) {
      // add in commands
      const customCommandsPosition =
        remoteConfig.customCommandsPosition || "last";
      hardisCommands = this.addCommands(
        remoteConfig.customCommands,
        customCommandsPosition,
        hardisCommands,
      );
    }
    return hardisCommands;
  }

  private addCommands(
    customCommands: Array<any>,
    customCommandsPosition: string,
    hardisCommands: Array<any>,
  ) {
    // Add default icon to commands if not set
    customCommands = customCommands.map((customCommandMenu) => {
      customCommandMenu.commands = customCommandMenu.commands.map(
        (customCommand: any) => {
          customCommand.icon = customCommand.icon ?? "cloudity-logo.svg";
          return customCommand;
        },
      );
      return customCommandMenu;
    });
    if (customCommandsPosition === "last") {
      // Last position
      const lastElement = hardisCommands.pop();
      hardisCommands.push(...customCommands);
      hardisCommands.push(lastElement);
    } else {
      // First position
      hardisCommands = customCommands.concat(hardisCommands);
    }
    return hardisCommands;
  }
}

// Build a tree item from data
class CommandTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly id: string,
    public readonly hardisCommand: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly themeUtils: ThemeUtils,
    public readonly options = {
      description: "",
      tooltip: "",
      requiresProject: false,
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
        hardisCommand.startsWith("workbench")
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
        this.tooltip = this.tooltip
          ? this.tooltip + "\nCommand: " + hardisCommand
          : hardisCommand;
        this.hardisCommand = hardisCommand;
      }
      this.iconPath = this.themeUtils.getCommandIconPath(this.id);
    }
    // Manage unavailable command
    if (options.requiresProject === true && !hasSfdxProjectJson()) {
      this.command = {
        title: "SFDX project is required to run this command",
        command: "vscode-sfdx-hardis.showMessage",
        arguments: [
          "You need a SFDX project to run this command. Open one with File -> Open folder, or create one with 'Create SFDX project' or 'Retrieve DX Sources from org' commands",
          "error",
        ],
      };
    }
    // Manage context menu tag
    this.contextValue =
      options.helpUrl || this.hardisCommand
        ? "SFDXHARDIS_CONTEXT_COMMAND"
        : undefined;
  }
}
