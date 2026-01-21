import * as vscode from "vscode";
import { getWorkspaceRoot } from "../utils";
import { LwcPanelManager } from "../lwc-panel-manager";
import path from "path";
import * as fs from "fs-extra";
import yaml from "js-yaml";
import { Logger } from "../logger";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";

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

      // Read optional monitoring repository URL from config/.sfdx-hardis.yml (monitoring_repository)
      let monitoringRepository: string | null = null;
      try {
        const configPath = path.join(
          workspaceRoot || "",
          "config",
          ".sfdx-hardis.yml",
        );
        if (fs.existsSync(configPath)) {
          const raw = fs.readFileSync(configPath, "utf8");
          const parsed = yaml.load(raw) as any;
          monitoringRepository =
            parsed?.monitoring_repository ||
            parsed?.monitoringRepository ||
            null;
        }
      } catch (e) {
        Logger.log(`Unable to read monitoring_repository from config: ${e}`);
      }

      const instanceUrl = await resolveMonitoringInstanceUrl();

      const panel = lwcManager.getOrCreatePanel("s-org-monitoring", {
        isInstalled: isInstalled,
        isCiCdRepo: isCiCdRepo,
        monitoringRepository: monitoringRepository,
        instanceUrl: instanceUrl,
      });
      panel.updateTitle("Org Monitoring Workbench");

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
              const configPath2 = path.join(
                workspaceRoot2 || "",
                "config",
                ".sfdx-hardis.yml",
              );
              if (fs.existsSync(configPath2)) {
                const raw2 = fs.readFileSync(configPath2, "utf8");
                const parsed2 = yaml.load(raw2) as any;
                monitoringRepository2 =
                  parsed2?.monitoring_repository ||
                  parsed2?.monitoringRepository ||
                  null;
              }
            } catch (e) {
              Logger.log(
                `Unable to read monitoring_repository from config: ${e}`,
              );
            }
            panel.sendMessage({
              type: "installationStatusUpdated",
              data: {
                isInstalled: currentStatus,
                isCiCdRepo: isCiCdRepo2,
                monitoringRepository: monitoringRepository2,
                instanceUrl: instanceUrl2,
              },
            });
            break;
          }
          case "viewPackageConfig": {
            const packageConfig = data || {};
            await showPackageXmlPanel(packageConfig);
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
