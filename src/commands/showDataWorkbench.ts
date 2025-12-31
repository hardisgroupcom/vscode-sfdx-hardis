import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { getWorkspaceRoot, openFolderInExplorer } from "../utils";
import * as fs from "fs-extra";
import path from "path";
import { Logger } from "../logger";

type SfdmuObjectConfig = {
  query: string;
  operation?: string;
  externalId?: string;
  deleteOldData?: boolean;
  useQueryAll?: boolean;
  allOrNone?: boolean;
  batchSize?: number | string;
  [key: string]: any;
};

type DataWorkspace = {
  name: string;
  path: string;
  configPath: string;
  label: string;
  description: string;
  objects: SfdmuObjectConfig[];
  objectsCount: number;
};

export function registerShowDataWorkbench(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showDataWorkbench",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      const workspaces = await loadDataWorkspaces();

      const panel = lwcManager.getOrCreatePanel("s-data-workbench", {
        workspaces: workspaces,
      });

      panel.onMessage(async (type: string, data: any) => {
        // Built-in messages (runCommand, openFile, runVsCodeCommand, etc.)
        // are handled by the LwcUiPanel router. Only workspace-specific
        // actions are processed here.
        switch (type) {
          case "loadWorkspaces": {
            const updatedWorkspaces = await loadDataWorkspaces();
            panel.sendMessage({
              type: "workspacesLoaded",
              data: { workspaces: updatedWorkspaces },
            });
            break;
          }

          case "createWorkspace": {
            try {
              const createdPath = await createDataWorkspace(data);
              panel.sendMessage({
                type: "workspaceCreated",
                data: { path: createdPath },
              });
            } catch (e: any) {
              const message = e?.message || e;
              Logger.log(`Failed to create data workspace: ${message}`);
              vscode.window.showErrorMessage(
                `Failed to create workspace: ${message}`,
              );
              panel.sendMessage({
                type: "workspaceCreateFailed",
                data: { message },
              });
            }
            break;
          }

          case "updateWorkspace": {
            try {
              await updateDataWorkspace(data);
              panel.sendMessage({
                type: "workspaceUpdated",
                data: {},
              });
            } catch (e: any) {
              const message = e?.message || e;
              Logger.log(`Failed to update data workspace: ${message}`);
              vscode.window.showErrorMessage(
                `Failed to update workspace: ${message}`,
              );
              panel.sendMessage({
                type: "workspaceUpdateFailed",
                data: { message },
              });
            }
            break;
          }

          case "deleteWorkspace": {
            try {
              const label = data?.label || data?.path || "this workspace";
              const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to delete the workspace "${label}"? This action cannot be undone.`,
                { modal: true },
                "Delete",
              );
              if (confirmation === "Delete") {
                await deleteDataWorkspace(data.path);
                panel.sendMessage({ type: "workspaceDeleted", data: {} });
              } else {
                // no-op; let the UI stay as-is
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(
                `Failed to delete workspace: ${e?.message || e}`,
              );
            }
            break;
          }

          case "openFolder": {
            try {
              if (data.path && fs.existsSync(data.path)) {
                openFolderInExplorer(data.path);
              } else {
                vscode.window.showErrorMessage(
                  `Folder not found: ${data.path}`,
                );
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(
                `Failed to open folder: ${e?.message || e}`,
              );
            }
            break;
          }

        default:
          break;
      }
    });
  },
  );
  commands.disposables.push(disposable);
}

async function loadDataWorkspaces(): Promise<DataWorkspace[]> {
  const workspaceRoot = getWorkspaceRoot();
  const dataFolder = path.join(workspaceRoot, "scripts", "data");

  if (!fs.existsSync(dataFolder)) {
    return [];
  }

  const workspaces: DataWorkspace[] = [];
  const folderContents = fs.readdirSync(dataFolder, { withFileTypes: true });

  for (const dirent of folderContents) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const workspacePath = path.join(dataFolder, dirent.name);
    const exportJsonPath = path.join(workspacePath, "export.json");

    if (!fs.existsSync(exportJsonPath)) {
      continue;
    }

    try {
      const exportConfig = JSON.parse(fs.readFileSync(exportJsonPath, "utf8"));
      const objects: SfdmuObjectConfig[] = Array.isArray(exportConfig.objects)
        ? exportConfig.objects.map((obj: any) => ({
            ...obj,
            query: obj.query || "",
            operation: obj.operation || "Upsert",
            externalId: obj.externalId || obj.externalid || "",
            deleteOldData: obj.deleteOldData === true,
            useQueryAll: obj.useQueryAll === true,
            allOrNone: obj.allOrNone ?? true,
            batchSize:
              obj.batchSize ??
              obj.bulkApiV1BatchSize ??
              obj.restApiBatchSize ??
              undefined,
            objectName: extractObjectName(obj.query || ""),
          }))
        : [];

      workspaces.push({
        name: dirent.name,
        path: workspacePath,
        configPath: exportJsonPath,
        label: exportConfig.sfdxHardisLabel || dirent.name,
        description: exportConfig.sfdxHardisDescription || "",
        objects: objects,
        objectsCount: objects.length,
      });
    } catch (error) {
      Logger.log(
        `Error reading export.json for data workspace ${dirent.name}: ${error}`,
      );
    }
  }

  return workspaces;
}

async function createDataWorkspace(data: any): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const dataFolder = path.join(workspaceRoot, "scripts", "data");
  const workspacePath = path.join(dataFolder, data.name);

  await fs.ensureDir(dataFolder);

  if (fs.existsSync(workspacePath)) {
    throw new Error(`Workspace ${data.name} already exists`);
  }

  await fs.ensureDir(workspacePath);

  const objects: SfdmuObjectConfig[] = Array.isArray(data.objects)
    ? data.objects
    : [
        {
          query: data.soqlQuery,
          operation: data.operation || "Upsert",
          externalId: data.externalId || "",
          deleteOldData: data.deleteOldData === true,
          useQueryAll: data.useQueryAll === true,
          allOrNone: data.allOrNone !== false,
          batchSize: data.batchSize || undefined,
        },
      ];

  const exportConfig = {
    sfdxHardisLabel: data.label,
    sfdxHardisDescription: data.description,
    objects: normalizeObjectsForSave(objects),
  };

  const exportJsonPath = path.join(workspacePath, "export.json");
  await fs.writeFile(exportJsonPath, JSON.stringify(exportConfig, null, 2));

  vscode.window.showInformationMessage(
    `Data workspace "${data.label}" created successfully!`,
  );

  return workspacePath;
}

async function updateDataWorkspace(data: any): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  const oldPath = typeof data?.originalPath === "string" ? data.originalPath : "";
  const workspaceName = typeof data?.name === "string" ? data.name : "";

  if (!workspaceName) {
    throw new Error("Workspace name is required");
  }

  const newPath = path.join(workspaceRoot, "scripts", "data", workspaceName);

  if (oldPath && oldPath !== newPath && fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) {
      throw new Error(
        `A workspace named "${workspaceName}" already exists. Choose another name.`,
      );
    }
    await fs.move(oldPath, newPath, { overwrite: false });
  } else {
    await fs.ensureDir(newPath);
  }

  const exportJsonPath = path.join(newPath, "export.json");
  let existingConfig: any = {};
  try {
    if (fs.existsSync(exportJsonPath)) {
      existingConfig = JSON.parse(fs.readFileSync(exportJsonPath, "utf8"));
    }
  } catch {
    existingConfig = {};
  }

  const exportConfig = {
    ...existingConfig,
    sfdxHardisLabel: data.label,
    sfdxHardisDescription: data.description,
    objects: normalizeObjectsForSave(data.objects || []),
  };

  await fs.writeFile(exportJsonPath, JSON.stringify(exportConfig, null, 2));

  vscode.window.showInformationMessage(
    `Data workspace "${data.label}" updated successfully!`,
  );
}

async function deleteDataWorkspace(workspacePath: string): Promise<void> {
  if (fs.existsSync(workspacePath)) {
    await fs.remove(workspacePath);
    vscode.window.showInformationMessage(
      "Data workspace deleted successfully!",
    );
  }
}

function normalizeObjectsForSave(objects: SfdmuObjectConfig[]): any[] {
  return (objects || []).map((obj) => {
    const cleanedObj: any = { ...obj };
    cleanedObj.query = obj.query || "";
    cleanedObj.operation = obj.operation || "Upsert";
    cleanedObj.externalId = obj.externalId || obj.externalid || "";
    cleanedObj.deleteOldData = obj.deleteOldData === true;
    cleanedObj.useQueryAll = obj.useQueryAll === true;
    cleanedObj.allOrNone = obj.allOrNone ?? true;

    if (
      obj.batchSize !== undefined &&
      obj.batchSize !== null &&
      obj.batchSize !== ""
    ) {
      const batchNumber = Number(obj.batchSize);
      if (!isNaN(batchNumber)) {
        cleanedObj.batchSize = batchNumber;
      } else {
        delete cleanedObj.batchSize;
      }
    } else {
      delete cleanedObj.batchSize;
    }

    if (cleanedObj.objectName) {
      delete cleanedObj.objectName;
    }

    return cleanedObj;
  });
}

function extractObjectName(query: string): string {
  if (!query) {
    return "";
  }
  const match = query.match(
    /from\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)?(?:__[A-Za-z0-9_]+)*)/i,
  );
  return match ? match[1] : "";
}
