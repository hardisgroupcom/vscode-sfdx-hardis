import * as vscode from "vscode";
import * as path from "path";
import {
  hasSfdxProjectJson,
  loadExternalSfdxHardisConfiguration,
  loadProjectSfdxHardisConfig,
  resetCache,
} from "./utils";

export class HardisCommandsProvider
  implements vscode.TreeDataProvider<CommandTreeItem>
{
  private allTopicsAndCommands: any = null;
  constructor(private workspaceRoot: string) {}

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
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
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

  refresh(): void {
    this.allTopicsAndCommands = null;
    resetCache();
    this._onDidChangeTreeData.fire();
  }

  /**
   * List all topics
   */
  private async listTopics(): Promise<CommandTreeItem[]> {
    const items: CommandTreeItem[] = [];
    for (const item of await this.listTopicAndCommands()) {
      const options = {
        icon: { light: "user.svg", dark: "user.svg" },
        description: "",
        tooltip: "",
        requiresProject: false,
        helpUrl: "",
      };
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
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
      // Create menu or flat element
      if (item.command) {
        items.push(
          new CommandTreeItem(
            item.label,
            item.id,
            item.command,
            vscode.TreeItemCollapsibleState.None,
            options,
          ),
        );
      } else {
        items.push(
          new CommandTreeItem(item.label, item.id, "", expanded, options),
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
        id: "work",
        label: "Work on a task (assisted mode)",
        icon: "user.svg",
        defaultExpand: true,
        commands: [
          {
            id: "hardis:work:new",
            label: "Start a new task",
            command: "sf hardis:work:new",
            icon: "new.svg",
            tooltip:
              "Create a new environment to develop or configure with a scratch org",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/work/new/",
          },
          {
            id: "org:open-scratch",
            label: "Open my org in browser",
            tooltip:
              "Opens your currently selected scratch org or other org in web browser",
            command: "sf org open",
            icon: "salesforce.svg",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_org.htm#cli_reference_force_org_open",
          },
          {
            id: "scratch:pull-from-org-to-git",
            label: "Pull from SF Org to local Git files",
            tooltip:
              "Retrieve locally the updates made on the remote Salesforce scratch or sandbox org",
            command: "sf hardis:scratch:pull",
            icon: "pull.svg",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/pull/",
          },
          {
            id: "hardis:work:save",
            label: "Save / Publish my current task",
            command: "sf hardis:work:save",
            icon: "save.svg",
            tooltip:
              "Save to server you current work, and propose to create a merge request",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/work/save/",
          },
          {
            id: "hardis:work:resetselection",
            label: "Reset selected list of items to merge",
            command: "sf hardis:work:resetselection",
            icon: "reset.svg",
            tooltip:
              "If you made a wrong selection of items to merge, you can reset the selection and save it again",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/work/resetselection/",
          },
        ],
      },
      {
        id: "work-dev",
        label: "Work on a task (expert mode)",
        commands: [
          {
            id: "scratch:push-from-git-to-org",
            label: "Push from local files to Salesforce org",
            tooltip:
              "Propagates your local updates within Vs Code into your remote Salesforce scratch org",
            command: "sf hardis:scratch:push",
            icon: "push.svg",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/push/",
          },
          {
            id: "package:install",
            label: "Install a package",
            tooltip:
              "This will update project .sfdx-hardis.yml so the package will always be installed in new scratch orgs and future deployments",
            icon: "package.svg",
            command: "sf hardis:package:install",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/package/install/",
          },
          {
            id: "project:deploy:sources:dx:check",
            label: "Simulate SFDX deployment",
            tooltip:
              "Simulates deployment from local SFDX source to target org",
            icon: "test-deploy.svg",
            command: "sf hardis:project:deploy:sources:dx --check",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/deploy/sources/dx/",
          },
          {
            id: "project:clean:references",
            label: "Clean SFDX project sources",
            tooltip:
              "Select and apply lots of cleaning commands provided by sfdx-hardis",
            icon: "clean.svg",
            command: "sf hardis:project:clean:references",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/project/clean/references/",
          },
          {
            id: "scratch:create",
            label: "Create scratch org (or resume creation)",
            tooltip:
              "If during Work:New you had an error, you can resume the scratch org creation",
            icon: "salesforce.svg",
            command: "sf hardis:scratch:create",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/create/",
          },
          {
            id: "scratch:create:new",
            label: "Create scratch org (force new)",
            tooltip: "Create a new scratch org for the current work",
            icon: "salesforce.svg",
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
            icon: "password.svg",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_passwd.htm",
          },
          {
            id: "org:connect",
            label: "Connect to a Salesforce org",
            tooltip:
              "Connects to a Salesforce org without setting it as defaultusername",
            command: "sf hardis:org:connect",
            icon: "select.svg",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/connect/",
          },
          {
            id: "source:retrieve",
            label: "Select and retrieve sfdx sources from org",
            tooltip:
              "Allows user to select a list of metadata types and process the retrieve from an org",
            command: "sf hardis:source:retrieve",
            icon: "pull.svg",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/source/retrieve/",
          },
          {
            id: "org:retrieve:sources:analytics",
            label: "Retrieve all CRM analytics sources",
            tooltip:
              "Allows user to select a list of metadata types and process the retrieve from an org",
            command: "sf hardis:org:retrieve:sources:analytics",
            icon: "pull.svg",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/retrieve/sources/analytics/",
          },
          {
            id: "force:source:tracking:clear",
            label: "Clear local sfdx tracking files",
            tooltip:
              "Removes all local information about updates you already pulled from org",
            icon: "trash.svg",
            command: "sf project delete tracking",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_delete_tracking_unified",
          },
          {
            id: "force:source:tracking:reset",
            label: "Clear local and remote sfdx tracking files",
            tooltip:
              "Removes all local and remote information about updates you already pulled from org",
            icon: "warning.svg",
            command: "sf project reset tracking",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_reset_tracking_unified",
          },
          {
            id: "hardis:work:save-expert",
            label: "Save my current task (no source:pull and no git)",
            command: "sf hardis:work:save --nopull --nogit",
            icon: "save.svg",
            tooltip:
              "Do all the work:save operations except scratch pull and git operations",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/work/save/",
          },
        ],
      },
      {
        id: "data",
        label: "Data & files Import/Export",
        commands: [
          {
            id: "org:data:export",
            label: "Export data from org with SFDMU",
            tooltip:
              "Export data from org and store it in project files, so it can be imported during each scratch org initialization or deployment to org",
            icon: "data.svg",
            command: "sf hardis:org:data:export",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/export/",
          },
          {
            id: "org:data:import",
            label: "Import data to org with SFDMU",
            tooltip: "Import data into org from project files",
            icon: "data.svg",
            command: "sf hardis:org:data:import",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/import/",
          },
          {
            id: "org:data:delete",
            label: "Delete data from org with SFDMU",
            tooltip: "Delete data from org using SFDMU config files",
            icon: "trash.svg",
            command: "sf hardis:org:data:delete",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/data/delete/",
          },
          {
            id: "org:data:configure",
            label: "Create data import/export configuration",
            tooltip: "Initializes a new SFDMU project",
            icon: "configure.svg",
            command: "sf hardis:org:configure:data",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/configure/data/",
          },
          {
            id: "org:files:export",
            label: "Export files from org",
            tooltip: "Export files from org based on a configuration",
            icon: "file.svg",
            command: "sf hardis:org:files:export",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/files/export/",
          },
          {
            id: "org:files:import",
            label: "Import files into org",
            tooltip: "Import files into org based on a configuration",
            icon: "file.svg",
            command: "sf hardis:org:files:import",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/files/import/",
          },
          {
            id: "org:files:configure",
            label: "Create files export configuration",
            tooltip: "Initializes a new file export project",
            icon: "configure.svg",
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
            icon: "debug.svg",
            command: "vscode-sfdx-hardis.debug.launch",
          },
          {
            id: "hardis:debug:activate",
            label: "Activate debug logs tracing",
            tooltip:
              "Activate tracing of logs to use the local replay debugger",
            icon: "toggle-on.svg",
            command: "vscode-sfdx-hardis.debug.activate",
          },
          {
            id: "hardis:debug:deactivate",
            label: "Deactivate debug logs tracing ",
            tooltip:
              "Deactivate tracing of logs to use the local replay debugger",
            icon: "toggle-off.svg",
            command: "vscode-sfdx-hardis.debug.deactivate",
          },
          {
            id: "org:purge:apexlog",
            label: "Purge Apex Logs",
            tooltip: "Purge all apex logs of default org",
            icon: "file.svg",
            command: "sf hardis:org:purge:apexlog",
          },
          {
            id: "org:apex:log:tail",
            label: "Display live logs in terminal",
            tooltip: "Display apex logs in console while they are generated",
            icon: "log.svg",
            command: "vscode-sfdx-hardis.debug.logtail",
            helpUrl:
              "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_apex.htm#cli_reference_force_apex_log_tail",
          },
          {
            id: "hardis:debug:importapex",
            label: "Retrieve Apex sources from org",
            tooltip:
              "Retrieve sources from your org so you can use the replay debugger",
            icon: "pull.svg",
            command:
              "sf hardis:org:retrieve:sources:dx -k ApexClass,ApexTrigger,ApexPage",
          },
        ],
      },
      {
        id: "operations",
        label: "Operations",
        commands: [
          {
            id: "org:user:freeze",
            label: "Freeze users",
            tooltip:
              "Freeze all users of an org except admins to deploy safely",
            icon: "freeze.svg",
            command: "sf hardis:org:user:freeze",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/user/freeze/",
          },
          {
            id: "org:user:unfreeze",
            label: "Unfreeze users",
            tooltip: "Unfreeze all users of an org after a safe deployment",
            icon: "unfreeze.svg",
            command: "sf hardis:org:user:unfreeze",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/user/unfreeze/",
          },
          {
            id: "org:purge:flow",
            label: "Purge obsolete flows versions",
            tooltip:
              "Purge all flows with status Obsolete in your org, so you are not bothered by the 50 versions limits",
            icon: "flow.svg",
            command: "sf hardis:org:purge:flow",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/purge/flow/",
          },
          {
            id: "hardis:scratch:delete",
            label: "Delete scratch org(s)",
            tooltip: "Prompts user for scratch orgs to mark for deletion",
            icon: "trash.svg",
            command: "sf hardis:scratch:delete",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/scratch/delete/",
          },
          {
            id: "hardis:org:user:activateinvalid",
            label: "Activate .invalid user emails in sandbox",
            tooltip: "Removes the .invalid of all users emails in a sandbox",
            icon: "user.svg",
            command: "sf hardis:org:user:activateinvalid",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/user/activateinvalid/",
          },
        ],
      },
      {
        id: "monitoring",
        label: "Monitoring",
        commands: [
          {
            id: "hardis:org:monitor:backup",
            label: "Retrieve all metadatas",
            tooltip: "Retrieves all relevant Metadata of an org",
            icon: "backup.svg",
            command: "sf hardis:org:monitor:backup",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/",
          },
          {
            id: "hardis:org:diagnose:audittrail",
            label: "Suspicious Audit Trail Activities",
            tooltip:
              "Detect setup actions in major orgs that are identified as Suspicious",
            icon: "monitoring.svg",
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
            icon: "test.svg",
            requiresProject: true,
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/org/test/apex/",
          },
          {
            id: "hardis:org:monitor:limits",
            label: "Check Org Limits",
            command: "sf hardis:org:monitor:limits",
            tooltip:
              "Checks if limits are reached or soon reached in the default Salesforce org",
            icon: "gauge.svg",
            requiresProject: true,
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/monitor/limits/",
          },
          {
            id: "org:diagnose:legacyapi",
            label: "Legacy API versions usage",
            tooltip: "Detects if deprected APIs are your in a production org",
            icon: "old.svg",
            command: "sf hardis:org:diagnose:legacyapi",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/",
          },
          {
            id: "hardis:org:diagnose:unusedusers",
            label: "Unused Users",
            tooltip:
              "Identify active users who haven't logged in recently to the org",
            icon: "dollar.svg",
            command: "sf hardis:org:diagnose:unusedusers",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/salesforce-monitoring-inactive-users/",
          },
          {
            id: "hardis:org:diagnose:unusedlicenses",
            label: "Unused PS Licenses (beta)",
            tooltip:
              "Detects if there are unused permission set licenses in the org, and offers to delete them",
            icon: "dollar.svg",
            command: "sf hardis:org:diagnose:unusedlicenses",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses/",
          },
          {
            id: "hardis:lint:access",
            label: "Metadata without access",
            tooltip:
              "Detects if custom fields or apex classes are existing in source but not authorized on any Profile or Permission Set",
            icon: "password.svg",
            command: "sf hardis:lint:access",
            helpUrl: "https://sfdx-hardis.cloudity.com/hardis/lint/access/",
          },
          {
            id: "hardis:lint:unusedmetadatas",
            label: "Unused Metadatas",
            tooltip:
              "Check if elements (custom labels and custom permissions) are used in the project",
            icon: "trash.svg",
            command: "sf hardis:lint:unusedmetadatas",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas/",
          },
          {
            id: "hardis:lint:metadatastatus",
            label: "Inactive Metadatas",
            tooltip:
              "Check if flows or validation rules are inactive, so should be deleted",
            icon: "trash.svg",
            command: "sf hardis:lint:metadatastatus",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus/",
          },
          {
            id: "hardis:lint:missingattributes",
            label: "Missing descriptions",
            tooltip: "Check if metadatas have missing descriptions",
            icon: "doc.svg",
            command: "sf hardis:lint:missingattributes",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/lint/missingattributes/",
          },
        ],
      },
      {
        id: "audit",
        label: "Audit",
        commands: [
          {
            id: "project:audit:duplicatefiles",
            label: "Detect duplicate sfdx files",
            tooltip:
              "Detects if duplicate files are within in your SFDX project",
            icon: "duplicate.svg",
            command: "sf hardis:project:audit:duplicatefiles",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/duplicatefiles/",
          },
          {
            id: "project:metadata:findduplicates",
            label: "Detect duplicate values in metadata files",
            tooltip:
              "Detects if duplicate values for given keys are within in your SFDX metadata files",
            icon: "duplicate.svg",
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
            icon: "extract.svg",
            command: "sf hardis:project:audit:apiversion",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/apiversion/",
          },
          {
            id: "project:audit:callincallout",
            label: "List call'in and call'outs",
            tooltip: "Browse sources to list inbound and outbound calls",
            icon: "http.svg",
            command: "sf hardis:project:audit:callincallout",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/callincallout/",
          },
          {
            id: "project:audit:remotesites",
            label: "List remote sites",
            tooltip: "Browse sources to list remote sites",
            icon: "remote.svg",
            command: "sf hardis:project:audit:remotesites",
            helpUrl:
              "https://sfdx-hardis.cloudity.com/hardis/audit/remotesites/",
          },
        ],
      },
      {
        id: "config-commands",
        label: "Configuration",
        commands: [
          {
            id: "open-key-file",
            label: "Open config file",
            tooltip: "Shortcut to main configuration files",
            icon: "file.svg",
            command: "vscode-sfdx-hardis.openKeyFile",
          },
          {
            id: "org:retrieve:packageconfig",
            label: "Retrieve packages configuration from org",
            tooltip:
              "Retrieve package configuration from an org and propose to update project sfdx-hardis configuration",
            icon: "package.svg",
            command: "sf hardis:org:retrieve:packageconfig",
          },
          {
            id: "configure:auth:deployment",
            label: "Configure Org CI authentication",
            tooltip:
              "Assisted configuration to connect a protected branch and its related release org during CI",
            icon: "configure.svg",
            command: "sf hardis:project:configure:auth",
          },
          {
            id: "configure:auth:devhub",
            label: "Configure DevHub CI authentication",
            icon: "configure.svg",
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
            icon: "monitoring.svg",
            command: "sf hardis:org:configure:monitoring",
          },
          {
            id: "scratch:pool:create",
            label: "Configure scratch orgs pool",
            tooltip:
              "Define a scratch org pool to have scratch orgs ready to be used for development or CI",
            icon: "pool.svg",
            command: "sf hardis:scratch:pool:create",
          },
          {
            id: "project:create",
            label: "Create a new SFDX project",
            tooltip: "Create and initialize a new SFDX project",
            icon: "new.svg",
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
            icon: "package.svg",
            command: "sf hardis:package:create",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:list",
            label: "List package versions",
            tooltip: "List all package versions associated to Dev Hub org",
            icon: "package.svg",
            command: "sf hardis:package:version:list",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:create",
            label: "Create a new package version",
            tooltip: "Create a new version of a package",
            icon: "package.svg",
            command: "sf hardis:package:version:create",
            requiresProject: true,
          },
        ],
      },
      {
        id: "nerdy_stuff",
        label: "Nerdy stuff",
        commands: [
          {
            id: "project:generate:gitdelta",
            label: "Generate package.xml git delta",
            tooltip:
              "Generate package.xml & destructiveChanges.xml using git delta between 2 commit hashes",
            icon: "git.svg",
            command: "sf hardis:project:generate:gitdelta",
          },
          {
            id: "org:generate:packagexmlfull",
            label: "Generate org full package.xml",
            tooltip: "Generate full package.xml from any org",
            icon: "package.svg",
            command: "sf hardis:org:generate:packagexmlfull",
          },
          {
            id: "org:retrieve:sources:dx2",
            label: "Retrieve DX sources from an org (package.xml)",
            tooltip:
              "Retrieve locally the SFDX sources of an org, using a package.xml",
            icon: "pull.svg",
            command: "sf hardis:org:retrieve:sources:dx2",
          },
          {
            id: "org:retrieve:sources:dx",
            label: "Retrieve ALL DX sources from an org",
            tooltip:
              "Retrieve locally all the metadatas of a remote salesforce org, in DX project format",
            icon: "pull.svg",
            command: "sf hardis:org:retrieve:sources:dx",
          },
          {
            id: "org:retrieve:sources:metadata",
            label: "Retrieve ALL Metadata sources from an org",
            tooltip:
              "Retrieve locally all the metadatas of a remote salesforce org, in metadata format",
            icon: "pull.svg",
            command: "sf hardis:org:retrieve:sources:metadata",
          },
          {
            id: "package:mergexml",
            label: "Merge package.xml files",
            tooltip: "Merge package.xml files located in manifest folder",
            icon: "merge.svg",
            command: "sf hardis:package:mergexml",
          },
          {
            id: "org:logout",
            label: "Logout from current Org and DevHub",
            command:
              "sf org logout --noprompt || true && sf config:unset target-org target-dev-hub -g && sf config:unset target-org target-dev-hub || true",
            tooltip: "Log out from orgs :)",
            icon: "logout.svg",
            helpText: "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_org_commands_unified.htm#cli_reference_org_logout_unified"
          },
          {
            id: "git:login",
            label: "Login again to git",
            command:
              "echo 'If you see and error, execute the same commands in PowerShell run as administrator' && git config --system --unset credential.helper && git config credential.helper store && git fetch",
            tooltip: "Use this command in case you have git login errors",
            icon: "git.svg",
          },
        ],
      },
      {
        id: "help",
        label: "Help",
        commands: [
          {
            id: "contact:us",
            label: "Contact Us",
            icon: "help.svg",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://cloudity.com/#form",
            )}`,
          },
          {
            id: "help:commands",
            label: "All sfdx-hardis commands",
            icon: "help.svg",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/commands/",
            )}`,
          },
          {
            id: "help:cicd",
            label: "DevOps - CI/CD",
            icon: "help.svg",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/",
            )}`,
          },
          {
            id: "question",
            label: "Post an issue on GitHub",
            icon: "help.svg",
            command: `vscode-sfdx-hardis.openExternal ${vscode.Uri.parse(
              "https://github.com/hardisgroupcom/sfdx-hardis/issues",
            )}`,
          },
          {
            id: "hardis",
            label: "Cloudity Website",
            icon: "help.svg",
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
    public readonly options = {
      icon: { light: "salesforce.svg", dark: "salesforce.svg" },
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
          this.iconPath.light.toString(),
        );
        this.iconPath.dark = path.join(
          __filename,
          "..",
          "..",
          "resources",
          this.iconPath.dark.toString(),
        );
      }
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
