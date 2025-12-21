import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { listAllOrgs, SalesforceOrg } from "../utils/orgUtils";
import {
  execSfdxJson,
  getDefaultTargetOrgUsername,
  getSfdxProjectJson,
  getUsernameInstanceUrl,
  getWorkspaceRoot,
  listSfdxProjectPackageDirectories,
  getReportDirectory,
} from "../utils";
import { Logger } from "../logger";
import { listMetadataTypes } from "../utils/metadataList";
import { openMetadataFile } from "../utils/projectUtils";
import fg from "fast-glob";
import * as path from "path";
import * as fs from "fs-extra";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { generatePackageXml, mergeIntoPackageXml } from "./packageXml";

type LocalPackageOption = { label: string; value: string };

class DefaultLocalPackageGuard {
  private initialDefaultPackagePath: string | null = null;

  public setInitialDefaultPackagePathIfEmpty(packagePath: string | null): void {
    if (!this.initialDefaultPackagePath) {
      this.initialDefaultPackagePath = packagePath;
    }
  }

  public getInitialDefaultPackagePath(): string | null {
    return this.initialDefaultPackagePath;
  }

  public async restoreInitialDefaultIfNeeded(): Promise<void> {
    if (!this.initialDefaultPackagePath) {
      return;
    }

    try {
      const current = await getDefaultPackageDirectoryPathFromSfdxProjectJson();
      if (
        current &&
        normalizeSfdxProjectPath(current) !==
          normalizeSfdxProjectPath(this.initialDefaultPackagePath)
      ) {
        await setDefaultPackageDirectoryPathInSfdxProjectJson(
          this.initialDefaultPackagePath,
        );
      }
    } catch {
      // ignore restore failures
    }
  }
}

const defaultLocalPackageGuard = new DefaultLocalPackageGuard();
let packageGuardDisposableRegistered = false;

function normalizeSfdxProjectPath(p: string): string {
  return (p || "")
    .toString()
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

function getSfdxProjectJsonFullPath(): string {
  return path.join(getWorkspaceRoot(), "sfdx-project.json");
}

async function readSfdxProjectJsonFromDisk(): Promise<any> {
  const pjPath = getSfdxProjectJsonFullPath();
  const txt = await fs.readFile(pjPath, "utf8");
  return JSON.parse(txt || "{}");
}

async function writeSfdxProjectJsonToDisk(pj: any): Promise<void> {
  const pjPath = getSfdxProjectJsonFullPath();
  await fs.writeFile(pjPath, JSON.stringify(pj, null, 2) + "\n", "utf8");
}

function getDefaultPackageDirectoryPathFromProjectJson(pj: any): string | null {
  if (!pj || !Array.isArray(pj.packageDirectories) || pj.packageDirectories.length === 0) {
    return null;
  }

  const found = pj.packageDirectories.find(
    (d: any) => d && d.default === true && d.path,
  );
  if (found && found.path) {
    return found.path.toString();
  }

  const first = pj.packageDirectories.find((d: any) => d && d.path);
  return first && first.path ? first.path.toString() : null;
}

async function getDefaultPackageDirectoryPathFromSfdxProjectJson(): Promise<string | null> {
  try {
    const pj = await readSfdxProjectJsonFromDisk();
    return getDefaultPackageDirectoryPathFromProjectJson(pj);
  } catch {
    return null;
  }
}

async function setDefaultPackageDirectoryPathInSfdxProjectJson(packagePath: string): Promise<void> {
  const normalizedTarget = normalizeSfdxProjectPath(packagePath);
  const pj = await readSfdxProjectJsonFromDisk();

  if (!pj || !Array.isArray(pj.packageDirectories) || pj.packageDirectories.length === 0) {
    return;
  }

  let matched = false;
  pj.packageDirectories = pj.packageDirectories.map((d: any) => {
    if (!d || !d.path) {
      return d;
    }

    const normalizedEntry = normalizeSfdxProjectPath(d.path.toString());
    if (normalizedEntry === normalizedTarget) {
      matched = true;
      return { ...d, default: true };
    }

    if (d.default === true) {
      const clone = { ...d };
      delete clone.default;
      return clone;
    }
    return d;
  });

  if (!matched) {
    return;
  }

  await writeSfdxProjectJsonToDisk(pj);
}

async function getLocalPackageOptionsFromSfdxProjectJson(): Promise<{
  options: LocalPackageOption[];
  defaultValue: string | null;
}> {
  try {
    const pj = await readSfdxProjectJsonFromDisk();
    const dirs: any[] = Array.isArray(pj.packageDirectories)
      ? pj.packageDirectories
      : [];
    const options: LocalPackageOption[] = dirs
      .filter((d) => d && d.path)
      .map((d) => {
        const p = d.path.toString();
        return { label: p, value: p };
      });

    const defaultValue = getDefaultPackageDirectoryPathFromProjectJson(pj);
    return {
      options,
      defaultValue: defaultValue || (options.length > 0 ? options[0].value : null),
    };
  } catch {
    return { options: [], defaultValue: null };
  }
}

export function registerShowMetadataRetriever(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showMetadataRetriever",
    async () => {
      // Get selected org username
      let selectedOrgUsername: string | null = null;
      let instanceUrl: string | null = null;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Initializing Metadata Retriever...",
          cancellable: false,
        },
        async () => {
          try {
            selectedOrgUsername = await getDefaultTargetOrgUsername();
            instanceUrl = await getUsernameInstanceUrl(
              selectedOrgUsername || "",
            );
          } catch (err: any) {
            Logger.log(`Error detecting default org: ${err?.message || err}`);
            vscode.window.showWarningMessage(
              "Could not detect default org. Please select an org in the UI.",
            );
          }
        },
      );
      const connectedOrgs: SalesforceOrg[] = selectedOrgUsername
        ? [
            {
              username: selectedOrgUsername,
              isDefaultUsername: true,
              connectedStatus: "Connected",
              instanceUrl: instanceUrl || "",
            },
          ]
        : [];

      // Get metadata types list
      const metadataTypes = listMetadataTypes();
      const metadataTypeOptions = metadataTypes
        .map((mt) => ({
          label: mt.xmlName,
          value: mt.xmlName,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      // Determine whether local file checking is available by looking for sfdx-project.json
      const packageDirs = await listSfdxProjectPackageDirectories();

      // Local package combobox options (from sfdx-project.json)
      const {
        options: localPackageOptions,
        defaultValue: defaultLocalPackage,
      } = await getLocalPackageOptionsFromSfdxProjectJson();
      defaultLocalPackageGuard.setInitialDefaultPackagePathIfEmpty(
        defaultLocalPackage,
      );

      // Ensure we restore initial default when extension deactivates
      if (!packageGuardDisposableRegistered) {
        packageGuardDisposableRegistered = true;
        commands.disposables.push(
          new vscode.Disposable(() => {
            void defaultLocalPackageGuard.restoreInitialDefaultIfNeeded();
          }),
        );
      }

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-metadata-retriever",
        {
          orgs: connectedOrgs,
          selectedOrgUsername: selectedOrgUsername,
          metadataTypes: metadataTypeOptions,
          checkLocalAvailable: packageDirs.length > 0,
          packageDirectories: packageDirs,
          localPackageOptions,
          defaultLocalPackage,
        },
      );

      const logoUri = panel.asWebviewUri(["logo-m.png"]);
      panel.sendMessage({
        type: "imageResources",
        data: {
          images: {
            featureLogo: logoUri,
          },
        },
      });

      panel.updateTitle("Metadata Retriever");
      // Register message handlers
      panel.onMessage(async (type: string, data: any) => {
        if (type === "listOrgs") {
          await handleListOrgs(panel);
        } else if (type === "queryMetadata") {
          await handleQueryMetadata(panel, data);
        } else if (type === "listPackages") {
          await handleListPackages(
            panel,
            data && data.username ? data.username : null,
          );
        } else if (type === "listMetadataTypes") {
          await handleListMetadataTypes(
            panel,
            data && data.username ? data.username : null,
          );
        } else if (type === "retrieveMetadata") {
          await handleRetrieveMetadata(panel, data);
        } else if (type === "retrieveSelectedMetadata") {
          await handleRetrieveSelectedMetadata(panel, data);
        } else if (type === "openMetadataFile") {
          const metadataType = data?.metadataType;
          const metadataName = data?.metadataName;
          if (metadataType && metadataName) {
            await openMetadataFile(metadataType, metadataName);
          }
        } else if (type === "openRetrieveFolder") {
          await handleOpenRetrieveFolder();
        } else if (type === "panelDisposed") {
          await defaultLocalPackageGuard.restoreInitialDefaultIfNeeded();
        }
      });
    },
  );
  commands.disposables.push(disposable);
}

async function handleListOrgs(panel: LwcUiPanel) {
  // List all orgs and get default one
  const orgs = await listAllOrgs(false);

  // Filter connected orgs and find default from the connected list
  // Include both regular orgs (connectedStatus: "Connected") and scratch orgs (status: "Active")
  const connectedOrgs = orgs.filter(
    (org) => org.connectedStatus === "Connected" || org.status === "Active",
  );
  const selectedOrg =
    connectedOrgs.find((org) => org.isDefaultUsername) || connectedOrgs[0];
  panel.sendMessage({
    type: "listOrgsResults",
    data: {
      orgs: connectedOrgs,
      selectedOrgUsername: selectedOrg?.username || null,
    },
  });
}

/**
 * Generate package.xml files for successfully retrieved metadata
 * Creates:
 * 1. A timestamped file: retrieved-package-YYYYMMDD-HHMMSS.xml
 * 2. Updates the global all-retrieved-package.xml with all retrieved metadata
 */
async function generateRetrievePackageXmls(
  successfulFiles: any[],
): Promise<void> {
  if (!successfulFiles || successfulFiles.length === 0) {
    return;
  }

  // Convert successful files to metadata list format
  const metadataList = successfulFiles.map((f: any) => ({
    memberType: f.type,
    memberName: f.fullName,
  }));

  // Get API version from project
  const sfdxProject = getSfdxProjectJson();
  const apiVersion = sfdxProject?.sourceApiVersion || "65.0";

  // Get report directory and create retrieve subdirectory
  const reportDir = await getReportDirectory();
  const retrieveDir = path.join(reportDir, "retrieve");
  await fs.ensureDir(retrieveDir);

  // Generate timestamp for the file name
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");

  // Generate and save timestamped package.xml
  const timestampedPackageXml = generatePackageXml(metadataList, apiVersion);
  const timestampedFilePath = path.join(
    retrieveDir,
    `retrieved-package-${timestamp}.xml`,
  );
  await fs.writeFile(timestampedFilePath, timestampedPackageXml, {
    encoding: "utf8",
  });
  Logger.log(`Generated retrieve package.xml: ${timestampedFilePath}`);

  // Merge into global all-retrieved-package.xml
  const globalPackageXmlPath = path.join(
    retrieveDir,
    "all-retrieved-package.xml",
  );
  await mergeIntoPackageXml(globalPackageXmlPath, metadataList, apiVersion);
  Logger.log(`Updated global package.xml: ${globalPackageXmlPath}`);
}

async function executeMetadataRetrieve(
  username: string,
  metadataList: any[],
  displayTitle: string,
  panel: LwcUiPanel,
  forceOverwrite = false,
  localPackagePath: string | null = null,
): Promise<any> {
  // Lock local package selector while retrieving
  try {
    panel.sendMessage({
      type: "retrieveState",
      data: { isRetrieving: true },
    });
  } catch {
    // ignore
  }

  // Switch default package directory only for the duration of the retrieve
  const initialDefaultPackage = defaultLocalPackageGuard.getInitialDefaultPackagePath();
  const shouldSwitchPackage =
    !!localPackagePath &&
    !!initialDefaultPackage &&
    normalizeSfdxProjectPath(localPackagePath) !==
      normalizeSfdxProjectPath(initialDefaultPackage);

  if (shouldSwitchPackage) {
    try {
      await setDefaultPackageDirectoryPathInSfdxProjectJson(localPackagePath as string);
    } catch (e: any) {
      Logger.log(
        `Failed to switch default package in sfdx-project.json: ${e?.message || e}`,
      );
    }
  }

  // Split metadata list and create separate --metadata flags for each item
  const workspaceRoot = getWorkspaceRoot();
  const metadataItems = metadataList
    .filter((item) => !(item?.deleted === true))
    .map((item) => `--metadata "${item.memberType}:${item.memberName}"`)
    .join(" ");
  const command =
    `sf project retrieve start ${metadataItems} --target-org ${username}` +
    (forceOverwrite ? " --ignore-conflicts" : "") +
    " --json";
  Logger.log(`Retrieving metadata: ${command}`);

  let result: any = null;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: displayTitle,
        cancellable: false,
      },
      async (_progress) => {
        return await execSfdxJson(command, { cwd: workspaceRoot });
      },
    );

    // Suggest user to force in case of conflicts
    if (result.code === "SourceConflictError") {
      const choice = await vscode.window.showErrorMessage(
        `Failed to retrieve metadata due to source conflicts.`,
        "I don't care, overwrite! 🤪",
        "Ok, nevermind 😑",
      );
      if (choice === "I don't care, overwrite! 🤪") {
        return await executeMetadataRetrieve(
          username,
          metadataList,
          displayTitle,
          panel,
          true,
          localPackagePath,
        );
      }
    }

    // Command line too long: Create a package.xml in a temp dir and use --manifest
    const errorMsg = result?.error?.message || "";
    if (
      errorMsg.includes(`command line is too long`) ||
      errorMsg.includes(`ligne de commande est trop longue`) ||
      errorMsg.includes(`ENAMETOOLONG`)
    ) {
      const tempDir = await fs.mkdtemp(
        path.join(require("os").tmpdir(), "sfdx-retrieve-"),
      );
      const tmpPackageXml = path.join(tempDir, "package.xml");
      // Group metadata by type
      const metadataByType = new Map<string, string[]>();

      metadataList
        .filter((item) => !(item?.deleted === true))
        .forEach((item) => {
          if (!metadataByType.has(item.memberType)) {
            metadataByType.set(item.memberType, []);
          }
          metadataByType.get(item.memberType)!.push(item.memberName);
        });
      const sfdxProject = getSfdxProjectJson();
      const apiVersion = sfdxProject?.sourceApiVersion || "65.0";
      // Build package.xml content with grouped types
      const typesBlocks = Array.from(metadataByType.entries())
        .map(
          ([memberType, memberNames]) =>
            `  <types>\n${memberNames.map((name) => `    <members>${name}</members>`).join("\n")}\n    <name>${memberType}</name>\n  </types>`,
        )
        .join("\n");

      const packageXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
    <Package xmlns="http://soap.sforce.com/2006/04/metadata">
    ${typesBlocks}
      <version>${apiVersion}</version>
    </Package>`;
      await fs.writeFile(tmpPackageXml, packageXmlContent, {
        encoding: "utf8",
      });
      const commandManifest =
        `sf project retrieve start --manifest "${tmpPackageXml}" --target-org ${username}` +
        (forceOverwrite ? " --ignore-conflicts" : "") +
        " --json";
      Logger.log(`Retrieving metadata with manifest: ${commandManifest}`);
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title:
            "Retrieving metadata (using manifest to avoid too long command line)...",
          cancellable: false,
        },
        async (_progress) => {
          return await execSfdxJson(commandManifest, { cwd: workspaceRoot });
        },
      );
      // Clean up temp dir
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    // Delete files corresponding to deleted items
    const deletedItems = metadataList.filter((item) => item?.deleted === true);
    if (deletedItems.length > 0) {
      const packages = await listSfdxProjectPackageDirectories();
      const metadataTypes = listMetadataTypes();
      const deletedItemsSuccess: any = [];
      for (const delItem of deletedItems) {
        const metadataType = metadataTypes.find(
          (mt) => mt.xmlName === delItem.memberType,
        );
        if (!metadataType) {
          continue;
        }
        const candidateGlobPatterns = [
          ...buildMetadataKeys(delItem.memberName, metadataType),
        ];
        const fileSearchPatterns = candidateGlobPatterns.flatMap((pattern) => {
          return packages.map((pkgDir) =>
            path.join(pkgDir, "**", pattern).replace(/\\/g, "/"),
          );
        });
        const filesToDelete = await fg(fileSearchPatterns, { dot: true });
        for (const filePath of filesToDelete) {
          try {
            await fs.rm(filePath);
            deletedItemsSuccess.push(delItem);
          } catch (err) {
            Logger.log(`Error deleting file ${filePath}: ${err}`);
          }
        }
      }
      if (deletedItemsSuccess.length > 0) {
        panel.sendMessage({
          type: "postRetrieveLocalCheck",
          data: { files: [], deletedFiles: deletedItemsSuccess },
        });
        vscode.window
          .showInformationMessage(
            `Successfully deleted ${deletedItemsSuccess.length} local file(s) corresponding to deleted metadata.`,
            "View and commit files",
          )
          .then((action) => {
            if (action === "View and commit files") {
              vscode.commands.executeCommand("workbench.view.scm");
            }
          });
      }
    }

    // Prepare singleName here so it's available both when result has content and in the fallback error branch
    let singleName: string | null = null;

    // Check if command executed and has result
    if (result && result.result) {
      const retrieveResult = result.result;
      const success = retrieveResult.success === true;
      const files = retrieveResult.files || [];
      const messages = retrieveResult.messages || [];

      // If only one metadata item was requested or returned, compute a readable name
      // Format: "MemberType: MemberName"
      try {
        if (files && files.length === 1) {
          const f = files[0] as any;
          if (f && f.type && f.fullName) {
            singleName = `${f.type}: ${f.fullName}`;
          }
        }
      } catch {
        // ignore
      }
      if (!singleName && metadataList) {
        const requested = metadataList.map(
          (s) => `${s.memberType}: ${s.memberName}`,
        );
        if (requested.length === 1) {
          singleName = requested[0];
        }
      }

      // Count successful and failed files
      const successfulFiles = files.filter((f: any) => f.state !== "Failed");
      const failedFiles = files.filter((f: any) => f.state === "Failed");

      // Build result message
      let resultMessage = "";
      if (successfulFiles.length > 0) {
        resultMessage += `Successfully retrieved ${successfulFiles.length} file(s)`;
      }

      // Display success or warning. If at least one file succeeded, offer "View and commit files" action
      if (successfulFiles.length > 0) {
        // If everything succeeded and overall command success, use information message; otherwise warn
        const title =
          failedFiles.length === 0 && success
            ? resultMessage || "Metadata retrieved successfully"
            : `${resultMessage}${failedFiles.length > 0 ? `, but ${failedFiles.length} failed` : ""}`;
        const titleWithName = singleName ? `${title} (${singleName})` : title;

        // Collect error details for partial failures
        const errorDetails: string[] = [];
        if (messages.length > 0) {
          messages.forEach((msg: any) => {
            const error = `${msg.fileName}: ${msg.problem}`;
            errorDetails.push(error);
            Logger.log(`Retrieve error - ${error}`);
          });
        }

        const displayMsg =
          errorDetails.length > 0
            ? `${titleWithName}. Errors: ${errorDetails.slice(0, 3).join("; ")}${errorDetails.length > 3 ? ` (and ${errorDetails.length - 3} more - see logs)` : ""}`
            : titleWithName;

        const promAction =
          failedFiles.length === 0 && success
            ? vscode.window.showInformationMessage(
                titleWithName,
                "View and commit files",
              )
            : vscode.window.showWarningMessage(
                displayMsg,
                "View and commit files",
                "View logs",
              );
        promAction.then((action) => {
          if (action === "View and commit files") {
            vscode.commands.executeCommand("workbench.view.scm");
          } else if (action === "View logs") {
            Logger.showOutputChannel();
          }
        });

        // After a retrieve that returned at least one successful file, re-check local files and notify webview if present
        try {
          // Build minimal records expected by annotateLocalFiles
          const recordsToAnnotate = successfulFiles.map((f: any) => ({
            MemberType: f.type,
            MemberName: f.fullName,
            fullName: f.fullName,
          }));
          const recordsSuccessAnnotated =
            await annotateLocalFiles(recordsToAnnotate);
          // Add failed downloads
          const recordsFailed = failedFiles.map((f: any) => ({
            MemberType: f.type,
            MemberName: f.fullName,
            fullName: f.fullName,
            LocalFileExists: false,
          }));
          const resultRecords = [...recordsSuccessAnnotated, ...recordsFailed];
          panel.sendMessage({
            type: "postRetrieveLocalCheck",
            data: { files: resultRecords },
          });
        } catch {
          // non-fatal
        }

        // Generate package.xml files for successful retrieval
        try {
          await generateRetrievePackageXmls(successfulFiles);
        } catch (error: any) {
          Logger.log(
            `Non-fatal error generating retrieve package.xml: ${error.message}`,
          );
        }
      } else {
        // No successful files at all - show warning with details if any
        const errorDetails: string[] = [];
        if (messages.length > 0) {
          messages.forEach((msg: any) => {
            const error = `${msg.fileName}: ${msg.problem}`;
            errorDetails.push(error);
            Logger.log(`Retrieve error - ${error}`);
          });
        }
        failedFiles.forEach((file: any) => {
          const error = `${file.type}: ${file.fullName} - ${file.error}`;
          errorDetails.push(error);
          Logger.log(`Failed to retrieve ${error}`);
        });

        if (failedFiles.length > 0) {
          const recordsFailed = failedFiles.map((f: any) => ({
            MemberType: f.type,
            MemberName: f.fullName,
            fullName: f.fullName,
            LocalFileExists: false,
          }));
          panel.sendMessage({
            type: "postRetrieveLocalCheck",
            data: { files: recordsFailed },
          });
        }

        if (errorDetails.length > 0) {
          const displayErrors = errorDetails.slice(0, 3).join("; ");
          const moreErrors =
            errorDetails.length > 3
              ? ` (and ${errorDetails.length - 3} more - see logs)`
              : "";
          const msg = `Failed to retrieve ${failedFiles.length} file(s)${singleName ? ` (${singleName})` : ""}. Errors: ${displayErrors}${moreErrors}`;
          vscode.window.showWarningMessage(msg, "View logs").then((action) => {
            if (action === "View logs") {
              Logger.showOutputChannel();
            }
          });
        } else {
          const msg = `Failed to retrieve ${failedFiles.length} file(s)${singleName ? ` (${singleName})` : ""}`;
          vscode.window.showWarningMessage(msg, "View logs").then((action) => {
            if (action === "View logs") {
              Logger.showOutputChannel();
            }
          });
        }
      }
    } else {
      const errorMsg =
        result?.error?.message || result?.message || "Unknown error occurred";
      const msg = singleName
        ? `Failed to retrieve ${singleName}: ${errorMsg}`
        : `Failed to retrieve metadata: ${errorMsg}`;
      Logger.log("Retrieve result:" + JSON.stringify(result));
      vscode.window.showErrorMessage(msg, "View logs").then((action) => {
        if (action === "View logs") {
          Logger.showOutputChannel();
        }
      });
    }
  } catch (error: any) {
    Logger.log(`Error retrieving metadata: ${error.message}`);
    vscode.window
      .showErrorMessage(
        `Failed to retrieve metadata: ${error.message}`,
        "View logs",
      )
      .then((action) => {
        if (action === "View logs") {
          Logger.showOutputChannel();
        }
      });
  }

  // Always restore initial default package as a safety net
  try {
    await defaultLocalPackageGuard.restoreInitialDefaultIfNeeded();
  } catch {
    // ignore
  }

  // Unlock local package selector
  try {
    panel.sendMessage({
      type: "retrieveState",
      data: { isRetrieving: false },
    });
  } catch {
    // ignore
  }
  return result;
}

async function handleQueryMetadata(panel: any, data: any) {
  try {
    const {
      username,
      queryMode,
      metadataType,
      metadataName,
      lastUpdatedBy,
      dateFrom,
      dateTo,
      packageFilter,
      checkLocalFiles,
    } = data;

    if (!username) {
      panel.sendMessage({
        type: "queryError",
        data: { message: "Missing required parameters" },
      });
      return;
    }

    // Handle different query modes
    if (queryMode === "allMetadata") {
      await handleListMetadata(
        panel,
        username,
        metadataType,
        metadataName,
        packageFilter,
        !!checkLocalFiles,
      );
    } else {
      // Default to recentChanges mode (SourceMember query)
      await handleSourceMemberQuery(
        panel,
        username,
        metadataType,
        metadataName,
        lastUpdatedBy,
        dateFrom,
        dateTo,
        packageFilter,
        !!checkLocalFiles,
      );
    }
  } catch (error: any) {
    Logger.log(`Error querying metadata: ${error.message}`);
    panel.sendMessage({
      type: "queryError",
      data: { message: error.message || "Failed to query metadata" },
    });
  }
}

/**
 * Determines if a metadata component (fullName) is local or packaged.
 * Local = component segment ends with an official Salesforce suffix (__c, __r, __x, __s, __mdt, __b)
 *         AND has only one __ (the suffix itself, no namespace prefix)
 * Packaged = component segment has multiple __ (namespace prefix + other separators) or has __ without official suffix
 *
 * Examples:
 * - "SBQQ__Field__c" -> packaged (2x __, namespace SBQQ__ + suffix __c)
 * - "LocalField__c" -> local (1x __, which is the __c suffix)
 * - "CodeBuilder__CodeBuilderGroup" -> packaged (1x __, but no official suffix = namespace prefix)
 * - "Account.Name" -> local (0x __, standard field)
 * - "SBQQ__Cpq__c.LocalField__c" -> local (component is LocalField__c, 1x __, official suffix)
 * - "MyNamespace__CpqField__c" -> packaged (2x __)
 *
 * @param fullName The complete fullName
 * @returns true if local, false if packaged
 */
function isLocalMetadata(fullName: string): boolean {
  // Extract component segment (after last '.')
  const compName = fullName.includes(".")
    ? fullName.split(".").pop() || fullName
    : fullName;

  // Count total occurrences of __
  const doubleUnderscoreCount = (compName.match(/__/g) || []).length;

  // If no __, it's local (standard metadata)
  if (doubleUnderscoreCount === 0) {
    return true;
  }

  // If exactly one __, check if it's an official suffix
  if (doubleUnderscoreCount === 1) {
    const officialSuffixes = ["__c", "__r", "__x", "__s", "__mdt", "__b"];
    const hasOfficialSuffix = officialSuffixes.some((suffix) =>
      compName.endsWith(suffix),
    );
    return hasOfficialSuffix; // local if ends with official suffix
  }

  // Multiple __ -> packaged (has namespace prefix)
  return false;
}

async function handleListPackages(panel: LwcUiPanel, username: string | null) {
  try {
    if (!username) {
      // No username - return default options only
      panel.sendMessage({
        type: "listPackagesResults",
        data: {
          packages: [
            { label: "All", value: "All" },
            { label: "Local", value: "Local" },
          ],
        },
      });
      return;
    }

    // Execute SF command directly from the extension and return results
    try {
      const command = `sf package installed list --target-org ${username} --json`;
      const result = await execSfdxJson(command, {
        cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
        cacheSection: "project",
      });

      const pkgOptions: Array<any> = [];
      // Keep All and Local at the top
      pkgOptions.push({ label: "All", value: "All" });
      pkgOptions.push({ label: "Local", value: "Local" });

      if (
        result &&
        result.status === 0 &&
        Array.isArray(result.result) &&
        result.result.length > 0
      ) {
        // Map by normalized namespace -> keep a single representative (preserve original casing for label)
        const namespaceMap: Map<string, { ns: string; names: Set<string> }> =
          new Map();
        for (const p of result.result) {
          const rawNs = (p.SubscriberPackageNamespace || "").toString();
          const nsTrim = rawNs.trim();
          if (!nsTrim) {
            // empty namespace => local, skip (we already have 'Local')
            continue;
          }
          const key = nsTrim.toLowerCase();
          const name = (p.SubscriberPackageName || p.Name || "")
            .toString()
            .trim();
          if (!namespaceMap.has(key)) {
            namespaceMap.set(key, { ns: nsTrim, names: new Set() });
          }
          const entry = namespaceMap.get(key)!;
          if (name) {
            entry.names.add(name);
          }
        }

        // Build options: for each normalized namespace produce one option
        const namespaceOptions: Array<{ label: string; value: string }> = [];
        for (const entry of namespaceMap.values()) {
          const names = Array.from(entry.names).filter(Boolean);
          names.sort((a, b) => a.localeCompare(b));
          const displayName =
            names.length === 0
              ? entry.ns
              : names.length === 1
                ? names[0]
                : names.join("/");
          const label = `${displayName} (${entry.ns})`;
          namespaceOptions.push({ label: label, value: entry.ns });
        }

        // Sort namespaceOptions alphabetically by label
        namespaceOptions.sort((a, b) => a.label.localeCompare(b.label));

        // Append to pkgOptions after All and Local
        pkgOptions.push(...namespaceOptions);
      }

      panel.sendMessage({
        type: "listPackagesResults",
        data: { packages: pkgOptions },
      });
      return;
    } catch (err) {
      Logger.log(`Error executing package list command: ${err}`);
      panel.sendMessage({
        type: "listPackagesResults",
        data: {
          packages: [
            { label: "All", value: "All" },
            { label: "Local", value: "Local" },
          ],
        },
      });
      return;
    }
  } catch (error: any) {
    Logger.log(`Error listing packages: ${error.message}`);
    panel.sendMessage({
      type: "listPackagesResults",
      data: {
        packages: [
          { label: "All", value: "All" },
          { label: "Local", value: "Local" },
        ],
      },
    });
  }
}

async function handleListMetadataTypes(
  _panel: LwcUiPanel,
  _username: string | null,
) {
  Logger.log(
    `Listing metadata types for org disabled until the SF Cli commands forgets CustomField !`,
  );
  // try {
  //   const command = `sf org list metadata-types --target-org ${username} --json`;
  //   const result = await execSfdxJson(command, {
  //     cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
  //     cacheSection: "project",
  //   });
  //   // Only accept the newer response shape: result.result.metadataObjects
  //   if (
  //     result &&
  //     result.status === 0 &&
  //     result.result &&
  //     typeof result.result === "object" &&
  //     Array.isArray(result.result.metadataObjects) &&
  //     result.result.metadataObjects.length > 0
  //   ) {
  //     const items: any[] = result.result.metadataObjects;
  //     const metadataTypeOptions = items
  //       .map((mt: any) => ({
  //         label: mt.xmlName,
  //         value: mt.xmlName,
  //       }))
  //       .sort((a: any, b: any) => a.label.localeCompare(b.label));
  //     panel.sendMessage({
  //       type: "listMetadataTypesResults",
  //       data: { metadataTypes: metadataTypeOptions },
  //     });
  //     return;
  //   }
  // } catch (error: any) {
  //   Logger.log(`Error listing metadata types: ${error.message}`);
  // }
  // // Send default metadata list
  // const metadataTypes = listMetadataTypes();
  // const metadataTypeOptions = metadataTypes
  //   .map((mt) => ({
  //     label: mt.xmlName,
  //     value: mt.xmlName,
  //   }))
  //   .sort((a, b) => a.label.localeCompare(b.label));
  // panel.sendMessage({
  //   type: "listMetadataTypesResults",
  //   data: { metadataTypes: metadataTypeOptions },
  // });
}

async function handleSourceMemberQuery(
  panel: any,
  username: string,
  metadataType: string | null,
  metadataName: string | null,
  lastUpdatedBy: string | null,
  dateFrom: string | null,
  dateTo: string | null,
  packageFilter: string | null,
  checkLocalFiles: boolean = false,
) {
  // Build SOQL query safely on backend
  let query =
    "SELECT MemberName, MemberType, LastModifiedDate, LastModifiedBy.Name, IsNewMember, IsDeleted, IsNameObsolete FROM SourceMember";
  const conditions: string[] = [];

  if (metadataType) {
    // Escape single quotes for SOQL
    const escapedType = metadataType.replace(/'/g, "\\'");
    conditions.push(`MemberType = '${escapedType}'`);
  }

  if (metadataName) {
    // Escape single quotes and wildcards for SOQL LIKE
    const escapedName = metadataName
      .replace(/'/g, "\\'")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    conditions.push(`MemberName LIKE '%${escapedName}%'`);
  }

  if (lastUpdatedBy) {
    // Escape single quotes and wildcards for SOQL LIKE
    const escapedUser = lastUpdatedBy
      .replace(/'/g, "\\'")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    conditions.push(`LastModifiedBy.Name LIKE '%${escapedUser}%'`);
  }

  // Add date range filters if provided
  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    if (!isNaN(fromDate.getTime())) {
      conditions.push(`LastModifiedDate >= ${fromDate.toISOString()}`);
    }
  }

  if (dateTo) {
    const toDate = new Date(dateTo);
    if (!isNaN(toDate.getTime())) {
      // Set to end of day
      toDate.setHours(23, 59, 59, 999);
      conditions.push(`LastModifiedDate <= ${toDate.toISOString()}`);
    }
  }

  // Exclude MemberTypes that are not retrievable via Metadata API
  const excludedTypes = ["AuraDefinition"];
  if (excludedTypes.length > 0) {
    const excludedConditions = excludedTypes
      .map((t) => `'${t.replace(/'/g, "\\'")}'`)
      .join(", ");
    conditions.push(`MemberType NOT IN (${excludedConditions})`);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY MemberType, MemberName LIMIT 2000";

  // Execute SOQL query using Tooling API
  const command = `sf data query --query "${query.replace(/"/g, '\\"')}" --target-org ${username} --use-tooling-api --json`;
  Logger.log(`Executing SourceMember query: ${command}`);

  const result = await execSfdxJson(command);

  if (result && result.result && result.result.records) {
    let records = result.result.records as any[];
    // Fix MemberName for certain types if needed
    records = records.map((r) => {
      r.MemberName = fixMemberName(r.MemberName, r.MemberType);
      return r;
    });
    // Filter Metadata Types that are not retrievable via Metadata API
    const nonRetrievableTypes = ["PicklistValue"];
    records = records.filter((r) => {
      return !nonRetrievableTypes.includes(r.MemberType);
    });
    // Apply packageFilter post-query if provided
    if (packageFilter && packageFilter !== "All") {
      if (packageFilter === "Local") {
        records = records.filter((r) => isLocalMetadata(r.MemberName || ""));
      } else {
        // Keep only records whose component segment starts with namespace__ pattern
        const ns = packageFilter;
        const nsPattern = `${ns}__`;
        records = records.filter((r) => {
          const fullName = (r.MemberName || "").toString();
          const compName = fullName.includes(".")
            ? fullName.split(".").pop() || fullName
            : fullName;
          return compName.startsWith(nsPattern);
        });
      }
    }

    // Add Operation property (created,modified,deleted) using values of IsNewMember, IsDeleted
    records = records.map((r) => {
      let operation = "modified";
      if (r.IsNewMember) {
        operation = "created";
      } else if (r.IsDeleted || r.IsNameObsolete) {
        operation = "deleted";
      }
      return { ...r, Operation: operation };
    });

    // If requested, check for local files matching each record
    if (checkLocalFiles) {
      records = await annotateLocalFiles(records);
    }

    panel.sendMessage({
      type: "queryResults",
      data: { records },
    });
  } else if (JSON.stringify(result).includes("INVALID_TYPE")) {
    panel.sendMessage({
      type: "queryError",
      data: {
        message:
          "It seems that the selected org does not support SourceMember queries (Full Sandbox, partial sandbox, developer org or production org). Please use 'All Metadata' mode.",
      },
    });
  } else {
    panel.sendMessage({
      type: "queryResults",
      data: { records: [] },
    });
  }
}

async function handleListMetadata(
  panel: any,
  username: string,
  metadataType: string | null,
  metadataName: string | null,
  packageFilter: string | null,
  checkLocalFiles: boolean = false,
) {
  // Require specific metadata type for All Metadata mode
  if (!metadataType) {
    panel.sendMessage({
      type: "queryError",
      data: {
        message: "Please select a specific metadata type for All Metadata mode",
      },
    });
    return;
  }

  const typesToQuery: string[] = [metadataType];
  const allResults: any[] = [];

  // Query metadata for each type
  for (const type of typesToQuery) {
    try {
      const command = `sf org list metadata --metadata-type ${type} --target-org ${username} --json`;
      Logger.log(`Executing listMetadata for type: ${type}`);

      const result = await execSfdxJson(command);

      if (result && result.result && Array.isArray(result.result)) {
        let typeResults = result.result.map((item: any) => {
          const memberName = fixMemberName(item.fullName, type);
          return {
            fullName: memberName,
            type: type,
            MemberName: memberName,
            MemberType: type,
            LastModifiedByName: item.lastModifiedByName || "",
            LastModifiedDate: item.lastModifiedDate || null,
          };
        });

        // Apply name filter if provided
        if (metadataName) {
          const nameLower = metadataName.toLowerCase();
          typeResults = typeResults.filter(
            (item: any) =>
              item.fullName && item.fullName.toLowerCase().includes(nameLower),
          );
        }

        // Apply packageFilter post-listing
        if (packageFilter && packageFilter !== "All") {
          if (packageFilter === "Local") {
            typeResults = typeResults.filter((item: any) =>
              isLocalMetadata(item.fullName || ""),
            );
          } else {
            // Component segment starts with namespace__ pattern
            const ns = packageFilter;
            const nsPattern = `${ns}__`;
            typeResults = typeResults.filter((item: any) => {
              const fn = (item.fullName || "").toString();
              const compName = fn.includes(".")
                ? fn.split(".").pop() || fn
                : fn;
              return compName.startsWith(nsPattern);
            });
          }
        }

        allResults.push(...typeResults);
      }
    } catch (error: any) {
      Logger.log(`Error listing metadata for type ${type}: ${error.message}`);
      // Continue with other types
    }
  }

  // Order allResults by MemberType and MemberName
  allResults.sort((a, b) => {
    if (a.MemberType === b.MemberType) {
      return a.MemberName.localeCompare(b.MemberName);
    }
    return a.MemberType.localeCompare(b.MemberType);
  });

  // If requested, annotate results with local file existence
  let finalResults = allResults;
  if (checkLocalFiles && finalResults.length > 0) {
    finalResults = await annotateLocalFiles(finalResults);
  }

  panel.sendMessage({
    type: "queryResults",
    data: { records: finalResults },
  });
}

function fixMemberName(name: string, type: string): string {
  let fixedName = name;
  if (type === "Layout") {
    // Handle managed package layouts: ObjectName-LayoutName format
    // Examples:
    // - Managed on managed: abc__object__c-abc__object Layout
    // - Custom on managed: abc__object__c-custom name Layout
    // - Packaged on standard: Object-abc__Object layout

    const parts = name.split("-");
    if (parts.length >= 2) {
      const objectName = parts[0];
      const layoutName = parts.slice(1).join("-");

      // Check if object has namespace (namespace__ObjectName__c vs ObjectName__c)
      // Match pattern: anything__anything__c (captures everything before the last __ObjectName__c)
      const objectNamespaceMatch = objectName.match(
        /^(.+?)__([^_]+(?:_[^_]+)*)__(?:c|mdt)$/,
      );
      if (objectNamespaceMatch) {
        const namespace = objectNamespaceMatch[1];

        // Add namespace to layout if missing
        // e.g., CHANNEL_ORDERS__Customer__c-COA Customer Layout
        //    -> CHANNEL_ORDERS__Customer__c-CHANNEL_ORDERS__COA Customer Layout
        if (!layoutName.startsWith(namespace + "__")) {
          fixedName = `${objectName}-${namespace}__${layoutName}`;
        } else {
          fixedName = name;
        }
      }
    }
  }
  return fixedName;
}

/**
 * Annotate an array of records with LocalFileExists boolean based on metadataList patterns
 */
async function annotateLocalFiles(records: any[]): Promise<any[]> {
  // Rapid path: empty records
  if (!records || records.length === 0) {
    return [];
  }

  try {
    const metadataTypes = listMetadataTypes();
    const typeMap: Record<string, any> = {};
    for (const t of metadataTypes) {
      if (t.xmlName) {
        typeMap[t.xmlName] = t;
      }
    }

    const packageDirs = await listSfdxProjectPackageDirectories();
    if (!packageDirs || packageDirs.length === 0) {
      return records.map((r) => ({ ...r, LocalFileExists: false }));
    }

    // Build list of unique metadata types present in records to limit scanning
    const typesNeeded = new Set<string>();
    for (const r of records) {
      const mtName = (r.MemberType || r.type || "") as string;
      if (mtName) {
        typesNeeded.add(mtName);
      }
    }

    // Build index: key => set of normalized candidate strings
    const index: Map<string, Set<string>> = new Map();

    // For each packageDir and each needed type, scan the directory once and populate keys
    const scanPromises: Promise<void>[] = [];
    for (const pkg of packageDirs) {
      for (const tName of Array.from(typesNeeded)) {
        const mt = typeMap[tName];
        if (!mt) {
          continue;
        }
        const dirName = mt.directoryName || "";
        // pattern to list all files under the metadata dir
        const baseGlob = path
          .join(pkg, "**", dirName, "**", "*")
          .replace(/\\/g, "/");
        const key = `${pkg}::${tName}`;

        const prom = new Promise<void>((resolve) => {
          fg(baseGlob, {
            dot: true,
            onlyFiles: true,
            followSymbolicLinks: true,
          })
            .then((files: string[]) => {
              const set = new Set<string>();
              for (const f of files) {
                set.add(f);
              }
              index.set(key, set);
              resolve();
            })
            .catch(() => {
              // ignore scanning errors
              index.set(key, new Set());
              resolve();
            });
        });
        scanPromises.push(prom);
      }
    }
    await Promise.allSettled(scanPromises);

    // Now annotate each record by checking candidate keys against index
    const annotated = records.map((r) => {
      try {
        const mtName = (r.MemberType || r.type || "") as string;
        const mt = typeMap[mtName];
        if (!mt) {
          return { ...r, LocalFileExists: false };
        }
        const name = r.MemberName || r.fullName || "";

        // keys to try
        const candidateKeys = buildMetadataKeys(name, mt);

        // check per packageDir index
        let exists = false;
        for (const pkg of packageDirs) {
          const key = `${pkg}::${mtName}`;
          const set = index.get(key);
          if (!set) {
            continue;
          }
          const setList = [...set];
          // check normalized comparisons
          for (const cand of candidateKeys) {
            if (setList.some((p) => p.endsWith(cand))) {
              exists = true;
              break;
            }
          }
          if (exists) {
            break;
          }
        }
        return { ...r, LocalFileExists: exists };
      } catch {
        return { ...r, LocalFileExists: false };
      }
    });
    return annotated;
  } catch {
    return records.map((r) => ({ ...r, LocalFileExists: false }));
  }
}

function buildMetadataKeys(name: any, mt: any) {
  const candidateKeys = new Set<string>();
  const splitName = name.includes(".") ? name.split(".") : [name];
  if (splitName.length > 1 && mt.directoryName) {
    // handle foldered metadata (e.g. CustomField, EmailTemplate, Dashboard, Report)
    const parentApiName = splitName.slice(0, -1).join("/");
    const componentName = splitName.slice(-1)[0];
    if (mt.suffix) {
      candidateKeys.add(
        `/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}`,
      );
      candidateKeys.add(
        `/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}-meta.xml`,
      );
    } else {
      candidateKeys.add(
        `/${parentApiName}/${mt.directoryName}/${componentName}`,
      );
      candidateKeys.add(
        `/${parentApiName}/${mt.directoryName}/${componentName}-meta.xml`,
      );
    }
  } else if (mt.suffix) {
    candidateKeys.add(`/${name}.${mt.suffix}`);
    candidateKeys.add(`/${name}.${mt.suffix}-meta.xml`);
  }
  return candidateKeys;
}

/* jscpd:ignore-start */
async function handleRetrieveSelectedMetadata(panel: any, data: any) {
  try {
    const { username, metadata, localPackage } = data;

    if (
      !username ||
      !metadata ||
      !Array.isArray(metadata) ||
      metadata.length === 0
    ) {
      vscode.window.showErrorMessage(
        "Missing required parameters for metadata retrieval",
      );
      return;
    }

    // Build metadata retrieve command
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    await executeMetadataRetrieve(
      username,
      metadata,
      `Retrieving ${metadata.length} metadata item(s)`,
      panel,
      false,
      localPackage || null,
    );
  } catch (error: any) {
    Logger.log(`Error retrieving selected metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}
/* jscpd:ignore-end */

async function handleOpenRetrieveFolder() {
  try {
    const reportDir = await getReportDirectory();
    const retrieveDir = path.join(reportDir, "retrieve");

    // Ensure the directory exists
    await fs.ensureDir(retrieveDir);

    // Open the retrieve folder in VS Code explorer
    const retrieveDirUri = vscode.Uri.file(retrieveDir);
    await vscode.commands.executeCommand("revealInExplorer", retrieveDirUri);
  } catch (error: any) {
    Logger.log(`Error opening retrieve folder: ${error.message}`);
    vscode.window.showErrorMessage(
      `Failed to open retrieve folder: ${error.message}`,
    );
  }
}

async function handleRetrieveMetadata(panel: any, data: any) {
  try {
    const { username, memberType, memberName, deleted, localPackage } = data;

    if (!username || !memberType || !memberName) {
      vscode.window.showErrorMessage(
        "Missing required parameters for metadata retrieval",
      );
      return;
    }

    // Build metadata retrieve command
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    // Build metadata list for command
    const metadata = [
      {
        memberType,
        memberName,
        deleted: deleted ?? false,
      },
    ];

    await executeMetadataRetrieve(
      username,
      metadata,
      `Retrieving ${memberType}: ${memberName}`,
      panel,
      false,
      localPackage || null,
    );
  } catch (error: any) {
    Logger.log(`Error retrieving metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}
