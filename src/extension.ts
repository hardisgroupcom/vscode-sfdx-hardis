// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
//import *  from './commands/vscode-sfdx-hardis.execute-command';
import { HardisCommandsProvider } from './hardis-commands-provider';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('VsCode SFDX Hardis has been activated');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const terminalStack: vscode.Terminal[] = [];
	function getLatestTerminal() {
		return terminalStack[terminalStack.length - 1];
	}
	const disposable = vscode.commands.registerCommand('vscode-sfdx-hardis.execute-command', (sfdxHardisCommand: string) => {
		if (terminalStack.length === 0) {
			// Create terminal is necessary
			const newTerminal: vscode.Terminal = (<any>vscode.window).createTerminal(`SFDX Hardis Terminal #${terminalStack.length + 1}`);
			newTerminal.show(false);
			terminalStack.push(newTerminal);
		}
		else {
			// Show & focus terminal
			getLatestTerminal().show(false);
		}
		// Run command on terminal
		getLatestTerminal().sendText(sfdxHardisCommand);
	});
	context.subscriptions.push(disposable);

	// Register Hardis Commands tree data provider
	let currentWorkspaceFolderUri = '.';
	if ((vscode.workspace.workspaceFolders?.length || 0) > 0) {
		currentWorkspaceFolderUri = (vscode.workspace.workspaceFolders || [])[0].uri.path;
	}
	const disposableTree = vscode.window.registerTreeDataProvider(
		'sfdx-hardis-commands',
		new HardisCommandsProvider(currentWorkspaceFolderUri)
	);
	context.subscriptions.push(disposableTree);
}

// this method is called when your extension is deactivated
export function deactivate() { }
