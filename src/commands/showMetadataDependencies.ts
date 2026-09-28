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
import { getMetadataTypes } from "../utils/metadataTypes";

// What the panel looks for: a type and an API name, a Salesforce Id, or a local source file
export interface MetadataDependenciesQuery {
  type?: string;
  name?: string;
  id?: string;
  sourceFile?: string;
  // used-by (default): what uses the component; uses: what the component uses
  direction?: "used-by" | "uses";
}

interface MetadataDependenciesArgs extends MetadataDependenciesQuery {
  username?: string;
}

// Command line values are always quoted for the shell that runs the command: double quotes for
// cmd.exe on Windows, single quotes elsewhere, because /bin/sh expands $ and backticks inside double
// quotes (a Report folder named unfiled$public would become "unfiled")
export function quote(
  value: string,
  platform: string = process.platform,
): string {
  if (platform === "win32") {
    return `"${String(value).replace(/"/g, '\\"')}"`;
  }
  return `'${String(value).replace(/'/g, "'\\''")}'`;
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
  if (query.direction === "uses") {
    flags.push("--direction uses");
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

// Names of a metadata type in the org, for the suggestions of the name field. Low priority:
// it never delays a dependency search, and the panel stays usable while it runs.
async function listMetadataNames(
  username: string,
  type: string,
  folder: string | null,
): Promise<{ kind: string; items: any[]; listable: boolean; error?: string }> {
  const folderFlag = folder ? ` --folder ${quote(folder)}` : "";
  try {
    const response = await execSfdxJson(
      `sf hardis:org:list:metadata --type ${quote(type)}${folderFlag} --target-org ${quote(username)} --agent`,
      {
        cwd: getWorkspaceRoot(),
        fail: false,
        output: false,
        lowPriority: true,
      },
    );
    if (response?.status === 0 && response?.result) {
      return {
        kind: response.result.kind || "components",
        items: Array.isArray(response.result.items)
          ? response.result.items
          : [],
        listable: response.result.listable !== false,
      };
    }
    return {
      kind: "components",
      items: [],
      listable: false,
      error: response?.message,
    };
  } catch (error: any) {
    return {
      kind: "components",
      items: [],
      listable: false,
      error: error?.message || String(error),
    };
  }
}

// Every Metadata API type bundled in the extension, for the type field: no org call
function metadataTypeNames(): string[] {
  return [
    ...new Set(
      getMetadataTypes()
        .map((metadataType: any) => metadataType?.xmlName)
        .filter((name: any) => typeof name === "string" && name !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b));
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

async function openInSetup(
  username: string,
  setupPath: string,
  componentName: string,
) {
  // Getting the URL of the page takes a few seconds: tell the user it is on its way
  const response = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("openingInSetup", { name: componentName || setupPath }),
      cancellable: false,
    },
    () =>
      execSfdxJson(
        `sf org open --target-org ${quote(username)} --path ${quote(setupPath)} --url-only`,
        { fail: false, output: false, reuseRecentResult: false },
      ),
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
              direction: args.direction,
            }
          : null;
      const username =
        args?.username ||
        (await getDefaultTargetOrgUsername().catch(() => null)) ||
        null;

      // The panel opens at once; the LWC asks for the dependencies when it has a query
      const panel: LwcUiPanel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-metadata-dependencies",
        { query, username, orgs: [], metadataTypes: metadataTypeNames() },
      );
      panel.updateTitle(t("metadataDependencies"));

      panel.onMessage(async (type: string, data: any) => {
        if (type === "listOrgs") {
          panel.sendMessage({
            type: "listOrgsResults",
            data: { orgs: await listConnectedOrgs() },
          });
        } else if (type === "listNames") {
          if (!data?.username || !data?.type) {
            return;
          }
          const names = await listMetadataNames(
            data.username,
            data.type,
            data.folder || null,
          );
          panel.sendMessage({
            type: "namesResult",
            data: { requestKey: data.requestKey, ...names },
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
            await openInSetup(data.username, data.path, data.name || "");
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
