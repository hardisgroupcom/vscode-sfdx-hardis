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
 * The tickets of a Pull Request, each with the places it was found: the title, the description
 * and the source branch are read one by one (the same regexes as on the whole text), so a tooltip
 * can tell the ticket a story is about from one its description only mentions. A ticket found in
 * several places is listed once, with all of them, in the order of its first appearance.
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
  const byId = new Map<string, Ticket>();
  for (const [source, text] of sources) {
    if (!text.trim()) {
      continue;
    }
    for (const ticket of await getTicketsFromString(text)) {
      if (!ticket?.id) {
        continue;
      }
      const known = byId.get(ticket.id) || { ...ticket, foundIn: [] };
      const excerpt =
        ticketExcerpt(text, ticket.id) ??
        ticketExcerpt(text, ticket.url) ??
        text
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2 * EXCERPT_RADIUS);
      if (!(known.foundIn || []).some((place) => place.source === source)) {
        known.foundIn = [...(known.foundIn || []), { source, excerpt }];
      }
      byId.set(ticket.id, known);
    }
  }
  return [...byId.values()];
}
