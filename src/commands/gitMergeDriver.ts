import * as vscode from "vscode";
import { execCommandWithProgress, getWorkspaceRoot } from "../utils";
import { isMergeDriverEnabled } from "../utils/gitMergeDriverUtils";
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
