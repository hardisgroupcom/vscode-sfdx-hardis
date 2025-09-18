import * as vscode from "vscode";

export async function runSalesforceCliMcpServer() {
    const installed = await checkAndAddMcpServerConfig();
    if (installed) {
        await vscode.commands.executeCommand("workbench.mcp.listServer", 'Salesforce DX');
    }
}

async function checkAndAddMcpServerConfig(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('mcp');
    const servers = config.get<Record<string, any>>('servers') || {};
    if (!servers['Salesforce DX']) {
        const mcpSalesforceCliConfig = {
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "@salesforce/mcp", "--orgs", "DEFAULT_TARGET_ORG", "--toolsets", "all"]
        };
        const userResponse = await vscode.window.showInformationMessage(
            'MCP server "Salesforce DX" is not configured in your settings. Do you want to add it now?',
            'Yes',
            'No'
        );
        if (userResponse === 'Yes') {
            servers['Salesforce DX'] = mcpSalesforceCliConfig;
            await config.update('servers', servers, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('MCP server "Salesforce DX" has been added to your settings.');
            return true;
        }
        return false;
    }
    return true;
}