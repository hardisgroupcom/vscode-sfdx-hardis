import { Logger } from "../../logger";
import { TicketProvider } from "../ticketProviders/ticketProvider";

// Identifiers like ABC-123 when the project has no ticketing provider: the shape most trackers use
const GENERIC_TICKET_ID_REGEX =
  /(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})(?![A-Za-z0-9_-])/g;

/**
 * The ticket identifiers of a text pasted in the DevOps Pipeline to select Pull Requests: read
 * with the ticketing provider of the project, which knows its own formats (a Jira project regex,
 * ServiceNow or Aha! references, ticket URLs), or with the ABC-123 shape when there is none.
 * Unique, in the order they appear. Never throws: a text it cannot read selects nothing more.
 */
export async function extractTicketIdsFromText(
  text: string,
  getProvider: () => Promise<TicketProvider | null> = () =>
    TicketProvider.getInstance({ reset: false, authenticate: false }),
): Promise<string[]> {
  const source = String(text || "");
  if (!source.trim()) {
    return [];
  }
  try {
    const provider = await getProvider();
    const ids = provider
      ? (await provider.getTicketsFromString(source)).map((ticket) => ticket.id)
      : [...source.matchAll(GENERIC_TICKET_ID_REGEX)].map((match) => match[1]);
    return [...new Set(ids.filter(Boolean))];
  } catch (error: any) {
    Logger.log(
      `Error reading the ticket identifiers of a pasted list: ${error?.message || error}`,
    );
    return [];
  }
}
