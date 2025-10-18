export type TicketProviderName = "JIRA" | "AZURE" | "GENERIC";

export interface Ticket {
  provider: TicketProviderName;
  id: string;
  url: string;
  subject?: string;
  body?: string;
  status?: string;
  statusLabel?: string;
  foundOnServer?: boolean;
}

