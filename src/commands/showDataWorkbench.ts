import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { getWorkspaceRoot, openFolderInExplorer } from "../utils";
import * as fs from "fs-extra";
import path from "path";
import { Logger } from "../logger";
import { isQueryValid, parseQuery } from "@jetstreamapp/soql-parser-js";

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
  lineCount: number;
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

      const workspaces = await loadDataWorkspaces();

      const panel = lwcManager.getOrCreatePanel("s-data-workbench", {
        workspaces: workspaces,
      });

      panel.onMessage(async (type: string, data: any) => {
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
          default:
            break;
        }
      });
    },
  );
  commands.disposables.push(disposable);
}

async function loadDataWorkspaces(): Promise<DataWorkspace[]> {
  const workspaceRoot = getWorkspaceRoot();
  const dataFolder = path.join(workspaceRoot, "scripts", "data");

  if (!fs.existsSync(dataFolder)) {
    return [];
  }

  const workspaces: DataWorkspace[] = [];
  const folderContents = fs.readdirSync(dataFolder, { withFileTypes: true });

  for (const dirent of folderContents) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const workspacePath = path.join(dataFolder, dirent.name);
    const exportJsonPath = path.join(workspacePath, "export.json");

    if (!fs.existsSync(exportJsonPath)) {
      continue;
    }

    try {
      const exportConfig = JSON.parse(fs.readFileSync(exportJsonPath, "utf8"));

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

      const exportedFiles = listExportedFiles(workspacePath);
      const logFiles = listLogFiles(workspacePath);

      workspaces.push({
        name: dirent.name,
        path: workspacePath,
        configPath: exportJsonPath,
        label: exportConfig.sfdxHardisLabel || dirent.name,
        description: exportConfig.sfdxHardisDescription || "",
        objects: objects,
        objectsCount: objects.length,
        exportedFiles: exportedFiles,
        logFiles: logFiles,
        scriptSettings: scriptSettings,
      });
    } catch (error) {
      Logger.log(
        `Error reading export.json for data workspace ${dirent.name}: ${error}`,
      );
    }
  }

  return workspaces;
}

function listExportedFiles(workspacePath: string): ExportedFile[] {
  const allowedExtensions = new Set([".csv", ".zip"]);
  const files: ExportedFile[] = [];
  const entries: fs.Dirent[] = fs.readdirSync(workspacePath, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const entryPath = path.join(workspacePath, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      continue;
    }

    try {
      const stats = fs.statSync(entryPath);
      const lineCount = countFileLines(entryPath);
      if (entry.name === "MissingParentRecordsReport.csv" && lineCount === 0) {
        continue;
      }
      files.push({
        name: entry.name,
        path: entryPath,
        relativePath: entry.name,
        size: stats.size,
        modified: stats.mtimeMs,
        created: stats.birthtimeMs,
        lineCount: lineCount,
      });
    } catch {
      // ignore unreadable files
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function listLogFiles(workspacePath: string): LogFile[] {
  const allowedExtensions = new Set([".csv", ".log"]);
  const logTypeOrder: Record<string, number> = {
    source: 0,
    target: 1,
    log: 2,
    report: 3,
  };
  const files: LogFile[] = [];

  // Scan /source, /target, /logs and /reports subdirectories
  const subDirs: Array<{
    dir: string;
    logType: "source" | "target" | "log" | "report";
  }> = [
    { dir: "source", logType: "source" },
    { dir: "target", logType: "target" },
    { dir: "logs", logType: "log" },
    { dir: "reports", logType: "report" },
  ];

  for (const { dir, logType } of subDirs) {
    const dirPath = path.join(workspacePath, dir);
    if (!fs.existsSync(dirPath)) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        continue;
      }
      const entryPath = path.join(dirPath, entry.name);
      try {
        const stats = fs.statSync(entryPath);
        files.push({
          name: entry.name,
          path: entryPath,
          relativePath: `${dir}/${entry.name}`,
          size: stats.size,
          modified: stats.mtimeMs,
          created: stats.birthtimeMs,
          lineCount: countFileLines(entryPath),
          logType: logType,
        });
      } catch {
        // ignore unreadable files
      }
    }
  }

  // Scan workspace root for .log files
  try {
    const rootEntries = fs.readdirSync(workspacePath, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isFile()) {
        continue;
      }
      if (path.extname(entry.name).toLowerCase() !== ".log") {
        continue;
      }
      const entryPath = path.join(workspacePath, entry.name);
      try {
        const stats = fs.statSync(entryPath);
        files.push({
          name: entry.name,
          path: entryPath,
          relativePath: entry.name,
          size: stats.size,
          modified: stats.mtimeMs,
          created: stats.birthtimeMs,
          lineCount: countFileLines(entryPath),
          logType: "log",
        });
      } catch {
        // ignore unreadable files
      }
    }
  } catch {
    // ignore unreadable root
  }

  // Sort: by logType order (source → target → log), then alphabetically
  return files.sort((a, b) => {
    const typeA = logTypeOrder[a.logType] ?? 99;
    const typeB = logTypeOrder[b.logType] ?? 99;
    if (typeA !== typeB) {
      return typeA - typeB;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
}

function countFileLines(filePath: string): number {
  try {
    const buffer = fs.readFileSync(filePath);
    let lines = 0;
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 10) {
        lines += 1;
      }
    }
    if (buffer.length > 0 && buffer[buffer.length - 1] !== 10) {
      lines += 1;
    }
    return lines;
  } catch {
    return 0;
  }
}

async function createDataWorkspace(data: any): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const dataFolder = path.join(workspaceRoot, "scripts", "data");
  const workspacePath = path.join(dataFolder, data.name);

  await fs.ensureDir(dataFolder);

  if (fs.existsSync(workspacePath)) {
    throw new Error(`Workspace ${data.name} already exists`);
  }

  await fs.ensureDir(workspacePath);

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
  await fs.writeFile(exportJsonPath, JSON.stringify(exportConfig, null, 2));

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
    await fs.move(oldPath, newPath, { overwrite: false });
  } else {
    await fs.ensureDir(newPath);
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

  await fs.writeFile(exportJsonPath, JSON.stringify(exportConfig, null, 2));

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
    await fs.remove(workspacePath);
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
