import axios from "axios";
import c from "chalk";
import * as childProcess from "child_process";
import * as fs from "fs-extra";
import * as path from "path";
import simpleGit from "simple-git";

import { Worker } from "worker_threads";
import * as vscode from "vscode";
import { Logger } from "./logger";
import { CacheManager, CacheSection } from "./utils/cache-manager";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";
import { RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION } from "./constants";
import { resetSfdxHardisConfigCache } from "./utils/sfdx-hardis-config-utils";

// Returns true if the extension is running as a pre-release version (preview: true in package.json)
export function isExtensionPreRelease(): boolean {
  const ext = vscode.extensions.getExtension(
    "NicolasVuillamy.vscode-sfdx-hardis",
  );
  return ext?.packageJSON?.preview === true;
}

// Returns the npm install tag to use for sfdx-hardis plugin
export function getSfdxHardisInstallTag(): string {
  if (isExtensionPreRelease()) {
    return "alpha";
  }
  if (RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION === "beta") {
    return "beta";
  }
  return "latest";
}

// Interface for execCommand and execSfdxJson options
export interface ExecCommandOptions {
  fail?: boolean;
  output?: boolean;
  debug?: boolean;
  spinner?: boolean;
  cwd?: string;
  cacheExpiration?: number;
  cacheSection?: CacheSection;
  // When true, the command is treated as low priority by the concurrency
  // limiter (runs after / yields slots to interactive panel-feature commands).
  // When omitted, it is auto-detected from the command (version / plugins
  // checks are low priority). Pass false to force normal priority.
  lowPriority?: boolean;
}

let MULTITHREAD_ACTIVE: boolean | null = null;
let CACHE_IS_PRELOADED: boolean = false;
let COMMANDS_RESULTS: Record<string, any> = {};
let GIT_MENUS: any[] | null = null;

// Dedup in-flight background npm version refreshes
const NPM_REFRESH_IN_FLIGHT: Map<string, Promise<void>> = new Map();

// ── Fix #4: concurrency limiter for execShell ─────────────────────────────
// On Windows, each `sf` spawn is CPU-heavy at boot time. Without a limit, a
// burst of 8-10 concurrent spawns (sf --version, sf plugins, plugin commands…)
// saturates the CPU and piles synchronous JSON.parse work on the main thread,
// stalling the extension host for seconds. Capping at 4 concurrent processes
// keeps the extension responsive while still overlapping I/O.
//
// No-deadlock guarantee: the only callers of execShell are execCommand (called
// by execSfdxJson / execCommandWithProgress) and getPythonCommand. Neither
// awaits another execShell call while holding a slot — the call chain is
// strictly linear (execSfdxJson → execCommand → execShell, one level deep).
// Two-tier priority: panel-feature commands (high priority) may use all
// MAX_CONCURRENT_SHELL slots; background/status commands (sf --version, sf
// plugins, plugin discovery…) are low priority and capped at
// MAX_CONCURRENT_LOW_PRIORITY so they never occupy every slot. This keeps
// headroom for interactive commands, which are also served first from the queue.
const MAX_CONCURRENT_SHELL = 4;
const MAX_CONCURRENT_LOW_PRIORITY = 2;
let runningShellCount = 0;
let runningLowPriorityCount = 0;
const highPriorityShellQueue: Array<() => void> = [];
const lowPriorityShellQueue: Array<() => void> = [];

function acquireShellSlot(lowPriority: boolean): Promise<void> {
  if (lowPriority) {
    if (
      runningShellCount < MAX_CONCURRENT_SHELL &&
      runningLowPriorityCount < MAX_CONCURRENT_LOW_PRIORITY
    ) {
      runningShellCount++;
      runningLowPriorityCount++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      lowPriorityShellQueue.push(resolve);
    });
  }
  if (runningShellCount < MAX_CONCURRENT_SHELL) {
    runningShellCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    highPriorityShellQueue.push(resolve);
  });
}

function releaseShellSlot(lowPriority: boolean): void {
  runningShellCount--;
  if (lowPriority) {
    runningLowPriorityCount--;
  }
  pumpShellQueues();
}

// After a slot frees, admit waiters — high priority first, then low priority
// (respecting its sub-cap). Admitted waiters are counted before resolving so
// the freed capacity is reserved for them.
function pumpShellQueues(): void {
  while (
    highPriorityShellQueue.length > 0 &&
    runningShellCount < MAX_CONCURRENT_SHELL
  ) {
    runningShellCount++;
    highPriorityShellQueue.shift()!();
  }
  while (
    lowPriorityShellQueue.length > 0 &&
    runningShellCount < MAX_CONCURRENT_SHELL &&
    runningLowPriorityCount < MAX_CONCURRENT_LOW_PRIORITY
  ) {
    runningShellCount++;
    runningLowPriorityCount++;
    lowPriorityShellQueue.shift()!();
  }
}

// Heuristic: status/dependency "infrastructure" commands are low priority vs
// panel-feature commands. Matches exact version checks, `sf plugins`, and
// per-plugin `:hardis-commands` discovery — the calls that flood on panel load.
function isLowPriorityCommand(command: string): boolean {
  const c = command.trim();
  return (
    /^(node|git|npm|yarn|sf|sfdx) --version$/.test(c) ||
    /^sf plugins( --json)?$/.test(c) ||
    /:hardis-commands\b/.test(c)
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Fix #2: memoize getGitParentBranch ───────────────────────────────────────
// git show-branch -a is heavy on large repos. Cache the result keyed by the
// current HEAD rev so a hard refresh (resetCache) forces recomputation.
let cachedParentBranch: string | null = null;
let cachedParentBranchRev: string | null = null;
// ─────────────────────────────────────────────────────────────────────────────

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

export async function execShell(
  cmd: string,
  execOptions: any,
  lowPriority = false,
) {
  // Acquire a concurrency slot before spawning. Released in the finally block
  // so it is freed on success, synchronous throw, worker reject, and
  // childProcess.exec error alike.
  const shellWaitT0 = Date.now();
  await acquireShellSlot(lowPriority);
  const shellWaited = Date.now() - shellWaitT0;
  const shellExecT0 = Date.now();
  try {
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
          rejectPendingSharedWorkerCallbacks(
            new Error("Shared worker exited unexpectedly"),
          );
          sharedWorker = null;
        });
        sharedWorker.on("error", (error) => {
          rejectPendingSharedWorkerCallbacks(error);
          sharedWorker = null;
        });
      }
      return await new Promise<any>((resolve, reject) => {
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
      return await new Promise<any>((resolve, reject) => {
        childProcess.exec(cmd, execOptions, (error, stdout, stderr) => {
          if (error) {
            return reject({ error: error, stdout: stdout, stderr: stderr });
          }
          return resolve({ stdout: stdout, stderr: stderr });
        });
      });
    }
  } finally {
    releaseShellSlot(lowPriority);
    Logger.logPerf(
      `[shell-perf] ${lowPriority ? "LOW " : "HIGH"} wait=${shellWaited}ms exec=${Date.now() - shellExecT0}ms :: ${cmd.slice(0, 140)}`,
    );
  }
}

function rejectPendingSharedWorkerCallbacks(reason: unknown) {
  const callbacks = Array.from(sharedWorkerCallbacks.values());
  sharedWorkerCallbacks.clear();
  for (const cb of callbacks) {
    cb.reject({
      error: reason,
      stdout: "",
      stderr: "Worker thread exited unexpectedly",
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
  const oneDayInMs = 1000 * 60 * 60 * 24;

  // LOCAL tier: CLI tools that must finish before we declare the cache ready
  const localTierPromises = [];
  const cliCommands = [
    ["node --version", oneDayInMs * 30], // 30 days
    ["git --version", oneDayInMs * 30], // 30 days
    ["sf --version", oneDayInMs], // 1 day
    ["sf plugins", oneDayInMs], // 1 day
  ];
  for (const cmd of cliCommands) {
    localTierPromises.push(
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
    localTierPromises.push(
      execSfdxJson(String(cmd[0]), {
        cacheExpiration: Number(cmd[1]),
        cacheSection: "project",
      }),
    );
  }

  const markCachePreloaded = () => {
    if (CACHE_IS_PRELOADED) {
      return;
    }
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
  };

  // Safety net: if any local-tier promise hangs (slow CLI…),
  // force-unblock the panels after 30 s so spinners never run forever.
  const preloadTimeoutId = setTimeout(() => {
    Logger.log(
      "[vscode-sfdx-hardis] Cache preload timed out after 30 s – forcing refresh",
    );
    markCachePreloaded();
  }, 30000);

  Promise.allSettled(localTierPromises).then(() => {
    clearTimeout(preloadTimeoutId);
    markCachePreloaded();
  });

  // BACKGROUND tier: npm version lookups — fire-and-forget, do NOT block the gate
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
    getNpmLatestVersion(npmPackage);
  }
}

export async function getNpmLatestVersion(
  packageName: string,
): Promise<string | null> {
  const NPM_STALE_KEY = `npmLatest:${packageName}`;
  const NPM_FRESH_KEY = `npmLatestFresh:${packageName}`;
  const ONE_DAY_MS = 1000 * 60 * 60 * 24;
  const SEVEN_DAYS_MS = ONE_DAY_MS * 7;

  // Return whatever stale value we have immediately (stale-while-revalidate)
  const staleValue = CacheManager.get<string>("app", NPM_STALE_KEY);
  const isFresh = CacheManager.get<boolean>("app", NPM_FRESH_KEY);

  if (staleValue !== undefined) {
    // If the value is stale (fresh marker expired), kick off a background refresh
    if (!isFresh) {
      triggerNpmBackgroundRefresh(
        packageName,
        NPM_STALE_KEY,
        NPM_FRESH_KEY,
        ONE_DAY_MS,
        SEVEN_DAYS_MS,
        staleValue,
      );
    }
    return staleValue;
  }

  // Nothing cached at all — try one background fetch but return null immediately
  triggerNpmBackgroundRefresh(
    packageName,
    NPM_STALE_KEY,
    NPM_FRESH_KEY,
    ONE_DAY_MS,
    SEVEN_DAYS_MS,
    null,
  );
  return null;
}

function triggerNpmBackgroundRefresh(
  packageName: string,
  staleKey: string,
  freshKey: string,
  oneDayMs: number,
  sevenDaysMs: number,
  previousValue: string | null,
): void {
  // Dedup: only one in-flight refresh per package at a time
  if (NPM_REFRESH_IN_FLIGHT.has(packageName)) {
    return;
  }
  const refreshPromise = (async () => {
    try {
      const versionRes = await axios.get(
        "https://registry.npmjs.org/" + packageName + "/latest",
        { timeout: 4000 },
      );
      const version: string = versionRes.data.version;
      await CacheManager.set("app", staleKey, version, sevenDaysMs);
      await CacheManager.set("app", freshKey, true, oneDayMs);
      // If value changed, trigger a targeted panel refresh so users see updated decoration
      if (version !== previousValue) {
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshPluginsView",
          true,
        );
      }
    } catch {
      // Network failure or timeout — leave stale value in cache, no-op
    } finally {
      NPM_REFRESH_IN_FLIGHT.delete(packageName);
    }
  })();
  NPM_REFRESH_IN_FLIGHT.set(packageName, refreshPromise);
}

export async function resetCache() {
  await CacheManager.delete("app");
  await CacheManager.delete("project");
  COMMANDS_RESULTS = {};
  GIT_MENUS = null;
  cachedWorkspaceRoot = null;
  // Clear the getGitParentBranch memo so a hard refresh recomputes it
  cachedParentBranch = null;
  cachedParentBranchRev = null;
  resetSfdxHardisConfigCache();
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
  let commandResult: any;
  // Build a per-call env copy; set FORCE_COLOR=0 here so the child process
  // never emits ANSI codes without mutating the global process.env.
  const execOptions: any = {
    maxBuffer: 10000 * 10000,
    cwd: options.cwd || vscode.workspace.rootPath,
    env: { ...process.env, FORCE_COLOR: "0" },
  };
  const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  const langSetting = config.get<string>("lang", "auto");
  if (langSetting && langSetting !== "auto") {
    execOptions.env.SFDX_HARDIS_LANG = langSetting;
  }
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
      return cached;
    }
  }
  try {
    if (COMMANDS_RESULTS[command]) {
      // use in-flight or completed result
      Logger.log(
        `[vscode-sfdx-hardis][command] Waiting for promise already started for command ${command}`,
      );
      commandResult =
        COMMANDS_RESULTS[command].result ??
        (await COMMANDS_RESULTS[command].promise);
    } else {
      // no in-flight entry — store the unresolved promise first so concurrent
      // callers hit the dedup branch above instead of spawning a second process
      Logger.log("[vscode-sfdx-hardis][command] " + command);
      console.time(command);
      const lowPriority = options.lowPriority ?? isLowPriorityCommand(command);
      const commandResultPromise = execShell(command, execOptions, lowPriority);
      COMMANDS_RESULTS[command] = { promise: commandResultPromise };
      try {
        commandResult = await commandResultPromise;
      } catch (spawnError) {
        // Remove the poisoned promise so the next caller retries cleanly
        delete COMMANDS_RESULTS[command];
        throw spawnError;
      }
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

let cachedWorkspaceRoot: string | null = null;
export function getWorkspaceRoot() {
  if (cachedWorkspaceRoot !== null) {
    return cachedWorkspaceRoot;
  }
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
  cachedWorkspaceRoot = currentWorkspaceFolderUri;
  return cachedWorkspaceRoot;
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
  options: { lowPriority?: boolean } = {},
): Promise<string | null> {
  // Normalize: strip any surrounding quotes a caller may pass, so the cache key
  // and command string stay consistent with getOrgItems / setOrgCache (and never
  // produce a malformed `--target-org ""x""`).
  const cleanUsername = String(username).replace(/^["']+|["']+$/g, "");
  const cacheValue = CacheManager.get(
    "orgs",
    `username-instanceUrl:${cleanUsername}`,
  );
  if (cacheValue) {
    return cacheValue as string;
  }
  // request org. Identical command string to getOrgItems lets the in-flight
  // dedup + "orgs" cache collapse them into a single `sf org display` call.
  const orgInfoResult = await execSfdxJson(
    `sf org display --target-org "${cleanUsername}"`,
    {
      fail: false,
      output: false,
      cacheExpiration: 1000 * 60 * 60 * 24, // 1 day (milliseconds)
      cacheSection: "orgs",
      // Callers doing background work (e.g. org-color detection) pass true so
      // this never blocks an interactive panel command.
      lowPriority: options.lowPriority ?? false,
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

export async function getGitParentBranch() {
  try {
    // Resolve current HEAD rev first so we can skip the expensive show-branch
    // call when the branch has not changed since the last invocation.
    const rev = await simpleGit({ trimmed: true }).raw(
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    );
    if (rev === cachedParentBranchRev && cachedParentBranch !== null) {
      return cachedParentBranch;
    }
    const outputFromGit = (
      await simpleGit({ trimmed: true }).raw("show-branch", "-a")
    ).split("\n");
    const allLinesNormalized = outputFromGit.map((line) =>
      line.trim().replace(/\].*/, ""),
    );
    const indexOfCurrentBranch = allLinesNormalized.indexOf(`* [${rev}`);
    if (indexOfCurrentBranch > -1) {
      const parentBranch = allLinesNormalized[indexOfCurrentBranch + 1].replace(
        /^.*\[/,
        "",
      );
      cachedParentBranchRev = rev;
      cachedParentBranch = parentBranch;
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
      const result = await execShell(
        `${candidate} --version`,
        {
          maxBuffer: 10000 * 10000,
        },
        true, // background probe — low priority
      );
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
  // Normalize to platform-specific separators: Windows Explorer only accepts
  // backslashes and silently falls back to the Documents folder otherwise.
  const normalizedPath = path.normalize(folderPath);
  if (platform === "win32") {
    childProcess.exec(`explorer "${normalizedPath}"`);
  } else if (platform === "darwin") {
    childProcess.exec(`open "${normalizedPath}"`);
  } else if (platform === "linux") {
    childProcess.exec(`xdg-open "${normalizedPath}"`);
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
