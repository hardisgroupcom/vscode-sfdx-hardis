import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getMetadataTypePillClass } from "s/pillUtils";
import {
  getActionTypeLabel,
  getActionTypePillClass,
  getActionWhenPillClass,
} from "s/deploymentActionUtils";

// Backpromote panel. The extension computes the plan (sf hardis:work:backpromote
// --plan --json), the counters and the command: this component only renders them
// and posts the selection back after every change.

const SUCCESS_PILL = "hardis-pill hardis-status-success";
const PENDING_PILL = "hardis-pill hardis-status-pending";
const INFO_PILL = "hardis-pill hardis-status-info";
const FAILED_PILL = "hardis-pill hardis-status-failed";
const UNKNOWN_PILL = "hardis-pill hardis-status-unknown";

const CHECK_TITLE_KEYS = {
  gitProvider: "backpromoteCheckGitProvider",
  targetOrg: "backpromoteCheckTargetOrg",
  parentBranch: "backpromoteCheckParentBranch",
  gitClean: "backpromoteCheckGitClean",
};

const CHECK_ICONS = {
  gitProvider: "utility:link",
  targetOrg: "utility:salesforce1",
  parentBranch: "utility:hierarchy",
  gitClean: "utility:file",
};

const ORG_STATE_VIEW = {
  changedInOrg: {
    labelKey: "backpromoteOrgStateChanged",
    pillClass: PENDING_PILL,
  },
  deletedLocally: {
    labelKey: "backpromoteOrgStateDeletedLocally",
    pillClass: FAILED_PILL,
  },
  newToOrg: { labelKey: "backpromoteOrgStateNew", pillClass: INFO_PILL },
  noOrgChange: {
    labelKey: "backpromoteOrgStateUnchanged",
    pillClass: UNKNOWN_PILL,
  },
  unknown: { labelKey: "unknownLabel", pillClass: UNKNOWN_PILL },
};

// Brand names, never translated
const GIT_PROVIDER_LABELS = {
  github: "GitHub",
  gitlab: "GitLab",
  azure: "Azure DevOps",
  bitbucket: "Bitbucket",
};

function nameOfKey(key) {
  const index = String(key).indexOf(":");
  return index > -1 ? key.slice(index + 1) : key;
}

export default class Backpromote extends SharedMixin(LightningElement) {
  loading = true;
  planError = null;
  plan = null;
  selection = null;
  summary = null;
  command = null;
  commandError = null;
  targetOrgLabel = "";
  conflictBlocksByKey = {};
  mergeResults = {};
  mergeErrors = {};
  preparingKeys = [];
  revision = 0;
  showCommand = false;
  // Set once a merge was written on a new backpromote branch
  backpromoteBranchNotice = null;
  showDoneGroups = false;
  openSections = {
    changed: true,
    deletions: false,
    actions: false,
    all: false,
  };

  // jscpd:ignore-start
  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the SharedMixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }
  // jscpd:ignore-end

  @api
  initialize(data) {
    const payload = data || {};
    this.loading = payload.loading === true;
    this.planError = payload.planError || null;
    if (payload.plan) {
      this.plan = payload.plan;
      this.applySelectionPayload(payload);
      this.targetOrgLabel = payload.targetOrgLabel || "";
      this.conflictBlocksByKey = payload.conflictBlocksByKey || {};
      this.mergeResults = payload.preparedMerges || {};
      this.mergeErrors = {};
      this.preparingKeys = [];
      this.backpromoteBranchNotice = null;
      if (typeof payload.revision === "number") {
        this.revision = Math.max(this.revision, payload.revision);
      }
    }
  }

  @api
  handleMessage(type, data) {
    switch (type) {
      case "selectionSummary":
        // Ignore the answer to a selection the user already changed again
        if (data && data.revision === this.revision) {
          this.applySelectionPayload(data);
        }
        break;
      case "mergePrepared":
        this.handleMergePrepared(data || {});
        break;
      case "mergePrepareFailed":
        this.handleMergePrepareFailed(data || {});
        break;
      case "mergeMarkers":
        if (data && typeof data.key === "string") {
          this.conflictBlocksByKey = {
            ...this.conflictBlocksByKey,
            [data.key]: data.conflictBlocks,
          };
        }
        break;
      default:
        break;
    }
  }

  applySelectionPayload(payload) {
    if (payload.selection) {
      this.selection = payload.selection;
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

  pullRequestChips(entry) {
    return (entry.pullRequestIds || []).map((id) => ({
      key: `${entry.key}-${id}`,
      label: `#${id}`,
    }));
  }

  alsoChangedLabel(item) {
    if (item.excluded || !item.alsoInUnselected || item.alsoInUnselected.length === 0) {
      return null;
    }
    const names = item.alsoInUnselected
      .map((group) =>
        group.pullRequestIds.length > 0
          ? group.pullRequestIds.map((id) => `#${id}`).join(", ")
          : group.shortHash,
      )
      .join(", ");
    return this.t("backpromoteAlsoChangedBy", { pullRequests: names });
  }

  findSummaryItem(key) {
    return this.summary
      ? this.summary.items.find((item) => item.key === key)
      : null;
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  get isLoadingState() {
    return this.loading;
  }

  get hasPlanError() {
    return !this.loading && !!this.planError;
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
    return !this.loading && !this.planError && !!this.plan;
  }

  get isUpToDate() {
    return this.isReady && this.plan.status === "upToDate";
  }

  get showSplit() {
    return (
      this.isReady &&
      this.plan.status !== "upToDate" &&
      this.plan.groups.length > 0 &&
      !!this.summary
    );
  }

  get isReadOnly() {
    return !this.plan || this.plan.status !== "ready";
  }

  // ---------------------------------------------------------------------------
  // Header and checks
  // ---------------------------------------------------------------------------

  get passedChecks() {
    if (!this.isReady) {
      return [];
    }
    return this.plan.checks
      // The currentBranch check says where the run works: shown under the parent branch
      .filter((check) => check.ok && check.id !== "currentBranch")
      .map((check) => ({
        id: check.id,
        label:
          check.id === "targetOrg" && this.targetOrgLabel
            ? this.targetOrgLabel
            : check.message,
        title: check.message,
      }));
  }

  get hasPassedChecks() {
    return this.passedChecks.length > 0;
  }

  get failedChecks() {
    if (!this.isReady) {
      return [];
    }
    return this.plan.checks
      .filter((check) => !check.ok)
      .map((check) => {
        const details = (check.details || []).map((value, index) => ({
          key: `${check.id}-${index}`,
          value,
        }));
        return {
          id: check.id,
          title: this.t(CHECK_TITLE_KEYS[check.id] || "backpromoteCheckOther"),
          message: check.message,
          iconName: CHECK_ICONS[check.id] || "utility:warning",
          details,
          hasDetails: details.length > 0,
          isGitProvider: check.id === "gitProvider",
          isTargetOrg: check.id === "targetOrg",
          isGitClean: check.id === "gitClean",
          hint: this.checkHint(check.id),
        };
      });
  }

  get hasFailedChecks() {
    return this.failedChecks.length > 0;
  }

  checkHint(checkId) {
    if (checkId === "gitProvider") {
      return this.t("backpromoteGitProviderHint");
    }
    if (checkId === "parentBranch") {
      return this.t("backpromoteParentBranchHint");
    }
    return null;
  }

  get connectGitProviderLabel() {
    const name =
      this.plan && this.plan.gitProvider ? this.plan.gitProvider.name : null;
    return GIT_PROVIDER_LABELS[name]
      ? this.t("backpromoteConnectGitProvider", {
          provider: GIT_PROVIDER_LABELS[name],
        })
      : this.t("backpromoteConnectGitProviderGeneric");
  }

  get stateStorageDesc() {
    return this.plan && this.plan.stateStorage === "pullRequestComments"
      ? this.t("backpromoteStateStorageDesc")
      : null;
  }

  get stateReadErrorsWarning() {
    if (!this.isReady || !(this.plan.stateReadErrors || []).length) {
      return null;
    }
    return this.t("backpromoteStateReadErrors", {
      pullRequests: this.plan.stateReadErrors.join(", "),
    });
  }

  get conflictDetectionWarning() {
    if (!this.isReady || !this.plan.conflictDetection) {
      return null;
    }
    if (this.plan.conflictDetection.success !== false) {
      return null;
    }
    return this.t("backpromoteConflictDetectionFailed", {
      message: this.plan.conflictDetection.errorMessage || "",
    });
  }

  get reportFiles() {
    if (!this.isReady) {
      return [];
    }
    return (this.plan.reports || []).map((filePath) => ({
      key: filePath,
      filePath,
      label: String(filePath).split(/[\\/]/).pop(),
    }));
  }

  get hasReportFiles() {
    return this.reportFiles.length > 0;
  }

  get upToDateDescription() {
    return this.plan
      ? this.t("backpromoteUpToDateDesc", {
          parentBranch: this.plan.parentBranch,
        })
      : "";
  }

  // ---------------------------------------------------------------------------
  // Rail: groups of the parent branch
  // ---------------------------------------------------------------------------

  get decoratedGroups() {
    if (!this.plan) {
      return [];
    }
    const selected = new Set(this.selection ? this.selection.groups : []);
    const orgStateByKey = new Map(
      this.plan.items.map((item) => [item.key, item.orgState]),
    );
    return this.plan.groups.map((group) => {
      const isSelected = selected.has(group.hash);
      const changedCount = group.items.filter(
        (key) => orgStateByKey.get(key) === "changedInOrg",
      ).length;
      const author =
        group.pullRequests.length > 0 && group.pullRequests[0].author
          ? group.pullRequests[0].author
          : group.author;
      return {
        hash: group.hash,
        isDone: group.status === "done",
        rowClass:
          "hardis-option-row bp-group-row" + (isSelected ? " selected" : ""),
        ariaChecked: isSelected ? "true" : "false",
        hasPullRequests: group.pullRequests.length > 0,
        pullRequests: group.pullRequests.map((pr) => ({
          key: `${group.hash}-${pr.id}`,
          label: `#${pr.id} ${pr.title}`,
        })),
        message: group.message,
        shortHash: group.shortHash,
        meta: [
          author,
          this.formatDate(group.date),
          this.countLabel(
            group.items.length,
            "backpromoteItemCountOne",
            "backpromoteItemCount",
          ),
        ]
          .filter((part) => !!part)
          .join(" · "),
        deletionsLabel:
          group.deletions.length > 0
            ? this.countLabel(
                group.deletions.length,
                "backpromoteDeletionCountOne",
                "backpromoteDeletionCount",
              )
            : null,
        actionsLabel:
          group.actionIds.length > 0
            ? this.countLabel(
                group.actionIds.length,
                "backpromoteActionCountOne",
                "backpromoteActionCount",
              )
            : null,
        changedLabel:
          changedCount > 0
            ? this.countLabel(
                changedCount,
                "backpromoteChangedInOrgCountOne",
                "backpromoteChangedInOrgCount",
              )
            : null,
        isUntrackable: group.trackable === false,
        doneLabel:
          group.backpromotedToThisOrg && group.backpromotedToThisOrg.date
            ? this.t("backpromoteDoneGroupOn", {
                date: this.formatDate(group.backpromotedToThisOrg.date),
              })
            : this.t("backpromoteAlreadyInOrgLabel"),
        otherOrgsLabel: this.otherOrgsLabel(group),
        otherOrgsTitle: (group.backpromotedToOtherOrgs || [])
          .map((record) =>
            record.date
              ? `${record.orgName} (${this.formatDate(record.date)})`
              : record.orgName,
          )
          .join(", "),
      };
    });
  }

  otherOrgsLabel(group) {
    const count = (group.backpromotedToOtherOrgs || []).length;
    return count > 0
      ? this.countLabel(count, "backpromoteOtherOrgsOne", "backpromoteOtherOrgs")
      : null;
  }

  get railGroups() {
    return this.decoratedGroups.filter((group) => !group.isDone);
  }

  get doneGroups() {
    return this.decoratedGroups.filter((group) => group.isDone);
  }

  get hasDoneGroups() {
    return this.doneGroups.length > 0;
  }

  get doneGroupsToggleLabel() {
    return this.showDoneGroups
      ? this.t("backpromoteHideAlreadyInOrg")
      : this.t("backpromoteShowAlreadyInOrg", {
          count: this.doneGroups.length,
        });
  }

  get parentBranchOptions() {
    if (!this.plan) {
      return [];
    }
    return (this.plan.parentBranchChoices || []).map((branch) => ({
      label: branch,
      value: branch,
    }));
  }

  get hasParentBranchChoices() {
    return this.parentBranchOptions.length > 0;
  }

  // Where the run works, as the CLI says it: the current branch, or a new local
  // backpromote branch created from the parent branch
  get workingBranchText() {
    if (!this.plan) {
      return "";
    }
    const check = (this.plan.checks || []).find(
      (item) => item.id === "currentBranch" && item.ok,
    );
    return check ? check.message : "";
  }

  get hasWorkingBranchText() {
    return !!this.workingBranchText;
  }

  handleToggleGroup(event) {
    const hash = event.currentTarget.dataset.hash;
    if (this.isReadOnly || !hash || !this.selection) {
      return;
    }
    const groups = new Set(this.selection.groups);
    if (groups.has(hash)) {
      groups.delete(hash);
    } else {
      groups.add(hash);
    }
    this.updateSelection({
      groups: this.plan.groups
        .map((group) => group.hash)
        .filter((groupHash) => groups.has(groupHash)),
    });
  }

  handleSelectPending() {
    if (this.isReadOnly) {
      return;
    }
    this.updateSelection({
      groups: this.plan.groups
        .filter((group) => group.selectedByDefault)
        .map((group) => group.hash),
    });
  }

  handleClearGroups() {
    if (this.isReadOnly) {
      return;
    }
    this.updateSelection({ groups: [] });
  }

  handleToggleDoneGroups() {
    this.showDoneGroups = !this.showDoneGroups;
  }

  handleParentBranchChange(event) {
    const parentBranch = event.detail.value;
    if (!parentBranch || !this.plan || parentBranch === this.plan.parentBranch) {
      return;
    }
    this.loading = true;
    this.planError = null;
    window.sendMessageToVSCode({
      type: "changeParentBranch",
      data: { parentBranch },
    });
  }

  // ---------------------------------------------------------------------------
  // Counters and sections
  // ---------------------------------------------------------------------------

  get counterItemsToDeploy() {
    return this.summary ? this.summary.itemsToDeployCount : 0;
  }

  get counterChangedInOrg() {
    return this.summary ? this.summary.changedInOrg.length : 0;
  }

  get counterDeletions() {
    return this.summary ? this.summary.deletionsToDeleteCount : 0;
  }

  get counterActions() {
    return this.summary ? this.summary.actionsToRunCount : 0;
  }

  get changedCounterClass() {
    return (
      "hardis-status-card" + (this.counterChangedInOrg > 0 ? " warning" : "")
    );
  }

  get deletionsCounterClass() {
    return "hardis-status-card" + (this.counterDeletions > 0 ? " error" : "");
  }

  get alsoInUnselectedWarning() {
    if (!this.summary || this.summary.alsoInUnselectedCount === 0) {
      return null;
    }
    return this.t("backpromoteAlsoInUnselectedWarning", {
      count: this.summary.alsoInUnselectedCount,
    });
  }

  handleToggleSection(event) {
    const section = event.currentTarget.dataset.section;
    this.openSections = {
      ...this.openSections,
      [section]: !this.openSections[section],
    };
  }

  chevron(open) {
    return open ? "utility:chevrondown" : "utility:chevronright";
  }

  get isChangedOpen() {
    return this.openSections.changed;
  }

  get isDeletionsOpen() {
    return this.openSections.deletions;
  }

  get isActionsOpen() {
    return this.openSections.actions;
  }

  get isAllOpen() {
    return this.openSections.all;
  }

  get changedChevron() {
    return this.chevron(this.openSections.changed);
  }

  get deletionsChevron() {
    return this.chevron(this.openSections.deletions);
  }

  get actionsChevron() {
    return this.chevron(this.openSections.actions);
  }

  get allChevron() {
    return this.chevron(this.openSections.all);
  }

  // --- Changed in your org -----------------------------------------------------

  get changedSectionSummary() {
    const count = this.counterChangedInOrg;
    return count === 0
      ? this.t("backpromoteChangedInOrgNone")
      : this.countLabel(
          count,
          "backpromoteChangedInOrgSummaryOne",
          "backpromoteChangedInOrgSummary",
        );
  }

  get hasChangedRows() {
    return this.counterChangedInOrg > 0;
  }

  get changedRows() {
    if (!this.summary) {
      return [];
    }
    return this.summary.changedInOrg.map((item) => {
      let choice = "deploy";
      if (item.excluded) {
        choice = "keep";
      } else if (item.merged) {
        choice = "merge";
      }
      const isPreparing = this.preparingKeys.includes(item.key);
      const mergeResult = this.mergeResults[item.key];
      const blocks = item.conflictBlocks;
      let conflictLabel = this.t("backpromoteConflictsNotChecked");
      if (blocks === 0) {
        conflictLabel = this.t("backpromoteNoConflictLeft");
      } else if (typeof blocks === "number") {
        conflictLabel = this.countLabel(
          blocks,
          "backpromoteConflictBlocksLeftOne",
          "backpromoteConflictBlocksLeft",
        );
      }
      return {
        key: item.key,
        typeLabel: item.type,
        typePillClass: getMetadataTypePillClass(item.type),
        name: item.name,
        pullRequests: this.pullRequestChips(item),
        alsoLabel: this.alsoChangedLabel(item),
        canCompare:
          item.orgState === "changedInOrg" && !!item.orgPath && !!item.localPath,
        canOpenOrgVersion: item.orgState === "deletedLocally" && !!item.orgPath,
        canMerge: item.mergeable && item.orgState === "changedInOrg",
        deployButtonClass: choice === "deploy" ? "hardis-btn-tinted-blue" : "",
        keepButtonClass: choice === "keep" ? "hardis-btn-tinted-amber" : "",
        mergeButtonClass: choice === "merge" ? "hardis-btn-tinted-blue" : "",
        isMerge: choice === "merge",
        isPreparing: choice === "merge" && isPreparing,
        hasMergeResult: choice === "merge" && !isPreparing && !!mergeResult,
        hasPromptFile: !!(mergeResult && mergeResult.promptFile),
        conflictLabel,
        conflictPillClass: blocks === 0 ? SUCCESS_PILL : PENDING_PILL,
        showModifiedLocally: choice !== "merge" && !!mergeResult,
        mergeError: this.mergeErrors[item.key] || null,
      };
    });
  }

  handleItemChoice(event) {
    const { key, choice } = event.currentTarget.dataset;
    if (this.isReadOnly || !key || !this.selection) {
      return;
    }
    const excludedItems = this.selection.excludedItems.filter(
      (entry) => entry !== key,
    );
    const mergedItems = this.selection.mergedItems.filter(
      (entry) => entry !== key,
    );
    if (choice === "keep") {
      excludedItems.push(key);
    } else if (choice === "merge") {
      mergedItems.push(key);
    }
    const mergeErrors = { ...this.mergeErrors };
    delete mergeErrors[key];
    this.mergeErrors = mergeErrors;
    this.updateSelection({ excludedItems, mergedItems });
    if (
      choice === "merge" &&
      !this.mergeResults[key] &&
      !this.preparingKeys.includes(key)
    ) {
      this.preparingKeys = [...this.preparingKeys, key];
      window.sendMessageToVSCode({
        type: "prepareMerge",
        data: {
          keys: [key],
          selection: this.selection,
          revision: this.revision,
        },
      });
    }
  }

  handleMergePrepared(data) {
    const requestedKeys = data.requestedKeys || [];
    const result = data.result || {};
    if (result.backpromoteBranch) {
      this.backpromoteBranchNotice = this.t(
        "backpromoteMergeOnBackpromoteBranch",
        {
          branch: result.backpromoteBranch,
          returnBranch: result.returnBranch || "",
        },
      );
    }
    const files = result.files || [];
    const mergedKeys = files.map((file) => file.key);
    this.preparingKeys = this.preparingKeys.filter(
      (key) => !requestedKeys.includes(key) && !mergedKeys.includes(key),
    );
    const mergeResults = { ...this.mergeResults };
    for (const file of files) {
      mergeResults[file.key] = {
        prompt: result.prompt,
        promptFile: result.promptFile,
        nextCommand: result.nextCommand,
        localPath: file.localPath,
      };
    }
    this.mergeResults = mergeResults;
    if (data.conflictBlocksByKey) {
      this.conflictBlocksByKey = { ...data.conflictBlocksByKey };
    }
    // An item sfdx-hardis did not merge goes back to "Deploy"
    const notMerged = requestedKeys.filter((key) => !mergedKeys.includes(key));
    if (notMerged.length > 0) {
      this.markMergeFailed(notMerged, this.t("backpromoteMergeFailed"));
    }
  }

  handleMergePrepareFailed(data) {
    const keys = data.keys || [];
    const message =
      data.cliTooOld === true
        ? this.t("backpromoteCliTooOldDesc")
        : data.message || this.t("backpromoteMergeFailed");
    this.preparingKeys = this.preparingKeys.filter(
      (key) => !keys.includes(key),
    );
    this.markMergeFailed(keys, message);
  }

  markMergeFailed(keys, message) {
    const mergeErrors = { ...this.mergeErrors };
    for (const key of keys) {
      mergeErrors[key] = message;
    }
    this.mergeErrors = mergeErrors;
    if (this.selection) {
      this.updateSelection({
        mergedItems: this.selection.mergedItems.filter(
          (key) => !keys.includes(key),
        ),
      });
    }
  }

  handleCompare(event) {
    const item = this.findSummaryItem(event.currentTarget.dataset.key);
    if (!item) {
      return;
    }
    window.sendMessageToVSCode({
      type: "openVscodeDiff",
      data: {
        leftPath: item.orgPath,
        rightPath: item.localPath,
        title: this.t("backpromoteCompareTitle", { name: item.name }),
      },
    });
  }

  handleOpenOrgVersion(event) {
    const item = this.findSummaryItem(event.currentTarget.dataset.key);
    if (item && item.orgPath) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: item.orgPath },
      });
    }
  }

  handleOpenMergedFile(event) {
    const key = event.currentTarget.dataset.key;
    const mergeResult = this.mergeResults[key];
    const item = this.findSummaryItem(key);
    const filePath =
      (mergeResult && mergeResult.localPath) || (item && item.localPath);
    if (filePath) {
      window.sendMessageToVSCode({ type: "openFile", data: { filePath } });
    }
  }

  handleCopyPrompt(event) {
    const mergeResult = this.mergeResults[event.currentTarget.dataset.key];
    if (mergeResult && mergeResult.prompt) {
      window.sendMessageToVSCode({
        type: "copyToClipboard",
        data: { text: mergeResult.prompt, allowLarge: true },
      });
    }
  }

  handleOpenPromptFile(event) {
    const mergeResult = this.mergeResults[event.currentTarget.dataset.key];
    if (mergeResult && mergeResult.promptFile) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: mergeResult.promptFile },
      });
    }
  }

  handleOpenReport(event) {
    const filePath = event.currentTarget.dataset.path;
    if (filePath) {
      window.sendMessageToVSCode({ type: "openFile", data: { filePath } });
    }
  }

  // --- Deletions -----------------------------------------------------------------

  get hasDeletionRows() {
    return !!this.summary && this.summary.deletions.length > 0;
  }

  get deletionsSectionSummary() {
    if (!this.hasDeletionRows) {
      return this.t("backpromoteDeletionsNone");
    }
    return this.t("backpromoteDeletionsSummary", {
      selected: this.summary.deletionsToDeleteCount,
      total: this.summary.deletions.length,
    });
  }

  get deletionRows() {
    if (!this.summary) {
      return [];
    }
    return this.summary.deletions.map((deletion) => ({
      key: deletion.key,
      typeLabel: deletion.type,
      typePillClass: getMetadataTypePillClass(deletion.type),
      name: deletion.name,
      pullRequests: this.pullRequestChips(deletion),
      rowClass: "hardis-option-row" + (deletion.excluded ? "" : " selected"),
      ariaChecked: deletion.excluded ? "false" : "true",
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

  get hasActionRows() {
    return !!this.summary && this.summary.actions.length > 0;
  }

  get actionsSectionSummary() {
    if (!this.hasActionRows) {
      return this.t("backpromoteActionsNone");
    }
    const parts = [
      this.t("backpromoteActionsToRun", {
        count: this.summary.actionsToRunCount,
      }),
    ];
    if (this.summary.actionsAlreadyDoneCount > 0) {
      parts.push(
        this.t("backpromoteActionsAlreadyDone", {
          count: this.summary.actionsAlreadyDoneCount,
        }),
      );
    }
    if (this.summary.manualActionsCount > 0) {
      parts.push(
        this.t("backpromoteActionsManual", {
          count: this.summary.manualActionsCount,
        }),
      );
    }
    return parts.join(" · ");
  }

  get actionRows() {
    if (!this.summary) {
      return [];
    }
    const translate = (key) => this.t(key);
    return this.summary.actions.map((action) => ({
      id: action.id,
      label: action.label,
      rowClass:
        "hardis-option-row bp-action-row" + (action.selected ? " selected" : ""),
      ariaChecked: action.selected ? "true" : "false",
      whenLabel: this.t(
        action.when === "pre"
          ? "backpromoteActionBefore"
          : "backpromoteActionAfter",
      ),
      whenPillClass: getActionWhenPillClass(
        action.when === "pre" ? "pre-deploy" : "post-deploy",
      ),
      typeLabel: getActionTypeLabel(action.type, translate),
      typePillClass: getActionTypePillClass(action.type),
      pullRequestLabel: action.pullRequestId ? `#${action.pullRequestId}` : null,
      runsAsLabel: action.customUsername
        ? this.t("backpromoteRunsAs", { username: action.customUsername })
        : this.t("backpromoteRunsAsYou"),
      isManual: action.type === "manual" || !!action.customUsername,
      doneLabel: action.alreadyDone
        ? this.t("backpromoteActionDoneOn", {
            date: this.formatDate(action.alreadyDone.date),
          })
        : null,
    }));
  }

  handleToggleAction(event) {
    const id = event.currentTarget.dataset.id;
    if (this.isReadOnly || !id || !this.selection) {
      return;
    }
    const actions = new Set(this.selection.actions);
    if (actions.has(id)) {
      actions.delete(id);
    } else {
      actions.add(id);
    }
    this.updateSelection({
      actions: this.plan.actions
        .map((action) => action.id)
        .filter((actionId) => actions.has(actionId)),
    });
  }

  // --- All metadata ------------------------------------------------------------

  get allMetadataSummary() {
    if (!this.summary) {
      return "";
    }
    return this.t("backpromoteAllMetadataSummary", {
      selected: this.summary.itemsToDeployCount,
      total: this.summary.items.length,
    });
  }

  get hasMetadataRows() {
    return !!this.summary && this.summary.items.length > 0;
  }

  get metadataColumns() {
    return [
      {
        label: this.t("typeLabel"),
        fieldName: "type",
        type: "typePill",
        initialWidth: 200,
        typeAttributes: {
          label: { fieldName: "type" },
          pillClass: { fieldName: "typePillClass" },
        },
      },
      { label: this.t("nameColumn"), fieldName: "name", type: "text" },
      {
        label: this.t("pullRequests"),
        fieldName: "pullRequestsLabel",
        type: "text",
        initialWidth: 130,
      },
      {
        label: this.t("backpromoteInYourOrgColumn"),
        fieldName: "orgStateLabel",
        type: "statusPill",
        initialWidth: 190,
        typeAttributes: {
          label: { fieldName: "orgStateLabel" },
          pillClass: { fieldName: "orgStatePillClass" },
        },
      },
      {
        label: this.t("backpromoteNoteColumn"),
        fieldName: "noteLabel",
        type: "statusPill",
        typeAttributes: {
          label: { fieldName: "noteLabel" },
          pillClass: { fieldName: "notePillClass" },
        },
      },
    ];
  }

  get metadataRows() {
    if (!this.summary) {
      return [];
    }
    return this.summary.items.map((item) => {
      const orgState = ORG_STATE_VIEW[item.orgState] || ORG_STATE_VIEW.unknown;
      let noteLabel = null;
      let notePillClass = UNKNOWN_PILL;
      const alsoLabel = this.alsoChangedLabel(item);
      if (item.excluded) {
        noteLabel = this.t("backpromoteKeptAsInOrg");
      } else if (alsoLabel) {
        noteLabel = alsoLabel;
        notePillClass = PENDING_PILL;
      } else if (item.merged) {
        noteLabel = this.t("backpromoteMergedVersion");
        notePillClass = INFO_PILL;
      }
      return {
        key: item.key,
        type: item.type,
        typePillClass: getMetadataTypePillClass(item.type),
        name: item.name,
        pullRequestsLabel: item.pullRequestIds.map((id) => `#${id}`).join(", "),
        orgStateLabel: this.t(orgState.labelKey),
        orgStatePillClass: orgState.pillClass,
        noteLabel,
        notePillClass,
      };
    });
  }

  get selectedMetadataKeys() {
    if (!this.summary) {
      return [];
    }
    return this.summary.items
      .filter((item) => !item.excluded)
      .map((item) => item.key);
  }

  handleMetadataSelection(event) {
    if (this.isReadOnly || !this.summary || !this.selection) {
      return;
    }
    const ticked = new Set(
      (event.detail.selectedRows || []).map((row) => row.key),
    );
    const selectionKeys = this.summary.items.map((item) => item.key);
    const nowExcluded = selectionKeys.filter((key) => !ticked.has(key));
    const excludedItems = [
      ...this.selection.excludedItems.filter(
        (key) => !selectionKeys.includes(key),
      ),
      ...nowExcluded,
    ];
    const current = new Set(this.selection.excludedItems);
    if (
      excludedItems.length === current.size &&
      excludedItems.every((key) => current.has(key))
    ) {
      return;
    }
    this.updateSelection({
      excludedItems,
      mergedItems: this.selection.mergedItems.filter(
        (key) => !nowExcluded.includes(key),
      ),
    });
  }

  // ---------------------------------------------------------------------------
  // Deploy bar
  // ---------------------------------------------------------------------------

  get rangeLabel() {
    if (!this.summary || !this.summary.range) {
      return this.t("backpromoteNoGroupSelected");
    }
    const pullRequests = this.summary.pullRequestIds
      .map((id) => `#${id}`)
      .join(", ");
    const range =
      this.summary.range.oldest === this.summary.range.newest
        ? this.summary.range.newest
        : `${this.summary.range.oldest} → ${this.summary.range.newest}`;
    return pullRequests
      ? this.t("backpromoteRangeWithPullRequests", { range, pullRequests })
      : this.t("backpromoteRange", { range });
  }

  get testsLabel() {
    if (!this.summary || this.summary.testClasses.length === 0) {
      return this.t("backpromoteNoTestClass");
    }
    return this.t("backpromoteTestClasses", {
      classes: this.summary.testClasses.join(", "),
    });
  }

  get runLabel() {
    const count = this.counterItemsToDeploy;
    if (count === 0) {
      return this.t("backpromoteRunButtonNoItem");
    }
    return this.countLabel(
      count,
      "backpromoteRunButtonOne",
      "backpromoteRunButton",
    );
  }

  get againLabel() {
    const count = this.summary ? this.summary.alreadyInOrgSelectedCount : 0;
    return count > 0
      ? this.countLabel(count, "backpromoteAgainCountOne", "backpromoteAgainCount")
      : null;
  }

  get runDisabled() {
    return this.isReadOnly || !this.summary || !this.summary.canRun;
  }

  get blockerLabel() {
    if (!this.summary || this.summary.blockers.length === 0) {
      return null;
    }
    switch (this.summary.blockers[0]) {
      case "notReady":
        return this.t("backpromoteBlockerNotReady");
      case "noGroup":
        return this.t("backpromoteBlockerNoGroup");
      case "nothingToDo":
        return this.t("backpromoteBlockerNothingToDo");
      case "conflictMarkers":
        return this.t("backpromoteBlockerConflicts", {
          names: this.summary.conflictKeys.map(nameOfKey).join(", "),
        });
      case "invalidCommand":
        return this.t("backpromoteBlockerInvalidCommand", {
          message: this.commandError || "",
        });
      default:
        return null;
    }
  }

  get hasCommand() {
    return !!this.command;
  }

  get noCommand() {
    return !this.command;
  }

  get showCommandBlock() {
    return this.showCommand && !!this.command;
  }

  get commandToggleLabel() {
    return this.showCommand
      ? this.t("backpromoteHideCommand")
      : this.t("backpromoteShowCommand");
  }

  handleToggleCommand() {
    this.showCommand = !this.showCommand;
  }

  handleCopyCommand() {
    if (this.command) {
      window.sendMessageToVSCode({
        type: "copyToClipboard",
        data: { text: this.command },
      });
    }
  }

  handleRunBackpromote() {
    if (this.runDisabled) {
      return;
    }
    window.sendMessageToVSCode({
      type: "runBackpromote",
      data: { selection: this.selection, revision: this.revision },
    });
  }

  // ---------------------------------------------------------------------------
  // Page actions
  // ---------------------------------------------------------------------------

  handleRefresh() {
    this.loading = true;
    this.planError = null;
    window.sendMessageToVSCode({ type: "refresh" });
  }

  handleRetry() {
    this.loading = true;
    this.planError = null;
    window.sendMessageToVSCode({ type: "retryInit" });
  }

  handleRunInTerminal() {
    window.sendMessageToVSCode({ type: "runInTerminal" });
  }

  handleOpenSetup() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "vscode-sfdx-hardis.showSetup" },
    });
  }

  handleSelectOrg() {
    window.sendMessageToVSCode({ type: "selectOrg" });
  }

  handleConnectGitProvider() {
    window.sendMessageToVSCode({ type: "connectGitProvider" });
  }

  handleOpenSourceControl() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "workbench.view.scm" },
    });
  }
}
