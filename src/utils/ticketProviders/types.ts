export type TicketProviderName =
  "JIRA" | "AZURE" | "SERVICENOW" | "AHA" | "GENERIC";

export interface Ticket {
  provider: TicketProviderName;
  id: string;
  url: string;
  subject?: string;
  body?: string;
  status?: string;
  statusLabel?: string;
  author?: string;
  authorLabel?: string;
  foundOnServer?: boolean;
  // Where the ticket was found in a Pull Request, with the text around it (see ticketSourceUtils)
  foundIn?: TicketFoundIn[];
}

/**
 * One place of a Pull Request where a ticket identifier was found: its title, description or
 * source branch, or a story a promotion carries (`pullRequest` is that story).
 */
export interface TicketFoundIn {
  source: "title" | "description" | "branch" | "carried";
  excerpt: string;
  pullRequest?: number;
}
