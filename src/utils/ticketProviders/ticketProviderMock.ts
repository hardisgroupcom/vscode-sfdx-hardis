import * as fs from "fs";
import { TicketProvider } from "./ticketProvider";
import type { Ticket, TicketProviderName } from "./types";

/**
 * Mock ticketing provider used exclusively by the UI integration tests and the
 * documentation screenshot harness (yarn test:ui / yarn screenshots).
 *
 * Only instantiated when BOTH conditions are met (see TicketProvider.getInstance):
 *  - VSCODE_SFDX_HARDIS_UI_TEST === "true" (extension launched by the harness)
 *  - SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE points to a JSON fixture
 *
 * The fixture provides the provider name, its web URL, the ticket identifier
 * regex and a catalog of ticket details, so the DevOps Pipeline shows a
 * connected ticketing provider and pull requests decorated with their tickets
 * without any network access.
 */
export class TicketProviderMock extends TicketProvider {
  private fixture: any = {};

  static async buildFromFixtureFile(
    fixtureFile: string,
  ): Promise<TicketProviderMock> {
    const provider = new TicketProviderMock();
    provider.fixture = JSON.parse(
      await fs.promises.readFile(fixtureFile, "utf8"),
    );
    provider.providerName = (provider.fixture.providerName ||
      "JIRA") as TicketProviderName;
    provider.isAuthenticated = true;
    return provider;
  }

  async initializeConnection(): Promise<boolean | null> {
    this.isAuthenticated = true;
    return true;
  }

  async authenticate(): Promise<boolean | null> {
    this.isAuthenticated = true;
    return true;
  }

  async isExplicitlyDisconnected(): Promise<boolean> {
    return false;
  }

  async getTicketingWebUrl(): Promise<string | null> {
    return this.fixture.webUrl || null;
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    return [new RegExp(this.fixture.ticketRegex || "[A-Z]+-\\d+", "g")];
  }

  async buildTicketUrl(ticketId: string): Promise<string> {
    return `${this.fixture.webUrl || ""}/browse/${ticketId}`;
  }

  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    const details = (this.fixture.tickets || {})[ticket.id];
    if (!details) {
      return { ...ticket, foundOnServer: false };
    }
    return { ...ticket, ...details, foundOnServer: true };
  }
}
