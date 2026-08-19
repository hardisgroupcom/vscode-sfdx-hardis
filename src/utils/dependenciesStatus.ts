import { execCommand, getNpmLatestVersion, isToolingCachePreloaded, stripAnsi } from "../utils";
import { findExecutable } from "./executableUtils";
import { getSalesforceExtensionPackStatus, resolveSfCliPath } from "./setupUtils";
import { LwcPanelManager } from "../lwc-panel-manager";
import {
  NODE_JS_MINIMUM_VERSION,
  RECOMMENDED_SFDX_CLI_VERSION,
  DOCSITE_URL,
} from "../constants";

/**
 * Lightweight, cache-only aggregate of the environment's core prerequisites
 * (Node.js, Git, Salesforce CLI, sfdx-hardis plugin, Salesforce Extension Pack)
 * plus the count of outdated plugins, consumed by the Welcome page:
 *  - the "Install Dependencies" button (checking / upgrades required / all set)
 *  - the missing-prerequisites modal (brand-new users guidance)
 *
 * Everything here reads from the already-warm cache populated by
 * `preLoadCache()` (see src/utils.ts) or from cheap, spawn-free lookups
 * (`findExecutable`, `vscode.extensions.getExtension`). It never spawns a CLI
 * process on its own, so it is safe to call on every Welcome page open/refresh.
 */

export type PrerequisiteId =
  | "node"
  | "git"
  | "sf"
  | "sfdxHardis"
  | "vscodeExtensionPack";

export type PrerequisiteState = "checking" | "ok" | "outdated" | "missing";

export interface PrerequisiteStatus {
  id: PrerequisiteId;
  label: string;
  status: PrerequisiteState;
  installed: boolean;
  version?: string | null;
  recommended?: string | null;
  helpUrl: string;
}

/**
 * Richer info published by `HardisPluginsProvider.runPluginsDetailPass()` once
 * it has run (it is the only place that also looks at community/custom
 * plugins and truly resolves plugin install kinds).
 */
export interface PluginsDetailSnapshot {
  outdatedPluginsCount: number;
  sfCliMissing: boolean;
  sfdxHardisMissing: boolean;
}

export type DependenciesButtonState =
  | "checking"
  | "upgradesRequired"
  | "allUpToDate";

export interface DependenciesStatusSummary {
  state: DependenciesButtonState;
  prerequisites: PrerequisiteStatus[];
  missingPrerequisites: PrerequisiteStatus[];
  missingCount: number;
  outdatedCount: number;
  actionableCount: number;
}

const NODE_HELP_URL = "https://nodejs.org/en/";
const GIT_HELP_URL = "https://git-scm.com/downloads";
const SF_CLI_HELP_URL =
  "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm";
const VSCODE_EXTENSION_PACK_HELP_URL =
  "https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode";

const PREREQUISITE_LABELS: Record<PrerequisiteId, string> = {
  node: "Node.js",
  git: "Git",
  sf: "Salesforce CLI (sf)",
  sfdxHardis: "sfdx-hardis",
  vscodeExtensionPack: "Salesforce Extension Pack",
};

const PREREQUISITE_HELP_URLS: Record<PrerequisiteId, string> = {
  node: NODE_HELP_URL,
  git: GIT_HELP_URL,
  sf: SF_CLI_HELP_URL,
  sfdxHardis: DOCSITE_URL,
  vscodeExtensionPack: VSCODE_EXTENSION_PACK_HELP_URL,
};

// Last full aggregate computed, exposed synchronously so a Welcome page opened
// after the computation completed gets a value immediately
let CACHED_STATUS: DependenciesStatusSummary | null = null;
// Richer info from the plugins detail pass (see PluginsDetailSnapshot above),
// carried forward across recomputes until the extension reloads
let LAST_RICH_INFO: PluginsDetailSnapshot | null = null;
// Per-session guard: true once the user closed the missing-prerequisites
// modal. Lives in the extension host (not webview state) so a Welcome page
// closed and reopened does not show it again in the same VS Code session.
let PREREQUISITES_MODAL_DISMISSED = false;

export function isPrerequisitesModalDismissed(): boolean {
  return PREREQUISITES_MODAL_DISMISSED;
}

export function dismissPrerequisitesModalForSession(): void {
  PREREQUISITES_MODAL_DISMISSED = true;
}

/**
 * Last computed aggregate, returned synchronously. Never triggers a
 * computation: callers that need a fresh value call `refreshDependenciesStatus()`.
 */
export function getCachedDependenciesStatus(): DependenciesStatusSummary {
  return CACHED_STATUS ?? buildCheckingSummary();
}

/**
 * Recomputes the aggregate from cache/cheap lookups, stores it and pushes it
 * to the Welcome panel if open (mirrors `HardisStatusProvider.refreshOrgRelatedUis()`).
 */
export async function refreshDependenciesStatus(): Promise<DependenciesStatusSummary> {
  const summary = await computeDependenciesStatus();
  CACHED_STATUS = summary;
  pushToWelcomePanel(summary);
  return summary;
}

/**
 * Called from `HardisPluginsProvider.runPluginsDetailPass()`'s `finally` block:
 * enriches the last computed aggregate with the richer plugin/outdated info
 * that pass alone can compute (community plugins, real install kinds…).
 */
export function applyPluginsDetailPassInfo(
  info: PluginsDetailSnapshot | null,
): void {
  if (!info) {
    return;
  }
  LAST_RICH_INFO = info;
  if (!CACHED_STATUS || CACHED_STATUS.state === "checking") {
    // Tooling cache was not ready yet when the detail pass finished; the next
    // refreshDependenciesStatus() call will naturally pick up LAST_RICH_INFO
    return;
  }
  CACHED_STATUS = buildDependenciesStatusSummary(
    CACHED_STATUS.prerequisites,
    LAST_RICH_INFO,
  );
  pushToWelcomePanel(CACHED_STATUS);
}

function pushToWelcomePanel(summary: DependenciesStatusSummary): void {
  const panelManager = LwcPanelManager.getInstance();
  const welcomePanel = panelManager.getPanel("s-welcome");
  if (welcomePanel && !welcomePanel.isDisposed()) {
    welcomePanel.sendMessage({
      type: "updateDependenciesStatus",
      data: {
        dependenciesStatus: summary,
        dependenciesModalDismissed: PREREQUISITES_MODAL_DISMISSED,
      },
    });
  }
}

async function computeDependenciesStatus(): Promise<DependenciesStatusSummary> {
  if (!isToolingCachePreloaded()) {
    return buildCheckingSummary();
  }
  const [node, git, sf, sfdxHardis, vscodeExtensionPack] = await Promise.all([
    computeNodeStatus(),
    computeGitStatus(),
    computeSfCliStatus(),
    computeSfdxHardisStatus(),
    computeVsCodeExtensionPackStatus(),
  ]);
  return buildDependenciesStatusSummary(
    [node, git, sf, sfdxHardis, vscodeExtensionPack],
    LAST_RICH_INFO,
  );
}

/**
 * Pure function (no I/O): derives the final summary (state, counts, missing
 * list) from a list of prerequisite statuses and the optional richer plugin
 * info. Exported for unit testing.
 */
export function buildDependenciesStatusSummary(
  prerequisites: PrerequisiteStatus[],
  richInfo: PluginsDetailSnapshot | null,
): DependenciesStatusSummary {
  const merged = richInfo
    ? applyRichInfoToPrerequisites(prerequisites, richInfo)
    : prerequisites;
  const missingPrerequisites = merged.filter((p) => p.status === "missing");
  const outdatedPrerequisitesCount = merged.filter(
    (p) => p.status === "outdated",
  ).length;
  const outdatedPluginsCount = richInfo ? richInfo.outdatedPluginsCount : 0;
  const missingCount = missingPrerequisites.length;
  const outdatedCount = outdatedPrerequisitesCount + outdatedPluginsCount;
  const actionableCount = missingCount + outdatedCount;
  const state: DependenciesButtonState =
    actionableCount > 0 ? "upgradesRequired" : "allUpToDate";
  return {
    state,
    prerequisites: merged,
    missingPrerequisites,
    missingCount,
    outdatedCount,
    actionableCount,
  };
}

/**
 * Pure function (no I/O): overlays the missing detection resolved by the
 * plugins detail pass on top of the naive cache-only prerequisite statuses.
 * Idempotent: re-applying the same info twice is a no-op. Exported for unit
 * testing.
 */
export function applyRichInfoToPrerequisites(
  prerequisites: PrerequisiteStatus[],
  richInfo: PluginsDetailSnapshot,
): PrerequisiteStatus[] {
  return prerequisites.map((prerequisite) => {
    if (
      prerequisite.id === "sf" &&
      richInfo.sfCliMissing &&
      prerequisite.status !== "missing"
    ) {
      return { ...prerequisite, status: "missing", installed: false };
    }
    if (
      prerequisite.id === "sfdxHardis" &&
      richInfo.sfdxHardisMissing &&
      prerequisite.status !== "missing"
    ) {
      return { ...prerequisite, status: "missing", installed: false };
    }
    return prerequisite;
  });
}

/**
 * Pure function (no I/O): the aggregate shown before the tooling cache has
 * finished preloading. Exported for unit testing.
 */
export function buildCheckingSummary(): DependenciesStatusSummary {
  const prerequisites: PrerequisiteStatus[] = (
    Object.keys(PREREQUISITE_LABELS) as PrerequisiteId[]
  ).map((id) => ({
    id,
    label: PREREQUISITE_LABELS[id],
    status: "checking",
    installed: false,
    version: null,
    recommended: null,
    helpUrl: PREREQUISITE_HELP_URLS[id],
  }));
  return {
    state: "checking",
    prerequisites,
    missingPrerequisites: [],
    missingCount: 0,
    outdatedCount: 0,
    actionableCount: 0,
  };
}

/**
 * Reads a command's cached stdout without ever spawning a process: returns
 * `null` when nothing is cached yet (never happens once `isToolingCachePreloaded()`
 * is true for the commands preloaded by `preLoadCache()`).
 */
async function readCachedCommandOutput(command: string): Promise<string | null> {
  try {
    const res: any = await execCommand(command, {
      fail: false,
      output: false,
      spinner: false,
      cacheSection: "app",
    });
    const out = res && res.stdout ? res.stdout.toString().trim() : "";
    return out || null;
  } catch {
    return null;
  }
}

async function isExecutableOnPath(name: string): Promise<boolean> {
  try {
    await findExecutable(name);
    return true;
  } catch {
    return false;
  }
}

async function computeNodeStatus(): Promise<PrerequisiteStatus> {
  const label = PREREQUISITE_LABELS.node;
  const installed = await isExecutableOnPath("node");
  if (!installed) {
    return {
      id: "node",
      label,
      status: "missing",
      installed: false,
      version: null,
      recommended: String(NODE_JS_MINIMUM_VERSION),
      helpUrl: NODE_HELP_URL,
    };
  }
  const out = await readCachedCommandOutput("node --version");
  const match = out ? /v?(\d+)\.(.+)/.exec(out) : null;
  if (!match) {
    return {
      id: "node",
      label,
      status: "ok",
      installed: true,
      version: null,
      recommended: null,
      helpUrl: NODE_HELP_URL,
    };
  }
  const version = `${match[1]}.${match[2]}`;
  const major = parseInt(match[1], 10);
  const minMajor = Math.floor(Number(NODE_JS_MINIMUM_VERSION) || 0);
  const isOutdated =
    !Number.isNaN(major) &&
    major < minMajor &&
    !process.env.PATH?.includes("/home/codebuilder/");
  return {
    id: "node",
    label,
    status: isOutdated ? "outdated" : "ok",
    installed: true,
    version,
    recommended: isOutdated ? String(NODE_JS_MINIMUM_VERSION) : null,
    helpUrl: NODE_HELP_URL,
  };
}

async function computeGitStatus(): Promise<PrerequisiteStatus> {
  const label = PREREQUISITE_LABELS.git;
  const installed = await isExecutableOnPath("git");
  if (!installed) {
    return {
      id: "git",
      label,
      status: "missing",
      installed: false,
      version: null,
      recommended: null,
      helpUrl: GIT_HELP_URL,
    };
  }
  const out = await readCachedCommandOutput("git --version");
  const match = out ? /git version ([0-9]+)\.(.*)/.exec(out) : null;
  return {
    id: "git",
    label,
    status: "ok",
    installed: true,
    version: match ? `${match[1]}.${match[2]}` : null,
    recommended: null,
    helpUrl: GIT_HELP_URL,
  };
}

async function computeSfCliStatus(): Promise<PrerequisiteStatus> {
  const label = PREREQUISITE_LABELS.sf;
  // resolveSfCliPath() wraps findExecutable("sf") and returns the "missing"
  // sentinel instead of throwing — no spawn either way
  const sfdxPath = await resolveSfCliPath();
  if (sfdxPath === "missing") {
    return {
      id: "sf",
      label,
      status: "missing",
      installed: false,
      version: null,
      recommended: null,
      helpUrl: SF_CLI_HELP_URL,
    };
  }
  const out = await readCachedCommandOutput("sf --version");
  const match = out
    ? /@salesforce\/cli\/(\S+)|sfdx-cli\/(\S+)/.exec(out)
    : null;
  const version = match ? match[1] || match[2] : null;
  if (!version) {
    return {
      id: "sf",
      label,
      status: "ok",
      installed: true,
      version: null,
      recommended: null,
      helpUrl: SF_CLI_HELP_URL,
    };
  }
  // getNpmLatestVersion never spawns a process and never rejects: it reads a
  // stale cached value immediately (or null) and refreshes in the background
  const latest = await getNpmLatestVersion("@salesforce/cli");
  const recommended = RECOMMENDED_SFDX_CLI_VERSION || latest || null;
  const isOutdated = !!(recommended && version !== recommended);
  return {
    id: "sf",
    label,
    status: isOutdated ? "outdated" : "ok",
    installed: true,
    version,
    recommended: isOutdated ? recommended : null,
    helpUrl: SF_CLI_HELP_URL,
  };
}

async function computeSfdxHardisStatus(): Promise<PrerequisiteStatus> {
  const label = PREREQUISITE_LABELS.sfdxHardis;
  const out = await readCachedCommandOutput("sf plugins");
  const text = out ? stripAnsi(out) : "";
  const match = /sfdx-hardis\s+([-0-9A-Za-z.()]+)/m.exec(text);
  const installedVersion = match ? match[1] : null;
  if (!installedVersion) {
    return {
      id: "sfdxHardis",
      label,
      status: "missing",
      installed: false,
      version: null,
      recommended: null,
      helpUrl: DOCSITE_URL,
    };
  }
  const latest = await getNpmLatestVersion("sfdx-hardis");
  const isOutdated = !!(latest && latest !== installedVersion);
  return {
    id: "sfdxHardis",
    label,
    status: isOutdated ? "outdated" : "ok",
    installed: true,
    version: installedVersion,
    recommended: isOutdated ? latest : null,
    helpUrl: DOCSITE_URL,
  };
}

async function computeVsCodeExtensionPackStatus(): Promise<PrerequisiteStatus> {
  const label = PREREQUISITE_LABELS.vscodeExtensionPack;
  // Cached for 30 days once found installed (see getSalesforceExtensionPackStatus)
  const { installed, version } = getSalesforceExtensionPackStatus();
  return {
    id: "vscodeExtensionPack",
    label,
    status: installed ? "ok" : "missing",
    installed,
    version,
    recommended: null,
    helpUrl: VSCODE_EXTENSION_PACK_HELP_URL,
  };
}
