import * as fs from "fs";
import path from "path";
import { Logger } from "../logger";

/**
 * A workspace folder holding an export.json, handed to the builder callback
 */
export type WorkspaceExportContext = {
  name: string;
  workspacePath: string;
  configPath: string;
  exportConfig: any;
};

/**
 * Lists the workspaces of a workbench folder (scripts/data, scripts/files...):
 * every sub-folder holding a readable export.json is handed to buildWorkspace,
 * which shapes the entry expected by the matching panel.
 * Sub-folders are visited concurrently, as the listings are I/O bound.
 */
export async function loadWorkbenchWorkspaces<T>(
  workspacesFolder: string,
  buildWorkspace: (
    context: WorkspaceExportContext,
  ) => Promise<T | null> | T | null,
): Promise<T[]> {
  let folderContents: fs.Dirent[];
  try {
    folderContents = await fs.promises.readdir(workspacesFolder, {
      withFileTypes: true,
    });
  } catch {
    // Missing or unreadable folder: no workspace to display
    return [];
  }

  const loaded = await Promise.all(
    folderContents.map(async (dirent) => {
      if (!dirent.isDirectory()) {
        return null;
      }
      const workspacePath = path.join(workspacesFolder, dirent.name);
      const configPath = path.join(workspacePath, "export.json");

      let exportConfigRaw: string;
      try {
        exportConfigRaw = await fs.promises.readFile(configPath, "utf8");
      } catch {
        // no export.json: not a workspace
        return null;
      }

      try {
        return await buildWorkspace({
          name: dirent.name,
          workspacePath: workspacePath,
          configPath: configPath,
          exportConfig: JSON.parse(exportConfigRaw),
        });
      } catch (error) {
        Logger.log(
          `Error reading export.json for workspace ${dirent.name}: ${error}`,
        );
        return null;
      }
    }),
  );

  // The cast restores T: awaiting the builder widens it to Awaited<T>, and the
  // built workspaces are plain objects, never thenables
  return loaded.filter((workspace) => workspace !== null) as T[];
}
