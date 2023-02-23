import axios from "axios";
import * as c from "chalk";
import * as child from "child_process";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as util from "util";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { Logger } from "./logger";
const exec = util.promisify(child.exec);

export const RECOMMENDED_SFDX_CLI_VERSION = null; //"7.111.6";

let REMOTE_CONFIGS: any = {};
let PROJECT_CONFIG: any = null;
let COMMANDS_RESULTS: any = {};

export function preLoadCache() {
  console.time("sfdxHardisPreload");
  const preLoadPromises = [];
  const cliCommands = [
    "node --version",
    "git --version",
    "sfdx --version",
    "sfdx plugins",
    "npm show sfdx-cli version",
    "npm show sfdx-hardis version",
    "npm show sfdx-essentials version",
    "npm show sfdmu version",
    "npm show sfdx-git-delta version",
    "npm show texei-sfdx-plugin version",
  ];
  for (const cmd of cliCommands) {
    preLoadPromises.push(execCommand(cmd, {}, {}));
  }
  const sfdxJsonCommands = [
    "sfdx force:org:display",
    "sfdx force:config:get defaultdevhubusername",
    "sfdx hardis:config:get --level project",
    "sfdx hardis:scratch:pool:view",
    "sfdx hardis:config:get --level user",
  ];
  for (const cmd of sfdxJsonCommands) {
    preLoadPromises.push(execSfdxJson(cmd, {}, {}));
  }
  Promise.all(preLoadPromises).then(() => {
    console.timeEnd("sfdxHardisPreload");
  });
}

export function resetCache() {
  REMOTE_CONFIGS = {};
  PROJECT_CONFIG = null;
  COMMANDS_RESULTS = {};
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
  }
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
      commandResult =
        COMMANDS_RESULTS[command].result ??
        (await COMMANDS_RESULTS[command].promise);
    } else {
      // no cache
      Logger.log("[vscode-sfdx-hardis][command] " + command);
      console.time(command);
      const commandResultPromise = exec(command, execOptions);
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
        c.red(`[sfdx-hardis][ERROR] Command failed: ${commandResult}`)
      );
    }
    if (commandResult.stderr && commandResult.stderr.length > 2) {
      Logger.log(
        "[sfdx-hardis][WARNING] stderr: " + c.yellow(commandResult.stderr)
      );
    }
    return parsedResult;
  } catch (e: any) {
    // Manage case when json is not parsable
    return {
      status: 1,
      errorMessage: c.red(
        `[sfdx-hardis][ERROR] Error parsing JSON in command result: ${e.message}\n${commandResult.stdout}\n${commandResult.stderr})`
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
  }
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
  options: { recalc: boolean } = { recalc: false }
) {
  if (sfdxProjectJsonFound === null || options.recalc === true) {
    sfdxProjectJsonFound = fs.existsSync(
      path.join(getWorkspaceRoot(), "sfdx-project.json")
    );
  }
  return sfdxProjectJsonFound;
}

export async function loadProjectSfdxHardisConfig() {
  if (PROJECT_CONFIG) {
    return PROJECT_CONFIG;
  }
  const configRes = await execSfdxJson(
    "sfdx hardis:config:get --level project",
    null,
    { fail: false, output: true }
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
        JSON.stringify(remoteConfigResp)
    );
  }
  const remoteConfig = yaml.load(remoteConfigResp.data);
  REMOTE_CONFIGS[url] = remoteConfig;
  return remoteConfig;
}

// Read filesystem config file
async function loadFromLocalConfigFile(file: string) {
  const localConfig = yaml.load(fs.readFileSync(file).toString());
  return localConfig;
}
