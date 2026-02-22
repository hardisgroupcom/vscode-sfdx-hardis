import axios from "axios";
import c from "chalk";
import * as childProcess from "child_process";
import * as fs from "fs-extra";
import * as path from "path";
import simpleGit from "simple-git";

import { Worker } from "worker_threads";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { Logger } from "./logger";
import { CacheManager, CacheSection } from "./utils/cache-manager";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";

export const RECOMMENDED_SFDX_CLI_VERSION = null; //"7.111.6";
export const NODE_JS_MINIMUM_VERSION = 24.0;
export const RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION: string = "6.7.1";

// Interface for execCommand and execSfdxJson options
export interface ExecCommandOptions {
  fail?: boolean;
  output?: boolean;
  debug?: boolean;
  spinner?: boolean;
  cwd?: string;
  cacheExpiration?: number;
  cacheSection?: CacheSection;
}

let MULTITHREAD_ACTIVE: boolean | null = null;
let CACHE_IS_PRELOADED: boolean = false;
let COMMANDS_RESULTS: Record<string, any> = {};
let GIT_MENUS: any[] | null = null;
let PROJECT_CONFIG: any = null;
let REMOTE_CONFIGS: Record<string, any> = {};

export function isMultithreadActive() {
  if (MULTITHREAD_ACTIVE !== null) {
    return MULTITHREAD_ACTIVE;
  }
  const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  if (
    config?.enableMultithread === true &&
    fs.existsSync(path.join(__dirname, "worker.js"))
  ) {
    MULTITHREAD_ACTIVE = true;
    return true;
  }
  MULTITHREAD_ACTIVE = false;
  return false;
}

// --- Single Worker for CLI commands, with requestId mapping ---
let sharedWorker: Worker | null = null;
let sharedWorkerCallbacks: Map<
  string,
  { resolve: Function; reject: Function }
> = new Map();
let sharedWorkerRequestSeq = 0;

export async function execShell(cmd: string, execOptions: any) {
  if (isMultithreadActive()) {
    if (!sharedWorker) {
      sharedWorker = new Worker(path.join(__dirname, "worker.js"));
      sharedWorker.on("message", (result: any) => {
        const reqId = result && result.requestId;
        if (!reqId || !sharedWorkerCallbacks.has(reqId)) {
          return;
        }
        const cb = sharedWorkerCallbacks.get(reqId)!;
        sharedWorkerCallbacks.delete(reqId);
        if (result && result.error) {
          cb.reject(result);
        } else {
          cb.resolve({ stdout: result.stdout, stderr: result.stderr });
        }
      });
      sharedWorker.on("exit", () => {
        sharedWorker = null;
      });
      sharedWorker.on("error", () => {
        sharedWorker = null;
      });
    }
    return new Promise<any>((resolve, reject) => {
      const requestId = `req_${Date.now()}_${sharedWorkerRequestSeq++}`;
      sharedWorkerCallbacks.set(requestId, { resolve, reject });
      sharedWorker!.postMessage({
        cliCommand: { cmd: cmd, execOptions: JSON.stringify(execOptions) },
        requestId,
        path: "./worker.ts",
      });
    });
  } else {
    // Use main process to perform CLI command
    return new Promise<any>((resolve, reject) => {
      childProcess.exec(cmd, execOptions, (error, stdout, stderr) => {
        if (error) {
          return reject({ error: error, stdout: stdout, stderr: stderr });
        }
        return resolve({ stdout: stdout, stderr: stderr });
      });
    });
  }
}

export function isCachePreloaded() {
  if (CACHE_IS_PRELOADED === true) {
    return true;
  }
  return false;
}

export function preLoadCache() {
  console.time("sfdxHardisPreload");
  const preLoadPromises = [];
  const oneDayInMs = 1000 * 60 * 60 * 24;
  const cliCommands = [
    ["node --version", oneDayInMs * 30], // 30 days
    ["git --version", oneDayInMs * 30], // 30 days
    ["sf --version", oneDayInMs], // 1 day
    ["sf plugins", oneDayInMs], // 1 day
  ];
  for (const cmd of cliCommands) {
    preLoadPromises.push(
      execCommand(String(cmd[0]), {
        cacheExpiration: Number(cmd[1]),
        cacheSection: "app",
      }),
    );
  }
  const sfdxJsonCommands = [
    ["sf org display", oneDayInMs], // 1 day
    ["sf config get target-dev-hub", oneDayInMs], // 1 day
  ];
  for (const cmd of sfdxJsonCommands) {
    preLoadPromises.push(
      execSfdxJson(String(cmd[0]), {
        cacheExpiration: Number(cmd[1]),
        cacheSection: "project",
      }),
    );
  }
  const npmPackages = [
    "@salesforce/cli",
    "@salesforce/plugin-packaging",
    "sfdx-hardis",
    "sfdmu",
    "sfdx-git-delta",
    "sf-git-merge-driver",
    // "texei-sfdx-plugin",
  ];
  for (const npmPackage of npmPackages) {
    preLoadPromises.push(getNpmLatestVersion(npmPackage));
  }
  Promise.allSettled(preLoadPromises).then(() => {
    console.timeEnd("sfdxHardisPreload");
    CACHE_IS_PRELOADED = true;
    vscode.commands.executeCommand(
      "vscode-sfdx-hardis.refreshStatusView",
      true,
    );
    vscode.commands.executeCommand(
      "vscode-sfdx-hardis.refreshPluginsView",
      true,
    );
  });
}

export async function getNpmLatestVersion(
  packageName: string,
): Promise<string> {
  if (CacheManager.get("app", packageName)) {
    return CacheManager.get("app", packageName) as string;
  }
  const versionRes = await axios.get(
    "https://registry.npmjs.org/" + packageName + "/latest",
  );
  const version = versionRes.data.version;
  CacheManager.set("app", packageName, version, 1000 * 60 * 60 * 24); // 1 day
  return version;
}

export async function resetCache() {
  await CacheManager.delete("app");
  await CacheManager.delete("project");
  COMMANDS_RESULTS = {};
  GIT_MENUS = null;
  PROJECT_CONFIG = null;
  REMOTE_CONFIGS = {};
  Logger.log("[vscode-sfdx-hardis] Reset cache");
}

export async function execCommandWithProgress(
  command: string,
  options: ExecCommandOptions = {
    fail: false,
    output: false,
    debug: false,
    spinner: true,
  },
  progressMessage: string,
) {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressMessage || "Executing command...",
      cancellable: false,
    },
    async () => {
      return await execCommand(command, options);
    },
  );
}

/* jscpd:ignore-start */
export async function execSfdxJsonWithProgress(
  command: string,
  options: ExecCommandOptions = {
    fail: false,
    output: false,
    debug: false,
    spinner: true,
  },
  progressMessage: string,
) {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressMessage || "Executing command...",
      cancellable: false,
    },
    async () => {
      return await execSfdxJson(command, options);
    },
  );
}
/* jscpd:ignore-end */

// Execute command
export async function execCommand(
  command: string,
  options: ExecCommandOptions = {
    fail: false,
    output: false,
    debug: false,
    spinner: true,
  },
): Promise<any> {
  let commandResult = null;
  // Call command (disable color before for json parsing)
  const prevForceColor = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "0";
  const execOptions: any = {
    maxBuffer: 10000 * 10000,
    cwd: options.cwd || vscode.workspace.rootPath,
    env: { ...process.env },
  };
  const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  if (config.get("disableTlsRejectUnauthorized") === true) {
    execOptions.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  if (config.get("debugSfdxHardisCommands") === true) {
    execOptions.env = {
      ...execOptions.env,
      NODE_OPTIONS: "--inspect-brk",
    };
  }
  const cacheSection = options.cacheSection;
  const cacheExpiration = options.cacheExpiration;
  // Try to get from CacheManager if cacheSection is set
  if (cacheSection) {
    const cached = CacheManager.get(cacheSection, command);
    if (cached) {
      process.env.FORCE_COLOR = prevForceColor;
      return cached;
    }
  }
  try {
    if (COMMANDS_RESULTS[command]) {
      // use cache
      Logger.log(
        `[vscode-sfdx-hardis][command] Waiting for promise already started for command ${command}`,
      );
      commandResult =
        COMMANDS_RESULTS[command].result ??
        (await COMMANDS_RESULTS[command].promise);
      delete COMMANDS_RESULTS[command];
    } else {
      // no cache
      Logger.log("[vscode-sfdx-hardis][command] " + command);
      console.time(command);
      const commandResultPromise = await execShell(command, execOptions);
      COMMANDS_RESULTS[command] = { promise: commandResultPromise };
      commandResult = await commandResultPromise;
      COMMANDS_RESULTS[command] = { result: commandResult };
      setTimeout(() => {
        if (COMMANDS_RESULTS[command] && COMMANDS_RESULTS[command].result) {
          delete COMMANDS_RESULTS[command];
        }
      }, 1000 * 20); // keep result in memory for 20 seconds
      console.timeEnd(command);
    }
  } catch (e: any) {
    console.timeEnd(command);
    process.env.FORCE_COLOR = prevForceColor;
    // Display error in red if not json
    if (!command.includes("--json") || options.fail === true) {
      if (options.fail === true) {
        Logger.log(`ERROR: ${e.stdout}\n${e.stderr}`);
        throw e;
      }
    }
    // if --json, we should not have a crash, so return status 1 + output log
    let res: any = {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      error: e.error || e,
      status: 1,
      errorMessage: `[sfdx-hardis][ERROR] Error processing command\n$${e.stdout}\n${e.stderr}`,
    };
    try {
      const parsedResult = JSON.parse(e.stdout.toString());
      res = Object.assign(res, parsedResult);
    } catch {
      res.unableToParseJson = true;
    }
    await promptToDisableTlsIfNeeded(
      `${e?.stderr || ""}\n${e?.stdout || ""}\n${e?.message || ""}`,
    );
    return res;
  }
  // Display output if requested, for better user understanding of the logs
  if (options.output || options.debug) {
    Logger.log(commandResult.stdout.toString());
  }
  // Return status 0 if not --json
  process.env.FORCE_COLOR = prevForceColor;
  if (!command.includes("--json")) {
    const resultObj = {
      status: 0,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
    };
    if (
      cacheSection &&
      typeof cacheExpiration === "number" &&
      !CacheManager.get(cacheSection, command)
    ) {
      CacheManager.set(cacheSection, command, resultObj, cacheExpiration);
    }
    return resultObj;
  }
  // Parse command result if --json
  try {
    const parsedResult = JSON.parse(commandResult.stdout.toString());
    if (options.fail && parsedResult.status && parsedResult.status > 0) {
      throw new Error(
        c.red(`[sfdx-hardis][ERROR] Command failed: ${commandResult}`),
      );
    }
    if (commandResult.stderr && commandResult.stderr.length > 2) {
      Logger.log(
        "[sfdx-hardis][WARNING] stderr: " + c.yellow(commandResult.stderr),
      );
    }
    if (cacheSection && typeof cacheExpiration === "number") {
      CacheManager.set(cacheSection, command, parsedResult, cacheExpiration);
    }
    return parsedResult;
  } catch (e: any) {
    // Manage case when json is not parsable
    const errorObj = {
      status: 1,
      errorMessage: c.red(
        `[sfdx-hardis][ERROR] Error parsing JSON in command result: ${e.message}\n${commandResult.stdout}\n${commandResult.stderr})`,
      ),
    };
    if (cacheSection && typeof cacheExpiration === "number") {
      CacheManager.set(cacheSection, command, errorObj, cacheExpiration);
    }
    return errorObj;
  }
}

// Execute salesforce DX command with --json
export async function execSfdxJson(
  command: string,
  options: ExecCommandOptions = {
    fail: false,
    output: false,
    debug: false,
  },
): Promise<any> {
  if (!command.includes("--json")) {
    command += " --json";
  }
  return await execCommand(command, options);
}

export function getWorkspaceRoot() {
  let currentWorkspaceFolderUri = ".";
  if ((vscode.workspace.workspaceFolders?.length || 0) > 0) {
    currentWorkspaceFolderUri = (vscode.workspace.workspaceFolders || [])[0].uri
      .path;
  }
  if (
    process.platform === "win32" &&
    currentWorkspaceFolderUri.startsWith("/")
  ) {
    currentWorkspaceFolderUri = currentWorkspaceFolderUri.substr(1);
  }
  return currentWorkspaceFolderUri;
}

let sfdxProjectJsonFound: boolean | null = null;
export function hasSfdxProjectJson(
  options: { recalc: boolean } = { recalc: false },
) {
  if (sfdxProjectJsonFound === null || options.recalc === true) {
    sfdxProjectJsonFound = fs.existsSync(
      path.join(getWorkspaceRoot(), "sfdx-project.json"),
    );
  }
  return sfdxProjectJsonFound;
}

export function getSfdxProjectJson() {
  if (hasSfdxProjectJson()) {
    return JSON.parse(
      fs
        .readFileSync(path.join(getWorkspaceRoot(), "sfdx-project.json"))
        .toString(),
    );
  }
  return {};
}

// Cache org info so it can be reused later with better perfs
export function setOrgCache(newOrgInfo: any) {
  const orgKey = `${newOrgInfo.username}||${newOrgInfo.instanceUrl}`;
  if (!CacheManager.get("orgs", orgKey)) {
    CacheManager.set("orgs", orgKey, newOrgInfo, 1000 * 60 * 60 * 24 * 30); // 30 days
  }
  const instanceUrlKey = `username-instanceUrl:${newOrgInfo.username}`;
  if (!CacheManager.get("orgs", instanceUrlKey)) {
    CacheManager.set(
      "orgs",
      instanceUrlKey,
      newOrgInfo.instanceUrl,
      1000 * 60 * 60 * 24 * 90,
    ); // 90 days
  }
}

// Get from org cache
export function findInOrgCache(orgCriteria: any) {
  const orgKeys = [
    `${orgCriteria.username}||${orgCriteria.instanceUrl}`,
    `${orgCriteria.username}||${orgCriteria.instanceUrl}/`,
  ];
  for (const orgKey of orgKeys) {
    const cached = CacheManager.get("orgs", orgKey);
    if (cached) {
      return cached;
    }
  }
  return null;
}

export function listLocalSfConfigFilePaths(): string[] {
  return [".sf/config.json", ".sfdx/sfdx-config.json"];
}

export async function listLocalSfConfigFiles(): Promise<string[]> {
  const configFiles = listLocalSfConfigFilePaths();
  const workspaceRoot = getWorkspaceRoot();
  const foundFiles: string[] = [];
  for (const configFile of configFiles) {
    const fullPath = path.join(workspaceRoot, configFile);
    if (fs.existsSync(fullPath)) {
      foundFiles.push(fullPath);
    }
  }
  return foundFiles;
}

export async function listLocalSfConfigFilesContent(): Promise<any[]> {
  const configFilePaths = await listLocalSfConfigFiles();
  const configFilesContent: any[] = [];
  for (const configFilePath of configFilePaths) {
    try {
      const fileContent = fs.readFileSync(configFilePath).toString();
      const parsedContent = JSON.parse(fileContent);
      configFilesContent.push(parsedContent);
    } catch {
      // ignore parse errors
    }
  }
  return configFilesContent;
}

export async function getDefaultTargetOrgUsername(): Promise<string | null> {
  const sfdxConfigs = await listLocalSfConfigFilesContent();
  for (const sfdxConfig of sfdxConfigs) {
    if (sfdxConfig["target-org"]) {
      return sfdxConfig["target-org"];
    } else if (sfdxConfig["defaultusername"]) {
      return sfdxConfig["defaultusername"];
    }
  }
  return null;
}

export async function getUsernameInstanceUrl(
  username: string,
): Promise<string | null> {
  const cacheValue = CacheManager.get(
    "orgs",
    `username-instanceUrl:${username}`,
  );
  if (cacheValue) {
    return cacheValue as string;
  }
  // request org
  const orgInfoResult = await execSfdxJson(
    `sf org display --target-org ${username}`,
    {
      fail: false,
      output: false,
      cacheExpiration: 1000 * 60 * 60 * 24, // 1 day (milliseconds)
      cacheSection: "orgs",
    },
  );
  if (orgInfoResult.result) {
    const orgInfo = orgInfoResult.result || orgInfoResult;
    if (orgInfo.instanceUrl) {
      setOrgCache(orgInfo);
      return orgInfo.instanceUrl;
    }
  }
  return null;
}

export function isGitMenusItemsLoaded(): boolean {
  if (GIT_MENUS) {
    return true;
  }
  return false;
}

export function getGitMenusItems(): any[] | null {
  return GIT_MENUS;
}

export function setGitMenusItems(menuItems: any): void {
  GIT_MENUS = menuItems;
}

export function isProjectSfdxConfigLoaded() {
  if (PROJECT_CONFIG) {
    return true;
  }
  return false;
}

export async function loadProjectSfdxHardisConfig() {
  if (PROJECT_CONFIG) {
    return PROJECT_CONFIG;
  }
  PROJECT_CONFIG = await getConfig("project");
  return PROJECT_CONFIG;
}

export async function loadExternalSfdxHardisConfiguration() {
  const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  if (config.get("customCommandsConfiguration")) {
    // load config
    const customCommandsConfiguration: string =
      config.get("customCommandsConfiguration") || "";
    const remoteConfig = customCommandsConfiguration.startsWith("http")
      ? await loadFromRemoteConfigFile(customCommandsConfiguration)
      : loadFromLocalConfigFile(customCommandsConfiguration);
    return remoteConfig;
  }
  return {};
}

// Fetch remote config file
/* jscpd:ignore-start */
async function loadFromRemoteConfigFile(url: string) {
  if (REMOTE_CONFIGS[url]) {
    return REMOTE_CONFIGS[url];
  }
  const remoteConfigResp = await axios.get(url);
  if (remoteConfigResp.status !== 200) {
    throw new Error(
      "[sfdx-hardis] Unable to read remote configuration file at " +
      url +
      "\n" +
      JSON.stringify(remoteConfigResp),
    );
  }
  const remoteConfig = yaml.load(remoteConfigResp.data);
  REMOTE_CONFIGS[url] = remoteConfig;
  return remoteConfig;
}
/* jscpd:ignore-end */

/**
 * Helper function to get the config file paths for .sfdx-hardis.yml
 * Returns both root and config directory paths
 */
function getSfdxHardisConfigPaths(): {
  rootConfigFile: string;
  configConfigFile: string;
} | null {
  if (!vscode.workspace.workspaceFolders) {
    return null;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const rootConfigFile = path.join(workspaceRoot, `.sfdx-hardis.yml`);
  const configConfigFile = path.join(workspaceRoot, `config/.sfdx-hardis.yml`);
  return { rootConfigFile, configConfigFile };
}

export async function readSfdxHardisConfig(): Promise<any> {
  const configPaths = getSfdxHardisConfigPaths();
  if (configPaths) {
    const { rootConfigFile, configConfigFile } = configPaths;
    if (fs.existsSync(rootConfigFile)) {
      return await loadFromLocalConfigFile(rootConfigFile);
    }
    if (fs.existsSync(configConfigFile)) {
      return await loadFromLocalConfigFile(configConfigFile);
    }
  }
  return {};
}

export async function writeSfdxHardisConfig(
  key: string,
  value: any,
): Promise<any> {
  const configPaths = getSfdxHardisConfigPaths();
  if (configPaths) {
    const { rootConfigFile, configConfigFile } = configPaths;
    const configFile = fs.existsSync(rootConfigFile)
      ? rootConfigFile
      : configConfigFile;
    await fs.ensureDir(path.dirname(configFile));
    const config = await readSfdxHardisConfig();
    config[key] = value;
    await fs.writeFile(configFile, yaml.dump(config));
  }
  return {};
}

// Read filesystem config file
export async function loadFromLocalConfigFile(file: string): Promise<any> {
  try {
    const localConfig = yaml.load(fs.readFileSync(file).toString());
    return localConfig;
  } catch {
    return {};
  }
}

export async function getGitParentBranch() {
  try {
    const outputFromGit = (
      await simpleGit({ trimmed: true }).raw("show-branch", "-a")
    ).split("\n");
    const rev = await simpleGit({ trimmed: true }).raw(
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    );
    const allLinesNormalized = outputFromGit.map((line) =>
      line.trim().replace(/\].*/, ""),
    );
    const indexOfCurrentBranch = allLinesNormalized.indexOf(`* [${rev}`);
    if (indexOfCurrentBranch > -1) {
      const parentBranch = allLinesNormalized[indexOfCurrentBranch + 1].replace(
        /^.*\[/,
        "",
      );
      return parentBranch;
    }
  } catch {
    return null;
  }
  return null;
}

const ansiPattern = [
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
  "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
].join("|");
const ansiRegex = new RegExp(ansiPattern, "g");

export function stripAnsi(str: string) {
  return (str || "").replace(ansiRegex, "");
}

let IS_WEB_VSCODE: boolean | null = null;
export function isWebVsCode() {
  if (IS_WEB_VSCODE === null) {
    IS_WEB_VSCODE = vscode.env.uiKind === vscode.UIKind.Web;
  }
  return IS_WEB_VSCODE;
}

let gitBashPath: string | null | undefined = undefined;
export function getGitBashPath() {
  if (gitBashPath !== undefined) {
    return gitBashPath;
  }
  // Common install paths for Git Bash on Windows
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      gitBashPath = candidate;
      return candidate;
    }
  }
  gitBashPath = null;
  return null;
}

let pythonCommand: string | null = null;
export async function getPythonCommand() {
  if (pythonCommand !== null) {
    return pythonCommand;
  }
  const candidates = ["python", "python3", "py", "py3"];
  for (const candidate of candidates) {
    try {
      const result = await execShell(`${candidate} --version`, {
        maxBuffer: 10000 * 10000,
      });
      if (
        result &&
        result.stdout &&
        result.stdout.toString().includes("Python")
      ) {
        pythonCommand = candidate;
        return candidate;
      }
    } catch {
      console.log(`Python not found with command: ${candidate}`);
    }
  }
  return null;
}

const certificateErrorPatterns: RegExp[] = [
  /self[-\s]?signed certificate/i,
  /unable to get local issuer certificate/i,
  /unable to verify the first certificate/i,
  /certificate verify failed/i,
  /certificate has expired/i,
  /cert_has_expired/i,
  /depth_zero_self_signed_cert/i,
  /unable_to_get_issuer_cert_locally/i,
  /unable_to_verify_leaf_signature/i,
  /err_tls_cert_altname_invalid/i,
];

function stringifyCertificateMessage(message?: unknown): string {
  if (!message) {
    return "";
  }
  if (typeof message === "string") {
    return message;
  }
  if (Buffer.isBuffer(message)) {
    return message.toString();
  }
  if (message instanceof Error) {
    return `${message.name}: ${message.message}`;
  }
  return String(message);
}

export function containsCertificateIssue(message?: unknown): boolean {
  const content = stringifyCertificateMessage(message);
  if (!content) {
    return false;
  }
  return certificateErrorPatterns.some((pattern) => pattern.test(content));
}

let tlsPromptInProgress = false;

export async function promptToDisableTlsIfNeeded(
  message?: unknown,
): Promise<boolean> {
  if (!containsCertificateIssue(message)) {
    return false;
  }
  const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  if (config.get("disableTlsRejectUnauthorized") === true) {
    return false;
  }
  if (tlsPromptInProgress) {
    return false;
  }
  tlsPromptInProgress = true;
  try {
    const enableLabel = "Enable TLS override";
    const selection = await vscode.window.showWarningMessage(
      "Certificate issues were detected while running an SFDX Hardis command. Do you want to enable the setting 'vsCodeSfdxHardis.disableTlsRejectUnauthorized' to ignore TLS errors? (this is not very secured, but may be required in some corporate environments with self-signed certificates)",
      enableLabel,
      "Cancel",
    );
    if (selection === enableLabel) {
      await config.update(
        "disableTlsRejectUnauthorized",
        true,
        vscode.ConfigurationTarget.Global,
      );
      vscode.window.showInformationMessage(
        "TLS certificate validation is now disabled for SFDX Hardis commands. Re-run the command to continue. (you might need to restart VS Code for this change to take effect)",
      );
      return true;
    }
    return false;
  } finally {
    tlsPromptInProgress = false;
  }
}

export function openFolderInExplorer(folderPath: string) {
  const platform = process.platform;
  if (platform === "win32") {
    childProcess.exec(`explorer "${folderPath}"`);
  } else if (platform === "darwin") {
    childProcess.exec(`open "${folderPath}"`);
  } else if (platform === "linux") {
    childProcess.exec(`xdg-open "${folderPath}"`);
  } else {
    vscode.window.showErrorMessage(`Unsupported platform ${platform}`);
  }
}

export async function getReportDirectory() {
  const configProject = await getConfig("project");
  const workspaceRoot = getWorkspaceRoot();
  const defaultReportDir = path.join(
    workspaceRoot || process.cwd(),
    "hardis-report",
  );
  const reportDir = configProject.reportDirectory || defaultReportDir;
  await fs.ensureDir(reportDir);
  return reportDir;
}

export async function listSfdxProjectPackageDirectories() {
  let packageDirs: string[] = [];
  const workspaceRoot = getWorkspaceRoot();
  try {
    const sfdxProjectPath = path.join(workspaceRoot, "sfdx-project.json");
    try {
      const txt = await fs.readFile(sfdxProjectPath, "utf8");
      const pj = JSON.parse(txt || "{}");
      if (
        pj &&
        Array.isArray(pj.packageDirectories) &&
        pj.packageDirectories.length > 0
      ) {
        packageDirs = pj.packageDirectories
          .map((d: any) => (d && d.path ? d.path.toString() : null))
          .filter(Boolean);
      }
    } catch {
      packageDirs = [];
    }
  } catch {
    packageDirs = [];
  }
  return packageDirs;
}
