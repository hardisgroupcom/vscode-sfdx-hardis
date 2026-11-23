/*
Whether an org can be used from this computer, and the command that logs in to it again. One rule
and one command line for every panel: the Status tree, the Orgs Manager, the Metadata Retriever,
Metadata Dependencies and the development orgs of the DevOps Pipeline. No vscode import, so it runs
in the unit tests as is.

The Orgs Manager webview keeps a copy of isOrgConnected (orgConnectionState in
s/orgManager/orgManager.js): webview code cannot import the extension sources.
*/

import { quote } from "./shellQuote";

// A Salesforce username: an email address shape
const USERNAME_PATTERN = /^[\w.+'-]+@[\w.-]+$/;
// The instance URL of an org: https and a host name
const INSTANCE_URL_PATTERN = /^https:\/\/[\w.-]+(:\d+)?\/?$/i;

/**
 * Whether an org, as `sf org list` or `sf org display` describes it, can be used: its connection
 * probe answered Connected (or Authorized), or, for a scratch org (never probed, its Dev Hub
 * answers in status), it is Active. An expired or deleted scratch org never is.
 */
export function isOrgConnected(org: any): boolean {
  if (!org) {
    return false;
  }
  const status = String(org.status || "").toLowerCase();
  if (status === "expired" || status === "deleted") {
    return false;
  }
  const connectedStatus = String(org.connectedStatus || "")
    .trim()
    .toLowerCase();
  if (connectedStatus !== "") {
    return connectedStatus === "connected" || connectedStatus === "authorized";
  }
  return status === "active";
}

/**
 * The command that logs in to an org again, run in the command runner. With a usable instance
 * URL, a new web login there (--reconnect), replacing the login of the username when one is given:
 * sfdx-hardis deletes its auth file first. Without one, sfdx-hardis checks the org of the username,
 * or lists the orgs when there is no username either. A value that is not a username or an https
 * instance URL is left out, and every value is quoted.
 * @param options.setDefault true: the org becomes the default one, false: it does not, undefined:
 * sfdx-hardis asks
 * @param options.devHub log in to a Dev Hub (the default Dev Hub with setDefault)
 */
export function buildOrgReconnectCommand(options: {
  username?: unknown;
  instanceUrl?: unknown;
  setDefault?: boolean;
  devHub?: boolean;
}): string {
  const parts = ["sf hardis:org:select"];
  const instanceUrl = String(options.instanceUrl ?? "").trim();
  if (INSTANCE_URL_PATTERN.test(instanceUrl)) {
    parts.push(
      "--reconnect",
      `--instance-url ${quote(instanceUrl.replace(/\/+$/, ""))}`,
    );
  }
  const username = String(options.username ?? "").trim();
  if (isSafeUsername(username)) {
    parts.push(`--username ${quote(username)}`);
  }
  if (options.devHub === true) {
    parts.push("--devhub");
  }
  if (options.setDefault === true) {
    parts.push("--set-default");
  } else if (options.setDefault === false) {
    parts.push("--no-set-default");
  }
  return parts.join(" ");
}

/**
 * The command that opens an org in the browser, quoted. Panels run it through openOrgFromCommand
 * (orgUtils), which asks for the link and lets VS Code open it.
 * @param targetOrg a username or an alias
 * @param options.path a page of the org, such as a Setup page
 */
export function buildOrgOpenCommand(
  targetOrg: string,
  options: { path?: string } = {},
): string {
  return (
    `sf org open --target-org ${quote(targetOrg)}` +
    (options.path ? ` --path ${quote(options.path)}` : "")
  );
}

/** Whether a value is a username that can be put on a command line */
export function isSafeUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME_PATTERN.test(value);
}
