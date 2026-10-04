import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { safeWebUrl } from "s/pullRequestUtils";

/**
 * Tickets tab of the Pull Request modal: one row per ticket, its status as a pill, who it is
 * assigned to, and the Pull Requests that mention it as references opening them in the panel.
 * The pills above the list add up the tickets by status and filter them.
 *
 * `tickets` are the rows built by s/pipeline (_aggregateTicketsFromPRs).
 *
 * Event: openpullrequest { prNumber }
 */
export default class TicketList extends SharedMixin(LightningElement) {
  // False when the ticketing tool is not connected: only the ids are known
  @api detailsAvailable = false;
  // Show the Pull Requests mentioning each ticket (a window of several Pull Requests)
  @api showPullRequests = false;
  // The subjects, statuses and assignees are still being read from the ticketing tool
  @api loading = false;
  @track hiddenStatuses = [];
  _tickets = [];

  @api
  get tickets() {
    return this._tickets;
  }
  set tickets(value) {
    this._tickets = Array.isArray(value) ? value : [];
    this.hiddenStatuses = [];
  }

  get hasTickets() {
    return this._tickets.length > 0;
  }

  // One pill per status, shown as soon as the tickets do not all share the same one
  get statusTotals() {
    if (!this.detailsAvailable) {
      return [];
    }
    const totals = new Map();
    for (const ticket of this._tickets) {
      const label = ticket.statusLabel || "";
      if (label === "") {
        continue;
      }
      const total = totals.get(label) || {
        key: label,
        label,
        pillClass: ticket.statusPillClass || "hardis-pill hardis-status-unknown",
        count: 0,
      };
      total.count += 1;
      totals.set(label, total);
    }
    if (totals.size < 2) {
      return [];
    }
    return [...totals.values()].map((total) => {
      const pressed = !this.hiddenStatuses.includes(total.key);
      return {
        ...total,
        text: `${total.count} ${total.label}`,
        pressed,
        pillClass: pressed
          ? total.pillClass
          : `${total.pillClass} ticket-pill-off`,
      };
    });
  }

  get hasStatusTotals() {
    return this.statusTotals.length > 0;
  }

  get rows() {
    return this._tickets
      .filter((ticket) => !this.hiddenStatuses.includes(ticket.statusLabel))
      .map((ticket) => {
        return {
          key: ticket.id,
          id: ticket.id,
          url: safeWebUrl(ticket.url),
          subject: ticket.subject || "",
          hasStatus: this.detailsAvailable && !!ticket.statusLabel,
          statusLabel: ticket.statusLabel || "",
          statusPillClass:
            ticket.statusPillClass || "hardis-pill hardis-status-unknown",
          hasAuthor: this.detailsAvailable && !!ticket.authorLabel,
          authorLabel: ticket.authorLabel || "",
          authorInitials: ticket.authorInitials || "?",
          authorAvatarClass:
            ticket.authorAvatarClass || "hardis-avatar hardis-avatar-c0",
          pullRequests: this.showPullRequests
            ? (ticket.prs || [])
                .filter((pr) => pr.number > 0)
                .map((pr) => ({
                  key: `${ticket.id}-${pr.number}`,
                  number: pr.number,
                  label: `#${pr.number}`,
                  title: pr.title || "",
                }))
            : [],
        };
      });
  }

  get everyTicketHidden() {
    return this.hasTickets && this.rows.length === 0;
  }

  handleToggleStatus(event) {
    const key = event.currentTarget.dataset.key;
    this.hiddenStatuses = this.hiddenStatuses.includes(key)
      ? this.hiddenStatuses.filter((status) => status !== key)
      : [...this.hiddenStatuses, key];
  }

  handleOpenTicket(event) {
    const url = safeWebUrl(event.currentTarget.dataset.url);
    if (url) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }

  handleOpenPullRequest(event) {
    const prNumber = parseInt(event.currentTarget.dataset.prNumber, 10);
    if (prNumber > 0) {
      this.dispatchEvent(
        new CustomEvent("openpullrequest", { detail: { prNumber } }),
      );
    }
  }
}
