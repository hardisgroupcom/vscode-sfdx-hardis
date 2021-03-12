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
      const options = { icon: { light: 'user.svg', dark: 'user.svg' }, description: '' }
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
            command: 'sfdx force:source:push -g -w 60 --forceoverwrite'
          },
          {
            id: "scratch:pull-from-org-to-git",
            label: 'Pull from Salesforce org to Git',
            command: 'sfdx force:source:pull -w 60 --forceoverwrite'
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
            command: 'sfdx force:org:ope'
          },
          {
            id: "org:select",
            label: 'Select a Salesforce org',
            command: 'sfdx hardis:org:select'
          },
          {
            id: "org:logout",
            label: 'Logout from current Org and DevHub',
            command: 'sfdx auth:logout --noprompt || true && sfdx config:unset defaultusername defaultdevhubusername -g && sfdx config:unset defaultusername defaultdevhubusername || true'
          },
          {
            id: "org:test:apex",
            label: 'Run Apex tests on Salesforce org',
            command: 'sfdx hardis:org:test:apex'
          },
        ]
      },
      {
        id: "config",
        label: "SFDX Hardis Configuration",
        commands: [
          {
            id: "configure:auth:deployment",
            label: 'Configure authentication with Org',
            command: 'sfdx hardis:project:configure:auth'
          },
          {
            id: "configure:auth:devhub",
            label: 'Configure authentication with Org',
            command: 'sfdx hardis:project:configure:auth --devhub'
          },
          {
            id: "package:install",
            label: 'Install a package',
            command: 'sfdx hardis:package:install'
          },
          {
            id: "data:tree:export",
            label: 'Regenerate scratch org initialisation data',
            command: 'sfdx hardis:data:tree:export'
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
            command: 'sfdx hardis:scratch:create'
          },
          {
            id: "scratch:create:new",
            label: 'Force creation of a new scratch org',
            command: 'sfdx hardis:scratch:create --forcenew'
          },
          {
            id: "org:configure:monitoring",
            label: 'Configure org monitoring',
            command: 'sfdx hardis:org:configure:monitoring'
          }
        ]
      }      
    ];
    return hardisCommands
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
