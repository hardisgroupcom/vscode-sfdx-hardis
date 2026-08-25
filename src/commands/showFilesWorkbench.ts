// jscpd:ignore-start
import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { getWorkspaceRoot, openFolderInExplorer } from "../utils";
import * as fs from "fs";
import path from "path";
import { Logger } from "../logger";
import { getJson } from "../utils/httpUtils";
import { t } from "../i18n/i18n";
// jscpd:ignore-end

const FILE_TEMPLATES_URL =
  "https://github.com/hardisgroupcom/sfdx-hardis/raw/refs/heads/main/defaults/templates/file-templates.json";

// Upper bound of the exported files walk: the displayed count stops there
const COUNT_FILES_MAX_ENTRIES = 100000;

export function registerShowFilesWorkbench(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showFilesWorkbench",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      const panel = lwcManager.getOrCreatePanel("s-files-workbench", {
        loading: true,
      });
      panel.updateTitle(t("filesWorkbench"));

      const loadAndPush = async () => {
        panel.sendInitializationData({ loading: true });
        try {
          const workspaces = await loadFilesWorkspaces();
          panel.sendInitializationData({
            workspaces: workspaces,
            loading: false,
          });
          /* jscpd:ignore-start */
        } catch (e: any) {
          Logger.log(
            "[vscode-sfdx-hardis] Files Workbench init failed: " +
              (e?.message || e),
          );
          panel.sendInitializationData({
            loading: false,
            loadError: String(e?.message || e),
          });
        }
      };

      // Handle messages from the LWC panel
      panel.onMessage(async (type: string, data: any) => {
        if (type === "retryInit") {
          await loadAndPush();
          return;
        }
        /* jscpd:ignore-end */
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

          // jscpd:ignore-start
          case "loadTemplates": {
            try {
              const response = await getJson<any>(FILE_TEMPLATES_URL, {
                timeoutMs: 8000,
              });
              const templates = response?.templates || [];
              panel.sendMessage({
                type: "templatesLoaded",
                data: { templates },
              });
            } catch (e: any) {
              Logger.log(`Failed to load file templates: ${e?.message || e}`);
              panel.sendMessage({
                type: "templatesLoaded",
                data: { templates: [] },
              });
            }
            break;
          }

          case "loadTemplate": {
            try {
              const template = await getJson<any>(data.url, {
                timeoutMs: 8000,
              });
              panel.sendMessage({
                type: "templateLoaded",
                data: { template },
              });
            } catch (e: any) {
              Logger.log(`Failed to load file template: ${e?.message || e}`);
              vscode.window.showErrorMessage(
                `Failed to load template: ${e?.message || e}`,
              );
              panel.sendMessage({
                type: "templateLoaded",
                data: { template: null },
              });
            }
            break;
          }
          // jscpd:ignore-end

          default:
            break;
        }
      });
      loadAndPush();
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

  let folderContents: fs.Dirent[];
  try {
    folderContents = await fs.promises.readdir(filesFolder, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  // Every workspace is scanned concurrently: the walks are I/O bound
  const loaded = await Promise.all(
    folderContents.map(async (dirent) => {
      if (dirent.isDirectory()) {
        const workspacePath = path.join(filesFolder, dirent.name);
        const exportJsonPath = path.join(workspacePath, "export.json");

        let exportConfigRaw: string;
        try {
          exportConfigRaw = await fs.promises.readFile(exportJsonPath, "utf8");
        } catch {
          // no export.json: not a files workspace
          return null;
        }

        try {
          const exportConfig = JSON.parse(exportConfigRaw);

          // Count exported files (recursively count all files except export.json)
          const exportedFilesCount = await countExportedFiles(workspacePath);

          return {
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
          };
        } catch (error) {
          // Skip invalid JSON files
          Logger.log(
            `Error reading export.json for workspace ${dirent.name}: ${error}`,
          );
        }
      }
      return null;
    }),
  );

  return loaded.filter((workspace) => workspace !== null);
}

async function createFilesWorkspace(data: any): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const filesFolder = path.join(workspaceRoot, "scripts", "files");
  const workspacePath = path.join(filesFolder, data.name);

  // Ensure the parent directories exist
  await fs.promises.mkdir(filesFolder, { recursive: true });

  // Check if workspace already exists
  if (fs.existsSync(workspacePath)) {
    throw new Error(`Workspace ${data.name} already exists`);
  }

  // Create workspace directory
  await fs.promises.mkdir(workspacePath, { recursive: true });

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
  await fs.promises.writeFile(
    exportJsonPath,
    JSON.stringify(exportConfig, null, 2),
  );

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
    if (fs.existsSync(newPath)) {
      throw new Error(
        `Cannot rename files workspace: ${newPath} already exists`,
      );
    }
    await fs.promises.rename(oldPath, newPath);
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
  await fs.promises.writeFile(
    exportJsonPath,
    JSON.stringify(exportConfig, null, 2),
  );

  vscode.window.showInformationMessage(
    `Files workspace "${data.label}" updated successfully!`,
  );
}

async function deleteFilesWorkspace(workspacePath: string): Promise<void> {
  if (fs.existsSync(workspacePath)) {
    await fs.promises.rm(workspacePath, { recursive: true, force: true });
    vscode.window.showInformationMessage(
      "Files workspace deleted successfully!",
    );
  }
}

// Count the files of an exported workspace. A Salesforce Files export holds one
// file per attachment, so a workspace can reach tens of thousands of entries:
// the walk is asynchronous (it used to be a recursive readdirSync that froze the
// extension host), reads the sibling directories of a level concurrently, and
// gives up past COUNT_FILES_MAX_ENTRIES rather than paying for the whole tree.
async function countExportedFiles(workspacePath: string): Promise<number> {
  let fileCount = 0;
  let pending: string[] = [workspacePath];

  while (pending.length > 0 && fileCount < COUNT_FILES_MAX_ENTRIES) {
    const levels = await Promise.all(
      pending.map(async (dirPath) => {
        try {
          return {
            dirPath,
            items: await fs.promises.readdir(dirPath, { withFileTypes: true }),
          };
        } catch (error) {
          // Skip directories that can't be read
          Logger.log(`Error reading directory ${dirPath}: ${error}`);
          return { dirPath, items: [] as fs.Dirent[] };
        }
      }),
    );

    const nextLevel: string[] = [];
    for (const { dirPath, items } of levels) {
      for (const item of items) {
        if (item.isFile()) {
          // Skip export.json as it's not an exported file
          if (item.name !== "export.json") {
            fileCount++;
          }
        } else if (item.isDirectory()) {
          nextLevel.push(path.join(dirPath, item.name));
        }
      }
    }
    pending = nextLevel;
  }

  return fileCount;
}
