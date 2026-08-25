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

export const SF_PERFORMANCE_ENV_FLAGS: Record<string, string> = {
  SF_DISABLE_LOG_FILE: "true",
  SF_SKIP_NEW_VERSION_CHECK: "true",
  SF_DISABLE_AUTOUPDATE: "true",
};

export const SFDX_HARDIS_ENHANCE_PERFORMANCE_VAR =
  "SFDX_HARDIS_ENHANCE_PERFORMANCE";

export const DISABLE_SF_PERFORMANCE_SETTING =
  "disablePerformanceEnhancementsForSfCommands";

// Env keys this extension set on its own process.env (see sfCoreInProcess.ts):
// they must not leak to child processes when the user disabled enhancements.
const OWNED_PROCESS_ENV_KEYS = new Set<string>();

export function markProcessEnvKeyOwned(key: string): void {
  OWNED_PROCESS_ENV_KEYS.add(key);
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
): Record<string, string | undefined> {
  if (disabled) {
    for (const key of Object.keys(SF_PERFORMANCE_ENV_FLAGS)) {
      if (OWNED_PROCESS_ENV_KEYS.has(key)) {
        delete env[key];
      }
    }
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
): Record<string, string> {
  const env = applySfPerformanceEnv({ ...baseEnv }, undefined, disabled);
  const terminalEnv: Record<string, string> = {};
  for (const key of [
    ...Object.keys(SF_PERFORMANCE_ENV_FLAGS),
    SFDX_HARDIS_ENHANCE_PERFORMANCE_VAR,
  ]) {
    const value = env[key];
    if (value !== undefined && baseEnv[key] === undefined) {
      terminalEnv[key] = value;
    }
  }
  return terminalEnv;
}
