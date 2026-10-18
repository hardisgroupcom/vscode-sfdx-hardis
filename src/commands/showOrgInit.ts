import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Commands } from "../commands";
import {
  execSfdxJson,
  execSfdxJsonWithProgress,
  getWorkspaceRoot,
} from "../utils";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { SfdxHardisConfigHelper } from "../utils/pipeline/sfdxHardisConfigHelper";
import { handleDeploymentActionPickerMessage } from "../utils/pipeline/deploymentActionPickers";
import {
  listProjectApexScripts,
  listProjectDataWorkspaces,
  listProjectPermissionSets,
} from "../utils/prePostCommandsUtils";
import { listCustomFunctions } from "../utils/customFunctionsUtils";
import { listAllOrgs } from "../utils/orgUtils";

// Step ids and usernames end up on the command line of sf hardis:org:init: anything else is refused
const SAFE_COMMAND_ARGUMENT = /^[A-Za-z0-9_.:@+-]+$/;

export function registerShowOrgInit(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showOrgInit",
    async () => {
      const workspaceRoot = getWorkspaceRoot();
      const configHelper = SfdxHardisConfigHelper.getInstance(workspaceRoot);
      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-org-init",
        { loading: true },
      );
      panel.updateTitle(t("orgInitPanelTitle"));
      // Last answer of the CLI: its legacyKeys are the older keys the first save removes
      let lastConfig: any = null;

      // keepContent: a Refresh or the reload after a save keeps the panel on screen, under a
      // spinner, instead of going back to the loading state
      const loadAndPush = async (keepContent = false) => {
        const reloading = keepContent && lastConfig !== null;
        if (reloading) {
          panel.sendMessage({ type: "orgInitReloading", data: {} });
        } else {
          panel.sendInitializationData({ loading: true });
        }
        try {
          const data = await loadOrgInitPanelData();
          lastConfig = data.config;
          panel.sendInitializationData({ loading: false, ...data });
          // Languages, countries and releases need an org: they follow, the form works without them
          void loadAndPushOrgValues(panel);
          void loadAndPushOrgShapes(panel);
        } catch (e: any) {
          Logger.log(
            "[vscode-sfdx-hardis] Org Initialization init failed: " +
              (e?.message || e),
          );
          if (reloading) {
            // What is on screen stays usable: the error is shown aside
            panel.sendMessage({ type: "orgInitReloadFailed", data: {} });
            vscode.window.showErrorMessage(String(e?.message || e));
            return;
          }
          panel.sendInitializationData({
            loading: false,
            loadError: String(e?.message || e),
          });
        }
      };

      panel.onMessage(async (type: string, data: any) => {
        if (type === "retryInit") {
          await loadAndPush();
        } else if (type === "refresh") {
          await loadAndPush(true);
        } else if (type === "saveOrgInitSteps") {
          try {
            // The steps replace the older keys the CLI built them from: a single definition is left
            const values: Record<string, any> = { orgInitSteps: data.steps };
            for (const key of lastConfig?.legacyKeys || []) {
              values[key] = null;
            }
            await configHelper.writeGlobalConfigValues(values);
            vscode.window.showInformationMessage(t("orgInitStepsSaved"));
            await loadAndPush(true);
          } catch (e: any) {
            panel.sendMessage({ type: "orgInitStepsSaveFailed", data: {} });
            vscode.window.showErrorMessage(
              t("orgInitSaveError", { message: e?.message || e }),
            );
          }
        } else if (type === "validateScratchDef") {
          panel.sendMessage({
            type: "scratchDefValidated",
            data: await validateScratchDef(data.content, data.scratchOrgShape),
          });
        } else if (type === "saveScratchDef") {
          await saveScratchDef(panel, configHelper, data, lastConfig);
        } else if (type === "importScratchDefSettings") {
          await importScratchDefSettings(panel, data);
        } else if (type === "importScratchDefFeatures") {
          await importScratchDefFeatures(panel, data);
        } else if (type === "runOrgInit") {
          const stepIds: string[] = Array.isArray(data.stepIds)
            ? data.stepIds
            : [];
          const targetOrg: string = data.targetOrg || "";
          const unsafe = [...stepIds, targetOrg].filter(
            (value) => value && !SAFE_COMMAND_ARGUMENT.test(String(value)),
          );
          if (unsafe.length > 0) {
            vscode.window.showErrorMessage(
              t("orgInitInvalidRunArguments", { values: unsafe.join(", ") }),
            );
            return;
          }
          const command =
            "sf hardis:org:init --agent" +
            (stepIds.length > 0 ? ` --steps ${stepIds.join(",")}` : "") +
            (targetOrg ? ` --target-org ${targetOrg}` : "");
          vscode.commands.executeCommand(
            "vscode-sfdx-hardis.execute-command",
            command,
          );
        } else {
          // Lazy-loaded lists of the step editor (schedulable classes, communities...)
          await handleDeploymentActionPickerMessage(panel, type, data);
        }
      });

      // The panel is already open on its loading state: the data follows when the CLI answers
      void loadAndPush();
    },
  );
  commands.disposables.push(disposable);
}

/**
 * The CLI builds the steps, including the list it builds from the older keys, and validates the
 * scratch org definition: the panel only shows what it returns.
 */
async function loadOrgInitPanelData(): Promise<Record<string, any>> {
  const [
    configRes,
    apexScripts,
    sfdmuWorkspaces,
    permissionSets,
    connectedOrgs,
    customFunctions,
  ] = await Promise.all([
    // Not a result of the last 20 seconds: a Refresh or the reload after a save reads the file again
    execSfdxJson("sf hardis:config:org-init --json", {
      fail: false,
      output: false,
      reuseRecentResult: false,
    }),
    listProjectApexScripts(),
    listProjectDataWorkspaces(),
    listProjectPermissionSets(),
    listConnectedOrgs(),
    listCustomFunctions(),
  ]);
  if (!configRes?.result || configRes.status !== 0) {
    throw new Error(
      t("orgInitCliError", {
        message: configRes?.message || configRes?.errorMessage || "",
      }),
    );
  }
  return {
    config: configRes.result,
    apexScripts,
    sfdmuWorkspaces,
    permissionSets,
    customFunctions,
    orgs: listOrgsToInitialize(connectedOrgs),
    sourceOrgs: listImportSourceOrgs(connectedOrgs),
  };
}

// Read from the default Dev Hub, else the default org. Without one, the form keeps text inputs.
async function loadAndPushOrgValues(panel: {
  sendMessage: (message: any) => void;
}): Promise<void> {
  try {
    const res = await execSfdxJson(
      "sf hardis:config:org-init --org-values --agent --json",
      { fail: false, output: false, reuseRecentResult: false },
    );
    panel.sendMessage({
      type: "scratchDefOrgValues",
      data: {
        orgValues: res?.status === 0 ? res?.result?.orgValues || null : null,
      },
    });
  } catch (e: any) {
    Logger.log(
      "[vscode-sfdx-hardis] Org Initialization: no org values: " +
        (e?.message || e),
    );
    panel.sendMessage({
      type: "scratchDefOrgValues",
      data: { orgValues: null },
    });
  }
}

// Active org shapes of the connected orgs, for the org shape the scratch orgs are created from
async function loadAndPushOrgShapes(panel: {
  sendMessage: (message: any) => void;
}): Promise<void> {
  try {
    const res = await execSfdxJson(
      "sf hardis:config:org-init --list-org-shapes --agent --json",
      { fail: false, output: false, reuseRecentResult: false },
    );
    panel.sendMessage({
      type: "scratchDefOrgShapes",
      data: {
        orgShapes: res?.status === 0 ? res?.result?.orgShapes || [] : [],
      },
    });
  } catch (e: any) {
    Logger.log(
      "[vscode-sfdx-hardis] Org Initialization: no org shapes: " +
        (e?.message || e),
    );
    panel.sendMessage({ type: "scratchDefOrgShapes", data: { orgShapes: [] } });
  }
}

async function importScratchDefSettings(
  panel: { sendMessage: (message: any) => void },
  data: any,
): Promise<void> {
  const sourceOrg = String(data?.sourceOrg || "");
  const settingsNames: string[] = Array.isArray(data?.settingsNames)
    ? data.settingsNames.map(String)
    : [];
  const unsafe = [sourceOrg, ...settingsNames].filter(
    (value) => !SAFE_COMMAND_ARGUMENT.test(value),
  );
  if (settingsNames.length === 0 || unsafe.length > 0) {
    panel.sendMessage({
      type: "scratchDefImportDone",
      data: {
        error: t("orgInitInvalidRunArguments", { values: unsafe.join(", ") }),
      },
    });
    return;
  }
  const res = await execSfdxJsonWithProgress(
    `sf hardis:config:org-init --import-settings ${settingsNames.join(",")} --source-org ${sourceOrg} --agent --json`,
    { fail: false, output: false, reuseRecentResult: false },
    t("orgInitImportingSettings", { org: sourceOrg }),
  );
  panel.sendMessage({
    type: "scratchDefImportDone",
    data:
      res?.status === 0
        ? {
            settings: res.result?.importedSettings?.settings || {},
            errors: res.result?.importedSettings?.errors || [],
          }
        : { error: res?.message || res?.errorMessage || "" },
  });
}

// Creating an org shape takes minutes: the progress notification stays until it is active
async function importScratchDefFeatures(
  panel: { sendMessage: (message: any) => void },
  data: any,
): Promise<void> {
  const sourceOrg = String(data?.sourceOrg || "");
  if (!SAFE_COMMAND_ARGUMENT.test(sourceOrg)) {
    panel.sendMessage({
      type: "scratchDefImportDone",
      data: { error: t("orgInitInvalidRunArguments", { values: sourceOrg }) },
    });
    return;
  }
  const res = await execSfdxJsonWithProgress(
    `sf hardis:config:org-init --import-features-from-shape --source-org ${sourceOrg} --agent --json`,
    { fail: false, output: false, reuseRecentResult: false },
    t("orgInitImportingFeatures", { org: sourceOrg }),
  );
  panel.sendMessage({
    type: "scratchDefImportDone",
    data:
      res?.status === 0
        ? { features: res.result?.importedShape?.features || [] }
        : { error: res?.message || res?.errorMessage || "" },
  });
}

async function listConnectedOrgs(): Promise<any[]> {
  try {
    // Not from the cache: the org to initialize is often the one created a minute ago
    return await listAllOrgs(false, false, true);
  } catch (e: any) {
    Logger.log(
      "[vscode-sfdx-hardis] Org Initialization: unable to list orgs: " +
        (e?.message || e),
    );
    return [];
  }
}

// Scratch orgs and sandboxes: hardis:org:init refuses production orgs
function listOrgsToInitialize(orgs: any[]): any[] {
  return orgs
    .filter((org) => org.orgType === "scratch" || org.orgType === "sandbox")
    .map((org) => ({
      label:
        (org.alias ? `${org.alias} (${org.username})` : org.username) +
        (org.isDefaultUsername ? ` - ${t("orgInitDefaultOrg")}` : ""),
      value: org.username,
      orgType: org.orgType,
      isDefault: org.isDefaultUsername,
    }));
}

// Any connected org can give its settings, production included: nothing is written in it
// (an org shape is a record the org keeps)
function listImportSourceOrgs(orgs: any[]): any[] {
  return orgs.map((org) => ({
    label: org.alias ? `${org.alias} (${org.username})` : org.username,
    value: org.username,
  }));
}

// Writes the definition to a temporary file and lets the CLI validate it, as scratch:create would.
// Never throws: a failure to validate is returned as an issue, so the panel always gets an answer.
// scratchOrgShape: the org shape picked on screen ("" for none), undefined to use the saved one
async function validateScratchDef(
  content: any,
  scratchOrgShape?: string,
): Promise<{ issues: string[]; warnings: string[] }> {
  let tmpDir = "";
  try {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "sfdx-hardis-scratch-def-"),
    );
    const tmpFile = path.join(tmpDir, "project-scratch-def.json");
    await fs.promises.writeFile(
      tmpFile,
      JSON.stringify(content, null, 2),
      "utf8",
    );
    const shapeArgument =
      scratchOrgShape === undefined
        ? ""
        : SAFE_COMMAND_ARGUMENT.test(scratchOrgShape)
          ? ` --scratch-org-shape ${scratchOrgShape}`
          : " --scratch-org-shape none";
    const res = await execSfdxJson(
      `sf hardis:config:org-init --validate-scratch-def "${tmpFile}"${shapeArgument} --json`,
    );
    if (!res?.result) {
      return {
        issues: [
          t("orgInitCliError", {
            message: res?.message || res?.errorMessage || "",
          }),
        ],
        warnings: [],
      };
    }
    return {
      issues: res.result.scratchDef?.issues || [],
      warnings: res.result.scratchDef?.warnings || [],
    };
  } catch (e: any) {
    return {
      issues: [t("orgInitCliError", { message: e?.message || String(e) })],
      warnings: [],
    };
  } finally {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }
}

// The org shape by level: the project config, then the config of each major branch (null removes
// the key, so the branch inherits the global value; "none" turns the org shape off for it).
// Only the levels that changed are written.
async function saveScratchOrgShapes(
  configHelper: SfdxHardisConfigHelper,
  levels: any,
  lastConfig: any,
): Promise<void> {
  if (!levels) {
    return;
  }
  const saved = lastConfig?.scratchOrgShapes || {};
  if ((levels.global || null) !== (saved.global || null)) {
    await configHelper.writeGlobalConfigValues({
      scratchOrgShape: levels.global || null,
    });
  }
  for (const branch of saved.majorBranches || []) {
    const value = levels.branches?.[branch] || null;
    if (value !== (saved.branches?.[branch] || null)) {
      await configHelper.writeBranchConfigValues(branch, {
        scratchOrgShape: value,
      });
    }
  }
}

async function saveScratchDef(
  panel: { sendMessage: (message: any) => void },
  configHelper: SfdxHardisConfigHelper,
  data: any,
  lastConfig: any,
): Promise<void> {
  const validation = await validateScratchDef(
    data.content,
    data.scratchOrgShape,
  );
  if (validation.issues.length > 0) {
    panel.sendMessage({ type: "scratchDefValidated", data: validation });
    vscode.window.showWarningMessage(t("orgInitScratchDefNotSaved"));
    return;
  }
  try {
    const scratchDefPath = path.join(
      getWorkspaceRoot(),
      "config",
      "project-scratch-def.json",
    );
    await fs.promises.mkdir(path.dirname(scratchDefPath), { recursive: true });
    await fs.promises.writeFile(
      scratchDefPath,
      JSON.stringify(data.content, null, 2) + "\n",
      "utf8",
    );
    const duration = Number(data.scratchOrgDuration);
    await configHelper.writeGlobalConfigValues({
      scratchOrgDuration:
        Number.isInteger(duration) && duration >= 1 && duration <= 30
          ? duration
          : null,
    });
    await saveScratchOrgShapes(configHelper, data.scratchOrgShapes, lastConfig);
    panel.sendMessage({
      type: "scratchDefSaved",
      data: { issues: [], warnings: validation.warnings },
    });
    vscode.window.showInformationMessage(t("orgInitScratchDefSaved"));
  } catch (e: any) {
    panel.sendMessage({
      type: "scratchDefValidated",
      data: { issues: [String(e?.message || e)], warnings: [] },
    });
    vscode.window.showErrorMessage(
      t("orgInitSaveError", { message: e?.message || e }),
    );
  }
}
