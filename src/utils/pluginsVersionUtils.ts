// Pure helpers (no vscode import, so they are directly unit-testable) deciding
// how an installed sfdx plugin must be considered: locally developed, preview
// (alpha/beta), or a standard install that may require an upgrade.

// Matches ANSI color codes: the Salesforce CLI colorizes its output in some
// environments even when it is not attached to a terminal, ex:
//   sfdx-hardis \u001b[2m7.23.0\u001b[22m \u001b[2m(link) C:\git\sfdx-hardis\u001b[22m
const ANSI_REGEX = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*",
    "(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?",
    "[0-9A-ORZcf-nqry=><]",
  ].join(""),
  "g",
);

export function stripAnsiCodes(str: string): string {
  return (str || "").replace(ANSI_REGEX, "");
}

/**
 * - `localdev`: installed with `sf plugins link` (developed locally)
 * - `preview`: alpha or beta build
 * - `standard`: regular npm install
 * - `missing`: not installed
 */
export type PluginInstallKind = "localdev" | "preview" | "standard" | "missing";

export interface InstalledPluginInfo {
  name: string;
  version: string;
  // "user" | "link" | "core"
  type?: string;
  // "latest" | "alpha" | "beta" | null
  tag?: string | null;
  root?: string | null;
}

/**
 * Parses the output of `sf plugins --json`, which returns the installed plugins
 * as an array (some CLI versions wrap it in a { status, result } envelope).
 * Returns a map by plugin name, or an empty map when the output is unusable.
 */
export function parsePluginsJson(
  stdout: string,
): Record<string, InstalledPluginInfo> {
  const result: Record<string, InstalledPluginInfo> = {};
  const cleanStdout = stripAnsiCodes(stdout || "").trim();
  if (!cleanStdout) {
    return result;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(cleanStdout);
  } catch {
    // Output can contain warning lines before the JSON payload
    const firstBracket = cleanStdout.search(/[[{]/);
    if (firstBracket === -1) {
      return result;
    }
    try {
      parsed = JSON.parse(cleanStdout.substring(firstBracket));
    } catch {
      return result;
    }
  }
  const plugins = Array.isArray(parsed) ? parsed : parsed?.result;
  if (!Array.isArray(plugins)) {
    return result;
  }
  for (const plugin of plugins) {
    if (plugin && typeof plugin.name === "string") {
      result[plugin.name] = {
        name: plugin.name,
        version: plugin.version || "",
        type: plugin.type,
        tag: plugin.tag ?? null,
        root: plugin.root ?? null,
      };
    }
  }
  return result;
}

/**
 * Kind of install, from `sf plugins --json` data (authoritative source: the
 * install type and tag are explicit, whatever the display format of the CLI).
 */
export function getPluginInstallKindFromInfo(
  info: InstalledPluginInfo | null | undefined,
): PluginInstallKind {
  if (!info) {
    return "missing";
  }
  if ((info.type || "").toLowerCase() === "link") {
    return "localdev";
  }
  const tag = (info.tag || "").toLowerCase();
  if (tag === "alpha" || tag === "beta") {
    return "preview";
  }
  if (isPreviewVersion(info.version)) {
    return "preview";
  }
  return "standard";
}

/**
 * Kind of install, from the `sf plugins` text output. Expects everything
 * displayed after the plugin name, ex:
 *   "7.23.0 (link) C:\git\sfdx-hardis"
 *   "7.24.0-alpha.1 (alpha)"
 *   "7.23.0"
 * Used as a fallback when the JSON output is not available.
 */
export function getPluginInstallKindFromText(
  versionDetail: string,
): PluginInstallKind {
  const detail = stripAnsiCodes(versionDetail || "").trim();
  if (detail === "") {
    return "missing";
  }
  if (/\(link\)/i.test(detail)) {
    return "localdev";
  }
  if (/\((?:alpha|beta)\)/i.test(detail) || isPreviewVersion(detail)) {
    return "preview";
  }
  return "standard";
}

// Matches prerelease versions like 7.24.0-alpha.1 or 7.24.0-beta.2
export function isPreviewVersion(version: string): boolean {
  return /\d-(?:alpha|beta)/i.test(version || "");
}

/**
 * Compares two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Pre-release identifiers are stripped rather than ranked, so a beta of the
 * required version (ex: 8.0.0-beta.1 against 8.0.0) counts as satisfying it.
 */
export function comparePluginVersions(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  const pa = a.split(".").map((v) => Number(v.replace(/[^0-9].*$/, "")));
  const pb = b.split(".").map((v) => Number(v.replace(/[^0-9].*$/, "")));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) {
      return -1;
    }
    if (na > nb) {
      return 1;
    }
  }
  return 0;
}

/**
 * Single source of truth telling if the user must be asked to install another
 * version of the sfdx-hardis plugin:
 * - A locally developed plugin (`sf plugins link`) is ALWAYS accepted:
 *   reinstalling it from npm would break the local development setup.
 * - Pre-release extension: an alpha or a beta plugin is required, so a
 *   standard install must be replaced by an alpha or a beta.
 * - Released extension: only the published versions are accepted, so an alpha
 *   or a beta must be replaced by the latest one, and a standard install must
 *   be at least the minimal recommended version.
 * - When the minimal version is set to "beta", a preview build is required.
 */
export function mustUpgradeSfdxHardisPlugin(params: {
  kind: PluginInstallKind;
  installedVersion: string | null;
  isExtensionPreRelease: boolean;
  minimalVersion: string | null;
}): boolean {
  const { kind, installedVersion, isExtensionPreRelease, minimalVersion } =
    params;
  // Not installed at all: handled by the "missing plugin" flows, not here
  if (kind === "missing" || !installedVersion) {
    return false;
  }
  // Locally developed plugin: always accepted, whatever its version
  if (kind === "localdev") {
    return false;
  }
  // A preview plugin is required by a pre-release extension, and when a beta
  // build is explicitly recommended
  if (isExtensionPreRelease || minimalVersion === "beta") {
    return kind !== "preview";
  }
  // Released extension: an alpha or a beta must be replaced by the latest
  // published version
  if (kind === "preview") {
    return true;
  }
  if (!minimalVersion) {
    return false;
  }
  return comparePluginVersions(installedVersion, minimalVersion) < 0;
}
