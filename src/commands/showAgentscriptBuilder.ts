import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { getWorkspaceRoot } from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";

/**
 * Glob patterns to locate Agent Script files in the workspace.
 */
const AGENT_SCRIPT_GLOB = "**/*.agent";

/**
 * Find all Agent Script files in the current workspace.
 */
async function findAgentScriptFiles(): Promise<vscode.Uri[]> {
  return await vscode.workspace.findFiles(
    AGENT_SCRIPT_GLOB,
    "**/node_modules/**",
  );
}

/**
 * Prompt user to pick an Agent Script file when multiple exist.
 */
async function pickAgentScriptFile(
  files: vscode.Uri[],
): Promise<string | null> {
  if (files.length === 0) {
    return null;
  }
  if (files.length === 1) {
    return files[0].fsPath;
  }

  const workspaceRoot = getWorkspaceRoot() || "";
  const items = files.map((f) => ({
    label: path.relative(workspaceRoot, f.fsPath).replace(/\\/g, "/"),
    fsPath: f.fsPath,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: t("agentScriptPickFile"),
  });
  return pick ? pick.fsPath : null;
}

/**
 * Read a script file and return its content as a string.
 * Returns empty string on error.
 */
function readScriptFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e: any) {
    Logger.log(`[AgentscriptBuilder] Failed to read ${filePath}: ${e.message}`);
    return "";
  }
}

/**
 * Register the showAgentscriptBuilder VS Code command.
 */
export function registerShowAgentscriptBuilder(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showAgentscriptBuilder",
    async (fileUri?: vscode.Uri) => {
      const lwcManager = LwcPanelManager.getInstance();

      // Resolve file path: explicit arg > active editor > workspace search
      let filePath: string | null = null;

      if (fileUri && fileUri.fsPath) {
        filePath = fileUri.fsPath;
      } else if (
        vscode.window.activeTextEditor &&
        vscode.window.activeTextEditor.document.fileName.endsWith(
          ".agent",
        )
      ) {
        filePath = vscode.window.activeTextEditor.document.fileName;
      } else {
        const foundFiles = await findAgentScriptFiles();
        filePath = await pickAgentScriptFile(foundFiles);
      }

      // If still no file, show open dialog
      if (!filePath) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "Agent Script": ["agent"] },
          openLabel: t("openScriptFile"),
        });
        if (picked && picked.length > 0) {
          filePath = picked[0].fsPath;
        }
      }

      const scriptContent = filePath ? readScriptFile(filePath) : "";

      const panel = lwcManager.getOrCreatePanel("s-agentscript-builder", {
        scriptContent,
        filePath: filePath || "",
      });
      panel.updateTitle(t("agentscriptBuilderTitle"));

      // Handle messages from the Agent Script Builder panel
      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "saveAgentScript": {
            const targetPath: string = data?.filePath;
            const content: string = data?.scriptContent || "";
            if (!targetPath) {
              // Prompt for save location if no path known
              const saveUri = await vscode.window.showSaveDialog({
                filters: { "Agent Script": ["agent"] },
                saveLabel: t("save"),
              });
              if (saveUri) {
                try {
                  fs.writeFileSync(saveUri.fsPath, content, "utf8");
                  vscode.window.showInformationMessage(
                    t("agentScriptSaved"),
                  );
                  // Update the panel's known file path
                  panel.sendMessage({
                    type: "scriptContentUpdated",
                    data: {
                      scriptContent: content,
                      filePath: saveUri.fsPath,
                    },
                  });
                } catch (e: any) {
                  vscode.window.showErrorMessage(
                    `${t("agentScriptSaveError")}: ${e.message}`,
                  );
                }
              }
              break;
            }
            try {
              fs.writeFileSync(targetPath, content, "utf8");
              vscode.window.showInformationMessage(t("agentScriptSaved"));
            } catch (e: any) {
              vscode.window.showErrorMessage(
                `${t("agentScriptSaveError")}: ${e.message}`,
              );
            }
            break;
          }
          default:
            Logger.log(
              `[AgentscriptBuilder] Unknown message type: ${type}`,
            );
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
