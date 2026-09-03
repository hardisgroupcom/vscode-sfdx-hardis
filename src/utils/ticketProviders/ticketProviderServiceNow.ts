import * as vscode from "vscode";
import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";
import { SecretsManager } from "../secretsManager";
import { getJson, HttpError } from "../httpUtils";
import { t } from "../../i18n/i18n";
import { showAuthFailureGuidance } from "../providerCredentials";

/**
 * Record number prefix -> ServiceNow table, mirroring the mapping of the
 * sfdx-hardis CLI connector. A ServiceNow record number carries its table, so
 * the number alone is enough to know where to read it.
 */
const SERVICENOW_TABLE_BY_PREFIX: Record<string, string> = {
  INC: "incident",
  PRB: "problem",
  CHG: "change_request",
  RITM: "sc_req_item",
  REQ: "sc_request",
  SCTASK: "sc_task",
  TASK: "task",
  DMND: "dmn_demand",
  STRY: "rm_story",
  STORY: "rm_story",
  ENHC: "rm_enhancement",
  KB: "kb_knowledge",
};

// Secret keys named after the CI/CD variables of the CLI connector, so a
// developer who already exported them in their shell is connected without
// entering anything (SecretsManager.getSecret falls back to process.env).
const SERVICENOW_URL_KEY = "SERVICENOW_URL";
const SERVICENOW_USERNAME_KEY = "SERVICENOW_USERNAME";
const SERVICENOW_PASSWORD_KEY = "SERVICENOW_PASSWORD";

const SERVICENOW_DOC_URL =
  "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-servicenow/";

const REQUEST_TIMEOUT_MS = 30000;
// The credential check runs on every pipeline load, so it gives up sooner than
// a record read: an unreachable instance must not hold the panel back
const CHECK_TIMEOUT_MS = 10000;

export class ServiceNowProvider extends TicketProvider {
  static readonly providerName: TicketProviderName = "SERVICENOW";
  static readonly providerLabel = "ServiceNow";

  private instanceUrl: string = "";
  private user: string = "";
  private password: string = "";

  constructor() {
    super();
    this.providerName = "SERVICENOW";
  }

  /** SERVICENOW_URL may be a bare instance host or a full URL, with or without a trailing slash */
  static completeInstanceUrl(rawUrl: string): string {
    const raw = (rawUrl || "").trim();
    if (!raw) {
      return "";
    }
    const withScheme = raw.startsWith("http") ? raw : `https://${raw}`;
    return withScheme.replace(/\/+$/, "");
  }

  /**
   * Record number prefix -> table, with the tables declared by the project merged in.
   *
   * serviceNowTablePrefixes takes the form `PREFIX:table,PREFIX:table`, so the tables
   * of a scoped application (`STRY:x_acme_story`) are reachable without a code change.
   * A prefix declared there overrides the built-in mapping of the same name.
   */
  static prefixTableMap(config: any = {}): Record<string, string> {
    const map = { ...SERVICENOW_TABLE_BY_PREFIX };
    const raw = config?.serviceNowTablePrefixes || "";
    for (const entry of String(raw).split(",")) {
      const [prefix, table] = entry
        .split(":")
        .map((part) => (part || "").trim());
      if (prefix && table) {
        map[prefix.toUpperCase()] = table;
      }
    }
    return map;
  }

  /**
   * Regex source matching every known prefix, built from the mapping so a custom
   * table is detected too. The whole record number is capture group 1, the
   * convention a project writing its own serviceNowTicketRegex has to follow.
   */
  static numberRegexSource(config: any = {}): string {
    // Longest prefix first, so SCTASK is not consumed as the shorter TASK
    const prefixes = Object.keys(
      ServiceNowProvider.prefixTableMap(config),
    ).sort((a, b) => b.length - a.length);
    return `\\b((?:${prefixes.join("|")})[0-9]{4,})\\b`;
  }

  /** Table a record number belongs to, or null when its prefix is not mapped */
  static tableOfTicketId(ticketId: string, config: any = {}): string | null {
    const match = (ticketId || "")
      .trim()
      .toUpperCase()
      .match(/^([A-Z_]+)([0-9]{4,})$/);
    if (!match) {
      return null;
    }
    return ServiceNowProvider.prefixTableMap(config)[match[1]] || null;
  }

  async getTicketingWebUrl(): Promise<string | null> {
    if (!this.instanceUrl) {
      this.instanceUrl = ServiceNowProvider.completeInstanceUrl(
        (await SecretsManager.getSecret(SERVICENOW_URL_KEY)) || "",
      );
    }
    return this.instanceUrl || null;
  }

  async initializeConnection(): Promise<boolean | null> {
    this.instanceUrl = ServiceNowProvider.completeInstanceUrl(
      (await SecretsManager.getSecret(SERVICENOW_URL_KEY)) || "",
    );
    this.user = (await SecretsManager.getSecret(SERVICENOW_USERNAME_KEY)) || "";
    this.password =
      (await SecretsManager.getSecret(SERVICENOW_PASSWORD_KEY)) || "";
    if (!this.instanceUrl || !this.user || !this.password) {
      Logger.log(
        "ServiceNow instance URL, user name or password is missing: not connected",
      );
      return false;
    }
    return await this.checkCredentials({ showGuidanceOnFailure: false });
  }

  /**
   * Asks for the instance URL, the user name and the password of the ServiceNow
   * integration user, then validates them.
   *
   * ServiceNow has no token creation page to open, so the guided modal of
   * promptForToken() would have nothing to offer: the three values are asked in
   * a row instead, the instance URL and the user name pre-filled with what is
   * already stored so a password change does not mean retyping everything.
   */
  async authenticate(): Promise<boolean | null> {
    const currentUrl = ServiceNowProvider.completeInstanceUrl(
      (await SecretsManager.getSecret(SERVICENOW_URL_KEY)) || "",
    );
    const instanceUrl = await vscode.window.showInputBox({
      prompt: t("enterServiceNowUrl"),
      placeHolder: t("serviceNowUrlPlaceholder"),
      value: currentUrl,
      ignoreFocusOut: true,
    });
    if (!instanceUrl) {
      return null;
    }
    const user = await vscode.window.showInputBox({
      prompt: t("enterServiceNowUsername"),
      placeHolder: t("usernamePlaceholder"),
      value: (await SecretsManager.getSecret(SERVICENOW_USERNAME_KEY)) || "",
      ignoreFocusOut: true,
    });
    if (!user) {
      return null;
    }
    const password = await vscode.window.showInputBox({
      prompt: t("enterServiceNowPassword"),
      ignoreFocusOut: true,
      password: true,
    });
    if (!password) {
      return null;
    }
    this.instanceUrl = ServiceNowProvider.completeInstanceUrl(instanceUrl);
    this.user = user;
    this.password = password;
    const connected = await this.checkCredentials({
      showGuidanceOnFailure: true,
    });
    if (!connected) {
      return false;
    }
    await SecretsManager.setSecret(SERVICENOW_URL_KEY, this.instanceUrl);
    await SecretsManager.setSecret(SERVICENOW_USERNAME_KEY, this.user);
    await SecretsManager.setSecret(SERVICENOW_PASSWORD_KEY, this.password);
    return true;
  }

  async disconnect(): Promise<void> {
    for (const key of [
      SERVICENOW_URL_KEY,
      SERVICENOW_USERNAME_KEY,
      SERVICENOW_PASSWORD_KEY,
    ]) {
      try {
        await SecretsManager.deleteSecret(key);
      } catch {
        // Ignore errors for non-existent keys
      }
    }
    await this.markDisconnected();
    this.isAuthenticated = false;
    this.instanceUrl = "";
    this.user = "";
    this.password = "";
    Logger.log("Disconnected from ServiceNow");
  }

  /** Basic auth header: the ServiceNow Table API takes no bearer token */
  private authHeaders(): Record<string, string> {
    return {
      Authorization:
        "Basic " +
        Buffer.from(`${this.user}:${this.password}`).toString("base64"),
      Accept: "application/json",
    };
  }

  /**
   * Validates the credentials with the cheapest authenticated read there is.
   *
   * A 401 is the only answer that proves the credentials are wrong: an instance
   * where the integration user may not read `sys_user` answers 403, and that
   * still means the sign-in itself succeeded.
   */
  private async checkCredentials(options: {
    showGuidanceOnFailure: boolean;
  }): Promise<boolean> {
    const url = `${this.instanceUrl}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id`;
    try {
      await getJson(url, {
        headers: this.authHeaders(),
        timeoutMs: CHECK_TIMEOUT_MS,
      });
      this.isAuthenticated = true;
      Logger.log(`ServiceNow authentication successful on ${this.instanceUrl}`);
      return true;
    } catch (error: any) {
      const status = error instanceof HttpError ? error.status : 0;
      if (status === 403) {
        this.isAuthenticated = true;
        Logger.log(
          `ServiceNow authentication successful on ${this.instanceUrl} (the user may not read sys_user, which does not prevent reading records)`,
        );
        return true;
      }
      Logger.log(
        `ServiceNow authentication failed: ${error?.message || String(error)}`,
      );
      this.isAuthenticated = false;
      if (options.showGuidanceOnFailure) {
        await showAuthFailureGuidance({
          providerName: "ServiceNow",
          guidance: t("serviceNowAuthInfo"),
          docUrl: SERVICENOW_DOC_URL,
        });
      }
      return false;
    }
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    const config = await getConfig("project");
    const customRegex = config.serviceNowTicketRegex;
    // No URL-based regex: a ServiceNow URL carries the record number itself
    // (`incident.do?sysparm_query=number=INC0012345`), so the number regex below
    // already collects the records mentioned as links.
    return [
      new RegExp(
        customRegex || ServiceNowProvider.numberRegexSource(config),
        "gim",
      ),
    ];
  }

  /**
   * Collects the record numbers of a commit message, a branch name or a Pull
   * Request body.
   *
   * Nothing is returned when the instance is unknown: several ServiceNow
   * prefixes are ordinary words followed by digits (`TASK1234`, `REQ1234`), and
   * a project that has not connected yet must not see them turn into tickets
   * pointing nowhere.
   */
  async getTicketsFromString(str: string): Promise<Ticket[]> {
    if (!(await this.getTicketingWebUrl())) {
      return [];
    }
    return await super.getTicketsFromString(str);
  }

  /** Link usable before the record has been read: ServiceNow resolves the form from the number */
  async buildTicketUrl(ticketId: string): Promise<string> {
    const config = await getConfig("project");
    const number = (ticketId || "").trim().toUpperCase();
    const table = ServiceNowProvider.tableOfTicketId(number, config);
    const instanceUrl = await this.getTicketingWebUrl();
    if (!instanceUrl || !table) {
      return "";
    }
    return `${instanceUrl}/${table}.do?sysparm_query=number=${number}`;
  }

  /** Field values come back as { value, display_value } with sysparm_display_value=all */
  private static fieldValue(record: any, fieldName: string): string {
    const field = record?.[fieldName];
    if (field === undefined || field === null) {
      return "";
    }
    if (typeof field === "object") {
      return String(field.display_value ?? field.value ?? "");
    }
    return String(field);
  }

  /** Raw value of a field, used for the identifiers that carry no display value */
  private static rawFieldValue(record: any, fieldName: string): string {
    const field = record?.[fieldName];
    if (field === undefined || field === null) {
      return "";
    }
    if (typeof field === "object") {
      return String(field.value ?? field.display_value ?? "");
    }
    return String(field);
  }

  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    if (!this.isAuthenticated) {
      Logger.log(
        "ServiceNow connector not authenticated. Call authenticate() first.",
      );
      return ticket;
    }
    const config = await getConfig("project");
    const number = (ticket.id || "").trim().toUpperCase();
    const table = ServiceNowProvider.tableOfTicketId(number, config);
    if (!table) {
      // A custom serviceNowTicketRegex can match a prefix no table is declared
      // for: say which mapping is missing rather than emit a dead link
      Logger.log(
        `No ServiceNow table declared for the prefix of ${number}: declare it in serviceNowTablePrefixes`,
      );
      ticket.foundOnServer = false;
      return ticket;
    }
    try {
      // sysparm_display_value=all returns both the raw value and the human label
      // of every field, so reference fields read as names rather than sys_ids
      const url =
        `${this.instanceUrl}/api/now/table/${table}` +
        `?sysparm_query=number=${encodeURIComponent(number)}` +
        `&sysparm_limit=1&sysparm_display_value=all`;
      const response = await getJson<any>(url, {
        headers: this.authHeaders(),
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const record = (response?.result || [])[0];
      if (!record) {
        // The number matched the shape but no record answers: a typo, or a table
        // the integration user may not read
        Logger.log(`No ${table} record numbered ${number} in ServiceNow`);
        ticket.foundOnServer = false;
        return ticket;
      }
      ticket.subject = ServiceNowProvider.fieldValue(
        record,
        "short_description",
      );
      ticket.status = ServiceNowProvider.rawFieldValue(record, "state");
      ticket.statusLabel = ServiceNowProvider.fieldValue(record, "state");
      ticket.body = ServiceNowProvider.fieldValue(record, "description");
      const assignee = ServiceNowProvider.fieldValue(record, "assigned_to");
      const reporter =
        ServiceNowProvider.fieldValue(record, "opened_by") ||
        ServiceNowProvider.fieldValue(record, "sys_created_by");
      if (assignee) {
        ticket.author = ServiceNowProvider.rawFieldValue(record, "assigned_to");
        ticket.authorLabel = assignee;
      } else if (reporter) {
        ticket.author =
          ServiceNowProvider.rawFieldValue(record, "opened_by") || reporter;
        ticket.authorLabel = reporter;
      }
      const sysId = ServiceNowProvider.rawFieldValue(record, "sys_id");
      if (sysId) {
        ticket.url = `${this.instanceUrl}/nav_to.do?uri=/${table}.do?sys_id=${sysId}`;
      }
      ticket.foundOnServer = true;
      Logger.log(`Collected data for ServiceNow record ${number}`);
    } catch (error: any) {
      Logger.log(
        `Error fetching ServiceNow record ${number}: ${error?.message || String(error)}`,
      );
      ticket.foundOnServer = false;
    }
    return ticket;
  }
}
