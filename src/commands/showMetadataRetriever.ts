import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { listAllOrgs } from "../utils/orgUtils";
import { execSfdxJson, execCommand } from "../utils";
import { Logger } from "../logger";
import { listMetadataTypes } from "../utils/metadataList";

export function registerShowMetadataRetriever(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showMetadataRetriever",
    async () => {

      // List all orgs and get default one
      const orgs = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Initializing Metadata Retriever...",
          cancellable: false,
        },
        async () => {
          return await listAllOrgs(false);
        }
      );
      
      // Filter connected orgs and find default from the connected list
      const connectedOrgs = orgs.filter((org) => org.connectedStatus === "Connected");
      const selectedOrg = connectedOrgs.find((org) => org.isDefaultUsername) || connectedOrgs[0];

      // Get metadata types list
      const metadataTypes = listMetadataTypes();
      const metadataTypeOptions = metadataTypes.map(mt => ({
        label: mt.xmlName,
        value: mt.xmlName,
      })).sort((a, b) => a.label.localeCompare(b.label));

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-metadata-retriever",
        {
          orgs: connectedOrgs,
          selectedOrgUsername: selectedOrg?.username || null,
          metadataTypes: metadataTypeOptions,
        },
      );
      panel.updateTitle("Metadata Retriever");

      // Register message handlers
      panel.onMessage(async (type, data) => {
        if (type === "queryMetadata") {
          await handleQueryMetadata(panel, data);
        }
        else if (type === "retrieveMetadata") {
          await handleRetrieveMetadata(panel, data);
        }
        else if (type === "retrieveSelectedMetadata") {
          await handleRetrieveSelectedMetadata(panel, data);
        }
      });
    },
  );
  commands.disposables.push(disposable);
}

async function handleQueryMetadata(panel: any, data: any) {
  try {
    const { username, metadataType, metadataName, lastUpdatedBy } = data;

    if (!username) {
      panel.sendMessage({
        type: "queryError",
        data: { message: "Missing required parameters" },
      });
      return;
    }

    // Build SOQL query safely on backend
    let query = "SELECT MemberName, MemberType, LastModifiedDate, LastModifiedBy.Name FROM SourceMember";
    const conditions: string[] = [];

    if (metadataType) {
      // Escape single quotes for SOQL
      const escapedType = metadataType.replace(/'/g, "\\'");
      conditions.push(`MemberType = '${escapedType}'`);
    }

    if (metadataName) {
      // Escape single quotes and wildcards for SOQL LIKE
      const escapedName = metadataName.replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/_/g, "\\_");
      conditions.push(`MemberName LIKE '%${escapedName}%'`);
    }

    if (lastUpdatedBy) {
      // Escape single quotes and wildcards for SOQL LIKE
      const escapedUser = lastUpdatedBy.replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/_/g, "\\_");
      conditions.push(`LastModifiedBy.Name LIKE '%${escapedUser}%'`);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY MemberType, MemberName DESC LIMIT 2000";

    // Execute SOQL query using Tooling API
    const command = `sf data query --query "${query.replace(/"/g, '\\"')}" --target-org ${username} --use-tooling-api --json`;
    Logger.log(`Executing metadata query: ${command}`);

    const result = await execSfdxJson(command);

    if (result && result.result && result.result.records) {
      panel.sendMessage({
        type: "queryResults",
        data: { records: result.result.records },
      });
    }
    else {
      panel.sendMessage({
        type: "queryResults",
        data: { records: [] },
      });
    }
  }
  catch (error: any) {
    Logger.log(`Error querying metadata: ${error.message}`);
    panel.sendMessage({
      type: "queryError",
      data: { message: error.message || "Failed to query metadata" },
    });
  }
}

async function handleRetrieveSelectedMetadata(panel: any, data: any) {
  try {
    const { username, metadata } = data;

    if (!username || !metadata || !Array.isArray(metadata) || metadata.length === 0) {
      vscode.window.showErrorMessage("Missing required parameters for metadata retrieval");
      return;
    }

    // Build metadata retrieve command
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Build metadata list for command
    const metadataList = metadata.map(m => `${m.memberType}:${m.memberName}`).join(",");
    const command = `sf project retrieve start --metadata ${metadataList} --target-org ${username}`;
    Logger.log(`Retrieving ${metadata.length} metadata items: ${command}`);

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Retrieving ${metadata.length} metadata item(s)`,
        cancellable: false,
      },
      async (_progress) => {
        try {
          await execCommand(command, { cwd: workspaceRoot, output: true });
          vscode.window.showInformationMessage(`Successfully retrieved ${metadata.length} metadata item(s)`);
        }
        catch (error: any) {
          vscode.window.showErrorMessage(`Failed to retrieve metadata: ${error.message}`);
        }
      },
    );
  }
  catch (error: any) {
    Logger.log(`Error retrieving selected metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}

async function handleRetrieveMetadata(panel: any, data: any) {
  try {
    const { username, memberType, memberName } = data;

    if (!username || !memberType || !memberName) {
      vscode.window.showErrorMessage("Missing required parameters for metadata retrieval");
      return;
    }

    // Build metadata retrieve command
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Use sf project retrieve start with metadata flag
    const command = `sf project retrieve start --metadata ${memberType}:${memberName} --target-org ${username}`;
    Logger.log(`Retrieving metadata: ${command}`);

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Retrieving ${memberType}: ${memberName}`,
        cancellable: false,
      },
      async (_progress) => {
        try {
          await execCommand(command, { cwd: workspaceRoot, output: true });
          vscode.window.showInformationMessage(`Successfully retrieved ${memberType}: ${memberName}`);
        }
        catch (error: any) {
          vscode.window.showErrorMessage(`Failed to retrieve metadata: ${error.message}`);
        }
      },
    );
  }
  catch (error: any) {
    Logger.log(`Error retrieving metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}
