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
import simpleGit from "simple-git";
import { gitRemoteToHttps } from "../utils/gitUrlUtils";

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
      const deploymentRepository = await resolveDeploymentRepository();

      const panel = lwcManager.getOrCreatePanel("s-org-monitoring", {
        isInstalled: isInstalled,
        isCiCdRepo: isCiCdRepo,
        monitoringRepository: monitoringRepository,
        deploymentRepository: deploymentRepository,
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
      watchDeploymentRepository(panel);

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
                deploymentRepository: await resolveDeploymentRepository(),
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
          case "openDeploymentRepository": {
            const repositoryUrl = await resolveDeploymentRepository();
            if (repositoryUrl) {
              await openRepositoryInNewWindow(repositoryUrl);
            }
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

// In a monitoring repository, deploymentRepository is the CI/CD repository that deploys to the
// monitored org: the mirror of monitoringRepository in that CI/CD repository
async function resolveDeploymentRepository(): Promise<string | null> {
  try {
    const config = await readSfdxHardisConfig();
    const value = config?.deploymentRepository;
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  } catch (e) {
    Logger.log(`Unable to read deploymentRepository from config: ${e}`);
  }
  return null;
}

// deploymentRepository is set by sf hardis:org:configure:monitoring-deployment-repository, which the
// panel runs: the CLI validates, suggests and writes the value. Watch the file it writes, so the panel
// shows the new value as soon as the command (or a hand edit) saves it.
let _monitoringConfigWatcher: vscode.FileSystemWatcher | null = null;

function watchDeploymentRepository(panel: any) {
  _monitoringConfigWatcher?.dispose();
  _monitoringConfigWatcher = null;
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    return;
  }
  _monitoringConfigWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, ".sfdx-hardis.yml"),
  );
  const pushDeploymentRepository = async () => {
    if (panel.isDisposed()) {
      _monitoringConfigWatcher?.dispose();
      _monitoringConfigWatcher = null;
      return;
    }
    panel.sendMessage({
      type: "deploymentRepositoryUpdated",
      data: { deploymentRepository: await resolveDeploymentRepository() },
    });
  };
  _monitoringConfigWatcher.onDidChange(pushDeploymentRepository);
  _monitoringConfigWatcher.onDidCreate(pushDeploymentRepository);
  _monitoringConfigWatcher.onDidDelete(pushDeploymentRepository);
  LwcPanelManager.getInstance().setDisposalCallback("s-org-monitoring", () => {
    _monitoringConfigWatcher?.dispose();
    _monitoringConfigWatcher = null;
  });
}

// Opens the repository in a new VS Code window, from the clone next to this repository
// (the place the monitoring AGENTS.md tells coding agents to use), cloning it there if needed
async function openRepositoryInNewWindow(repositoryUrl: string) {
  const browsableUrl = gitRemoteToHttps(repositoryUrl);
  const repositoryName = browsableUrl.split("/").pop() || "";
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot || !repositoryName) {
    if (browsableUrl) {
      vscode.env.openExternal(vscode.Uri.parse(browsableUrl));
    }
    return;
  }
  const targetFolder = path.join(path.dirname(workspaceRoot), repositoryName);
  if (fs.existsSync(targetFolder)) {
    let origin = "";
    try {
      origin =
        (await simpleGit(targetFolder).remote(["get-url", "origin"])) || "";
    } catch (e) {
      Logger.log(`Unable to read the origin of ${targetFolder}: ${e}`);
    }
    if (
      gitRemoteToHttps(origin.trim()).toLowerCase() !==
      browsableUrl.toLowerCase()
    ) {
      const openAnyway = t("deploymentRepositoryOpenFolderAnyway");
      const openInBrowser = t("deploymentRepositoryOpenInBrowser");
      const choice = await vscode.window.showWarningMessage(
        t("deploymentRepositoryFolderOtherRemote", { folder: targetFolder }),
        openAnyway,
        openInBrowser,
      );
      if (choice === openInBrowser && browsableUrl) {
        vscode.env.openExternal(vscode.Uri.parse(browsableUrl));
        return;
      }
      if (choice !== openAnyway) {
        return;
      }
    }
  } else {
    const cloneLabel = t("deploymentRepositoryClone");
    const confirm = await vscode.window.showInformationMessage(
      t("deploymentRepositoryCloneConfirm", {
        url: browsableUrl,
        folder: targetFolder,
      }),
      { modal: true },
      cloneLabel,
    );
    if (confirm !== cloneLabel) {
      return;
    }
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("deploymentRepositoryCloning", { url: browsableUrl }),
        },
        () =>
          simpleGit(path.dirname(targetFolder)).clone(
            repositoryUrl,
            targetFolder,
          ),
      );
    } catch (e: any) {
      Logger.log(`Unable to clone ${browsableUrl}: ${e?.message || e}`);
      const openInBrowser = t("deploymentRepositoryOpenInBrowser");
      const choice = await vscode.window.showErrorMessage(
        t("deploymentRepositoryCloneFailed"),
        openInBrowser,
      );
      if (choice === openInBrowser && browsableUrl) {
        vscode.env.openExternal(vscode.Uri.parse(browsableUrl));
      }
      return;
    }
  }
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(targetFolder),
    { forceNewWindow: true },
  );
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
