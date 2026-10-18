/*
Helpers of the Scratch Org Pool panel (src/commands/showScratchOrgPool.ts).

The panel only draws the result of sf hardis:scratch:pool:view and launches the pool commands:
nothing here reads the pool storage. This module builds the commands, tells the kinds of failure
apart and keeps only the documented fields in what goes to the webview. No vscode import, so it
runs in the unit tests as is.
*/

import {
  asAnswerCount,
  asAnswerObjects,
  cleanAnswerText,
  failedCommandMessage,
} from "./cliAnswerUtils";
import { safeWebUrl } from "./doraReportUtils";

// Where the status view keeps the available and maximum number of scratch orgs of the pool,
// and for how long. The panel writes there too when it reads the pool.
export const SCRATCH_ORG_POOL_COUNTS_CACHE_KEY = "scratchPoolCounts";
export const SCRATCH_ORG_POOL_COUNTS_TTL_MS = 1000 * 60 * 15;

// noGitProvider: the git provider that stores the pool cannot be read
// noPool: the project has no scratch org pool yet
// cliTooOld: the installed sfdx-hardis does not describe the pool
// other: anything else, with the message of sfdx-hardis
export type ScratchOrgPoolErrorKind =
  "noGitProvider" | "noPool" | "cliTooOld" | "other";

export interface ScratchOrgPoolPanelError {
  kind: ScratchOrgPoolErrorKind;
  message: string;
}

export type ScratchOrgPoolKeyStatus =
  "ok" | "missing" | "mismatch" | "notNeeded";

export interface ScratchOrgPoolLimit {
  used: number;
  max: number;
}

// Everything the webview receives about a pool: the fields listed here and no other
export interface ScratchOrgPoolView {
  storageService: string;
  dashboardUrl: string | null;
  available: number;
  max: number;
  canTake: boolean;
  keyStatus: ScratchOrgPoolKeyStatus;
  orgs: Array<{
    alias: string;
    username: string;
    createdDate: string;
    expirationDate: string;
    daysLeft: number | null;
  }>;
  history: Array<{
    date: string;
    by: string;
    branch: string;
    pullRequest: string;
    jobUrl: string;
    alias: string;
  }>;
  failures: Array<{ date: string; error: string; jobUrl: string }>;
  lastRefresh: { date: string; jobUrl: string } | null;
  devHubLimits: {
    activeScratchOrgs: ScratchOrgPoolLimit;
    dailyScratchOrgs: ScratchOrgPoolLimit;
  } | null;
}

export type ScratchOrgPoolOutcome =
  { pool: ScratchOrgPoolView } | { error: ScratchOrgPoolPanelError };

const KEY_STATUSES: ScratchOrgPoolKeyStatus[] = [
  "ok",
  "missing",
  "mismatch",
  "notNeeded",
];
const MAX_ROWS = 500;
const MAX_TEXT_LENGTH = 500;
const MAX_ERROR_LENGTH = 2000;

/**
 * The command the panel and the status view read the pool with. No flag: an older sfdx-hardis
 * must answer too, so that the panel can tell it is too old.
 */
export function buildScratchOrgPoolViewCommand(): string {
  return "sf hardis:scratch:pool:view";
}

/** Key of the last result kept for a workspace */
export function scratchOrgPoolCacheKey(workspaceRoot: string): string {
  return `scratch-org-pool:${workspaceRoot}`;
}

/**
 * Name the encryption key of a pool is stored under in the VS Code secret storage: one key
 * per repository, since each pool has its own.
 * @param repository what identifies the repository: host, owner and name, or its folder
 */
export function poolEncryptionKeySecretName(repository: string): string {
  const identity = String(repository || "")
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `POOL_ENCRYPTION_KEY_${identity || "DEFAULT"}`;
}

/**
 * True for a command that changes the content of the pool: taking a scratch org, refilling,
 * resetting or configuring the pool. The panel reads the pool again when one of them ends.
 */
export function isScratchOrgPoolCommand(command: unknown): boolean {
  return (
    typeof command === "string" &&
    /(^|\s)hardis:scratch:(create|pool:(create|refresh|reset))(\s|$)/.test(
      command,
    )
  );
}

/** True when the project configuration declares a scratch org pool */
export function isScratchOrgPoolConfigured(projectConfig: any): boolean {
  const storageService = projectConfig?.poolConfig?.storageService;
  return typeof storageService === "string" && storageService.trim() !== "";
}

/**
 * What the status view shows of an answer of sf hardis:scratch:pool:view, and the only part
 * of it that may be kept: the two counts. An older sfdx-hardis answers the credentials of the
 * pool too, which are never read nor stored.
 */
export function readScratchOrgPoolCounts(
  result: any,
): { available: number; max: number } | null {
  const answer = result?.result;
  if (result?.status !== 0 || !answer || answer.status !== 0) {
    return null;
  }
  const available = answer.availableScratchOrgs;
  if (typeof available !== "number" || !Number.isFinite(available)) {
    return null;
  }
  return { available, max: asAnswerCount(answer.maxScratchOrgs) };
}

/**
 * What the answer of sf hardis:scratch:pool:view --json means for the panel.
 * @param result the parsed answer of execSfdxJson, a failure included
 */
export function readScratchOrgPoolOutcome(result: any): ScratchOrgPoolOutcome {
  const answer = result?.result;
  if (result?.status === 0 && answer && typeof answer === "object") {
    if (answer.status === 0 && answer.pool && typeof answer.pool === "object") {
      return { pool: sanitizeScratchOrgPool(answer.pool) };
    }
    const message = cleanText(answer.errorMessage, MAX_ERROR_LENGTH);
    if (answer.errorKind === "noPool") {
      return { error: { kind: "noPool", message } };
    }
    if (answer.errorKind === "noGitProvider") {
      return { error: { kind: "noGitProvider", message } };
    }
    if (answer.errorKind === "storageError") {
      return { error: { kind: "other", message } };
    }
    // An older sfdx-hardis answers neither the pool nor the kind of its failure
    return { error: { kind: "cliTooOld", message: "" } };
  }
  return {
    error: { kind: "other", message: scratchOrgPoolErrorMessage(result) },
  };
}

/**
 * The pool with only the fields the panel draws, each one of the type it expects, and every
 * address that is not http(s) removed. Anything else sfdx-hardis could answer stays here.
 */
export function sanitizeScratchOrgPool(pool: any): ScratchOrgPoolView {
  const keyStatus = KEY_STATUSES.includes(pool?.keyStatus)
    ? (pool.keyStatus as ScratchOrgPoolKeyStatus)
    : "notNeeded";
  return {
    storageService: cleanText(pool?.storageService, 50),
    dashboardUrl: safeWebUrl(pool?.dashboardUrl) || null,
    available: asAnswerCount(pool?.available),
    max: asAnswerCount(pool?.max),
    canTake: pool?.canTake === true,
    keyStatus,
    orgs: asObjects(pool?.orgs).map((org) => ({
      alias: cleanText(org.alias),
      username: cleanText(org.username),
      createdDate: cleanText(org.createdDate, 50),
      expirationDate: cleanText(org.expirationDate, 50),
      daysLeft:
        typeof org.daysLeft === "number" && Number.isFinite(org.daysLeft)
          ? org.daysLeft
          : null,
    })),
    history: asObjects(pool?.history).map((taken) => ({
      date: cleanText(taken.date, 50),
      by: cleanText(taken.by),
      branch: cleanText(taken.branch),
      pullRequest: cleanText(taken.pullRequest),
      jobUrl: safeWebUrl(taken.jobUrl),
      alias: cleanText(taken.alias),
    })),
    failures: asObjects(pool?.failures).map((failure) => ({
      date: cleanText(failure.date, 50),
      error: cleanText(failure.error, MAX_ERROR_LENGTH),
      jobUrl: safeWebUrl(failure.jobUrl),
    })),
    lastRefresh:
      pool?.lastRefresh && typeof pool.lastRefresh === "object"
        ? {
            date: cleanText(pool.lastRefresh.date, 50),
            jobUrl: safeWebUrl(pool.lastRefresh.jobUrl),
          }
        : null,
    devHubLimits: sanitizeDevHubLimits(pool?.devHubLimits),
  };
}

/** Message of a failed --json command, as sfdx-hardis wrote it */
export function scratchOrgPoolErrorMessage(result: any): string {
  return failedCommandMessage(result, MAX_ERROR_LENGTH);
}

function sanitizeDevHubLimits(limits: any): ScratchOrgPoolView["devHubLimits"] {
  if (!limits || typeof limits !== "object") {
    return null;
  }
  return {
    activeScratchOrgs: sanitizeLimit(limits.activeScratchOrgs),
    dailyScratchOrgs: sanitizeLimit(limits.dailyScratchOrgs),
  };
}

function sanitizeLimit(limit: any): ScratchOrgPoolLimit {
  return { used: asAnswerCount(limit?.used), max: asAnswerCount(limit?.max) };
}

function asObjects(value: unknown): any[] {
  return asAnswerObjects(value, MAX_ROWS);
}

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return cleanAnswerText(value, maxLength);
}
