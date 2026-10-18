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

// Older keys the CLI builds the steps from when orgInitSteps is absent: the first save of the
// panel writes orgInitSteps and removes them, so the project has a single definition
const ORG_INIT_LEGACY_KEYS = [
  "initPermissionSets",
  "scratchOrgInitApexScripts",
  "sandboxOrgInitApexScripts",
];

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

      const loadAndPush = async () => {
        panel.sendInitializationData({ loading: true });
        try {
          panel.sendInitializationData({
            loading: false,
            ...(await loadOrgInitPanelData()),
          });
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
            const values: Record<string, any> = { orgInitSteps: data.steps };
            for (const key of ORG_INIT_LEGACY_KEYS) {
              values[key] = null;
            }
            await configHelper.writeGlobalConfigValues(values);
            vscode.window.showInformationMessage(t("orgInitStepsSaved"));
            await loadAndPush();
          } catch (e: any) {
            vscode.window.showErrorMessage(
              t("orgInitSaveError", { message: e?.message || e }),
            );
          }
        } else if (type === "validateScratchDef") {
          const issues = await validateScratchDef(data.content);
          panel.sendMessage({ type: "scratchDefValidated", data: { issues } });
        } else if (type === "saveScratchDef") {
          await saveScratchDef(panel, configHelper, data);
        } else if (type === "runOrgInit") {
          const stepIds: string[] = Array.isArray(data.stepIds)
            ? data.stepIds
            : [];
          const command =
            "sf hardis:org:init --agent" +
            (stepIds.length > 0 ? ` --steps ${stepIds.join(",")}` : "") +
            (data.targetOrg ? ` --target-org ${data.targetOrg}` : "");
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
  const [configRes, apexScripts, sfdmuWorkspaces, permissionSets, orgs] =
    await Promise.all([
      execSfdxJson("sf hardis:config:org-init --json"),
      listProjectApexScripts(),
      listProjectDataWorkspaces(),
      listProjectPermissionSets(),
      listInitializableOrgs(),
    ]);
  if (!configRes?.result || configRes.status !== 0) {
    throw new Error(
      t("orgInitCliError", {
        message: configRes?.message || configRes?.errorMessage || "",
      }),
    );
  }
  const customFunctions = await listCustomFunctions();
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
    const orgs = await listAllOrgs(false, true, true);
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

// Writes the definition to a temporary file and lets the CLI validate it, as scratch:create would
async function validateScratchDef(content: any): Promise<string[]> {
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "sfdx-hardis-scratch-def-"),
  );
  const tmpFile = path.join(tmpDir, "project-scratch-def.json");
  try {
    await fs.promises.writeFile(
      tmpFile,
      JSON.stringify(content, null, 2),
      "utf8",
    );
    const res = await execSfdxJson(
      `sf hardis:config:org-init --validate-scratch-def "${tmpFile}" --json`,
    );
    if (!res?.result) {
      return [
        t("orgInitCliError", {
          message: res?.message || res?.errorMessage || "",
        }),
      ];
    }
    return res.result.scratchDef?.issues || [];
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function saveScratchDef(
  panel: { sendMessage: (message: any) => void },
  configHelper: SfdxHardisConfigHelper,
  data: any,
): Promise<void> {
  const issues = await validateScratchDef(data.content);
  if (issues.length > 0) {
    panel.sendMessage({ type: "scratchDefValidated", data: { issues } });
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
    panel.sendMessage({ type: "scratchDefSaved", data: { issues: [] } });
    vscode.window.showInformationMessage(t("orgInitScratchDefSaved"));
  } catch (e: any) {
    vscode.window.showErrorMessage(
      t("orgInitSaveError", { message: e?.message || e }),
    );
  }
}
