import * as vscode from "vscode";
import {
  hasSfdxProjectJson,
  isProjectSfdxConfigLoaded,
  loadExternalSfdxHardisConfiguration,
  loadProjectSfdxHardisConfig,
  resetCache,
} from "./utils";
import { ThemeUtils } from "./themeUtils";

export class HardisCommandsProvider
  implements vscode.TreeDataProvider<CommandTreeItem>
{
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
        "🦙 No commands available until you open a folder",
      );
      return Promise.resolve([]);
    }
    hasSfdxProjectJson({ recalc: true });
    if (element) {
      return Promise.resolve(this.getTopicCommands(element));
    } else {
      return this.listTopics();
    }
  }

  /**
   * List commands related to a topic
   */
  private getTopicCommands(topic: any): CommandTreeItem[] {
    const items: CommandTreeItem[] = [];
    const matchingTopic = this.getAllTopicsAndCommands().filter(
      (topicItem: CommandTreeItem) => topicItem.id === topic.id,
    )[0];
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

  refresh(keepCache: boolean): void {
    this.allTopicsAndCommands = null;
    if (!keepCache) {
      resetCache();
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
        id: "cicd-simple",
        label: "CI/CD (simple)",
        defaultExpand: true,
        commands: [
          {
            id: "hardis:work:new",
            label: "New User Story",
            command: "sf hardis:work:new",
            tooltip:
              "Start to work, it will:\n- Create a new git branch where it is needed to \n- Allow to select or create a Salesforce org to work in (sandbox or scratch)",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/work/new/",
          },
          {
            id: "scratch:pull-from-org-to-git",
            label: "Pull from SF Org to local Git files",
            tooltip:
              'Once you have made your configuration in your org Setup, click here to download your updates.\nThen, you can commit the updates you want to publish (use VsCode Git extension)\nThen you can run command "Save / Publish User Story"\nNote: if you don\'t see all your updates, you can manually retrieve it using VsCode Extension "Org Browser"(Salesforce logo)',
            command: "sf hardis:scratch:pull",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/pull/",
          },
          {
            id: "hardis:work:save",
            label: "Save / Publish User Story",
            command: "sf hardis:work:save",
            tooltip:
              "Once you performed your commit(s), click here to prepare your Pull Request. It will:\n- Automatically update package.xml and destructiveChanges.xml\n- Clean metadatas before publishing them (for example remove flow positions or remove object & field access from Profiles)",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/work/save/",
          },
          {
            id: "hardis:work:resetselection",
            label: "Reset selected list of items to merge",
            command: "sf hardis:work:resetselection",
            tooltip:
              'You already pushed a commit but you selected updates that you do not want to deploy ?\nIn that case, click here and you\'ll be able to select again what you want to commit.\nAfter creating new commits, click on "Save / Publish User Story"',
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/work/resetselection/",
          },
          {
            id: "vscode-sfdx-hardis.showPipeline",
            label: "DevOps Pipeline",
            command: "vscode-sfdx-hardis.showPipeline",
            tooltip:
              "Open the DevOps Pipeline panel to visualize and manage your CI/CD pipeline.",
            requiresProject: false,
            helpUrl: "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/",
          },
        ],
      },
      {
        id: "cicd-advanced",
        label: "CI/CD (advanced)",
        commands: [
          {
            id: "scratch:push-from-git-to-org",
            label: "Push from local files to Salesforce org",
            tooltip:
              "Propagates your local updates within Vs Code into your remote Salesforce scratch org",
            command: "sf hardis:scratch:push",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/push/",
          },
          {
            id: "package:install",
            label: "Install a package",
            tooltip:
              "This will update project .sfdx-hardis.yml so the package will always be installed in new scratch orgs and future deployments",
            command: "sf hardis:package:install",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/package/install/",
          },
          {
            id: "org:retrieve:packageconfig",
            label: "Retrieve packages configuration from org",
            tooltip:
              "Retrieve package configuration from an org and propose to update project sfdx-hardis configuration",
            command: "sf hardis:org:retrieve:packageconfig",
          },
          {
            id: "project:clean:references",
            label: "Clean SFDX project sources",
            tooltip:
              "Select and apply lots of cleaning commands provided by sfdx-hardis",
            command: "sf hardis:project:clean:references",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/clean/references/",
          },
          {
            id: "force:source:tracking:clear",
            label: "Clear local sfdx tracking files",
            tooltip:
              "Removes all local information about updates you already pulled from org",
            command: "sf project delete tracking",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_delete_tracking_unified",
          },
        ],
      },
      {
        id: "cicd-misc",
        label: "CI/CD (misc)",
        commands: [
          {
            id: "scratch:create",
            label: "Create scratch org (or resume creation)",
            tooltip:
              "If during Work:New you had an error, you can resume the scratch org creation",
            command: "sf hardis:scratch:create",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/create/",
          },
          {
            id: "scratch:create:new",
            label: "Create scratch org (force new)",
            tooltip: "Create a new scratch org for the current work",
            command: "sf hardis:scratch:create --forcenew",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/create/",
          },
          {
            id: "org:password:generate",
            label: "Generate new password",
            command: "sf org generate password",
            tooltip:
              "Generates a new password for your current scratch org user",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_passwd.htm",
          },
          {
            id: "org:connect",
            label: "Connect to a Salesforce org",
            tooltip:
              "Connects to a Salesforce org without setting it as defaultusername",
            command: "sf hardis:org:connect",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/connect/",
          },
          {
            id: "source:retrieve",
            label: "Select and retrieve sfdx sources from org",
            tooltip:
              "Allows user to select a list of metadata types and process the retrieve from an org",
            command: "sf hardis:source:retrieve",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/source/retrieve/",
          },
          {
            id: "org:retrieve:sources:analytics",
            label: "Retrieve all CRM analytics sources",
            tooltip:
              "Allows user to select a list of metadata types and process the retrieve from an org",
            command: "sf hardis:org:retrieve:sources:analytics",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/retrieve/sources/analytics/",
          },
          {
            id: "force:source:tracking:reset",
            label: "Clear local and remote sfdx tracking files",
            tooltip:
              "Removes all local and remote information about updates you already pulled from org",
            command: "sf project reset tracking",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_reset_tracking_unified",
          },
          {
            id: "org:logout",
            label: "Logout from current Org and DevHub",
            command:
              "sf org logout --noprompt || true && sf config:unset target-org target-dev-hub -g && sf config:unset target-org target-dev-hub || true",
            tooltip: "Log out from orgs :)",

            helpText:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_org_commands_unified.htm#cli_reference_org_logout_unified",
          },
          {
            id: "git:login",
            label: "Login again to git",
            command:
              "echo 'If you see and error, execute the same commands in PowerShell run as administrator' && git config --system --unset credential.helper && git config credential.helper store && git fetch",
            tooltip: "Use this command in case you have git login errors",
          },
          {
            id: "git:pull-requests:extract",
            label: "Extract pull requests",
            command: "sf hardis:git:pull-requests:extract",
            tooltip:
              "Extract Pull Requests and associated ticketing system references in a CSV / Excel file",
          },
          {
            id: "project:generate:bypass",
            label: "Generate bypass custom permissions and permission sets",
            command: "sf hardis:project:generate:bypass",
            requiresProject: true,
            tooltip:
              "Generates bypass custom permissions and permission sets for specified sObjects and automations (Flows, Triggers, and Validation Rules)",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/generate/bypass/",
          },
        ],
      },
      {
        id: "data",
        label: "Data Import/Export",
        icon: new vscode.ThemeIcon("database"),
        commands: [
          {
            id: "org:data:export",
            label: "Export data from org with SFDMU",
            tooltip:
              "Export data from org and store it in project files, so it can be imported during each scratch org initialization or deployment to org",
            command: "sf hardis:org:data:export",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/export/",
          },
          {
            id: "org:data:import",
            label: "Import data to org with SFDMU",
            tooltip: "Import data into org from project files",
            command: "sf hardis:org:data:import",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/import/",
          },
          {
            id: "org:data:delete",
            label: "Delete data from org with SFDMU",
            tooltip: "Delete data from org using SFDMU config files",
            command: "sf hardis:org:data:delete",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/delete/",
          },
          {
            id: "org:data:configure",
            label: "Create data import/export configuration",
            tooltip: "Initializes a new SFDMU project",
            command: "sf hardis:org:configure:data",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/configure/data/",
          },
          {
            id: "org:multi-org-query",
            label: "Multi-org SOQL Query & Report",
            tooltip:
              "Executes a SOQL query in multiple orgs and generate a single report from it",
            command: "sf hardis:org:multi-org-query",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/multi-org-query/",
          },
        ],
      },
      {
        id: "files",
        label: "Files Import/Export",
        icon: new vscode.ThemeIcon("files"),
        commands: [
          {
            id: "org:files:export",
            label: "Export files from org",
            tooltip: "Export files from org based on a configuration",
            command: "sf hardis:org:files:export",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/files/export/",
          },
          {
            id: "org:files:import",
            label: "Import files into org",
            tooltip: "Import files into org based on a configuration",
            command: "sf hardis:org:files:import",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/files/import/",
          },
          {
            id: "org:files:configure",
            label: "Create files export configuration",
            tooltip: "Initializes a new file export project",
            command: "sf hardis:org:configure:files",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/configure/files/",
          },
        ],
      },
      {
        id: "debug",
        label: "Debugger",
        commands: [
          {
            id: "hardis:debug:run",
            label: "Run debugger",
            tooltip: "Run debugger on an apex log file",
            command: "vscode-sfdx-hardis.debug.launch",
          },
          {
            id: "hardis:debug:activate",
            label: "Activate debug logs tracing",
            tooltip:
              "Activate tracing of logs to use the local replay debugger",
            command: "vscode-sfdx-hardis.debug.activate",
          },
          {
            id: "hardis:debug:deactivate",
            label: "Deactivate debug logs tracing ",
            tooltip:
              "Deactivate tracing of logs to use the local replay debugger",
            command: "vscode-sfdx-hardis.debug.deactivate",
          },
          {
            id: "org:purge:apexlog",
            label: "Purge Apex Logs",
            tooltip: "Purge all apex logs of default org",
            command: "sf hardis:org:purge:apexlog",
          },
          {
            id: "org:apex:log:tail",
            label: "Display live logs in terminal",
            tooltip: "Display apex logs in console while they are generated",
            command: "vscode-sfdx-hardis.debug.logtail",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_apex_commands_unified.htm#cli_reference_apex_tail_log_unified",
          },
          {
            id: "hardis:debug:importapex",
            label: "Retrieve Apex sources from org",
            tooltip:
              "Retrieve sources from your org so you can use the replay debugger",
            command:
              "sf hardis:org:retrieve:sources:dx -k ApexClass,ApexTrigger,ApexPage",
          },
        ],
      },
      {
        id: "org-operations",
        label: "Org Operations",
        commands: [
          {
            id: "org:user:freeze",
            label: "Freeze users",
            tooltip:
              "Freeze all users of an org except admins to deploy safely",
            command: "sf hardis:org:user:freeze",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/user/freeze/",
          },
          {
            id: "org:user:unfreeze",
            label: "Unfreeze users",
            tooltip: "Unfreeze all users of an org after a safe deployment",
            command: "sf hardis:org:user:unfreeze",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/user/unfreeze/",
          },
          {
            id: "org:purge:flow",
            label: "Purge obsolete flows versions",
            tooltip:
              "Purge all flows with status Obsolete in your org, so you are not bothered by the 50 versions limits",
            command: "sf hardis:org:purge:flow",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/purge/flow/",
          },
          {
            id: "hardis:scratch:delete",
            label: "Delete scratch org(s)",
            tooltip: "Prompts user for scratch orgs to mark for deletion",
            command: "sf hardis:scratch:delete",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/delete/",
          },
          {
            id: "hardis:org:user:activateinvalid",
            label: "Activate .invalid user emails in sandbox",
            tooltip: "Removes the .invalid of all users emails in a sandbox",
            command: "sf hardis:org:user:activateinvalid",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/user/activateinvalid/",
          },
          {
            id: "hardis:org:refresh:before-refresh",
            label: "Sandbox refresh: Before Refresh",
            tooltip:
              "Store info that will be needed after a sandbox refresh (Connected Apps, Custom Settings...)",
            command: "sf hardis:org:refresh:before-refresh",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/refresh/before-refresh/",
          },
          {
            id: "hardis:org:refresh:after-refresh",
            label: "Sandbox refresh: After Refresh",
            tooltip:
              "Restore info after a sandbox refresh (Connected Apps, Custom Settings...)",
            command: "sf hardis:org:refresh:after-refresh",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/refresh/after-refresh/",
          },
        ],
      },
      {
        id: "org-monitoring",
        label: "Org Monitoring",
        commands: [
          {
            id: "hardis:org:monitor:backup",
            label: "Metadatas Backup",
            tooltip: "Retrieves all relevant Metadata of an org according to backup configuration",
            command: "sf hardis:org:monitor:backup",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/",
          },
          {
            id: "hardis:org:diagnose:audittrail",
            label: "Suspicious Audit Trail Activities",
            tooltip:
              "Detect setup actions in major orgs that are identified as Suspicious",
            command: "sf hardis:org:diagnose:audittrail",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/",
          },
          {
            id: "org:test:apex",
            label: "Run Apex tests",
            command: "sf hardis:org:test:apex",
            tooltip:
              "Runs all apex tests on the selected org. Will trigger error if minimum apex code coverage is not reached",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/test/apex/",
          },
          {
            id: "hardis:org:monitor:limits",
            label: "Check Org Limits",
            command: "sf hardis:org:monitor:limits",
            tooltip:
              "Checks if limits are reached or soon reached in the default Salesforce org",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/monitor/limits/",
          },
          {
            id: "hardis:org:diagnose:releaseupdates",
            label: "Check Release Updates",
            command: "sf hardis:org:diagnose:releaseupdates",
            tooltip:
              "Checks if some Release Updates must be verified in the org",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/releaseupdates/",
          },
          {
            id: "org:diagnose:legacyapi",
            label: "Legacy API versions usage",
            tooltip: "Detects if deprected APIs are your in a production org",
            command: "sf hardis:org:diagnose:legacyapi",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/",
          },
          {
            id: "hardis:org:diagnose:unusedusers",
            label: "Unused Users",
            tooltip:
              "Identify active users who haven't logged in recently to the org",
            command: "sf hardis:org:diagnose:unusedusers",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/salesforce-monitoring-inactive-users/",
          },
          {
            id: "hardis:org:diagnose:unusedlicenses",
            label: "Unused PS Licenses (beta)",
            tooltip:
              "Detects if there are unused permission set licenses in the org, and offers to delete them",
            command: "sf hardis:org:diagnose:unusedlicenses",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses/",
          },
          {
            id: "hardis:org:diagnose:unused-apex-classes",
            label: "Unused Apex Classes",
            tooltip:
              "List all async Apex classes (Batch,Queueable,Schedulable) that has not been called for more than 365 days, and could probably be deleted",
            command: "sf hardis:org:diagnose:unused-apex-classes",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-apex-classes/",
          },
          {
            id: "hardis:lint:access",
            label: "Metadata without access",
            tooltip:
              "Detects if custom fields or apex classes are existing in source but not authorized on any Profile or Permission Set",
            command: "sf hardis:lint:access",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/lint/access/",
          },
          {
            id: "hardis:lint:unusedmetadatas",
            label: "Unused Metadatas",
            tooltip:
              "Check if elements (custom labels and custom permissions) are not used in the project",
            command: "sf hardis:lint:unusedmetadatas",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas/",
          },
          {
            id: "hardis:lint:metadatastatus",
            label: "Inactive Metadatas",
            tooltip:
              "Check if flows or validation rules are inactive, so should be deleted",
            command: "sf hardis:lint:metadatastatus",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus/",
          },
          {
            id: "hardis:lint:missingattributes",
            label: "Missing descriptions",
            tooltip: "Check if metadatas have missing descriptions",
            command: "sf hardis:lint:missingattributes",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/missingattributes/",
          },
        ],
      },
      {
        id: "metadata-analysis",
        label: "Metadata Analysis",
        commands: [
          {
            id: "project:audit:duplicatefiles",
            label: "Detect duplicate sfdx files",
            tooltip:
              "Detects if duplicate files are within in your SFDX project",
            command: "sf hardis:project:audit:duplicatefiles",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/duplicatefiles/",
          },
          {
            id: "project:metadata:findduplicates",
            label: "Detect duplicate values in metadata files",
            tooltip:
              "Detects if duplicate values for given keys are within in your SFDX metadata files",
            command:
              "sf hardis:project:metadata:findduplicates -f force-app/**/*.xml",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/metadata/duplicatefiles/",
          },
          {
            id: "project:audit:apiversion",
            label: "Extract API versions of sources",
            tooltip:
              "Browse all project files and summarize API versions of elements",
            command: "sf hardis:project:audit:apiversion",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/apiversion/",
          },
          {
            id: "project:audit:callincallout",
            label: "List call'in and call'outs",
            tooltip: "Browse sources to list inbound and outbound calls",
            command: "sf hardis:project:audit:callincallout",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/callincallout/",
          },
          {
            id: "project:audit:remotesites",
            label: "List remote sites",
            tooltip: "Browse sources to list remote sites",
            command: "sf hardis:project:audit:remotesites",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/remotesites/",
          },
          {
            id: "hardis:misc:custom-label-translations",
            label: "Extract Custom Label Translations",
            tooltip:
              "Extract selected custom labels, or of a given Lightning Web Component (LWC), from all language translation files",
            command: "sf hardis:misc:custom-label-translations",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/misc/custom-label-translations/",
          },
        ],
      },
      {
        id: "setup-config",
        label: "Setup Configuration",
        commands: [
          {
            id: "configure:auth:deployment",
            label: "Configure Org CI authentication",
            tooltip:
              "Assisted configuration to connect a protected branch and its related release org during CI",
            command: "sf hardis:project:configure:auth",
          },
          {
            id: "configure:auth:devhub",
            label: "Configure DevHub CI authentication",

            tooltip:
              "Assisted configuration to connect to a Dev Hub org during CI",
            command: "sf hardis:project:configure:auth --devhub",
            requiresProject: true,
          },
          {
            id: "org:configure:monitoring",
            label: "Configure Org Monitoring",
            tooltip:
              "To run only on a repo dedicated to monitoring (start from a blank repo)",
            command: "sf hardis:org:configure:monitoring",
          },
          {
            id: "scratch:pool:create",
            label: "Configure scratch orgs pool",
            tooltip:
              "Define a scratch org pool to have scratch orgs ready to be used for development or CI",
            command: "sf hardis:scratch:pool:create",
          },
          {
            id: "project:create",
            label: "Create a new SFDX project",
            tooltip: "Create and initialize a new SFDX project",
            command: "sf hardis:project:create",
          },
        ],
      },
      {
        id: "packaging",
        label: "Packaging",
        commands: [
          {
            id: "hardis:package:create",
            label: "Create a new package",
            tooltip: "Second generation packages, unlocked or managed",
            command: "sf hardis:package:create",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:list",
            label: "List package versions",
            tooltip: "List all package versions associated to Dev Hub org",
            command: "sf hardis:package:version:list",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:create",
            label: "Create a new package version",
            tooltip: "Create a new version of a package",
            command: "sf hardis:package:version:create",
            requiresProject: true,
          },
        ],
      },
      {
        id: "doc",
        label: "Documentation Generation",
        commands: [
          {
            id: "hardis:doc:project2markdown",
            label: "Project Documentation",
            command: "sf hardis:doc:project2markdown",
            tooltip:
              "Generates markdown pages with SF Project content: List of metadatas, installed packages...",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/",
          },
          {
            id: "hardis:doc:project2markdown-pdf",
            label: "Project Documentation + PDF",
            command: "sf hardis:doc:project2markdown --pdf",
            tooltip:
              "Generates markdown pages with SF Project content: List of metadatas, installed packages... + PDF files",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/",
          },
          {
            id: "hardis:doc:project2markdown-history",
            label: "Project Documentation (with history)",
            command: "sf hardis:doc:project2markdown --with-history",
            tooltip:
              "Generates markdown pages with SF Project content: List of metadatas, installed packages..., with Flow Diff History",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/",
          },
          {
            id: "hardis-run-doc",
            label: "Run Local HTML Doc Pages",
            command:
              "(pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists && mkdocs serve) || (python -m install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists && python -m mkdocs serve) || (py -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists && py -m mkdocs serve) || (pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists && python -m mkdocs serve -v)",
            tooltip:
              "Run Documentation local web server, then open http://127.0.0.1:8000/ . You need Python on your computer :)",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/salesforce-project-documentation/",
          },
          {
            id: "hardis-upload-doc",
            label: "Upload HTML Doc to Salesforce",
            command: "sf hardis:doc:mkdocs-to-salesforce",
            tooltip:
              "Generates HTML Doc and Uploads it to Salesforce as a static resource with a VfPage & a CustomTab. You need Python on your computer :)",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/mkdocs-to-salesforce/",
          },
          {
            id: "hardis:doc:flow2markdown",
            label: "Flows Documentation",
            command: "sf hardis:doc:flow2markdown",
            tooltip: "Generates Visual Documentation for a Flow",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/flow2markdown/",
          },
          {
            id: "hardis:doc:flow2markdown-pdf",
            label: "Flows Documentation + PDF",
            command: "sf hardis:doc:flow2markdown --pdf",
            tooltip: "Generates Visual Documentation for a Flow + PDF file",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/flow2markdown/",
          },
          {
            id: "hardis:project:generate:flow-git-diff",
            label: "Single Flow Visual Git Diff",
            command: "sf hardis:project:generate:flow-git-diff",
            tooltip:
              "Generates Visual Documentation of the differences between versions of a Flow",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/generate/flow-git-diff/",
          },
          {
            id: "hardis:doc:override-prompts",
            label: "Override Prompt Templates",
            command: "sf hardis:doc:override-prompts",
            tooltip:
              "Override and customize documentation prompt templates for your project",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/override-prompts/",
          },
          {
            id: "hardis:doc:override-prompts-overwrite",
            label: "Override Prompt Templates (Overwrite local)",
            command: "sf hardis:doc:override-prompts --overwrite",
            tooltip:
              "Override and customize documentation prompt templates for your project (Overwrites local files)",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/doc/override-prompts/",
          },
        ],
      },
      {
        id: "nerdy-stuff",
        label: "Nerdy stuff",
        commands: [
          {
            id: "project:generate:gitdelta",
            label: "Generate package.xml git delta",
            tooltip:
              "Generate package.xml & destructiveChanges.xml using git delta between 2 commit hashes",
            command: "sf hardis:project:generate:gitdelta",
          },
          {
            id: "org:generate:packagexmlfull",
            label: "Generate org full package.xml",
            tooltip: "Generate full package.xml from any org",
            command: "sf hardis:org:generate:packagexmlfull",
          },
          {
            id: "org:retrieve:sources:dx2",
            label: "Retrieve DX sources from an org (package.xml)",
            tooltip:
              "Retrieve locally the SFDX sources of an org, using a package.xml",
            command: "sf hardis:org:retrieve:sources:dx2",
          },
          {
            id: "org:retrieve:sources:dx",
            label: "Retrieve ALL DX sources from an org",
            tooltip:
              "Retrieve locally all the metadatas of a remote salesforce org, in DX project format",
            command: "sf hardis:org:retrieve:sources:dx",
          },
          {
            id: "org:retrieve:sources:metadata",
            label: "Retrieve ALL Metadata sources from an org",
            tooltip:
              "Retrieve locally all the metadatas of a remote salesforce org, in metadata format",
            command: "sf hardis:org:retrieve:sources:metadata",
          },
          {
            id: "package:mergexml",
            label: "Merge package.xml files",
            tooltip: "Merge package.xml files located in manifest folder",
            command: "sf hardis:package:mergexml",
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
        label: "Help",
        commands: [
          {
            id: "contact:us",
            label: "Contact us to get help :)",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://cloudity.com/#form",
            )}`,
          },
          {
            id: "help:cicd",
            label: "DevOps - CI/CD Documentation",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/",
            )}`,
          },
          {
            id: "help:org-monitoring",
            label: "Org Monitoring Documentation",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/",
            )}`,
          },
          {
            id: "help:commands",
            label: "All sfdx-hardis commands documentation",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/commands/",
            )}`,
          },
          {
            id: "question",
            label: "Post an issue on GitHub",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://github.com/hardisgroupcom/sfdx-hardis/issues",
            )}`,
          },
          {
            id: "hardis",
            label: "Cloudity Website",
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
