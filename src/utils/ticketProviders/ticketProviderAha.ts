// jscpd:ignore-start
import * as vscode from "vscode";
import { PROVIDER_BATCH_PROFILES } from "../concurrency";
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
// Link to a feature, on the account host or a regional one (acme.euw4.aha.io)
const AHA_FEATURE_URL_REGEX =
  /https:\/\/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.aha\.io\/features\/[A-Za-z][A-Za-z0-9]*-\d+(?![\w-])/g;
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

  /** ahaHost may be a bare account host or a full URL, with or without a path */
  static completeHostUrl(host: string): string {
    const trimmed = (host || "").trim();
    if (!trimmed) {
      return "";
    }
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    try {
      return new URL(withScheme).origin;
    } catch {
      return "";
    }
  }

  async getTicketingWebUrl(): Promise<string | null> {
    return (await this.loadHost()) || null;
  }

  async initializeConnection(): Promise<boolean | null> {
    if (!(await this.loadHost())) {
      Logger.log("Aha! host not configured.");
      return false;
    }
    this.apiKey = (await SecretsManager.getSecret(this.secretKey())) || "";
    if (!this.apiKey) {
      return false;
    }
    return await this.checkCredentials({ showGuidanceOnFailure: false });
  }

  async authenticate(): Promise<boolean | null> {
    if (!(await this.loadHost())) {
      Logger.log(
        "Aha! host not configured. Please set ahaHost in .sfdx-hardis.yml",
      );
      const pipelineSettingsLabel = t("pipelineConfig");
      vscode.window
        .showErrorMessage(t("ahaHostNotConfigured"), pipelineSettingsLabel)
        .then((action) => {
          if (action === pipelineSettingsLabel) {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showPipelineConfig",
              null,
              "Ticketing",
            );
          }
        });
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
    const connected = await this.checkCredentials({
      showGuidanceOnFailure: true,
    });
    if (!connected) {
      // Nothing was stored, so the refused key must not survive in the cached provider either
      this.apiKey = previousApiKey;
      return false;
    }
    await SecretsManager.setSecret(this.secretKey(), apiKey);
    return true;
  }

  async disconnect(): Promise<void> {
    if (await this.loadHost()) {
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

  /** API key of the connected account, for the commands launched from the extension */
  async getApiKeyForCommands(): Promise<string> {
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
   * body. Aha! only knows a reference in uppercase, so `prod-12` in a branch
   * name and `PROD-12` in a commit are the same feature, listed once.
   */
  async getTicketsFromString(str: string): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    const seenIds = new Set<string>();
    for (const ticket of await super.getTicketsFromString(str)) {
      const id = ticket.id.toUpperCase();
      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      tickets.push({ ...ticket, id });
    }
    return tickets;
  }

  async buildTicketUrl(ticketId: string): Promise<string> {
    const host = await this.loadHost();
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

  /** Host of the Aha! account, read once: AHA_HOST first, like the CLI, then ahaHost */
  private async loadHost(): Promise<string> {
    if (!this.host) {
      const config = await getConfig("project");
      this.host = AhaProvider.completeHostUrl(
        envOrConfig("AHA_HOST", config.ahaHost),
      );
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

  /**
   * Validates the API key with the cheapest authenticated read there is.
   *
   * An error carrying no HTTP status is the account not answering at all, which
   * says nothing about the key: it is logged as such, and never turned into the
   * "create a new key" guidance that would send the user fixing the wrong thing.
   */
  private async checkCredentials(options: {
    showGuidanceOnFailure: boolean;
  }): Promise<boolean> {
    try {
      await getJson(`${this.host}/api/v1/me`, {
        headers: this.authHeaders(),
        timeoutMs: CHECK_TIMEOUT_MS,
      });
      this.isAuthenticated = true;
      Logger.log(`Aha! authentication successful on ${this.host}`);
      return true;
    } catch (error: any) {
      const status = error instanceof HttpError ? error.status : 0;
      Logger.log(
        status > 0
          ? `Aha! refused the API key (HTTP ${status}): ${error?.message || String(error)}`
          : `Aha! account ${this.host} could not be reached: ${error?.message || String(error)}`,
      );
      this.isAuthenticated = false;
      if (options.showGuidanceOnFailure && status > 0) {
        await showAuthFailureGuidance({
          providerName: "Aha!",
          guidance: t("ahaAuthInfo"),
          createTokenUrl: `${this.host}/settings/api_keys`,
          docUrl: AHA_DOC_URL,
        });
      }
      return false;
    }
  }
}
