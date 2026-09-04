import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";
import { SecretsManager } from "../secretsManager";
import { Ticket, TicketProviderName } from "./types";

// Display name of every supported ticketing provider. GENERIC has no brand of
// its own: it stands for whatever tool the project configured by hand.
const TICKET_PROVIDER_LABELS: Record<string, string> = {
  JIRA: "Jira",
  AZURE: "Azure Boards",
  SERVICENOW: "ServiceNow",
  GENERIC: "Ticketing",
};

export class TicketProvider {
  static instance: TicketProvider | null = null;
  providerName: TicketProviderName | null = null;
  isAuthenticated: boolean | null = null;

  // Caches the "no ticketing provider configured" result for a short while:
  // without it, every command launch re-reads the project configuration files.
  private static noProviderUntil = 0;
  private static NO_PROVIDER_CACHE_TTL_MS = 60000;

  static async getInstance(options: {
    reset: boolean;
    authenticate: boolean;
  }): Promise<TicketProvider | null> {
    if (options.reset) {
      this.noProviderUntil = 0;
    } else if (this.instance === null && Date.now() < this.noProviderUntil) {
      return null;
    }
    if (options.reset || this.instance === null) {
      // UI test / documentation screenshot harness only: serve the ticketing
      // provider from a JSON fixture (see ticketProviderMock.ts). Both env
      // vars are set by src/test/runUiTest.ts.
      if (
        process.env.VSCODE_SFDX_HARDIS_UI_TEST === "true" &&
        process.env.SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE
      ) {
        this.instance = await (
          await import("./ticketProviderMock")
        ).TicketProviderMock.buildFromFixtureFile(
          process.env.SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE,
        );
        return this.instance;
      }
      const config = await getConfig("project");
      const providerName = config.ticketingProvider || null;
      if (!providerName) {
        this.instance = null;
        this.noProviderUntil = Date.now() + this.NO_PROVIDER_CACHE_TTL_MS;
        return this.instance;
      }

      // Lazy load providers to avoid circular dependencies
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { JiraProvider } = await import("./ticketProviderJira");
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { GenericTicketingProvider } =
        await import("./ticketProviderGeneric");
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { AzureBoardsProvider } = await import("./ticketProviderAzure");
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { ServiceNowProvider } = await import("./ticketProviderServiceNow");

      const allTicketProviders = [
        JiraProvider,
        GenericTicketingProvider,
        AzureBoardsProvider,
        ServiceNowProvider,
      ];

      const providerClass = allTicketProviders.find(
        (provider) => provider.providerName === providerName,
      );
      if (providerClass) {
        this.instance = new providerClass();
        // An explicit connect (authenticate=true, user clicked "Connect") clears any
        // previous disconnect so the provider may connect again.
        if (options.authenticate) {
          await this.instance.clearDisconnectedFlag();
        }
        // Honor an explicit disconnect: never silently reconnect on passive loads.
        // Azure Boards and the Generic provider derive their authentication from the
        // git connection / project config (no own credentials to delete), so without
        // this flag they would re-authenticate on the next pipeline refresh.
        if (
          !options.authenticate &&
          (await this.instance.isExplicitlyDisconnected())
        ) {
          this.instance.isAuthenticated = false;
        } else {
          const connectionIsOk = await this.instance.initializeConnection();
          if (!connectionIsOk && options.authenticate) {
            await this.instance.authenticate();
          }
        }
      } else {
        this.instance = null;
      }
    }
    return this.instance;
  }

  /**
   * Secret key used to remember that the user explicitly disconnected this ticketing
   * provider. Mirrors the `_DISCONNECTED` flag used by git providers whose session
   * cannot be revoked programmatically.
   */
  protected disconnectedFlagKey(): string {
    return `TICKETING_${this.providerName || "UNKNOWN"}_DISCONNECTED`;
  }

  protected async markDisconnected(): Promise<void> {
    await SecretsManager.setSecret(this.disconnectedFlagKey(), "true").catch(
      () => {},
    );
  }

  async clearDisconnectedFlag(): Promise<void> {
    await SecretsManager.deleteSecret(this.disconnectedFlagKey()).catch(
      () => {},
    );
  }

  async isExplicitlyDisconnected(): Promise<boolean> {
    return !!(await SecretsManager.getSecret(this.disconnectedFlagKey()));
  }

  async initializeConnection(): Promise<boolean | null> {
    Logger.log(
      `initializeConnection not implemented on provider ${this.providerName}`,
    );
    return false;
  }

  async authenticate(): Promise<boolean | null> {
    Logger.log(`authenticate not implemented on provider ${this.providerName}`);
    return false;
  }

  async disconnect(): Promise<void> {
    // This method should be overridden by each provider to clean up their specific credentials
    Logger.log(
      `disconnect not fully implemented on provider ${this.providerName}`,
    );
    this.isAuthenticated = false;
  }

  async getTicketingWebUrl(): Promise<string | null> {
    Logger.log(
      `getTicketingWebUrl not implemented on provider ${this.providerName}`,
    );
    return null;
  }

  /**
   * Brand name displayed in the UI ("Jira", "Azure Boards", "ServiceNow"), where
   * `providerName` is the technical value stored in `ticketingProvider`. Never
   * translated: these are product names.
   */
  getProviderLabel(): string {
    return TICKET_PROVIDER_LABELS[this.providerName || ""] || "Ticketing";
  }

  /** Key of the provider icon shipped in resources/webviews/icons */
  getProviderIconKey(): string {
    // AZURE is the Azure DevOps organization for git, but Azure Boards for
    // ticketing, and each has its own icon
    if (this.providerName === "AZURE") {
      return "azureboards";
    }
    return (this.providerName || "").toLowerCase();
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    Logger.log(
      "getTicketIdentifierRegexes should be implemented on provider class",
    );
    return [];
  }

  async buildTicketUrl(_ticketId: string): Promise<string> {
    Logger.log("buildTicketUrl should be implemented on provider class");
    return "";
  }

  async completeTicketDetails(_ticket: Ticket): Promise<Ticket> {
    Logger.log("completeTicketDetails should be implemented on provider class");
    return _ticket;
  }

  // Use regexes to identify tickets in the given string
  async getTicketsFromString(str: string): Promise<Ticket[]> {
    const regexes = await this.getTicketIdentifierRegexes();
    const tickets: Ticket[] = [];
    const seenIds = new Set<string>();

    for (const regex of regexes) {
      let match;
      const regexGlobal = new RegExp(
        regex.source,
        regex.flags.includes("g") ? regex.flags : regex.flags + "g",
      );
      while ((match = regexGlobal.exec(str)) !== null) {
        // Zero-width match: without this the loop would never advance
        if (match.index === regexGlobal.lastIndex) {
          regexGlobal.lastIndex++;
        }
        // The whole match is the identifier. Capture group 1 is NOT preferred
        // here, unlike the sfdx-hardis CLI: a project regex that captures a
        // leading alternation ("(ABC|DEF)-([0-9]+)") would then yield "ABC" and
        // link to an issue that does not exist. A provider able to tell a real
        // identifier from a fragment overrides this (see ServiceNowProvider).
        const matchedText = match[0];
        if (!matchedText) {
          continue;
        }
        let ticketId: string;
        let ticketUrl: string;

        // Check if the match is a full URL (starts with http)
        if (matchedText.startsWith("http")) {
          ticketUrl = matchedText;
          // Extract ID from URL - try to get the last segment or identifier
          // This works for most patterns like /browse/ABC-123 or /edit/123
          const idPattern = /\/([A-Z0-9]+-\d+|\d+)(?:[?#]|$)/i;
          const idMatch = ticketUrl.match(idPattern);
          if (idMatch) {
            ticketId = idMatch[1];
          } else {
            // If we can't extract ID, use the full URL as ID
            ticketId = matchedText;
          }
        } else {
          // It's an identifier, build the URL
          ticketId = matchedText;
          ticketUrl = await this.buildTicketUrl(ticketId);
        }

        // Avoid duplicates
        if (!seenIds.has(ticketId)) {
          seenIds.add(ticketId);
          tickets.push({
            id: ticketId,
            provider: this.providerName!,
            url: ticketUrl,
          });
        }
      }
    }
    return tickets;
  }
}
