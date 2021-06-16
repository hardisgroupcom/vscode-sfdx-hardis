import * as vscode from "vscode";
import * as path from "path";
import { hasSfdxProjectJson } from "./utils";

export class HardisCommandsProvider
  implements vscode.TreeDataProvider<CommandTreeItem>
{
  constructor(private workspaceRoot: string) {}

  getTreeItem(element: CommandTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandTreeItem): Thenable<CommandTreeItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage(
        "No commands available until you open a folder"
      );
      return Promise.resolve([]);
    }
    hasSfdxProjectJson({ recalc: true });
    if (element) {
      return Promise.resolve(this.getTopicCommands(element));
    } else {
      return Promise.resolve(this.listTopics());
    }
  }

  /**
   * List commands related to a topic
   */
  private getTopicCommands(topic: any): CommandTreeItem[] {
    const items: CommandTreeItem[] = [];
    const matchingTopic = this.listTopicAndCommands().filter(
      (topicItem: CommandTreeItem) => topicItem.id === topic.id
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
      items.push(
        new CommandTreeItem(
          item.label,
          item.id,
          item.command,
          vscode.TreeItemCollapsibleState.None,
          options
        )
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
    this._onDidChangeTreeData.fire();
  }

  /**
   * List all topics
   */
  private listTopics(): CommandTreeItem[] {
    const items: CommandTreeItem[] = [];
    for (const item of this.listTopicAndCommands()) {
      const options = {
        icon: { light: "user.svg", dark: "user.svg" },
        description: "",
        tooltip: "",
        requiresProject: false,
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
      const expanded = item.defaultExpand
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      items.push(
        new CommandTreeItem(item.label, item.id, "", expanded, options)
      );
    }
    return items;
  }

  private listTopicAndCommands(): any {
    const hardisCommands = [
      {
        id: "work",
        label: "Work on a task (assisted mode)",
        icon: "user.svg",
        defaultExpand: true,
        commands: [
          {
            id: "hardis:work:new",
            label: "Start a new task",
            command: "sfdx hardis:work:new",
            icon: "new.svg",
            tooltip:
              "Create a new environment to develop or configure with a scratch org",
            requiresProject: true,
          },
          {
            id: "org:open-scratch",
            label: "Open my scratch org in browser",
            tooltip: "Opens your currently selected scratch org or other org",
            command: "sfdx force:org:open",
            icon: "salesforce.svg",
          },
          {
            id: "hardis:work:save",
            label: "Save my current task",
            command: "sfdx hardis:work:save",
            icon: "save.svg",
            tooltip:
              "Save to server you current work, and propose to create a merge request",
            requiresProject: true,
          },
          {
            id: "hardis:work:resetselection",
            label: "Reset list of published items",
            command: "sfdx hardis:work:resetselection",
            icon: "reset.svg",
            tooltip:
              "If you made a wrong selection of items to publish, you can reset the selection and save it again",
            requiresProject: true,
          },
          {
            id: "hardis:work:refresh",
            label: "Refresh git branch & org with newest updates",
            tooltip:
              "If your colleagues published their work, makes sure that your work is up to date with their latest developments/configurations",
            command: "sfdx hardis:work:refresh",
            icon: "refresh.svg",
            requiresProject: true,
          },
        ],
      },
      {
        id: "org",
        label: "Salesforce Org",
        commands: [
          {
            id: "org:open",
            label: "Open Salesforce org in browser",
            tooltip: "Opens your currently selected scratch org or other org",
            command: "sfdx force:org:open",
            icon: "salesforce.svg",
          },
          {
            id: "org:select",
            label: "Select a Salesforce org",
            tooltip:
              "Select an org (scratch or not) that you want your VsCode project to be currently linked to",
            command: "sfdx hardis:org:select",
            icon: "select.svg",
          },
          {
            id: "org:select:devhub",
            label: "Select a Salesforce DevHub",
            tooltip: "Select an org that sfdx-hardis will use as Dev Hub",
            command: "sfdx hardis:org:select --devhub",
            icon: "select.svg",
          },
          {
            id: "org:connect",
            label: "Connect to a Salesforce org",
            tooltip:
              "Connects to a Salesforce org without setting it as defaultusername",
            command: "sfdx hardis:org:connect",
            icon: "select.svg",
          },
          {
            id: "org:logout",
            label: "Logout from current Org and DevHub",
            command:
              "sfdx auth:logout --noprompt || true && sfdx config:unset defaultusername defaultdevhubusername -g && sfdx config:unset defaultusername defaultdevhubusername || true",
            tooltip: "Log out from everything :)",
            icon: "logout.svg",
          },
          {
            id: "package:install",
            label: "Install a package",
            tooltip:
              "This will update project .sfdx-hardis.yml so the package will always be installed in new scratch orgs and future deployments",
            icon: "package.svg",
            command: "sfdx hardis:package:install",
            requiresProject: true,
          },
          {
            id: "org:test:apex",
            label: "Run Apex tests on Salesforce org",
            command: "sfdx hardis:org:test:apex",
            tooltip:
              "Runs all apex tests on the selected org. Will trigger error if minimum apex code coverage is not reached",
            icon: "test.svg",
            requiresProject: true,
          },
          {
            id: "org:password:generate",
            label: "Generate new password",
            command: "sfdx force:user:password:generate",
            tooltip:
              "Generates a new password for your current scratch org user",
            icon: "password.svg",
            requiresProject: true,
          },
        ],
      },
      {
        id: "work-dev",
        label: "Work on a task (expert mode)",
        commands: [
          {
            id: "scratch:create",
            label: "Create scratch org (or resume creation)",
            tooltip:
              "If during Work:New you had an error, you can resume the scratch org creation",
            icon: "salesforce.svg",
            command: "sfdx hardis:scratch:create",
            requiresProject: true,
          },
          {
            id: "scratch:create:new",
            label: "Create scratch org (force new)",
            tooltip: "Create a new scratch org for the current work",
            icon: "salesforce.svg",
            command: "sfdx hardis:scratch:create --forcenew",
            requiresProject: true,
          },
          {
            id: "scratch:push-from-git-to-org",
            label: "Push from Git to Salesforce org",
            tooltip:
              "Propagates your local updates within Vs Code into your remote Salesforce scratch org",
            command: "sfdx hardis:scratch:push",
            icon: "push.svg",
            requiresProject: true,
          },
          {
            id: "scratch:pull-from-org-to-git",
            label: "Pull from Salesforce org to Git",
            tooltip:
              "Retrieve locally the updates made on the remote Salesforce scratch org",
            command: "sfdx hardis:scratch:pull",
            icon: "pull.svg",
            requiresProject: true,
          },
          {
            id: "hardis:work:save-expert",
            label: "Save my current task (no pull and no git)",
            command: "sfdx hardis:work:save --nopull --nogit",
            icon: "save.svg",
            tooltip:
              "Do all the work:save operations except scratch pull and git operations",
            requiresProject: true,
          },
          {
            id: "org:data:export",
            label: "Export scratch org initialisation data",
            tooltip:
              "Export data from org and store it in project files, so it can be loaded during each scratch org initialization",
            icon: "data.svg",
            command: "sfdx hardis:org:data:export",
            requiresProject: true,
          },
          {
            id: "org:data:import",
            label: "Import scratch org initialisation data",
            tooltip: "Import data into org from project files",
            icon: "data.svg",
            command: "sfdx hardis:org:data:import",
            requiresProject: true,
          },
          {
            id: "project:clean:references",
            label: "Clean SFDX project from defined references",
            tooltip:
              "Remove from project the references to items that you don't want to publish",
            icon: "clean.svg",
            command: "sfdx hardis:project:clean:references",
            requiresProject: true,
          },
          {
            id: "project:clean:orgmissingitems",
            label: "Clean SFDX project from references not in org",
            tooltip:
              "Clean SFDX project from references not present in target deployment org",
            icon: "clean.svg",
            command: "sfdx hardis:project:clean:orgmissingitems",
            requiresProject: true,
          },
          {
            id: "project:generate:gitdelta",
            label: "Generate package.xml git delta",
            tooltip:
              "Generate package.xml & destructiveChanges.xml using git delta between 2 commit hashes",
            icon: "git.svg",
            command: "sfdx hardis:project:generate:gitdelta",
            requiresProject: true,
          },
          
          {
            id: "project:deploy:sources:dx:check",
            label: "Simulate SFDX deployment",
            tooltip:
              "Simulates deployment from local SFDX source to target org",
            icon: "test.svg",
            command: "sfdx hardis:project:deploy:sources:dx --check",
            requiresProject: true,
          },
          {
            id: "org:retrieve:sources:dx",
            label: "Retrieve ALL DX sources from an org",
            tooltip:
              "Retrieve locally all the metadatas of a remote salesforce org, in DX project format",
            icon: "pull.svg",
            command: "sfdx hardis:org:retrieve:sources:dx",
          },
          {
            id: "org:retrieve:sources:metadata",
            label: "Retrieve ALL Metadata sources from an org",
            tooltip:
              "Retrieve locally all the metadatas of a remote salesforce org, in metadata format",
            icon: "pull.svg",
            command: "sfdx hardis:org:retrieve:sources:metadata",
          },
          {
            id: "project:create",
            label: "Create a new SFDX project",
            tooltip: "Create and initialize a new SFDX project",
            icon: "new.svg",
            command: "sfdx hardis:project:create",
          },
        ],
      },
      {
        id: "debug",
        label: "Debugger",
        commands: [
          {
            id: "hardis:debug:activate",
            label: "Activate debug logs tracing",
            tooltip:
              "Activate tracing of logs to use the local replay debugger",
            icon: "toggle-on.svg",
            command: "vscode-sfdx-hardis.debug.activate",
            requiresProject: true,
          },
          {
            id: "hardis:debug:run",
            label: "Run debugger",
            tooltip: "Run debugger on an apex log file",
            icon: "debug.svg",
            command: "vscode-sfdx-hardis.debug.launch",
            requiresProject: true,
          },
          {
            id: "hardis:debug:importapex",
            label: "Retrieve Apex sources from org",
            tooltip:
              "Retrieve sources from your org so you can use the replay debugger",
            icon: "pull.svg",
            command:
              "sfdx hardis:org:retrieve:sources:dx -k ApexClass,ApexTrigger,ApexPage",
          },
          {
            id: "hardis:debug:deactivate",
            label: "Deactivate debug logs tracing ",
            tooltip:
              "Deactivate tracing of logs to use the local replay debugger",
            icon: "toggle-off.svg",
            command: "vscode-sfdx-hardis.debug.deactivate",
            requiresProject: true,
          },
          {
            id: "org:purge:apexlog",
            label: "Purge Apex Logs",
            tooltip: "Purge all apex logs of default org",
            icon: "file.svg",
            command: "sfdx hardis:org:purge:apexlog",
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
            id: "configure:auth:deployment",
            label: "Configure Org CI authentication",
            tooltip:
              "Assisted configuration to connect a protected branch and its related release org during CI",
            icon: "configure.svg",
            command: "sfdx hardis:project:configure:auth",
            requiresProject: true,
          },
          {
            id: "configure:auth:devhub",
            label: "Configure DevHub CI authentication",
            icon: "configure.svg",
            tooltip:
              "Assisted configuration to connect to a Dev Hub org during CI",
            command: "sfdx hardis:project:configure:auth --devhub",
            requiresProject: true,
          },
          {
            id: "org:configure:monitoring",
            label: "Configure org monitoring",
            tooltip:
              "To run only on a repo dedicated to monitoring (start from a blank repo)",
            icon: "monitoring.svg",
            command: "sfdx hardis:org:configure:monitoring",
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
            command: "sfdx hardis:package:create",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:list",
            label: "List package versions",
            tooltip: "Create a new versions of a package",
            icon: "package.svg",
            command: "sfdx hardis:package:version:list",
            requiresProject: true,
          },
          {
            id: "hardis:package:version:create",
            label: "Create a new package version",
            tooltip: "Create a new versions of a package",
            icon: "package.svg",
            command: "sfdx hardis:package:version:create",
            requiresProject: true,
          },
        ],
      },
      {
        id: "production",
        label: "Production",
        commands: [
          {
            id: "org:purge:flow",
            label: "Purge obsolete flows",
            tooltip:
              "Purge all flows with status Obsolete in your org, so you are not bothered by the 50 versions limits",
            icon: "flow.svg",
            command: "sfdx hardis:org:purge:flow",
          },
        ],
      },
    ];
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
  }
}
