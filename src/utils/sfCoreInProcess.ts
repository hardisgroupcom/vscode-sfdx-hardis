/*
 * In-process replacements for a few `sf` commands.
 *
 * Spawning the Salesforce CLI costs 2.5 to 4 seconds per call, almost all of it
 * startup. The commands handled here only read local auth/config files or do a
 * single API call, which `@salesforce/core` / jsforce do in a few milliseconds
 * (plus the network round trip) inside the extension host.
 *
 * `@salesforce/core` is NOT a dependency of this extension: it is loaded at
 * runtime from the user's own Salesforce CLI installation, so the bundle stays
 * small and the core version is always the one the installed `sf` uses.
 *
 * Handled: `sf org display`, `sf config get`, `sf org list`,
 * `sf org list metadata`, `sf data query` (all with `--json`).
 *
 * Safety rules:
 * - The JSON returned mirrors the `--json` output of the real command, so
 *   call sites are unchanged.
 * - Anything not recognized (extra flags, scratch org display, unknown keys,
 *   core not found, any exception) returns null and the caller spawns the
 *   real `sf`.
 * - Disabled by the "disablePerformanceEnhancementsForSfCommands" setting.
 */
import * as fs from "fs";
import type { createRequire } from "module";
import * as path from "path";
import { Logger } from "../logger";
import {
  findExecutable,
  findUpwardsFromExecutable,
} from "./executableUtils";
import {
  isSfPerformanceEnhancementDisabled,
  markProcessEnvKeyOwned,
} from "./sfPerformanceUtils";

const REDACTED_ACCESS_TOKEN =
  "[REDACTED] Use 'sf org auth show-access-token' to view";
const REDACTED_PASSWORD =
  "[REDACTED] Use 'sf org auth show-user-password' to view";
const DEFAULT_MAX_QUERY_LIMIT = 50_000;

// Same warning the CLI adds to the --json output of org display / org list
function secretsHiddenWarning(commandName: string): string {
  return (
    `Secrets are now hidden from '${commandName}' command output. Use the 'sf org auth' commands instead. ` +
    "As a temporary workaround, you can set SF_TEMP_SHOW_SECRETS=true to render these secrets. " +
    "This workaround will be removed in an upcoming release."
  );
}

export type ParsedSfCommand =
  | { kind: "org-display"; targetOrg: string | null }
  | { kind: "config-get"; keys: string[] }
  | { kind: "org-list"; all: boolean; skipConnectionStatus: boolean }
  | {
      kind: "list-metadata";
      metadataType: string;
      folder: string | null;
      targetOrg: string | null;
    }
  | {
      kind: "data-query";
      query: string;
      targetOrg: string | null;
      useToolingApi: boolean;
    };

// Split a command line on spaces, honoring single or double quotes and, inside
// double quotes, the backslash escapes `\"` and `\\` the extension produces.
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let inToken = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (
        quote === '"' &&
        char === "\\" &&
        i + 1 < command.length &&
        (command[i + 1] === '"' || command[i + 1] === "\\")
      ) {
        current += command[i + 1];
        i++;
      } else if (char === quote) {
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

// Reads `--flag value`, `--flag=value` or `-f value`. Returns the value and the
// number of tokens consumed, or null when the token is not this flag.
function readFlagValue(
  tokens: string[],
  index: number,
  longName: string,
  shortName?: string,
): { value: string; consumed: number } | null {
  const token = tokens[index];
  if (token === longName || (shortName && token === shortName)) {
    if (index + 1 < tokens.length && !tokens[index + 1].startsWith("-")) {
      return { value: tokens[index + 1], consumed: 2 };
    }
    return null;
  }
  if (token.startsWith(`${longName}=`)) {
    return { value: token.substring(longName.length + 1), consumed: 1 };
  }
  return null;
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
      const target = readFlagValue(rest, i, "--target-org", "-o");
      if (target) {
        targetOrg = target.value;
        i += target.consumed - 1;
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

  if (topic === "org" && action === "list") {
    if (rest[0] === "metadata") {
      let metadataType: string | null = null;
      let folder: string | null = null;
      let targetOrg: string | null = null;
      for (let i = 1; i < rest.length; i++) {
        const type = readFlagValue(rest, i, "--metadata-type", "-m");
        const folderFlag = readFlagValue(rest, i, "--folder");
        const target = readFlagValue(rest, i, "--target-org", "-o");
        const flag = type || folderFlag || target;
        if (!flag) {
          // --api-version, --output-file, or anything else: real CLI
          return null;
        }
        if (type) {
          metadataType = type.value;
        } else if (folderFlag) {
          folder = folderFlag.value;
        } else if (target) {
          targetOrg = target.value;
        }
        i += flag.consumed - 1;
      }
      if (!metadataType) {
        return null;
      }
      return { kind: "list-metadata", metadataType, folder, targetOrg };
    }
    let all = false;
    let skipConnectionStatus = false;
    for (const token of rest) {
      if (token === "--all") {
        all = true;
      } else if (token === "--skip-connection-status") {
        skipConnectionStatus = true;
      } else {
        // --clean, --verbose, metadata-types...: real CLI
        return null;
      }
    }
    return { kind: "org-list", all, skipConnectionStatus };
  }

  if (topic === "data" && action === "query") {
    let query: string | null = null;
    let targetOrg: string | null = null;
    let useToolingApi = false;
    for (let i = 0; i < rest.length; i++) {
      const queryFlag = readFlagValue(rest, i, "--query", "-q");
      const target = readFlagValue(rest, i, "--target-org", "-o");
      if (queryFlag) {
        query = queryFlag.value;
        i += queryFlag.consumed - 1;
      } else if (target) {
        targetOrg = target.value;
        i += target.consumed - 1;
      } else if (rest[i] === "--use-tooling-api" || rest[i] === "-t") {
        useToolingApi = true;
      } else {
        // --file, --all-rows, --result-format, --output-file, --api-version...: real CLI
        return null;
      }
    }
    if (!query) {
      return null;
    }
    return { kind: "data-query", query, targetOrg, useToolingApi };
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
  return findUpwardsFromExecutable(
    sfExecutablePath,
    (dir) => [
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
    ],
    (candidate) => fs.existsSync(path.join(candidate, "package.json")),
  );
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
    const warnings: string[] = [];
    if (parsed.kind === "org-display") {
      result = await orgDisplayInProcess(core, parsed.targetOrg, cwd);
      warnings.push(secretsHiddenWarning("sf org display"));
    } else if (parsed.kind === "config-get") {
      result = await configGetInProcess(core, parsed.keys, cwd);
    } else if (parsed.kind === "org-list") {
      result = await orgListInProcess(
        core,
        parsed.all,
        parsed.skipConnectionStatus,
        cwd,
      );
      warnings.push(secretsHiddenWarning("sf org list"));
    } else if (parsed.kind === "list-metadata") {
      result = await listMetadataInProcess(core, parsed, cwd);
    } else if (parsed.kind === "data-query") {
      result = await dataQueryInProcess(core, parsed, cwd);
    }
    if (result === null) {
      return null;
    }
    Logger.log(
      `[sfdx-hardis][in-process] ${command} (${Date.now() - t0}ms, no CLI spawn)`,
    );
    return { status: 0, result: result, warnings: warnings };
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

// Resolves the org an explicit --target-org or the project's default org points
// to. Returns null when there is no default org (the CLI then prints its usual error).
async function createTargetOrg(
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
  return await core.Org.create({ aliasOrUsername });
}

// Mirrors @salesforce/plugin-org `org display` for non-scratch orgs
async function orgDisplayInProcess(
  core: any,
  targetOrg: string | null,
  cwd: string | undefined,
): Promise<any | null> {
  const org = await createTargetOrg(core, targetOrg, cwd);
  if (!org) {
    return null;
  }
  const authInfo = await core.AuthInfo.create({ username: org.getUsername() });
  const fields: any = authInfo.getFields(true);
  if (fields.devHubUsername) {
    // Scratch org: `org display` queries the Dev Hub for status and expiration date, keep the real CLI for that
    return null;
  }
  const connectedStatus = await determineConnectedStatus(org);
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

// Same wording as plugin-org for a failed connection probe
function connectionErrorToStatus(err: any): string {
  const message: string = err?.message || "";
  if (message.includes("maintenance")) {
    return "Down (Maintenance)";
  }
  if (message.includes("<html>") || message.includes("<!DOCTYPE HTML>")) {
    return "Bad Response";
  }
  return err?.code ?? message;
}

// Connection probe of a non-scratch org, as plugin-org does it
async function determineConnectedStatus(org: any): Promise<string> {
  try {
    await org.refreshAuth();
    return "Connected";
  } catch (err: any) {
    return connectionErrorToStatus(err);
  }
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

/* ------------------------------------------------------------------------- */
/* sf org list: port of @salesforce/plugin-org OrgListUtil + list command     */
/* ------------------------------------------------------------------------- */

const EMPTIES_LAST = "zzzzzzzzzz";

function orgListComparator(a: any, b: any): number {
  const aliasCompareResult = (a.alias ?? EMPTIES_LAST).localeCompare(
    b.alias ?? EMPTIES_LAST,
  );
  return aliasCompareResult !== 0
    ? aliasCompareResult
    : (a.username ?? EMPTIES_LAST).localeCompare(b.username);
}

function decorateWithDefaultStatus(val: any): any {
  return {
    ...val,
    ...(val.isDefaultDevHubUsername ? { defaultMarker: "(D)" } : {}),
    ...(val.isDefaultUsername ? { defaultMarker: "(U)" } : {}),
    ...(val.isDefaultDevHubUsername && val.isDefaultUsername
      ? { defaultMarker: "(D),(U)" }
      : {}),
  };
}

export function isActiveScratchOrg(org: any): boolean {
  return "status" in org && org.status === "Active";
}

/**
 * Buckets, decorates and sorts the orgs exactly like `sf org list --json`.
 * Exported (pure) so the shape can be unit-tested without a Salesforce CLI.
 */
export function buildOrgListResult(
  nonScratchOrgs: any[],
  scratchOrgs: any[],
  all: boolean,
): any {
  const sortedNonScratch = nonScratchOrgs
    .map(decorateWithDefaultStatus)
    .sort(orgListComparator);
  const sortedScratch = scratchOrgs
    .map(decorateWithDefaultStatus)
    .sort(orgListComparator);
  return {
    other: sortedNonScratch.filter((org) => !org.isSandbox && !org.isDevHub),
    sandboxes: sortedNonScratch.filter((org) => Boolean(org.isSandbox)),
    nonScratchOrgs: sortedNonScratch,
    devHubs: sortedNonScratch.filter((org) => Boolean(org.isDevHub)),
    scratchOrgs: all ? sortedScratch : sortedScratch.filter(isActiveScratchOrg),
  };
}

function trimTo15(id: string | undefined): string | undefined {
  return id && id.length > 15 ? id.substring(0, 15) : id;
}

// OrgListUtil.readAuthFiles: one AuthInfo per auth file, keeping a single
// username per org unless it is the default org
async function readOrgListAuthInfos(
  core: any,
  defaultOrg: string | undefined,
): Promise<any[]> {
  let usernames: string[];
  try {
    usernames = ((await core.AuthInfo.listAllAuthorizations()) ?? []).map(
      (auth: any) => auth.username,
    );
  } catch (err: any) {
    if (err?.name === "NoAuthInfoFound") {
      return [];
    }
    throw err;
  }
  const sfdxDir: string = core.Global.SFDX_DIR;
  await fs.promises.mkdir(sfdxDir, { recursive: true });
  const orgFileNames = (await fs.promises.readdir(sfdxDir)).filter(
    (filename) => /^00D.{15}\.json$/.test(filename),
  );
  const allAuths = await Promise.all(
    usernames.map(async (username) => {
      try {
        const auth = await core.AuthInfo.create({ username });
        const fields = auth.getFields();
        if (!fields.userId) {
          return auth;
        }
        if (!fields.orgId) {
          throw new Error("No orgId found in auth file");
        }
        const orgFileName = `${fields.orgId}.json`;
        if (!orgFileNames.includes(orgFileName)) {
          return auth;
        }
        const orgFileContent = JSON.parse(
          await fs.promises.readFile(path.join(sfdxDir, orgFileName), "utf8"),
        );
        const orgUsernames: string[] | undefined = orgFileContent.usernames;
        if (defaultOrg === fields.username) {
          return auth;
        }
        if (orgUsernames && orgUsernames[0] === fields.username) {
          return auth;
        }
        return undefined;
      } catch (e: any) {
        Logger.log(
          `[sfdx-hardis][in-process] org list: problem reading auth of ${username}, skipping (${e?.message})`,
        );
        return undefined;
      }
    }),
  );
  return allAuths.filter((auth) => auth !== undefined);
}

// OrgListUtil.groupOrgs: decrypted fields minus secrets, alias, default markers, lastUsed
async function groupOrgListAuths(
  core: any,
  authInfos: any[],
  aggregator: any,
): Promise<{ scratchOrgs: any[]; nonScratchOrgs: any[] }> {
  const targetOrg = aggregator.getPropertyValue(
    core.OrgConfigProperties.TARGET_ORG,
  );
  const targetDevHub = aggregator.getPropertyValue(
    core.OrgConfigProperties.TARGET_DEV_HUB,
  );
  const stateAggregator = await core.StateAggregator.getInstance();
  const sfdxDir: string = core.Global.SFDX_DIR;
  const results = await Promise.all(
    authInfos.map(async (authInfo: any) => {
      let fields: any;
      try {
        fields = { ...authInfo.getFields(true) };
      } catch {
        Logger.log(
          `[sfdx-hardis][in-process] org list: error decrypting ${authInfo.getUsername()}`,
        );
        fields = { ...authInfo.getFields() };
      }
      delete fields.refreshToken;
      delete fields.clientSecret;
      const aliases: string[] = stateAggregator.aliases.getAll(fields.username);
      const alias = aliases?.length ? aliases[aliases.length - 1] : undefined;
      const stat = await fs.promises.stat(
        path.join(sfdxDir, `${fields.username}.json`),
      );
      const possibleDefaults = [alias, fields.username].filter(Boolean);
      return {
        ...fields,
        alias,
        isDefaultDevHubUsername: possibleDefaults.includes(targetDevHub),
        isDefaultUsername: possibleDefaults.includes(targetOrg),
        lastUsed: stat.atime,
      };
    }),
  );
  return {
    scratchOrgs: results.filter((result) => "expirationDate" in result),
    nonScratchOrgs: results.filter((result) => !("expirationDate" in result)),
  };
}

// OrgListUtil.processScratchOrgs + reduceScratchOrgInfo: status from the Dev Hubs
async function processScratchOrgs(core: any, scratchOrgs: any[]): Promise<any[]> {
  const orgIdsGroupedByDevHub = new Map<string, string[]>();
  for (const fields of scratchOrgs) {
    const ids = orgIdsGroupedByDevHub.get(fields.devHubUsername) ?? [];
    ids.push(trimTo15(fields.orgId) as string);
    orgIdsGroupedByDevHub.set(fields.devHubUsername, ids);
  }
  const scratchOrgInfoFields = [
    "CreatedDate",
    "Edition",
    "Status",
    "ExpirationDate",
    "Namespace",
    "OrgName",
    "CreatedBy.Username",
    "SignupUsername",
    "LoginUrl",
    "ScratchOrg",
  ];
  const updatedContents: any[] = (
    await Promise.all(
      Array.from(orgIdsGroupedByDevHub).map(async ([devHubUsername, orgIds]) => {
        try {
          const devHubOrg = await core.Org.create({
            aliasOrUsername: devHubUsername,
          });
          const conn = devHubOrg.getConnection();
          const data: any[] = await conn
            .sobject("ScratchOrgInfo")
            .find({ ScratchOrg: { $in: orgIds } }, scratchOrgInfoFields);
          return data.map((org) => ({ ...org, devHubOrgId: devHubOrg.getOrgId() }));
        } catch (e: any) {
          Logger.log(
            `[sfdx-hardis][in-process] org list: error querying Dev Hub ${devHubUsername} for ${orgIds.length} scratch orgs (${e?.message})`,
          );
          return [];
        }
      }),
    )
  ).flat();
  const contentMap = new Map(updatedContents.map((org) => [org.SignupUsername, org]));
  const contentMapByOrgId = new Map(
    updatedContents.map((org) => [org.ScratchOrg, org]),
  );
  const results: any[] = [];
  for (const scratchOrgInfo of scratchOrgs) {
    const updated =
      contentMap.get(scratchOrgInfo.username) ??
      contentMapByOrgId.get(trimTo15(scratchOrgInfo.orgId));
    if (!updated) {
      // Same as the CLI: a scratch org unknown to its Dev Hub is dropped (with a warning in the CLI log)
      continue;
    }
    results.push({
      ...scratchOrgInfo,
      signupUsername: updated.SignupUsername,
      createdBy: updated.CreatedBy?.Username,
      createdDate: updated.CreatedDate,
      devHubOrgId: updated.devHubOrgId,
      devHubId: updated.devHubOrgId,
      attributes: updated.attributes,
      orgName: updated.OrgName,
      edition: updated.Edition,
      status: updated.Status,
      expirationDate: updated.ExpirationDate,
      isExpired: updated.Status === "Deleted",
      namespace: updated.Namespace,
    });
  }
  return results;
}

// Mirrors `sf org list [--all] [--skip-connection-status] --json`. Like the CLI,
// skipping the connection status still asks the Dev Hubs about scratch orgs.
async function orgListInProcess(
  core: any,
  all: boolean,
  skipConnectionStatus: boolean,
  cwd: string | undefined,
): Promise<any> {
  const aggregator = await createConfigAggregator(core, cwd);
  const defaultOrg = aggregator.getPropertyValue(
    core.OrgConfigProperties.TARGET_ORG,
  );
  core.StateAggregator.clearInstance();
  const authInfos = await readOrgListAuthInfos(core, defaultOrg);
  const grouped = await groupOrgListAuths(core, authInfos, aggregator);
  const [nonScratchOrgs, scratchOrgs] = await Promise.all([
    Promise.all(
      grouped.nonScratchOrgs.map(async (fields: any) => {
        if (!skipConnectionStatus && fields.username) {
          fields.connectedStatus = await connectedStatusForOrgList(core, fields.username);
          if (!fields.isDevHub && fields.connectedStatus === "Connected") {
            fields.isDevHub = await checkNonScratchOrgIsDevHub(core, fields.username);
          }
        }
        return fields;
      }),
    ),
    processScratchOrgs(core, grouped.scratchOrgs),
  ]);
  const showSecrets = process.env.SF_TEMP_SHOW_SECRETS === "true";
  const redactSecrets = (org: any) => ({
    ...org,
    accessToken: showSecrets ? org.accessToken : REDACTED_ACCESS_TOKEN,
    password: org.password
      ? showSecrets
        ? org.password
        : REDACTED_PASSWORD
      : undefined,
  });
  return buildOrgListResult(
    nonScratchOrgs.map(redactSecrets),
    scratchOrgs.map(redactSecrets),
    all,
  );
}

// OrgListUtil.determineConnectedStatusForNonScratchOrg
async function connectedStatusForOrgList(
  core: any,
  username: string,
): Promise<string | undefined> {
  try {
    const org = await core.Org.create({ aliasOrUsername: username });
    if (org.getField(core.Org.Fields.DEV_HUB_USERNAME)) {
      return undefined;
    }
    return await determineConnectedStatus(org);
  } catch (err: any) {
    return connectionErrorToStatus(err);
  }
}

// OrgListUtil.checkNonScratchOrgIsDevHub (also updates the auth file, like the CLI)
async function checkNonScratchOrgIsDevHub(
  core: any,
  username: string,
): Promise<boolean> {
  try {
    const org = await core.Org.create({ aliasOrUsername: username });
    return await org.determineIfDevHubOrg(true);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* sf org list metadata / sf data query: one API call through jsforce         */
/* ------------------------------------------------------------------------- */

// Mirrors @salesforce/plugin-org `org list metadata`
async function listMetadataInProcess(
  core: any,
  parsed: {
    metadataType: string;
    folder: string | null;
    targetOrg: string | null;
  },
  cwd: string | undefined,
): Promise<any[] | null> {
  const org = await createTargetOrg(core, parsed.targetOrg, cwd);
  if (!org) {
    return null;
  }
  const conn = org.getConnection();
  const query = parsed.folder
    ? { type: parsed.metadataType, folder: parsed.folder }
    : { type: parsed.metadataType };
  const listResult = await conn.metadata.list(query);
  if (listResult === undefined || listResult === null) {
    return [];
  }
  return Array.isArray(listResult) ? listResult : [listResult];
}

// Mirrors @salesforce/plugin-data `data query` (autoFetch up to org-max-query-limit)
async function dataQueryInProcess(
  core: any,
  parsed: { query: string; targetOrg: string | null; useToolingApi: boolean },
  cwd: string | undefined,
): Promise<any | null> {
  const org = await createTargetOrg(core, parsed.targetOrg, cwd);
  if (!org) {
    return null;
  }
  const aggregator = await createConfigAggregator(core, cwd);
  let maxFetch = DEFAULT_MAX_QUERY_LIMIT;
  try {
    const limit = aggregator.getInfo("org-max-query-limit")?.value;
    if (limit !== undefined && limit !== null && Number(limit) > 0) {
      maxFetch = Number(limit);
    }
  } catch {
    // unknown key on an old core: keep the CLI default
  }
  const conn = org.getConnection();
  const connection = parsed.useToolingApi ? conn.tooling : conn;
  const result = await connection.query(parsed.query, {
    autoFetch: true,
    maxFetch,
    scanAll: false,
  });
  if (result?.records?.length && result.totalSize > result.records.length) {
    Logger.log(
      `[sfdx-hardis][in-process] The query result is missing ${result.totalSize - result.records.length} records due to a ${maxFetch} record limit (org-max-query-limit)`,
    );
  }
  return result;
}
