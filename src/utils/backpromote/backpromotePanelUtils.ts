import { stripAnsiCodes } from "../ansiColors";
import { shortenOrgHost } from "../orgColorUtils";

/**
 * Pure logic of the Backpromote panel (vscode-sfdx-hardis.showBackpromote).
 *
 * sfdx-hardis is the engine: `sf hardis:work:backpromote --plan --json` returns the plan
 * (version 3) of a backpromote of a parent branch into a target sandbox, `--prepare` writes
 * the merged files a user wants to solve by hand, `--auto` runs the backpromote with the
 * decisions passed as flags. These helpers turn the decisions taken in the panel into those
 * exact commands, and the plan into the counters of the page. No VS Code API here: they are
 * unit tested directly.
 */

export const BACKPROMOTE_COMMAND = "sf hardis:work:backpromote";
export const BACKPROMOTE_PLAN_VERSION = 3;
export const BACKPROMOTE_SCAN_PAGE = 100;
export const BACKPROMOTE_DOC_URL =
  "https://sfdx-hardis.cloudity.com/hardis/work/backpromote/";

/** Environment variables sfdx-hardis reads to find the git provider token */
export const GIT_PROVIDER_TOKEN_VARIABLES = [
  "GITHUB_TOKEN",
  "CI_SFDX_HARDIS_GITHUB_TOKEN",
  "CI_SFDX_HARDIS_GITLAB_TOKEN",
  "SYSTEM_ACCESSTOKEN",
  "CI_SFDX_HARDIS_AZURE_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "CI_SFDX_HARDIS_BITBUCKET_TOKEN",
];

export type BackpromoteStatus =
  | "ok"
  | "blocked"
  | "nothingToDo"
  | "waitingForMerges"
  | "conflictsRemaining"
  | "refused"
  | "pushRejected"
  | "deployFailed";
export const BACKPROMOTE_STATUSES: BackpromoteStatus[] = [
  "ok",
  "blocked",
  "nothingToDo",
  "waitingForMerges",
  "conflictsRemaining",
  "refused",
  "pushRejected",
  "deployFailed",
];

export type BackpromoteDiffChoice = "git" | "org" | "merge";
export const BACKPROMOTE_DIFF_CHOICES: BackpromoteDiffChoice[] = [
  "git",
  "org",
  "merge",
];

export type BackpromoteComparisonStatus =
  | "same"
  | "different"
  | "missingInOrg"
  | "pendingInOrg"
  | "notCompared";

export interface BackpromoteLeftOutItem {
  key: string;
  reason: "excluded" | "keptOrg" | "conflictPending" | "noOverwrite";
  commit?: string;
}

export interface BackpromotePullRequest {
  number: number;
  title: string;
  author: string;
  mergeDate: string;
  sourceBranch: string;
  commit: string;
  webUrl: string;
  itemCount: number;
  actionCount: number;
  backpromote: {
    date: string;
    user: string;
    status: "complete" | "partial";
    leftOut: BackpromoteLeftOutItem[];
  } | null;
  beforeRefresh: boolean;
  /** Older than the newest Pull Request backpromoted to this sandbox: counted as backpromoted */
  beforeLastBackpromote: boolean;
  selected: boolean;
  inWindow: boolean;
  scanned: boolean;
}

export interface BackpromoteItem {
  key: string;
  type: string;
  name: string;
  files: string[];
  pullRequests: number[];
  excludedLastTime: boolean;
  noOverwrite: boolean;
}

export interface BackpromoteDeletion {
  key: string;
  type: string;
  name: string;
}

export interface BackpromoteAction {
  id: string;
  label: string;
  type: string;
  phase: "pre" | "post";
  context: string;
  pullRequest: number;
  alreadyRunOn: string | null;
  manual: boolean;
  customUsername: string | null;
  runnable: boolean;
  runOnlyOnceByOrg: boolean;
}

export interface BackpromoteComparison {
  file: string;
  item: string;
  status: BackpromoteComparisonStatus;
  versions: {
    base: string | null;
    sandbox: string | null;
    parentHead: string | null;
  };
  diffLines: number;
  pullRequests: number[];
  decision: BackpromoteDiffChoice | null;
  prepared: boolean;
  markersRemaining: number;
  conflictPending: boolean;
  threeWay: boolean;
}

export interface BackpromoteCheck {
  id: string;
  ok: boolean;
  message: string;
  details: string[];
}

export interface BackpromoteRunResult {
  deployed: number;
  deleted: number;
  excluded: BackpromoteLeftOutItem[];
  actions: { run: string[]; skipped: string[]; failed: string[]; pending: string[] };
  conflictPending: string[];
  commentedPullRequests: number[];
  pushed: boolean;
  pushRejected: boolean;
  deployReport: string | null;
  orgUrl: string | null;
}

export interface BackpromotePlan {
  version: number;
  runId: string;
  mode: string;
  status: BackpromoteStatus;
  message: string | null;
  targetOrg: {
    alias: string | null;
    username: string;
    instanceUrl: string;
    orgId: string;
    sandboxName: string;
    orgType: string;
    tracksSource: boolean;
    refusal: "production" | "majorOrg" | null;
  };
  parentBranch: string;
  allowedParentBranches: string[];
  /**
   * Absolute root of the git repository: the relative paths of the plan (comparison files,
   * item files) are relative to it, not to the VS Code workspace folder, which may be an sfdx
   * project opened as a sub-folder of its repository. Empty with an older sfdx-hardis.
   */
  gitRoot: string;
  backpromoteBranch: {
    name: string;
    existsOnOrigin: boolean;
    head: string | null;
    pendingMerges: string[];
  };
  checkout: {
    originalBranch: string;
    currentBranch: string;
    clean: boolean;
    dirtyFiles: string[];
    stashed: boolean;
    stashMessage: string | null;
    onBackpromoteBranch: boolean;
  };
  pullRequests: BackpromotePullRequest[];
  scan: { read: number; limit: number; found: boolean; hasMore: boolean };
  window: {
    fromCommit: string;
    toCommit: string;
    startPullRequest: number | null;
  } | null;
  items: BackpromoteItem[];
  deletions: BackpromoteDeletion[];
  actions: BackpromoteAction[];
  comparison: BackpromoteComparison[];
  checks: BackpromoteCheck[];
  promptFile: string | null;
  runCommand: string | null;
  result: BackpromoteRunResult | null;
}

/**
 * What the user picked in the panel. Only keys and ids that exist in the plan are kept
 * (see normalizeSelection), so a message from the webview cannot inject anything into the command.
 */
export interface BackpromoteSelection {
  /** `Type:Name` items not to deploy now */
  excludedItems: string[];
  /** `Type:Name` deletions not to run */
  excludedDeletions: string[];
  /** Ids of the deployment actions to run */
  actions: string[];
  /** Item key -> what to deploy for its files whose sandbox version differs */
  diffDecisions: Record<string, BackpromoteDiffChoice>;
}

/** Commit or stash the working tree before the checkout switches to the backpromote branch */
export interface BackpromoteDirtyTreeChoice {
  action: "commit" | "stash";
  message: string | null;
}

export type BackpromoteBlocker =
  | "notReady"
  | "noWindow"
  | "nothingToDo"
  | "conflictMarkers"
  | "preparedMarkers"
  | "invalidCommand";

export interface BackpromoteSelectionSummary {
  itemsToDeployCount: number;
  deletionsToDeleteCount: number;
  actionsToRunCount: number;
  manualActionsCount: number;
  keptOrgCount: number;
  mergedFilesCount: number;
  /**
   * Files that still hold markers: the files of a Merge decision (not prepared yet, or
   * prepared with markers left), and every prepared file of the checkout whatever the
   * decision taken since, because sfdx-hardis refuses the run while one holds markers.
   */
  markersLeft: Array<{
    file: string;
    item: string;
    markersRemaining: number;
    /** True when the item is deployed as a merge, false for a prepared file switched to another decision */
    merging: boolean;
  }>;
  blockers: BackpromoteBlocker[];
  canRun: boolean;
}

export interface BackpromoteSelectionPayload {
  summary: BackpromoteSelectionSummary;
  command: string | null;
  commandError: string | null;
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter(
    (entry): entry is string => typeof entry === "string",
  );
}

function asNumberArray(value: unknown): number[] {
  return asArray(value).filter(
    (entry): entry is number => Number.isInteger(entry),
  );
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Splits a `Type:Name` key on its FIRST colon (names may contain colons, spaces,
 * dots and dashes).
 */
export function parseMetadataKey(
  key: string,
): { type: string; name: string } | null {
  if (typeof key !== "string") {
    return null;
  }
  const index = key.indexOf(":");
  if (index <= 0 || index === key.length - 1) {
    return null;
  }
  return { type: key.slice(0, index), name: key.slice(index + 1) };
}

/**
 * Number of git conflict blocks left in a file content, mirror of the sfdx-hardis rule: every
 * marker line counts, so a half removed block is still a conflict.
 */
export function countConflictMarkerBlocks(content: string): number {
  const lines = (content || "").split(/\r?\n/);
  const count = (marker: RegExp) =>
    lines.filter((line) => marker.test(line)).length;
  return Math.max(
    count(/^<{7}(?!<)/),
    count(/^\|{7}(?!\|)/),
    count(/^>{7}(?!>)/),
  );
}

/** True when the environment holds a token sfdx-hardis can read the Pull Request comments with */
export function hasGitProviderToken(
  env: Record<string, string | undefined>,
): boolean {
  return GIT_PROVIDER_TOKEN_VARIABLES.some(
    (name) => typeof env[name] === "string" && env[name]!.trim() !== "",
  );
}

const PLAIN_COMMAND_VALUE = /^[A-Za-z0-9_.@:/+=,-]+$/;
// Characters whose meaning differs between cmd.exe and /bin/sh, even inside double
// quotes: such a value is refused, never escaped.
const UNSAFE_COMMAND_VALUE = /["\\`]/;
// Command and variable substitution: refused whatever the quoting
const UNSAFE_SUBSTITUTION = /\$[({]/;
// A lone dollar sign is part of Salesforce folder names (unfiled$public). cmd.exe never
// expands it, so double quotes are enough on Windows; /bin/sh expands it inside double
// quotes, so the value is single quoted there, which means a single quote inside the
// value cannot be protected on that path.
const HOLDS_DOLLAR = /\$/;

/**
 * The commands of the panel go through child_process.exec: cmd.exe on Windows (single
 * quotes are plain characters there), /bin/sh elsewhere. `platform` is a parameter so
 * both rules are unit tested.
 */
export function isSafeCommandValue(
  value: unknown,
  platform: string = process.platform,
): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (
    UNSAFE_COMMAND_VALUE.test(value) ||
    UNSAFE_SUBSTITUTION.test(value) ||
    value.includes("&&") ||
    value.includes("||")
  ) {
    return false;
  }
  if (platform !== "win32" && HOLDS_DOLLAR.test(value) && value.includes("'")) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 32) {
      return false;
    }
  }
  return true;
}

/**
 * Returns the value as a command argument: as it is when it only holds plain
 * characters, quoted otherwise. Throws on an unsafe value.
 */
export function quoteCommandValue(
  value: string,
  platform: string = process.platform,
): string {
  if (!isSafeCommandValue(value, platform)) {
    throw new Error(
      `Value not allowed in a backpromote command: ${JSON.stringify(value)}`,
    );
  }
  if (PLAIN_COMMAND_VALUE.test(value)) {
    return value;
  }
  if (platform !== "win32" && HOLDS_DOLLAR.test(value)) {
    return `'${value}'`;
  }
  return `"${value}"`;
}

/**
 * The only commands the panel hands to sfdx-hardis.
 */
export function isAllowedBackpromoteCommand(command: unknown): boolean {
  if (typeof command !== "string") {
    return false;
  }
  if (
    command !== BACKPROMOTE_COMMAND &&
    !command.startsWith(BACKPROMOTE_COMMAND + " ")
  ) {
    return false;
  }
  return (
    !command.includes("&&") &&
    !command.includes("||") &&
    !command.includes("\n") &&
    !command.includes("\r")
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function normalizeLeftOut(value: unknown): BackpromoteLeftOutItem[] {
  return asArray(value)
    .filter((entry: any) => entry && typeof entry.key === "string")
    .map((entry: any) => ({
      key: entry.key,
      reason: ["excluded", "keptOrg", "conflictPending", "noOverwrite"].includes(
        entry.reason,
      )
        ? entry.reason
        : "excluded",
      ...(typeof entry.commit === "string" && entry.commit
        ? { commit: entry.commit }
        : {}),
    }));
}

/**
 * Checks the shape of a plan document and fills the missing arrays, so the panel
 * never crashes on a partial plan. Returns null when it is not a version 3 plan.
 */
export function normalizeBackpromotePlan(raw: any): BackpromotePlan | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.version !== BACKPROMOTE_PLAN_VERSION ||
    !BACKPROMOTE_STATUSES.includes(raw.status)
  ) {
    return null;
  }
  const entry = (item: any) => {
    const parsed = parseMetadataKey(item?.key) || { type: "", name: "" };
    return {
      key: String(item.key),
      type: String(item?.type || parsed.type),
      name: String(item?.name || parsed.name),
    };
  };
  const targetOrg = raw.targetOrg || {};
  const branch = raw.backpromoteBranch || {};
  const checkout = raw.checkout || {};
  const scan = raw.scan || {};
  return {
    version: raw.version,
    runId: String(raw.runId || ""),
    mode: String(raw.mode || "plan"),
    status: raw.status,
    message: asStringOrNull(raw.message),
    targetOrg: {
      alias: asStringOrNull(targetOrg.alias),
      username: String(targetOrg.username || ""),
      instanceUrl: String(targetOrg.instanceUrl || ""),
      orgId: String(targetOrg.orgId || ""),
      sandboxName: String(targetOrg.sandboxName || ""),
      orgType: String(targetOrg.orgType || ""),
      tracksSource: targetOrg.tracksSource === true,
      refusal:
        targetOrg.refusal === "production" || targetOrg.refusal === "majorOrg"
          ? targetOrg.refusal
          : null,
    },
    parentBranch: String(raw.parentBranch || ""),
    allowedParentBranches: asStringArray(raw.allowedParentBranches),
    gitRoot: String(raw.gitRoot || ""),
    backpromoteBranch: {
      name: String(branch.name || ""),
      existsOnOrigin: branch.existsOnOrigin === true,
      head: asStringOrNull(branch.head),
      pendingMerges: asStringArray(branch.pendingMerges),
    },
    checkout: {
      originalBranch: String(checkout.originalBranch || ""),
      currentBranch: String(checkout.currentBranch || ""),
      clean: checkout.clean !== false,
      dirtyFiles: asStringArray(checkout.dirtyFiles),
      stashed: checkout.stashed === true,
      stashMessage: asStringOrNull(checkout.stashMessage),
      onBackpromoteBranch: checkout.onBackpromoteBranch === true,
    },
    pullRequests: asArray(raw.pullRequests)
      .filter((pr: any) => pr && typeof pr === "object")
      .map((pr: any) => ({
        number: Number.isInteger(pr.number) ? pr.number : 0,
        title: String(pr.title || ""),
        author: String(pr.author || ""),
        mergeDate: String(pr.mergeDate || ""),
        sourceBranch: String(pr.sourceBranch || ""),
        commit: String(pr.commit || ""),
        webUrl: String(pr.webUrl || ""),
        itemCount: Number.isFinite(pr.itemCount) ? Number(pr.itemCount) : 0,
        actionCount: Number.isFinite(pr.actionCount)
          ? Number(pr.actionCount)
          : 0,
        backpromote:
          pr.backpromote && typeof pr.backpromote === "object"
            ? {
                date: String(pr.backpromote.date || ""),
                user: String(pr.backpromote.user || ""),
                status:
                  pr.backpromote.status === "partial" ? "partial" : "complete",
                leftOut: normalizeLeftOut(pr.backpromote.leftOut),
              }
            : null,
        beforeRefresh: pr.beforeRefresh === true,
        beforeLastBackpromote: pr.beforeLastBackpromote === true,
        selected: pr.selected === true,
        inWindow: pr.inWindow === true,
        scanned: pr.scanned === true,
      })),
    scan: {
      read: Number.isFinite(scan.read) ? Number(scan.read) : 0,
      limit: Number.isFinite(scan.limit)
        ? Number(scan.limit)
        : BACKPROMOTE_SCAN_PAGE,
      found: scan.found === true,
      hasMore: scan.hasMore === true,
    },
    window:
      raw.window && typeof raw.window === "object"
        ? {
            fromCommit: String(raw.window.fromCommit || ""),
            toCommit: String(raw.window.toCommit || ""),
            startPullRequest: Number.isInteger(raw.window.startPullRequest)
              ? raw.window.startPullRequest
              : null,
          }
        : null,
    items: asArray(raw.items)
      .filter((item: any) => typeof item?.key === "string")
      .map((item: any) => ({
        ...entry(item),
        files: asStringArray(item.files),
        pullRequests: asNumberArray(item.pullRequests),
        excludedLastTime: item.excludedLastTime === true,
        noOverwrite: item.noOverwrite === true,
      })),
    deletions: asArray(raw.deletions)
      .filter((deletion: any) => typeof deletion?.key === "string")
      .map(entry),
    actions: asArray(raw.actions)
      .filter((action: any) => typeof action?.id === "string")
      .map((action: any) => ({
        id: action.id,
        label: String(action.label || action.id),
        type: String(action.type || ""),
        phase: action.phase === "pre" ? "pre" : "post",
        context: String(action.context || "all"),
        pullRequest: Number.isInteger(action.pullRequest)
          ? action.pullRequest
          : 0,
        alreadyRunOn: asStringOrNull(action.alreadyRunOn),
        manual: action.manual === true || action.type === "manual",
        customUsername: asStringOrNull(action.customUsername),
        runnable: action.runnable !== false,
        runOnlyOnceByOrg: action.runOnlyOnceByOrg !== false,
      })),
    comparison: asArray(raw.comparison)
      .filter(
        (comparison: any) =>
          typeof comparison?.file === "string" && comparison.file !== "",
      )
      .map((comparison: any) => ({
        file: comparison.file,
        item: String(comparison.item || ""),
        status: [
          "same",
          "different",
          "missingInOrg",
          "pendingInOrg",
          "notCompared",
        ].includes(comparison.status)
          ? comparison.status
          : "notCompared",
        versions: {
          base: asStringOrNull(comparison.versions?.base),
          sandbox: asStringOrNull(comparison.versions?.sandbox),
          parentHead: asStringOrNull(comparison.versions?.parentHead),
        },
        diffLines: Number.isFinite(comparison.diffLines)
          ? Number(comparison.diffLines)
          : 0,
        pullRequests: asNumberArray(comparison.pullRequests),
        decision: BACKPROMOTE_DIFF_CHOICES.includes(comparison.decision)
          ? comparison.decision
          : null,
        prepared: comparison.prepared === true,
        markersRemaining: Number.isFinite(comparison.markersRemaining)
          ? Number(comparison.markersRemaining)
          : 0,
        conflictPending: comparison.conflictPending === true,
        threeWay: comparison.threeWay === true,
      })),
    checks: asArray(raw.checks).map((check: any) => ({
      id: String(check?.id || ""),
      ok: check?.ok === true,
      message: String(check?.message || ""),
      details: asStringArray(check?.details),
    })),
    promptFile: asStringOrNull(raw.promptFile),
    runCommand: asStringOrNull(raw.runCommand),
    result:
      raw.result && typeof raw.result === "object"
        ? {
            deployed: Number(raw.result.deployed) || 0,
            deleted: Number(raw.result.deleted) || 0,
            excluded: normalizeLeftOut(raw.result.excluded),
            actions: {
              run: asStringArray(raw.result.actions?.run),
              skipped: asStringArray(raw.result.actions?.skipped),
              failed: asStringArray(raw.result.actions?.failed),
              pending: asStringArray(raw.result.actions?.pending),
            },
            conflictPending: asStringArray(raw.result.conflictPending),
            commentedPullRequests: asNumberArray(
              raw.result.commentedPullRequests,
            ),
            pushed: raw.result.pushed === true,
            pushRejected: raw.result.pushRejected === true,
            deployReport: asStringOrNull(raw.result.deployReport),
            orgUrl: asStringOrNull(raw.result.orgUrl),
          }
        : null,
  };
}

/**
 * The plan document of a `--json` answer: the result of a successful run, or the `data` of the
 * error sfdx-hardis raises with the plan attached (conflictsRemaining, refused, deployFailed...).
 */
export function extractPlanDocument(result: any): BackpromotePlan | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  for (const candidate of [result.result, result.data, result.result?.data]) {
    const plan = normalizeBackpromotePlan(candidate);
    if (plan) {
      return plan;
    }
  }
  return null;
}

/** True when the plan holds the check sfdx-hardis makes on the git provider token, failed */
export function isGitProviderMissing(plan: BackpromotePlan | null): boolean {
  return !!plan?.checks.some(
    (check) => check.id === "gitProvider" && check.ok === false,
  );
}

// ---------------------------------------------------------------------------
// Items and comparison
// ---------------------------------------------------------------------------

const NO_COMPARISONS: BackpromoteComparison[] = [];
// A plan is never mutated (every answer of sfdx-hardis is a new object): its
// comparisons are grouped by item once, the first time a line asks for them
const comparisonsByPlan = new WeakMap<
  BackpromotePlan,
  Map<string, BackpromoteComparison[]>
>();

/** The comparison entries of every file of an item, grouped once per plan */
export function comparisonsByItem(
  plan: BackpromotePlan,
): Map<string, BackpromoteComparison[]> {
  let byItem = comparisonsByPlan.get(plan);
  if (!byItem) {
    byItem = new Map();
    for (const comparison of plan.comparison) {
      const entries = byItem.get(comparison.item);
      if (entries) {
        entries.push(comparison);
      } else {
        byItem.set(comparison.item, [comparison]);
      }
    }
    comparisonsByPlan.set(plan, byItem);
  }
  return byItem;
}

export function isDifferingComparison(
  comparison: BackpromoteComparison,
): boolean {
  return (
    comparison.status === "different" || comparison.status === "pendingInOrg"
  );
}

/** The comparison entries of an item's files whose sandbox version differs */
export function differingComparisons(
  plan: BackpromotePlan,
  itemKey: string,
): BackpromoteComparison[] {
  return (comparisonsByItem(plan).get(itemKey) || NO_COMPARISONS).filter(
    isDifferingComparison,
  );
}

export interface BackpromoteItemState {
  key: string;
  /** Worst state of the files of the item */
  status: BackpromoteComparisonStatus | "noComparison";
  pendingInOrg: boolean;
  /** The item has a file whose sandbox version differs: a decision is offered */
  differs: boolean;
  decision: BackpromoteDiffChoice;
  prepared: boolean;
  markersRemaining: number;
  threeWay: boolean;
  diffLines: number;
  files: string[];
  comparisons: BackpromoteComparison[];
}

/**
 * What one line of the What block shows for an item: the state of its files in the sandbox,
 * the decision taken, and where its manual merge stands. `markers` holds the marker counts the
 * extension read after each save of a prepared file, which win over the counts of the plan.
 */
export function computeItemState(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
  itemKey: string,
  markers: Record<string, number> = {},
): BackpromoteItemState {
  const comparisons = comparisonsByItem(plan).get(itemKey) || NO_COMPARISONS;
  const differing = comparisons.filter(isDifferingComparison);
  const priority: Array<BackpromoteComparisonStatus> = [
    "pendingInOrg",
    "different",
    "notCompared",
    "missingInOrg",
    "same",
  ];
  let status: BackpromoteItemState["status"] = "noComparison";
  for (const candidate of priority) {
    if (comparisons.some((comparison) => comparison.status === candidate)) {
      status = candidate;
      break;
    }
  }
  const decision = BACKPROMOTE_DIFF_CHOICES.includes(
    selection.diffDecisions[itemKey],
  )
    ? selection.diffDecisions[itemKey]
    : "git";
  const prepared = differing.some((comparison) => comparison.prepared);
  const markersRemaining = differing.reduce(
    (total, comparison) =>
      total +
      (comparison.prepared
        ? typeof markers[comparison.file] === "number"
          ? markers[comparison.file]
          : comparison.markersRemaining
        : 0),
    0,
  );
  return {
    key: itemKey,
    status,
    pendingInOrg: comparisons.some(
      (comparison) => comparison.status === "pendingInOrg",
    ),
    differs: differing.length > 0,
    decision,
    prepared,
    markersRemaining,
    threeWay: differing.some((comparison) => comparison.threeWay),
    diffLines: differing.reduce(
      (total, comparison) => total + comparison.diffLines,
      0,
    ),
    files: comparisons.map((comparison) => comparison.file),
    comparisons,
  };
}

/**
 * Default selection of a freshly loaded plan: every item deployed (the parent branch version
 * overwrites a differing sandbox version), every deletion run, every action that can run ticked.
 */
export function buildDefaultSelection(
  plan: BackpromotePlan,
): BackpromoteSelection {
  const diffDecisions: Record<string, BackpromoteDiffChoice> = {};
  for (const item of plan.items) {
    const differing = differingComparisons(plan, item.key);
    if (differing.length > 0) {
      // A decision already applied by sfdx-hardis (a prepared merge) is kept
      const applied = differing.find((comparison) => comparison.decision);
      diffDecisions[item.key] = applied?.decision || "git";
    }
  }
  return {
    excludedItems: plan.items
      .filter((item) => item.noOverwrite)
      .map((item) => item.key),
    excludedDeletions: [],
    actions: plan.actions
      .filter((action) => isActionRunnable(action))
      .map((action) => action.id),
    diffDecisions,
  };
}

/** An action the panel offers to run: not already run in this sandbox (unless it runs every time), and runnable from here */
export function isActionRunnable(action: BackpromoteAction): boolean {
  if (!action.runnable) {
    return false;
  }
  return action.alreadyRunOn === null || !action.runOnlyOnceByOrg;
}

/**
 * Keeps from a selection received from the webview only what exists in the plan,
 * in plan order and without duplicates. Items held back by package-no-overwrite.xml
 * stay excluded whatever the webview says.
 */
export function normalizeSelection(
  plan: BackpromotePlan,
  raw: any,
): BackpromoteSelection {
  const pick = (value: unknown, known: string[]): string[] => {
    const wanted = new Set(asStringArray(value));
    return known.filter((entry) => wanted.has(entry));
  };
  const diffDecisions: Record<string, BackpromoteDiffChoice> = {};
  for (const item of plan.items) {
    if (differingComparisons(plan, item.key).length === 0) {
      continue;
    }
    const choice = raw?.diffDecisions?.[item.key];
    diffDecisions[item.key] = BACKPROMOTE_DIFF_CHOICES.includes(choice)
      ? choice
      : "git";
  }
  const excludedItems = new Set(
    pick(
      raw?.excludedItems,
      plan.items.map((item) => item.key),
    ),
  );
  return {
    excludedItems: plan.items
      .filter((item) => item.noOverwrite || excludedItems.has(item.key))
      .map((item) => item.key),
    excludedDeletions: pick(
      raw?.excludedDeletions,
      plan.deletions.map((deletion) => deletion.key),
    ),
    actions: pick(
      raw?.actions,
      plan.actions
        .filter((action) => isActionRunnable(action))
        .map((action) => action.id),
    ),
    diffDecisions,
  };
}

// ---------------------------------------------------------------------------
// Summary and commands
// ---------------------------------------------------------------------------

/**
 * Counters and blockers of the panel for a selection.
 */
export function computeSelectionSummary(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
  markers: Record<string, number> = {},
): BackpromoteSelectionSummary {
  const excluded = new Set(selection.excludedItems);
  const excludedDeletions = new Set(selection.excludedDeletions);
  const selectedActions = new Set(selection.actions);
  const tickedItems = plan.items.filter((item) => !excluded.has(item.key));
  const states = tickedItems.map((item) =>
    computeItemState(plan, selection, item.key, markers),
  );
  const keptOrg = states.filter(
    (state) => state.differs && state.decision === "org",
  );
  const merged = states.filter(
    (state) => state.differs && state.decision === "merge",
  );
  const markersOf = (comparison: BackpromoteComparison): number =>
    typeof markers[comparison.file] === "number"
      ? markers[comparison.file]
      : comparison.markersRemaining;
  const markersLeft: BackpromoteSelectionSummary["markersLeft"] = [];
  for (const state of merged) {
    for (const comparison of state.comparisons) {
      if (
        comparison.status !== "different" &&
        comparison.status !== "pendingInOrg"
      ) {
        continue;
      }
      // Not prepared yet: the merge editor did not open, the file is not solved
      const count = comparison.prepared ? markersOf(comparison) : 1;
      if (count > 0) {
        markersLeft.push({
          file: comparison.file,
          item: state.key,
          markersRemaining: count,
          merging: true,
        });
      }
    }
  }
  // A prepared file whose item was switched back to Overwrite or Keep org version, or
  // unticked, still sits in the checkout with its markers: sfdx-hardis refuses the run
  const listed = new Set(markersLeft.map((entry) => entry.file));
  for (const comparison of plan.comparison) {
    if (!comparison.prepared || listed.has(comparison.file)) {
      continue;
    }
    const count = markersOf(comparison);
    if (count > 0) {
      markersLeft.push({
        file: comparison.file,
        item: comparison.item,
        markersRemaining: count,
        merging: false,
      });
    }
  }
  const itemsToDeployCount = tickedItems.length - keptOrg.length;
  const deletionsToDeleteCount = plan.deletions.filter(
    (deletion) => !excludedDeletions.has(deletion.key),
  ).length;
  const actionsToRun = plan.actions.filter(
    (action) => isActionRunnable(action) && selectedActions.has(action.id),
  );
  const blockers: BackpromoteBlocker[] = [];
  if (plan.status === "blocked" || plan.status === "refused") {
    blockers.push("notReady");
  } else if (!plan.window) {
    blockers.push("noWindow");
  } else if (
    itemsToDeployCount === 0 &&
    deletionsToDeleteCount === 0 &&
    actionsToRun.length === 0
  ) {
    blockers.push("nothingToDo");
  }
  if (markersLeft.some((entry) => entry.merging)) {
    blockers.push("conflictMarkers");
  }
  if (markersLeft.some((entry) => !entry.merging)) {
    blockers.push("preparedMarkers");
  }
  return {
    itemsToDeployCount,
    deletionsToDeleteCount,
    actionsToRunCount: actionsToRun.length,
    manualActionsCount: actionsToRun.filter((action) => action.manual).length,
    keptOrgCount: keptOrg.length,
    mergedFilesCount: merged.reduce(
      (total, state) =>
        total +
        state.comparisons.filter(
          (comparison) =>
            comparison.status === "different" ||
            comparison.status === "pendingInOrg",
        ).length,
      0,
    ),
    markersLeft,
    blockers,
    canRun: blockers.length === 0,
  };
}

export interface BackpromoteCommandTarget {
  targetOrg: string;
  parentBranch: string;
  fromPullRequest?: number | null;
  runId?: string | null;
}

function targetParts(target: BackpromoteCommandTarget): string[] {
  const parts: string[] = [];
  if (target.runId) {
    parts.push(`--run-id ${quoteCommandValue(target.runId)}`);
  }
  parts.push(`--target-org ${quoteCommandValue(target.targetOrg)}`);
  parts.push(`--parent-branch ${quoteCommandValue(target.parentBranch)}`);
  if (target.fromPullRequest && target.fromPullRequest > 0) {
    parts.push(`--from-pull-request ${Math.trunc(target.fromPullRequest)}`);
  }
  return parts;
}

function dirtyTreeParts(choice?: BackpromoteDirtyTreeChoice | null): string[] {
  if (!choice) {
    return [];
  }
  const parts = [`--dirty-tree ${choice.action === "commit" ? "commit" : "stash"}`];
  if (choice.action === "commit" && choice.message) {
    parts.push(`--commit-message ${quoteCommandValue(choice.message)}`);
  }
  return parts;
}

/**
 * Read-only plan command: the org and the parent branch the user chose, the start Pull
 * Request when the user picked one, the run id of the previous plan so sfdx-hardis reuses its
 * cache, and a wider scan when the user asked to see earlier Pull Requests.
 */
export function buildPlanCommand(
  target: BackpromoteCommandTarget,
  options: { scanLimit?: number | null } = {},
): string {
  return [
    BACKPROMOTE_COMMAND,
    "--plan",
    ...targetParts(target),
    ...scanLimitParts(options.scanLimit),
    "--json",
  ].join(" ");
}

/**
 * The command that writes the merged files (with markers) of the items the user wants to
 * merge by hand, and switches the checkout to the backpromote branch.
 */
export function buildPrepareCommand(
  plan: BackpromotePlan,
  target: BackpromoteCommandTarget,
  itemKeys: string[],
  dirtyTree?: BackpromoteDirtyTreeChoice | null,
): string {
  const parts = [BACKPROMOTE_COMMAND, "--prepare", ...targetParts(target)];
  const files = new Set<string>();
  for (const key of itemKeys) {
    for (const comparison of differingComparisons(plan, key)) {
      files.add(comparison.file);
    }
  }
  if (files.size === 0) {
    throw new Error("No file to merge for the given items");
  }
  for (const file of files) {
    parts.push(`--on-diff ${quoteCommandValue(`${file}=merge`)}`);
  }
  parts.push(...dirtyTreeParts(dirtyTree));
  parts.push("--json");
  return parts.join(" ");
}

/**
 * The exact run command for a selection. Throws when a value of the plan cannot be put
 * safely in a command.
 */
export function buildBackpromoteCommand(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
  target: BackpromoteCommandTarget,
  dirtyTree?: BackpromoteDirtyTreeChoice | null,
): string {
  const parts = [BACKPROMOTE_COMMAND, "--auto", ...targetParts(target)];
  for (const key of selection.excludedItems) {
    parts.push(`--exclude-metadata ${quoteCommandValue(key)}`);
  }
  if (
    plan.deletions.length > 0 &&
    plan.deletions.every((deletion) =>
      selection.excludedDeletions.includes(deletion.key),
    )
  ) {
    parts.push("--skip-destructive");
  } else {
    for (const key of selection.excludedDeletions) {
      parts.push(`--exclude-metadata ${quoteCommandValue(key)}`);
    }
  }
  const excluded = new Set(selection.excludedItems);
  for (const [key, choice] of Object.entries(selection.diffDecisions)) {
    if (choice === "git" || excluded.has(key)) {
      continue;
    }
    for (const comparison of differingComparisons(plan, key)) {
      parts.push(`--on-diff ${quoteCommandValue(`${comparison.file}=${choice}`)}`);
    }
  }
  const runnableActions = plan.actions.filter((action) =>
    isActionRunnable(action),
  );
  if (runnableActions.length > 0) {
    parts.push(
      selection.actions.length > 0
        ? `--actions ${quoteCommandValue(selection.actions.join(","))}`
        : "--skip-actions",
    );
  }
  parts.push(...dirtyTreeParts(dirtyTree));
  parts.push("--json");
  return parts.join(" ");
}

function scanLimitParts(scanLimit: number | null | undefined): string[] {
  return scanLimit && scanLimit > BACKPROMOTE_SCAN_PAGE
    ? [`--scan-limit ${Math.trunc(scanLimit)}`]
    : [];
}

/**
 * Records that manual actions were done in the sandbox. The scan limit of the plan travels
 * too: sfdx-hardis only records an action whose Pull Request is within its scan.
 */
export function buildConfirmActionCommand(
  target: BackpromoteCommandTarget,
  actionIds: string[],
  options: { scanLimit?: number | null } = {},
): string {
  const parts = [BACKPROMOTE_COMMAND];
  for (const actionId of actionIds) {
    parts.push(`--confirm-action ${quoteCommandValue(actionId)}`);
  }
  parts.push(
    ...targetParts(target),
    ...scanLimitParts(options.scanLimit),
    "--json",
  );
  return parts.join(" ");
}

/** Deletes the backpromote branch and its pending manual merges */
export function buildResetCommand(target: BackpromoteCommandTarget): string {
  return [
    BACKPROMOTE_COMMAND,
    "--reset",
    "--auto",
    ...targetParts({ ...target, runId: null, fromPullRequest: null }),
    "--json",
  ].join(" ");
}

/**
 * Summary, command and blockers sent to the panel after every selection change.
 */
export function buildSelectionPayload(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
  target: BackpromoteCommandTarget,
  markers: Record<string, number> = {},
): BackpromoteSelectionPayload {
  const summary = computeSelectionSummary(plan, selection, markers);
  let command: string | null = null;
  let commandError: string | null = null;
  try {
    command = buildBackpromoteCommand(plan, selection, target);
  } catch (error: any) {
    commandError = String(error?.message || error);
  }
  if (commandError) {
    summary.blockers.push("invalidCommand");
    summary.canRun = false;
  }
  return { summary, command, commandError };
}

// ---------------------------------------------------------------------------
// Setup: orgs and parent branches
// ---------------------------------------------------------------------------

/** An authenticated org the panel offers as target */
export interface BackpromoteOrgChoice {
  username: string;
  /** Alias when there is one, else the username */
  label: string;
  isDefault: boolean;
  /** Why the org cannot be a target, null when it can */
  disabledReason: "production" | "majorOrg" | "expired" | null;
  /** The major branch the org belongs to, for the label of a disabled org */
  majorBranch: string | null;
}

export interface BackpromoteSetup {
  currentBranch: string;
  orgs: BackpromoteOrgChoice[];
  /** developmentBranch first, then availableTargetBranches */
  allowedParentBranches: string[];
  defaultParentBranch: string | null;
}

/**
 * The sandbox a Salesforce username belongs to (user@company.com.dev1 gives dev1), mirror of
 * the sfdx-hardis rule. Null for a production username.
 */
function parseSandboxOfUsername(
  username: string,
): { base: string; sandbox: string } | null {
  const value = (username || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  const parts = value.substring(at + 1).split(".");
  if (parts.length < 3) {
    return null;
  }
  return {
    base: parts.slice(0, -1).join("."),
    sandbox: parts[parts.length - 1],
  };
}

function normalizeUrl(url: string | undefined | null): string {
  return (url || "").trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * The type listAllOrgs computes; mirrored here for an org given without it.
 * A Developer Edition org is `other`: selectable, only a production org is refused.
 */
function orgTypeOf(org: {
  instanceUrl?: string;
  isScratch?: boolean;
  isSandbox?: boolean;
  orgType?: string;
}): string {
  if (org.orgType) {
    return org.orgType;
  }
  const url = (org.instanceUrl || "").toLowerCase();
  if (org.isScratch) {
    return "scratch";
  }
  if (org.isSandbox || url.includes(".sandbox")) {
    return "sandbox";
  }
  return url.includes("dev-ed") || url.includes("test") ? "other" : "production";
}

/**
 * The orgs of `sf org list`, the default org first: developer sandboxes, scratch orgs and
 * Developer Edition orgs are selectable, the orgs of the major branches (matched on username,
 * on the sandbox of the username, or on the instance URL) and the production orgs are listed
 * disabled with the reason.
 */
export function buildOrgChoices(
  orgs: Array<{
    username?: string;
    alias?: string;
    instanceUrl?: string;
    isDefaultUsername?: boolean;
    isScratch?: boolean;
    isSandbox?: boolean;
    orgType?: string;
    status?: string;
  }>,
  majorOrgs: Array<{
    branchName?: string;
    targetUsername?: string;
    instanceUrl?: string;
  }> = [],
): BackpromoteOrgChoice[] {
  return orgs
    .filter((org) => !!org.username && isSafeCommandValue(org.username))
    .map((org) => {
      const username = (org.username as string).toLowerCase();
      const sandbox = parseSandboxOfUsername(username);
      const instanceUrl = normalizeUrl(org.instanceUrl);
      const majorOrg = majorOrgs.find((major) => {
        const majorUsername = (major.targetUsername || "").trim().toLowerCase();
        if (majorUsername && majorUsername === username) {
          return true;
        }
        const majorSandbox = parseSandboxOfUsername(majorUsername);
        if (
          sandbox &&
          majorSandbox &&
          sandbox.base === majorSandbox.base &&
          sandbox.sandbox === majorSandbox.sandbox
        ) {
          return true;
        }
        const majorUrl = normalizeUrl(major.instanceUrl);
        return (
          majorUrl !== "" &&
          majorUrl === instanceUrl &&
          !majorUrl.includes("test.salesforce.com")
        );
      });
      let disabledReason: BackpromoteOrgChoice["disabledReason"] = null;
      if (["Expired", "Deleted"].includes(String(org.status || ""))) {
        disabledReason = "expired";
      } else if (majorOrg) {
        disabledReason = "majorOrg";
      } else if (orgTypeOf(org) === "production") {
        disabledReason = "production";
      }
      return {
        username: org.username as string,
        label: org.alias
          ? `${org.alias} (${org.username})`
          : (org.username as string),
        isDefault: org.isDefaultUsername === true,
        disabledReason,
        majorBranch: majorOrg?.branchName || null,
      };
    })
    .filter((org) => org.disabledReason !== "expired")
    .sort(
      (a, b) =>
        Number(!!a.disabledReason) - Number(!!b.disabledReason) ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.label.localeCompare(b.label),
    );
}

/** developmentBranch first, then availableTargetBranches, without duplicates: nothing else */
export function listAllowedParentBranches(config: any): string[] {
  const branches: string[] = [];
  const add = (branch: unknown) => {
    const value = typeof branch === "string" ? branch.trim() : "";
    if (value && isSafeCommandValue(value) && !branches.includes(value)) {
      branches.push(value);
    }
  };
  add(config?.developmentBranch);
  for (const branch of asArray(config?.availableTargetBranches)) {
    add(branch);
  }
  return branches;
}

// ---------------------------------------------------------------------------
// Command results
// ---------------------------------------------------------------------------

/**
 * Older sfdx-hardis versions print a log line (`WS Client started`) before the JSON
 * document of a `--json` run, which execSfdxJson cannot parse. Reads the document
 * from the first line that is exactly `{` and merges it into the result.
 */
export function recoverJsonCommandResult(result: any): any {
  if (
    !result ||
    result.unableToParseJson !== true ||
    typeof result.stdout !== "string"
  ) {
    return result;
  }
  const lines = result.stdout.split(/\r?\n/);
  const start = lines.findIndex((line: string) => line.trimEnd() === "{");
  if (start === -1) {
    return result;
  }
  try {
    const parsed = JSON.parse(lines.slice(start).join("\n"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...result, ...parsed, unableToParseJson: false };
    }
  } catch {
    // Not a JSON document after all
  }
  return result;
}

function collectResultText(result: any): string {
  if (!result) {
    return "";
  }
  return [
    result.name,
    result.message,
    result.stdout,
    result.stderr,
    result.errorMessage,
    result.error?.message,
  ]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join("\n");
}

/**
 * True when the installed sfdx-hardis does not know the flags of the panel yet, or answers
 * an older plan: the CLI then answers with a "Nonexistent flag" parsing error, or a plan
 * of another version.
 */
export function isCliTooOldForBackpromotePanel(result: any): boolean {
  const text = collectResultText(result);
  if (
    /NonexistentFlagsError|Nonexistent flags?:?\s*--|Unexpected argument:?\s*--(plan|auto|prepare|parent-branch|run-id)/i.test(
      text,
    )
  ) {
    return true;
  }
  const version = result?.result?.version ?? result?.result?.planVersion;
  return typeof version === "number" && version < BACKPROMOTE_PLAN_VERSION;
}

/**
 * Human readable error of a failed `--json` command.
 */
export function getBackpromoteErrorMessage(result: any): string {
  if (!result) {
    return "";
  }
  if (typeof result.message === "string" && result.message.trim()) {
    return stripAnsiCodes(result.message.trim());
  }
  for (const stream of [result.stderr, result.stdout]) {
    const text = String(stream || "").trim();
    if (!text.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.message === "string" && parsed.message.trim()) {
        return stripAnsiCodes(parsed.message.trim());
      }
    } catch {
      // Not a JSON payload
    }
  }
  const fallback = [result.stderr, result.errorMessage, result.error?.message]
    .map((part) => stripAnsiCodes(String(part || "")).trim())
    .find((part) => part.length > 0);
  return fallback ? fallback.split(/\r?\n/).slice(0, 8).join("\n") : "";
}

/**
 * Short name of the target sandbox for the panel: the `sandboxName` of the plan, else the
 * short host of its instance URL (the label of the status bar badge), else its username.
 */
export function getTargetOrgDisplayName(
  targetOrg: Partial<BackpromotePlan["targetOrg"]> | null | undefined,
): string {
  if (!targetOrg) {
    return "";
  }
  if (targetOrg.sandboxName) {
    return targetOrg.sandboxName;
  }
  const host = shortenOrgHost(targetOrg.instanceUrl || "");
  if (host && !["login", "test", "www"].includes(host)) {
    return host;
  }
  return targetOrg.alias || targetOrg.username || "";
}

// ---------------------------------------------------------------------------
// Progress file
// ---------------------------------------------------------------------------

/** One step sfdx-hardis reported in the progress file of a background command */
export interface BackpromoteProgressEvent {
  step: string;
  message: string;
  current: number | null;
  total: number | null;
  time: string | null;
}

/** What the loading state shows while the plan is computed */
export interface BackpromotePlanProgress {
  /** What sfdx-hardis is doing now */
  message: string;
  /** 0 to 100 when the current step is counted, null otherwise */
  percent: number | null;
  /** The steps done before it, oldest first, each with its last message */
  doneSteps: Array<{ key: string; message: string }>;
}

/**
 * The events of a progress file, one JSON line each. A line sfdx-hardis is still
 * writing is skipped: the next read gets it.
 */
export function parseProgressEvents(content: string): BackpromoteProgressEvent[] {
  const events: BackpromoteProgressEvent[] = [];
  for (const line of (content || "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const raw = JSON.parse(line);
      if (typeof raw?.step !== "string" || typeof raw?.message !== "string") {
        continue;
      }
      const counted =
        Number.isFinite(raw.current) &&
        Number.isFinite(raw.total) &&
        raw.total > 0;
      events.push({
        step: raw.step,
        message: raw.message,
        current: counted ? Number(raw.current) : null,
        total: counted ? Number(raw.total) : null,
        time: typeof raw.time === "string" ? raw.time : null,
      });
    } catch {
      // A line not written completely yet
    }
  }
  return events;
}

/** The last step with its percentage, and the steps done before it */
export function buildPlanProgress(
  events: BackpromoteProgressEvent[],
): BackpromotePlanProgress | null {
  if (events.length === 0) {
    return null;
  }
  const last = events[events.length - 1];
  const lastMessageByStep = new Map<string, string>();
  const stepOrder: string[] = [];
  for (const event of events) {
    if (!lastMessageByStep.has(event.step)) {
      stepOrder.push(event.step);
    }
    lastMessageByStep.set(event.step, event.message);
  }
  const percent =
    last.current !== null && last.total
      ? Math.max(0, Math.min(100, Math.round((last.current / last.total) * 100)))
      : null;
  return {
    message: last.message,
    percent,
    doneSteps: stepOrder
      .filter((step) => step !== last.step)
      .map((step) => ({ key: step, message: lastMessageByStep.get(step) as string })),
  };
}
