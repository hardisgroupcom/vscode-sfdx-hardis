import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import {
  filterPullRequestList,
  matchPastedList,
  safeWebUrl,
  ticketOriginLines,
} from "s/pullRequestUtils";

// cspell:ignore extracttickets

// Wait after the last keystroke before asking the extension for the ticket ids of the text
const PASTE_EXTRACT_DELAY_MS = 300;

/**
 * List of Pull Requests of a window of the DevOps Pipeline: the Pull Requests tab of a branch,
 * and the one of a promotion or of a merge between two major branches.
 *
 * One Pull Request per row, on two lines: number, title and tickets, then author, date and
 * source branch. What brought a story here is a "Carried by" reference opening that Pull
 * Request. A text filter narrows the list, and a chip lists the merges and promotions too.
 *
 * When the rows can be ticked, a "Selected only" chip shows the ticked rows alone, and "Select
 * from a list" opens a box where release notes, an email or a spreadsheet column is pasted: the
 * Pull Requests it names, directly or through a ticket, are ticked on top of the selection.
 *
 * `pullRequests` are the rows built by s/pipeline (_mapPrsWithIcons), each with `selectable`
 * when it can be ticked for the next promotion. `extractedTickets` is the answer of the extension
 * to an extracttickets event: { requestId, ids }.
 *
 * Events: open { prNumber }, select { numbers }, vehicles { shown },
 * extracttickets { requestId, text }
 */
export default class PullRequestList extends SharedMixin(LightningElement) {
  // Checkboxes feeding the next promotion
  @api selectable = false;
  // Job status of each Pull Request (open ones)
  @api showStatus = false;
  // Merges and promotions the window holds: 0 hides the chip
  @api vehicleCount = 0;
  @api vehiclesShown = false;
  // "Pull Request" or "Merge Request", as the git provider calls it
  @api prLabel = "";
  // What ticking does, shown on the checkbox that ticks every row
  @api selectHelp = "";
  @track filterText = "";
  _pullRequests = [];
  _selectedNumbers = [];
  // "Selected only": the rows shown are the ones ticked when the chip was turned on, plus the
  // ones ticked since. A row unticked meanwhile stays, so nothing disappears under the mouse.
  selectedOnly = false;
  _selectedOnlyNumbers = [];
  // "Select from a list"
  pasteOpen = false;
  pasteText = "";
  pasteTicketIds = [];
  pasteExtracting = false;
  // What the pasted text selects: computed when the text, its ticket ids or the rows change, read
  // by every part of the box (matching is one regex per ticket on every row)
  pasteMatch = { found: [], weak: [], notSelectable: [], notFound: [] };
  // Also tick the Pull Requests only a description names: off for every new box, since those are
  // most often tickets mentioned in passing
  pasteIncludeWeak = false;
  _pasteRequestId = null;
  _pasteTimer = null;

  @api
  get extractedTickets() {
    return null;
  }
  set extractedTickets(value) {
    // Only the answer to the last request: an older one would describe a text no longer there
    if (value && value.requestId && value.requestId === this._pasteRequestId) {
      this.pasteTicketIds = Array.isArray(value.ids) ? value.ids : [];
      this.pasteExtracting = false;
      this._refreshPasteMatch();
    }
  }

  @api
  get pullRequests() {
    return this._pullRequests;
  }
  set pullRequests(value) {
    this._pullRequests = Array.isArray(value) ? value : [];
    this._refreshPasteMatch();
  }

  @api
  get selectedNumbers() {
    return this._selectedNumbers;
  }
  set selectedNumbers(value) {
    this._selectedNumbers = Array.isArray(value) ? value : [];
  }

  get showHead() {
    return this._pullRequests.length > 0 || this.vehicleCount > 0;
  }

  get showVehiclesChip() {
    return this.vehicleCount > 0;
  }

  get vehiclesChipLabel() {
    return this.t("prListVehiclesFilter", { count: this.vehicleCount });
  }

  get vehiclesPressed() {
    return String(this.vehiclesShown === true);
  }

  get vehiclesChipClass() {
    return this.vehiclesShown ? "prl-chip prl-chip-on" : "prl-chip";
  }

  get filterPlaceholder() {
    return this.i18n.prListFilterPlaceholder;
  }

  get filtered() {
    const matching = filterPullRequestList(this._pullRequests, this.filterText);
    if (!this.selectedOnly) {
      return matching;
    }
    return matching.filter(
      (pr) =>
        this._selectedOnlyNumbers.includes(pr.number) ||
        this._selectedNumbers.includes(pr.number),
    );
  }

  get showSelectionTools() {
    return this.selectable && this._pullRequests.length > 0;
  }

  get selectedOnlyLabel() {
    return this.t("prListSelectedOnly", {
      count: this._selectedNumbers.length,
    });
  }

  get selectedOnlyPressed() {
    return String(this.selectedOnly === true);
  }

  get selectedOnlyChipClass() {
    return this.selectedOnly ? "prl-chip prl-chip-on" : "prl-chip";
  }

  // Nothing to show alone while nothing is ticked, unless the chip is already on
  get selectedOnlyDisabled() {
    return !this.selectedOnly && this._selectedNumbers.length === 0;
  }

  get pasteButtonClass() {
    return this.pasteOpen ? "prl-chip prl-chip-on" : "prl-chip";
  }

  get pasteButtonPressed() {
    return String(this.pasteOpen === true);
  }

  get pasteHasText() {
    return this.pasteText.trim().length > 0;
  }

  get pasteFound() {
    const reasonLabels = {
      reference: this.i18n.prListPasteReasonReference,
      ticket: this.i18n.prListPasteReasonTicket,
      title: this.i18n.prListPasteReasonTitle,
      branch: this.i18n.prListPasteReasonBranch,
      description: this.i18n.prListPasteReasonDescription,
    };
    return this.pasteMatch.found.map((item) => ({
      key: `found-${item.number}`,
      label: `#${item.number} ${item.title}`,
      reasons: item.reasons
        .map((reason) => reasonLabels[reason] || reason)
        .join(", "),
    }));
  }

  get pasteWeak() {
    return this.pasteMatch.weak.map((item) => ({
      key: `weak-${item.number}`,
      label: `#${item.number} ${item.title}`,
      mentions: item.mentions
        .map((mention) =>
          mention.excerpt ? `${mention.id}: "${mention.excerpt}"` : mention.id,
        )
        .join(" / "),
    }));
  }

  get pasteHasWeak() {
    return this.pasteMatch.weak.length > 0;
  }

  get pasteWeakTitle() {
    return this.t("prListPasteWeak", { count: this.pasteMatch.weak.length });
  }

  get pasteIncludeWeakLabel() {
    return this.t("prListPasteIncludeWeak", {
      count: this.pasteMatch.weak.length,
    });
  }

  get pasteNotSelectable() {
    return this.pasteMatch.notSelectable.map((item) => ({
      key: `not-selectable-${item.number}`,
      label: `#${item.number} ${item.title}`,
    }));
  }

  get pasteNotFound() {
    return this.pasteMatch.notFound.join(", ");
  }

  get pasteFoundTitle() {
    return this.t("prListPasteFound", { count: this.pasteMatch.found.length });
  }

  get pasteNotSelectableTitle() {
    return this.t("prListPasteNotSelectable", {
      count: this.pasteMatch.notSelectable.length,
    });
  }

  get pasteNotFoundTitle() {
    return this.t("prListPasteNotFound", {
      count: this.pasteMatch.notFound.length,
    });
  }

  get pasteHasFound() {
    return this.pasteMatch.found.length > 0;
  }

  get pasteHasNotSelectable() {
    return this.pasteMatch.notSelectable.length > 0;
  }

  get pasteHasNotFound() {
    return this.pasteMatch.notFound.length > 0;
  }

  get pasteSelectLabel() {
    return this.t("prListPasteSelect", {
      count: this._pasteNumbersToTick().length,
    });
  }

  // Not while the ticket ids of the text are being read: the selection would miss them
  get pasteSelectDisabled() {
    return this.pasteExtracting || this._pasteNumbersToTick().length === 0;
  }

  get rows() {
    return this.filtered.map((pr) => {
      const checked = this._selectedNumbers.includes(pr.number);
      const carrier =
        pr.carriedByPullRequest && pr.carriedByPullRequest.number > 0
          ? pr.carriedByPullRequest
          : null;
      const showCheckbox = this.selectable && pr.selectable === true;
      return {
        key: pr.id || pr.number,
        number: pr.number,
        numberLabel: pr.numberLabel || (pr.number > 0 ? `#${pr.number}` : ""),
        title: pr.title || "",
        rowClass: checked
          ? "hardis-list-row prl-row prl-row-on"
          : "hardis-list-row prl-row",
        showCheckbox,
        // Keeps the titles aligned when only some rows can be ticked
        showCheckboxGap: this.selectable && !showCheckbox,
        checked,
        selectLabel: this.t("prListSelectRow", { number: pr.number }),
        tickets: (pr.relatedTickets || [])
          .filter((ticket) => ticket && ticket.id)
          .map((ticket) => ({
            key: `${pr.number}-${ticket.id}`,
            id: ticket.id,
            url: safeWebUrl(ticket.url),
            title: this._ticketTooltip(ticket),
          })),
        hasAuthor: !!pr.authorLabel,
        authorLabel: pr.authorLabel || "",
        authorInitials: pr.authorInitials || "?",
        authorAvatarClass:
          pr.authorAvatarClass || "hardis-avatar hardis-avatar-c0",
        date: pr.mergeDateFormatted || "",
        sourceBranch: pr.sourceBranch || "",
        hasStatus: this.showStatus && !!pr.jobsStatusLabel,
        statusLabel: pr.jobsStatusLabel || "",
        statusPillClass:
          pr.statusPillClass || "hardis-pill hardis-status-unknown",
        statusUrl: safeWebUrl(pr.jobsStatusUrl),
        hasConflicts: !!pr.mergeConflictLabel,
        conflictLabel: pr.mergeConflictLabel || "",
        conflictPillClass: pr.mergeConflictPillClass || "",
        conflictTooltip: pr.mergeConflictTooltip || "",
        // The Pull Request that brought the story: its number is short where its branch is not
        carriedNumber: carrier ? carrier.number : 0,
        carriedLabel: carrier
          ? this.t("prCarriedByPromotion", { branch: `#${carrier.number}` })
          : "",
        carriedTitle: carrier ? carrier.sourceBranch || "" : "",
        // A promotion itself, or a story a promotion merged elsewhere already shipped
        promotionLabel: carrier ? "" : pr.promotionLabel || "",
        promotionPillClass: pr.promotionPillClass || "hardis-pill",
        // A cherry-pick made by hand: reached the next branch, or only partly / probably
        cherryPickLabel: pr.cherryPickLabel || "",
        cherryPickTitle: pr.cherryPickTitle || "",
        cherryPickPillClass: pr.cherryPickPillClass || "hardis-pill",
      };
    });
  }

  get hasRows() {
    return this.rows.length > 0;
  }

  get nothingMatches() {
    return this._pullRequests.length > 0 && this.filtered.length === 0;
  }

  get noMatchLabel() {
    return this.t("prListNoMatch", { prLabel: this.prLabel });
  }

  get shownLabel() {
    return this.t("prListShownCount", {
      shown: this.filtered.length,
      total: this._pullRequests.length,
    });
  }

  // The rows shown that can be ticked: what the checkbox above the list acts on
  get _selectableShown() {
    return this.selectable
      ? this.filtered.filter((pr) => pr.selectable === true)
      : [];
  }

  get showSelectAll() {
    return this.selectable && this._pullRequests.length > 0;
  }

  get nothingToTick() {
    return this._selectableShown.length === 0;
  }

  get allTicked() {
    const selectable = this._selectableShown;
    return (
      selectable.length > 0 &&
      selectable.every((pr) => this._selectedNumbers.includes(pr.number))
    );
  }

  handleFilter(event) {
    this.filterText = event.target.value || "";
  }

  handleToggleVehicles() {
    this.dispatchEvent(
      new CustomEvent("vehicles", {
        detail: { shown: !this.vehiclesShown },
      }),
    );
  }

  handleSelectRow(event) {
    const number = parseInt(event.target.dataset.prNumber, 10);
    if (!(number > 0)) {
      return;
    }
    const others = this._selectedNumbers.filter((n) => n !== number);
    this._select(event.target.checked ? [...others, number] : others);
  }

  // Ticks, or unticks, the rows shown: what the filter hides keeps its state
  handleSelectAll(event) {
    const shown = this._selectableShown.map((pr) => pr.number);
    const others = this._selectedNumbers.filter((n) => !shown.includes(n));
    this._select(event.target.checked ? [...others, ...shown] : others);
  }

  _select(numbers) {
    this._selectedNumbers = numbers;
    this.dispatchEvent(new CustomEvent("select", { detail: { numbers } }));
  }

  // The subject of a ticket, then where it was found in the Pull Request with the text around it,
  // so a ticket named in passing ("depends on ABC-12") can be told from the one the story is about
  _ticketTooltip(ticket) {
    const lines = ticketOriginLines(ticket.foundIn, (key, params) =>
      this.t(key, params),
    );
    return [ticket.subject || "", ...lines].filter(Boolean).join("\n");
  }

  handleToggleSelectedOnly() {
    this.selectedOnly = !this.selectedOnly;
    this._selectedOnlyNumbers = this.selectedOnly
      ? [...this._selectedNumbers]
      : [];
  }

  handleTogglePaste() {
    this.pasteOpen = !this.pasteOpen;
    if (!this.pasteOpen) {
      this._resetPaste();
    }
  }

  handlePasteInput(event) {
    this.pasteText = event.target.value || "";
    clearTimeout(this._pasteTimer);
    // The ticket ids read from the previous text no longer apply, and neither does a late answer
    // to its request: the Pull Request references of the new text show at once, its tickets once
    // read
    this.pasteTicketIds = [];
    this._pasteRequestId = null;
    this._refreshPasteMatch();
    if (!this.pasteHasText) {
      this.pasteExtracting = false;
      return;
    }
    this.pasteExtracting = true;
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this._pasteTimer = setTimeout(() => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this._pasteRequestId = requestId;
      this.dispatchEvent(
        new CustomEvent("extracttickets", {
          detail: { requestId, text: this.pasteText },
        }),
      );
    }, PASTE_EXTRACT_DELAY_MS);
  }

  handlePasteIncludeWeak(event) {
    this.pasteIncludeWeak = event.target.checked === true;
  }

  // Ticks what the text found, on top of the selection: unticking stays a choice made by hand
  handlePasteSelect() {
    const found = this._pasteNumbersToTick();
    const numbers = [...new Set([...this._selectedNumbers, ...found])];
    if (this.selectedOnly) {
      this._selectedOnlyNumbers = [
        ...new Set([...this._selectedOnlyNumbers, ...found]),
      ];
    }
    this._select(numbers);
    this.pasteOpen = false;
    this._resetPaste();
  }

  handlePasteCancel() {
    this.pasteOpen = false;
    this._resetPaste();
  }

  _resetPaste() {
    clearTimeout(this._pasteTimer);
    this.pasteText = "";
    this.pasteTicketIds = [];
    this.pasteExtracting = false;
    this.pasteIncludeWeak = false;
    this._pasteRequestId = null;
    this._refreshPasteMatch();
  }

  // The strong matches, and the description-only ones when the box asks for them too
  _pasteNumbersToTick() {
    const items = this.pasteIncludeWeak
      ? [...this.pasteMatch.found, ...this.pasteMatch.weak]
      : this.pasteMatch.found;
    return items.map((item) => item.number);
  }

  _refreshPasteMatch() {
    this.pasteMatch = matchPastedList(
      this._pullRequests,
      this.pasteText,
      this.pasteTicketIds,
    );
  }

  disconnectedCallback() {
    clearTimeout(this._pasteTimer);
  }

  handleOpen(event) {
    const prNumber = parseInt(event.currentTarget.dataset.prNumber, 10);
    if (prNumber > 0) {
      this.dispatchEvent(new CustomEvent("open", { detail: { prNumber } }));
    }
  }

  handleOpenUrl(event) {
    const url = safeWebUrl(event.currentTarget.dataset.url);
    if (url) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }
}
