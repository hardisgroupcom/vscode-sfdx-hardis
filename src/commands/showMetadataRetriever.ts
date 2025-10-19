import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { listAllOrgs } from "../utils/orgUtils";
import { execSfdxJson } from "../utils";
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

async function executeMetadataRetrieve(
  username: string,
  metadataList: string,
  workspaceRoot: string,
  displayTitle: string,
): Promise<void> {
  // Split metadata list and create separate --metadata flags for each item
  const metadataItems = metadataList.split(',').map(item => `--metadata "${item}"`).join(' ');
  const command = `sf project retrieve start ${metadataItems} --target-org ${username} --json`;
  Logger.log(`Retrieving metadata: ${command}`);

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: displayTitle,
        cancellable: false,
      },
      async (_progress) => {
        return await execSfdxJson(command, { cwd: workspaceRoot });
      },
    );

    // Check if command executed and has result
    if (result && result.result) {
      const retrieveResult = result.result;
      const success = retrieveResult.success === true;
      const files = retrieveResult.files || [];
      const messages = retrieveResult.messages || [];

      // Count successful and failed files
      const successfulFiles = files.filter((f: any) => f.state !== "Failed");
      const failedFiles = files.filter((f: any) => f.state === "Failed");

      // Build result message
      let resultMessage = "";
      if (successfulFiles.length > 0) {
        resultMessage += `Successfully retrieved ${successfulFiles.length} file(s)`;
      }

      // Display success or warning
      if (failedFiles.length === 0 && success) {
        const action = await vscode.window.showInformationMessage(
          resultMessage || "Metadata retrieved successfully",
          "View and commit files"
        );
        if (action === "View and commit files") {
          vscode.commands.executeCommand("workbench.view.scm");
        }
      }
      else {
        // Show warning with details
        if (successfulFiles.length > 0) {
          resultMessage += `, but ${failedFiles.length} failed`;
        }
        else {
          resultMessage = `Failed to retrieve ${failedFiles.length} file(s)`;
        }
        
        // Collect error details for display
        const errorDetails: string[] = [];
        if (messages.length > 0) {
          messages.forEach((msg: any) => {
            const error = `${msg.fileName}: ${msg.problem}`;
            errorDetails.push(error);
            Logger.log(`Retrieve error - ${error}`);
          });
        }
        failedFiles.forEach((file: any) => {
          const error = `${file.type}: ${file.fullName} - ${file.error}`;
          errorDetails.push(error);
          Logger.log(`Failed to retrieve ${error}`);
        });
        
        // Display warning with first few errors in message
        if (errorDetails.length > 0) {
          const displayErrors = errorDetails.slice(0, 3).join("; ");
          const moreErrors = errorDetails.length > 3 ? ` (and ${errorDetails.length - 3} more - see logs)` : "";
          vscode.window.showWarningMessage(`${resultMessage}. Errors: ${displayErrors}${moreErrors}`);
        }
        else {
          vscode.window.showWarningMessage(resultMessage);
        }
      }
    }
    else {
      const errorMsg = result?.message || "Unknown error occurred";
      vscode.window.showErrorMessage(`Failed to retrieve metadata: ${errorMsg}`);
    }
  }
  catch (error: any) {
    Logger.log(`Error retrieving metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Failed to retrieve metadata: ${error.message}`);
  }
}

async function handleQueryMetadata(panel: any, data: any) {
  try {
    const { username, metadataType, metadataName, lastUpdatedBy, dateFrom, dateTo } = data;

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

    // Add date range filters if provided
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      if (!isNaN(fromDate.getTime())) {
        conditions.push(`LastModifiedDate >= ${fromDate.toISOString()}`);
      }
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      if (!isNaN(toDate.getTime())) {
        // Set to end of day
        toDate.setHours(23, 59, 59, 999);
        conditions.push(`LastModifiedDate <= ${toDate.toISOString()}`);
      }
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
    
    await executeMetadataRetrieve(
      username,
      metadataList,
      workspaceRoot,
      `Retrieving ${metadata.length} metadata item(s)`,
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

    // Build metadata list for command
    const metadataList = `${memberType}:${memberName}`;
    
    await executeMetadataRetrieve(
      username,
      metadataList,
      workspaceRoot,
      `Retrieving ${memberType}: ${memberName}`,
    );
  }
  catch (error: any) {
    Logger.log(`Error retrieving metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}
