// jscpd:ignore-start
import * as vscode from "vscode";
import { PROVIDER_BATCH_PROFILES, isThrottlingError } from "../concurrency";
import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";
import { SecretsManager } from "../secretsManager";
import { getJson, HttpError } from "../httpUtils";
import { t } from "../../i18n/i18n";
import {
  promptForToken,
  showAuthFailureGuidance,
} from "../providerCredentials";
// jscpd:ignore-end

const AHA_DOC_URL =
  "https://sfdx-hardis.cloudity.com/salesforce-devops-setup-integration-aha/";

// Same default as the sfdx-hardis CLI connector. A feature reference is a
// workspace prefix and a number (PROD-12): the prefix starts with a letter, and
// nothing may follow with a dash, because PROD-12-3 is a requirement, PROD-E-4
// an epic and PROD-R-2 a release.
const AHA_DEFAULT_TICKET_REGEX =
  "(?<=[^a-zA-Z0-9_-]|^)([A-Za-z][A-Za-z0-9]{1,9}-\\d{1,6})(?=[^a-zA-Z0-9_-]|$)";
// Link to a feature, on the account host or a regional one (acme.euw4.aha.io).
// Group 1 is the host, group 2 the reference.
const AHA_FEATURE_URL_REGEX =
  /https:\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.aha\.io)\/features\/([A-Za-z][A-Za-z0-9]*-\d+)(?![\w-])/g;
// What a feature reference looks like, whatever regex found it
const AHA_REFERENCE_SHAPE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
// Fields read for a feature: the full payload carries scores, releases and
// initiatives the DevOps Pipeline has no use for
const AHA_FEATURE_FIELDS =
  "name,reference_num,workflow_status,assigned_to_user,created_by_user,description,url";

const REQUEST_TIMEOUT_MS = 30000;
// The credential check runs on every pipeline load, so it gives up sooner than
// a feature read: an unreachable account must not hold the panel back
const CHECK_TIMEOUT_MS = 10000;

/**
 * Value of a setting the CLI connector reads with `getEnvVar(name) || config?.property`,
 * in the same order, so the extension collects the features the commands it
 * launches on the same project will collect.
 */
function envOrConfig(envVarName: string, configValue: any): string {
  const fromEnv = (process.env[envVarName] || "").trim();
  return fromEnv || (configValue ? String(configValue) : "");
}

export class AhaProvider extends TicketProvider {
  static readonly providerName: TicketProviderName = "AHA";

  private host: string = "";
  private apiKey: string = "";

  constructor() {
    super();
    this.providerName = "AHA";
  }

  /**
   * ahaHost may be a bare account host or a full URL, with or without a path.
   * Always https: the API key must never leave in clear text because of a
   * scheme typed by hand.
   */
  static completeHostUrl(host: string): string {
    const trimmed = (host || "").trim();
    if (!trimmed) {
      return "";
    }
    try {
      const withScheme = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      return `https://${new URL(withScheme).host}`;
    } catch {
      return "";
    }
  }

  /**
   * True for the host of the project, and for another aha.io host of the same
   * account: Aha! serves an account on its main host (acme.aha.io) and on a
   * regional one (acme.euw4.aha.io).
   */
  static isSameAccount(otherHost: string, projectHostUrl: string): boolean {
    try {
      const other = otherHost.toLowerCase();
      const project = new URL(projectHostUrl).host.toLowerCase();
      return (
        other === project ||
        (other.endsWith(".aha.io") &&
          project.endsWith(".aha.io") &&
          other.split(".")[0] === project.split(".")[0])
      );
    } catch {
      return false;
    }
  }

  async getTicketingWebUrl(): Promise<string | null> {
    return (await this.refreshHost()) || null;
  }

  async initializeConnection(): Promise<boolean | null> {
    if (!(await this.refreshHost())) {
      Logger.log("Aha! host not configured.");
      return false;
    }
    this.apiKey = (await SecretsManager.getSecret(this.secretKey())) || "";
    if (!this.apiKey) {
      return false;
    }
    const check = await this.checkCredentials();
    // Only a refused key disconnects. An account that does not answer, or that
    // throttles, says nothing about the stored key: the panel keeps it, and the
    // feature reads that follow tell whether Aha! is back
    this.isAuthenticated = check !== "refused";
    return this.isAuthenticated;
  }

  async authenticate(): Promise<boolean | null> {
    if (!(await this.refreshHost())) {
      Logger.log(
        "Aha! host not configured. Please set ahaHost in .sfdx-hardis.yml",
      );
      this.openPipelineSettingsOn(t("ahaHostNotConfigured"));
      return false;
    }
    const apiKey = await promptForToken({
      providerLabel: "Aha!",
      inputPrompt: t("enterAhaApiKey"),
      createTokenOptions: [
        {
          id: "apiKey",
          label: t("createAhaApiKey"),
          url: `${this.host}/settings/api_keys`,
        },
      ],
    });
    if (!apiKey) {
      return null;
    }
    const previousApiKey = this.apiKey;
    this.apiKey = apiKey;
    const check = await this.checkCredentials();
    if (check !== "accepted") {
      // Nothing was stored, so the key must not survive in the cached provider either
      this.apiKey = previousApiKey;
      this.isAuthenticated = false;
      if (check === "refused") {
        await showAuthFailureGuidance({
          providerName: "Aha!",
          guidance: t("ahaAuthInfo"),
          createTokenUrl: `${this.host}/settings/api_keys`,
          docUrl: AHA_DOC_URL,
        });
      } else {
        // The key was never judged: sending the user to create another one
        // would have them fix the wrong thing
        this.openPipelineSettingsOn(
          t("ahaHostUnreachable", { host: this.host }),
        );
      }
      return false;
    }
    this.isAuthenticated = true;
    await SecretsManager.setSecret(this.secretKey(), apiKey);
    return true;
  }

  async disconnect(): Promise<void> {
    if (await this.refreshHost()) {
      try {
        await SecretsManager.deleteSecret(this.secretKey());
      } catch {
        // Ignore errors for non-existent keys
      }
      Logger.log(`Disconnected from Aha! host: ${this.host}`);
    }
    await this.markDisconnected();
    this.isAuthenticated = false;
    this.apiKey = "";
  }

  /**
   * API key of the connected account, for the commands launched from the
   * extension. The host is read again first: the CLI reads ahaHost from the
   * same configuration, and a key must only travel to the account it belongs to.
   */
  async getApiKeyForCommands(): Promise<string> {
    await this.refreshHost();
    return this.isAuthenticated ? this.apiKey : "";
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    const config = await getConfig("project");
    const customRegex = envOrConfig("AHA_TICKET_REGEX", config.ahaTicketRegex);
    const regexes: RegExp[] = [AHA_FEATURE_URL_REGEX];
    try {
      regexes.push(new RegExp(customRegex || AHA_DEFAULT_TICKET_REGEX, "gm"));
    } catch (error: any) {
      // A malformed ahaTicketRegex must cost its own tickets, not the whole
      // Pull Request load of the DevOps Pipeline
      Logger.log(
        `Invalid Aha! ticket regex "${customRegex}": ${error?.message || String(error)}`,
      );
    }
    return regexes;
  }

  /**
   * Collects the features of a commit message, a branch name or a Pull Request
   * body, the way the CLI connector does:
   * - nothing in a project that does not name its Aha! account;
   * - a link to a feature of another account is left alone, its reference
   *   would be read in the account of the project;
   * - Aha! only knows a reference in uppercase, so `prod-12` in a branch name
   *   and `PROD-12` in a commit are the same feature, listed once.
   */
  async getTicketsFromString(str: string): Promise<Ticket[]> {
    const host = await this.refreshHost();
    if (!host) {
      return [];
    }
    const tickets: Ticket[] = [];
    const seenIds = new Set<string>();
    const add = (reference: string, url?: string) => {
      const id = reference.trim().toUpperCase();
      if (!seenIds.has(id)) {
        seenIds.add(id);
        tickets.push({
          id,
          provider: "AHA",
          url: url || `${host}/features/${id}`,
        });
      }
    };
    const [urlRegex, referenceRegex] = await this.getTicketIdentifierRegexes();
    for (const match of str.matchAll(urlRegex)) {
      if (AhaProvider.isSameAccount(match[1], host)) {
        add(match[2], match[0]);
      }
    }
    if (!referenceRegex) {
      return tickets;
    }
    // The reference inside a link to another account must not come back as a bare reference
    const ownText = str.replace(urlRegex, (link, linkHost) =>
      AhaProvider.isSameAccount(linkHost, host) ? link : " ",
    );
    for (const match of ownText.matchAll(referenceRegex)) {
      // The reference is capture group 1, like in the CLI. A project regex
      // without a group leaves it in the whole match: keep whichever of the two
      // is a feature reference
      const reference = [match[1], match[0]].find((candidate) =>
        AHA_REFERENCE_SHAPE.test((candidate || "").trim()),
      );
      if (reference) {
        add(reference);
      }
    }
    return tickets;
  }

  async buildTicketUrl(ticketId: string): Promise<string> {
    const host = await this.refreshHost();
    if (!host) {
      return "";
    }
    return `${host}/features/${(ticketId || "").trim().toUpperCase()}`;
  }

  get batchSizes(): readonly number[] {
    return PROVIDER_BATCH_PROFILES.aha;
  }

  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    if (!this.isAuthenticated || !this.apiKey) {
      Logger.log(
        "Aha! connector not authenticated. Call authenticate() first.",
      );
      return ticket;
    }
    const reference = (ticket.id || "").trim().toUpperCase();
    try {
      const response = await getJson<any>(
        `${this.host}/api/v1/features/${encodeURIComponent(reference)}?fields=${AHA_FEATURE_FIELDS}`,
        { headers: this.authHeaders(), timeoutMs: REQUEST_TIMEOUT_MS },
      );
      const feature = response?.feature;
      if (!feature) {
        ticket.foundOnServer = false;
        return ticket;
      }
      ticket.subject = feature.name || "";
      ticket.status = feature.workflow_status?.id || "";
      ticket.statusLabel = feature.workflow_status?.name || "";
      ticket.body = AhaProvider.htmlToText(feature.description?.body || "");
      // Prefer the assignee, fall back on the creator
      const owner = feature.assigned_to_user || feature.created_by_user;
      if (owner?.name) {
        ticket.author = owner.id || "";
        ticket.authorLabel = owner.name;
      }
      // The link Aha! answers with is the canonical one, whatever host the API was called on
      if (feature.url) {
        ticket.url = feature.url;
      }
      ticket.foundOnServer = true;
      Logger.log(`Collected data for Aha! feature ${reference}`);
    } catch (error: any) {
      // Aha! pushing back is for the caller: its batches shrink and wait the
      // delay asked for, then read the feature again
      if (isThrottlingError(error)) {
        throw error;
      }
      // A 404 is a reference that is not a feature (UTF-8), or a workspace the user cannot see
      Logger.log(
        `Error fetching Aha! feature ${reference}: ${error?.message || String(error)}`,
      );
      ticket.foundOnServer = false;
    }
    return ticket;
  }

  /** Aha! descriptions are HTML: keep the text, one line per block */
  private static htmlToText(html: string): string {
    return html
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Host of the Aha! account: AHA_HOST first, like the CLI, then ahaHost.
   *
   * Read again at every entry point, because the provider outlives a change of
   * ahaHost in Pipeline Settings. When the account changed, the key of the
   * previous one is dropped: it must not be sent to the new host, by the
   * extension or by a command.
   */
  private async refreshHost(): Promise<string> {
    const config = await getConfig("project");
    const host = AhaProvider.completeHostUrl(
      envOrConfig("AHA_HOST", config.ahaHost),
    );
    if (host !== this.host) {
      if (this.host) {
        Logger.log(`Aha! host changed from ${this.host} to ${host || "none"}`);
        this.apiKey = "";
        this.isAuthenticated = false;
      }
      this.host = host;
    }
    return this.host;
  }

  /** One API key per Aha! account, so switching project does not send a key to another account */
  private secretKey(): string {
    return `${this.host.replace(/\./g, "_").toUpperCase()}_AHA_API_KEY`;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
  }

  private openPipelineSettingsOn(message: string): void {
    const pipelineSettingsLabel = t("pipelineConfig");
    vscode.window
      .showErrorMessage(message, pipelineSettingsLabel)
      .then((action) => {
        if (action === pipelineSettingsLabel) {
          vscode.commands.executeCommand(
            "vscode-sfdx-hardis.showPipelineConfig",
            null,
            "Ticketing",
          );
        }
      });
  }

  /**
   * Asks Aha! who the API key belongs to, the cheapest authenticated read there is.
   *
   * Only a 401 or a 403 is Aha! refusing the key. Anything else (a host that
   * is not an Aha! account, a throttling, a server error, no answer at all)
   * says nothing about the key.
   */
  private async checkCredentials(): Promise<
    "accepted" | "refused" | "unreachable"
  > {
    try {
      await getJson(`${this.host}/api/v1/me`, {
        headers: this.authHeaders(),
        timeoutMs: CHECK_TIMEOUT_MS,
      });
      Logger.log(`Aha! authentication successful on ${this.host}`);
      return "accepted";
    } catch (error: any) {
      const status = error instanceof HttpError ? error.status : 0;
      if (status === 401 || status === 403) {
        Logger.log(
          `Aha! refused the API key (HTTP ${status}): ${error?.message || String(error)}`,
        );
        return "refused";
      }
      Logger.log(
        `Aha! account ${this.host} could not be checked${status ? ` (HTTP ${status})` : ""}: ${error?.message || String(error)}`,
      );
      return "unreachable";
    }
  }
}
