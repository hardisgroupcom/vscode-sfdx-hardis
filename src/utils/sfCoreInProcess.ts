/*
 * In-process replacements for a few read-mostly `sf` commands.
 *
 * Spawning the Salesforce CLI costs 2.5 to 4 seconds per call, almost all of it
 * startup. `sf org display` and `sf config get` only read local auth/config
 * files (plus one auth refresh), which `@salesforce/core` does in a few
 * milliseconds inside the extension host.
 *
 * `@salesforce/core` is NOT a dependency of this extension: it is loaded at
 * runtime from the user's own Salesforce CLI installation, so the bundle stays
 * small and the core version is always the one the installed `sf` uses.
 *
 * Safety rules:
 * - The JSON returned mirrors the `--json` output of the real command, so
 *   call sites are unchanged.
 * - Anything not recognized (extra flags, scratch orgs, unknown keys, core not
 *   found, any exception) returns null and the caller spawns the real `sf`.
 * - Disabled by the "disablePerformanceEnhancementsForSfCommands" setting.
 */
import * as fs from "fs";
import type { createRequire } from "module";
import * as path from "path";
import { Logger } from "../logger";
import { findExecutable } from "./executableUtils";
import {
  isSfPerformanceEnhancementDisabled,
  markProcessEnvKeyOwned,
} from "./sfPerformanceUtils";

const REDACTED_ACCESS_TOKEN =
  "[REDACTED] Use 'sf org auth show-access-token' to view";
const REDACTED_PASSWORD =
  "[REDACTED] Use 'sf org auth show-user-password' to view";

export type ParsedSfCommand =
  | { kind: "org-display"; targetOrg: string | null }
  | { kind: "config-get"; keys: string[] };

// Split a command line on spaces, honoring simple single or double quotes.
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let inToken = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
    } else {
      current += char;
      inToken = true;
    }
  }
  if (inToken) {
    tokens.push(current);
  }
  return tokens;
}

// Recognize the exact command shapes handled in-process. Any other shape returns null.
export function parseSfCommand(command: string): ParsedSfCommand | null {
  const tokens = tokenizeCommand(command.trim());
  if (tokens.length < 3 || tokens[0] !== "sf") {
    return null;
  }
  const topic = tokens[1];
  const action = tokens[2];
  const rest = tokens.slice(3).filter((token) => token !== "--json");

  if (topic === "org" && action === "display") {
    let targetOrg: string | null = null;
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if (
        (token === "--target-org" || token === "-o") &&
        i + 1 < rest.length &&
        !rest[i + 1].startsWith("-")
      ) {
        targetOrg = rest[i + 1];
        i++;
      } else if (token.startsWith("--target-org=")) {
        targetOrg = token.substring("--target-org=".length);
      } else {
        // --verbose, --api-version, or anything else: let the real CLI handle it
        return null;
      }
    }
    return { kind: "org-display", targetOrg };
  }

  if (topic === "config" && action === "get") {
    if (
      rest.length === 0 ||
      rest.some((token) => token.startsWith("-") && token !== "--verbose")
    ) {
      return null;
    }
    return {
      kind: "config-get",
      keys: rest.filter((token) => token !== "--verbose"),
    };
  }

  return null;
}

/**
 * Finds the `@salesforce/core` package shipped inside the installed Salesforce
 * CLI, starting from the resolved `sf` executable and walking up its parent
 * folders. Handles the npm global install (`<prefix>/node_modules/@salesforce/cli`,
 * hoisted or nested core) and the standalone installers (`<root>/bin/sf` +
 * `<root>/node_modules`). Returns null when nothing is found.
 */
export function findSalesforceCoreDir(sfExecutablePath: string): string | null {
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
      path.join(dir, "node_modules", "@salesforce", "core"),
      path.join(
        dir,
        "node_modules",
        "@salesforce",
        "cli",
        "node_modules",
        "@salesforce",
        "core",
      ),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "package.json"))) {
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

let salesforceCorePromise: Promise<any | null> | null = null;

// Loads @salesforce/core from the installed sf CLI once. Resolves to null when
// it can not be found or loaded: callers then spawn the real CLI.
export function loadSalesforceCore(): Promise<any | null> {
  if (salesforceCorePromise) {
    return salesforceCorePromise;
  }
  salesforceCorePromise = (async () => {
    try {
      const sfPath = await findExecutable("sf");
      if (!sfPath) {
        Logger.log(
          "[sfdx-hardis][in-process] sf executable not found in PATH, using the CLI for every command",
        );
        return null;
      }
      const coreDir = findSalesforceCoreDir(sfPath);
      if (!coreDir) {
        Logger.log(
          `[sfdx-hardis][in-process] @salesforce/core not found near ${sfPath}, using the CLI for every command`,
        );
        return null;
      }
      // core lazily opens a pino log file (through a worker thread) in ~/.sf on
      // its first logger use: not wanted inside the extension host. Only set
      // when the user did not decide otherwise.
      if (process.env.SF_DISABLE_LOG_FILE === undefined) {
        process.env.SF_DISABLE_LOG_FILE = "true";
        markProcessEnvKeyOwned("SF_DISABLE_LOG_FILE");
      }
      // A real Node require anchored in the CLI install, so core's own
      // dependencies resolve from there. webpack statically rewrites both
      // `require(expr)` and `createRequire(expr)` (the latter to `undefined`):
      // the computed property name keeps this out of its reach.
      const nodeModule: any = require("module");
      const makeRequire: typeof createRequire =
        nodeModule["create" + "Require"];
      const nodeRequire = makeRequire(path.join(coreDir, "package.json"));
      const core = nodeRequire(coreDir);
      const version = JSON.parse(
        fs.readFileSync(path.join(coreDir, "package.json"), "utf8"),
      ).version;
      Logger.log(
        `[sfdx-hardis][in-process] Loaded @salesforce/core ${version} from ${coreDir}`,
      );
      return core;
    } catch (e: any) {
      Logger.log(
        `[sfdx-hardis][in-process] Unable to load @salesforce/core, using the CLI for every command: ${e?.message}`,
      );
      return null;
    }
  })();
  return salesforceCorePromise;
}

// Test hook: forget the loaded module so the next call resolves again
export function resetSalesforceCoreForTests(): void {
  salesforceCorePromise = null;
}

/**
 * Tries to run an `sf ... --json` command in-process. Returns the parsed JSON
 * payload the CLI would have printed, or null when the real CLI must run
 * (unsupported shape, setting disabled, core unavailable, any failure).
 */
export async function tryRunSfCommandInProcess(
  command: string,
  cwd: string | undefined,
): Promise<any | null> {
  if (!command.includes("--json") || isSfPerformanceEnhancementDisabled()) {
    return null;
  }
  const parsed = parseSfCommand(command);
  if (parsed === null) {
    return null;
  }
  const core = await loadSalesforceCore();
  if (!core) {
    return null;
  }
  const t0 = Date.now();
  try {
    let result: any = null;
    if (parsed.kind === "org-display") {
      result = await orgDisplayInProcess(core, parsed.targetOrg, cwd);
    } else if (parsed.kind === "config-get") {
      result = await configGetInProcess(core, parsed.keys, cwd);
    }
    if (result === null) {
      return null;
    }
    Logger.log(
      `[sfdx-hardis][in-process] ${command} (${Date.now() - t0}ms, no CLI spawn)`,
    );
    return { status: 0, result: result, warnings: [] };
  } catch (e: any) {
    // Any failure: fall back to the real CLI so behavior and error messages stay unchanged
    Logger.log(
      `[sfdx-hardis][in-process] "${command}" failed after ${Date.now() - t0}ms, falling back to the CLI: ${e?.message}`,
    );
    return null;
  }
}

async function createConfigAggregator(core: any, cwd: string | undefined) {
  // Never rely on process.cwd(): the extension host does not run in the project
  const aggregator = await core.ConfigAggregator.create(
    cwd ? { projectPath: cwd } : undefined,
  );
  await aggregator.reload();
  return aggregator;
}

// Mirrors @salesforce/plugin-org `org display` for non-scratch orgs
async function orgDisplayInProcess(
  core: any,
  targetOrg: string | null,
  cwd: string | undefined,
): Promise<any | null> {
  let aliasOrUsername = targetOrg;
  if (!aliasOrUsername) {
    const aggregator = await createConfigAggregator(core, cwd);
    aliasOrUsername =
      (aggregator.getPropertyValue(
        core.OrgConfigProperties.TARGET_ORG,
      ) as string) || null;
    if (!aliasOrUsername) {
      return null;
    }
  }
  // The extension host lives for hours: drop the cached aliases/auth files so
  // an org authenticated or renamed in a terminal since then is seen.
  core.StateAggregator.clearInstance();
  const org = await core.Org.create({ aliasOrUsername });
  const authInfo = await core.AuthInfo.create({ username: org.getUsername() });
  const fields: any = authInfo.getFields(true);
  if (fields.devHubUsername) {
    // Scratch org: `org display` queries the Dev Hub for status and expiration date, keep the real CLI for that
    return null;
  }
  let connectedStatus: string;
  try {
    await org.refreshAuth();
    connectedStatus = "Connected";
  } catch (err: any) {
    const message: string = err?.message || "";
    if (message.includes("maintenance")) {
      connectedStatus = "Down (Maintenance)";
    } else if (message.includes("<html>") || message.includes("<!DOCTYPE HTML>")) {
      connectedStatus = "Bad Response";
    } else {
      connectedStatus = err?.code ?? message;
    }
  }
  const showSecrets = process.env.SF_TEMP_SHOW_SECRETS === "true";
  const stateAggregator = await core.StateAggregator.getInstance();
  const aliases: string[] = stateAggregator.aliases.getAll(fields.username);
  const alias = aliases?.length ? aliases[aliases.length - 1] : undefined;
  return {
    id: fields.orgId,
    devHubId: undefined,
    apiVersion: fields.instanceApiVersion,
    accessToken: showSecrets ? fields.accessToken : REDACTED_ACCESS_TOKEN,
    instanceUrl: fields.instanceUrl,
    username: fields.username,
    clientId: fields.clientId,
    password: fields.password
      ? showSecrets
        ? fields.password
        : REDACTED_PASSWORD
      : undefined,
    connectedStatus: connectedStatus,
    sfdxAuthUrl: undefined,
    alias: alias,
    clientApps: fields.clientApps
      ? Object.keys(fields.clientApps).join(",")
      : undefined,
  };
}

// Mirrors @salesforce/plugin-settings `config get`
async function configGetInProcess(
  core: any,
  keys: string[],
  cwd: string | undefined,
): Promise<any[] | null> {
  const aggregator = await createConfigAggregator(core, cwd);
  const responses: any[] = [];
  for (const key of keys) {
    // Throws on unknown key: caller falls back to the real CLI which produces the usual error
    const info = aggregator.getInfo(key);
    if (
      info.value !== undefined &&
      info.value !== null &&
      typeof info.value === "object"
    ) {
      return null;
    }
    responses.push({
      name: info.key,
      key: info.key,
      value: info.value,
      path: info.path,
      success: true,
      location: info.location,
    });
  }
  return responses;
}
