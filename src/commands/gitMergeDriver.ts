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
    const enabled = await isMergeDriverEnabled(workspaceRoot);
    const onEmoji = "🟢";
    const offEmoji = "⚪";
    mergeDriverStatusBarItem.text = `${enabled === true ? onEmoji : offEmoji} SF Merge Driver`;
    if (enabled === null) {
      mergeDriverStatusBarItem.tooltip =
        "No git repository detected in the current workspace.";
    } else {
      mergeDriverStatusBarItem.tooltip = enabled
        ? "Salesforce Git Merge Driver is enabled. Click to disable."
        : "Salesforce Git Merge Driver is disabled. Click to enable.";
    }
    mergeDriverStatusBarItem.show();
  }

  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.toggleMergeDriver",
    async () => {
      const workspaceRoot = getWorkspaceRoot();
      const enabled = await isMergeDriverEnabled(workspaceRoot);
      if (enabled === null) {
        vscode.window.showWarningMessage(
          "No git repository detected in the current workspace.",
        );
        return;
      }
      const command = enabled
        ? "sf git merge driver disable"
        : "sf git merge driver enable";

      const progressMessage = enabled
        ? "Disabling Salesforce Git Merge Driver..."
        : "Enabling Salesforce Git Merge Driver...";
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
          `Git Merge Driver command failed: ${command}`,
        );
      }
      await refreshMergeDriverStatusBar();

      // Some environments flush `.git/info/attributes` slightly after the CLI exits.
      setTimeout(() => {
        void refreshMergeDriverStatusBar();
      }, 1500);
    },
  );
  commands.disposables.push(disposable);

  void refreshMergeDriverStatusBar();
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

async function isMergeDriverEnabled(
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
    // Detect only active (non-commented) attributes lines.
    // `sf git merge driver disable` can comment out the line, so a raw grep would be misleading.
    const lines = content.split(/\r?\n/g);
    for (const line of lines) {
      const trimmedLeft = line.replace(/^\s+/, "");
      if (!trimmedLeft || trimmedLeft.startsWith("#")) {
        continue;
      }
      if (/merge=salesforce-source/i.test(trimmedLeft)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
