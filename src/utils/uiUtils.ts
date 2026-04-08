import * as vscode from "vscode";

export async function refreshAllRefreshableUis(
  keepCache: boolean = true,
): Promise<void> {
  await Promise.allSettled([
    vscode.commands.executeCommand(
      "vscode-sfdx-hardis.refreshCommandsView",
      keepCache,
    ),
    vscode.commands.executeCommand(
      "vscode-sfdx-hardis.refreshStatusView",
      keepCache,
    ),
    vscode.commands.executeCommand(
      "vscode-sfdx-hardis.refreshPluginsView",
      keepCache,
    ),
  ]);
}
