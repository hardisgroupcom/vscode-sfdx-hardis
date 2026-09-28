import * as vscode from "vscode";
import * as path from "path";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { listAllOrgs } from "../utils/orgUtils";
import {
  execSfdxJson,
  getDefaultTargetOrgUsername,
  getWorkspaceRoot,
} from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { executeMetadataRetrieve } from "./showMetadataRetriever";

// What the panel looks for: a type and an API name, a Salesforce Id, or a local source file
export interface MetadataDependenciesQuery {
  type?: string;
  name?: string;
  id?: string;
  sourceFile?: string;
}

interface MetadataDependenciesArgs extends MetadataDependenciesQuery {
  username?: string;
}

// Command line values are always quoted, with inner double quotes escaped
function quote(value: string): string {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

// The CLI is the engine: the panel only passes flags to sf hardis:doc:metadata-deps
export function buildMetadataDepsCommand(
  query: MetadataDependenciesQuery,
  username: string | null,
  options: { skipReport: boolean },
): string {
  const flags: string[] = [];
  if (query.sourceFile) {
    flags.push(`--source-file ${quote(query.sourceFile)}`);
  } else {
    if (query.type) {
      flags.push(`--type ${quote(query.type)}`);
    }
    if (query.id) {
      flags.push(`--id ${quote(query.id)}`);
    } else if (query.name) {
      flags.push(`--name ${quote(query.name)}`);
    }
  }
  if (username) {
    flags.push(`--target-org ${quote(username)}`);
  }
  flags.push("--agent");
  if (options.skipReport) {
    flags.push("--skip-report");
  }
  return `sf hardis:doc:metadata-deps ${flags.join(" ")}`;
}

async function runMetadataDeps(
  query: MetadataDependenciesQuery,
  username: string | null,
  skipReport: boolean,
): Promise<{ result?: any; error?: string }> {
  const command = buildMetadataDepsCommand(query, username, { skipReport });
  try {
    // Dependencies are read live: never reuse a previous answer
    const response = await execSfdxJson(command, {
      cwd: getWorkspaceRoot(),
      fail: false,
      output: false,
      reuseRecentResult: false,
    });
    if (response?.status === 0 && response?.result) {
      return { result: response.result };
    }
    return { error: response?.message || t("metadataDependenciesError") };
  } catch (error: any) {
    return { error: error?.message || String(error) };
  }
}

async function listConnectedOrgs(): Promise<any[]> {
  try {
    const orgs = await listAllOrgs(false);
    return orgs.filter(
      (org: any) =>
        org.connectedStatus === "Connected" || org.status === "Active",
    );
  } catch (error: any) {
    Logger.log(`Error listing orgs: ${error?.message || error}`);
    return [];
  }
}

// Only files inside the workspace are opened
function resolveWorkspaceFile(relativeOrAbsolutePath: string): string | null {
  const root = getWorkspaceRoot();
  const filePath = path.resolve(root, relativeOrAbsolutePath);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

async function openInSetup(username: string, setupPath: string) {
  const response = await execSfdxJson(
    `sf org open --target-org ${quote(username)} --path ${quote(setupPath)} --url-only`,
    { fail: false, output: false, reuseRecentResult: false },
  );
  const url = response?.result?.url;
  if (!url) {
    vscode.window.showErrorMessage(
      response?.message || t("metadataDependenciesOpenSetupError"),
    );
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

// Retrieved files of a sf project retrieve result, relative to the workspace
function retrievedFiles(
  retrieveResult: any,
): Array<{ type: string; fullName: string; filePath: string }> {
  const files = Array.isArray(retrieveResult?.result?.files)
    ? retrieveResult.result.files
    : [];
  const root = getWorkspaceRoot();
  return files
    .filter((file: any) => file?.state !== "Failed" && file?.filePath)
    .map((file: any) => ({
      type: String(file.type || ""),
      fullName: String(file.fullName || ""),
      filePath: path.relative(root, file.filePath).replace(/\\/g, "/"),
    }));
}

export function registerShowMetadataDependencies(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showMetadataDependencies",
    async (args?: MetadataDependenciesArgs) => {
      const query: MetadataDependenciesQuery | null =
        args && (args.type || args.name || args.id || args.sourceFile)
          ? {
              type: args.type,
              name: args.name,
              id: args.id,
              sourceFile: args.sourceFile,
            }
          : null;
      const username =
        args?.username ||
        (await getDefaultTargetOrgUsername().catch(() => null)) ||
        null;

      // The panel opens at once; the LWC asks for the dependencies when it has a query
      const panel: LwcUiPanel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-metadata-dependencies",
        { query, username, orgs: [] },
      );
      panel.updateTitle(t("metadataDependencies"));

      panel.onMessage(async (type: string, data: any) => {
        if (type === "listOrgs") {
          panel.sendMessage({
            type: "listOrgsResults",
            data: { orgs: await listConnectedOrgs() },
          });
        } else if (type === "findDependencies") {
          const { result, error } = await runMetadataDeps(
            data?.query || {},
            data?.username || null,
            true,
          );
          panel.sendMessage({
            type: error ? "dependenciesError" : "dependenciesResult",
            data: { requestId: data?.requestId, result, error },
          });
        } else if (type === "generateReport") {
          const { result, error } = await runMetadataDeps(
            data?.query || {},
            data?.username || null,
            false,
          );
          panel.sendMessage({
            type: error ? "reportError" : "reportGenerated",
            data: { reportFiles: result?.reportFiles || [], error },
          });
        } else if (type === "openLocalFile") {
          const filePath = resolveWorkspaceFile(data?.path || "");
          if (filePath) {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document, { preview: false });
          }
        } else if (type === "openReportFile") {
          if (data?.path) {
            await vscode.env.openExternal(vscode.Uri.file(data.path));
          }
        } else if (type === "openInSetup") {
          if (data?.username && data?.path) {
            await openInSetup(data.username, data.path);
          }
        } else if (type === "retrieveComponents") {
          const components = Array.isArray(data?.components)
            ? data.components
            : [];
          if (!data?.username || components.length === 0) {
            return;
          }
          const retrieveResult = await executeMetadataRetrieve(
            data.username,
            components,
            t("metadataDependenciesRetrieving", { count: components.length }),
            panel,
          );
          // The retrieved files update the "In this project" column: no new org call
          panel.sendMessage({
            type: "retrieveDone",
            data: { files: retrievedFiles(retrieveResult) },
          });
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
