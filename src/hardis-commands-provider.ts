import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class HardisCommandsProvider implements vscode.TreeDataProvider<CommandTreeItem> {
  constructor(private workspaceRoot: string) { }

  getTreeItem(element: CommandTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandTreeItem): Thenable<CommandTreeItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No commands available until you open a Salesforce project');
      return Promise.resolve([]);
    }

    if (element) {
      return Promise.resolve(
        this.getTopicCommands(element)
      );
    } else {
      return Promise.resolve(
        this.listTopics()
      );
    }
  }

  /**
   * List commands related to a topic
   */
  private getTopicCommands(topic: any): CommandTreeItem[] {
    const items: CommandTreeItem[] = [];
    const matchingTopic = this.listTopicAndCommands().filter((topicItem: CommandTreeItem) => topicItem.id === topic.id)[0];
    for (const item of matchingTopic.commands) {
      const options: any = {};
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
      if (item.description) {
        options.description = item.description;
      }
      items.push(new CommandTreeItem(item.label, item.id, item.command, vscode.TreeItemCollapsibleState.None, options));
    }
    return items;
  }

  /**
   * List all topics
   */
  private listTopics(): CommandTreeItem[] {
    const items: CommandTreeItem[] = [];
    for (const item of this.listTopicAndCommands()) {
      const options = { icon: { light: 'user.svg', dark: 'user.svg' }, description: '' };
      if (item.icon) {
        options.icon = { light: item.icon, dark: item.icon };
      }
      if (item.description) {
        options.description = item.description;
      }
      const expanded = (item.defaultExpand) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
      items.push(new CommandTreeItem(item.label, item.id, '', expanded, options));
    }
    return items;
  }

  private listTopicAndCommands(): any {
    const hardisCommands = [
      {
        id: 'work',
        label: 'Work on a task',
        icon: 'user.svg',
        defaultExpand: true,
        commands:
          [
            {
              id: "hardis:work:new",
              label: 'Start a new task',
              command: 'sfdx hardis:work:new',
              icon: 'new.svg',
              description: 'Create a new environment to develop or configure with a scratch org'
            },
            {
              id: "hardis:work:save",
              label: 'Save my current task',
              command: 'sfdx hardis:work:save',
              icon: 'save.svg',
              description: 'Save to server you current work, and propose to create a merge request'
            },
            {
              id: "hardis:work:resetselection",
              label: 'Change the selection of the items I want to save',
              command: 'sfdx hardis:work:resetselection',
              icon: 'reset.svg',
              description: 'If you made a wrong selection of items to publish, you can reset the selection'
            },
            {
              id: "hardis:work:refresh",
              label: 'Refresh git branch & org with newest updates',
              description: 'If your colleagues published their work, makes sure that your work is up to date with their latest developments/configurations',
              command: 'sfdx hardis:work:refresh',
              icon: 'refresh.svg'
            }
          ]
      },
      {
        id: "synchro",
        label: "Synchronization",
        defaultExpand: true,
        commands: [
          {
            id: "scratch:push-from-git-to-org",
            label: 'Push from Git to Salesforce org',
            description: 'Propagates your local updates within Vs Code into your remote Salesforce scratch org',
            command: 'sfdx force:source:push -g -w 60 --forceoverwrite',
            icon: 'push.svg'
          },
          {
            id: "scratch:pull-from-org-to-git",
            label: 'Pull from Salesforce org to Git',
            description: 'Retrieve locally the updates made on the remote Salesforce scratch org',
            command: 'sfdx force:source:pull -w 60 --forceoverwrite',
            icon: 'pull.svg'
          }
        ]
      },
      {
        id: "org",
        label: "Salesforce Org",
        commands: [
          {
            id: "org:open",
            label: 'Open Salesforce org in browser',
            description: 'Opens your currently selected scratch org or other org',
            command: 'sfdx force:org:open',
            icon: 'salesforce.svg'
          },
          {
            id: "org:select",
            label: 'Select a Salesforce org',
            command: 'sfdx hardis:org:select',
            icon: 'select.svg'
          },
          {
            id: "org:select:devhub",
            label: 'Select a Salesforce DevHub',
            command: 'sfdx hardis:org:select --devhub',
            icon: 'select.svg'
          },
          {
            id: "org:logout",
            label: 'Logout from current Org and DevHub',
            command: 'sfdx auth:logout --noprompt || true && sfdx config:unset defaultusername defaultdevhubusername -g && sfdx config:unset defaultusername defaultdevhubusername || true',
            icon: 'logout.svg'
          },
          {
            id: "org:test:apex",
            label: 'Run Apex tests on Salesforce org',
            command: 'sfdx hardis:org:test:apex',
            icon: 'test.svg'
          },
        ]
      },
      {
        id: "config",
        label: "SFDX Hardis Configuration",
        commands: [
          {
            id: "configure:auth:deployment",
            label: 'Configure CI authentication with Org',
            description: 'Assisted configuration to connect a protected branch and its related release org during CI',
            command: 'sfdx hardis:project:configure:auth'
          },
          {
            id: "configure:auth:devhub",
            label: 'Configure CI authentication with DevHub Org',
            command: 'sfdx hardis:project:configure:auth --devhub'
          },
          {
            id: "package:install",
            label: 'Install a package',
            description: 'This will update project .sfdx-hardis.yml so the package will always be installed in new scratch orgs and future deployments',
            command: 'sfdx hardis:package:install'
          },
          {
            id: "data:tree:export",
            label: 'Regenerate scratch org initialisation data',
            command: 'sfdx hardis:data:tree:export'
          },
          {
            id: "org:configure:monitoring",
            label: 'Configure org monitoring',
            description: "To run only on a repo dedicated to monitoring (start from a blank repo)",
            command: 'sfdx hardis:org:configure:monitoring'
          }
        ]
      },
      {
        id: "utils",
        label: "Utils",
        commands: [
          {
            id: "scratch:create",
            label: 'Resume scratch org creation',
            description: 'If during Work:New you had an error, you can resume the scratch org creation',
            command: 'sfdx hardis:scratch:create'
          },
          {
            id: "scratch:create:new",
            label: 'Force creation of a new scratch org',
            description: 'Create a new scratch org for the current work',
            command: 'sfdx hardis:scratch:create --forcenew'
          }
        ]
      }      
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
    public readonly options = { icon: { light: 'salesforce.svg', dark: 'salesforce.svg' }, description: '' }
  ) {
    super(label, collapsibleState);
    this.id = id;
    if (hardisCommand !== '') {
      this.command = {
        title: label,
        command: "vscode-sfdx-hardis.execute-command",
        arguments: [hardisCommand]
      };
      this.hardisCommand = hardisCommand;
      if (options.icon) {
        this.iconPath = options.icon;
        this.iconPath.light = path.join(__filename, '..', '..', 'resources', this.iconPath.light.toString());
        this.iconPath.dark = path.join(__filename, '..', '..', 'resources', this.iconPath.dark.toString());
      }
      if (options.description) {
        this.description = options.description;
        this.tooltip = options.description;
      }
    }
  }
}
