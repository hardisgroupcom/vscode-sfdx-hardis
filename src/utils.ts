import * as c from "chalk";
import * as child from "child_process";
import * as fs from "fs-extra";
import * as path from "path";
import * as util from "util";
import * as vscode from "vscode";
import { Logger } from "./logger";
const exec = util.promisify(child.exec);

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
  console.time(command);
  let commandResult = null;
  // Call command (disable color before for json parsing)
  const prevForceColor = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "0";
  const execOptions: any = {
    maxBuffer: 10000 * 10000,
    cwd: options.cwd || vscode.workspace.rootPath,
    env: process.env,
  };
  Logger.log('[vscode-sfdx-hardis][command] '+command);
  try {
    commandResult = await exec(command, execOptions);
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
  console.timeEnd(command);
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
  if (currentWorkspaceFolderUri.startsWith("/")) {
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
