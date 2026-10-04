import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import {
  excludeKnownPullRequests,
  filterLoadedPullRequests,
  lookupState,
  typedPullRequestNumber,
} from "s/pullRequestUtils";

const SEARCH_DELAY_MS = 400;
const MIN_SEARCH_LENGTH = 3;
const MAX_LOADED_RESULTS = 20;

/**
 * Lookup of the Pull Requests explorer.
 *
 * Two layers: the Pull Requests the panel already holds are filtered as the user types, then,
 * after a pause, the git provider is searched and its results are added below. A number that is
 * not listed can be loaded directly.
 *
 * Events:
 * - search: { query, requestId }, the parent asks the git provider and answers with
 *   setRemoteResults(requestId, ...)
 * - select: { prNumber, pullRequest }, pullRequest being null when only the number is known
 */
export default class PullRequestLookup extends SharedMixin(LightningElement) {
  @api platformLabel = "";
  @api prLabel = "";
  @track query = "";
  @track open = false;
  @track activeIndex = -1;
  @track remotePullRequests = [];
  @track remoteLoading = false;
  @track remoteTruncated = false;
  // False once the git provider answered that it cannot search
  @track remoteSupported = true;
  _loaded = [];
  _searchTimer = null;
  _requestId = 0;

  @api
  get loadedPullRequests() {
    return this._loaded;
  }
  set loadedPullRequests(value) {
    this._loaded = Array.isArray(value) ? value : [];
  }

  @api
  focusInput() {
    const input = this.template.querySelector("input");
    if (input) {
      input.focus();
    }
  }

  // Answer of the git provider. A late answer to an older query is dropped.
  @api
  setRemoteResults(requestId, result) {
    if (requestId !== this._requestId) {
      return;
    }
    this.remoteLoading = false;
    if (!result || result.supported === false) {
      this.remoteSupported = false;
      this.remotePullRequests = [];
      this.remoteTruncated = false;
      return;
    }
    this.remoteSupported = true;
    this.remotePullRequests = Array.isArray(result.pullRequests)
      ? result.pullRequests
      : [];
    this.remoteTruncated = result.truncated === true;
  }

  disconnectedCallback() {
    clearTimeout(this._searchTimer);
  }

  get placeholder() {
    return this.i18n.prLookupPlaceholder;
  }

  get loadedMatches() {
    return filterLoadedPullRequests(
      this._loaded,
      this.query,
      MAX_LOADED_RESULTS,
    );
  }

  get remoteMatches() {
    return excludeKnownPullRequests(this.remotePullRequests, this.loadedMatches);
  }

  // One flat list, so the arrow keys walk through both layers
  get options() {
    const options = [];
    for (const pr of this.loadedMatches) {
      options.push(this._option(pr, "loaded"));
    }
    for (const pr of this.remoteMatches) {
      options.push(this._option(pr, "remote"));
    }
    const typed = typedPullRequestNumber(this.query);
    if (typed && !options.some((option) => option.prNumber === typed)) {
      options.push({
        key: `number-${typed}`,
        prNumber: typed,
        numberLabel: `#${typed}`,
        title: this.t("prLookupLoadByNumber", { number: typed }),
        branch: "",
        stateLabel: "",
        pillClass: "",
        isNumberOnly: true,
      });
    }
    return options.map((option, index) => ({
      ...option,
      index,
      rowClass:
        index === this.activeIndex
          ? "lookup-option lookup-option-active"
          : "lookup-option",
      selected: index === this.activeIndex,
    }));
  }

  get hasOptions() {
    return this.options.length > 0;
  }

  get showDropdown() {
    return this.open;
  }

  get showNoResult() {
    return (
      !this.hasOptions && !this.remoteLoading && this.query.trim().length > 0
    );
  }

  get searchingLabel() {
    return this.t("prLookupSearchingProvider", { platform: this.platformLabel });
  }

  get showLoadedOnly() {
    return (
      !this.remoteSupported && this.query.trim().length >= MIN_SEARCH_LENGTH
    );
  }

  get loadedOnlyLabel() {
    return this.t("prLookupLoadedOnly", {
      platform: this.platformLabel,
      prLabel: this.prLabel,
    });
  }

  get truncatedLabel() {
    return this.t("prLookupTruncated", { prLabel: this.prLabel });
  }

  handleInput(event) {
    this.query = event.target.value || "";
    this.open = true;
    this.activeIndex = -1;
    this._scheduleRemoteSearch();
  }

  handleFocus() {
    this.open = true;
  }

  handleBlur() {
    // A click on an option never blurs the input (its mousedown is prevented), so a blur
    // means the user left the lookup
    this.open = false;
  }

  handleOptionMouseDown(event) {
    event.preventDefault();
  }

  handleOptionClick(event) {
    const index = parseInt(event.currentTarget.dataset.index, 10);
    this._select(this.options[index]);
  }

  handleKeyDown(event) {
    const options = this.options;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.open = true;
      this.activeIndex = Math.min(this.activeIndex + 1, options.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // The highlighted option, else the exact number typed, else the only option there is
      const typed = typedPullRequestNumber(this.query);
      const option =
        options[this.activeIndex] ||
        (typed ? options.find((item) => item.prNumber === typed) : null) ||
        (options.length === 1 ? options[0] : null);
      if (option) {
        this._select(option);
      }
    } else if (event.key === "Escape") {
      if (this.open) {
        event.stopPropagation();
        this.open = false;
      }
    }
  }

  _select(option) {
    if (!option) {
      return;
    }
    this.open = false;
    this.dispatchEvent(
      new CustomEvent("select", {
        detail: {
          prNumber: option.prNumber,
          pullRequest: option.pullRequest || null,
        },
      }),
    );
  }

  _scheduleRemoteSearch() {
    clearTimeout(this._searchTimer);
    const query = this.query.trim();
    // Each keystroke makes the previous answer obsolete
    this._requestId += 1;
    this.remotePullRequests = [];
    this.remoteTruncated = false;
    if (query.length < MIN_SEARCH_LENGTH || !this.remoteSupported) {
      this.remoteLoading = false;
      return;
    }
    this.remoteLoading = true;
    const requestId = this._requestId;
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this._searchTimer = setTimeout(() => {
      this.dispatchEvent(
        new CustomEvent("search", { detail: { query, requestId } }),
      );
    }, SEARCH_DELAY_MS);
  }

  _option(pr, origin) {
    const state = lookupState(pr);
    const stateLabels = {
      open: this.i18n.prStateOpen,
      merged: this.i18n.prStateMerged,
      closed: this.i18n.prStateClosed,
    };
    const hues = { open: "running", merged: "success", closed: "unknown" };
    return {
      key: `${origin}-${pr.number}`,
      prNumber: pr.number,
      // Only a Pull Request of the panel carries what the view needs without another read
      pullRequest: origin === "loaded" ? pr : null,
      numberLabel: `#${pr.number}`,
      title: pr.title || "",
      branch: pr.targetBranch || "",
      stateLabel: stateLabels[state],
      // A static pill: "open" is a fact here, not an activity in progress
      pillClass:
        state === "open"
          ? "hardis-pill hardis-status-info"
          : `hardis-pill hardis-status-${hues[state]}`,
      isNumberOnly: false,
    };
  }
}
