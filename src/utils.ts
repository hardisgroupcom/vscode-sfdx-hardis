import axios from "axios";
import c from "chalk";
import * as childProcess from "child_process";
import * as fs from "fs-extra";
import * as path from "path";
import simpleGit, { SimpleGit } from "simple-git";

import { Worker } from "worker_threads";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { Logger } from "./logger";

export const RECOMMENDED_SFDX_CLI_VERSION = null; //"7.111.6";
export const NODE_JS_MINIMUM_VERSION = 20.0;

let REMOTE_CONFIGS: any = {};
let PROJECT_CONFIG: any = null;
let COMMANDS_RESULTS: any = {};
let NPM_VERSIONS_CACHE: any = {};
let GIT_MENUS: any[] | null = null;
let ORGS_INFO_CACHE: any[] = [];
let USER_INSTANCE_URL_CACHE: any = {};
let MULTITHREAD_ACTIVE: boolean | null = null;
let CACHE_IS_PRELOADED: boolean = false;

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

export async function execShell(cmd: string, execOptions: any) {
  if (isMultithreadActive()) {
    // Use worker to perform CLI command
    return new Promise<any>((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "worker.js"), {
        workerData: {
          cliCommand: { cmd: cmd, execOptions: JSON.stringify(execOptions) },
          path: "./worker.ts",
        },
      });
      worker.on("message", (result) => {
        if (result.error) {
          reject(result.error);
        }
        resolve({ stdout: result.stdout, stderr: result.stderr });
      });
    });
  } else {
    // Use main process to perform CLI command
    return new Promise<any>((resolve, reject) => {
      childProcess.exec(cmd, execOptions, (error, stdout, stderr) => {
        if (error) {
          return reject(error);
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
  const cliCommands = [
    "node --version",
    "git --version",
    "sf --version",
    "sf plugins",
  ];
  for (const cmd of cliCommands) {
    preLoadPromises.push(execCommand(cmd, {}, {}));
  }
  const sfdxJsonCommands = [
    "sf org display",
    "sf config get target-dev-hub",
    "sf hardis:config:get --level project",
    "sf hardis:config:get --level user",
  ];
  for (const cmd of sfdxJsonCommands) {
    preLoadPromises.push(execSfdxJson(cmd, {}, {}));
  }
  const npmPackages = [
    "@salesforce/cli",
    "@salesforce/plugin-packaging",
    "sfdx-hardis",
    "sfdmu",
    "sfdx-git-delta",
    "texei-sfdx-plugin",
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
  if (NPM_VERSIONS_CACHE[packageName]) {
    return NPM_VERSIONS_CACHE[packageName];
  }
  const versionRes = await axios.get(
    "https://registry.npmjs.org/" + packageName + "/latest",
  );
  const version = versionRes.data.version;
  NPM_VERSIONS_CACHE[packageName] = version;
  return version;
}

export function resetCache() {
  REMOTE_CONFIGS = {};
  PROJECT_CONFIG = null;
  COMMANDS_RESULTS = {};
  NPM_VERSIONS_CACHE = {};
  GIT_MENUS = null;
  Logger.log("[vscode-sfdx-hardis] Reset cache");
}

// Execute command
export async function execCommand(
  command: string,
  commandThis: any,
  options: any = {
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
    env: process.env,
  };
  try {
    if (COMMANDS_RESULTS[command]) {
      // use cache
      Logger.log(
        `[vscode-sfdx-hardis][command] Waiting for promise already started for command ${command}`,
      );
      commandResult =
        COMMANDS_RESULTS[command].result ??
        (await COMMANDS_RESULTS[command].promise);
    } else {
      // no cache
      Logger.log("[vscode-sfdx-hardis][command] " + command);
      console.time(command);
      const commandResultPromise = await execShell(command, execOptions);
      COMMANDS_RESULTS[command] = { promise: commandResultPromise };
      commandResult = await commandResultPromise;
      COMMANDS_RESULTS[command] = { result: commandResult };
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
    return {
      status: 1,
      errorMessage: `[sfdx-hardis][ERROR] Error processing command\n$${e.stdout}\n${e.stderr}`,
    };
  }
  // Display output if requested, for better user understanding of the logs
  if (options.output || options.debug) {
    Logger.log(commandResult.stdout.toString());
  }
  // Return status 0 if not --json
  process.env.FORCE_COLOR = prevForceColor;
  if (!command.includes("--json")) {
    return {
      status: 0,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
    };
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
    return parsedResult;
  } catch (e: any) {
    // Manage case when json is not parsable
    return {
      status: 1,
      errorMessage: c.red(
        `[sfdx-hardis][ERROR] Error parsing JSON in command result: ${e.message}\n${commandResult.stdout}\n${commandResult.stderr})`,
      ),
    };
  }
}

// Execute salesforce DX command with --json
export async function execSfdxJson(
  command: string,
  commandThis: any,
  options: any = {
    fail: false,
    output: false,
    debug: false,
  },
): Promise<any> {
  if (!command.includes("--json")) {
    command += " --json";
  }
  return await execCommand(command, commandThis, options);
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
  ORGS_INFO_CACHE = ORGS_INFO_CACHE.map((orgInfo) => {
    if (
      orgInfo.username === newOrgInfo.username ||
      orgInfo.instanceUrl === newOrgInfo.instanceUrl
    ) {
      return newOrgInfo;
    }
    return orgInfo;
  });
}

// Get from org cache
export function findInOrgCache(orgCriteria: any) {
  for (const orgInfo of ORGS_INFO_CACHE) {
    if (
      orgInfo.username === orgCriteria.username ||
      orgInfo.instanceUrl === orgCriteria.instanceUrl ||
      orgInfo.instanceUrl === `${orgCriteria.instanceUrl}/`
    ) {
      return orgInfo;
    }
  }
  return null;
}

export async function getUsernameInstanceUrl(
  username: string,
): Promise<string | null> {
  // username - instances cache
  if (USER_INSTANCE_URL_CACHE[username]) {
    return USER_INSTANCE_URL_CACHE[username];
  }
  // org cache
  const orgInCache = findInOrgCache({ username: username });
  if (orgInCache) {
    return orgInCache.instanceUrl;
  }
  // request org
  const orgInfoResult = await execSfdxJson(
    `sf org display --target-org ${username}`,
    null,
    {
      fail: false,
      output: false,
    },
  );
  if (orgInfoResult.result) {
    const orgInfo = orgInfoResult.result || orgInfoResult;
    setOrgCache(orgInfo);
    if (orgInfo.instanceUrl) {
      USER_INSTANCE_URL_CACHE[username] = orgInfo.instanceUrl;
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
  const configRes = await execSfdxJson(
    "sf hardis:config:get --level project",
    null,
    { fail: false, output: true },
  );
  PROJECT_CONFIG = configRes?.result?.config || {};
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

export async function readSfdxHardisConfig(): Promise<any> {
  if (vscode.workspace.workspaceFolders) {
    const configFile = path.join(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      `config/.sfdx-hardis.yml`,
    );
    if (fs.existsSync(configFile)) {
      return await loadFromLocalConfigFile(configFile);
    }
  }
  return {};
}

export async function writeSfdxHardisConfig(
  key: string,
  value: any,
): Promise<any> {
  if (vscode.workspace.workspaceFolders) {
    const configFile = path.join(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      `config/.sfdx-hardis.yml`,
    );
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
  } catch (e) {
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
  } catch (e) {
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
