import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { execSfdxJson } from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { comparePluginVersions } from "./pluginsVersionUtils";
import { getSfCliDataDir } from "./sfPerformanceUtils";

/**
 * The Browserforce plugin (sfdx-browserforce-plugin) as the editor of a "browser" deployment action
 * needs it: which version is installed, the catalog of the settings it can apply, and the check of
 * a setting value. sfdx-hardis reads and writes the same catalog cache file, one per Browserforce
 * version, so whichever of the two runs first saves the other the 2 to 4 seconds of the command.
 */

export const BROWSERFORCE_PLUGIN_NAME = "sfdx-browserforce-plugin";
// First release with plugins list and plugins validate, the same minimum as sfdx-hardis
export const BROWSERFORCE_MIN_VERSION = "7.0.0";
// Version of the catalog format this extension reads: a higher one may lack what it reads
export const SUPPORTED_BROWSERFORCE_CATALOG_FORMAT_VERSION = 1;
const SECRETS_LOOKUP_CACHE_MS = 10 * 60 * 1000;

export interface InstalledBrowserforce {
  version: string;
  root: string;
  // Installed with sf plugins link: its content changes under the same version
  linked: boolean;
}

export interface BrowserforceCatalog {
  formatVersion: number;
  browserforceVersion: string;
  plugins: any[];
  deprecatedSettings: any[];
}

export interface BrowserforceCatalogAnswer {
  catalog: BrowserforceCatalog | null;
  // Not installed, or older than BROWSERFORCE_MIN_VERSION (outdated)
  notInstalled: boolean;
  outdated: boolean;
  installedVersion: string | null;
  error: string | null;
}

export interface BrowserforceValidation {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  environmentVariables: Array<{ name: string; path: string }>;
  // The check could not run (Browserforce missing, command failure)
  error: string | null;
}

export interface BrowserSecretsLookup {
  provider: string;
  label: string;
  // names: the variables read for that branch, in order, {NAME} standing for the variable name
  branches: Array<{ branch: string; names: string[] }>;
}

// Catalogs already read in this session, by plugin folder and version
const memoryCache = new Map<string, BrowserforceCatalog>();

/**
 * The catalog of the installed Browserforce: from memory, then from the cache file of its version,
 * then from `sf browserforce plugins list`. Never throws: a missing plugin or a failure is told in
 * the answer, so the editor can offer to install it or show the error.
 */
export async function loadBrowserforceCatalog(): Promise<BrowserforceCatalogAnswer> {
  const installed = findInstalledBrowserforce();
  if (!installed) {
    return {
      catalog: null,
      notInstalled: true,
      outdated: false,
      installedVersion: null,
      error: null,
    };
  }
  // A linked plugin is a development copy: it is used whatever its version
  if (
    !installed.linked &&
    comparePluginVersions(installed.version, BROWSERFORCE_MIN_VERSION) < 0
  ) {
    return {
      catalog: null,
      notInstalled: true,
      outdated: true,
      installedVersion: installed.version,
      error: null,
    };
  }
  try {
    const catalog = await getCatalog(installed);
    return {
      catalog,
      notInstalled: false,
      outdated: false,
      installedVersion: installed.version,
      error: null,
    };
  } catch (error: any) {
    Logger.log(
      `[Browserforce] Unable to load the settings catalog: ${error?.message || error}`,
    );
    return {
      catalog: null,
      notInstalled: false,
      outdated: false,
      installedVersion: installed.version,
      error: error?.message || String(error),
    };
  }
}

/**
 * Checks the value of one setting against its schema, without any org: `sf browserforce plugins
 * validate`. The value goes through a temporary file, as JSON on a command line does not survive
 * the quoting of every shell. The command exits 1 on an invalid value and still answers its JSON.
 */
export async function validateBrowserforceConfig(
  setting: string,
  config: any,
): Promise<BrowserforceValidation> {
  const configFile = path.join(
    os.tmpdir(),
    `sfdx-hardis-browserforce-${randomUUID()}.json`,
  );
  try {
    await fs.promises.writeFile(
      configFile,
      JSON.stringify({ settings: { [setting]: config } }, null, 2),
      "utf8",
    );
    const answer = await execSfdxJson(
      `sf browserforce plugins validate -f "${configFile}" --json`,
      { fail: false, output: false, shareInFlightRun: false },
    );
    const result = answer?.result;
    if (!result || typeof result.valid !== "boolean") {
      return {
        valid: false,
        errors: [],
        environmentVariables: [],
        error: describeCommandFailure(answer),
      };
    }
    return {
      valid: result.valid,
      errors: Array.isArray(result.errors) ? result.errors : [],
      environmentVariables: Array.isArray(result.environmentVariables)
        ? result.environmentVariables
        : [],
      error: null,
    };
  } catch (error: any) {
    return {
      valid: false,
      errors: [],
      environmentVariables: [],
      error: error?.message || String(error),
    };
  } finally {
    await fs.promises.rm(configFile, { force: true }).catch(() => undefined);
  }
}

/**
 * The CI/CD variable names sfdx-hardis reads for a `${NAME}` value, per major branch, as the CLI
 * describes them (`sf hardis:project:action:types --type browser`). null when the CLI is too old
 * to describe them: the editor then shows the variable name only.
 */
export async function loadBrowserSecretsLookup(): Promise<BrowserSecretsLookup | null> {
  try {
    const answer = await execSfdxJson(
      "sf hardis:project:action:types --type browser --json",
      {
        fail: false,
        output: false,
        cacheSection: "project",
        cacheExpiration: SECRETS_LOOKUP_CACHE_MS,
      },
    );
    const types = Array.isArray(answer?.result?.types)
      ? answer.result.types
      : [];
    const lookup = types.find((type: any) => type?.type === "browser")?.details
      ?.secretsLookup;
    if (!lookup || !Array.isArray(lookup.branches)) {
      return null;
    }
    return {
      provider: String(lookup.provider || ""),
      label: String(lookup.label || ""),
      branches: lookup.branches
        .filter((branch: any) => branch && typeof branch.branch === "string")
        .map((branch: any) => ({
          branch: branch.branch,
          names: Array.isArray(branch.names)
            ? branch.names.map((name: any) => String(name))
            : [],
        })),
    };
  } catch (error: any) {
    Logger.log(
      `[Browserforce] Unable to read the CI/CD variable names: ${error?.message || error}`,
    );
    return null;
  }
}

/**
 * The Browserforce plugin registered in the sf CLI, read from the plugin registry of the sf data
 * folder without starting the CLI. null when it is not installed.
 */
export function findInstalledBrowserforce(
  dataDir: string = getSfCliDataDir(),
): InstalledBrowserforce | null {
  const registry = readJsonFile(path.join(dataDir, "package.json"));
  const plugins: any[] = Array.isArray(registry?.oclif?.plugins)
    ? registry.oclif.plugins
    : [];
  const entry = plugins.find(
    (plugin) => plugin?.name === BROWSERFORCE_PLUGIN_NAME,
  );
  if (!entry) {
    return null;
  }
  const linked = entry.type === "link";
  const root =
    linked && typeof entry.root === "string"
      ? entry.root
      : path.join(dataDir, "node_modules", BROWSERFORCE_PLUGIN_NAME);
  const pluginPackage = readJsonFile(path.join(root, "package.json"));
  if (!pluginPackage?.version) {
    return null;
  }
  return { version: String(pluginPackage.version), root, linked };
}

/** Folder of the catalog cache files, shared with sfdx-hardis */
export function getBrowserforceCatalogCacheDir(): string {
  return (
    process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR ||
    path.join(os.homedir(), ".sfdx", "sfdx-hardis-cache", "browserforce")
  );
}

/** Same file name as sfdx-hardis: catalog-<version>.json */
export function getBrowserforceCatalogFile(version: string): string {
  return path.join(
    getBrowserforceCatalogCacheDir(),
    `catalog-${version.replace(/[^A-Za-z0-9._-]/g, "_")}.json`,
  );
}

/** The cached catalog of a version. A missing, unreadable or cut short file is a cache miss. */
export function readBrowserforceCatalogFile(
  version: string,
): BrowserforceCatalog | null {
  const catalog = readJsonFile(getBrowserforceCatalogFile(version));
  return Array.isArray(catalog?.plugins) &&
    Array.isArray(catalog?.deprecatedSettings)
    ? catalog
    : null;
}

/**
 * Written to a temporary file then renamed, so a reader never sees half a file. The files of the
 * other versions are removed: only the installed version is ever read.
 */
export function writeBrowserforceCatalogFile(
  version: string,
  catalog: BrowserforceCatalog,
): void {
  try {
    const cacheDir = getBrowserforceCatalogCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    const target = getBrowserforceCatalogFile(version);
    const tmpFile = `${target}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(catalog), "utf8");
    fs.renameSync(tmpFile, target);
    for (const file of fs.readdirSync(cacheDir)) {
      const filePath = path.join(cacheDir, file);
      if (/^catalog-.+\.json$/.test(file) && filePath !== target) {
        fs.rmSync(filePath, { force: true });
      }
    }
  } catch (error: any) {
    // The cache only saves time: a read-only home folder must not fail the editor
    Logger.log(
      `[Browserforce] Catalog cache not written: ${error?.message || error}`,
    );
  }
}

async function getCatalog(
  installed: InstalledBrowserforce,
): Promise<BrowserforceCatalog> {
  const memoryKey = `${installed.root}@${installed.version}`;
  const inMemory = memoryCache.get(memoryKey);
  if (inMemory) {
    return inMemory;
  }
  let catalog = installed.linked
    ? null
    : readBrowserforceCatalogFile(installed.version);
  if (catalog) {
    assertCatalogFormat(catalog);
  } else {
    catalog = await loadCatalogFromCommand();
    // Checked before writing: a catalog this extension cannot read is not cached
    assertCatalogFormat(catalog);
    if (!installed.linked) {
      writeBrowserforceCatalogFile(installed.version, catalog);
    }
  }
  memoryCache.set(memoryKey, catalog);
  return catalog;
}

async function loadCatalogFromCommand(): Promise<BrowserforceCatalog> {
  const answer = await execSfdxJson("sf browserforce plugins list --json", {
    fail: false,
    output: false,
  });
  const catalog = answer?.result;
  if (!Array.isArray(catalog?.plugins)) {
    throw new Error(describeCommandFailure(answer));
  }
  return {
    ...catalog,
    deprecatedSettings: Array.isArray(catalog.deprecatedSettings)
      ? catalog.deprecatedSettings
      : [],
  };
}

function assertCatalogFormat(catalog: BrowserforceCatalog): void {
  if (
    Number(catalog.formatVersion) >
    SUPPORTED_BROWSERFORCE_CATALOG_FORMAT_VERSION
  ) {
    throw new Error(
      t("browserforceCatalogFormatUnsupported", {
        version: catalog.browserforceVersion,
        format: String(catalog.formatVersion),
      }),
    );
  }
}

function describeCommandFailure(answer: any): string {
  const message =
    answer?.message ||
    answer?.result?.message ||
    answer?.stderr ||
    answer?.errorMessage;
  return message ? String(message).trim() : t("browserforceCommandFailed");
}

function readJsonFile(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
