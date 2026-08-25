/*
 * Direct launch of the Salesforce CLI.
 *
 * `spawn("sf hardis:...", { shell: true })` goes through a shell (Git Bash on
 * Windows) which runs the npm `sf` shim script, which finally starts node on
 * `@salesforce/cli/bin/run.js`. The two intermediate processes only add
 * latency between the click and the moment the CLI is running. When the
 * installed CLI can be located, the command is started as
 * `node --no-deprecation <cli>/bin/run.js <args>` with no shell at all.
 *
 * Anything unusual (CLI not found, no node binary, shell syntax in the command
 * line) keeps the historical shell launch, so behavior never regresses.
 */
import * as fs from "fs";
import * as path from "path";
import { Logger } from "../logger";
import { findExecutable } from "./executableUtils";
import { tokenizeCommand } from "./sfCoreInProcess";

export type SfDirectLaunch = {
  nodePath: string;
  runJsPath: string;
};

// Characters that would need a shell to be interpreted: keep the shell launch
const SHELL_SYNTAX = /[|<>`$;&*?~()]/;

/**
 * Finds `@salesforce/cli/bin/run.js` from the resolved `sf` executable: the
 * npm global install (`<prefix>/node_modules/@salesforce/cli/bin/run.js`) or a
 * standalone installer (`<root>/bin/sf` + `<root>/bin/run.js`, `<root>` being
 * the `@salesforce/cli` package itself).
 */
export function findSfRunJs(sfExecutablePath: string): string | null {
  let start: string;
  try {
    start = fs.realpathSync(sfExecutablePath);
  } catch {
    start = sfExecutablePath;
  }
  let dir = path.dirname(start);
  const visited = new Set<string>();
  while (!visited.has(dir)) {
    visited.add(dir);
    const candidates = [
      path.join(dir, "node_modules", "@salesforce", "cli", "bin", "run.js"),
      path.join(dir, "bin", "run.js"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && isSalesforceCliPackage(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function isSalesforceCliPackage(runJsPath: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(runJsPath), "..", "package.json"),
        "utf8",
      ),
    );
    return pkg?.name === "@salesforce/cli";
  } catch {
    return false;
  }
}

/**
 * The node binary to run the CLI with: the one bundled by the standalone
 * installer next to run.js when present, else the `node` of the PATH.
 */
export async function findNodeForSf(runJsPath: string): Promise<string | null> {
  const bundled = path.join(
    path.dirname(runJsPath),
    process.platform === "win32" ? "node.exe" : "node",
  );
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  try {
    return (await findExecutable("node")) || null;
  } catch {
    return null;
  }
}

let directLaunchPromise: Promise<SfDirectLaunch | null> | null = null;

// Resolves once how the installed CLI can be started directly (null: use the shell)
export function resolveSfDirectLaunch(): Promise<SfDirectLaunch | null> {
  if (directLaunchPromise) {
    return directLaunchPromise;
  }
  directLaunchPromise = (async () => {
    try {
      const sfPath = await findExecutable("sf");
      if (!sfPath) {
        return null;
      }
      const runJsPath = findSfRunJs(sfPath);
      if (!runJsPath) {
        Logger.log(
          `[sfdx-hardis][launcher] run.js not found near ${sfPath}: sf commands are started through the shell`,
        );
        return null;
      }
      const nodePath = await findNodeForSf(runJsPath);
      if (!nodePath) {
        Logger.log(
          "[sfdx-hardis][launcher] no node binary found: sf commands are started through the shell",
        );
        return null;
      }
      Logger.log(
        `[sfdx-hardis][launcher] sf commands are started directly: ${nodePath} ${runJsPath}`,
      );
      return { nodePath, runJsPath };
    } catch (e: any) {
      Logger.log(
        `[sfdx-hardis][launcher] could not resolve a direct launch (${e?.message}): sf commands are started through the shell`,
      );
      return null;
    }
  })();
  return directLaunchPromise;
}

// Returns the resolved direct launch when it is already known, without waiting
export function getResolvedSfDirectLaunch(): SfDirectLaunch | null {
  return resolvedDirectLaunch;
}
let resolvedDirectLaunch: SfDirectLaunch | null = null;
export function prewarmSfDirectLaunch(): void {
  resolveSfDirectLaunch()
    .then((launch) => {
      resolvedDirectLaunch = launch;
    })
    .catch(() => {
      resolvedDirectLaunch = null;
    });
}

/**
 * Turns `sf hardis:work:new --websocket 2702` into the file + argv of a
 * shell-less spawn. Returns null when the command must keep the shell launch.
 */
export function buildSfDirectSpawn(
  command: string,
  launch: SfDirectLaunch | null,
): { file: string; args: string[] } | null {
  if (!launch) {
    return null;
  }
  const trimmed = command.trim();
  if (!trimmed.startsWith("sf ") || SHELL_SYNTAX.test(trimmed)) {
    return null;
  }
  const tokens = tokenizeCommand(trimmed);
  if (tokens.length < 2 || tokens[0] !== "sf") {
    return null;
  }
  return {
    file: launch.nodePath,
    args: ["--no-deprecation", launch.runJsPath, ...tokens.slice(1)],
  };
}

// Test hook
export function resetSfDirectLaunchForTests(): void {
  directLaunchPromise = null;
  resolvedDirectLaunch = null;
}
