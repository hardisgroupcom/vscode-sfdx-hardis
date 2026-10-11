/*
Helpers of the DORA metrics panel (src/commands/showDoraMetrics.ts).

The panel only draws the result of sf hardis:doc:dora-report: nothing here computes a metric.
This module builds the commands, tells the kinds of failure apart and keeps only web addresses
in what goes to the webview. No vscode import, so it runs in the unit tests as is.
*/

import { stripAnsiCodes } from "./ansiColors";

// Periods the panel offers, in days
export const DORA_PERIODS = [30, 90, 180, 365];
export const DORA_DEFAULT_PERIOD = 90;

// noGitProvider: no token to read the git provider with
// oldCli: the installed sfdx-hardis does not know the flags of the panel, or answers the old report
// cli: anything else, with the message of sfdx-hardis
export type DoraErrorKind = "noGitProvider" | "oldCli" | "cli";

export interface DoraPanelError {
  kind: DoraErrorKind;
  message: string;
}

export type DoraOutcome = { report: any } | { error: DoraPanelError };

/** One of the periods of the panel: anything else becomes the default one */
export function normalizeDoraPeriod(value: unknown): number {
  const period = Number(value);
  return DORA_PERIODS.includes(period) ? period : DORA_DEFAULT_PERIOD;
}

/** The command the panel reads its data with: no file written, no notification sent */
export function buildDoraReportCommand(
  period: number,
  options: { refresh: boolean },
): string {
  const refresh = options.refresh ? " --refresh" : "";
  return `sf hardis:doc:dora-report --agent --data-only --compare --period ${normalizeDoraPeriod(period)}${refresh}`;
}

/** The real report command, run in the command runner by the Export menu */
export function buildDoraExportCommand(period: number, pdf: boolean): string {
  return `sf hardis:doc:dora-report --period ${normalizeDoraPeriod(period)}${pdf ? " --pdf" : ""}`;
}

/** Key of the last result kept for a workspace and a period */
export function doraCacheKey(workspaceRoot: string, period: number): string {
  return `dora-metrics:${workspaceRoot}:${normalizeDoraPeriod(period)}`;
}

/**
 * What the answer of sf hardis:doc:dora-report --json means for the panel.
 * @param result the parsed answer of execSfdxJson, a failure included
 * @param hasGitProviderToken true when the command received a git provider token
 */
export function readDoraOutcome(
  result: any,
  hasGitProviderToken: boolean,
): DoraOutcome {
  if (result?.status === 0 && result?.result) {
    // The report of an older sfdx-hardis is read from an org: it has no branches
    if (!Array.isArray(result.result.branches)) {
      return { error: { kind: "oldCli", message: "" } };
    }
    return { report: sanitizeDoraReport(result.result) };
  }
  const message = doraErrorMessage(result);
  if (isCliTooOldForDoraPanel(result)) {
    return { error: { kind: "oldCli", message } };
  }
  if (!hasGitProviderToken) {
    return { error: { kind: "noGitProvider", message } };
  }
  return { error: { kind: "cli", message } };
}

/**
 * The report with every address that is not http(s) removed, so that nothing else can be
 * opened from the panel. The rest is left as sfdx-hardis wrote it.
 */
export function sanitizeDoraReport(report: any): any {
  const branches = (Array.isArray(report?.branches) ? report.branches : []).map(
    (branch: any) => ({
      ...branch,
      failedDeployments: asArray(branch?.failedDeployments).map(
        (failed: any) => ({
          ...failed,
          runUrl: safeWebUrl(failed?.runUrl),
          pullRequest: failed?.pullRequest
            ? {
                ...failed.pullRequest,
                url: safeWebUrl(failed.pullRequest.url),
              }
            : null,
        }),
      ),
      slowPullRequests: asArray(branch?.slowPullRequests).map(
        withSafePullRequestUrl,
      ),
      hotfixPullRequests: asArray(branch?.hotfixPullRequests).map(
        withSafePullRequestUrl,
      ),
      attention: asArray(branch?.attention).map((item: any) => ({
        ...item,
        url: safeWebUrl(item?.url) || null,
      })),
    }),
  );
  return {
    ...report,
    branches,
    pipeline: sanitizeDoraPipeline(report?.pipeline),
    contributors: asArray(report?.contributors),
  };
}

/** The address when it is an http(s) one, else an empty string */
export function safeWebUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const url = value.trim();
  return /^https?:\/\/[^\s"'<>`]+$/i.test(url) ? url : "";
}

/**
 * True when the installed sfdx-hardis does not know the flags of the panel: the CLI then
 * answers a "Nonexistent flag" parsing error.
 */
export function isCliTooOldForDoraPanel(result: any): boolean {
  const text = [result?.name, result?.message, result?.stderr, result?.stdout]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join("\n");
  return /NonexistentFlagsError|Nonexistent flags?:?\s*--/i.test(text);
}

/** Message of a failed --json command, as sfdx-hardis wrote it */
export function doraErrorMessage(result: any): string {
  if (typeof result?.message === "string" && result.message.trim() !== "") {
    return stripAnsiCodes(result.message.trim());
  }
  const stderr = String(result?.stderr || "").trim();
  if (stderr !== "" && !stderr.startsWith("{")) {
    return stripAnsiCodes(stderr).slice(0, 2000);
  }
  return "";
}

// The pipeline flow with its lists made lists of objects and its addresses checked. null when
// sfdx-hardis computed none, or is too old to compute one
function sanitizeDoraPipeline(pipeline: any): any {
  if (!pipeline || typeof pipeline !== "object") {
    return null;
  }
  return {
    ...pipeline,
    stages: asObjects(pipeline.stages).map((stage: any) => ({
      ...stage,
      waiting: {
        ...(stage.waiting || {}),
        changes: asObjects(stage.waiting?.changes).map(withSafePullRequestUrl),
      },
    })),
    steps: asObjects(pipeline.steps),
    weeks: asObjects(pipeline.weeks),
    slowestChanges: asObjects(pipeline.slowestChanges).map((change: any) => ({
      ...withSafePullRequestUrl(change),
      stages: asObjects(change.stages),
    })),
  };
}

function asObjects(value: unknown): any[] {
  return asArray(value).filter((item) => item && typeof item === "object");
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function withSafePullRequestUrl(pullRequest: any): any {
  return { ...pullRequest, url: safeWebUrl(pullRequest?.url) };
}
