import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { execCommandWithProgress, getWorkspaceRoot } from "../utils";
import type { Commands } from "../commands";

export function registerGitMergeDriverToggle(commands: Commands) {
  const mergeDriverStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    50,
  );
  mergeDriverStatusBarItem.command = "vscode-sfdx-hardis.toggleMergeDriver";
  commands.disposables.push(mergeDriverStatusBarItem);

  async function refreshMergeDriverStatusBar(): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    const installed = await isMergeDriverInstalled(workspaceRoot);
    const onEmoji = "🟢";
    const offEmoji = "⚪";
    mergeDriverStatusBarItem.text = `${installed === true ? onEmoji : offEmoji} SF Merge Driver`;
    if (installed === null) {
      mergeDriverStatusBarItem.tooltip =
        "No git repository detected in the current workspace.";
    } else {
      mergeDriverStatusBarItem.tooltip = installed
        ? "Salesforce Git Merge Driver is inactive. Click to activate."
        : "Salesforce Git Merge Driver is active. Click to deactivate.";
    }
    mergeDriverStatusBarItem.show();
  }

  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.toggleMergeDriver",
    async () => {
      const workspaceRoot = getWorkspaceRoot();
      const installed = await isMergeDriverInstalled(workspaceRoot);
      if (installed === null) {
        vscode.window.showWarningMessage(
          "No git repository detected in the current workspace.",
        );
        return;
      }
      const command = installed
        ? "sf git merge driver uninstall"
        : "sf git merge driver install";

      const progressMessage = installed
        ? "Uninstalling Salesforce Git Merge Driver..."
        : "Installing Salesforce Git Merge Driver...";
      const result = await execCommandWithProgress(
        command,
        {
          fail: false,
          output: true,
          debug: false,
          spinner: true,
          cwd: workspaceRoot,
        },
        progressMessage,
      );

      if (result?.status && result.status !== 0) {
        vscode.window.showErrorMessage(
          `Merge driver command failed: ${command}`,
        );
      }
      await refreshMergeDriverStatusBar();
    },
  );
  commands.disposables.push(disposable);

  refreshMergeDriverStatusBar();
}

function getGitDirPath(workspaceRoot: string): string | null {
  const dotGitPath = path.join(workspaceRoot, ".git");
  if (!fs.existsSync(dotGitPath)) {
    return null;
  }
  try {
    const stats = fs.lstatSync(dotGitPath);
    if (stats.isDirectory()) {
      return dotGitPath;
    }
    if (stats.isFile()) {
      const content = fs.readFileSync(dotGitPath, "utf8");
      const match = content.match(/^gitdir:\s*(.+)\s*$/im);
      if (!match || !match[1]) {
        return null;
      }
      const rawGitDir = match[1].trim();
      const resolvedGitDir = path.isAbsolute(rawGitDir)
        ? rawGitDir
        : path.resolve(workspaceRoot, rawGitDir);
      if (fs.existsSync(resolvedGitDir)) {
        return resolvedGitDir;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

function getGitInfoAttributesPath(workspaceRoot: string): string | null {
  const gitDir = getGitDirPath(workspaceRoot);
  if (!gitDir) {
    return null;
  }
  return path.join(gitDir, "info", "attributes");
}

async function isMergeDriverInstalled(
  workspaceRoot: string,
): Promise<boolean | null> {
  const attributesPath = getGitInfoAttributesPath(workspaceRoot);
  if (!attributesPath) {
    return null;
  }
  if (!fs.existsSync(attributesPath)) {
    return false;
  }
  try {
    const content = await fs.readFile(attributesPath, "utf8");
    return /merge=salesforce-source/i.test(content);
  } catch {
    return false;
  }
}

