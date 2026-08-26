/*
 * Environment flags that make every spawned `sf` command start faster.
 *
 * Each `sf` invocation pays 2.5 to 4 seconds of startup (node boot, oclif
 * plugin manifests, command module import). Part of it is avoidable: the log
 * file flush, the "new version available" check and the autoupdate probe.
 * The same flags are applied by sfdx-hardis to its own sub-commands
 * (SFDX_HARDIS_ENHANCE_PERFORMANCE, default on).
 *
 * Telemetry is deliberately left untouched: Salesforce should keep seeing that
 * sfdx-hardis is used, and the telemetry sender is a detached child process
 * the parent never waits for.
 *
 * Rules:
 * - A value already present in the environment (user-defined) is never overridden.
 * - When the "disablePerformanceEnhancementsForSfCommands" setting is on, no
 *   SF_* flag is added, and `sf hardis` commands receive
 *   SFDX_HARDIS_ENHANCE_PERFORMANCE=false so sfdx-hardis stops enhancing its
 *   own sub-commands too.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";

export const SF_PERFORMANCE_ENV_FLAGS: Record<string, string> = {
  SF_DISABLE_LOG_FILE: "true",
  SF_SKIP_NEW_VERSION_CHECK: "true",
  SF_DISABLE_AUTOUPDATE: "true",
};

export const SFDX_HARDIS_ENHANCE_PERFORMANCE_VAR =
  "SFDX_HARDIS_ENHANCE_PERFORMANCE";

export const DISABLE_SF_PERFORMANCE_SETTING =
  "disablePerformanceEnhancementsForSfCommands";

// Node's on-disk compile cache (Node 22.1+, ignored by older versions): the
// compiled bytecode of the CLI modules is reused from one command to the next,
// which removes about a third of the CLI startup time. Set at activation.
export const NODE_COMPILE_CACHE_VAR = "NODE_COMPILE_CACHE";
let nodeCompileCacheDir: string | null = null;

export function setNodeCompileCacheDir(dir: string | null): void {
  nodeCompileCacheDir = dir;
}

export function getNodeCompileCacheDir(): string | null {
  return nodeCompileCacheDir;
}

// When sfdx-hardis is a LINKED plugin (sf plugins link, the contributor
// setup), oclif auto-transpiles it from its TypeScript sources at every
// command: several seconds per run, during which the CLI event loop is too
// busy to even process the extension's WebSocket answers. The preload script
// below (shipped in resources/) sets oclif's enableAutoTranspile flag to
// false so the plugin runs from its compiled lib folder, like an installed
// plugin. Set at activation; injected through NODE_OPTIONS --import.
export const LINKED_SFDX_HARDIS_AUTO_TRANSPILE_SETTING =
  "linkedSfdxHardisAutoTranspile";
let linkedPluginPreloadScript: string | null = null;
// Cache keyed on the mtime of the sf CLI plugin registry, so linking or
// unlinking sfdx-hardis is picked up without re-reading the file every spawn
let linkedDetectionCache: {
  registryMtimeMs: number;
  preloadArg: string | null;
} | null = null;

export function setLinkedPluginPreloadScript(scriptPath: string | null): void {
  linkedPluginPreloadScript = scriptPath;
  linkedDetectionCache = null;
}

function getSfCliDataDir(): string {
  if (process.env.SF_DATA_DIR) {
    return process.env.SF_DATA_DIR;
  }
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "sf",
    );
  }
  return path.join(
    process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "sf",
  );
}

function isLinkedAutoTranspileWanted(): boolean {
  try {
    return (
      vscode.workspace
        .getConfiguration("vsCodeSfdxHardis")
        .get<boolean>(LINKED_SFDX_HARDIS_AUTO_TRANSPILE_SETTING, false) === true
    );
  } catch {
    return false;
  }
}

/**
 * The NODE_OPTIONS fragment that makes a linked sfdx-hardis run from its
 * compiled lib folder, or null when sfdx-hardis is not linked, its lib folder
 * is not built, or the linkedSfdxHardisAutoTranspile setting asks for the
 * oclif default (live TypeScript).
 */
export function getLinkedSfdxHardisPreloadArg(
  autoTranspileWanted: boolean = isLinkedAutoTranspileWanted(),
): string | null {
  if (!linkedPluginPreloadScript || autoTranspileWanted) {
    return null;
  }
  try {
    const registryPath = path.join(getSfCliDataDir(), "package.json");
    const registryMtimeMs = fs.statSync(registryPath).mtimeMs;
    if (
      linkedDetectionCache &&
      linkedDetectionCache.registryMtimeMs === registryMtimeMs
    ) {
      return linkedDetectionCache.preloadArg;
    }
    let preloadArg: string | null = null;
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const linked = (registry?.oclif?.plugins ?? []).find(
      (plugin: any) =>
        plugin?.name === "sfdx-hardis" &&
        plugin?.type === "link" &&
        plugin?.root,
    );
    // Only when the compiled sources are present: without lib, oclif could
    // load nothing at all and the plugin hooks would silently fail
    if (
      linked &&
      fs.existsSync(
        path.join(linked.root, "lib", "hooks", "init", "start-ws-client.js"),
      )
    ) {
      preloadArg = `--import ${pathToFileURL(linkedPluginPreloadScript).href}`;
    }
    linkedDetectionCache = { registryMtimeMs, preloadArg };
    return preloadArg;
  } catch {
    return null;
  }
}

export function isSfPerformanceEnhancementDisabled(): boolean {
  try {
    return (
      vscode.workspace
        .getConfiguration("vsCodeSfdxHardis")
        .get<boolean>(DISABLE_SF_PERFORMANCE_SETTING, false) === true
    );
  } catch {
    return false;
  }
}

export function isSfHardisCommand(command: string | undefined): boolean {
  return /^\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*sf\s+hardis\b/i.test(command ?? "");
}

/**
 * Mutates a per-call env copy (never process.env itself) with the performance
 * flags, honoring the setting and user-defined values.
 *
 * @param env A copy of the environment given to the child process
 * @param command The command about to run; omit when the env is shared by
 *   several commands (a terminal), in which case both kinds of flags are set
 * @param disabled Value of the setting (injected for unit tests)
 */
export function applySfPerformanceEnv(
  env: Record<string, string | undefined>,
  command?: string,
  disabled: boolean = isSfPerformanceEnhancementDisabled(),
  linkedPreloadArg: string | null = getLinkedSfdxHardisPreloadArg(),
): Record<string, string | undefined> {
  if (disabled) {
    if (
      (command === undefined || isSfHardisCommand(command)) &&
      env[SFDX_HARDIS_ENHANCE_PERFORMANCE_VAR] === undefined
    ) {
      env[SFDX_HARDIS_ENHANCE_PERFORMANCE_VAR] = "false";
    }
    return env;
  }
  for (const [key, value] of Object.entries(SF_PERFORMANCE_ENV_FLAGS)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
  if (nodeCompileCacheDir && env[NODE_COMPILE_CACHE_VAR] === undefined) {
    env[NODE_COMPILE_CACHE_VAR] = nodeCompileCacheDir;
  }
  // NODE_OPTIONS is APPENDED to (not replaced): under an Extension
  // Development Host the debugger already injects its bootloader there, and
  // both must coexist
  if (linkedPreloadArg && !(env.NODE_OPTIONS ?? "").includes(linkedPreloadArg)) {
    env.NODE_OPTIONS = env.NODE_OPTIONS
      ? `${env.NODE_OPTIONS} ${linkedPreloadArg}`
      : linkedPreloadArg;
  }
  return env;
}

/**
 * The variables to add to a terminal created by the extension: only the flags
 * this extension decides, never a value the user already has in the environment
 * (VS Code overlays this object on the inherited terminal environment).
 */
export function getSfPerformanceTerminalEnv(
  baseEnv: Record<string, string | undefined> = process.env,
  disabled: boolean = isSfPerformanceEnhancementDisabled(),
  linkedPreloadArg: string | null = getLinkedSfdxHardisPreloadArg(),
): Record<string, string> {
  const env = applySfPerformanceEnv(
    { ...baseEnv },
    undefined,
    disabled,
    linkedPreloadArg,
  );
  const terminalEnv: Record<string, string> = {};
  for (const key of [
    ...Object.keys(SF_PERFORMANCE_ENV_FLAGS),
    NODE_COMPILE_CACHE_VAR,
    SFDX_HARDIS_ENHANCE_PERFORMANCE_VAR,
  ]) {
    const value = env[key];
    if (value !== undefined && baseEnv[key] === undefined) {
      terminalEnv[key] = value;
    }
  }
  // NODE_OPTIONS may pre-exist (debugger bootloader): the terminal overlay
  // replaces variables, so hand it the merged value instead of skipping it
  if (env.NODE_OPTIONS !== undefined && env.NODE_OPTIONS !== baseEnv.NODE_OPTIONS) {
    terminalEnv.NODE_OPTIONS = env.NODE_OPTIONS;
  }
  return terminalEnv;
}
