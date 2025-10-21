import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { listAllOrgs, SalesforceOrg } from "../utils/orgUtils";
import {
  execSfdxJson,
  getDefaultTargetOrgUsername,
  getUsernameInstanceUrl,
  listSfdxProjectPackageDirectories,
} from "../utils";
import { Logger } from "../logger";
import { listMetadataTypes } from "../utils/metadataList";
import fg from "fast-glob";
import * as path from "path";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";

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

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-metadata-retriever",
        {
          orgs: connectedOrgs,
          selectedOrgUsername: selectedOrgUsername,
          metadataTypes: metadataTypeOptions,
          checkLocalAvailable: packageDirs.length > 0,
          packageDirectories: packageDirs,
        },
      );
      panel.updateTitle("Metadata Retriever");
      // Register message handlers
      panel.onMessage(async (type, data) => {
        if (type === "listOrgs") {
          await handleListOrgs(panel);
        } else if (type === "queryMetadata") {
          await handleQueryMetadata(panel, data);
        } else if (type === "listPackages") {
          await handleListPackages(
            panel,
            data && data.username ? data.username : null,
          );
        } else if (type === "retrieveMetadata") {
          await handleRetrieveMetadata(panel, data);
        } else if (type === "retrieveSelectedMetadata") {
          await handleRetrieveSelectedMetadata(panel, data);
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
  const connectedOrgs = orgs.filter(
    (org) => org.connectedStatus === "Connected",
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

async function executeMetadataRetrieve(
  username: string,
  metadataList: string,
  workspaceRoot: string,
  displayTitle: string,
  panel: LwcUiPanel,
  forceOverwrite = false
): Promise<any> {
  // Split metadata list and create separate --metadata flags for each item
  const metadataItems = metadataList
    .split(",")
    .map((item) => `--metadata "${item}"`)
    .join(" ");
  const command = `sf project retrieve start ${metadataItems} --target-org ${username}`
                  + (forceOverwrite ? ' --ignore-conflicts' : '')
                  + ' --json';
  Logger.log(`Retrieving metadata: ${command}`);

  let finalResult: any = null;
  try {
    const result = await vscode.window.withProgress(
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
    if (result.code === 'SourceConflictError') {
      const choice = await vscode.window.showErrorMessage(
        `Failed to retrieve metadata due to source conflicts.`,
        "I don't care, overwrite! 🤪",
        "Ok, nevermind 😑");
      if (choice === "I don't care, overwrite! 🤪") {
       return await executeMetadataRetrieve(
          username,
          metadataList,
          workspaceRoot,
          displayTitle,
          panel,
          true
        );
      }
      return result;
    }

    finalResult = result;

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
        const requested = metadataList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
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

        const displayMsg = errorDetails.length > 0
          ? `${titleWithName}. Errors: ${errorDetails.slice(0, 3).join("; ")}${errorDetails.length > 3 ? ` (and ${errorDetails.length - 3} more - see logs)` : ""}`
          : titleWithName;

        const promAction = failedFiles.length === 0 && success
          ?  vscode.window.showInformationMessage(titleWithName, "View and commit files")
          :  vscode.window.showWarningMessage(displayMsg, "View and commit files");
        promAction.then((action) => {
          if (action === "View and commit files") {
            vscode.commands.executeCommand("workbench.view.scm");
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
            const recordsSuccessAnnotated = await annotateLocalFiles(recordsToAnnotate);
            // Add failed downloads
            const recordsFailed = failedFiles.map((f: any) => ({
              MemberType: f.type,
              MemberName: f.fullName,
              fullName: f.fullName,
              LocalFileExists: false
            }));
            const resultRecords = [...recordsSuccessAnnotated,...recordsFailed];
            panel.sendMessage({
              type: "postRetrieveLocalCheck",
              data: { files: resultRecords },
            });
        } catch {
          // non-fatal
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
              LocalFileExists: false
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
          vscode.window.showWarningMessage(msg);
        } else {
          const msg = `Failed to retrieve ${failedFiles.length} file(s)${singleName ? ` (${singleName})` : ""}`;
          vscode.window.showWarningMessage(msg);
        }
      }
      } else {
      const errorMsg = result?.message || "Unknown error occurred";
      const msg = singleName
        ? `Failed to retrieve ${singleName}: ${errorMsg}`
        : `Failed to retrieve metadata: ${errorMsg}`;
      vscode.window.showErrorMessage(msg);
    }
  } catch (error: any) {
    Logger.log(`Error retrieving metadata: ${error.message}`);
    vscode.window.showErrorMessage(
      `Failed to retrieve metadata: ${error.message}`,
    );
  }
  return finalResult;
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
          "SELECT MemberName, MemberType, LastModifiedDate, LastModifiedBy.Name, IsNewMember, IsDeleted FROM SourceMember";
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
      } else if (r.IsDeleted) {
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
        let typeResults = result.result.map((item: any) => ({
          fullName: item.fullName,
          type: type,
          MemberName: item.fullName,
          MemberType: type,
          LastModifiedByName: item.lastModifiedByName || "",
          LastModifiedDate: item.lastModifiedDate || null,
        }));

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
        const baseGlob = path.join(pkg, "**", dirName , "**", "*").replace(/\\/g, "/");
        const key = `${pkg}::${tName}`;

        const prom = new Promise<void>((resolve) => {
          fg(baseGlob, { dot: true, onlyFiles: true, followSymbolicLinks: true })
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
        const name = (r.MemberName || r.fullName || "");

        // keys to try
        const candidateKeys = new Set<string>();
        const splitName = name.includes(".") ? name.split(".") : [name];
        if (splitName.length > 1 && mt.directoryName) {
          // handle foldered metadata (e.g. CustomField, EmailTemplate, Dashboard, Report)
          const parentApiName = splitName.slice(0, -1).join("/");
          const componentName = splitName.slice(-1)[0];
          if (mt.suffix) {
            candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}`);
            candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}-meta.xml`);
          }
          else {
            candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}`);
            candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}-meta.xml`);
          }
        }
        else if (mt.suffix) {
          candidateKeys.add(`/${name}.${mt.suffix}`);
          candidateKeys.add(`/${name}.${mt.suffix}-meta.xml`);
        }

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

/* jscpd:ignore-start */
async function handleRetrieveSelectedMetadata(panel: any, data: any) {
  try {
    const { username, metadata } = data;

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

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Build metadata list for command
    const metadataList = metadata
      .map((m) => `${m.memberType}:${m.memberName}`)
      .join(",");

    await executeMetadataRetrieve(
      username,
      metadataList,
      workspaceRoot,
      `Retrieving ${metadata.length} metadata item(s)`,
      panel,
    );
  } catch (error: any) {
    Logger.log(`Error retrieving selected metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}
/* jscpd:ignore-end */

async function handleRetrieveMetadata(panel: any, data: any) {
  try {
    const { username, memberType, memberName } = data;

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

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Build metadata list for command
    const metadataList = `${memberType}:${memberName}`;

    await executeMetadataRetrieve(
      username,
      metadataList,
      workspaceRoot,
      `Retrieving ${memberType}: ${memberName}`,
      panel
    );
  } catch (error: any) {
    Logger.log(`Error retrieving metadata: ${error.message}`);
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}
