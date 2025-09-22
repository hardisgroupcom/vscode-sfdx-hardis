import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { getWorkspaceRoot, openFolderInExplorer } from "../utils";
import * as fs from "fs-extra";
import path from "path";
import { Logger } from "../logger";

export function registerShowFilesWorkbench(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showFilesWorkbench",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      // Load existing workspaces
      const workspaces = await loadFilesWorkspaces();

      const panel = lwcManager.getOrCreatePanel("s-files-workbench", {
        workspaces: workspaces,
      });

      // Handle messages from the LWC panel
      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "loadWorkspaces": {
            const updatedWorkspaces = await loadFilesWorkspaces();
            panel.sendMessage({
              type: "workspacesLoaded",
              data: { workspaces: updatedWorkspaces },
            });
            break;
          }

          case "createWorkspace": {
            const createdPath = await createFilesWorkspace(data);
            panel.sendMessage({
              type: "workspaceCreated",
              data: { path: createdPath },
            });
            break;
          }

          case "updateWorkspace": {
            await updateFilesWorkspace(data);
            panel.sendMessage({
              type: "workspaceUpdated",
              data: {},
            });
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
                await deleteFilesWorkspace(data.path);
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

// Helper methods for files workspaces
async function loadFilesWorkspaces(): Promise<any[]> {
  const workspaceRoot = getWorkspaceRoot();
  const filesFolder = path.join(workspaceRoot, "scripts", "files");

  if (!fs.existsSync(filesFolder)) {
    return [];
  }

  const workspaces: any[] = [];
  const folderContents = fs.readdirSync(filesFolder, { withFileTypes: true });

  for (const dirent of folderContents) {
    if (dirent.isDirectory()) {
      const workspacePath = path.join(filesFolder, dirent.name);
      const exportJsonPath = path.join(workspacePath, "export.json");

      if (fs.existsSync(exportJsonPath)) {
        try {
          const exportConfig = JSON.parse(
            fs.readFileSync(exportJsonPath, "utf8"),
          );

          // Count exported files (recursively count all files except export.json)
          const exportedFilesCount = countExportedFiles(workspacePath);

          workspaces.push({
            name: dirent.name,
            path: workspacePath,
            configPath: exportJsonPath,
            label: exportConfig.sfdxHardisLabel || dirent.name,
            description: exportConfig.sfdxHardisDescription || "",
            soqlQuery: exportConfig.soqlQuery || "",
            fileTypes: exportConfig.fileTypes || "all",
            fileSizeMin: exportConfig.fileSizeMin || 0,
            outputFolderNameField: exportConfig.outputFolderNameField || "Name",
            outputFileNameFormat: exportConfig.outputFileNameFormat || "title",
            overwriteParentRecords:
              exportConfig.overwriteParentRecords !== false,
            overwriteFiles: exportConfig.overwriteFiles === true,
            exportedFilesCount: exportedFilesCount,
          });
        } catch (error) {
          // Skip invalid JSON files
          Logger.log(
            `Error reading export.json for workspace ${dirent.name}: ${error}`,
          );
        }
      }
    }
  }

  return workspaces;
}

async function createFilesWorkspace(data: any): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const filesFolder = path.join(workspaceRoot, "scripts", "files");
  const workspacePath = path.join(filesFolder, data.name);

  // Ensure the parent directories exist
  await fs.ensureDir(filesFolder);

  // Check if workspace already exists
  if (fs.existsSync(workspacePath)) {
    throw new Error(`Workspace ${data.name} already exists`);
  }

  // Create workspace directory
  await fs.ensureDir(workspacePath);

  // Create export.json configuration
  const exportConfig = {
    sfdxHardisLabel: data.label,
    sfdxHardisDescription: data.description,
    soqlQuery: data.soqlQuery,
    fileTypes: data.fileTypes,
    fileSizeMin: data.fileSizeMin || 0,
    outputFolderNameField: data.outputFolderNameField,
    outputFileNameFormat: data.outputFileNameFormat,
    overwriteParentRecords: data.overwriteParentRecords,
    overwriteFiles: data.overwriteFiles,
  };

  const exportJsonPath = path.join(workspacePath, "export.json");
  await fs.writeFile(exportJsonPath, JSON.stringify(exportConfig, null, 2));

  vscode.window.showInformationMessage(
    `Files workspace "${data.label}" created successfully!`,
  );

  return workspacePath;
}

async function updateFilesWorkspace(data: any): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  const oldPath = data.originalPath;
  const newPath = path.join(workspaceRoot, "scripts", "files", data.name);

  // If the name changed, rename the directory
  if (oldPath !== newPath && fs.existsSync(oldPath)) {
    await fs.move(oldPath, newPath);
  }

  // Update export.json configuration
  /* jscpd:ignore-start */
  const exportConfig = {
    sfdxHardisLabel: data.label,
    sfdxHardisDescription: data.description,
    soqlQuery: data.soqlQuery,
    fileTypes: data.fileTypes,
    fileSizeMin: data.fileSizeMin || 0,
    outputFolderNameField: data.outputFolderNameField,
    outputFileNameFormat: data.outputFileNameFormat,
    overwriteParentRecords: data.overwriteParentRecords,
    overwriteFiles: data.overwriteFiles,
  };
  /* jscpd:ignore-end */

  const exportJsonPath = path.join(newPath, "export.json");
  await fs.writeFile(exportJsonPath, JSON.stringify(exportConfig, null, 2));

  vscode.window.showInformationMessage(
    `Files workspace "${data.label}" updated successfully!`,
  );
}

async function deleteFilesWorkspace(workspacePath: string): Promise<void> {
  if (fs.existsSync(workspacePath)) {
    await fs.remove(workspacePath);
    vscode.window.showInformationMessage(
      "Files workspace deleted successfully!",
    );
  }
}

function countExportedFiles(workspacePath: string): number {
  if (!fs.existsSync(workspacePath)) {
    return 0;
  }

  let fileCount = 0;

  const countFilesRecursively = (dirPath: string) => {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);

        if (item.isFile()) {
          // Skip export.json as it's not an exported file
          if (item.name !== "export.json") {
            fileCount++;
          }
        } else if (item.isDirectory()) {
          countFilesRecursively(fullPath);
        }
      }
    } catch (error) {
      // Skip directories that can't be read
      Logger.log(`Error reading directory ${dirPath}: ${error}`);
    }
  };

  countFilesRecursively(workspacePath);
  return fileCount;
}
