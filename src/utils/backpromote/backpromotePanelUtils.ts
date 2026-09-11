import { stripAnsiCodes } from "../ansiColors";

/**
 * Pure logic of the Backpromote panel (vscode-sfdx-hardis.showBackpromote).
 *
 * sfdx-hardis computes a plan with `sf hardis:work:backpromote --plan --json`: the Pull
 * Requests a merge of the parent branch brings in, the items and deletions it deploys, the
 * files the merge may stop on, and the deployment actions. The panel lets the user untick
 * items, deletions and actions, and decide what to do with each conflicting file. These
 * helpers turn that selection into the counters of the panel and into the exact command
 * given to the command runner. No VS Code API here: they are unit tested directly.
 */

export const BACKPROMOTE_COMMAND = "sf hardis:work:backpromote";

export type BackpromotePlanStatus =
  | "ready"
  | "blocked"
  | "upToDate"
  | "mergeInProgress";
export type BackpromoteConflictChoice = "overwrite" | "merge" | "keep";
export const BACKPROMOTE_CONFLICT_CHOICES: BackpromoteConflictChoice[] = [
  "overwrite",
  "merge",
  "keep",
];

export interface BackpromotePullRequest {
  id: number;
  title: string;
  author: string;
  webUrl: string;
  sourceBranch: string;
  date: string;
  commit: string;
}

export interface BackpromotePredictedConflict {
  path: string;
  changedInBranch: boolean;
  changedInOrg: boolean;
}

export interface BackpromoteItem {
  key: string;
  type: string;
  name: string;
  path: string | null;
  conflict: BackpromotePredictedConflict | null;
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
  when: "pre" | "post";
  pullRequestId: number;
  customUsername: string | null;
}

export interface BackpromoteConflict extends BackpromotePredictedConflict {
  /** Type:Name items the file belongs to */
  items: string[];
  /** Markers left in the file when a merge is in progress, null before the merge */
  conflictBlocks: number | null;
}

export interface BackpromoteCheck {
  id: "currentBranch" | "gitClean" | "targetOrg" | "parentBranch" | string;
  ok: boolean;
  message: string;
  details?: string[];
}

export interface BackpromotePlan {
  planVersion: number;
  status: BackpromotePlanStatus;
  currentBranch: string;
  parentBranch: string;
  parentBranchChoices: string[];
  targetOrg: {
    username: string;
    instanceUrl: string;
    orgType: "sandbox" | "scratch" | "production" | string;
    orgId: string;
    /** Short name, ex: mycompany--dev-sam */
    orgName: string;
    /** The org tracks its sources: its pending changes are saved before the merge */
    tracksSource: boolean;
  };
  checks: BackpromoteCheck[];
  pullRequests: BackpromotePullRequest[];
  commitCount: number;
  items: BackpromoteItem[];
  deletions: BackpromoteDeletion[];
  actions: BackpromoteAction[];
  testClasses: string[];
  conflicts: BackpromoteConflict[];
  orgChanges: { tracked: boolean; files: string[] };
  reports: string[];
}

/**
 * What the user picked in the panel. Only keys, paths and ids that exist in the plan are kept
 * (see normalizeSelection), so a message from the webview cannot inject anything into the command.
 */
export interface BackpromoteSelection {
  /** `Type:Name` items not to deploy now */
  excludedItems: string[];
  /** `Type:Name` deletions not to run */
  excludedDeletions: string[];
  /** Ids of the deployment actions to run */
  actions: string[];
  /** File path -> what to do when git cannot merge it */
  conflictDecisions: Record<string, BackpromoteConflictChoice>;
}

export interface BackpromoteSummaryConflict extends BackpromoteConflict {
  choice: BackpromoteConflictChoice;
}

export type BackpromoteBlocker =
  | "notReady"
  | "nothingToDo"
  | "conflictMarkers"
  | "invalidCommand";

export interface BackpromoteSelectionSummary {
  itemsToDeployCount: number;
  deletionsToDeleteCount: number;
  actionsToRunCount: number;
  manualActionsCount: number;
  conflicts: BackpromoteSummaryConflict[];
  /** Files of a merge in progress that still hold markers */
  markersLeft: Array<{ path: string; conflictBlocks: number }>;
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
// and PowerShell, even inside double quotes: such a value is refused, never escaped.
// A single quote is refused too, because single quotes are what protects a value
// carrying a dollar sign.
const UNSAFE_COMMAND_VALUE = /["\\`']/;
// Command and variable substitution: refused whatever the quoting
const UNSAFE_SUBSTITUTION = /\$[({]/;
// A lone dollar sign is part of Salesforce folder names (unfiled$public): the value
// is single quoted, which bash and PowerShell both take literally
const NEEDS_LITERAL_QUOTES = /\$/;

/**
 * A value built from the plan can go into a command when it holds no quote, no
 * backslash, no substitution, no control character and no command chaining.
 */
export function isSafeCommandValue(value: unknown): value is string {
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
export function quoteCommandValue(value: string): string {
  if (!isSafeCommandValue(value)) {
    throw new Error(
      `Value not allowed in a backpromote command: ${JSON.stringify(value)}`,
    );
  }
  if (PLAIN_COMMAND_VALUE.test(value)) {
    return value;
  }
  return NEEDS_LITERAL_QUOTES.test(value) ? `'${value}'` : `"${value}"`;
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

function normalizeConflict(raw: any): BackpromoteConflict | null {
  if (!raw || typeof raw.path !== "string" || raw.path === "") {
    return null;
  }
  return {
    path: raw.path,
    changedInBranch: raw.changedInBranch === true,
    changedInOrg: raw.changedInOrg === true,
    items: asStringArray(raw.items),
    conflictBlocks: Number.isFinite(raw.conflictBlocks)
      ? Number(raw.conflictBlocks)
      : null,
  };
}

/**
 * Checks the shape of the `--plan --json` result and fills the missing arrays, so
 * the panel never crashes on a partial plan. Returns null when it is not a plan.
 */
export function normalizeBackpromotePlan(raw: any): BackpromotePlan | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.planVersion !== "number" ||
    raw.planVersion < 2 ||
    !["ready", "blocked", "upToDate", "mergeInProgress"].includes(raw.status)
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
  return {
    planVersion: raw.planVersion,
    status: raw.status,
    currentBranch: String(raw.currentBranch || ""),
    parentBranch: String(raw.parentBranch || ""),
    parentBranchChoices: asStringArray(raw.parentBranchChoices),
    targetOrg: {
      username: String(raw.targetOrg?.username || ""),
      instanceUrl: String(raw.targetOrg?.instanceUrl || ""),
      orgType: String(raw.targetOrg?.orgType || ""),
      orgId: String(raw.targetOrg?.orgId || ""),
      orgName: String(raw.targetOrg?.orgName || ""),
      tracksSource: raw.targetOrg?.tracksSource === true,
    },
    checks: asArray(raw.checks).map((check: any) => ({
      id: String(check?.id || ""),
      ok: check?.ok === true,
      message: String(check?.message || ""),
      details: asStringArray(check?.details),
    })),
    pullRequests: asArray(raw.pullRequests)
      .filter((pr: any) => pr && typeof pr === "object")
      .map((pr: any) => ({
        id: Number.isInteger(pr.id) ? pr.id : 0,
        title: String(pr.title || ""),
        author: String(pr.author || ""),
        webUrl: String(pr.webUrl || ""),
        sourceBranch: String(pr.sourceBranch || ""),
        date: String(pr.date || ""),
        commit: String(pr.commit || ""),
      })),
    commitCount: Number.isFinite(raw.commitCount) ? Number(raw.commitCount) : 0,
    items: asArray(raw.items)
      .filter((item: any) => typeof item?.key === "string")
      .map((item: any) => ({
        ...entry(item),
        path: typeof item.path === "string" && item.path ? item.path : null,
        conflict:
          item.conflict && typeof item.conflict.path === "string"
            ? {
                path: item.conflict.path,
                changedInBranch: item.conflict.changedInBranch === true,
                changedInOrg: item.conflict.changedInOrg === true,
              }
            : null,
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
        when: action.when === "pre" ? "pre" : "post",
        pullRequestId: Number.isInteger(action.pullRequestId)
          ? action.pullRequestId
          : 0,
        customUsername:
          typeof action.customUsername === "string" && action.customUsername
            ? action.customUsername
            : null,
      })),
    testClasses: asStringArray(raw.testClasses),
    conflicts: asArray(raw.conflicts)
      .map(normalizeConflict)
      .filter((conflict): conflict is BackpromoteConflict => !!conflict),
    orgChanges: {
      tracked: raw.orgChanges?.tracked === true,
      files: asStringArray(raw.orgChanges?.files),
    },
    reports: asStringArray(raw.reports),
  };
}

/**
 * Default selection of a freshly loaded plan: every item deployed, every deletion run,
 * every action run, every conflicting file merged by hand (nothing is overwritten or
 * dropped without the user saying so).
 */
export function buildDefaultSelection(
  plan: BackpromotePlan,
): BackpromoteSelection {
  const conflictDecisions: Record<string, BackpromoteConflictChoice> = {};
  for (const conflict of plan.conflicts) {
    conflictDecisions[conflict.path] = "merge";
  }
  return {
    excludedItems: [],
    excludedDeletions: [],
    actions: plan.actions.map((action) => action.id),
    conflictDecisions,
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
  const conflictDecisions: Record<string, BackpromoteConflictChoice> = {};
  for (const conflict of plan.conflicts) {
    const choice = raw?.conflictDecisions?.[conflict.path];
    conflictDecisions[conflict.path] = BACKPROMOTE_CONFLICT_CHOICES.includes(
      choice,
    )
      ? choice
      : "merge";
  }
  return {
    excludedItems: pick(
      raw?.excludedItems,
      plan.items.map((item) => item.key),
    ),
    excludedDeletions: pick(
      raw?.excludedDeletions,
      plan.deletions.map((deletion) => deletion.key),
    ),
    actions: pick(
      raw?.actions,
      plan.actions.map((action) => action.id),
    ),
    conflictDecisions,
  };
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
 * Counters and blockers of the panel for a selection.
 */
export function computeSelectionSummary(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
): BackpromoteSelectionSummary {
  const excluded = new Set(selection.excludedItems);
  const excludedDeletions = new Set(selection.excludedDeletions);
  const selectedActions = new Set(selection.actions);
  const itemsToDeployCount = plan.items.filter(
    (item) => !excluded.has(item.key),
  ).length;
  const deletionsToDeleteCount = plan.deletions.filter(
    (deletion) => !excludedDeletions.has(deletion.key),
  ).length;
  const actionsToRun = plan.actions.filter((action) =>
    selectedActions.has(action.id),
  );
  const conflicts = plan.conflicts.map((conflict) => ({
    ...conflict,
    choice: selection.conflictDecisions[conflict.path] || "merge",
  }));
  const markersLeft = plan.conflicts
    .filter(
      (conflict) =>
        typeof conflict.conflictBlocks === "number" &&
        conflict.conflictBlocks > 0,
    )
    .map((conflict) => ({
      path: conflict.path,
      conflictBlocks: conflict.conflictBlocks as number,
    }));

  const blockers: BackpromoteBlocker[] = [];
  if (plan.status !== "ready" && plan.status !== "mergeInProgress") {
    blockers.push("notReady");
  }
  if (
    plan.status === "ready" &&
    itemsToDeployCount === 0 &&
    deletionsToDeleteCount === 0 &&
    actionsToRun.length === 0
  ) {
    blockers.push("nothingToDo");
  }
  if (plan.status === "mergeInProgress" && markersLeft.length > 0) {
    blockers.push("conflictMarkers");
  }
  return {
    itemsToDeployCount,
    deletionsToDeleteCount,
    actionsToRunCount: actionsToRun.length,
    manualActionsCount: actionsToRun.filter((action) => isManualAction(action))
      .length,
    conflicts,
    markersLeft,
    blockers,
    canRun: blockers.length === 0,
  };
}

/**
 * The exact run command for a selection. Throws when a value of the plan cannot be put
 * safely in a command.
 */
export function buildBackpromoteCommand(
  plan: BackpromotePlan,
  selection: BackpromoteSelection,
): string {
  const parts = [
    BACKPROMOTE_COMMAND,
    `--parentbranch ${quoteCommandValue(plan.parentBranch)}`,
    "--auto",
  ];
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
  for (const [file, choice] of Object.entries(selection.conflictDecisions)) {
    parts.push(`--on-conflict ${quoteCommandValue(`${file}=${choice}`)}`);
  }
  if (plan.actions.length > 0) {
    parts.push(
      selection.actions.length > 0
        ? `--actions ${quoteCommandValue(selection.actions.join(","))}`
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
): BackpromoteSelectionPayload {
  const summary = computeSelectionSummary(plan, selection);
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
    /NonexistentFlagsError|Nonexistent flags?:?\s*--|Unexpected argument:?\s*--(plan|auto)/i.test(
      text,
    )
  ) {
    return true;
  }
  const planVersion = result?.result?.planVersion;
  return typeof planVersion === "number" && planVersion < 2;
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
