import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { filterPullRequestList, safeWebUrl } from "s/pullRequestUtils";

/**
 * List of Pull Requests of a window of the DevOps Pipeline: the Pull Requests tab of a branch,
 * and the one of a promotion or of a merge between two major branches.
 *
 * One Pull Request per row, on two lines: number, title and tickets, then author, date and
 * source branch. What brought a story here is a "Carried by" reference opening that Pull
 * Request. A text filter narrows the list, and a chip lists the merges and promotions too.
 *
 * `pullRequests` are the rows built by s/pipeline (_mapPrsWithIcons), each with `selectable`
 * when it can be ticked for the next promotion.
 *
 * Events: open { prNumber }, select { numbers }, vehicles { shown }
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

  @api
  get pullRequests() {
    return this._pullRequests;
  }
  set pullRequests(value) {
    this._pullRequests = Array.isArray(value) ? value : [];
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
    return filterPullRequestList(this._pullRequests, this.filterText);
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
            title: ticket.subject || "",
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
