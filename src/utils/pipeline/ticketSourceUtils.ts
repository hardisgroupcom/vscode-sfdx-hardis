import { Ticket, TicketFoundIn } from "../ticketProviders/types";

// Characters of text kept on each side of a ticket identifier in a tooltip
const EXCERPT_RADIUS = 60;

/**
 * The text around the first occurrence of `needle` in `text`, case insensitive, on one line, with
 * "..." where it was cut. Null when `needle` is not in `text`.
 */
export function ticketExcerpt(
  text: string,
  needle: string,
  radius: number = EXCERPT_RADIUS,
): string | null {
  const source = String(text || "");
  const wanted = String(needle || "");
  if (!wanted) {
    return null;
  }
  const index = source.toLowerCase().indexOf(wanted.toLowerCase());
  if (index < 0) {
    return null;
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + wanted.length + radius);
  const snippet = source.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${snippet}${end < source.length ? "..." : ""}`;
}

/**
 * The tickets of a Pull Request, each with the places it was found, so a tooltip can tell the
 * ticket a story is about from one its description only mentions. The ticketing provider reads the
 * whole text once (each call repeats its setup: configuration, credentials, regexes), then each
 * ticket is located in the title, the description and the source branch. A ticket found in several
 * places is listed once, with all of them; one the provider read in a form none of the fields
 * holds as such keeps an empty list.
 */
export async function findTicketsInPullRequest(
  pr: {
    title?: string | null;
    description?: string | null;
    sourceBranch?: string | null;
  },
  getTicketsFromString: (text: string) => Promise<Ticket[]>,
): Promise<Ticket[]> {
  const sources: Array<[TicketFoundIn["source"], string]> = [
    ["title", String(pr.title || "")],
    ["description", String(pr.description || "")],
    ["branch", String(pr.sourceBranch || "")],
  ];
  const joined = sources
    .map(([, text]) => text)
    .filter((text) => text.trim())
    .join("\n");
  if (!joined) {
    return [];
  }
  const byId = new Map<string, Ticket>();
  for (const ticket of await getTicketsFromString(joined)) {
    if (!ticket?.id || byId.has(ticket.id)) {
      continue;
    }
    const foundIn: TicketFoundIn[] = [];
    for (const [source, text] of sources) {
      const excerpt =
        ticketExcerpt(text, ticket.id) ?? ticketExcerpt(text, ticket.url);
      if (excerpt !== null) {
        foundIn.push({ source, excerpt });
      }
    }
    byId.set(ticket.id, { ...ticket, foundIn });
  }
  return [...byId.values()];
}
