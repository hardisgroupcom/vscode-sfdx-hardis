import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Commands } from "../commands";
import { execSfdxJson, getWorkspaceRoot } from "../utils";
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

      const loadAndPush = async () => {
        panel.sendInitializationData({ loading: true });
        try {
          const data = await loadOrgInitPanelData();
          lastConfig = data.config;
          panel.sendInitializationData({ loading: false, ...data });
        } catch (e: any) {
          Logger.log(
            "[vscode-sfdx-hardis] Org Initialization init failed: " +
              (e?.message || e),
          );
          panel.sendInitializationData({
            loading: false,
            loadError: String(e?.message || e),
          });
        }
      };

      panel.onMessage(async (type: string, data: any) => {
        if (type === "retryInit" || type === "refresh") {
          await loadAndPush();
        } else if (type === "saveOrgInitSteps") {
          try {
            // The steps replace the older keys the CLI built them from: a single definition is left
            const values: Record<string, any> = { orgInitSteps: data.steps };
            for (const key of lastConfig?.legacyKeys || []) {
              values[key] = null;
            }
            await configHelper.writeGlobalConfigValues(values);
            vscode.window.showInformationMessage(t("orgInitStepsSaved"));
            await loadAndPush();
          } catch (e: any) {
            panel.sendMessage({ type: "orgInitStepsSaveFailed", data: {} });
            vscode.window.showErrorMessage(
              t("orgInitSaveError", { message: e?.message || e }),
            );
          }
        } else if (type === "validateScratchDef") {
          panel.sendMessage({
            type: "scratchDefValidated",
            data: await validateScratchDef(data.content),
          });
        } else if (type === "saveScratchDef") {
          await saveScratchDef(panel, configHelper, data);
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
    orgs,
    customFunctions,
  ] = await Promise.all([
    execSfdxJson("sf hardis:config:org-init --json"),
    listProjectApexScripts(),
    listProjectDataWorkspaces(),
    listProjectPermissionSets(),
    listInitializableOrgs(),
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
    orgs,
  };
}

// Scratch orgs and sandboxes: hardis:org:init refuses production orgs
async function listInitializableOrgs(): Promise<any[]> {
  try {
    // Not from the cache: the org to initialize is often the one created a minute ago
    const orgs = await listAllOrgs(false, false, true);
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
  } catch (e: any) {
    Logger.log(
      "[vscode-sfdx-hardis] Org Initialization: unable to list orgs: " +
        (e?.message || e),
    );
    return [];
  }
}

// Writes the definition to a temporary file and lets the CLI validate it, as scratch:create would.
// Never throws: a failure to validate is returned as an issue, so the panel always gets an answer.
async function validateScratchDef(
  content: any,
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
    const res = await execSfdxJson(
      `sf hardis:config:org-init --validate-scratch-def "${tmpFile}" --json`,
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

async function saveScratchDef(
  panel: { sendMessage: (message: any) => void },
  configHelper: SfdxHardisConfigHelper,
  data: any,
): Promise<void> {
  const validation = await validateScratchDef(data.content);
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
