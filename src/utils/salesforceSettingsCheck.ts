import * as vscode from "vscode";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";

// Salesforce Extensions setting, enabled by default, that constantly checks
// source tracking conflicts in the background and slows down the whole VS Code
const CONFLICT_DETECTION_SECTION = "salesforcedx-vscode-metadata";
const CONFLICT_DETECTION_KEY = "sourceTracking.enableConflictDetection";
// Once set in globalState, the user is never prompted again on this machine
const CONFLICT_DETECTION_DISMISSED_KEY =
  "vscodeSfdxHardis.conflictDetectionWarningDismissed";

/**
 * Warn the user when the Salesforce Extensions conflict detection is enabled,
 * and offer to disable it. Called asynchronously after the extension startup,
 * so it never delays the activation.
 */
export async function checkSalesforceConflictDetectionSetting(
  context: vscode.ExtensionContext,
): Promise<void> {
  try {
    const dismissedForever = context.globalState.get<boolean>(
      CONFLICT_DETECTION_DISMISSED_KEY,
    );
    if (dismissedForever === true) {
      return;
    }
    const config = vscode.workspace.getConfiguration(
      CONFLICT_DETECTION_SECTION,
    );
    // Undefined when the Salesforce metadata extension is not installed
    if (config.get<boolean>(CONFLICT_DETECTION_KEY) !== true) {
      return;
    }
    const disableLabel = t("conflictDetectionDisableNow");
    const notNowLabel = t("conflictDetectionNotNow");
    const neverLabel = t("conflictDetectionNeverAsk");
    const selection = await vscode.window.showWarningMessage(
      t("conflictDetectionWarning"),
      disableLabel,
      notNowLabel,
      neverLabel,
    );
    if (selection === neverLabel) {
      await context.globalState.update(CONFLICT_DETECTION_DISMISSED_KEY, true);
      Logger.log(
        "Conflict detection performance warning dismissed forever by user",
      );
      return;
    }
    if (selection !== disableLabel) {
      // "Not now" or notification closed: ask again at next startup
      return;
    }
    await disableConflictDetection(config);
  } catch (e: any) {
    Logger.log(
      "Error while checking Salesforce conflict detection setting: " +
        e?.message,
    );
  }
}

/**
 * Set the conflict detection setting to false. It is disabled in user settings,
 * plus in workspace / workspace folder settings when explicitly enabled there,
 * otherwise the local value would keep overriding the user one.
 */
async function disableConflictDetection(
  config: vscode.WorkspaceConfiguration,
): Promise<void> {
  const inspected = config.inspect<boolean>(CONFLICT_DETECTION_KEY);
  const targets: vscode.ConfigurationTarget[] = [
    vscode.ConfigurationTarget.Global,
  ];
  if (inspected?.workspaceValue === true) {
    targets.push(vscode.ConfigurationTarget.Workspace);
  }
  if (inspected?.workspaceFolderValue === true) {
    targets.push(vscode.ConfigurationTarget.WorkspaceFolder);
  }
  for (const target of targets) {
    await config.update(CONFLICT_DETECTION_KEY, false, target);
  }
  // Re-read a fresh configuration to check the setting is really disabled
  const updatedValue = vscode.workspace
    .getConfiguration(CONFLICT_DETECTION_SECTION)
    .get<boolean>(CONFLICT_DETECTION_KEY);
  if (updatedValue === true) {
    Logger.log(
      `Unable to disable ${CONFLICT_DETECTION_SECTION}.${CONFLICT_DETECTION_KEY}`,
    );
    vscode.window.showWarningMessage(t("conflictDetectionDisableFailed"));
    return;
  }
  Logger.log(
    `Disabled ${CONFLICT_DETECTION_SECTION}.${CONFLICT_DETECTION_KEY} to improve performances`,
  );
  vscode.window.showInformationMessage(t("conflictDetectionDisabled"));
}
