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

const PENDING_PILL = "hardis-pill hardis-status-pending";
const SUCCESS_PILL = "hardis-pill hardis-status-success";
const INFO_PILL = "hardis-pill hardis-status-info";
const UNKNOWN_PILL = "hardis-pill hardis-status-unknown";

const CHECK_TITLE_KEYS = {
  currentBranch: "backpromoteCheckCurrentBranch",
  targetOrg: "backpromoteCheckTargetOrg",
  parentBranch: "backpromoteCheckParentBranch",
  gitClean: "backpromoteCheckGitClean",
};

const CHECK_ICONS = {
  currentBranch: "utility:branch_merge",
  targetOrg: "utility:salesforce1",
  parentBranch: "utility:hierarchy",
  gitClean: "utility:file",
};

function fileName(filePath) {
  return String(filePath).split("/").pop();
}

export default class Backpromote extends SharedMixin(LightningElement) {
  loading = true;
  planError = null;
  // What the panel offers before a plan: the authenticated orgs and the major branches
  setup = null;
  // The org and the parent branch picked, null for the default org and the guessed branch
  targetOrg = null;
  parentBranch = null;
  plan = null;
  selection = null;
  summary = null;
  command = null;
  commandError = null;
  targetOrgLabel = "";
  workspaceRoot = "";
  revision = 0;
  showCommand = false;
  // Steps sfdx-hardis reported while computing the plan
  planProgress = null;
  // A run was started: the plan on screen describes the branch and the org as they were before it
  runStarted = false;
  openSections = {
    conflicts: true,
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
    if (this.loading) {
      this.planProgress = null;
    }
    this.planError = payload.planError || null;
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
      this.summary = null;
      this.command = null;
    }
    if (payload.plan) {
      this.plan = payload.plan;
      this.parentBranch = payload.plan.parentBranch;
      this.applySelectionPayload(payload);
      this.targetOrgLabel = payload.targetOrgLabel || "";
      this.workspaceRoot = payload.workspaceRoot || "";
      this.runStarted = false;
      if (typeof payload.revision === "number") {
        this.revision = Math.max(this.revision, payload.revision);
      }
    }
  }

  @api
  handleMessage(type, data) {
    switch (type) {
      case "planProgress":
        this.planProgress = this.loading ? data || null : null;
        break;
      case "selectionSummary":
        // Ignore the answer to a selection the user already changed again
        if (data && data.revision === this.revision) {
          this.applySelectionPayload(data);
        }
        break;
      case "runStarted":
        this.runStarted = true;
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

  // Nothing computed yet: the org and the parent branch are chosen first
  get isSetupState() {
    return !this.loading && !this.planError && !this.plan && !!this.setup;
  }

  get setupDescription() {
    return this.t("backpromoteSetupDesc", {
      branch: this.setup ? this.setup.currentBranch : "",
    });
  }

  // The orgs to pick from: the default org (whatever it is) first, then the ones listed
  get targetOrgOptions() {
    const orgs = this.setup ? this.setup.orgs : [];
    const options = orgs.map((org) => ({ label: org.label, value: org.username }));
    if (!orgs.some((org) => org.isDefault)) {
      options.unshift({ label: this.t("backpromoteDefaultOrg"), value: "" });
    }
    return options;
  }

  get targetOrgValue() {
    return this.targetOrg || "";
  }

  // The parent branches to pick from: the major branches, and the guess of sfdx-hardis
  // when the project declares none
  get parentBranchOptions() {
    const choices = new Set([
      ...(this.setup ? this.setup.parentBranchChoices : []),
      ...(this.plan ? this.plan.parentBranchChoices : []),
    ]);
    const options = [...choices].map((branch) => ({ label: branch, value: branch }));
    if (options.length === 0) {
      options.push({ label: this.t("backpromoteParentBranchGuessed"), value: "" });
    }
    return options;
  }

  get parentBranchValue() {
    return this.parentBranch || "";
  }

  handleSetupTargetOrgChange(event) {
    this.targetOrg = event.detail.value || null;
  }

  handleSetupParentBranchChange(event) {
    this.parentBranch = event.detail.value || null;
  }

  handleComputePlan() {
    this.loading = true;
    this.planError = null;
    window.sendMessageToVSCode({
      type: "computePlan",
      data: { targetOrg: this.targetOrg, parentBranch: this.parentBranch },
    });
  }

  handleTargetOrgChange(event) {
    const targetOrg = event.detail.value || null;
    if (targetOrg === this.targetOrg) {
      return;
    }
    this.targetOrg = targetOrg;
    this.loading = true;
    this.planError = null;
    window.sendMessageToVSCode({
      type: "changeTargetOrg",
      data: { targetOrg, parentBranch: this.parentBranch },
    });
  }

  get isUpToDate() {
    return this.isReady && this.plan.status === "upToDate";
  }

  get isMergeInProgress() {
    return this.isReady && this.plan.status === "mergeInProgress";
  }

  get showMain() {
    return this.isReady && this.plan.status === "ready" && !!this.summary;
  }

  get isReadOnly() {
    return !this.plan || this.plan.status !== "ready" || this.runStarted;
  }

  // ---------------------------------------------------------------------------
  // Header and checks
  // ---------------------------------------------------------------------------

  get passedChecks() {
    if (!this.isReady) {
      return [];
    }
    return this.plan.checks
      .filter((check) => check.ok)
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
          isTargetOrg: check.id === "targetOrg",
          isGitClean: check.id === "gitClean",
          hint:
            check.id === "parentBranch"
              ? this.t("backpromoteParentBranchHint")
              : null,
        };
      });
  }

  get hasFailedChecks() {
    return this.failedChecks.length > 0;
  }

  handleParentBranchChange(event) {
    const parentBranch = event.detail.value || null;
    if (parentBranch === this.parentBranch) {
      return;
    }
    this.parentBranch = parentBranch;
    this.loading = true;
    this.planError = null;
    window.sendMessageToVSCode({
      type: "changeParentBranch",
      data: { targetOrg: this.targetOrg, parentBranch },
    });
  }

  get upToDateDescription() {
    return this.plan
      ? this.t("backpromoteUpToDateDesc", {
          parentBranch: this.plan.parentBranch,
        })
      : "";
  }

  // ---------------------------------------------------------------------------
  // Merge in progress: a previous run stopped on conflicts
  // ---------------------------------------------------------------------------

  get mergeInProgressFiles() {
    if (!this.isMergeInProgress) {
      return [];
    }
    return this.plan.conflicts.map((conflict) => {
      const blocks = conflict.conflictBlocks;
      const solved = blocks === 0;
      return {
        path: conflict.path,
        name: fileName(conflict.path),
        pillClass: solved ? SUCCESS_PILL : PENDING_PILL,
        label: solved
          ? this.t("backpromoteNoConflictLeft")
          : this.countLabel(
              blocks || 0,
              "backpromoteConflictBlocksLeftOne",
              "backpromoteConflictBlocksLeft",
            ),
      };
    });
  }

  get mergeInProgressDescription() {
    return this.plan
      ? this.t("backpromoteMergeInProgressDesc", {
          parentBranch: this.plan.parentBranch,
        })
      : "";
  }

  get continueDisabled() {
    return !this.summary || !this.summary.canRun || this.runStarted;
  }

  // ---------------------------------------------------------------------------
  // Pull Requests and org changes
  // ---------------------------------------------------------------------------

  get pullRequestRows() {
    if (!this.plan) {
      return [];
    }
    return this.plan.pullRequests.map((pr) => ({
      key: `${pr.commit}-${pr.id}`,
      label: pr.id > 0 ? `#${pr.id} ${pr.title}` : pr.title,
      meta: [pr.author, this.formatDate(pr.date)]
        .filter((part) => !!part)
        .join(" · "),
      webUrl: pr.webUrl || null,
    }));
  }

  get hasPullRequests() {
    return this.pullRequestRows.length > 0;
  }

  get commitCountLabel() {
    const count = this.plan ? this.plan.commitCount : 0;
    return this.countLabel(
      count,
      "backpromoteCommitCountOne",
      "backpromoteCommitCount",
    );
  }

  get orgChangesNote() {
    if (!this.showMain) {
      return null;
    }
    const orgChanges = this.plan.orgChanges || { tracked: false, files: [] };
    if (!orgChanges.tracked) {
      return this.t("backpromoteOrgNotTrackedNote", {
        org: this.targetOrgLabel,
      });
    }
    if (orgChanges.files.length === 0) {
      return null;
    }
    return this.countLabel(
      orgChanges.files.length,
      "backpromoteOrgChangesNoteOne",
      "backpromoteOrgChangesNote",
    );
  }

  handleOpenPullRequest(event) {
    const url = event.currentTarget.dataset.url;
    if (url) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }

  // ---------------------------------------------------------------------------
  // Counters and sections
  // ---------------------------------------------------------------------------

  get counterItemsToDeploy() {
    return this.summary ? this.summary.itemsToDeployCount : 0;
  }

  get counterConflicts() {
    return this.summary ? this.summary.conflicts.length : 0;
  }

  get counterDeletions() {
    return this.summary ? this.summary.deletionsToDeleteCount : 0;
  }

  get counterActions() {
    return this.summary ? this.summary.actionsToRunCount : 0;
  }

  get conflictsCounterClass() {
    return (
      "hardis-status-card" + (this.counterConflicts > 0 ? " warning" : "")
    );
  }

  get deletionsCounterClass() {
    return "hardis-status-card" + (this.counterDeletions > 0 ? " error" : "");
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

  get isConflictsOpen() {
    return this.openSections.conflicts;
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

  get conflictsChevron() {
    return this.chevron(this.openSections.conflicts);
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

  // --- Files changed on both sides -----------------------------------------------

  get conflictsSectionSummary() {
    const count = this.counterConflicts;
    return count === 0
      ? this.t("backpromoteConflictsNone")
      : this.countLabel(
          count,
          "backpromoteConflictsSummaryOne",
          "backpromoteConflictsSummary",
        );
  }

  get hasConflictRows() {
    return this.counterConflicts > 0;
  }

  get conflictRows() {
    if (!this.summary) {
      return [];
    }
    return this.summary.conflicts.map((conflict) => ({
      path: conflict.path,
      name: fileName(conflict.path),
      items: conflict.items.map((key) => ({ key: `${conflict.path}-${key}`, label: key })),
      changedInBranch: conflict.changedInBranch,
      changedInOrg: conflict.changedInOrg,
      overwriteButtonClass:
        conflict.choice === "overwrite" ? "hardis-btn-tinted-blue" : "",
      mergeButtonClass:
        conflict.choice === "merge" ? "hardis-btn-tinted-blue" : "",
      keepButtonClass:
        conflict.choice === "keep" ? "hardis-btn-tinted-amber" : "",
    }));
  }

  get overwriteTooltip() {
    return this.plan
      ? this.t("backpromoteChoiceOverwriteTooltip", {
          parentBranch: this.plan.parentBranch,
        })
      : "";
  }

  handleConflictChoice(event) {
    const { path, choice } = event.currentTarget.dataset;
    if (this.isReadOnly || !path || !choice || !this.selection) {
      return;
    }
    this.updateSelection({
      conflictDecisions: {
        ...this.selection.conflictDecisions,
        [path]: choice,
      },
    });
  }

  handleOpenFile(event) {
    const filePath = event.currentTarget.dataset.path;
    if (filePath) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: {
          filePath: this.workspaceRoot
            ? `${this.workspaceRoot}/${filePath}`
            : filePath,
        },
      });
    }
  }

  // --- Deletions -----------------------------------------------------------------

  get hasDeletionRows() {
    return !!this.plan && this.plan.deletions.length > 0;
  }

  get deletionsSectionSummary() {
    if (!this.hasDeletionRows) {
      return this.t("backpromoteDeletionsNone");
    }
    return this.t("backpromoteDeletionsSummary", {
      selected: this.counterDeletions,
      total: this.plan.deletions.length,
    });
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
      rowClass:
        "hardis-option-row" + (excluded.has(deletion.key) ? "" : " selected"),
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

  get hasActionRows() {
    return !!this.plan && this.plan.actions.length > 0;
  }

  get actionsSectionSummary() {
    if (!this.hasActionRows) {
      return this.t("backpromoteActionsNone");
    }
    const parts = [
      this.t("backpromoteActionsToRun", { count: this.counterActions }),
    ];
    if (this.summary && this.summary.manualActionsCount > 0) {
      parts.push(
        this.t("backpromoteActionsManual", {
          count: this.summary.manualActionsCount,
        }),
      );
    }
    return parts.join(" · ");
  }

  get actionRows() {
    if (!this.plan || !this.selection) {
      return [];
    }
    const selected = new Set(this.selection.actions);
    const translate = (key) => this.t(key);
    return this.plan.actions.map((action) => ({
      id: action.id,
      label: action.label,
      rowClass:
        "hardis-option-row bp-action-row" +
        (selected.has(action.id) ? " selected" : ""),
      ariaChecked: selected.has(action.id) ? "true" : "false",
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
    if (!this.plan) {
      return "";
    }
    return this.t("backpromoteAllMetadataSummary", {
      selected: this.counterItemsToDeploy,
      total: this.plan.items.length,
    });
  }

  get hasMetadataRows() {
    return !!this.plan && this.plan.items.length > 0;
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
    if (!this.plan || !this.selection) {
      return [];
    }
    const excluded = new Set(this.selection.excludedItems);
    return this.plan.items.map((item) => {
      let noteLabel = null;
      let notePillClass = UNKNOWN_PILL;
      if (excluded.has(item.key)) {
        noteLabel = this.t("backpromoteNotDeployedNow");
      } else if (item.conflict) {
        noteLabel = this.t("backpromoteItemMayConflict");
        notePillClass = PENDING_PILL;
      } else {
        noteLabel = this.t("backpromoteItemDeployed");
        notePillClass = INFO_PILL;
      }
      return {
        key: item.key,
        type: item.type,
        typePillClass: getMetadataTypePillClass(item.type),
        name: item.name,
        noteLabel,
        notePillClass,
      };
    });
  }

  get selectedMetadataKeys() {
    if (!this.plan || !this.selection) {
      return [];
    }
    const excluded = new Set(this.selection.excludedItems);
    return this.plan.items
      .filter((item) => !excluded.has(item.key))
      .map((item) => item.key);
  }

  handleMetadataSelection(event) {
    if (this.isReadOnly || !this.plan || !this.selection) {
      return;
    }
    const ticked = new Set(
      (event.detail.selectedRows || []).map((row) => row.key),
    );
    const excludedItems = this.plan.items
      .map((item) => item.key)
      .filter((key) => !ticked.has(key));
    const current = new Set(this.selection.excludedItems);
    if (
      excludedItems.length === current.size &&
      excludedItems.every((key) => current.has(key))
    ) {
      return;
    }
    this.updateSelection({ excludedItems });
  }

  // ---------------------------------------------------------------------------
  // Deploy bar
  // ---------------------------------------------------------------------------

  get testsLabel() {
    if (!this.plan || this.plan.testClasses.length === 0) {
      return this.t("backpromoteNoTestClass");
    }
    return this.t("backpromoteTestClasses", {
      classes: this.plan.testClasses.join(", "),
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
      case "nothingToDo":
        return this.t("backpromoteBlockerNothingToDo");
      case "conflictMarkers":
        return this.t("backpromoteBlockerConflicts", {
          names: this.summary.markersLeft
            .map((file) => fileName(file.path))
            .join(", "),
        });
      case "invalidCommand":
        return this.t("backpromoteBlockerInvalidCommand", {
          message: this.commandError || "",
        });
      default:
        return null;
    }
  }

  // What is on screen was computed before the run started: deploying it again would
  // redeploy the same Pull Requests and rerun their deployment actions
  get runStartedNote() {
    return this.runStarted ? this.t("backpromoteRunStartedRefresh") : null;
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
    if (this.runDisabled && this.continueDisabled) {
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

  handleOpenSourceControl() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "workbench.view.scm" },
    });
  }
}
