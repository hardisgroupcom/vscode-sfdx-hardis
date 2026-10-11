import * as vscode from "vscode";
import { GitProvider } from "./gitProvider";
import { Logger } from "../../logger";
import { t } from "../../i18n/i18n";

/**
 * Connects to the git provider of the repository, asking the user for what it needs (VS Code
 * sign-in, token), and tells the outcome. Shared by every panel with a "Connect to Git" action.
 * @returns true when the provider is connected
 */
export async function connectGitProvider(): Promise<boolean> {
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    vscode.window.showErrorMessage(t("noGitProviderDetected"));
    return false;
  }
  Logger.log(
    `Authenticating to Git provider: ${gitProvider.repoInfo?.providerName} at ${gitProvider.repoInfo?.host}`,
  );
  let authRes: boolean | null;
  try {
    authRes = await gitProvider.authenticate();
  } catch (e) {
    showErrorWithLogs(t("gitProviderAuthError"));
    Logger.log(`Error during Git provider authentication: ${String(e)}`);
    return false;
  }
  if (authRes === true) {
    vscode.window.showInformationMessage(
      t("successfullyConnectedToGitProvider"),
    );
    return true;
  }
  if (authRes === false) {
    showErrorWithLogs(t("failedConnectGitProvider"));
  }
  return false;
}

function showErrorWithLogs(message: string): void {
  const viewLogsLabel = t("viewLogs");
  vscode.window.showErrorMessage(message, viewLogsLabel).then((action) => {
    if (action === viewLogsLabel) {
      Logger.showOutputChannel();
    }
  });
}
