import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getMetadataTypePillClass } from "s/pillUtils";
import {
  getActionTypeLabel,
  getActionTypePillClass,
  getActionWhenPillClass,
} from "s/deploymentActionUtils";

// Backpromote panel. sfdx-hardis is the engine: the extension runs
// `sf hardis:work:backpromote --plan --json`, `--prepare` and `--auto` and keeps the
// plan, the selection, the counters and the commands. This component renders one page
// (Where, What, Go) and posts the decisions back after every change.

const SUCCESS_PILL = "hardis-pill hardis-status-success";
const PENDING_PILL = "hardis-pill hardis-status-pending";
const FAILED_PILL = "hardis-pill hardis-status-failed";
const INFO_PILL = "hardis-pill hardis-status-info";
const UNKNOWN_PILL = "hardis-pill hardis-status-unknown";
// Pull Requests shown before the start when the list is collapsed
const EARLIER_PULL_REQUESTS_SHOWN = 2;
const DEFAULT_DOC_URL = "https://sfdx-hardis.cloudity.com/hardis/work/backpromote/";
// Value of the last entry of the target sandbox list, the one that opens the Orgs Manager
const CONNECT_ANOTHER_ORG = "__connectAnotherOrg__";

function fileName(filePath) {
  return String(filePath).split("/").pop();
}

function isDifferingComparison(comparison) {
  return (
    comparison.status === "different" || comparison.status === "pendingInOrg"
  );
}

// The comparison entries of a plan grouped by item, built once per plan
function groupComparisonsByItem(plan) {
  const byItem = new Map();
  for (const comparison of plan ? plan.comparison : []) {
    if (!byItem.has(comparison.item)) {
      byItem.set(comparison.item, []);
    }
    byItem.get(comparison.item).push(comparison);
  }
  return byItem;
}

export default class Backpromote extends SharedMixin(LightningElement) {
  loading = true;
  planError = null;
  tokenMissing = false;
  // Environment variables sfdx-hardis reads the git provider token from, sent by the extension
  tokenVariables = [];
  docUrl = DEFAULT_DOC_URL;
  setup = null;
  targetOrg = null;
  parentBranch = null;
  plan = null;
  comparisonsByItem = new Map();
  selection = null;
  summary = null;
  command = null;
  commandError = null;
  markers = {};
  targetOrgLabel = "";
  workspaceRoot = "";
  revision = 0;
  running = false;
  runLog = [];
  runResult = null;
  runError = null;
  planProgress = null;
  // Items whose merged files are being written by sfdx-hardis
  preparing = [];
  showAllPullRequests = false;
  collapsedTypes = [];
  showCommand = false;
  // The working tree is not clean: commit or stash before the checkout switches
  dirtyTreeModal = null;
  dirtyTreeAction = "stash";
  dirtyTreeMessage = "WIP";
  confirmingActions = [];

  // jscpd:ignore-start
  @api
  handleColorThemeMessage(type, data) {
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }
  // jscpd:ignore-end

  @api
  initialize(data) {
    const payload = data || {};
    this.loading = payload.loading === true;
    if (this.loading) {
      this.planProgress = null;
    }
    this.planError = payload.planError || null;
    if (payload.tokenMissing !== undefined) {
      this.tokenMissing = payload.tokenMissing === true;
    }
    if (Array.isArray(payload.tokenVariables)) {
      this.tokenVariables = payload.tokenVariables;
    }
    if (payload.docUrl) {
      this.docUrl = payload.docUrl;
    }
    if (payload.setup) {
      this.setup = payload.setup;
    }
    if (payload.targetOrg !== undefined) {
      this.targetOrg = payload.targetOrg || null;
    }
    if (payload.parentBranch !== undefined) {
      this.parentBranch = payload.parentBranch || null;
    }
    if (payload.plan === null) {
      this.plan = null;
      this.comparisonsByItem = new Map();
      this.summary = null;
      this.command = null;
    }
    if (payload.plan) {
      this.plan = payload.plan;
      this.comparisonsByItem = groupComparisonsByItem(payload.plan);
      this.parentBranch = payload.plan.parentBranch;
      this.applySelectionPayload(payload);
      this.targetOrgLabel = payload.targetOrgLabel || "";
      this.workspaceRoot = payload.workspaceRoot || "";
      this.preparing = [];
      this.confirmingActions = [];
      if (typeof payload.revision === "number") {
        this.revision = Math.max(this.revision, payload.revision);
      }
    }
    if (payload.running !== undefined) {
      this.running = payload.running === true;
    }
    if (payload.runLog !== undefined) {
      this.runLog = payload.runLog || [];
    }
    if (payload.runResult !== undefined) {
      this.runResult = payload.runResult || null;
    }
    if (payload.runError !== undefined) {
      this.runError = payload.runError || null;
    }
  }

  @api
  handleMessage(type, data) {
    switch (type) {
      case "state":
        // A state push of the extension: same merge as the initialization, without the translations
        this.initialize(data);
        break;
      case "planProgress":
        this.planProgress = this.loading ? data || null : null;
        break;
      case "selectionSummary":
        // Ignore the answer to a selection the user already changed again
        if (data && data.revision === this.revision) {
          this.applySelectionPayload(data);
        }
        break;
      case "prepareStarted":
        if (data && data.itemKey && !this.preparing.includes(data.itemKey)) {
          this.preparing = [...this.preparing, data.itemKey];
        }
        break;
      case "prepareFailed":
        this.preparing = this.preparing.filter(
          (key) => !data || key !== data.itemKey,
        );
        break;
      case "confirmActionFinished":
        this.confirmingActions = this.confirmingActions.filter(
          (id) => !data || id !== data.actionId,
        );
        break;
      case "runStarted":
        this.running = true;
        this.runLog = [];
        this.runResult = null;
        this.runError = null;
        break;
      case "runProgress":
        // Only the steps appended since the last message travel
        this.runLog = [...this.runLog, ...((data && data.appended) || [])];
        break;
      case "runFinished":
        this.running = false;
        break;
      default:
        break;
    }
  }

  applySelectionPayload(payload) {
    if (payload.selection) {
      this.selection = payload.selection;
    }
    if (payload.markers) {
      this.markers = payload.markers;
    }
    this.summary = payload.summary || null;
    this.command = payload.command || null;
    this.commandError = payload.commandError || null;
  }

  updateSelection(changes) {
    if (!this.selection) {
      return;
    }
    this.selection = { ...this.selection, ...changes };
    this.revision += 1;
    window.sendMessageToVSCode({
      type: "selectionChanged",
      data: { selection: this.selection, revision: this.revision },
    });
  }

  countLabel(count, oneKey, manyKey) {
    return this.t(count === 1 ? oneKey : manyKey, { count });
  }

  formatDate(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    try {
      return date.toLocaleDateString(this.locale || undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      return date.toISOString().slice(0, 10);
    }
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  get isLoadingState() {
    return this.loading;
  }

  get hasPlanProgress() {
    return !!this.planProgress;
  }

  get planProgressMessage() {
    return this.planProgress ? this.planProgress.message : "";
  }

  get hasPlanProgressPercent() {
    return (
      !!this.planProgress && typeof this.planProgress.percent === "number"
    );
  }

  get planProgressFillStyle() {
    return this.hasPlanProgressPercent
      ? `width: ${this.planProgress.percent}%`
      : "";
  }

  get planProgressDoneSteps() {
    return this.planProgress ? this.planProgress.doneSteps || [] : [];
  }

  get isTokenMissing() {
    return !this.loading && this.tokenMissing;
  }

  get hasPlanError() {
    return !this.loading && !this.tokenMissing && !!this.planError;
  }

  get isCliTooOld() {
    return this.hasPlanError && this.planError.cliTooOld === true;
  }

  get isGenericError() {
    return this.hasPlanError && this.planError.cliTooOld !== true;
  }

  get planErrorMessage() {
    return this.planError ? this.planError.message : "";
  }

  get isReady() {
    return !this.loading && !this.tokenMissing && !this.planError && !!this.plan;
  }

  // The setup is loaded but no plan can be computed yet: no allowed org, or no allowed branch
  get isSetupOnly() {
    return (
      !this.loading &&
      !this.tokenMissing &&
      !this.planError &&
      !this.plan &&
      !!this.setup
    );
  }

  get showPickers() {
    return !this.loading && !this.tokenMissing && !!this.setup;
  }

  get isBlocked() {
    return (
      this.isReady &&
      (this.plan.status === "blocked" || this.plan.status === "refused")
    );
  }

  get showPlan() {
    return this.isReady && !this.isBlocked && !!this.summary;
  }

  // While a merge is prepared, the answer is about this plan: nothing that changes it is offered
  get isReadOnly() {
    return (
      !this.plan || this.isBlocked || this.running || this.preparing.length > 0
    );
  }

  // A new plan is refused by the extension while a run or a prepare works on the checkout
  get pickersDisabled() {
    return this.running || this.preparing.length > 0;
  }

  get refreshDisabled() {
    return this.loading || this.pickersDisabled;
  }

  get tokenVariablesLabel() {
    return (this.tokenVariables || []).join(" · ");
  }

  // ---------------------------------------------------------------------------
  // Where: sandbox, parent branch, start Pull Request
  // ---------------------------------------------------------------------------

  // The last entry of the list opens the Orgs Manager to authenticate another org
  get targetOrgOptions() {
    const orgs = this.setup ? this.setup.orgs : [];
    const options = orgs.map((org) => {
      let suffix = "";
      if (org.disabledReason === "majorOrg") {
        suffix = ` (${this.t("backpromoteOrgOfBranch", { branch: org.majorBranch || "" })})`;
      } else if (org.disabledReason === "production") {
        suffix = ` (${this.t("backpromoteOrgIsProduction")})`;
      }
      return { label: org.label + suffix, value: org.username };
    });
    options.push({
      label: this.t("backpromoteConnectOtherOrg"),
      value: CONNECT_ANOTHER_ORG,
    });
    return options;
  }

  get targetOrgValue() {
    return this.targetOrg || "";
  }

  get hasNoAllowedOrg() {
    return (
      !!this.setup && !this.setup.orgs.some((org) => !org.disabledReason)
    );
  }

  get parentBranchOptions() {
    const choices = new Set([
      ...(this.setup ? this.setup.allowedParentBranches : []),
      ...(this.plan ? this.plan.allowedParentBranches : []),
    ]);
    return [...choices].map((branch) => ({ label: branch, value: branch }));
  }

  get showParentBranchPicker() {
    return this.parentBranchOptions.length > 1;
  }

  get hasNoAllowedBranch() {
    return this.parentBranchOptions.length === 0;
  }

  get parentBranchValue() {
    return this.parentBranch || "";
  }

  // The combobox already shows the entry the user picked: the value is set to it and back so
  // the rendered value follows the tracked one again
  _restorePickerValue(previous) {
    this.targetOrg = CONNECT_ANOTHER_ORG;
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      this.targetOrg = previous;
    }, 0);
  }

  handleTargetOrgChange(event) {
    const targetOrg = event.detail.value || null;
    const choice = (this.setup ? this.setup.orgs : []).find(
      (org) => org.username === targetOrg,
    );
    if (!targetOrg || targetOrg === this.targetOrg) {
      return;
    }
    if (targetOrg === CONNECT_ANOTHER_ORG) {
      // The picker goes back to the current org while the Orgs Manager opens: the org
      // authenticated there becomes the target once it is the default org
      this._restorePickerValue(this.targetOrg);
      window.sendMessageToVSCode({ type: "selectOrg" });
      return;
    }
    if (choice && choice.disabledReason) {
      // The picker goes back to the current org: a major org is never a target
      this._restorePickerValue(this.targetOrg);
      return;
    }
    this.targetOrg = targetOrg;
    this.loading = true;
    this.planError = null;
    this.runResult = null;
    this.runError = null;
    window.sendMessageToVSCode({
      type: "changeTargetOrg",
      data: { targetOrg, parentBranch: this.parentBranch },
    });
  }

  handleParentBranchChange(event) {
    const parentBranch = event.detail.value || null;
    if (!parentBranch || parentBranch === this.parentBranch) {
      return;
    }
    this.parentBranch = parentBranch;
    this.loading = true;
    this.planError = null;
    this.runResult = null;
    this.runError = null;
    window.sendMessageToVSCode({
      type: "changeParentBranch",
      data: { targetOrg: this.targetOrg, parentBranch },
    });
  }

  get whereSummary() {
    if (!this.plan) {
      return "";
    }
    const inWindow = this.plan.pullRequests.filter((pr) => pr.inWindow).length;
    return this.countLabel(
      inWindow,
      "backpromoteWindowSummaryOne",
      "backpromoteWindowSummary",
    );
  }

  get backpromoteBranchName() {
    return this.plan ? this.plan.backpromoteBranch.name : "";
  }

  get hasPendingMerges() {
    return (
      !!this.plan && this.plan.backpromoteBranch.pendingMerges.length > 0
    );
  }

  get pendingMergesLabel() {
    return this.plan
      ? this.countLabel(
          this.plan.backpromoteBranch.pendingMerges.length,
          "backpromotePendingMergesOne",
          "backpromotePendingMerges",
        )
      : "";
  }

  get pullRequestRows() {
    if (!this.plan) {
      return [];
    }
    const all = this.plan.pullRequests;
    const lastInWindow = all.map((pr) => pr.inWindow).lastIndexOf(true);
    const shownUntil = this.showAllPullRequests
      ? all.length
      : (lastInWindow >= 0 ? lastInWindow + 1 : 0) + EARLIER_PULL_REQUESTS_SHOWN;
    return all.slice(0, shownUntil).map((pr) => {
      let statusLabel = null;
      let statusClass = UNKNOWN_PILL;
      let statusTitle = "";
      if (pr.backpromote) {
        statusLabel = this.t("backpromoteAlreadyOn", {
          date: this.formatDate(pr.backpromote.date),
        });
        statusTitle = this.t("backpromoteAlreadyOnBy", {
          date: this.formatDate(pr.backpromote.date),
          user: pr.backpromote.user,
        });
        statusClass =
          pr.backpromote.status === "partial" ? PENDING_PILL : SUCCESS_PILL;
        if (pr.backpromote.status === "partial") {
          statusLabel = this.t("backpromotePartialOn", {
            date: this.formatDate(pr.backpromote.date),
          });
        }
      } else if (pr.beforeRefresh) {
        statusLabel = this.t("backpromoteBeforeRefresh");
        statusTitle = this.t("backpromoteBeforeRefreshTooltip");
        statusClass = INFO_PILL;
      } else if (pr.beforeLastBackpromote) {
        statusLabel = this.t("backpromoteBeforeLastBackpromote");
        statusTitle = this.t("backpromoteBeforeLastBackpromoteTooltip");
        statusClass = SUCCESS_PILL;
      }
      const meta = [
        pr.author,
        this.formatDate(pr.mergeDate),
        this.countLabel(pr.itemCount, "backpromoteItemCountOne", "backpromoteItemCount"),
        pr.actionCount > 0
          ? this.countLabel(pr.actionCount, "backpromoteActionCountOne", "backpromoteActionCount")
          : null,
      ]
        .filter((part) => !!part)
        .join(" · ");
      return {
        key: `${pr.commit}-${pr.number}`,
        number: pr.number,
        hasNumber: pr.number > 0,
        label: pr.number > 0 ? `#${pr.number} ${pr.title}` : pr.title,
        meta,
        webUrl: pr.webUrl || null,
        selected: pr.selected,
        inWindow: pr.inWindow,
        rowClass:
          "hardis-option-row bp-pr-row" +
          (pr.selected ? " selected" : "") +
          (pr.backpromote || pr.beforeLastBackpromote ? " bp-done" : ""),
        radioClass: "bp-radio" + (pr.selected ? " on" : ""),
        statusLabel,
        statusClass,
        statusTitle,
      };
    });
  }

  get hasPullRequests() {
    return !!this.plan && this.plan.pullRequests.length > 0;
  }

  get hasHiddenPullRequests() {
    return (
      !!this.plan &&
      !this.showAllPullRequests &&
      this.pullRequestRows.length < this.plan.pullRequests.length
    );
  }

  get canScanEarlier() {
    return !!this.plan && this.plan.scan.hasMore;
  }

  get scanNotFoundNote() {
    if (!this.plan || this.plan.scan.found || this.plan.window) {
      return null;
    }
    return this.t("backpromoteNoHistoryFound", {
      count: this.plan.scan.read,
      sandbox: this.targetOrgLabel,
    });
  }

  handleShowAllPullRequests() {
    this.showAllPullRequests = true;
  }

  handleScanEarlier() {
    if (this.pickersDisabled) {
      return;
    }
    this.loading = true;
    window.sendMessageToVSCode({ type: "showEarlier" });
  }

  handleStartPullRequest(event) {
    const number = Number(event.currentTarget.dataset.number);
    if (this.isReadOnly || !number || !this.plan) {
      return;
    }
    const current = this.plan.window ? this.plan.window.startPullRequest : null;
    if (number === current) {
      return;
    }
    this.loading = true;
    this.runResult = null;
    this.runError = null;
    window.sendMessageToVSCode({
      type: "changeStartPullRequest",
      data: { number },
    });
  }

  handleOpenPullRequest(event) {
    // The title sits in the row that picks the start Pull Request: opening the page does not pick
    event.stopPropagation();
    const url = event.currentTarget.dataset.url;
    if (url) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }

  handleResetBranch() {
    window.sendMessageToVSCode({ type: "resetBranch" });
  }

  // ---------------------------------------------------------------------------
  // What: items, deletions, actions
  // ---------------------------------------------------------------------------

  get whatSummary() {
    if (!this.plan || !this.summary) {
      return "";
    }
    const parts = [
      this.countLabel(this.plan.items.length, "backpromoteItemCountOne", "backpromoteItemCount"),
    ];
    if (this.plan.deletions.length > 0) {
      parts.push(
        this.countLabel(this.plan.deletions.length, "backpromoteDeletionCountOne", "backpromoteDeletionCount"),
      );
    }
    if (this.plan.actions.length > 0) {
      parts.push(
        this.countLabel(this.plan.actions.length, "backpromoteActionCountOne", "backpromoteActionCount"),
      );
    }
    return parts.join(", ");
  }

  get windowLabel() {
    if (!this.plan || !this.plan.window) {
      return "";
    }
    return this.t("backpromoteWindowLabel", {
      number: this.plan.window.startPullRequest || "",
      parentBranch: this.plan.parentBranch,
    });
  }

  get hasWindow() {
    return !!this.plan && !!this.plan.window;
  }

  get hasItems() {
    return this.hasWindow && this.plan.items.length > 0;
  }

  get hasNothingInWindow() {
    return (
      this.hasWindow &&
      this.plan.items.length === 0 &&
      this.plan.deletions.length === 0 &&
      this.plan.actions.length === 0
    );
  }

  get hasDifferingItems() {
    return !!this.plan && this.plan.items.some((item) => this.itemDiffers(item.key));
  }

  get preparedFilesCount() {
    return this.plan
      ? this.plan.comparison.filter((comparison) => comparison.prepared).length
      : 0;
  }

  get hasPreparedFiles() {
    return this.preparedFilesCount > 0;
  }

  get copyPromptLabel() {
    return this.t("backpromoteCopyAgentPrompt", { count: this.preparedFilesCount });
  }

  itemComparisons(key) {
    return this.comparisonsByItem.get(key) || [];
  }

  itemDiffers(key) {
    return this.itemComparisons(key).some(isDifferingComparison);
  }

  itemMarkers(key) {
    return this.itemComparisons(key)
      .filter((comparison) => comparison.prepared)
      .reduce(
        (total, comparison) =>
          total +
          (typeof this.markers[comparison.file] === "number"
            ? this.markers[comparison.file]
            : comparison.markersRemaining),
        0,
      );
  }

  itemPrepared(key) {
    return this.itemComparisons(key).some((comparison) => comparison.prepared);
  }

  buildItemRow(item, excluded, previousRun) {
    const comparisons = this.itemComparisons(item.key);
    const differs = this.itemDiffers(item.key);
    const decision =
      (this.selection && this.selection.diffDecisions[item.key]) || "git";
    const prepared = this.itemPrepared(item.key);
    const markers = this.itemMarkers(item.key);
    const isExcluded = excluded.has(item.key);
    const preparing = this.preparing.includes(item.key);
    let stateLabel = null;
    let stateClass = UNKNOWN_PILL;
    let stateTitle = "";
    if (item.noOverwrite) {
      stateLabel = this.t("backpromoteNoOverwrite");
      stateTitle = this.t("backpromoteNoOverwriteTooltip");
    } else if (isExcluded) {
      stateLabel = this.t("backpromoteNotDeployedNow");
    } else if (differs && decision === "merge") {
      if (preparing) {
        stateLabel = this.t("backpromotePreparingMerge");
        stateClass = PENDING_PILL;
      } else if (!prepared) {
        stateLabel = this.t("backpromoteMergeNotPrepared");
        stateClass = PENDING_PILL;
      } else if (markers > 0) {
        stateLabel = this.countLabel(markers, "backpromoteConflictLeftOne", "backpromoteConflictLeft");
        stateClass = PENDING_PILL;
      } else {
        stateLabel = this.t("backpromoteMerged");
        stateClass = SUCCESS_PILL;
      }
    } else if (prepared && markers > 0) {
      // Switched back to Overwrite or Keep org version: the merged file still holds markers
      stateLabel = this.countLabel(markers, "backpromoteConflictLeftOne", "backpromoteConflictLeft");
      stateClass = PENDING_PILL;
      stateTitle = this.t("backpromotePreparedNotMergedTooltip");
    } else if (differs && decision === "org") {
      stateLabel = this.t("backpromoteKeptOrgVersion");
      stateClass = INFO_PILL;
    } else if (differs) {
      stateLabel = comparisons.some((comparison) => comparison.status === "pendingInOrg")
        ? this.t("backpromoteDiffersPendingInOrg")
        : this.t("backpromoteDiffersInSandbox", { sandbox: this.targetOrgLabel });
      stateClass = PENDING_PILL;
      stateTitle = this.t("backpromoteDiffersTooltip", {
        sandbox: this.targetOrgLabel,
        parentBranch: this.plan.parentBranch,
      });
    } else if (comparisons.some((comparison) => comparison.status === "missingInOrg")) {
      stateLabel = this.t("backpromoteNewInSandbox");
      stateClass = INFO_PILL;
    } else if (comparisons.some((comparison) => comparison.status === "notCompared")) {
      stateLabel = this.t("backpromoteNotCompared");
    } else if (comparisons.length > 0) {
      stateLabel = this.t("backpromoteSameAsSandbox");
    }
    const leftOutLastTime = previousRun && previousRun.has(item.key);
    return {
      key: item.key,
      name: item.name,
      typeLabel: item.type,
      typePillClass: getMetadataTypePillClass(item.type),
      pullRequests: item.pullRequests.map((number) => ({ key: `${item.key}-${number}`, label: `#${number}` })),
      excludedLastTime: item.excludedLastTime || leftOutLastTime,
      noOverwrite: item.noOverwrite,
      rowClass:
        "bp-item-row" +
        (isExcluded ? "" : " selected") +
        (item.noOverwrite ? " bp-disabled" : ""),
      checkClass: "hardis-check" + (isExcluded ? "" : " on"),
      ariaChecked: isExcluded ? "false" : "true",
      checkDisabled: item.noOverwrite || this.isReadOnly,
      stateLabel,
      stateClass,
      stateTitle,
      showDecision: differs && !isExcluded && !item.noOverwrite,
      decisionDisabled: this.isReadOnly || preparing,
      gitClass: "hardis-seg" + (decision === "git" ? " on" : ""),
      orgClass: "hardis-seg" + (decision === "org" ? " on" : ""),
      mergeClass: "hardis-seg" + (decision === "merge" ? (markers > 0 || !prepared ? " warn-on" : " on") : ""),
      canCompare: comparisons.some(
        (comparison) => comparison.versions.sandbox && comparison.versions.parentHead,
      ),
    };
  }

  get itemGroups() {
    if (!this.plan || !this.selection) {
      return [];
    }
    const excluded = new Set(this.selection.excludedItems);
    const previousRun = new Set(
      this.plan.pullRequests
        .filter((pr) => pr.backpromote && pr.backpromote.status === "partial")
        .flatMap((pr) => pr.backpromote.leftOut.map((entry) => entry.key)),
    );
    const byType = new Map();
    for (const item of this.plan.items) {
      if (!byType.has(item.type)) {
        byType.set(item.type, []);
      }
      byType.get(item.type).push(item);
    }
    return [...byType.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, items]) => {
        const collapsed = this.collapsedTypes.includes(type);
        const ticked = items.filter((item) => !excluded.has(item.key)).length;
        return {
          type,
          typePillClass: getMetadataTypePillClass(type),
          countLabel: this.t("backpromoteTypeCount", { ticked, total: items.length }),
          collapsed,
          expanded: !collapsed,
          chevron: collapsed ? "utility:chevronright" : "utility:chevrondown",
          rows: collapsed ? [] : items.map((item) => this.buildItemRow(item, excluded, previousRun)),
        };
      });
  }

  handleToggleType(event) {
    const type = event.currentTarget.dataset.type;
    this.collapsedTypes = this.collapsedTypes.includes(type)
      ? this.collapsedTypes.filter((entry) => entry !== type)
      : [...this.collapsedTypes, type];
  }

  handleToggleItem(event) {
    const key = event.currentTarget.dataset.key;
    if (this.isReadOnly || !key || !this.selection || !this.plan) {
      return;
    }
    const item = this.plan.items.find((entry) => entry.key === key);
    if (!item || item.noOverwrite) {
      return;
    }
    const excluded = this.selection.excludedItems.includes(key);
    this.updateSelection({
      excludedItems: excluded
        ? this.selection.excludedItems.filter((entry) => entry !== key)
        : [...this.selection.excludedItems, key],
    });
  }

  handleDecision(event) {
    const { key, choice } = event.currentTarget.dataset;
    if (this.isReadOnly || !key || !choice || !this.selection) {
      return;
    }
    if (choice === "merge") {
      this.requestMerge(key);
      return;
    }
    this.updateSelection({
      diffDecisions: { ...this.selection.diffDecisions, [key]: choice },
    });
  }

  handleOverwriteAll() {
    if (this.isReadOnly || !this.selection || !this.plan) {
      return;
    }
    const diffDecisions = {};
    for (const key of Object.keys(this.selection.diffDecisions)) {
      diffDecisions[key] = "git";
    }
    this.updateSelection({ diffDecisions });
  }

  requestMerge(key, dirtyTree) {
    if (
      !dirtyTree &&
      !this.itemPrepared(key) &&
      this.needsDirtyTreeChoice
    ) {
      this.openDirtyTreeModal({ then: "merge", itemKey: key });
      return;
    }
    this.selection = {
      ...this.selection,
      diffDecisions: { ...this.selection.diffDecisions, [key]: "merge" },
    };
    this.revision += 1;
    if (!this.itemPrepared(key) && !this.preparing.includes(key)) {
      this.preparing = [...this.preparing, key];
    }
    window.sendMessageToVSCode({
      type: "mergeItem",
      data: {
        itemKey: key,
        selection: this.selection,
        revision: this.revision,
        dirtyTree: dirtyTree || null,
      },
    });
  }

  // The VS Code diff editor between the sandbox version and the parent branch version of
  // each differing file of the item (both kept in the cache of sfdx-hardis)
  handleCompare(event) {
    const key = event.currentTarget.dataset.key;
    for (const comparison of this.itemComparisons(key)) {
      const { sandbox, parentHead } = comparison.versions;
      if (!isDifferingComparison(comparison) || !sandbox || !parentHead) {
        continue;
      }
      window.sendMessageToVSCode({
        type: "openVscodeDiff",
        data: {
          leftPath: sandbox,
          rightPath: parentHead,
          title: `${fileName(comparison.file)}: ${this.targetOrgLabel} (org) <-> ${this.plan.parentBranch} (git)`,
        },
      });
    }
  }

  handleCopyAgentPrompt() {
    window.sendMessageToVSCode({ type: "copyAgentPrompt" });
  }

  // --- Deletions ---------------------------------------------------------------

  get hasDeletions() {
    return this.hasWindow && this.plan.deletions.length > 0;
  }

  get deletionsSummary() {
    return this.plan
      ? this.t("backpromoteDeletionsSummary", {
          selected: this.summary ? this.summary.deletionsToDeleteCount : 0,
          total: this.plan.deletions.length,
        })
      : "";
  }

  get deletionRows() {
    if (!this.plan || !this.selection) {
      return [];
    }
    const excluded = new Set(this.selection.excludedDeletions);
    return this.plan.deletions.map((deletion) => ({
      key: deletion.key,
      typeLabel: deletion.type,
      typePillClass: getMetadataTypePillClass(deletion.type),
      name: deletion.name,
      rowClass: "bp-item-row" + (excluded.has(deletion.key) ? "" : " selected"),
      checkClass: "hardis-check" + (excluded.has(deletion.key) ? "" : " on"),
      ariaChecked: excluded.has(deletion.key) ? "false" : "true",
    }));
  }

  handleToggleDeletion(event) {
    const key = event.currentTarget.dataset.key;
    if (this.isReadOnly || !key || !this.selection) {
      return;
    }
    const excluded = this.selection.excludedDeletions.includes(key);
    this.updateSelection({
      excludedDeletions: excluded
        ? this.selection.excludedDeletions.filter((entry) => entry !== key)
        : [...this.selection.excludedDeletions, key],
    });
  }

  // --- Deployment actions ------------------------------------------------------

  get hasActions() {
    return this.hasWindow && this.plan.actions.length > 0;
  }

  get actionsSummary() {
    if (!this.plan || !this.summary) {
      return "";
    }
    const parts = [this.t("backpromoteActionsToRun", { count: this.summary.actionsToRunCount })];
    if (this.summary.manualActionsCount > 0) {
      parts.push(this.t("backpromoteActionsManual", { count: this.summary.manualActionsCount }));
    }
    return parts.join(" · ");
  }

  get actionRows() {
    if (!this.plan || !this.selection) {
      return [];
    }
    const selected = new Set(this.selection.actions);
    const translate = (key) => this.t(key);
    const result = this.runResult ? this.runResult.result : null;
    return this.plan.actions.map((action) => {
      const alreadyRun = !!action.alreadyRunOn && action.runOnlyOnceByOrg;
      const runnable = action.runnable && !alreadyRun;
      let stateLabel = null;
      let stateClass = UNKNOWN_PILL;
      if (alreadyRun) {
        stateLabel = this.t("backpromoteActionAlreadyRun", { date: this.formatDate(action.alreadyRunOn) });
        stateClass = SUCCESS_PILL;
      } else if (!action.runnable) {
        stateLabel = this.t("backpromoteActionNotRunnable", { username: action.customUsername || "" });
      } else if (result && result.actions.failed.includes(action.id)) {
        stateLabel = this.t("backpromoteActionFailed");
        stateClass = FAILED_PILL;
      } else if (result && result.actions.run.includes(action.id)) {
        stateLabel = this.t("backpromoteActionRan");
        stateClass = SUCCESS_PILL;
      } else if (result && result.actions.pending.includes(action.id)) {
        stateLabel = this.t("backpromoteActionToDoByHand");
        stateClass = PENDING_PILL;
      } else if (action.manual) {
        stateLabel = this.t("backpromoteManualStep");
        stateClass = PENDING_PILL;
      }
      // A manual step can be recorded as done at any time: before a run, after a refresh
      const showConfirm = action.manual && action.runnable && !alreadyRun;
      const ticked = runnable && selected.has(action.id);
      return {
        id: action.id,
        label: action.label,
        rowClass:
          "bp-item-row bp-action-row" +
          (ticked ? " selected" : "") +
          (runnable ? "" : " bp-disabled"),
        checkClass: "hardis-check" + (ticked ? " on" : ""),
        ariaChecked: ticked ? "true" : "false",
        disabled: !runnable || this.isReadOnly,
        whenLabel: this.t(action.phase === "pre" ? "backpromoteActionBefore" : "backpromoteActionAfter"),
        whenPillClass: getActionWhenPillClass(action.phase === "pre" ? "pre-deploy" : "post-deploy"),
        typeLabel: getActionTypeLabel(action.type, translate),
        typePillClass: getActionTypePillClass(action.type),
        pullRequestLabel: action.pullRequest ? `#${action.pullRequest}` : null,
        stateLabel,
        stateClass,
        showConfirm,
        // The extension refuses the confirmation while a run or a prepare works on the checkout
        confirmDisabled: this.confirmingActions.includes(action.id) || this.pickersDisabled,
      };
    });
  }

  handleToggleAction(event) {
    const id = event.currentTarget.dataset.id;
    if (this.isReadOnly || !id || !this.selection || !this.plan) {
      return;
    }
    const action = this.plan.actions.find((entry) => entry.id === id);
    if (!action || !action.runnable || (action.alreadyRunOn && action.runOnlyOnceByOrg)) {
      return;
    }
    const actions = new Set(this.selection.actions);
    if (actions.has(id)) {
      actions.delete(id);
    } else {
      actions.add(id);
    }
    this.updateSelection({
      actions: this.plan.actions.map((entry) => entry.id).filter((actionId) => actions.has(actionId)),
    });
  }

  handleConfirmAction(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.pickersDisabled) {
      return;
    }
    this.confirmingActions = [...this.confirmingActions, id];
    window.sendMessageToVSCode({ type: "confirmAction", data: { actionId: id } });
  }

  // ---------------------------------------------------------------------------
  // Go: run, progress, result
  // ---------------------------------------------------------------------------

  get goSummary() {
    if (!this.summary || !this.plan) {
      return "";
    }
    const parts = [
      this.countLabel(this.summary.itemsToDeployCount, "backpromoteItemCountOne", "backpromoteItemCount"),
    ];
    if (this.summary.deletionsToDeleteCount > 0) {
      parts.push(
        this.countLabel(this.summary.deletionsToDeleteCount, "backpromoteDeletionCountOne", "backpromoteDeletionCount"),
      );
    }
    if (this.summary.actionsToRunCount > 0) {
      parts.push(
        this.countLabel(this.summary.actionsToRunCount, "backpromoteActionCountOne", "backpromoteActionCount"),
      );
    }
    if (this.summary.mergedFilesCount > 0) {
      parts.push(
        this.countLabel(this.summary.mergedFilesCount, "backpromoteMergedFileCountOne", "backpromoteMergedFileCount"),
      );
    }
    if (this.summary.keptOrgCount > 0) {
      parts.push(
        this.countLabel(this.summary.keptOrgCount, "backpromoteKeptOrgCountOne", "backpromoteKeptOrgCount"),
      );
    }
    return parts.join(", ");
  }

  get runLabel() {
    return this.t("backpromoteRunButton", { sandbox: this.targetOrgLabel });
  }

  get runDisabled() {
    return this.isReadOnly || !this.summary || !this.summary.canRun || this.running;
  }

  get blockerLabel() {
    if (!this.summary || this.summary.blockers.length === 0) {
      return null;
    }
    switch (this.summary.blockers[0]) {
      case "notReady":
        return this.t("backpromoteBlockerNotReady");
      case "noWindow":
        return this.t("backpromoteBlockerNoWindow");
      case "nothingToDo":
        return this.t("backpromoteBlockerNothingToDo");
      case "conflictMarkers":
        return this.t("backpromoteBlockerConflicts", {
          names: this.markersLeftNames(true),
        });
      case "preparedMarkers":
        return this.t("backpromoteBlockerPreparedFiles", {
          names: this.markersLeftNames(false),
        });
      case "invalidCommand":
        return this.t("backpromoteBlockerInvalidCommand", { message: this.commandError || "" });
      default:
        return null;
    }
  }

  markersLeftNames(merging) {
    const names = this.summary.markersLeft
      .filter((entry) => entry.merging === merging)
      .map((entry) => fileName(entry.file));
    return [...new Set(names)].join(", ");
  }

  get checkoutNote() {
    if (!this.plan) {
      return null;
    }
    if (this.plan.checkout.onBackpromoteBranch) {
      return this.t("backpromoteCheckoutOnBranch", {
        branch: this.plan.backpromoteBranch.name,
        original: this.plan.checkout.originalBranch,
      });
    }
    if (!this.plan.checkout.clean) {
      return this.t("backpromoteCheckoutNotClean", {
        count: this.plan.checkout.dirtyFiles.length,
        branch: this.plan.checkout.currentBranch,
      });
    }
    return null;
  }

  get needsDirtyTreeChoice() {
    return (
      !!this.plan &&
      !this.plan.checkout.clean &&
      !this.plan.checkout.onBackpromoteBranch
    );
  }

  // After a successful run (the plan is then the answer of the run), or when nothing prepared
  // waits in the checkout: a merged file not committed yet would be refused by the checkout,
  // or carried onto the story branch
  get showBackToBranch() {
    const plan = this.plan;
    return (
      !!plan &&
      plan.checkout.onBackpromoteBranch &&
      !!plan.checkout.originalBranch &&
      plan.checkout.originalBranch !== plan.backpromoteBranch.name &&
      (!!this.runResult || !this.hasPreparedFiles)
    );
  }

  get backToBranchLabel() {
    return this.plan
      ? this.t("backpromoteBackToBranch", { branch: this.plan.checkout.originalBranch })
      : "";
  }

  get runLogRows() {
    return (this.runLog || []).map((event, index) => ({
      key: `${event.step}-${index}`,
      message: event.message,
      counted: typeof event.current === "number" && typeof event.total === "number",
      countLabel: typeof event.current === "number" ? `${event.current}/${event.total}` : "",
      last: index === this.runLog.length - 1,
      iconName: index === this.runLog.length - 1 && this.running ? "utility:sync" : "utility:check",
    }));
  }

  get hasRunLog() {
    return (this.runLog || []).length > 0;
  }

  get hasRunResult() {
    return !this.running && !!this.runResult && !!this.runResult.result;
  }

  // A successful answer without a result block (nothing to do): its message is the result
  get hasRunMessage() {
    return (
      !this.running &&
      !!this.runResult &&
      !this.runResult.result &&
      !!this.runResult.message
    );
  }

  get runMessage() {
    return this.runResult ? this.runResult.message : "";
  }

  get hasRunError() {
    return !this.running && !!this.runError;
  }

  get runErrorMessage() {
    return this.runError ? this.runError.message : "";
  }

  get runErrorStatusLabel() {
    const status = this.runError ? this.runError.status : null;
    switch (status) {
      case "conflictsRemaining":
        return this.t("backpromoteStatusConflictsRemaining");
      case "deployFailed":
        return this.t("backpromoteStatusDeployFailed");
      case "pushRejected":
        return this.t("backpromoteStatusPushRejected");
      case "refused":
        return this.t("backpromoteStatusRefused");
      default:
        return this.t("backpromoteStatusFailed");
    }
  }

  get resultLines() {
    if (!this.hasRunResult) {
      return [];
    }
    const result = this.runResult.result;
    const lines = [];
    lines.push({
      key: "deployed",
      icon: "utility:check",
      text: this.t("backpromoteResultDeployed", {
        count: result.deployed,
        deleted: result.deleted,
        sandbox: this.targetOrgLabel,
      }),
    });
    if (result.actions.run.length > 0 || result.actions.skipped.length > 0 || result.actions.failed.length > 0) {
      lines.push({
        key: "actions",
        icon: result.actions.failed.length > 0 ? "utility:warning" : "utility:check",
        text: this.t("backpromoteResultActions", {
          run: result.actions.run.length,
          skipped: result.actions.skipped.length,
          failed: result.actions.failed.length,
        }),
      });
    }
    if (result.actions.pending.length > 0) {
      lines.push({
        key: "pending",
        icon: "utility:priority",
        text: this.countLabel(result.actions.pending.length, "backpromoteResultPendingOne", "backpromoteResultPending"),
      });
    }
    if (result.excluded.length > 0) {
      lines.push({
        key: "excluded",
        icon: "utility:info",
        text: this.t("backpromoteResultExcluded", {
          count: result.excluded.length,
          items: result.excluded.map((entry) => entry.key).join(", "),
        }),
      });
    }
    if (result.conflictPending.length > 0) {
      lines.push({
        key: "conflicts",
        icon: "utility:warning",
        text: this.t("backpromoteResultConflictPending", { items: result.conflictPending.join(", ") }),
      });
    }
    if (result.commentedPullRequests.length > 0) {
      lines.push({
        key: "comments",
        icon: "utility:comments",
        text: this.t("backpromoteResultComments", {
          numbers: result.commentedPullRequests.map((number) => `#${number}`).join(", "),
        }),
      });
    }
    if (result.pushed) {
      lines.push({
        key: "pushed",
        icon: "utility:upload",
        text: this.t("backpromoteResultPushed", { branch: this.plan.backpromoteBranch.name }),
      });
    }
    return lines;
  }

  get hasDeployReport() {
    return this.hasRunResult && !!this.runResult.result.deployReport;
  }

  get hasOrgUrl() {
    return this.hasRunResult && !!this.runResult.result.orgUrl;
  }

  handleRunBackpromote(event, dirtyTree) {
    if (this.runDisabled) {
      return;
    }
    if (!dirtyTree && this.needsDirtyTreeChoice) {
      this.openDirtyTreeModal({ then: "run" });
      return;
    }
    window.sendMessageToVSCode({
      type: "runBackpromote",
      data: { selection: this.selection, revision: this.revision, dirtyTree: dirtyTree || null },
    });
  }

  handleOpenDeployReport() {
    if (this.hasDeployReport) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: this.runResult.result.deployReport },
      });
    }
  }

  handleOpenOrg() {
    if (this.hasOrgUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: { url: this.runResult.result.orgUrl },
      });
    }
  }

  handleBackToBranch() {
    window.sendMessageToVSCode({ type: "backToBranch" });
  }

  get noCommand() {
    return !this.command;
  }

  get showCommandBlock() {
    return this.showCommand && !!this.command;
  }

  get commandToggleLabel() {
    return this.showCommand ? this.t("backpromoteHideCommand") : this.t("backpromoteShowCommand");
  }

  handleToggleCommand() {
    this.showCommand = !this.showCommand;
  }

  handleCopyCommand() {
    if (this.command) {
      window.sendMessageToVSCode({ type: "copyToClipboard", data: { text: this.command } });
    }
  }

  // ---------------------------------------------------------------------------
  // Dirty working tree modal
  // ---------------------------------------------------------------------------

  openDirtyTreeModal(next) {
    this.dirtyTreeAction = "stash";
    this.dirtyTreeMessage = "WIP";
    this.dirtyTreeModal = next;
  }

  get showDirtyTreeModal() {
    return !!this.dirtyTreeModal;
  }

  get dirtyTreeTitle() {
    return this.plan
      ? this.t("backpromoteDirtyTreeTitle", {
          count: this.plan.checkout.dirtyFiles.length,
          branch: this.plan.checkout.currentBranch,
        })
      : "";
  }

  get dirtyTreeDescription() {
    return this.plan
      ? this.t("backpromoteDirtyTreeDesc", { branch: this.plan.backpromoteBranch.name })
      : "";
  }

  get dirtyTreeFiles() {
    return this.plan
      ? this.plan.checkout.dirtyFiles.slice(0, 12).map((file) => ({ key: file, name: file }))
      : [];
  }

  get dirtyTreeMoreFiles() {
    const count = this.plan ? this.plan.checkout.dirtyFiles.length - 12 : 0;
    return count > 0 ? this.t("backpromoteDirtyTreeMore", { count }) : null;
  }

  get dirtyTreeOptions() {
    return [
      { label: this.t("backpromoteDirtyTreeStash"), value: "stash" },
      { label: this.t("backpromoteDirtyTreeCommit"), value: "commit" },
    ];
  }

  get isDirtyTreeCommit() {
    return this.dirtyTreeAction === "commit";
  }

  get dirtyTreeConfirmDisabled() {
    return this.isDirtyTreeCommit && !String(this.dirtyTreeMessage || "").trim();
  }

  handleDirtyTreeActionChange(event) {
    this.dirtyTreeAction = event.detail.value;
  }

  handleDirtyTreeMessageChange(event) {
    this.dirtyTreeMessage = event.detail.value;
  }

  handleDirtyTreeCancel() {
    this.dirtyTreeModal = null;
  }

  handleDirtyTreeConfirm() {
    const next = this.dirtyTreeModal;
    if (!next) {
      return;
    }
    const choice = {
      action: this.dirtyTreeAction,
      message: this.isDirtyTreeCommit ? String(this.dirtyTreeMessage || "").trim() : null,
    };
    this.dirtyTreeModal = null;
    if (next.then === "merge") {
      this.requestMerge(next.itemKey, choice);
    } else {
      this.handleRunBackpromote(null, choice);
    }
  }

  // ---------------------------------------------------------------------------
  // Page actions
  // ---------------------------------------------------------------------------

  // Refresh, and Try again of the error states: the setup and the plan are loaded again
  handleRefresh() {
    if (this.pickersDisabled) {
      return;
    }
    this.loading = true;
    this.planError = null;
    this.runResult = null;
    this.runError = null;
    window.sendMessageToVSCode({ type: "refresh" });
  }

  handleOpenSetup() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "vscode-sfdx-hardis.showSetup" },
    });
  }

  handleOpenDoc() {
    window.sendMessageToVSCode({ type: "openExternal", data: { url: this.docUrl } });
  }

  // The git provider tokens can be set in the extension settings
  handleOpenSettings() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "workbench.action.openSettings", args: ["vsCodeSfdxHardis"] },
    });
  }

  handleOpenSourceControl() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "workbench.view.scm" },
    });
  }
}
