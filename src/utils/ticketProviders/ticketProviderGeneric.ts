import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";
import { getJson } from "../httpUtils";

export class GenericTicketingProvider extends TicketProvider {
  static readonly providerName: TicketProviderName = "GENERIC";

  private ticketRefRegex: string = "";
  private ticketUrlBuilder: string = "";

  constructor() {
    super();
    this.providerName = "GENERIC";
  }

  async disconnect(): Promise<void> {
    // Generic provider doesn't store credentials, just configuration.
    // Remember the explicit disconnect so we don't silently reconnect from config
    // on the next pipeline refresh.
    await this.markDisconnected();
    this.isAuthenticated = false;
    Logger.log("Disconnected from Generic ticketing provider");
  }

  async getTicketingWebUrl(): Promise<string | null> {
    const config = await getConfig("project");
    const urlBuilder =
      config.genericTicketingProviderUrlBuilder || this.ticketUrlBuilder;

    if (!urlBuilder) {
      return null;
    }

    // Extract base URL from the URL builder pattern (remove placeholder parts)
    // Example: "https://tickets.example.com/view/{ticketId}" -> "https://tickets.example.com"
    const urlMatch = urlBuilder.match(/^(https?:\/\/[^/]+)/);
    return urlMatch ? urlMatch[1] : null;
  }

  async authenticate(): Promise<boolean | null> {
    const config = await getConfig("project");
    this.ticketRefRegex = config.genericTicketingProviderRegex || "";
    this.ticketUrlBuilder = config.genericTicketingProviderUrlBuilder || "";

    if (!this.ticketRefRegex || !this.ticketUrlBuilder) {
      Logger.log(
        "Generic ticketing provider not configured. Please set genericTicketingProviderRegex and genericTicketingProviderUrlBuilder in .sfdx-hardis.yml",
      );
      return false;
    }

    this.isAuthenticated = true;
    Logger.log("Generic ticketing provider configured successfully");
    return true;
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    const config = await getConfig("project");
    const regex = config.genericTicketingProviderRegex || this.ticketRefRegex;

    if (!regex) {
      return [];
    }

    return [new RegExp(regex, "g")];
  }

  async buildTicketUrl(ticketId: string): Promise<string> {
    const config = await getConfig("project");
    const urlBuilder =
      config.genericTicketingProviderUrlBuilder || this.ticketUrlBuilder;

    if (!urlBuilder) {
      return "";
    }
    return GenericTicketingProvider.fillPlaceholder(urlBuilder, ticketId);
  }

  // Support the documented {REF} placeholder as well as the {ticketId}
  // and {{TICKET_ID}} variants so existing configurations keep working.
  static fillPlaceholder(urlBuilder: string, ticketId: string): string {
    return urlBuilder
      .replace(/\{\{?\s*ticketId\s*\}?\}/gi, ticketId)
      .replace(/\{\{?\s*TICKET_ID\s*\}?\}/g, ticketId)
      .replace(/\{REF\}/g, ticketId);
  }

  /**
   * Reads the title and the status of the ticket from
   * genericTicketingProviderDetailsUrlBuilder, like the CLI does: one JSON
   * document per ticket, with subject (or title, or summary) and status.
   * Without that key, the ticket stays a bare link.
   */
  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    ticket.foundOnServer = false;
    const config = await getConfig("project");
    const detailsUrlBuilder =
      process.env.GENERIC_TICKETING_PROVIDER_DETAILS_URL_BUILDER ||
      config.genericTicketingProviderDetailsUrlBuilder;
    if (!detailsUrlBuilder) {
      return ticket;
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (process.env.GENERIC_TICKETING_PROVIDER_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GENERIC_TICKETING_PROVIDER_TOKEN}`;
    }
    const data = await getJson(
      GenericTicketingProvider.fillPlaceholder(detailsUrlBuilder, ticket.id),
      { headers, timeoutMs: 15000 },
    );
    const text = (keys: string[]): string => {
      for (const key of keys) {
        const value = data?.[key];
        if (typeof value === "string" && value.trim() !== "") {
          return value.replace(/\s+/g, " ").trim();
        }
      }
      return "";
    };
    const subject = text(["subject", "title", "summary"]);
    if (!subject) {
      return ticket;
    }
    ticket.foundOnServer = true;
    ticket.subject = subject;
    const status = text(["status"]);
    if (status) {
      ticket.status = status;
      ticket.statusLabel = text(["statusLabel"]) || status;
    }
    return ticket;
  }
}
