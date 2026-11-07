/*
Helpers of the development orgs shown in the DevOps Pipeline (developer sandboxes and scratch orgs
registered by sfdx-hardis, each with the major branch it targets).

sfdx-hardis is the only engine: it keeps the list in a dashboard of the git provider, tells which
orgs belong to the git user of the checkout and counts the Pull Requests each org misses. The
extension reads the answer of sf hardis:project:dev-org:list, keeps only the documented fields,
and builds the commands that edit the list. No vscode import, so it runs in the unit tests as is.
*/

import {
  asAnswerCount,
  asAnswerObjects,
  cleanAnswerText,
  failedCommandMessage,
} from "../cliAnswerUtils";
import { safeWebUrl } from "../doraReportUtils";

export const DEV_ORGS_DOC_URL =
  "https://sfdx-hardis.cloudity.com/salesforce-devops-dev-orgs/";

// Suffix of the node of a development org in the diagram (the click router of the webview reads it)
export const DEV_ORG_NODE_SUFFIX = "DevOrg";

export interface DevOrgPersonView {
  name: string;
  email: string;
}

export interface DevOrgCarriedPullRequestView {
  number: number;
  title: string;
  url: string;
}

export interface DevOrgPullRequestView {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  sourceBranch: string;
  // A Pull Request that only moves others (a major branch, a promotion)
  vehicle: boolean;
  // What a vehicle carries, null when sfdx-hardis does not know it
  carried: DevOrgCarriedPullRequestView[] | null;
}

export interface DevOrgBehindView {
  count: number;
  oldestMergedAt: string | null;
  oldestDays: number | null;
  computedAt: string;
  // Some missing Pull Requests are older than the lookback limit of sfdx-hardis
  cutOff: boolean;
  // Newest first
  pullRequests: DevOrgPullRequestView[];
}

// Everything the webview receives about a development org: the fields listed here and no other
export interface DevOrgView {
  orgId: string;
  orgType: string;
  name: string;
  alias: string | null;
  instanceUrl: string;
  expirationDate: string | null;
  targetBranch: string;
  owner: DevOrgPersonView | null;
  users: DevOrgPersonView[];
  featureBranches: Array<{ name: string; lastSeen: string }>;
  registeredAt: string;
  lastActivityAt: string;
  lastBackpromote: {
    date: string;
    parentBranch: string;
    pullRequest: number | null;
  } | null;
  isMine: boolean;
  stale: boolean;
  startDate: string;
  // Null until sfdx-hardis listed the Pull Requests merged into the target branch
  behind: DevOrgBehindView | null;
  // Node of the org in the diagram
  nodeName: string;
}

export interface DevOrgsView {
  enabled: boolean;
  dashboardUrl: string | null;
  staleDays: number;
  orgs: DevOrgView[];
  warnings: string[];
}

// noGitProvider: no token to read the dashboard of the git provider
// other: anything else, with the message of sfdx-hardis
export interface DevOrgsError {
  kind: "noGitProvider" | "other";
  message: string;
}

export type DevOrgsOutcome = { devOrgs: DevOrgsView } | { error: DevOrgsError };

// What the Edit form of the details window asks sfdx-hardis to write
export interface DevOrgEditRequest {
  orgId: string;
  targetBranch: string;
  owner: string;
  users: string;
}

const MAX_ORGS = 300;
const MAX_ROWS = 300;
const MAX_TEXT_LENGTH = 300;
const MAX_ERROR_LENGTH = 2000;
// A Salesforce org id: 15 or 18 characters, starting with 00D
const ORG_ID_PATTERN = /^00D[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;
const BRANCH_NAME_PATTERN = /^[\w./-]+$/;
// Characters some shell of the command runner (cmd.exe, bash, PowerShell) reads inside double
// quotes: a value holding one is refused, never escaped
const UNSAFE_QUOTED_VALUE = /["\\`$%!]/;

/**
 * The branches a development org can target: developmentBranch, then availableTargetBranches
 * (an entry can be "branch,description"). Each one once, in that order.
 */
export function devOrgTargetBranches(projectConfig: any): string[] {
  const branches: string[] = [];
  const candidates = [
    projectConfig?.developmentBranch,
    ...(Array.isArray(projectConfig?.availableTargetBranches)
      ? projectConfig.availableTargetBranches
      : []),
  ];
  for (const candidate of candidates) {
    const branch =
      typeof candidate === "string" ? candidate.split(",")[0].trim() : "";
    if (
      branch &&
      BRANCH_NAME_PATTERN.test(branch) &&
      !branches.includes(branch)
    ) {
      branches.push(branch);
    }
  }
  return branches;
}

/** False only when the project turned the list off (enableDevOrgsRegistry: false) */
export function isDevOrgsRegistryEnabled(projectConfig: any): boolean {
  return projectConfig?.enableDevOrgsRegistry !== false;
}

/** Key of the last list kept for a workspace */
export function devOrgsCacheKey(workspaceRoot: string): string {
  return `dev-orgs:${workspaceRoot}`;
}

/**
 * The command the pipeline reads the list with. --refresh lists again the merged Pull Requests
 * from the git provider: only when the user asks for it, never on a load.
 */
export function buildDevOrgListCommand(refresh: boolean): string {
  return `sf hardis:project:dev-org:list${refresh ? " --refresh" : ""} --agent`;
}

/**
 * Node of a development org in the diagram, built from its org id. An org id starts with digits:
 * the "org" prefix keeps the node id a name for mermaid.
 */
export function devOrgNodeName(orgId: string): string {
  const sanitized = String(orgId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  return "org" + (sanitized || "unknown") + DEV_ORG_NODE_SUFFIX;
}

/** True for a Salesforce org id */
export function isSafeOrgId(value: unknown): value is string {
  return typeof value === "string" && ORG_ID_PATTERN.test(value);
}

/**
 * True when both ids are the same org: sfdx-hardis and sf org list may give the 15 or the 18
 * characters version of it.
 */
export function isSameOrgId(first: unknown, second: unknown): boolean {
  if (!isSafeOrgId(first) || !isSafeOrgId(second)) {
    return false;
  }
  return first.slice(0, 15) === second.slice(0, 15);
}

/**
 * The outcome of sf hardis:project:dev-org:list --json, as execSfdxJson parsed it.
 */
export function readDevOrgsOutcome(result: any): DevOrgsOutcome {
  const answer = result?.result;
  if (result?.status === 0 && answer && typeof answer === "object") {
    if (answer.devOrgs && typeof answer.devOrgs === "object") {
      return { devOrgs: sanitizeDevOrgs(answer.devOrgs) };
    }
    const message = cleanAnswerText(
      answer.errorMessage || answer.outputString,
      MAX_ERROR_LENGTH,
    );
    if (answer.errorKind === "noGitProvider") {
      return { error: { kind: "noGitProvider", message } };
    }
    return { error: { kind: "other", message } };
  }
  return {
    error: {
      kind: "other",
      message: failedCommandMessage(result, MAX_ERROR_LENGTH),
    },
  };
}

/**
 * The list with only the fields the pipeline draws, each one of the type it expects, and every
 * address that is not http(s) removed.
 */
export function sanitizeDevOrgs(devOrgs: any): DevOrgsView {
  return {
    enabled: devOrgs?.enabled !== false,
    dashboardUrl: safeWebUrl(devOrgs?.dashboardUrl) || null,
    staleDays: asAnswerCount(devOrgs?.staleDays),
    orgs: asAnswerObjects(devOrgs?.orgs, MAX_ORGS)
      .map(sanitizeDevOrg)
      .filter((org): org is DevOrgView => org !== null),
    warnings: (Array.isArray(devOrgs?.warnings) ? devOrgs.warnings : [])
      .map((warning: unknown) => cleanText(warning, MAX_ERROR_LENGTH))
      .filter((warning: string) => warning !== "")
      .slice(0, 20),
  };
}

/**
 * The command the Edit form of the details window runs. Throws with the reason when a value
 * cannot be passed on a command line.
 * @param request what the form holds
 * @param majorBranches the major branches of the pipeline: the only target branches offered
 */
export function buildDevOrgRegisterCommand(
  request: DevOrgEditRequest,
  majorBranches: string[],
): string {
  if (!isSafeOrgId(request?.orgId)) {
    throw new Error("invalidOrgId");
  }
  const targetBranch = String(request?.targetBranch || "").trim();
  if (
    !BRANCH_NAME_PATTERN.test(targetBranch) ||
    !majorBranches.includes(targetBranch)
  ) {
    throw new Error("invalidTargetBranch");
  }
  const owner = normalizePersonText(request?.owner);
  const users = normalizePersonText(request?.users);
  if (!isSafeQuotedValue(owner) || !isSafeQuotedValue(users)) {
    throw new Error("invalidCharacters");
  }
  const parts = [
    "sf hardis:project:dev-org:register",
    `--org-id ${request.orgId}`,
    `--target-branch ${targetBranch}`,
  ];
  // No owner keeps the registered one: an empty value is dropped by some shells, the flag
  // would then swallow the next one
  if (owner !== "") {
    parts.push(`--owner "${owner}"`);
  }
  // Users replace the registered ones. A lone comma is a list of nobody that every shell keeps.
  parts.push(`--users "${users !== "" ? users : ","}"`);
  parts.push("--agent");
  return parts.join(" ");
}

/** The command the Remove button of the details window runs */
export function buildDevOrgRemoveCommand(orgId: string): string {
  if (!isSafeOrgId(orgId)) {
    throw new Error("invalidOrgId");
  }
  return `sf hardis:project:dev-org:remove --org-id ${orgId} --agent`;
}

/**
 * True for a command that changes the list: registering, editing or removing an org. The
 * pipeline reads the list again when one of them ends.
 */
export function isDevOrgsChangeCommand(command: unknown): boolean {
  return (
    typeof command === "string" &&
    /(^|\s)hardis:(project:dev-org:(register|remove)|work:(new|save|backpromote)|org:create)(\s|$)/.test(
      command,
    )
  );
}

function sanitizeDevOrg(org: any): DevOrgView | null {
  if (!isSafeOrgId(org?.orgId)) {
    return null;
  }
  const targetBranch = cleanText(org?.targetBranch);
  return {
    orgId: org.orgId,
    orgType: ["sandbox", "scratch", "developer"].includes(org?.orgType)
      ? org.orgType
      : "sandbox",
    name: cleanText(org?.name) || org.orgId,
    alias: cleanText(org?.alias) || null,
    instanceUrl: safeWebUrl(org?.instanceUrl),
    expirationDate: cleanText(org?.expirationDate, 50) || null,
    targetBranch,
    owner: sanitizePerson(org?.owner),
    users: asAnswerObjects(org?.users, MAX_ROWS)
      .map(sanitizePerson)
      .filter((person): person is DevOrgPersonView => person !== null),
    featureBranches: asAnswerObjects(org?.featureBranches, MAX_ROWS)
      .map((branch) => ({
        name: cleanText(branch.name),
        lastSeen: cleanText(branch.lastSeen, 50),
      }))
      .filter((branch) => branch.name !== ""),
    registeredAt: cleanText(org?.registeredAt, 50),
    lastActivityAt: cleanText(org?.lastActivityAt, 50),
    lastBackpromote:
      org?.lastBackpromote && typeof org.lastBackpromote === "object"
        ? {
            date: cleanText(org.lastBackpromote.date, 50),
            parentBranch: cleanText(org.lastBackpromote.parentBranch),
            pullRequest: positiveNumber(org.lastBackpromote.pullRequest),
          }
        : null,
    isMine: org?.isMine === true,
    stale: org?.stale === true,
    startDate: cleanText(org?.startDate, 50),
    behind: sanitizeBehind(org?.behind),
    nodeName: devOrgNodeName(org.orgId),
  };
}

function sanitizeBehind(behind: any): DevOrgBehindView | null {
  if (!behind || typeof behind !== "object") {
    return null;
  }
  const pullRequests = asAnswerObjects(behind.pullRequests, MAX_ROWS)
    .map((pullRequest) => ({
      number: positiveNumber(pullRequest.number) || 0,
      title: cleanText(pullRequest.title),
      url: safeWebUrl(pullRequest.url),
      mergedAt: cleanText(pullRequest.mergedAt, 50),
      sourceBranch: cleanText(pullRequest.sourceBranch),
      vehicle: pullRequest.vehicle === true,
      carried: Array.isArray(pullRequest.carried)
        ? asAnswerObjects(pullRequest.carried, MAX_ROWS).map((carried) => ({
            number: positiveNumber(carried.number) || 0,
            title: cleanText(carried.title),
            url: safeWebUrl(carried.url),
          }))
        : null,
    }))
    // Newest first, whatever the order of the answer
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return {
    count: asAnswerCount(behind.count),
    oldestMergedAt: cleanText(behind.oldestMergedAt, 50) || null,
    oldestDays:
      typeof behind.oldestDays === "number" &&
      Number.isFinite(behind.oldestDays)
        ? behind.oldestDays
        : null,
    computedAt: cleanText(behind.computedAt, 50),
    cutOff: behind.cutOff === true,
    pullRequests,
  };
}

function sanitizePerson(person: any): DevOrgPersonView | null {
  if (!person || typeof person !== "object") {
    return null;
  }
  const email = cleanText(person.email);
  if (email === "") {
    return null;
  }
  return { name: cleanText(person.name) || email, email };
}

// The text of an owner or users field on one line, separators kept
function normalizePersonText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function isSafeQuotedValue(value: string): boolean {
  // The command runner refuses any command line chaining others
  if (
    UNSAFE_QUOTED_VALUE.test(value) ||
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

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function cleanText(
  value: unknown,
  maxLength: number = MAX_TEXT_LENGTH,
): string {
  return cleanAnswerText(value, maxLength);
}
