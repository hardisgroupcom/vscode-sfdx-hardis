import * as vscode from "vscode";
import {
  ExecCommandOptions,
  execSfdxJson,
  execSfdxJsonWithProgress,
} from "../utils";
import { t } from "../i18n/i18n";
import { CacheManager } from "./cache-manager";
import { getInternalCommandFailureReason } from "./internalCommandUtils";

export type SalesforceOrg = {
  username?: string;
  alias?: string;
  orgType?: "production" | "sandbox" | "scratch" | "other";
  isDefaultUsername?: boolean;
  isDevHub?: boolean;
  isDefaultDevHubUsername?: boolean;
  isScratch?: boolean;
  isSandbox?: boolean;
  // "Developer Edition", "Enterprise Edition"... The only reliable way to tell a
  // Developer Edition org from a production one: a custom My Domain leaves no
  // trace of it in the instance URL.
  orgEdition?: string;
  instanceUrl?: string;
  instanceApiVersion?: string;
  apiVersion?: string;
  loginUrl?: string;
  orgId?: string;
  createdDate?: string;
  expirationDate?: string | null;
  connectedStatus?: string;
  status?: string; // For scratch orgs: "Active" | "Expired" | "Deleted"
  name?: string;
  // true when the list was built without probing the orgs: connectedStatus is
  // not known yet (a second, complete list follows)
  connectionStatusPending?: boolean;
};

/**
 * Forget the cached `sf org list` answers: an org authenticated or set as default since would not
 * be in them for a week.
 */
export async function forgetCachedOrgList(): Promise<void> {
  for (const all of [false, true]) {
    for (const skipConnectionStatus of [false, true]) {
      await CacheManager.delete(
        "orgs",
        `sf org list${all ? " --all" : ""}${skipConnectionStatus ? " --skip-connection-status" : ""} --json`,
      );
    }
  }
}

export async function listAllOrgs(
  all = false,
  useCache = false,
  skipConnectionStatus = false,
): Promise<SalesforceOrg[]> {
  // List all orgs. Skipping the connection probes of each org (scratch orgs are
  // still checked with their Dev Hub, like the CLI) lets a panel show the orgs
  // quickly and fill the status later.
  const orgListRes = await execSfdxJson(
    `sf org list${all ? " --all" : ""}${skipConnectionStatus ? " --skip-connection-status" : ""}`,
    useCache
      ? { cacheSection: "orgs", cacheExpiration: 1000 * 60 * 60 * 24 * 7 }
      : {}, // 1 week (milliseconds
  );

  // orgListRes.result may contain several arrays grouped by type (other, sandboxes, nonScratchOrgs, devHubs, scratchOrgs, ...)
  // We want to return a single flattened list of orgs. Deduplicate by orgId when present, otherwise by username.
  const result = orgListRes?.result || {};

  // Collect candidate arrays from the result object. If result is an array (older formats), use it directly.
  const buckets: any[] = [];
  if (Array.isArray(result)) {
    buckets.push(...result);
  } else if (typeof result === "object" && result !== null) {
    for (const val of Object.values(result)) {
      if (Array.isArray(val)) {
        buckets.push(...val);
      }
    }
  }
  const seen = new Map<string, SalesforceOrg>();
  for (const org of buckets) {
    if (!org) {
      continue;
    }
    const key =
      org.username || org.orgId || org.instanceUrl || JSON.stringify(org);
    if (seen.has(key)) {
      // already added (avoid duplicates)
      continue;
    }
    // Determine org type
    let orgType: "production" | "sandbox" | "scratch" | "other" = "other";
    if (org.isScratch) {
      orgType = "scratch";
    } else if (
      org.isSandbox ||
      (org.instanceUrl && org.instanceUrl.includes(".sandbox"))
    ) {
      orgType = "sandbox";
    } else if (
      !org.instanceUrl.includes("dev-ed") &&
      !org.instanceUrl.includes("test") &&
      !org.instanceUrl.includes("sandbox")
    ) {
      orgType = "production";
    }
    const normalized: SalesforceOrg = {
      username: org.username,
      alias: org.alias,
      orgType: orgType,
      isDefaultUsername: !!org.isDefaultUsername,
      isDefaultDevHubUsername: !!org.isDefaultDevHubUsername,
      isDevHub: !!org.isDevHub,
      isScratch: !!org.isScratch,
      isSandbox: !!org.isSandbox,
      orgEdition: org.orgEdition,
      instanceUrl: org.instanceUrl,
      instanceApiVersion: org.instanceApiVersion,
      apiVersion: org.instanceApiVersion || org.apiVersion,
      loginUrl: org.loginUrl,
      orgId: org.orgId,
      createdDate: org.createdDate,
      expirationDate: org.expirationDate || org.trailExpirationDate,
      connectedStatus: org.connectedStatus,
      status: org.status, // Pass through scratch org status
      name: org.name,
      // Scratch orgs already carry their final status from the Dev Hub in the
      // skip pass: only non-scratch orgs are actually waiting for a probe
      ...(skipConnectionStatus && !org.connectedStatus && !org.status
        ? { connectionStatusPending: true }
        : {}),
    };
    seen.set(key, normalized);
  }

  // Sort by orgType (production, sandbox, other, scratch), then by instanceUrl
  const orgTypeOrder = { production: 0, sandbox: 1, other: 2, scratch: 3 };
  return Array.from(seen.values()).sort((a, b) => {
    const aType = orgTypeOrder[a.orgType || "other"];
    const bType = orgTypeOrder[b.orgType || "other"];
    if (aType !== bType) {
      return aType - bType;
    }
    const aUrl = a.instanceUrl || "";
    const bUrl = b.instanceUrl || "";
    return aUrl.localeCompare(bUrl);
  });
}

export async function forgetOrgs(orgUsernames: string[]) {
  const results = await Promise.allSettled(
    orgUsernames.map((username) =>
      execSfdxJson(`sf org logout --target-org ${username} --noprompt`),
    ),
  );
  const successUsernames: string[] = [];
  const errorUsernames: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      successUsernames.push(orgUsernames[index]);
    } else {
      errorUsernames.push(orgUsernames[index]);
    }
  });
  return { successUsernames, errorUsernames };
}

export type OrgOpenOutcome = {
  ok: boolean;
  reason: string | null;
  result: any;
};

// What openOrgFromCommand needs from the outside, replaceable in tests
export type OrgOpenRunners = {
  exec: (
    command: string,
    options: ExecCommandOptions,
    progressMessage: string,
  ) => Promise<any>;
  open: (url: string) => Thenable<boolean>;
};

const defaultOrgOpenRunners: OrgOpenRunners = {
  exec: execSfdxJsonWithProgress,
  open: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
};

/**
 * Whether a command is a `sf org open` command that VS Code can open itself: with or without
 * --target-org and --path, but not with a browser choice (--browser, --private: the CLI refuses
 * them with --url-only), and not chained with a shell operator (the regular command path blocks
 * those).
 */
export function isOrgOpenCommand(command: string): boolean {
  const trimmed = command.trim();
  return (
    /^sf org open(\s|$)/.test(trimmed) &&
    !/(^|\s)(--browser|-b|--private)(\s|=|$)/.test(trimmed) &&
    !trimmed.includes("&&") &&
    !trimmed.includes("||")
  );
}

/**
 * Open an org in the user's browser from a `sf org open ...` command (its --target-org and --path
 * flags are kept).
 * `sf org open` opens nothing where the Salesforce CLI runs in container mode (SF_CONTAINER_MODE:
 * Agentforce Vibes, a dev container): it prints the login link and exits 0, so a click on Open
 * ended with nothing. The link is asked with --url-only and opened by VS Code itself, which in a
 * browser-hosted VS Code opens a tab of the user's browser. The link holds a one-time code, so
 * every call runs the CLI again: two clicks never share a link.
 * @param command The `sf org open ...` command a panel or a tree would have run
 * @param progressMessage Shown while the link is fetched
 * @param options env: extra environment variables of the CLI run; runners: for tests
 * @returns ok: the link was opened; reason: why it was not (never empty); result: what the CLI
 * returned, with a status above 0 when it failed, for the callers that report it like any other
 * command
 */
export async function openOrgFromCommand(
  command: string,
  progressMessage: string,
  options: { env?: Record<string, string>; runners?: OrgOpenRunners } = {},
): Promise<OrgOpenOutcome> {
  const runners = options.runners || defaultOrgOpenRunners;
  let result: any;
  try {
    result = await runners.exec(
      withUrlOnly(command),
      {
        fail: false,
        output: false,
        reuseRecentResult: false,
        shareInFlightRun: false,
        env: options.env,
      },
      progressMessage,
    );
  } catch (error: any) {
    result = { status: 1, message: error?.message || String(error) };
  }
  const failureReason = getInternalCommandFailureReason(result);
  if (failureReason !== null) {
    return failedOrgOpen(result, failureReason || t("orgOpenNoLink"));
  }
  const url: string | undefined = result?.result?.url;
  if (!url) {
    return failedOrgOpen(result, t("orgOpenNoLink"));
  }
  // VS Code may refuse the link, for example when the user cancels the confirmation a
  // browser-hosted VS Code shows before opening an external website
  let opened: boolean;
  try {
    opened = (await runners.open(url)) === true;
  } catch (error: any) {
    const message = error?.message || String(error);
    return failedOrgOpen(result, `${t("orgOpenLinkNotOpened")}: ${message}`);
  }
  if (!opened) {
    return failedOrgOpen(result, t("orgOpenLinkNotOpened"));
  }
  return { ok: true, reason: null, result };
}

/** The same `sf org open` command, asking for the link instead of opening a browser */
export function withUrlOnly(command: string): string {
  const trimmed = command.trim();
  if (/(^|\s)(--url-only|-r)(\s|$)/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} --url-only`;
}

/** Tells the user why Open did nothing */
export function showOrgOpenFailure(outcome: OrgOpenOutcome): void {
  vscode.window.showErrorMessage(
    t("failedToOpenOrg", { error: outcome.reason }),
  );
}

// A failed outcome whose result reads as a failed command for the panels (status above 0)
function failedOrgOpen(result: any, reason: string): OrgOpenOutcome {
  const status = Number(result?.status) > 0 ? result.status : 1;
  return {
    ok: false,
    reason,
    result: { ...(result || {}), status, message: result?.message || reason },
  };
}
