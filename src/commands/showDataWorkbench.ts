// jscpd:ignore-start
import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { getWorkspaceRoot, openFolderInExplorer } from "../utils";
import * as fs from "fs";
import path from "path";
import { Logger } from "../logger";
import { isQueryValid, parseQuery } from "@jetstreamapp/soql-parser-js";
import { getJson } from "../utils/httpUtils";
import { t } from "../i18n/i18n";
import { loadWorkbenchWorkspaces } from "../utils/workbenchUtils";
// jscpd:ignore-end

const DATA_TEMPLATES_URL =
  "https://github.com/hardisgroupcom/sfdx-hardis/raw/refs/heads/main/defaults/templates/data-templates.json";

// Line counting reads the file, so it is capped: above this size the row count
// is not displayed rather than paid for (a data export can hold CSV files of
// several hundred megabytes)
export const LINE_COUNT_MAX_BYTES = 50 * 1024 * 1024;
const LINE_COUNT_CHUNK_BYTES = 1024 * 1024;

class SoqlValidationError extends Error {
  soqlErrors: string[];

  constructor(soqlErrors: string[]) {
    super("SOQL validation failed");
    this.soqlErrors = soqlErrors;
  }
}

type SfdmuObjectConfig = {
  query: string;
  operation?: string;
  externalId?: string;
  // Delete options
  deleteOldData?: boolean;
  hardDelete?: boolean;
  deleteByHierarchy?: boolean;
  deleteFromSource?: boolean;
  deleteQuery?: string;
  // Query options
  useQueryAll?: boolean;
  queryAllTarget?: boolean;
  useSourceCSVFile?: boolean;
  sourceRecordsFilter?: string;
  targetRecordsFilter?: string;
  // Processing
  allOrNone?: boolean;
  master?: boolean;
  excluded?: boolean;
  skipExistingRecords?: boolean;
  skipRecordsComparison?: boolean;
  // Field options
  useFieldMapping?: boolean;
  useValuesMapping?: boolean;
  excludedFields?: string[];
  excludedFromUpdateFields?: string[];
  // Performance
  bulkApiV1BatchSize?: number;
  restApiBatchSize?: number;
  parallelBulkJobs?: number;
  parallelRestJobs?: number;
  alwaysUseRestApi?: boolean;
  alwaysUseBulkApi?: boolean;
  alwaysUseBulkApiToUpdateRecords?: boolean;
  respectOrderByOnDeleteRecords?: boolean;
  // Data anonymization
  updateWithMockData?: boolean;
  mockFields?: Array<{
    name?: string;
    pattern?: string;
    locale?: string;
    excludedRegex?: string;
    includedRegex?: string;
  }>;
  // Legacy
  batchSize?: number | string;
  [key: string]: any;
};

type ExportedFile = {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  modified: number;
  created: number;
  // null when the file is too large to be counted (see LINE_COUNT_MAX_BYTES)
  lineCount: number | null;
};

type LogFile = ExportedFile & {
  logType: "source" | "target" | "log" | "report";
};

type DataWorkspace = {
  name: string;
  path: string;
  configPath: string;
  label: string;
  description: string;
  objects: SfdmuObjectConfig[];
  objectsCount: number;
  exportedFiles: ExportedFile[];
  logFiles: LogFile[];
  scriptSettings: Record<string, any>;
};

/**
 * Refresh the Data Workbench panel if it is open.
 * Called from the websocket server when a refreshDataWorkbench event is received.
 */
export async function refreshDataWorkbenchPanel(): Promise<void> {
  const panelManager = LwcPanelManager.getInstance();
  const dataWorkbenchPanel = panelManager.getPanel("s-data-workbench");
  if (dataWorkbenchPanel) {
    const updatedWorkspaces = await loadDataWorkspaces();
    dataWorkbenchPanel.sendMessage({
      type: "workspacesLoaded",
      data: { workspaces: updatedWorkspaces },
    });
  }
}

export function registerShowDataWorkbench(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showDataWorkbench",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();

      const panel = lwcManager.getOrCreatePanel("s-data-workbench", {
        loading: true,
      });
      panel.updateTitle(t("dataWorkbench"));

      const loadAndPush = async () => {
        panel.sendInitializationData({ loading: true });
        try {
          const workspaces = await loadDataWorkspaces();
          panel.sendInitializationData({
            workspaces: workspaces,
            loading: false,
          });
          // jscpd:ignore-start
        } catch (e: any) {
          Logger.log(
            "[vscode-sfdx-hardis] Data Workbench init failed: " +
              (e?.message || e),
          );
          panel.sendInitializationData({
            loading: false,
            loadError: String(e?.message || e),
          });
        }
        // jscpd:ignore-end
      };

      panel.onMessage(async (type: string, data: any) => {
        if (type === "retryInit") {
          await loadAndPush();
          return;
        }
        // Built-in messages (runCommand, openFile, runVsCodeCommand, etc.)
        // are handled by the LwcUiPanel router. Only workspace-specific
        // actions are processed here.
        switch (type) {
          case "loadWorkspaces": {
            const updatedWorkspaces = await loadDataWorkspaces();
            panel.sendMessage({
              type: "workspacesLoaded",
              data: { workspaces: updatedWorkspaces },
            });
            break;
          }

          case "createWorkspace": {
            try {
              const createdPath = await createDataWorkspace(data);
              panel.sendMessage({
                type: "workspaceCreated",
                data: { path: createdPath },
              });
            } catch (e: any) {
              const message = e?.message || e;
              Logger.log(`Failed to create data workspace: ${message}`);
              vscode.window.showErrorMessage(
                `Failed to create workspace: ${message}`,
              );
              panel.sendMessage({
                type: "workspaceCreateFailed",
                data: {
                  message,
                  soqlErrors:
                    e instanceof SoqlValidationError ? e.soqlErrors : undefined,
                },
              });
            }
            break;
          }

          case "updateWorkspace": {
            try {
              await updateDataWorkspace(data);
              panel.sendMessage({
                type: "workspaceUpdated",
                data: {},
              });

              const pickedAction = await vscode.window.showInformationMessage(
                `Data workspace "${data?.label || data?.name || ""}" updated successfully!`,
                "View and commit files",
              );
              if (pickedAction === "View and commit files") {
                vscode.commands.executeCommand("workbench.view.scm");
              }
            } catch (e: any) {
              const message = e?.message || e;
              Logger.log(`Failed to update data workspace: ${message}`);
              vscode.window.showErrorMessage(
                `Failed to update workspace: ${message}`,
              );
              panel.sendMessage({
                type: "workspaceUpdateFailed",
                data: {
                  message,
                  soqlErrors:
                    e instanceof SoqlValidationError ? e.soqlErrors : undefined,
                },
              });
            }
            break;
          }

          // jscpd:ignore-start
          case "deleteWorkspace": {
            try {
              const label = data?.label || data?.path || "this workspace";
              const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to delete the workspace "${label}"? This action cannot be undone.`,
                { modal: true },
                "Delete",
              );
              if (confirmation === "Delete") {
                await deleteDataWorkspace(data.path);
                panel.sendMessage({ type: "workspaceDeleted", data: {} });
              } else {
                // no-op; let the UI stay as-is
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(
                `Failed to delete workspace: ${e?.message || e}`,
              );
            }
            break;
          }

          case "openWorkspaceFolder": {
            try {
              if (data.path && fs.existsSync(data.path)) {
                openFolderInExplorer(data.path);
              } else {
                vscode.window.showErrorMessage(
                  `Folder not found: ${data.path}`,
                );
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(
                `Failed to open folder: ${e?.message || e}`,
              );
            }
            break;
          }
          // jscpd:ignore-end

          // jscpd:ignore-start
          case "loadTemplates": {
            try {
              const response = await getJson<any>(DATA_TEMPLATES_URL, {
                timeoutMs: 8000,
              });
              const templates = response?.templates || [];
              panel.sendMessage({
                type: "templatesLoaded",
                data: { templates },
              });
            } catch (e: any) {
              Logger.log(`Failed to load data templates: ${e?.message || e}`);
              panel.sendMessage({
                type: "templatesLoaded",
                data: { templates: [] },
              });
            }
            break;
          }

          case "loadTemplate": {
            try {
              const template = await getJson<any>(data.url, {
                timeoutMs: 8000,
              });
              panel.sendMessage({
                type: "templateLoaded",
                data: { template },
              });
            } catch (e: any) {
              Logger.log(`Failed to load data template: ${e?.message || e}`);
              vscode.window.showErrorMessage(
                `Failed to load template: ${e?.message || e}`,
              );
              panel.sendMessage({
                type: "templateLoaded",
                data: { template: null },
              });
            }
            break;
          }
          // jscpd:ignore-end

          default:
            break;
        }
      });
      loadAndPush();
    },
  );
  commands.disposables.push(disposable);
}

async function loadDataWorkspaces(): Promise<DataWorkspace[]> {
  const dataFolder = path.join(getWorkspaceRoot(), "scripts", "data");

  return loadWorkbenchWorkspaces<DataWorkspace>(
    dataFolder,
    async ({ name, workspacePath, configPath, exportConfig }) => {
      // Extract script-level settings (all root properties except objects and sfdxHardis metadata)
      const {
        objects: _rawObjects,
        sfdxHardisLabel: _lbl,
        sfdxHardisDescription: _desc,
        ...scriptSettings
      } = exportConfig;

      const objects: SfdmuObjectConfig[] = Array.isArray(exportConfig.objects)
        ? exportConfig.objects.map((obj: any) => ({
            ...obj,
            query: obj.query || "",
            operation: obj.operation || "Upsert",
            externalId: obj.externalId || obj.externalid || "",
            deleteOldData: asBool(obj.deleteOldData),
            useQueryAll: asBool(obj.useQueryAll),
            allOrNone: asBool(obj.allOrNone, true),
            bulkApiV1BatchSize:
              obj.bulkApiV1BatchSize ?? obj.batchSize ?? undefined,
            restApiBatchSize: obj.restApiBatchSize ?? undefined,
            updateWithMockData: obj.updateWithMockData === true,
            mockFields: normalizeMockFields(obj.mockFields),
            objectName: extractObjectName(obj.query || ""),
          }))
        : [];

      const [exportedFiles, logFiles] = await Promise.all([
        listExportedFiles(workspacePath),
        listLogFiles(workspacePath),
      ]);

      return {
        name: name,
        path: workspacePath,
        configPath: configPath,
        label: exportConfig.sfdxHardisLabel || name,
        description: exportConfig.sfdxHardisDescription || "",
        objects: objects,
        objectsCount: objects.length,
        exportedFiles: exportedFiles,
        logFiles: logFiles,
        scriptSettings: scriptSettings,
      };
    },
  );
}

async function listExportedFiles(
  workspacePath: string,
): Promise<ExportedFile[]> {
  const allowedExtensions = new Set([".csv", ".zip"]);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(workspacePath, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const candidates = entries.filter(
    (entry) =>
      entry.isFile() &&
      allowedExtensions.has(path.extname(entry.name).toLowerCase()),
  );

  const files = await Promise.all(
    candidates.map(async (entry) => {
      const entryPath = path.join(workspacePath, entry.name);
      const extension = path.extname(entry.name).toLowerCase();
      try {
        const stats = await fs.promises.stat(entryPath);
        const rawLineCount = await countFileLines(entryPath, stats.size);
        // A CSV holds a header line that is not a record
        const lineCount =
          extension === ".csv" && rawLineCount !== null && rawLineCount > 0
            ? rawLineCount - 1
            : rawLineCount;
        if (entry.name === "MissingParentRecordsReport.csv" && lineCount === 0) {
          return null;
        }
        return {
          name: entry.name,
          path: entryPath,
          relativePath: entry.name,
          size: stats.size,
          modified: stats.mtimeMs,
          created: stats.birthtimeMs,
          lineCount: lineCount,
        };
      } catch {
        // ignore unreadable files
        return null;
      }
    }),
  );

  return files
    .filter((file): file is ExportedFile => file !== null)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function listLogFiles(workspacePath: string): Promise<LogFile[]> {
  const allowedExtensions = new Set([".csv", ".log"]);
  const logTypeOrder: Record<string, number> = {
    source: 0,
    target: 1,
    log: 2,
    report: 3,
  };

  // Scan /source, /target, /logs and /reports subdirectories, plus the
  // workspace root for its .log files
  const scanned: Array<{
    dir: string;
    logType: "source" | "target" | "log" | "report";
    extensions: Set<string>;
  }> = [
    { dir: "source", logType: "source", extensions: allowedExtensions },
    { dir: "target", logType: "target", extensions: allowedExtensions },
    { dir: "logs", logType: "log", extensions: allowedExtensions },
    { dir: "reports", logType: "report", extensions: allowedExtensions },
    { dir: "", logType: "log", extensions: new Set([".log"]) },
  ];

  // Every directory is read, then every file stat'ed and counted, concurrently
  const perDir = await Promise.all(
    scanned.map(async ({ dir, logType, extensions }) => {
      const dirPath = dir ? path.join(workspacePath, dir) : workspacePath;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch {
        // missing or unreadable directory
        return [];
      }
      const candidates = entries.filter(
        (entry) =>
          entry.isFile() &&
          extensions.has(path.extname(entry.name).toLowerCase()),
      );
      const files = await Promise.all(
        candidates.map(async (entry) => {
          const entryPath = path.join(dirPath, entry.name);
          try {
            const stats = await fs.promises.stat(entryPath);
            return {
              name: entry.name,
              path: entryPath,
              relativePath: dir ? `${dir}/${entry.name}` : entry.name,
              size: stats.size,
              modified: stats.mtimeMs,
              created: stats.birthtimeMs,
              lineCount: await countFileLines(entryPath, stats.size),
              logType: logType,
            };
          } catch {
            // ignore unreadable files
            return null;
          }
        }),
      );
      return files.filter((file): file is LogFile => file !== null);
    }),
  );

  // Sort: by logType order (source → target → log), then alphabetically
  return perDir.flat().sort((a, b) => {
    const typeA = logTypeOrder[a.logType] ?? 99;
    const typeB = logTypeOrder[b.logType] ?? 99;
    if (typeA !== typeB) {
      return typeA - typeB;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
}

// Count the lines of a file without ever holding it in memory: read it by
// LINE_COUNT_CHUNK_BYTES chunks and let Buffer.indexOf() (native) find the
// newlines, instead of walking every byte from JS. Above LINE_COUNT_MAX_BYTES
// the count is not worth the read and null is returned, which the UI renders
// as "not counted": SFDMU exports routinely hold CSV files of several hundred
// megabytes, and reading them all just to display a row count used to freeze
// the extension host for the whole load.
// Exported for the unit tests, which exercise the chunk boundaries
export async function countFileLines(
  filePath: string,
  size: number,
  chunkBytes: number = LINE_COUNT_CHUNK_BYTES,
): Promise<number | null> {
  if (size > LINE_COUNT_MAX_BYTES) {
    return null;
  }
  if (size === 0) {
    return 0;
  }
  let fileHandle: fs.promises.FileHandle | undefined;
  try {
    fileHandle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.allocUnsafe(chunkBytes);
    let lines = 0;
    let lastByte = 0;
    for (;;) {
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length);
      if (bytesRead === 0) {
        break;
      }
      let from = 0;
      for (;;) {
        const newlineIndex = buffer.indexOf(10, from);
        if (newlineIndex === -1 || newlineIndex >= bytesRead) {
          break;
        }
        lines += 1;
        from = newlineIndex + 1;
      }
      lastByte = buffer[bytesRead - 1];
    }
    // A file not ending with a newline still holds a last line
    if (lastByte !== 10) {
      lines += 1;
    }
    return lines;
  } catch {
    return 0;
  } finally {
    await fileHandle?.close().catch(() => {
      // ignore close errors
    });
  }
}

async function createDataWorkspace(data: any): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const dataFolder = path.join(workspaceRoot, "scripts", "data");
  const workspacePath = path.join(dataFolder, data.name);

  await fs.promises.mkdir(dataFolder, { recursive: true });

  if (fs.existsSync(workspacePath)) {
    throw new Error(`Workspace ${data.name} already exists`);
  }

  await fs.promises.mkdir(workspacePath, { recursive: true });

  const objects: SfdmuObjectConfig[] = Array.isArray(data.objects)
    ? data.objects
    : [
        {
          query: data.soqlQuery,
          operation: data.operation || "Upsert",
          externalId: data.externalId || "",
          deleteOldData: data.deleteOldData === true,
          useQueryAll: data.useQueryAll === true,
          allOrNone: data.allOrNone !== false,
          batchSize: data.batchSize || undefined,
        },
      ];

  const soqlErrors = validateSoqlQueries(objects);
  if (soqlErrors.some((e) => !!e)) {
    throw new SoqlValidationError(soqlErrors);
  }

  const exportConfig = {
    ...(data.scriptSettings || {}),
    sfdxHardisLabel: data.label,
    sfdxHardisDescription: data.description,
    objects: normalizeObjectsForSave(objects),
  };

  const exportJsonPath = path.join(workspacePath, "export.json");
  await fs.promises.writeFile(
    exportJsonPath,
    JSON.stringify(exportConfig, null, 2),
  );

  vscode.window.showInformationMessage(
    `Data workspace "${data.label}" created successfully!`,
  );

  return workspacePath;
}

async function updateDataWorkspace(data: any): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const oldPath =
    typeof data?.originalPath === "string" ? data.originalPath : "";
  const workspaceName = typeof data?.name === "string" ? data.name : "";

  if (!workspaceName) {
    throw new Error("Workspace name is required");
  }

  const newPath = path.join(workspaceRoot, "scripts", "data", workspaceName);

  if (oldPath && oldPath !== newPath && fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) {
      throw new Error(
        `A workspace named "${workspaceName}" already exists. Choose another name.`,
      );
    }
    await fs.promises.rename(oldPath, newPath);
  } else {
    await fs.promises.mkdir(newPath, { recursive: true });
  }

  const exportJsonPath = path.join(newPath, "export.json");
  let existingConfig: any = {};
  try {
    if (fs.existsSync(exportJsonPath)) {
      existingConfig = JSON.parse(fs.readFileSync(exportJsonPath, "utf8"));
    }
  } catch {
    existingConfig = {};
  }

  const exportConfig = {
    ...existingConfig,
    ...(data.scriptSettings || {}),
    sfdxHardisLabel: data.label,
    sfdxHardisDescription: data.description,
    objects: normalizeObjectsForSave(data.objects || []),
  };

  const soqlErrors = validateSoqlQueries(data.objects || []);
  if (soqlErrors.some((e) => !!e)) {
    throw new SoqlValidationError(soqlErrors);
  }

  await fs.promises.writeFile(
    exportJsonPath,
    JSON.stringify(exportConfig, null, 2),
  );

  return exportJsonPath;
}

function validateSoqlQueries(objects: SfdmuObjectConfig[]): string[] {
  const list: SfdmuObjectConfig[] = Array.isArray(objects) ? objects : [];
  if (list.length === 0) {
    return [];
  }

  const errors: string[] = new Array(list.length).fill("");

  for (let idx = 0; idx < list.length; idx++) {
    const query = (list[idx]?.query || "").toString().trim();
    if (!query) {
      errors[idx] = "SOQL query is required.";
      continue;
    }

    const valid = isQueryValid(query, {
      allowApexBindVariables: true,
      logErrors: false,
      ignoreParseErrors: false,
      allowPartialQuery: false,
    });

    if (!valid) {
      try {
        parseQuery(query, {
          allowApexBindVariables: true,
          logErrors: false,
          ignoreParseErrors: false,
          allowPartialQuery: false,
        });
      } catch (e: any) {
        const raw = e?.message ? String(e.message) : String(e);
        const firstLine = raw.split("\n")[0] || raw;
        errors[idx] = `Invalid SOQL: ${firstLine}`;
        continue;
      }
      errors[idx] = "Invalid SOQL syntax.";
      continue;
    }

    // Extra strict rule: block field aliases (Salesforce doesn't support them).
    try {
      const parsed: any = parseQuery(query, {
        allowApexBindVariables: true,
        logErrors: false,
        ignoreParseErrors: false,
        allowPartialQuery: false,
      });

      const fields: any[] = Array.isArray(parsed?.fields) ? parsed.fields : [];
      const hasFieldAlias = fields.some((f) => {
        if (!f || typeof f !== "object") {
          return false;
        }
        const alias = (f as any).alias;
        if (!alias) {
          return false;
        }
        return (f as any).type !== "FieldFunctionExpression";
      });

      if (hasFieldAlias) {
        errors[idx] =
          "Invalid SOQL: field aliases are not supported. Add commas between fields.";
      }
    } catch (e: any) {
      const raw = e?.message ? String(e.message) : String(e);
      const firstLine = raw.split("\n")[0] || raw;
      errors[idx] = `Invalid SOQL: ${firstLine}`;
    }
  }

  return errors;
}

async function deleteDataWorkspace(workspacePath: string): Promise<void> {
  if (fs.existsSync(workspacePath)) {
    await fs.promises.rm(workspacePath, { recursive: true, force: true });
    vscode.window.showInformationMessage(
      "Data workspace deleted successfully!",
    );
  }
}

function asBool(
  value: boolean | string | undefined | null,
  defaultValue = false,
): boolean {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return defaultValue;
}

function normalizeObjectsForSave(objects: SfdmuObjectConfig[]): any[] {
  return (objects || []).map((obj) => {
    const cleanedObj: any = { ...obj };
    cleanedObj.query = obj.query || "";
    cleanedObj.operation = obj.operation || "Upsert";
    cleanedObj.externalId = obj.externalId || obj.externalid || "";
    cleanedObj.deleteOldData = asBool(obj.deleteOldData);
    cleanedObj.useQueryAll = asBool(obj.useQueryAll);
    cleanedObj.allOrNone = asBool(obj.allOrNone, true);

    // Normalize optional boolean fields (only if present)
    const boolFieldsDefaultFalse = [
      "hardDelete",
      "deleteByHierarchy",
      "deleteFromSource",
      "excluded",
      "queryAllTarget",
      "skipExistingRecords",
      "skipRecordsComparison",
      "useFieldMapping",
      "useValuesMapping",
      "useSourceCSVFile",
      "alwaysUseRestApi",
      "alwaysUseBulkApi",
      "alwaysUseBulkApiToUpdateRecords",
      "respectOrderByOnDeleteRecords",
    ];
    for (const field of boolFieldsDefaultFalse) {
      if (cleanedObj[field] !== undefined) {
        cleanedObj[field] = asBool(cleanedObj[field]);
      }
    }
    if (cleanedObj.master !== undefined) {
      cleanedObj.master = asBool(cleanedObj.master, true);
    }

    // Normalize integer fields
    const integerFields = [
      "bulkApiV1BatchSize",
      "restApiBatchSize",
      "parallelBulkJobs",
      "parallelRestJobs",
    ];
    for (const field of integerFields) {
      if (
        cleanedObj[field] !== undefined &&
        cleanedObj[field] !== null &&
        cleanedObj[field] !== ""
      ) {
        const num = Number(cleanedObj[field]);
        if (!isNaN(num)) {
          cleanedObj[field] = num;
        } else {
          delete cleanedObj[field];
        }
      } else {
        delete cleanedObj[field];
      }
    }

    // Migrate legacy batchSize to bulkApiV1BatchSize
    if (cleanedObj.batchSize !== undefined) {
      const batchNum = Number(cleanedObj.batchSize);
      if (!isNaN(batchNum) && cleanedObj.bulkApiV1BatchSize === undefined) {
        cleanedObj.bulkApiV1BatchSize = batchNum;
      }
      delete cleanedObj.batchSize;
    }

    // Clean up empty optional string fields
    const optionalStringFields = [
      "deleteQuery",
      "sourceRecordsFilter",
      "targetRecordsFilter",
    ];
    for (const field of optionalStringFields) {
      if (cleanedObj[field] !== undefined && !cleanedObj[field]) {
        delete cleanedObj[field];
      }
    }

    // Clean up empty array fields
    const optionalArrayFields = ["excludedFields", "excludedFromUpdateFields"];
    for (const field of optionalArrayFields) {
      if (Array.isArray(cleanedObj[field])) {
        cleanedObj[field] = cleanedObj[field].filter(
          (v: any) => v && typeof v === "string" && v.trim(),
        );
        if (cleanedObj[field].length === 0) {
          delete cleanedObj[field];
        }
      }
    }

    cleanedObj.updateWithMockData = obj.updateWithMockData === true;
    cleanedObj.mockFields = normalizeMockFields(obj.mockFields);

    if (!cleanedObj.updateWithMockData || cleanedObj.mockFields.length === 0) {
      delete cleanedObj.mockFields;
    }

    // Remove internal fields
    delete cleanedObj.objectName;
    // Remove legacy alias
    if (cleanedObj.externalid) {
      delete cleanedObj.externalid;
    }

    return cleanedObj;
  });
}

function normalizeMockFields(
  mockFields:
    | Array<{
        name?: string;
        pattern?: string;
        locale?: string;
        excludedRegex?: string;
        includedRegex?: string;
      }>
    | undefined,
): Array<{
  name: string;
  pattern: string;
  locale?: string;
  excludedRegex?: string;
  includedRegex?: string;
}> {
  if (!Array.isArray(mockFields)) {
    return [];
  }
  return mockFields
    .filter((mockField) => mockField && typeof mockField === "object")
    .map((mockField) => {
      const result: any = {
        name: mockField.name || "",
        pattern: mockField.pattern || "",
      };
      if (mockField.locale) {
        result.locale = mockField.locale;
      }
      if (mockField.excludedRegex) {
        result.excludedRegex = mockField.excludedRegex;
      }
      if (mockField.includedRegex) {
        result.includedRegex = mockField.includedRegex;
      }
      return result;
    })
    .filter((mockField) => mockField.name || mockField.pattern);
}

function extractObjectName(query: string): string {
  if (!query) {
    return "";
  }
  const match = query.match(
    /from\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)?(?:__[A-Za-z0-9_]+)*)/i,
  );
  return match ? match[1] : "";
}
