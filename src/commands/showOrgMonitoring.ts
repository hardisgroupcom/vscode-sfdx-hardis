import * as vscode from "vscode";
import { getWorkspaceRoot } from "../utils";
import { LwcPanelManager } from "../lwc-panel-manager";
import path from "path";
import * as fs from "fs";
import yaml from "js-yaml";
import { Logger } from "../logger";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";
import { t } from "../i18n/i18n";
import { DOCSITE_URL } from "../constants";
import {
  fetchMonitoringCatalog,
  clearMonitoringCatalogCache,
  MonitoringCatalogPayload,
} from "../utils/monitoringConfigUtils";
import { readSfdxHardisConfig } from "../utils/sfdx-hardis-config-utils";

async function safeFetchMonitoringCatalog(): Promise<MonitoringCatalogPayload | null> {
  try {
    return await fetchMonitoringCatalog();
  } catch (error: any) {
    Logger.log(
      "Error fetching monitoring catalog for Org Monitoring panel: " +
        (error?.message || error),
    );
    return null;
  }
}

export function registerShowOrgMonitoring(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showOrgMonitoring",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      // Check if org monitoring is installed
      const isInstalled = await checkOrgMonitoringInstallation();

      // Detect if this workspace is a DevOps/CI-CD repository by presence of manifest/package.xml
      const workspaceRoot = getWorkspaceRoot();
      const ciCdManifestPath = path.join(
        workspaceRoot || "",
        "manifest",
        "package.xml",
      );
      const isCiCdRepo = fs.existsSync(ciCdManifestPath);

      // Read optional monitoring repository URL from .sfdx-hardis.yml
      // (root file first, then config/.sfdx-hardis.yml, like every other
      // consumer of the project configuration)
      let monitoringRepository: string | null = null;
      try {
        const projectConfig = await readSfdxHardisConfig();
        monitoringRepository =
          projectConfig?.monitoring_repository ||
          projectConfig?.monitoringRepository ||
          null;
      } catch (e) {
        Logger.log(`Unable to read monitoring_repository from config: ${e}`);
      }

      const instanceUrl = await resolveMonitoringInstanceUrl();

      const panel = lwcManager.getOrCreatePanel("s-org-monitoring", {
        isInstalled: isInstalled,
        isCiCdRepo: isCiCdRepo,
        monitoringRepository: monitoringRepository,
        instanceUrl: instanceUrl,
        monitoringHomeUrl: DOCSITE_URL + "/salesforce-monitoring-home/",
        monitoringConfigUrl:
          DOCSITE_URL + "/salesforce-monitoring-config-home/",
        catalog: null,
        catalogLoading: true,
      });
      // Fetch the catalog in the background so the page renders immediately.
      safeFetchMonitoringCatalog().then((catalog) => {
        if (panel.isDisposed && panel.isDisposed()) {
          return;
        }
        panel.sendMessage({
          type: "monitoringCatalogLoaded",
          data: { catalog },
        });
      });
      panel.updateTitle(t("orgMonitoringWorkbench"));

      // Handle messages from the Org Monitoring panel
      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "checkOrgMonitoringInstallation": {
            const currentStatus = await checkOrgMonitoringInstallation();
            const instanceUrl2 = await resolveMonitoringInstanceUrl();
            // Recompute CI/CD detection and config in case workspace changed
            const workspaceRoot2 = getWorkspaceRoot();
            const ciCdManifestPath2 = path.join(
              workspaceRoot2 || "",
              "manifest",
              "package.xml",
            );
            const isCiCdRepo2 = fs.existsSync(ciCdManifestPath2);
            let monitoringRepository2: string | null = null;
            try {
              const projectConfig2 = await readSfdxHardisConfig();
              monitoringRepository2 =
                projectConfig2?.monitoring_repository ||
                projectConfig2?.monitoringRepository ||
                null;
            } catch (e) {
              Logger.log(
                `Unable to read monitoring_repository from config: ${e}`,
              );
            }
            // Refresh implies the user wants the latest data: bust the cached catalog
            // and tell the LWC to show the spinner while we re-fetch in the background.
            await clearMonitoringCatalogCache();
            panel.sendMessage({
              type: "installationStatusUpdated",
              data: {
                isInstalled: currentStatus,
                isCiCdRepo: isCiCdRepo2,
                monitoringRepository: monitoringRepository2,
                instanceUrl: instanceUrl2,
                catalogLoading: true,
              },
            });
            safeFetchMonitoringCatalog().then((refreshedCatalog) => {
              if (panel.isDisposed && panel.isDisposed()) {
                return;
              }
              panel.sendMessage({
                type: "monitoringCatalogLoaded",
                data: { catalog: refreshedCatalog },
              });
            });
            break;
          }
          case "viewPackageConfig": {
            const packageConfig = data || {};
            await showPackageXmlPanel(packageConfig);
            break;
          }
          case "openMonitoringConfig": {
            await vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showMonitoringConfig",
            );
            break;
          }
          default:
            break;
        }
      });
    },
  );
  commands.disposables.push(disposable);
}

async function checkOrgMonitoringInstallation(): Promise<boolean> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    return false;
  }

  const packageSkipItemsPath = path.join(
    workspaceRoot,
    "manifest",
    "package-skip-items.xml",
  );

  try {
    return fs.existsSync(packageSkipItemsPath);
  } catch (error) {
    Logger.log("Error checking org monitoring installation: " + error);
    return false;
  }
}

async function resolveMonitoringInstanceUrl(): Promise<string | null> {
  try {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      return null;
    }
    const configPath = path.join(workspaceRoot, ".sfdx-hardis.yml");
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw) as any;
    const instanceUrl =
      (parsed && (parsed.instanceUrl || parsed.instance_url)) || null;
    return instanceUrl || null;
  } catch (error) {
    Logger.log("Error resolving monitoring instance URL: " + error);
    return null;
  }
}
