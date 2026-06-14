import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";

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

    // Support the documented {ticketId} placeholder as well as the legacy {REF}
    // and {{TICKET_ID}} variants so existing configurations keep working.
    return urlBuilder
      .replace(/\{\{?\s*ticketId\s*\}?\}/gi, ticketId)
      .replace(/\{\{?\s*TICKET_ID\s*\}?\}/g, ticketId)
      .replace(/\{REF\}/g, ticketId);
  }

  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    // Generic provider has no server to fetch details from
    // Just mark as found (since we don't have a way to verify)
    ticket.foundOnServer = false;
    return ticket;
  }
}
