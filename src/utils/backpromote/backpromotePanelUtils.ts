import { stripAnsiCodes } from "../ansiColors";

/**
 * Pure logic of the Backpromote panel (vscode-sfdx-hardis.showBackpromote).
 *
 * sfdx-hardis computes a plan with `sf hardis:work:backpromote --plan --json`. The
 * panel lets the user pick the groups to bring in (first-parent commits of the parent
 * branch, with the Pull Requests they merged), the items to keep as they are in the
 * org or to merge, the deletions and the deployment actions. These helpers turn that
 * selection into the counters of the panel and into the exact command given to the
 * command runner. No VS Code API here: they are unit tested directly.
 */

export const BACKPROMOTE_COMMAND = "sf hardis:work:backpromote";

export type BackpromotePlanStatus = "ready" | "blocked" | "upToDate";
export type BackpromoteGroupStatus = "pending" | "done";
export type BackpromoteGitProviderName =
  | "github"
  | "gitlab"
  | "azure"
  | "bitbucket";

const GIT_PROVIDER_NAMES: BackpromoteGitProviderName[] = [
  "github",
  "gitlab",
  "azure",
  "bitbucket",
];

/** A developer org recorded in the backpromote comment of a Pull Request */
export interface BackpromoteOrgRecord {
  orgId: string;
  orgName: string;
  date: string;
}
export type BackpromoteOrgState =
  | "changedInOrg"
  | "deletedLocally"
  | "newToOrg"
  | "noOrgChange"
  | "unknown";

export interface BackpromotePullRequest {
  id: number;
  title: string;
  author: string;
  webUrl: string;
  sourceBranch: string;
}

export interface BackpromoteGroup {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  status: BackpromoteGroupStatus;
  /** Pending and trackable */
  selectedByDefault: boolean;
  /** False for a merge without Pull Request number: it can never be remembered */
  trackable: boolean;
  /** When this group was backpromoted to the target org, read from the Pull Request comments */
  backpromotedToThisOrg: { date: string; commit: string } | null;
  /** Every developer org recorded in the comments of its Pull Requests, the target org included */
  backpromotedTo: BackpromoteOrgRecord[];
  /** backpromotedTo without the target org (computed by normalizeBackpromotePlan) */
  backpromotedToOtherOrgs: BackpromoteOrgRecord[];
  pullRequests: BackpromotePullRequest[];
  items: string[];
  deletions: string[];
  testClasses: string[];
  actionIds: string[];
}

export interface BackpromoteItem {
  key: string;
  type: string;
  name: string;
  commits: string[];
  orgState: BackpromoteOrgState;
  localPath: string | null;
  orgPath: string | null;
  mergeable: boolean;
}

export interface BackpromoteDeletion {
  key: string;
  type: string;
  name: string;
  commits: string[];
}

export interface BackpromoteAction {
  id: string;
  label: string;
  type: string;
  when: "pre" | "post";
  commits: string[];
  pullRequestId: number;
  customUsername: string | null;
  alreadyDone: { date: string } | null;
  selectedByDefault: boolean;
}

export interface BackpromoteCheck {
  id:
    | "gitProvider"
    | "targetOrg"
    | "parentBranch"
    | "currentBranch"
    | "gitClean"
    | string;
  ok: boolean;
  message: string;
  details?: string[];
}

/**
 * Where a run works, as the CLI decides it: on the checked out branch, or on a
 * new local backpromote/<parent>/<date> branch created from the remote parent
 * branch (never on a major branch itself).
 */
export interface BackpromoteWorkingBranch {
  mode: "currentBranch" | "newBackpromoteBranch";
  /** userStoryBranch, backpromoteBranch, majorBranch, promotionBranch, retrofitBranch or notUpToDate */
  reason: string;
  /** The branch the run brings the user back to */
  returnBranch: string | null;
}

export interface BackpromotePlan {
  planVersion: number;
  status: BackpromotePlanStatus;
  currentBranch: string;
  parentBranch: string;
  parentBranchChoices: string[];
  /** Null with an older sfdx-hardis, or when the plan stopped before knowing */
  workingBranch: BackpromoteWorkingBranch | null;
  targetOrg: {
    username: string;
    instanceUrl: string;
    orgType: "sandbox" | "scratch" | "production" | string;
    /** Salesforce Organization Id: a refreshed sandbox gets a new one */
    orgId: string;
    /** Short name, ex: mycompany--dev-sam */
    orgName: string;
  };
  /** The first check is gitProvider: when it fails nothing else is computed */
  checks: BackpromoteCheck[];
  gitProvider: { name: BackpromoteGitProviderName | null };
  /** Where the backpromote history lives: "pullRequestComments" */
  stateStorage: string;
  /** Pull Requests whose backpromote comment could not be read */
  stateReadErrors: string[];
  groups: BackpromoteGroup[];
  items: BackpromoteItem[];
  deletions: BackpromoteDeletion[];
  actions: BackpromoteAction[];
  conflictDetection: { success: boolean; errorMessage: string | null };
  reports: string[];
}

export interface BackpromotePrepareMergeFile {
  key: string;
  localPath: string;
  basePath: string | null;
  orgPath: string;
  conflictBlocks: number;
}

export interface BackpromotePrepareMergeResult {
  files: BackpromotePrepareMergeFile[];
  prompt: string;
  promptFile: string;
  nextCommand: string;
  /** The backpromote branch the merge was written on: the working tree is on it */
  backpromoteBranch: string | null;
  /** The branch the run of nextCommand brings the user back to */
  returnBranch: string | null;
}

/**
 * What the user picked in the panel. Only hashes, keys and ids that exist in the plan
 * are kept (see normalizeSelection), so a message from the webview cannot inject
 * anything into the command.
 */
export interface BackpromoteSelection {
  /** Hashes of the selected groups */
  groups: string[];
  /** `Type:Name` items not to deploy ("Keep org version", unticked rows) */
  excludedItems: string[];
  /** `Type:Name` items whose local file holds a merge prepared by the CLI */
  mergedItems: string[];
  /** `Type:Name` deletions not to run */
  excludedDeletions: string[];
  /** Ids of the deployment actions to run */
  actions: string[];
}

export interface BackpromoteSummaryItem extends BackpromoteItem {
  /** Pull Requests of the selected groups that touch the item */
  pullRequestIds: number[];
  excluded: boolean;
  merged: boolean;
  /** Conflict blocks left in the merged file, null when not known yet */
  conflictBlocks: number | null;
  /** Pending groups touching the item that are not selected */
  alsoInUnselected: Array<{
    hash: string;
    shortHash: string;
    pullRequestIds: number[];
  }>;
}

export interface BackpromoteSummaryDeletion extends BackpromoteDeletion {
  pullRequestIds: number[];
  excluded: boolean;
}

export interface BackpromoteSummaryAction extends BackpromoteAction {
  selected: boolean;
}

export type BackpromoteBlocker =
  | "notReady"
  | "noGroup"
  | "nothingToDo"
  | "conflictMarkers"
  | "invalidCommand";

export interface BackpromoteSelectionSummary {
  selectedGroupCount: number;
  pullRequestIds: number[];
  /** Short hashes of the oldest and newest selected groups */
  range: { oldest: string; newest: string } | null;
  items: BackpromoteSummaryItem[];
  itemsToDeployCount: number;
  changedInOrg: BackpromoteSummaryItem[];
  deletions: BackpromoteSummaryDeletion[];
  deletionsToDeleteCount: number;
  actions: BackpromoteSummaryAction[];
  actionsToRunCount: number;
  actionsAlreadyDoneCount: number;
  manualActionsCount: number;
  /** Selected groups already backpromoted to the target org, run again */
  alreadyInOrgSelectedCount: number;
  testClasses: string[];
  alsoInUnselectedCount: number;
  /** Merged items whose file still holds conflict markers (or not checked yet) */
  conflictKeys: string[];
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

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
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

const PLAIN_COMMAND_VALUE = /^[A-Za-z0-9_.@:/+=,-]+$/;
// Characters whose meaning differs between the shell-less spawn, bash, cmd.exe
// and PowerShell, even inside double quotes: such a value is refused, never escaped
const UNSAFE_COMMAND_VALUE = /["\\`$]/;

/**
 * A value built from the plan can go into a command when it holds no quote, no
 * backslash, no variable or command substitution, no control character and no
 * command chaining.
 */
export function isSafeCommandValue(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (
    UNSAFE_COMMAND_VALUE.test(value) ||
    value.includes("&&") ||
    value.includes("||")
  ) {
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
 * characters, double-quoted otherwise. Throws on an unsafe value.
 */
export function quoteCommandValue(value: string): string {
  if (!isSafeCommandValue(value)) {
    throw new Error(
      `Value not allowed in a backpromote command: ${JSON.stringify(value)}`,
    );
  }
  return PLAIN_COMMAND_VALUE.test(value) ? value : `"${value}"`;
}

/**
 * The only commands the panel hands to the command runner.
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

/**
 * Checks the shape of the `--plan --json` result and fills the missing arrays, so
 * the panel never crashes on a partial plan. Returns null when it is not a plan.
 */
function normalizeWorkingBranch(raw: any): BackpromoteWorkingBranch | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    !["currentBranch", "newBackpromoteBranch"].includes(raw.mode)
  ) {
    return null;
  }
  return {
    mode: raw.mode,
    reason: String(raw.reason || ""),
    returnBranch:
      typeof raw.returnBranch === "string" && raw.returnBranch
        ? raw.returnBranch
        : null,
  };
}

export function normalizeBackpromotePlan(raw: any): BackpromotePlan | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.planVersion !== "number" ||
    raw.planVersion < 1 ||
    !["ready", "blocked", "upToDate"].includes(raw.status)
  ) {
    return null;
  }
  const targetOrg = {
    username: String(raw.targetOrg?.username || ""),
    instanceUrl: String(raw.targetOrg?.instanceUrl || ""),
    orgType: String(raw.targetOrg?.orgType || ""),
    orgId: String(raw.targetOrg?.orgId || ""),
    orgName: String(raw.targetOrg?.orgName || ""),
  };
  const isTargetOrg = (record: BackpromoteOrgRecord) =>
    targetOrg.orgId
      ? record.orgId === targetOrg.orgId
      : !!targetOrg.orgName && record.orgName === targetOrg.orgName;
  return {
    ...raw,
    currentBranch: String(raw.currentBranch || ""),
    parentBranch: String(raw.parentBranch || ""),
    parentBranchChoices: asStringArray(raw.parentBranchChoices),
    workingBranch: normalizeWorkingBranch(raw.workingBranch),
    targetOrg,
    checks: asArray(raw.checks).map((check: any) => ({
      ...check,
      ok: check?.ok === true,
      message: String(check?.message || ""),
      details: asStringArray(check?.details),
    })),
    gitProvider: {
      name: GIT_PROVIDER_NAMES.includes(raw.gitProvider?.name)
        ? raw.gitProvider.name
        : null,
    },
    stateStorage: String(raw.stateStorage || ""),
    stateReadErrors: asStringArray(raw.stateReadErrors),
    groups: asArray(raw.groups)
      .filter((group: any) => typeof group?.hash === "string")
      .map((group: any) => {
        const backpromotedTo: BackpromoteOrgRecord[] = asArray(
          group.backpromotedTo,
        )
          .filter(
            (record: any) =>
              typeof record?.orgId === "string" ||
              typeof record?.orgName === "string",
          )
          .map((record: any) => ({
            orgId: String(record.orgId || ""),
            orgName: String(record.orgName || record.orgId || ""),
            date: String(record.date || ""),
          }));
        const thisOrg = group.backpromotedToThisOrg;
        return {
          ...group,
          shortHash: String(group.shortHash || group.hash.slice(0, 7)),
          status: group.status === "done" ? "done" : "pending",
          selectedByDefault: group.selectedByDefault === true,
          trackable: group.trackable !== false,
          backpromotedToThisOrg:
            thisOrg && typeof thisOrg === "object"
              ? {
                  date: String(thisOrg.date || ""),
                  commit: String(thisOrg.commit || ""),
                }
              : null,
          backpromotedTo,
          backpromotedToOtherOrgs: backpromotedTo.filter(
            (record) => !isTargetOrg(record),
          ),
          pullRequests: asArray(group.pullRequests),
          items: asStringArray(group.items),
          deletions: asStringArray(group.deletions),
          testClasses: asStringArray(group.testClasses),
          actionIds: asStringArray(group.actionIds),
        };
      }),
    items: asArray(raw.items)
      .filter((item: any) => typeof item?.key === "string")
      .map((item: any) => ({
        ...item,
        commits: asStringArray(item.commits),
        mergeable: item.mergeable === true,
      })),
    deletions: asArray(raw.deletions)
      .filter((deletion: any) => typeof deletion?.key === "string")
      .map((deletion: any) => ({
        ...deletion,
        commits: asStringArray(deletion.commits),
      })),
    actions: asArray(raw.actions)
      .filter((action: any) => typeof action?.id === "string")
      .map((action: any) => ({
        ...action,
        commits: asStringArray(action.commits),
      })),
    conflictDetection: raw.conflictDetection || {
      success: true,
      errorMessage: null,
    },
    reports: asStringArray(raw.reports),
  };
}

/**
 * Checks the shape of the `--prepare-merge --json` result. Returns null when it
 * holds no file.
 */
export function normalizePrepareMergeResult(
  raw: any,
): BackpromotePrepareMergeResult | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const files = asArray(raw.files)
    .filter(
      (file: any) =>
        typeof file?.key === "string" && typeof file?.localPath === "string",
    )
    .map((file: any) => ({
      key: file.key,
      localPath: file.localPath,
      basePath: typeof file.basePath === "string" ? file.basePath : null,
      orgPath: String(file.orgPath || ""),
      conflictBlocks: Number.isFinite(file.conflictBlocks)
        ? Number(file.conflictBlocks)
        : 0,
    }));
  if (files.length === 0) {
    return null;
  }
  return {
    files,
    prompt: String(raw.prompt || ""),
    promptFile: String(raw.promptFile || ""),
    nextCommand: String(raw.nextCommand || ""),
    backpromoteBranch:
      typeof raw.backpromoteBranch === "string" && raw.backpromoteBranch
        ? raw.backpromoteBranch
        : null,
    returnBranch:
      typeof raw.returnBranch === "string" && raw.returnBranch
        ? raw.returnBranch
        : null,
  };
}

/**
 * Default selection of a freshly loaded plan: the pending groups, every item
 * deployed, every deletion run, the actions not already done.
 */
export function buildDefaultSelection(
  plan: BackpromotePlan,
): BackpromoteSelection {
  return {
    groups: plan.groups
      .filter((group) => group.selectedByDefault === true)
      .map((group) => group.hash),
    excludedItems: [],
    mergedItems: [],
    excludedDeletions: [],
    actions: plan.actions
      .filter((action) => action.selectedByDefault === true)
      .map((action) => action.id),
  };
}

/**
 * Keeps from a selection received from the webview only what exists in the plan,
 * in plan order and without duplicates.
 */
export function normalizeSelection(
  plan: BackpromotePlan,
  raw: any,
): BackpromoteSelection {
  const pick = (value: unknown, known: string[]): string[] => {
    const wanted = new Set(asStringArray(value));
    return known.filter((entry) => wanted.has(entry));
  };
  const excludedItems = pick(
    raw?.excludedItems,
    plan.items.map((item) => item.key),
  );
  const excludedSet = new Set(excludedItems);
  return {
    groups: pick(
      raw?.groups,
      plan.groups.map((group) => group.hash),
    ),
    excludedItems,
    mergedItems: pick(
      raw?.mergedItems,
      plan.items
        .filter((item) => item.mergeable && !excludedSet.has(item.key))
        .map((item) => item.key),
    ),
    excludedDeletions: pick(
      raw?.excludedDeletions,
      plan.deletions.map((deletion) => deletion.key),
    ),
    actions: pick(
      raw?.actions,
      plan.actions.map((action) => action.id),
    ),
  };
}

/**
 * Counters, rows and blockers of the panel for a selection.
 */
export function computeSelectionSummary(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
  conflictBlocksByKey: Record<string, number> = {},
): BackpromoteSelectionSummary {
  const selectedHashes = new Set(selection.groups);
  const groupByHash = new Map(plan.groups.map((group) => [group.hash, group]));
  const selectedGroups = plan.groups.filter((group) =>
    selectedHashes.has(group.hash),
  );
  const isSelected = (hash: string) => selectedHashes.has(hash);
  const pullRequestIdsOf = (hashes: string[]) =>
    uniqueSortedNumbers(
      hashes.flatMap((hash) =>
        (groupByHash.get(hash)?.pullRequests || []).map((pr) => pr.id),
      ),
    );

  const excluded = new Set(selection.excludedItems);
  const merged = new Set(selection.mergedItems);
  const items: BackpromoteSummaryItem[] = plan.items
    .filter((item) => item.commits.some(isSelected))
    .map((item) => {
      const isExcluded = excluded.has(item.key);
      const isMerged = !isExcluded && item.mergeable && merged.has(item.key);
      const knownBlocks = conflictBlocksByKey[item.key];
      return {
        ...item,
        pullRequestIds: pullRequestIdsOf(item.commits.filter(isSelected)),
        excluded: isExcluded,
        merged: isMerged,
        conflictBlocks:
          isMerged && typeof knownBlocks === "number" ? knownBlocks : null,
        alsoInUnselected: item.commits
          .filter((hash) => !isSelected(hash))
          .map((hash) => groupByHash.get(hash))
          .filter(
            (group): group is BackpromoteGroup =>
              !!group && group.status !== "done",
          )
          .map((group) => ({
            hash: group.hash,
            shortHash: group.shortHash,
            pullRequestIds: uniqueSortedNumbers(
              group.pullRequests.map((pr) => pr.id),
            ),
          })),
      };
    });

  const excludedDeletions = new Set(selection.excludedDeletions);
  const deletions: BackpromoteSummaryDeletion[] = plan.deletions
    .filter((deletion) => deletion.commits.some(isSelected))
    .map((deletion) => ({
      ...deletion,
      pullRequestIds: pullRequestIdsOf(deletion.commits.filter(isSelected)),
      excluded: excludedDeletions.has(deletion.key),
    }));

  const selectedActions = new Set(selection.actions);
  const actions: BackpromoteSummaryAction[] = plan.actions
    .filter((action) => action.commits.some(isSelected))
    .map((action) => ({ ...action, selected: selectedActions.has(action.id) }));

  const itemsToDeployCount = items.filter((item) => !item.excluded).length;
  const deletionsToDeleteCount = deletions.filter(
    (deletion) => !deletion.excluded,
  ).length;
  const actionsToRun = actions.filter((action) => action.selected);
  const conflictKeys = items
    .filter(
      (item) =>
        item.merged && (item.conflictBlocks === null || item.conflictBlocks > 0),
    )
    .map((item) => item.key);

  const blockers: BackpromoteBlocker[] = [];
  if (plan.status !== "ready") {
    blockers.push("notReady");
  }
  if (selectedGroups.length === 0) {
    blockers.push("noGroup");
  } else if (
    itemsToDeployCount === 0 &&
    deletionsToDeleteCount === 0 &&
    actionsToRun.length === 0
  ) {
    blockers.push("nothingToDo");
  }
  if (conflictKeys.length > 0) {
    blockers.push("conflictMarkers");
  }

  return {
    selectedGroupCount: selectedGroups.length,
    pullRequestIds: pullRequestIdsOf(selection.groups),
    range:
      selectedGroups.length > 0
        ? {
            oldest: selectedGroups[selectedGroups.length - 1].shortHash,
            newest: selectedGroups[0].shortHash,
          }
        : null,
    items,
    itemsToDeployCount,
    changedInOrg: items.filter(
      (item) =>
        item.orgState === "changedInOrg" || item.orgState === "deletedLocally",
    ),
    deletions,
    deletionsToDeleteCount,
    actions,
    actionsToRunCount: actionsToRun.length,
    actionsAlreadyDoneCount: actions.filter((action) => !!action.alreadyDone)
      .length,
    manualActionsCount: actionsToRun.filter((action) => isManualAction(action))
      .length,
    alreadyInOrgSelectedCount: selectedGroups.filter(
      (group) => group.status === "done",
    ).length,
    testClasses: [
      ...new Set(selectedGroups.flatMap((group) => group.testClasses)),
    ].sort(),
    alsoInUnselectedCount: items.filter(
      (item) => !item.excluded && item.alsoInUnselected.length > 0,
    ).length,
    conflictKeys,
    blockers,
    canRun: blockers.length === 0,
  };
}

/**
 * `--parentbranch`, `--pull-requests` and `--commits` for the selected groups. A group
 * goes to `--pull-requests` when it merged Pull Requests that no other group of the
 * plan also brought in; otherwise it is named by its commit, so the CLI cannot pick
 * an unselected group sharing the same Pull Request number.
 */
function buildGroupSelectionFlags(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
): string[] {
  const selectedHashes = new Set(selection.groups);
  const selectedGroups = plan.groups.filter((group) =>
    selectedHashes.has(group.hash),
  );
  const otherPullRequestIds = new Set(
    plan.groups
      .filter((group) => !selectedHashes.has(group.hash))
      .flatMap((group) => group.pullRequests.map((pr) => pr.id)),
  );
  const pullRequestIds = new Set<number>();
  const commits: string[] = [];
  // Oldest first, the order of the history
  for (const group of [...selectedGroups].reverse()) {
    const ids = group.pullRequests
      .map((pr) => pr.id)
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length > 0 && ids.every((id) => !otherPullRequestIds.has(id))) {
      ids.forEach((id) => pullRequestIds.add(id));
    } else {
      const commit =
        group.shortHash && group.shortHash.length >= 7
          ? group.shortHash
          : group.hash;
      if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
        throw new Error(`Invalid commit in the plan: ${JSON.stringify(commit)}`);
      }
      commits.push(commit);
    }
  }
  const flags = [`--parentbranch ${quoteCommandValue(plan.parentBranch)}`];
  if (pullRequestIds.size > 0) {
    flags.push(
      `--pull-requests ${[...pullRequestIds].sort((a, b) => a - b).join(",")}`,
    );
  }
  if (commits.length > 0) {
    flags.push(`--commits ${commits.join(",")}`);
  }
  return flags;
}

/**
 * The exact run command for a selection, or null when no group is selected. Throws
 * when a value of the plan cannot be put safely in a command.
 */
export function buildBackpromoteCommand(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
): string | null {
  const summary = computeSelectionSummary(plan, selection);
  if (summary.selectedGroupCount === 0) {
    return null;
  }
  const parts = [BACKPROMOTE_COMMAND, ...buildGroupSelectionFlags(plan, selection)];
  for (const item of summary.items) {
    if (item.excluded) {
      parts.push(`--exclude-metadata ${quoteCommandValue(item.key)}`);
    }
  }
  if (
    summary.deletions.length > 0 &&
    summary.deletions.every((deletion) => deletion.excluded)
  ) {
    parts.push("--skip-destructive");
  } else {
    for (const deletion of summary.deletions) {
      if (deletion.excluded) {
        parts.push(`--exclude-metadata ${quoteCommandValue(deletion.key)}`);
      }
    }
  }
  for (const item of summary.items) {
    if (item.merged) {
      parts.push(`--merged-metadata ${quoteCommandValue(item.key)}`);
    }
  }
  if (summary.actions.length > 0) {
    const actionIds = summary.actions
      .filter((action) => action.selected)
      .map((action) => action.id);
    parts.push(
      actionIds.length > 0
        ? `--actions ${quoteCommandValue(actionIds.join(","))}`
        : "--skip-actions",
    );
  }
  parts.push(`--target-org ${quoteCommandValue(plan.targetOrg.username)}`);
  return parts.join(" ");
}

/**
 * Summary, command and blockers sent to the panel after every selection change.
 */
export function buildSelectionPayload(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
  conflictBlocksByKey: Record<string, number> = {},
): BackpromoteSelectionPayload {
  const summary = computeSelectionSummary(plan, selection, conflictBlocksByKey);
  let command: string | null = null;
  let commandError: string | null = null;
  try {
    command = buildBackpromoteCommand(plan, selection);
  } catch (error: any) {
    commandError = String(error?.message || error);
  }
  if (commandError) {
    summary.blockers.push("invalidCommand");
    summary.canRun = false;
  }
  return { summary, command, commandError };
}

/**
 * Read-only plan command, with the parent branch the user chose in the panel.
 */
export function buildPlanCommand(parentBranch?: string | null): string {
  const parts = [BACKPROMOTE_COMMAND, "--plan"];
  if (parentBranch) {
    parts.push(`--parentbranch ${quoteCommandValue(parentBranch)}`);
  }
  parts.push("--json");
  return parts.join(" ");
}

/**
 * Command writing the 3-way merge of some items into their local files. The group
 * selection flags define the merge base.
 */
export function buildPrepareMergeCommand(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
  keys: string[],
): string {
  const mergeableKeys = new Set(
    plan.items.filter((item) => item.mergeable).map((item) => item.key),
  );
  const keysToMerge = [...new Set(asStringArray(keys))].filter((key) =>
    mergeableKeys.has(key),
  );
  if (keysToMerge.length === 0) {
    throw new Error("No mergeable item to prepare");
  }
  if (selection.groups.length === 0) {
    throw new Error("No group selected");
  }
  return [
    BACKPROMOTE_COMMAND,
    ...keysToMerge.map((key) => `--prepare-merge ${quoteCommandValue(key)}`),
    ...buildGroupSelectionFlags(plan, selection),
    `--target-org ${quoteCommandValue(plan.targetOrg.username)}`,
    "--json",
  ].join(" ");
}

/**
 * Number of conflict blocks (lines opening with `<<<<<<<`) left in a file. For display
 * only: the CLI checks the markers again before deploying.
 */
export function countConflictBlocks(content: string): number {
  if (typeof content !== "string" || content.length === 0) {
    return 0;
  }
  return content
    .split(/\r?\n/)
    .filter((line) => /^<{7}(?!<)/.test(line)).length;
}

/**
 * A deployment action that may need the user: a manual step, or an action run as
 * another user that sfdx-hardis may not be able to log in as on the org.
 */
export function isManualAction(
  action: Pick<BackpromoteAction, "type" | "customUsername">,
): boolean {
  return action.type === "manual" || !!action.customUsername;
}

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
 * True when the installed sfdx-hardis does not know the flags of the panel yet: the
 * CLI then answers with a "Nonexistent flag" parsing error.
 */
export function isCliTooOldForBackpromotePanel(result: any): boolean {
  const text = collectResultText(result);
  return /NonexistentFlagsError|Nonexistent flags?:?\s*--|Unexpected argument:?\s*--(plan|prepare-merge)/i.test(
    text,
  );
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
 * Short name of the target org for the panel header: the `orgName` sent by
 * sfdx-hardis, else the first label of its instance URL (`mycompany--dev-sam` for
 * `https://mycompany--dev-sam.sandbox.my.salesforce.com`), else its username.
 */
export function getTargetOrgDisplayName(
  targetOrg: Partial<BackpromotePlan["targetOrg"]> | null | undefined,
): string {
  if (!targetOrg) {
    return "";
  }
  if (targetOrg.orgName) {
    return targetOrg.orgName;
  }
  try {
    const host = new URL(targetOrg.instanceUrl || "").hostname;
    const label = host.split(".")[0];
    if (label && !["login", "test", "www"].includes(label)) {
      return label;
    }
  } catch {
    // Not a URL
  }
  return targetOrg.username || "";
}

/** One step sfdx-hardis reported in the progress file of a background command */
export interface BackpromoteProgressEvent {
  step: string;
  message: string;
  current: number | null;
  total: number | null;
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
