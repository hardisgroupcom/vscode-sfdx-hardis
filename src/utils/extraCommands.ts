import { DOCSITE_URL } from "../constants";
import { t } from "../i18n/i18n";

/**
 * A sfdx-hardis command that is not displayed in the commands tree menu (yet).
 *
 * The shape is aligned with the command items built by HardisCommandsProvider, so that
 * an entry can later be moved into a tree section (or an LWC panel) without rework.
 */
export interface ExtraCommand {
  /** Command identifier, matching the sfdx-hardis CLI command id */
  id: string;
  /** Translated label displayed to the user */
  label: string;
  /** Translated description of what the command does */
  tooltip: string;
  /** Command line to run */
  command: string;
  /** True when the command can only run within a Salesforce DX project */
  requiresProject: boolean;
  /** Online documentation of the command */
  helpUrl: string;
  /** Tree menu topic this command would belong to, if added to the menu later */
  suggestedTopic: string;
  /** Extra technical search terms, in addition to the label, tooltip and command line */
  keywords: string[];
}

/**
 * Static catalog of sfdx-hardis commands that are worth being available in VS Code but
 * are not displayed in the commands tree menu nor in a LWC panel.
 *
 * It is consumed by the command search feature, and is the staging area for commands that
 * may later be promoted to a tree menu section or to a workbench panel.
 *
 * Only commands that can run without any command line argument belong here: they either
 * prompt the user for what they need, or work from the .sfdx-hardis.yml configuration.
 * Commands requiring arguments (like hardis:mdapi:read) must be called from a dedicated
 * UI that builds their arguments, never from the command search.
 */
export class ExtraCommands {
  /**
   * Returns all extra commands.
   * The list is rebuilt at each call so that labels always match the active locale.
   */
  public static getCommands(): ExtraCommand[] {
    return [
      // Org monitoring
      {
        id: "hardis:org:monitor:all",
        label: t("runAllMonitoringCommands"),
        tooltip: t("runAllMonitoringCommandsTooltip"),
        command: "sf hardis:org:monitor:all",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/org/monitor/all/",
        suggestedTopic: "org-monitoring",
        keywords: ["monitoring", "reports", "notifications"],
      },
      {
        id: "hardis:org:diagnose:deployments",
        label: t("deploymentHistoryAnalysis"),
        tooltip: t("deploymentHistoryAnalysisTooltip"),
        command: "sf hardis:org:diagnose:deployments",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/org/diagnose/deployments/",
        suggestedTopic: "org-monitoring",
        keywords: ["DeployRequest", "validation", "history"],
      },
      {
        id: "hardis:org:diagnose:flex-queue",
        label: t("apexFlexQueue"),
        tooltip: t("apexFlexQueueTooltip"),
        command: "sf hardis:org:diagnose:flex-queue",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/org/diagnose/flex-queue/",
        suggestedTopic: "org-monitoring",
        keywords: ["AsyncApexJob", "Holding", "batch"],
      },
      {
        id: "hardis:org:diagnose:instanceupgrade",
        label: t("orgInstanceUpgrade"),
        tooltip: t("orgInstanceUpgradeTooltip"),
        command: "sf hardis:org:diagnose:instanceupgrade",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/org/diagnose/instanceupgrade/",
        suggestedTopic: "org-monitoring",
        keywords: ["instance", "release", "upgrade"],
      },
      {
        id: "hardis:org:diagnose:licenses",
        label: t("orgLicenses"),
        tooltip: t("orgLicensesTooltip"),
        command: "sf hardis:org:diagnose:licenses",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/org/diagnose/licenses/",
        suggestedTopic: "org-monitoring",
        keywords: ["UserLicense", "PermissionSetLicense"],
      },
      // Org operations
      {
        id: "hardis:org:create",
        label: t("createSandbox"),
        tooltip: t("createSandboxTooltip"),
        command: "sf hardis:org:create",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/org/create/",
        suggestedTopic: "org-operations",
        keywords: ["sandbox", "org"],
      },
      {
        id: "hardis:org:fix:listviewmine",
        label: t("fixListViewsMine"),
        tooltip: t("fixListViewsMineTooltip"),
        command: "sf hardis:org:fix:listviewmine",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/org/fix/listviewmine/",
        suggestedTopic: "org-operations",
        keywords: ["ListView", "Mine", "Everything"],
      },
      // Metadata analysis & fixes
      {
        id: "hardis:misc:purge-references",
        label: t("purgeMetadataReferences"),
        tooltip: t("purgeMetadataReferencesTooltip"),
        command: "sf hardis:misc:purge-references",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/misc/purge-references/",
        suggestedTopic: "metadata-analysis",
        keywords: ["references", "destructive changes"],
      },
      {
        id: "hardis:project:fix:profiletabs",
        label: t("fixProfileTabs"),
        tooltip: t("fixProfileTabsTooltip"),
        command: "sf hardis:project:fix:profiletabs",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/project/fix/profiletabs/",
        suggestedTopic: "metadata-analysis",
        keywords: ["Profile", "tabVisibilities"],
      },
      // Documentation
      {
        id: "hardis:doc:extract:permsetgroups",
        label: t("permissionSetGroupsDocumentation"),
        tooltip: t("permissionSetGroupsDocumentationTooltip"),
        command: "sf hardis:doc:extract:permsetgroups",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/doc/extract/permsetgroups/",
        suggestedTopic: "doc",
        keywords: ["Permission Set Group", "documentation"],
      },
      {
        id: "hardis:doc:fieldusage",
        label: t("customFieldUsage"),
        tooltip: t("customFieldUsageTooltip"),
        command: "sf hardis:doc:fieldusage",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/doc/fieldusage/",
        suggestedTopic: "metadata-analysis",
        keywords: ["fields", "dependencies", "impact analysis"],
      },
      // Data
      {
        id: "hardis:datacloud:sql-query",
        label: t("dataCloudSqlQuery"),
        tooltip: t("dataCloudSqlQueryTooltip"),
        command: "sf hardis:datacloud:sql-query",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/datacloud/sql-query/",
        suggestedTopic: "data",
        keywords: ["Data Cloud", "SQL", "query"],
      },
      // Packaging
      {
        id: "hardis:package:version:promote",
        label: t("promotePackageVersion"),
        tooltip: t("promotePackageVersionTooltip"),
        command: "sf hardis:package:version:promote",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/package/version/promote/",
        suggestedTopic: "packaging",
        keywords: ["package", "beta", "released", "DevHub"],
      },
      // Scratch org pool
      {
        id: "hardis:scratch:pool:localauth",
        label: t("scratchOrgPoolAuthentication"),
        tooltip: t("scratchOrgPoolAuthenticationTooltip"),
        command: "sf hardis:scratch:pool:localauth",
        requiresProject: true,
        helpUrl: DOCSITE_URL + "/hardis/scratch/pool/localauth/",
        suggestedTopic: "cicd-advanced",
        keywords: ["scratch org pool", "authentication"],
      },
      // Troubleshooting & tooling
      {
        id: "hardis:doctor",
        label: t("diagnoseHardisInstallation"),
        tooltip: t("diagnoseHardisInstallationTooltip"),
        command: "sf hardis:doctor",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/doctor/",
        suggestedTopic: "help",
        keywords: ["doctor", "issue", "support"],
      },
      {
        id: "hardis:cache:clear",
        label: t("clearHardisCache"),
        tooltip: t("clearHardisCacheTooltip"),
        command: "sf hardis:cache:clear",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/cache/clear/",
        suggestedTopic: "help",
        keywords: ["cache", "troubleshooting"],
      },
      {
        id: "hardis:project:skills:import",
        label: t("importAiSkills"),
        tooltip: t("importAiSkillsTooltip"),
        command: "sf hardis:project:skills:import",
        requiresProject: false,
        helpUrl: DOCSITE_URL + "/hardis/project/skills/import/",
        suggestedTopic: "nerdy-stuff",
        keywords: ["Claude Code", "skills", "agents", "AI"],
      },
    ];
  }

  /**
   * Returns a single extra command from its id
   */
  public static getCommand(id: string): ExtraCommand | undefined {
    return ExtraCommands.getCommands().find(
      (extraCommand) => extraCommand.id === id,
    );
  }

  /**
   * Returns the extra commands that would belong to a tree menu topic
   */
  public static getCommandsByTopic(topic: string): ExtraCommand[] {
    return ExtraCommands.getCommands().filter(
      (extraCommand) => extraCommand.suggestedTopic === topic,
    );
  }

  /**
   * Returns true if the command id is part of the extra commands catalog
   */
  public static isExtraCommand(id: string): boolean {
    return ExtraCommands.getCommand(id) !== undefined;
  }

  /**
   * Returns the extra commands that are not already available through the command lines
   * sent as argument (typically the commands of the tree menu, including the custom
   * commands defined in .sfdx-hardis.yml).
   *
   * The command search must always call this method rather than getCommands(): the day a
   * catalog command is added to the tree menu, it is filtered out here instead of being
   * displayed twice in the search results.
   *
   * Flags are ignored during the comparison, so a menu entry running the same command with
   * arguments (ex: "sf hardis:org:monitor:all --force-all") also hides the catalog entry.
   */
  public static getCommandsNotAlreadyListed(
    existingCommandLines: string[],
  ): ExtraCommand[] {
    const existingIds = new Set(
      existingCommandLines.map((commandLine) =>
        ExtraCommands.getSfdxHardisCommandId(commandLine),
      ),
    );
    return ExtraCommands.getCommands().filter(
      (extraCommand) =>
        !existingIds.has(
          ExtraCommands.getSfdxHardisCommandId(extraCommand.command),
        ),
    );
  }

  /**
   * Extracts the sfdx-hardis command id of a command line, without its flags.
   * Example: "sf hardis:org:monitor:all --force-all" returns "hardis:org:monitor:all"
   */
  private static getSfdxHardisCommandId(commandLine: string): string {
    const commandPart = (commandLine || "")
      .trim()
      .split(/\s+/)
      .find((token) => token.startsWith("hardis:"));
    return commandPart || (commandLine || "").trim();
  }
}
