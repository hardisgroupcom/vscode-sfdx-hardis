/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getAvatarClass, getInitials } from "s/avatarUtils";
import {
  getActionTypeLabel,
  getActionTypeIconName,
  getActionTypePillClass,
  getActionWhenPillClass,
} from "s/deploymentActionUtils";
import { getTicketStatusPillClass } from "s/pillUtils";
import {
  applyModalState,
  buildPullRequestJourney,
  captureModalState,
  resetModalLoadingFlags,
} from "s/pullRequestUtils";

// Characters an action id or a branch name may hold to be passed to a command line
const SAFE_ACTION_ID = /^[\w .:@/+-]+$/;
const SAFE_BRANCH_NAME = /^[\w./-]+$/;
// Org branch under which sfdx-hardis records the actions tried in a developer org
const DEV_SANDBOXES_BRANCH = "dev-sandboxes";

export default class Pipeline extends SharedMixin(LightningElement) {
  @track prButtonInfo;
  enableDeploymentApexTestClasses = false;
  @track gitAuthenticated = false;
  @track connectedLabel = "Connect to Git";
  @track connectedVariant = "neutral";
  @track connectedIconName = "utility:link";
  @track ticketAuthenticated = false;
  @track ticketConnectedLabel = "Connect to Ticketing";
  @track ticketConnectedVariant = "neutral";
  @track ticketConnectedIconName = "utility:link";
  @track ticketProviderName = "";
  @track ticketProviderKey = "";
  @track currentBranchPullRequest = null;
  @track autoFixPullRequest = null;
  @track openPullRequests = [];
  @track displayFeatureBranches = true;
  // Branch modal: promotion and major-to-major Pull Requests are the vehicles that move the
  // User Stories, not stories themselves, so they are hidden unless this toggle is on
  @track modalShowPromotionPrs = false;
  // Branch modal: ids (key-field) and numbers of the stories ticked for the next promotion
  @track modalSelectedPrIds = [];
  modalSelectedPrNumbers = [];
  // Branch modal: the unfiltered list behind the current view (the branch window, or the go-live
  // selected in the combobox), so the toggles can be applied again without reloading anything
  @track modalSourcePullRequests = [];
  @track mermaidZoomLevel = 1;
  @track mermaidLoading = true;
  @track mermaidRefreshing = false;
  @track prLoading = true;
  @track loadError = null;
  @track projectApexScripts = [];
  // Custom functions of the project: they are action types, so the deployment action editor
  // needs them to label a type and to render the fields of its declared inputs
  @track customFunctions = [];
  @track projectSfdmuWorkspaces = [];
  @track projectSchedulableClasses = [];
  @track projectOnlySchedulableClasses = [];
  @track schedulableClassesLoading = false;
  @track schedulableClassesRequestId = null;
  @track projectBatchableClasses = [];
  @track projectOnlyBatchableClasses = [];
  @track batchableClassesLoading = false;
  @track batchableClassesRequestId = null;
  @track projectCommunities = [];
  @track communitiesLoading = false;
  @track communitiesRequestId = null;
  _refreshTimer = null;
  _isVisible = true;
  _isAutoRefresh = false;
  _mermaidZoomStep = 0.1;
  _mermaidMinZoomLevel = 1;
  _isMermaidPanning = false;
  _panStartX = 0;
  _panStartY = 0;
  _panScrollLeft = 0;
  _panScrollTop = 0;
  _suppressNextMermaidClick = false;
  _mermaidViewportBottomGap = 24;
  _mermaidViewportMinHeight = 220;
  prColumns = [
    {
      key: "number",
      label: "#",
      fieldName: "numberLabel",
      type: "button",
      typeAttributes: {
        label: { fieldName: "numberLabel" },
        name: "view_pr",
        variant: "base",
      },
      initialWidth: 80,
      wrapText: true,
    },
    {
      key: "title",
      label: "Title",
      fieldName: "title",
      type: "button",
      typeAttributes: {
        label: { fieldName: "title" },
        name: "view_pr",
        variant: "base",
      },
      initialWidth: 420,
      wrapText: true,
    },
    // Jobs status column: colored pill (dot + localized label), clickable to
    // the CI job (or the PR page as fallback)
    {
      key: "status",
      label: "",
      fieldName: "jobsStatusLabel",
      type: "statusPill",
      initialWidth: 110,
      wrapText: false,
      typeAttributes: {
        label: { fieldName: "jobsStatusLabel" },
        pillClass: { fieldName: "statusPillClass" },
        url: { fieldName: "jobsStatusUrl" },
      },
    },
    {
      key: "author",
      label: "Author",
      fieldName: "authorLabel",
      type: "avatarText",
      wrapText: false,
      typeAttributes: {
        initials: { fieldName: "authorInitials" },
        avatarClass: { fieldName: "authorAvatarClass" },
      },
    },
    {
      key: "source",
      label: "Source",
      fieldName: "sourceBranch",
      type: "branchChip",
      wrapText: false,
    },
    {
      key: "target",
      label: "Target",
      fieldName: "targetBranch",
      type: "branchChip",
      wrapText: false,
    },
  ];

  // Columns for modal PR display (with merge date). The job status column is
  // included only for single PR / "+N more" group modals (showJobStatusColumn).
  get modalPrColumns() {
    const statusColumn = this.showJobStatusColumn
      ? [
          {
            key: "status",
            label: this.i18n.statusLabel,
            fieldName: "jobsStatusLabel",
            type: "statusPill",
            typeAttributes: {
              label: { fieldName: "jobsStatusLabel" },
              pillClass: { fieldName: "statusPillClass" },
              url: { fieldName: "jobsStatusUrl" },
            },
            wrapText: false,
            initialWidth: 120,
          },
        ]
      : [];
    const mergeConflictColumn = this.modalHasMergeConflictColumn
      ? [
          {
            key: "mergeStatus",
            label: this.i18n.legendMergeConflicts,
            fieldName: "mergeConflictLabel",
            type: "typePill",
            typeAttributes: {
              label: { fieldName: "mergeConflictLabel" },
              pillClass: { fieldName: "mergeConflictPillClass" },
              tooltip: { fieldName: "mergeConflictTooltip" },
              iconName: { fieldName: "mergeConflictIcon" },
              url: { fieldName: "mergeConflictUrl" },
            },
            wrapText: false,
            initialWidth: 180,
          },
        ]
      : [];
    const promotionColumn = this.modalHasPromotionColumn
      ? [
          {
            key: "promotion",
            label: this.i18n.promotionLabel,
            fieldName: "promotionLabel",
            type: "statusPill",
            typeAttributes: {
              label: { fieldName: "promotionLabel" },
              pillClass: { fieldName: "promotionPillClass" },
              url: { fieldName: "promotionUrl" },
            },
            wrapText: false,
            // A width even as the last column: the table is wider than the modal and scrolls,
            // a flexible last column would get what is left, next to nothing
            initialWidth: 260,
          },
        ]
      : [];
    return [
      {
        key: "number",
        label: "#",
        fieldName: "numberLabel",
        type: "button",
        typeAttributes: {
          label: { fieldName: "numberLabel" },
          name: "view_pr",
          variant: "base",
        },
        initialWidth: 80,
        wrapText: true,
      },
      // Number and title open the Pull Request in the panel, the last column is the way out
      {
        key: "title",
        label: this.i18n.titleLabel,
        fieldName: "title",
        type: "button",
        typeAttributes: {
          label: { fieldName: "title" },
          name: "view_pr",
          variant: "base",
        },
        initialWidth: 300,
        wrapText: true,
      },
      // The one way out to the git provider. Not last: the last column is the only one that
      // may be left without a width
      {
        key: "external",
        label: "",
        fieldName: "webUrl",
        type: "url",
        typeAttributes: {
          label: { fieldName: "externalLabel" },
          target: "_blank",
        },
        initialWidth: 100,
        wrapText: false,
      },
      ...statusColumn,
      ...mergeConflictColumn,
      // The shared author column, which states a width. This table used to hold a copy of it
      // without one, and it was then the only column left to absorb what the promotion
      // checkbox column takes: it collapsed to the avatar circle, hiding both the author name
      // and the column header
      this._authorColumn(),
      {
        key: "mergeDate",
        label: this.i18n.mergedLabel,
        fieldName: "mergeDateFormatted",
        type: "text",
        wrapText: false,
        initialWidth: 130,
        cellAttributes: { class: "hardis-date-cell" },
      },
      {
        key: "source",
        label: this.i18n.sourceLabel,
        fieldName: "sourceBranch",
        type: "branchChip",
        wrapText: false,
        initialWidth: 200,
      },
      {
        key: "target",
        label: this.i18n.targetLabel,
        fieldName: "targetBranch",
        type: "branchChip",
        wrapText: false,
        // Only the last column is left without a width: when the promotion column follows, the
        // target column takes one, or it is squeezed to a single letter
        ...(promotionColumn.length > 0 ? { initialWidth: 150 } : {}),
      },
      // Last: it only says how a story travels, the columns before it say what it is
      ...promotionColumn,
    ];
  }

  // Datatable column definition for an author, displayed with the same
  // initials avatar as in the Pull Requests tab.
  _authorColumn() {
    return {
      key: "author",
      label: this.i18n.authorLabel,
      fieldName: "authorLabel",
      type: "avatarText",
      wrapText: false,
      initialWidth: 170,
      typeAttributes: {
        initials: { fieldName: "authorInitials" },
        avatarClass: { fieldName: "authorAvatarClass" },
      },
    };
  }

  // Datatable column definition for the pull request link (branch mode only).
  _pullRequestColumn() {
    return {
      key: "pullRequest",
      label: this.prButtonInfo?.pullRequestLabel || this.i18n.pullRequestLabel,
      fieldName: "prLabel",
      type: "button",
      typeAttributes: {
        label: { fieldName: "prLabel" },
        name: "view_pr",
        variant: "base",
      },
      wrapText: true,
    };
  }

  pipelineData;
  repoInfo;
  error;
  currentDiagram = "";
  lastDiagram = "";
  hasWarnings = false;
  warnings = [];
  showOnlyMajor = false;
  showPRModal = false;
  // Pull Requests explorer: the modal opened by the search button, with a lookup on top
  explorerMode = false;
  // A Pull Request is being read for the modal that is already open
  prViewLoading = false;
  // Windows left to open a Pull Request, most recent last: { label, state }. Back restores one
  // without reading anything again, so the stories ticked for a promotion are still ticked
  @track _modalStack = [];
  _stackPushedForRequest = false;
  // Id of the last Pull Request asked to the extension: the answer to an older one is dropped,
  // and so is any answer once the window was closed or left through the breadcrumb
  _prViewRequestId = 0;
  // The request replaces the windows of the breadcrumb once its Pull Request is there
  _clearStackOnAnswer = false;
  // Validation and deployment runs of the Pull Request shown, read by sfdx-hardis from its
  // comments (null until they are known)
  modalWorkflows = null;
  // True when the installed sfdx-hardis cannot return the runs: the Workflows tab is hidden
  workflowsUnavailable = false;
  // Branch checked out in the workspace, where the actions of the Pull Request are read and written
  modalCheckout = null;
  // Subject, status and assignee of the tickets of the window are being read
  ticketDetailsLoading = false;
  _ticketDetailsRequestId = 0;
  _ticketSourcePrs = [];
  _ticketRequestedIds = [];
  modalMode = "branch"; // "branch" or "singlePR"
  // Show the job status column in the PR modal only for a single PR or a "+N
  // more" group (not for a major branch's pending-promotion / go-live PRs).
  showJobStatusColumn = false;
  // True for the single feature branch / "+N more" group modals, whose PRs are
  // not enriched with tickets/deployment actions — so those tabs are hidden.
  isFeaturePrModal = false;
  modalBranchName = "";
  modalPullRequests = [];
  modalTickets = [];
  modalActions = [];
  // Tab the PR modal opens on. Set to "actions" by a deployment actions deep link.
  modalActiveTabValue = "prs";
  // Status of the deployment actions in each org branch, from sfdx-hardis
  // (null while loading, or when the installed CLI cannot provide it)
  modalActionStatuses = null;
  actionStatusesLoading = false;
  // Id of the last statuses request: a late answer to an older one (another window) is ignored
  actionStatusRequestId = 0;
  // Mark as done running in the background, then waiting for the new statuses
  markingDoneKeys = [];
  // Rows whose status details are shown, and the Backpromotes rows by Pull Request
  expandedActionRowIds = [];
  // Total pills switched off, one list per mode of the switch: the Status mode
  // and the Next promotion mode do not count the same things. A window always
  // opens with every pill on
  hiddenActionStatusKeys = [];
  hiddenActionForecastKeys = [];
  // "Next promotion" mode of the Deployment Actions tab: what the promotion to the
  // merge target of the branch will do with each action, computed by sfdx-hardis
  promotionMode = false;
  actionForecast = null;
  actionForecastLoading = false;
  actionBackpromotes = {};
  actionBackpromotesLoading = [];
  markDoneRefreshingKeys = [];
  // Tab to activate the next time the single PR modal opens (consumed on open).
  _nextModalTab = null;
  // True when the single-PR modal shows a Pull Request between two major
  // branches: its deployment actions are the ones of the feature Pull
  // Requests it carries, listed read-only with their author and Pull Request
  @track modalIsMajorPr = false;
  // True for a promotion Pull Request (promotion/ branch declaring the stories it carries)
  @track modalIsPromotionPr = false;
  // Declared Pull Request numbers that could not be loaded from the git provider
  @track modalPromotionUnresolved = [];
  // Deep link received before the pull request data is available, applied as soon
  // as the current branch pull request is known (see _maybeApplyPendingDeepLink).
  _pendingDeepLink = null;
  branchPullRequestsMap = new Map();
  // Map of "+N more" group node name -> group descriptor (target branch + PRs),
  // used to open the PR modal when a group node or its aggregated link is clicked.
  featureBranchGroupsMap = new Map();

  // Go-lives selector state (top branches only, e.g. main/prod)
  modalIsTopBranch = false;
  modalGoLives = []; // combobox options [{ label, value }]
  modalGoLivesLoading = false;
  modalGoLivePrsLoading = false;
  isLoadingReleaseDetails = false;
  selectedGoLiveId = "";
  _goLivesRequestId = null;
  _goLivePrsRequestId = null;
  _topBranchNames = new Set();

  // Apex tests modal state (per-PR)
  availableApexTestClasses = [];
  deploymentApexTestClasses = [];
  _deploymentApexTestClassesOriginal = [];
  apexTestsMode = "view"; // 'view' | 'edit'
  apexTestsByLineRows = [];

  // Column set for the Apex test datatables (test class + PR link).
  _apexTestClassColumns() {
    return [
      // Apex class names are technical identifiers: same monospace chip as
      // the git branch names of the Pull Requests tab
      {
        key: "apexTestClass",
        label: this.i18n.apexTestClassLabel,
        fieldName: "apexTestClass",
        type: "branchChip",
        wrapText: false,
      },
      this._pullRequestColumn(),
    ];
  }

  get apexTestsByLineColumns() {
    return this._apexTestClassColumns();
  }

  get hasApexTestsByLineRows() {
    return (
      Array.isArray(this.apexTestsByLineRows) &&
      this.apexTestsByLineRows.length > 0
    );
  }

  get isApexTestsEditMode() {
    return this.apexTestsMode === "edit";
  }

  get isApexTestsViewMode() {
    return this.apexTestsMode === "view";
  }

  get errorLoadingPipelineMsg() {
    return this.t("errorLoadingPipeline", { error: this.error });
  }

  get apexTestsConfiguredForPrMsg() {
    return this.t("apexTestsConfiguredForPr", { prLabel: this.prLabel });
  }

  get readOnlyBranchModeMsg() {
    return this.t("readOnlyBranchModeApexTests", { prLabel: this.prLabel });
  }

  get hasSelectedApexTests() {
    return (
      Array.isArray(this.deploymentApexTestClasses) &&
      this.deploymentApexTestClasses.length > 0
    );
  }

  get apexTestsSelectedRows() {
    const rows = [];
    const list = Array.isArray(this.deploymentApexTestClasses)
      ? this.deploymentApexTestClasses
      : [];
    // Determine current PR info when in single PR modal
    let currentPr = null;
    if (
      this.modalMode === "singlePR" &&
      Array.isArray(this.modalPullRequests) &&
      this.modalPullRequests.length === 1
    ) {
      currentPr = this.modalPullRequests[0];
    }
    for (const apexTestClass of list) {
      const row = {
        id: `apexTest-${apexTestClass}`,
        apexTestClass: apexTestClass,
      };
      if (currentPr) {
        row.prLabel = `#${currentPr.number || ""} - ${currentPr.title || ""}`;
        row.prWebUrl = currentPr.webUrl || "";
      } else {
        row.prLabel = "";
        row.prWebUrl = "";
      }
      rows.push(row);
    }
    rows.sort((a, b) =>
      (a.apexTestClass || "").localeCompare(b.apexTestClass || ""),
    );
    return rows;
  }

  get apexTestsSelectedColumns() {
    return this._apexTestClassColumns();
  }

  // Deployment action modal state
  @track showDeploymentActionModal = false;
  @track currentDeploymentAction = null;
  @track isDeploymentActionEditMode = false;

  // Dynamically compute the icon URL for the PR button
  get prButtonIconUrl() {
    if (!this.prButtonInfo || !this.prButtonInfo.icon) return null;
    // The icons are copied to /resources/git-icons in the webview root
    return `/resources/git-icons/${this.prButtonInfo.icon}.svg`;
  }

  // Compute the git provider icon URL (falls back to generic link icon when missing)
  get gitProviderIconUrl() {
    const key =
      (this.prButtonInfo && this.prButtonInfo.icon) ||
      this.repoPlatformLabel ||
      "";
    return this.getImageUrl((key || "").toLowerCase(), "git");
  }

  get ticketProviderIconUrl() {
    // The icon key travels apart from the displayed name: "Azure Boards" is a
    // brand name, "azureboards" is the file shipped in resources
    const key = (
      this.ticketProviderKey ||
      this.ticketProviderName ||
      ""
    ).toLowerCase();
    return this.getImageUrl(key, "ticket");
  }

  // CSS classes to toggle colored vs greyed appearance
  get gitProviderIconClass() {
    return `provider-icon ${this.gitAuthenticated ? "provider-colored" : "provider-grey"}`;
  }

  get ticketProviderIconClass() {
    return `provider-icon ${this.ticketAuthenticated ? "provider-colored" : "provider-grey"}`;
  }

  get hasCurrentBranchPullRequest() {
    return !!this.currentBranchPullRequest;
  }

  get hasAutoFixPullRequest() {
    return !!this.autoFixPullRequest;
  }

  get currentPrCardClasses() {
    return `hardis-card clickable${this.hasCurrentBranchPullRequest ? "" : " disabled"}`;
  }

  get mermaidViewportClass() {
    return this.isMermaidZoomed
      ? "mermaid-viewport mermaid-viewport-zoomed"
      : "mermaid-viewport";
  }

  get isMermaidZoomed() {
    return this.mermaidZoomLevel > this._mermaidMinZoomLevel;
  }

  get isMermaidUnzoomed() {
    return this.mermaidZoomLevel <= this._mermaidMinZoomLevel;
  }

  get isMermaidLoading() {
    return this.mermaidLoading === true && !this.loadError;
  }

  // Manual refresh of an already-rendered diagram: keep the diagram visible and
  // overlay a spinner on top of it (distinct from isMermaidLoading, which
  // replaces the empty area during the very first load).
  get isMermaidRefreshing() {
    return this.mermaidRefreshing === true && !this.loadError;
  }

  get isPrLoading() {
    return this.prLoading === true;
  }

  get hasError() {
    return !!this.loadError;
  }

  handleRetry() {
    this.loadError = null;
    this.mermaidLoading = true;
    this.prLoading = true;
    window.sendMessageToVSCode({ type: "retryInit" });
  }

  handleShowPipelineConfig() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: {
        command: "vscode-sfdx-hardis.showPipelineConfig",
        args: [],
      },
    });
  }

  @api
  initialize(data) {
    data = data || {};

    // Handle staged loading flags first — always processed regardless of payload type.
    if (Object.prototype.hasOwnProperty.call(data, "mermaidLoading")) {
      this.mermaidLoading = data.mermaidLoading === true;
      if (this.mermaidLoading) {
        this.loadError = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "prLoading")) {
      this.prLoading = data.prLoading === true;
    }
    if (Object.prototype.hasOwnProperty.call(data, "mermaidRefreshing")) {
      this.mermaidRefreshing = data.mermaidRefreshing === true;
    }
    if (Object.prototype.hasOwnProperty.call(data, "loadError")) {
      this.loadError = data.loadError || null;
    }
    // Deep link (ex: the "Update the Deployment Actions of your Pull Request" button
    // at the end of hardis:work:save). It arrives with the very first payload, before
    // the pull requests are loaded, so it is kept until the data is there.
    if (Object.prototype.hasOwnProperty.call(data, "deepLink")) {
      this._pendingDeepLink = data.deepLink || null;
    }

    // When only flag fields are present (step-1 or error-only payload), stop here.
    if (!Object.prototype.hasOwnProperty.call(data, "pipelineData")) {
      return;
    }

    // Diagram data has arrived — the first-load spinner is no longer needed.
    // The refresh overlay (mermaidRefreshing) is NOT cleared here: it is driven
    // explicitly per payload (step 2 turns it on while git data loads, step 3 and
    // refresh completions turn it off), so it can stay on over the rendered
    // no-PR diagram between steps 2 and 3.
    this.mermaidLoading = false;

    // Full data payload — update all content fields.
    this._isAutoRefresh = false;

    if (Object.prototype.hasOwnProperty.call(data, "pipelineData")) {
      this.pipelineData = data.pipelineData;
    }
    if (Object.prototype.hasOwnProperty.call(data, "repoPlatformLabel")) {
      this.repoPlatformLabel = data.repoPlatformLabel || "Git";
    }
    if (Object.prototype.hasOwnProperty.call(data, "prButtonInfo")) {
      this.prButtonInfo = data.prButtonInfo;
    }
    this.warnings = (this.pipelineData && this.pipelineData.warnings) || [];
    this.hasWarnings = this.warnings.length > 0;
    this.showOnlyMajor = false;
    if (Object.prototype.hasOwnProperty.call(data, "displayFeatureBranches")) {
      this.displayFeatureBranches = data.displayFeatureBranches ?? true;
    }
    if (
      Object.prototype.hasOwnProperty.call(
        data,
        "enableDeploymentApexTestClasses",
      )
    ) {
      this.enableDeploymentApexTestClasses =
        !!data.enableDeploymentApexTestClasses;
    }
    if (
      Object.prototype.hasOwnProperty.call(data, "availableApexTestClasses")
    ) {
      this.availableApexTestClasses = Array.isArray(
        data.availableApexTestClasses,
      )
        ? data.availableApexTestClasses
        : [];
    }

    // Store branch PR data for modal display
    this.branchPullRequestsMap = new Map();
    this._topBranchNames = new Set();
    if (this.pipelineData && this.pipelineData.orgs) {
      for (const org of this.pipelineData.orgs) {
        if (org.isTopBranch) {
          this._topBranchNames.add(org.name);
        }
        if (
          org.pullRequestsInBranchSinceLastMerge &&
          org.pullRequestsInBranchSinceLastMerge.length > 0
        ) {
          this.branchPullRequestsMap.set(
            org.name,
            org.pullRequestsInBranchSinceLastMerge,
          );
        }
      }
    }

    // Store "+N more" feature-branch groups (node name -> descriptor) so a click
    // on the group node or its aggregated link opens a modal listing its PRs.
    this.featureBranchGroupsMap = new Map();
    if (
      this.pipelineData &&
      Array.isArray(this.pipelineData.featureBranchGroups)
    ) {
      for (const group of this.pipelineData.featureBranchGroups) {
        if (group && group.nodeName) {
          this.featureBranchGroupsMap.set(group.nodeName, group);
        }
      }
    }
    // Select diagram based on displayFeatureBranches toggle
    this.currentDiagram = this.displayFeatureBranches
      ? this.pipelineData.mermaidDiagram
      : this.pipelineData.mermaidDiagramMajor;
    this.error = undefined;
    this.lastDiagram = "";

    if (Object.prototype.hasOwnProperty.call(data, "gitAuthenticated")) {
      this.gitAuthenticated = data.gitAuthenticated ?? false;
    }
    this.connectedLabel = this.gitAuthenticated
      ? this.t("connectedTo", { platform: this.repoPlatformLabel })
      : this.t("connectTo", { platform: this.repoPlatformLabel });
    this.connectedIconName = this.gitAuthenticated
      ? "utility:check"
      : "utility:link";

    // Update ticketing authentication state
    if (Object.prototype.hasOwnProperty.call(data, "ticketAuthenticated")) {
      this.ticketAuthenticated = data.ticketAuthenticated ?? false;
    }
    if (Object.prototype.hasOwnProperty.call(data, "ticketProviderName")) {
      this.ticketProviderName = data.ticketProviderName || "Ticketing";
    }
    if (Object.prototype.hasOwnProperty.call(data, "ticketProviderKey")) {
      this.ticketProviderKey = data.ticketProviderKey || "";
    }
    this.ticketConnectedLabel = this.ticketAuthenticated
      ? this.t("connectedTo", { platform: this.ticketProviderName })
      : this.t("connectTo", { platform: this.ticketProviderName });
    this.ticketConnectedIconName = this.ticketAuthenticated
      ? "utility:check"
      : "utility:link";
    this.ticketConnectedVariant = this.ticketAuthenticated
      ? "success"
      : "neutral";

    if (Object.prototype.hasOwnProperty.call(data, "openPullRequests")) {
      this.openPullRequests = this._mapPrsWithIcons(
        data.openPullRequests || [],
      );
      // ensure reactivity for computed label
      this.openPullRequests = Array.isArray(this.openPullRequests)
        ? this.openPullRequests
        : [];
    }
    // Store current branch PR
    if (
      Object.prototype.hasOwnProperty.call(data, "currentBranchPullRequest")
    ) {
      this.currentBranchPullRequest = data.currentBranchPullRequest || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "autoFixPullRequest")) {
      this.autoFixPullRequest = data.autoFixPullRequest || null;
    }
    // Store project resources
    if (Object.prototype.hasOwnProperty.call(data, "customFunctions")) {
      this.customFunctions = data.customFunctions || [];
    }
    if (Object.prototype.hasOwnProperty.call(data, "projectApexScripts")) {
      this.projectApexScripts = data.projectApexScripts || [];
    }
    if (Object.prototype.hasOwnProperty.call(data, "projectSfdmuWorkspaces")) {
      this.projectSfdmuWorkspaces = data.projectSfdmuWorkspaces || [];
    }
    if (
      Object.prototype.hasOwnProperty.call(data, "projectSchedulableClasses")
    ) {
      this.projectSchedulableClasses = data.projectSchedulableClasses || [];
    }
    if (Object.prototype.hasOwnProperty.call(data, "projectCommunities")) {
      this.projectCommunities = data.projectCommunities || [];
    }
    // adjust columns to fit the available width immediately
    setTimeout(() => this.adjustPrColumns(), 50);
    // Render the Mermaid diagram after a brief delay to ensure DOM is ready
    setTimeout(() => this.renderMermaid(), 0);
    console.log("Pipeline data initialized:", this.pipelineData);
    // Update panel title with PR count
    this._updatePanelTitle();
    // Start auto-refresh timer
    this._startAutoRefresh();
    // Apply a pending deep link now that the pull requests are known
    this._maybeApplyPendingDeepLink();
  }

  /**
   * Opens the deployment actions of the current branch pull request when the panel
   * was opened by a deep link. Waits for the pull request loading stage to complete,
   * since the current branch pull request is only known at that point.
   */
  _maybeApplyPendingDeepLink() {
    if (!this._pendingDeepLink || this.prLoading) {
      return;
    }
    const deepLink = this._pendingDeepLink;
    this._pendingDeepLink = null;
    if (deepLink.focus === "explorer") {
      this.handleOpenExplorer();
      return;
    }
    // A Pull Request link of another panel
    if (deepLink.focus === "pullRequest" && deepLink.prNumber > 0) {
      this.openPullRequestView({
        prNumber: deepLink.prNumber,
        tab: deepLink.tab || null,
      });
      return;
    }
    if (
      deepLink.focus !== "deploymentActions" ||
      !this.currentBranchPullRequest
    ) {
      // No pull request to focus (ex: no git provider authenticated): leave the
      // pipeline panel on its home view rather than opening an empty modal.
      return;
    }
    this._nextModalTab = "actions";
    this.showSinglePRModal(this.currentBranchPullRequest);
  }

  get prLabel() {
    return this.prButtonInfo?.pullRequestLabel || this.i18n.pullRequestLabel;
  }

  // Major branch names, offered when restricting a deployment action to some target orgs
  get majorBranchNames() {
    const orgs = this.pipelineData?.orgs;
    if (!Array.isArray(orgs)) {
      return [];
    }
    return orgs.map((org) => org.name).filter(Boolean);
  }

  get showApexTestsTab() {
    return this.enableDeploymentApexTestClasses === true;
  }

  get modalApexTestsTabLabel() {
    let count = 0;
    if (this.canEditApexTestsInModal) {
      count = Array.isArray(this.deploymentApexTestClasses)
        ? this.deploymentApexTestClasses.length
        : 0;
    } else {
      const rows = Array.isArray(this.apexTestsByLineRows)
        ? this.apexTestsByLineRows
        : [];
      const uniq = new Set();
      for (const row of rows) {
        const name = String(row?.apexTestClass || "").trim();
        if (!name) {
          continue;
        }
        uniq.add(name.toLowerCase());
      }
      count = uniq.size;
    }
    return this.t("apexTestsTab", { count });
  }

  get canEditApexTestsInModal() {
    return this.modalMode === "singlePR" && this.modalPullRequests.length === 1;
  }

  normalizeApexTestClasses(list) {
    const raw = Array.isArray(list) ? list : [];
    const seen = new Set();
    const out = [];
    // jscpd:ignore-start
    for (const item of raw) {
      const v = String(item || "").trim();
      if (!v) {
        continue;
      }
      const key = v.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(v);
    }
    // jscpd:ignore-end
    return out;
  }

  handleApexTestsSelectChange(event) {
    const value = event?.detail?.value;
    this.deploymentApexTestClasses = this.normalizeApexTestClasses(value);
  }

  handleEditApexTests() {
    if (!this.canEditApexTestsInModal) {
      return;
    }
    this._deploymentApexTestClassesOriginal = Array.isArray(
      this.deploymentApexTestClasses,
    )
      ? [...this.deploymentApexTestClasses]
      : [];
    this.apexTestsMode = "edit";
  }

  handleCancelApexTestsEdit() {
    this.deploymentApexTestClasses = Array.isArray(
      this._deploymentApexTestClassesOriginal,
    )
      ? [...this._deploymentApexTestClassesOriginal]
      : [];
    this.apexTestsMode = "view";
  }

  handleSaveApexTests() {
    if (!this.canEditApexTestsInModal) {
      return;
    }
    const pr = this.modalPullRequests[0];
    const deploymentApexTestClasses = this.normalizeApexTestClasses(
      this.deploymentApexTestClasses,
    );
    // Optimistically switch back to view mode
    this._deploymentApexTestClassesOriginal = [...deploymentApexTestClasses];
    this.deploymentApexTestClasses = [...deploymentApexTestClasses];
    this.apexTestsMode = "view";
    window.sendMessageToVSCode({
      type: "saveDeploymentApexTestClasses",
      data: {
        prNumber: pr.number,
        deploymentApexTestClasses: deploymentApexTestClasses,
        warning: this.notOwnPrWarning,
      },
    });
  }

  // Map PRs to include a computed jobsIconName used by datatable cellAttributes
  _mapPrsWithIcons(prs) {
    if (!Array.isArray(prs)) return [];
    return prs.map((pr) => {
      const copy = Object.assign({}, pr);
      // set image src for pre-colored SVG based on normalized status
      const key = (pr.jobsStatus || "unknown").toString().toLowerCase();
      const normalized = ["running", "pending", "success", "failed"].includes(
        key,
      )
        ? key
        : "unknown";
      // Localized status label + pill CSS classes for the statusPill cell type
      const labelMap = {
        running: this.t("jobStatusRunning"),
        pending: this.t("jobStatusPending"),
        success: this.t("jobStatusSuccess"),
        failed: this.t("jobStatusFailed"),
        unknown: this.t("jobStatusUnknown"),
      };
      copy.jobsStatusLabel = labelMap[normalized] || labelMap.unknown;
      copy.numberLabel = pr.number > 0 ? `#${pr.number}` : "";
      copy.externalLabel = this.repoPlatformLabel || "Git";
      copy.statusPillClass = `hardis-pill hardis-status-${normalized}`;
      // URL for the clickable job status: prefer the CI job URL, fall back to
      // the pull request page (mirrors the diagram link behavior).
      copy.jobsStatusUrl =
        Array.isArray(pr.jobs) && pr.jobs[0] && pr.jobs[0].webUrl
          ? pr.jobs[0].webUrl
          : pr.webUrl || "";

      // Initials avatar for the author column (avatarText cell type). The
      // color variant is stable per author (hash of the name).
      copy.authorInitials = getInitials(copy.authorLabel) || "?";
      copy.authorAvatarClass = getAvatarClass(copy.authorLabel);

      // Compact merge date: "Aug 15, 18:30" (adds the year when not current)
      // so the column stays on a single line.
      copy.mergeDateFormatted = this._formatCompactDate(pr.mergeDate);

      // Merge conflicts: the provider says this open Pull Request no longer merges into its
      // target branch. Only "conflicts" is marked: "unknown" means the provider has not
      // answered yet (or does not answer at all), never that the merge is clean, and a merged
      // Pull Request has no verdict, so most rows stay empty.
      const hasMergeConflicts = pr.mergeStatus === "conflicts";
      copy.mergeConflictLabel = hasMergeConflicts
        ? this.t("legendMergeConflicts")
        : "";
      copy.mergeConflictTooltip = hasMergeConflicts
        ? this.t("mergeConflictsTooltip")
        : "";
      copy.mergeConflictPillClass = hasMergeConflicts
        ? "hardis-pill hardis-status-failed"
        : "";
      copy.mergeConflictIcon = hasMergeConflicts ? "utility:warning" : "";
      copy.mergeConflictUrl = hasMergeConflicts ? pr.webUrl || "" : "";

      // Promotion branches: a story already shipped through a promotion branch, or
      // brought into the window by one, gets a pill pointing to that promotion
      copy.promotionLabel = "";
      copy.promotionPillClass = "";
      copy.promotionUrl = "";
      if (
        Array.isArray(pr.alreadyDeployedVia) &&
        pr.alreadyDeployedVia.length > 0
      ) {
        const promotion = pr.alreadyDeployedVia[0];
        copy.promotionLabel = this.t("prAlreadyDeployedViaPromotion", {
          branch: promotion.sourceBranch || `#${promotion.number}`,
        });
        copy.promotionPillClass = "hardis-pill hardis-status-success";
        copy.promotionUrl = promotion.webUrl || "";
      } else if (pr.carriedByPullRequest) {
        copy.promotionLabel = this.t("prCarriedByPromotion", {
          branch:
            pr.carriedByPullRequest.sourceBranch ||
            `#${pr.carriedByPullRequest.number}`,
        });
        copy.promotionPillClass = "hardis-pill hardis-status-pending";
        copy.promotionUrl = pr.carriedByPullRequest.webUrl || "";
      } else if (pr.isPromotion) {
        copy.promotionLabel = this.t("prIsPromotion", {
          count: (pr.promotionPullRequests || []).length,
        });
        copy.promotionPillClass = "hardis-pill hardis-status-running";
        copy.promotionUrl = pr.webUrl || "";
      }

      return copy;
    });
  }

  // The promotion column only appears when at least one row has something to say,
  // so projects without promotion branches keep the same table
  get modalHasPromotionColumn() {
    return (this.modalPullRequests || []).some((pr) => pr.promotionLabel);
  }

  // Same rule for the merge conflicts column: a list where everything merges cleanly, or
  // where the provider has no verdict to give (Bitbucket, a Pull Request opened seconds
  // ago, a merged one), keeps exactly the table it had
  get modalHasMergeConflictColumn() {
    return (this.modalPullRequests || []).some((pr) => pr.mergeConflictLabel);
  }

  _formatCompactDate(value) {
    if (!value) {
      return "";
    }
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return value;
      }
      const sameYear = date.getFullYear() === new Date().getFullYear();
      const options = sameYear
        ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : { year: "numeric", month: "short", day: "numeric" };
      return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch (e) {
      return value;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.connectedLabel = this.i18n.connectToGit;
    this.ticketConnectedLabel = this.i18n.connectToTicketing;
    this._translatePrColumnLabels();
    this._boundAdjust = this._handleWindowResize.bind(this);
    this._boundVisibilityChange = this._handleVisibilityChange.bind(this);
    this._boundMermaidMouseMove = this._handleMermaidMouseMove.bind(this);
    this._boundMermaidMouseUp = this._handleMermaidMouseUp.bind(this);
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", this._boundAdjust);
      document.addEventListener(
        "visibilitychange",
        this._boundVisibilityChange,
      );
      window.addEventListener("mousemove", this._boundMermaidMouseMove);
      window.addEventListener("mouseup", this._boundMermaidMouseUp);
    }
    this._isVisible = !document.hidden;
  }

  _translatePrColumnLabels() {
    const labelMap = {
      title: this.i18n.titleLabel,
      author: this.i18n.authorLabel,
      source: this.i18n.sourceLabel,
      target: this.i18n.targetLabel,
    };
    this.prColumns = this.prColumns.map((col) => {
      if (col.key && labelMap[col.key]) {
        return Object.assign({}, col, { label: labelMap[col.key] });
      }
      return col;
    });
  }

  disconnectedCallback() {
    if (
      typeof window !== "undefined" &&
      window.removeEventListener &&
      this._boundAdjust
    ) {
      window.removeEventListener("resize", this._boundAdjust);
    }
    if (
      typeof window !== "undefined" &&
      window.removeEventListener &&
      this._boundVisibilityChange
    ) {
      document.removeEventListener(
        "visibilitychange",
        this._boundVisibilityChange,
      );
    }
    if (
      typeof window !== "undefined" &&
      window.removeEventListener &&
      this._boundMermaidMouseMove
    ) {
      window.removeEventListener("mousemove", this._boundMermaidMouseMove);
    }
    if (
      typeof window !== "undefined" &&
      window.removeEventListener &&
      this._boundMermaidMouseUp
    ) {
      window.removeEventListener("mouseup", this._boundMermaidMouseUp);
    }
    // Clean up auto-refresh timer
    this._stopAutoRefresh();
  }

  _handleWindowResize() {
    this.adjustPrColumns();
    const mermaidSvg = this.template.querySelector(".mermaid svg");
    this._applyMermaidZoom(mermaidSvg);
  }

  handleMermaidZoomIn() {
    this._setMermaidZoom(this.mermaidZoomLevel + this._mermaidZoomStep);
  }

  handleMermaidZoomOut() {
    if (this.isMermaidUnzoomed) {
      return;
    }
    this._setMermaidZoom(this.mermaidZoomLevel - this._mermaidZoomStep);
  }

  handleMermaidWheel(event) {
    if (!event || event.ctrlKey !== true) {
      return;
    }

    const viewport = this.template.querySelector(".mermaid-viewport");
    if (!viewport) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = viewport.getBoundingClientRect();
    const focusPoint = {
      x:
        (viewport.scrollLeft + (event.clientX - rect.left)) /
        Math.max(viewport.scrollWidth, 1),
      y:
        (viewport.scrollTop + (event.clientY - rect.top)) /
        Math.max(viewport.scrollHeight, 1),
    };
    const zoomDelta =
      event.deltaY < 0 ? this._mermaidZoomStep : -this._mermaidZoomStep;
    this._setMermaidZoom(this.mermaidZoomLevel + zoomDelta, focusPoint);
  }

  _setMermaidZoom(nextZoomLevel, focusPoint) {
    const viewport = this.template.querySelector(".mermaid-viewport");
    const previousCenterX =
      focusPoint?.x != null
        ? focusPoint.x
        : viewport
          ? (viewport.scrollLeft + viewport.clientWidth / 2) /
            Math.max(viewport.scrollWidth, 1)
          : 0;
    const previousCenterY =
      focusPoint?.y != null
        ? focusPoint.y
        : viewport
          ? (viewport.scrollTop + viewport.clientHeight / 2) /
            Math.max(viewport.scrollHeight, 1)
          : 0;

    const normalizedZoomLevel = Math.max(
      this._mermaidMinZoomLevel,
      Number(nextZoomLevel.toFixed(1)),
    );
    this.mermaidZoomLevel = normalizedZoomLevel;
    this._handleMermaidMouseUp();

    requestAnimationFrame(() => {
      const mermaidSvg = this.template.querySelector(".mermaid svg");
      this._applyMermaidZoom(mermaidSvg);
      const refreshedViewport =
        this.template.querySelector(".mermaid-viewport");
      if (!refreshedViewport) {
        return;
      }
      if (this.isMermaidZoomed) {
        refreshedViewport.scrollLeft = Math.max(
          0,
          previousCenterX * refreshedViewport.scrollWidth -
            refreshedViewport.clientWidth / 2,
        );
        refreshedViewport.scrollTop = Math.max(
          0,
          previousCenterY * refreshedViewport.scrollHeight -
            refreshedViewport.clientHeight / 2,
        );
      } else {
        refreshedViewport.scrollLeft = 0;
        refreshedViewport.scrollTop = 0;
      }
    });
  }

  handleMermaidMouseDown(event) {
    if (!this.isMermaidZoomed || event.button !== 0) {
      return;
    }
    const viewport = this.template.querySelector(".mermaid-viewport");
    if (!viewport) {
      return;
    }
    this._isMermaidPanning = true;
    this._suppressNextMermaidClick = false;
    this._panStartX = event.clientX;
    this._panStartY = event.clientY;
    this._panScrollLeft = viewport.scrollLeft;
    this._panScrollTop = viewport.scrollTop;
    viewport.classList.add("is-panning");
    event.preventDefault();
  }

  _handleMermaidMouseMove(event) {
    if (!this._isMermaidPanning || !this.isMermaidZoomed) {
      return;
    }
    const viewport = this.template.querySelector(".mermaid-viewport");
    if (!viewport) {
      return;
    }
    const deltaX = event.clientX - this._panStartX;
    const deltaY = event.clientY - this._panStartY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      this._suppressNextMermaidClick = true;
    }
    viewport.scrollLeft = this._panScrollLeft - deltaX;
    viewport.scrollTop = this._panScrollTop - deltaY;
  }

  _handleMermaidMouseUp() {
    if (!this._isMermaidPanning) {
      return;
    }
    this._isMermaidPanning = false;
    const viewport = this.template.querySelector(".mermaid-viewport");
    if (viewport) {
      viewport.classList.remove("is-panning");
    }
  }

  _applyMermaidZoom(mermaidSvg) {
    if (!mermaidSvg) {
      return;
    }

    const viewport = this.template.querySelector(".mermaid-viewport");
    if (!viewport) {
      return;
    }

    const availableHeight = this._getAvailableMermaidViewportHeight(viewport);

    const viewBox = mermaidSvg.viewBox && mermaidSvg.viewBox.baseVal;
    const baseWidth =
      (viewBox && viewBox.width) ||
      (typeof mermaidSvg.getBBox === "function"
        ? mermaidSvg.getBBox().width
        : 0) ||
      mermaidSvg.clientWidth ||
      1;
    const baseHeight =
      (viewBox && viewBox.height) ||
      (typeof mermaidSvg.getBBox === "function"
        ? mermaidSvg.getBBox().height
        : 0) ||
      mermaidSvg.clientHeight ||
      1;

    const availableWidth = Math.max(viewport.clientWidth, 1);
    const fitScale = Math.min(
      availableWidth / Math.max(baseWidth, 1),
      availableHeight / Math.max(baseHeight, 1),
    );
    const scale = fitScale * (this.mermaidZoomLevel || 1);
    const renderedHeight = Math.ceil(baseHeight * scale);

    mermaidSvg.style.maxWidth = "none";
    mermaidSvg.style.width = `${Math.ceil(baseWidth * scale)}px`;
    mermaidSvg.style.height = `${Math.ceil(baseHeight * scale)}px`;
    mermaidSvg.style.display = "block";

    if (this.isMermaidZoomed) {
      viewport.style.height = `${Math.floor(availableHeight)}px`;
    } else {
      viewport.style.height = `${Math.min(Math.floor(availableHeight), renderedHeight)}px`;
    }
  }

  _getAvailableMermaidViewportHeight(viewport) {
    if (!viewport || typeof window === "undefined") {
      return this._mermaidViewportMinHeight;
    }
    const viewportTop = viewport.getBoundingClientRect().top;
    return Math.max(
      this._mermaidViewportMinHeight,
      window.innerHeight - viewportTop - this._mermaidViewportBottomGap,
    );
  }

  adjustPrColumns() {
    try {
      const dt = this.template.querySelector("s-hardis-datatable");
      // fallback container
      const container =
        this.template.querySelector(".pipeline-card-spacing") ||
        this.template.querySelector(".pipeline-container");
      const rect = dt
        ? dt.getBoundingClientRect()
        : container
          ? container.getBoundingClientRect()
          : null;
      // Prefer datatable's clientWidth when available (excludes scrollbar)
      // Subtract extra padding to account for internal padding and prevent horizontal scrollbar
      const rawWidth =
        dt && dt.clientWidth
          ? dt.clientWidth
          : rect && rect.width
            ? rect.width
            : null;
      // Reserve space for internal padding/margins to prevent scrollbar
      const available = rawWidth ? Math.max(rawWidth - 5, 600) : 800;

      // Minimum widths
      const minNumber = 80;
      const minStatus = 110;
      const minAuthor = 150;
      const minSource = 220;
      const minTarget = 140;

      // Sum of minimums
      const sumMin =
        minNumber + minStatus + minAuthor + minSource + minTarget + 120; // 120 is a sensible minimum for title
      // We'll compute float widths first, then convert to integers and distribute rounding
      const absMin = {
        number: 40,
        status: 90,
        author: 80,
        source: 80,
        target: 60,
        title: 80,
      };

      // Start with desired (float) widths based on minima
      let desired = {
        number: minNumber,
        status: minStatus,
        author: minAuthor,
        source: minSource,
        target: minTarget,
        title: Math.max(
          120,
          available -
            (minNumber + minStatus + minAuthor + minSource + minTarget),
        ),
      };

      // If available is smaller than the sum of sensible minima, scale the sensible minima down
      if (available < sumMin) {
        const scale = available / sumMin;
        desired.number = Math.max(absMin.number, minNumber * scale);
        desired.status = Math.max(absMin.status, minStatus * scale);
        desired.author = Math.max(absMin.author, minAuthor * scale);
        desired.source = Math.max(absMin.source, minSource * scale);
        desired.target = Math.max(absMin.target, minTarget * scale);
        // title gets remaining space (but at least its absMin)
        desired.title = Math.max(
          absMin.title,
          available -
            (desired.number +
              desired.status +
              desired.author +
              desired.source +
              desired.target),
        );
      }

      // Now convert floats to integer widths while ensuring the total equals available (rounded)
      const availInt = Math.round(available);
      // Prefer title early so remainder distribution favours it
      const cols = ["number", "title", "status", "author", "source", "target"];
      const intWidths = {};
      // floor each desired
      cols.forEach((k) => {
        intWidths[k] = Math.floor(desired[k]);
      });
      let sumInt = cols.reduce((s, k) => s + intWidths[k], 0);
      let remainder = availInt - sumInt;

      if (remainder !== 0) {
        // compute fractional parts to distribute remainder fairly
        const fracs = cols.map((k) => ({
          key: k,
          frac: desired[k] - Math.floor(desired[k]),
        }));
        // If we need to add pixels, give to highest fractional parts first (prefer title)
        if (remainder > 0) {
          // prefer title first, then by fractional part
          fracs.sort((a, b) => {
            if (a.key === "title" && b.key !== "title") return -1;
            if (b.key === "title" && a.key !== "title") return 1;
            return b.frac - a.frac;
          });
          let i = 0;
          while (remainder > 0) {
            const idx = i % fracs.length;
            intWidths[fracs[idx].key] += 1;
            remainder -= 1;
            i += 1;
          }
        }
        // If we need to remove pixels, remove from smallest fractional parts or columns above their absMin
        else if (remainder < 0) {
          fracs.sort((a, b) => a.frac - b.frac);
          let i = 0;
          remainder = -remainder;
          while (remainder > 0) {
            const key = fracs[i % fracs.length].key;
            if (intWidths[key] > absMin[key]) {
              intWidths[key] -= 1;
              remainder -= 1;
            }
            i += 1;
            // safeguard: if we've looped and can't remove more because all at absMin, break
            if (i > fracs.length * 3) {
              break;
            }
          }
        }
      }

      // Final safety: if sum still differs, force-adjust title as last resort
      let finalSum = cols.reduce((s, k) => s + intWidths[k], 0);
      const diff = Math.round(available) - finalSum;
      if (diff !== 0) {
        intWidths.title = Math.max(absMin.title, intWidths.title + diff);
      }

      // Map to variables used later
      const numberW = intWidths.number;
      const statusW = intWidths.status;
      const titleW = intWidths.title;
      const authorW = intWidths.author;
      const sourceW = intWidths.source;
      const targetW = intWidths.target;

      const newCols = this.prColumns.map((c) => {
        const copy = Object.assign({}, c);
        // Prefer explicit `key` property for robust identification
        const k = copy.key || copy.fieldName;
        if (k === "number") copy.initialWidth = numberW;
        else if (k === "title") copy.initialWidth = titleW;
        else if (k === "status") copy.initialWidth = statusW;
        else if (k === "author") copy.initialWidth = authorW;
        else if (k === "source") copy.initialWidth = sourceW;
        else if (k === "target") copy.initialWidth = targetW;
        return copy;
      });
      // reassign to trigger reactivity
      this.prColumns = newCols;
    } catch (e) {
      // silently ignore measurement errors
      // console.warn('adjustPrColumns error', e);
    }
  }

  get openPrTabLabel() {
    const count = this.openPullRequests ? this.openPullRequests.length : 0;
    const prLabelPlural = this.prButtonInfo?.pullRequestLabel
      ? this.prButtonInfo.pullRequestLabel + "s"
      : this.i18n.pullRequests;
    return count > 0
      ? this.t("openPrTabLabelWithCount", { prLabel: prLabelPlural, count })
      : this.t("openPrTabLabel", { prLabel: prLabelPlural });
  }

  get currentPRCardTitle() {
    const prLabel =
      this.prButtonInfo?.pullRequestLabel || this.i18n.pullRequestLabel;
    return this.t("myPrCardTitle", { prLabel });
  }

  get currentPRDescription() {
    if (!this.currentBranchPullRequest) {
      return this.i18n.connectGitToSeePrDetails;
    }
    if (this.currentBranchPullRequest.number === -1) {
      return this.t("prNotCreatedYet", {
        prLabel: this.prButtonInfo.pullRequestLabel,
      });
    }
    return this.t("prClickToManageActions", {
      num: this.currentBranchPullRequest.number,
      title: this.currentBranchPullRequest.title || "",
    });
  }

  get autoFixPRCardTitle() {
    return this.i18n.myPrAutofixCardTitle;
  }

  get autoFixPRDescription() {
    if (!this.autoFixPullRequest) {
      return "";
    }
    return this.t("myPrAutofixCardDescription", {
      num: this.autoFixPullRequest.number || "",
      prLabel: this.prLabel,
    });
  }

  openPrPage() {
    if (
      this.prButtonInfo &&
      this.prButtonInfo.url &&
      typeof window !== "undefined" &&
      window.sendMessageToVSCode
    ) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: { url: this.prButtonInfo.url },
      });
    }
  }

  openCloudityDocs() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://sfdx-hardis.cloudity.com/salesforce-devops-home/",
    });
  }

  configureAuth() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:project:configure:auth",
      },
    });
    console.log("Configure Auth button clicked");
  }

  handleToggleMajor(event) {
    this.showOnlyMajor = event.target.checked;
    // Expect the backend to provide both diagrams in pipelineData
    if (this.pipelineData) {
      if (this.showOnlyMajor && this.pipelineData.mermaidDiagramMajor) {
        this.currentDiagram = this.pipelineData.mermaidDiagramMajor;
      } else {
        this.currentDiagram = this.pipelineData.mermaidDiagram;
      }
      setTimeout(() => this.renderMermaid(), 0);
    }
  }

  renderedCallback() {
    if (this.pipelineData && this.currentDiagram) {
      if (this.currentDiagram !== this.lastDiagram) {
        this.renderMermaid();
      }
    }
  }

  renderMermaid() {
    const mermaidDiv = this.template.querySelector(".mermaid");
    const debugDiv = this.template.querySelector(".mermaid-debug");
    // Only set error if pipelineData.orgs exists and has length
    if (!mermaidDiv) {
      if (
        this.pipelineData &&
        this.pipelineData.orgs &&
        this.pipelineData.orgs.length
      ) {
        this.error = "Mermaid container not found in template.";
        if (debugDiv) debugDiv.textContent = this.error;
      } else {
        this.error = undefined;
        if (debugDiv) debugDiv.textContent = "";
      }
      return;
    }
    if (!window.mermaid) {
      this.error = "Mermaid library is not loaded.";
      if (debugDiv) debugDiv.textContent = this.error;
      return;
    }

    // Always expect markdown code block, always strip it
    let diagramRaw = this.currentDiagram || "";
    this.lastDiagram = diagramRaw;
    let diagram = diagramRaw.replace(/^```mermaid[\s\r\n]*/i, "");
    diagram = diagram.replace(/```$/i, "");
    // Remove all leading blank lines after code block
    diagram = diagram.replace(/^[\s\r\n]+/, "");
    diagram = diagram.trim();

    if (debugDiv) {
      debugDiv.textContent = diagram || "[Empty diagram string]";
    }
    console.log("Mermaid diagram string passed to render:", diagram);

    mermaidDiv.innerHTML = "";
    if (!diagram) {
      this.error = "Diagram string is empty.";
      if (debugDiv) debugDiv.textContent = this.error;
      return;
    }

    window.mermaid
      .render("graphDiv", diagram)
      .then(({ svg }) => {
        mermaidDiv.innerHTML = svg;
        this.error = undefined;
        console.log("Mermaid diagram rendered successfully");

        // Catch clicks on Nodes
        const mermaidSvg = this.template.querySelector(".mermaid svg");
        if (mermaidSvg) {
          this._applyMermaidZoom(mermaidSvg);
          this._decorateMermaidNodes(mermaidSvg);
          this._bindPullRequestPills(mermaidSvg);
          mermaidSvg.addEventListener("click", (event) => {
            if (this._suppressNextMermaidClick) {
              this._suppressNextMermaidClick = false;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            const target = event.target;
            const mermaidNode = target.closest("g.node");
            if (!mermaidNode) {
              return;
            }
            const targetId = mermaidNode.getAttribute("id") || "";
            const nodeIdentifier = this._extractNodeIdentifier(targetId);

            if (nodeIdentifier && nodeIdentifier.endsWith("Org")) {
              this.handleOpenOrgNode(nodeIdentifier);
              return;
            }

            // "+N more" group node -> modal with all PRs targeting that branch
            if (nodeIdentifier && nodeIdentifier.endsWith("FeaturesGroup")) {
              this.handleShowFeatureBranchGroup(nodeIdentifier);
              return;
            }

            if (nodeIdentifier && nodeIdentifier.endsWith("Branch")) {
              const branchName =
                this._resolveBranchNameFromNode(nodeIdentifier);
              this.handleShowBranchOrFeaturePRs(branchName);
            }
          });

          // Make the aggregated "+N more" links clickable (open the PR modal).
          this._bindFeatureGroupEdgeClicks(mermaidSvg);
        }

        // Apply animation classes to links with running/pending PRs
        // Find all edge paths and check if they need animation based on link styling
        setTimeout(() => this.applyLinkAnimations(), 100);
      })
      .catch((error) => {
        this.error = error?.message || "Mermaid rendering error";
        mermaidDiv.innerHTML = "";
        if (debugDiv) debugDiv.textContent = this.error + "\n" + diagram;
        console.error("Mermaid rendering error:", error);
      });
  }

  applyLinkAnimations() {
    // Apply CSS animations to any Mermaid link containing running/pending emojis
    // The key insight: edge labels and edge paths are in SEPARATE sibling groups
    // We need to match them by index position
    const mermaidSvg = this.template.querySelector(".mermaid svg");
    if (!mermaidSvg) {
      console.warn("Mermaid SVG not found for animation");
      return;
    }

    // Find the edgeLabels group (contains all edge label text)
    const edgeLabelsGroup = mermaidSvg.querySelector("g.edgeLabels");
    if (!edgeLabelsGroup) {
      console.warn("No edgeLabels group found");
      return;
    }

    // Find the edgePaths group (contains all edge path elements)
    const edgePathsGroup = mermaidSvg.querySelector("g.edgePaths");
    if (!edgePathsGroup) {
      console.warn("No edgePaths group found");
      return;
    }

    // Get all individual edge labels and paths
    const edgeLabels = edgeLabelsGroup.querySelectorAll("g.edgeLabel");
    const edgePaths = edgePathsGroup.querySelectorAll("path.flowchart-link");

    if (edgeLabels.length === 0 || edgePaths.length === 0) {
      console.warn("No edge labels or paths found");
      return;
    }

    if (edgeLabels.length !== edgePaths.length) {
      console.warn(
        `Mismatch: ${edgeLabels.length} labels but ${edgePaths.length} paths`,
      );
    }

    // Match labels to paths by index
    const maxIndex = Math.min(edgeLabels.length, edgePaths.length);

    for (let i = 0; i < maxIndex; i++) {
      const label = edgeLabels[i];
      const path = edgePaths[i];

      // Status is carried by the chip CSS classes emitted by the mermaid
      // builder (hardis-status-*); keep the legacy emoji check as fallback.
      const labelText = label.textContent || "";
      const hasRunning =
        !!label.querySelector(".hardis-status-running") ||
        labelText.includes("⚙️");
      const hasPending =
        !!label.querySelector(".hardis-status-pending") ||
        labelText.includes("⏳");

      if (hasRunning || hasPending) {
        // Apply the same animation class based on job status (running vs pending)
        // Both git PR jobs and deployment jobs use identical animations
        const animationClass = hasRunning
          ? "edge-animation-fast"
          : "edge-animation-slow";
        path.classList.add(animationClass);
        // Force browser to recognize the class change
        void path.offsetWidth;
      }
    }
  }

  // Bind a click handler on each aggregated "+N more" link so clicking it opens
  // the same PR modal as its group node. The group's edgeIndex matches the SVG
  // edge order (declaration order), the same index correspondence relied on by
  // applyLinkAnimations(). Only meaningful for the full diagram (feature
  // branches shown), where the group edges exist.
  _bindFeatureGroupEdgeClicks(mermaidSvg) {
    if (!this.displayFeatureBranches || !mermaidSvg) {
      return;
    }
    if (
      !this.featureBranchGroupsMap ||
      this.featureBranchGroupsMap.size === 0
    ) {
      return;
    }
    const edgePathsGroup = mermaidSvg.querySelector("g.edgePaths");
    const edgeLabelsGroup = mermaidSvg.querySelector("g.edgeLabels");
    if (!edgePathsGroup) {
      return;
    }
    const edgePaths = edgePathsGroup.querySelectorAll("path.flowchart-link");
    const edgeLabels = edgeLabelsGroup
      ? edgeLabelsGroup.querySelectorAll("g.edgeLabel")
      : [];
    for (const group of this.featureBranchGroupsMap.values()) {
      const idx = group.edgeIndex;
      if (typeof idx !== "number" || idx < 0 || idx >= edgePaths.length) {
        continue;
      }
      const bindClick = (element) => {
        if (!element) {
          return;
        }
        element.style.cursor = "pointer";
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.handleShowFeatureBranchGroup(group.nodeName);
        });
      };
      // The thin path is the primary target; the label gives a larger hit area.
      bindClick(edgePaths[idx]);
      if (idx < edgeLabels.length) {
        bindClick(edgeLabels[idx]);
      }
    }
  }

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "refreshPipeline":
        this.refreshPipeline();
        // A retried or closed action changes its status: reload it in the open modal
        if (this.showPRModal) {
          this._requestActionStatuses();
        }
        break;
      case "openPullRequestsUpdated":
        // allow dynamic updates from extension host
        this.openPullRequests = this._mapPrsWithIcons(data || []);
        setTimeout(() => this.adjustPrColumns(), 50);
        this._updatePanelTitle();
        break;
      case "returnGetPrInfoForModal":
        this.handleReturnGetPrInfoForModal(data);
        break;
      case "returnDeploymentActionStatuses":
        this.handleReturnDeploymentActionStatuses(data);
        break;
      case "returnSearchPullRequests":
        this.handleReturnSearchPullRequests(data);
        break;
      case "returnTicketDetails":
        this.handleReturnTicketDetails(data);
        break;
      case "customFunctionsLoaded":
        // The catalog of custom functions, read in the background after the pipeline
        this.customFunctions = Array.isArray(data) ? data : [];
        break;
      case "openPullRequestView":
        // A Pull Request link of another panel, while this panel is already loaded
        if (data?.prNumber > 0) {
          this.openPullRequestView({
            prNumber: data.prNumber,
            tab: data.tab || null,
          });
        }
        break;
      case "deploymentActionMarkDoneResult":
        this.handleDeploymentActionMarkDoneResult(data);
        break;
      case "returnDeploymentActionBackpromotes":
        this.handleReturnDeploymentActionBackpromotes(data);
        break;
      case "returnSchedulableClasses":
        this.handleReturnSchedulableClasses(data);
        break;
      case "returnBatchableClasses":
        this.handleReturnBatchableClasses(data);
        break;
      case "returnCommunities":
        this.handleReturnCommunities(data);
        break;
      case "returnGoLives":
        this.handleReturnGoLives(data);
        break;
      case "returnGoLivePullRequests":
        this.handleReturnGoLivePullRequests(data);
        break;
      default:
        console.log("Unknown message type:", messageType, data);
    }
  }

  handleLoadSchedulableClasses() {
    this.schedulableClassesLoading = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.schedulableClassesRequestId = requestId;
    window.sendMessageToVSCode({
      type: "loadSchedulableClasses",
      data: { requestId },
    });
  }

  handleReturnSchedulableClasses(data) {
    if (
      this.schedulableClassesRequestId &&
      data?.requestId &&
      data.requestId !== this.schedulableClassesRequestId
    ) {
      return;
    }
    this.projectSchedulableClasses = Array.isArray(data?.values)
      ? data.values
      : [];
    this.projectOnlySchedulableClasses = Array.isArray(data?.projectOnlyValues)
      ? data.projectOnlyValues
      : [];
    this.schedulableClassesLoading = false;
  }

  handleLoadBatchableClasses() {
    this.batchableClassesLoading = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.batchableClassesRequestId = requestId;
    window.sendMessageToVSCode({
      type: "loadBatchableClasses",
      data: { requestId },
    });
  }

  handleReturnBatchableClasses(data) {
    if (
      this.batchableClassesRequestId &&
      data?.requestId &&
      data.requestId !== this.batchableClassesRequestId
    ) {
      return;
    }
    this.projectBatchableClasses = Array.isArray(data?.values)
      ? data.values
      : [];
    this.projectOnlyBatchableClasses = Array.isArray(data?.projectOnlyValues)
      ? data.projectOnlyValues
      : [];
    this.batchableClassesLoading = false;
  }

  handleLoadCommunities() {
    this.communitiesLoading = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.communitiesRequestId = requestId;
    window.sendMessageToVSCode({
      type: "loadCommunities",
      data: { requestId },
    });
  }

  handleReturnCommunities(data) {
    if (
      this.communitiesRequestId &&
      data?.requestId &&
      data.requestId !== this.communitiesRequestId
    ) {
      return;
    }
    this.projectCommunities = Array.isArray(data?.values) ? data.values : [];
    this.communitiesLoading = false;
  }

  handleShowInstalledPackages() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: {
        command: "vscode-sfdx-hardis.showInstalledPackages",
        args: [],
      },
    });
  }

  handleRefresh() {
    this.refreshPipeline();
    // Reset auto-refresh timer when manually refreshed
    this._startAutoRefresh();
  }

  // Added refreshPipeline method
  refreshPipeline(isAutoRefresh = false) {
    this._isAutoRefresh = isAutoRefresh;
    // Manual refresh: overlay a spinner on the already-rendered diagram (keeping
    // it visible). If no diagram is shown yet, fall back to the full first-load
    // spinner. Auto-refresh (interval): keep current content visible, no spinner.
    if (!isAutoRefresh) {
      const hasDiagram = !!(
        this.pipelineData &&
        this.pipelineData.orgs &&
        this.pipelineData.orgs.length
      );
      if (hasDiagram) {
        this.mermaidRefreshing = true;
      } else {
        this.mermaidLoading = true;
      }
    }
    window.sendMessageToVSCode({
      type: "refreshPipeline",
      data: {},
    });
    console.log(
      "Pipeline refresh event dispatched",
      isAutoRefresh ? "(auto)" : "(manual)",
    );
  }

  // Quick action methods
  handleNewUserStory() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:work:new",
      },
    });
  }

  handlePullFromOrg() {
    // legacy: pull from org -> replaced by metadata retriever command
    window.sendMessageToVSCode({
      type: "showMetadataRetriever",
      data: {},
    });
  }

  handleOpenMetadataRetriever() {
    window.sendMessageToVSCode({
      type: "showMetadataRetriever",
      data: {},
    });
  }

  handleSaveUserStory() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:work:save",
      },
    });
  }

  handleBackpromote() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: {
        command: "vscode-sfdx-hardis.showBackpromote",
      },
    });
  }

  // Package XML handlers
  handleShowPackageXml() {
    window.sendMessageToVSCode({
      type: "showPackageXml",
      data: {
        packageType: "deploy",
        filePath: "manifest/package.xml",
        title: "Package XML - All Deployable Elements",
      },
    });
  }

  handleShowNoOverwrite() {
    window.sendMessageToVSCode({
      type: "showPackageXml",
      data: {
        packageType: "no-overwrite",
        filePath: "manifest/package-no-overwrite.xml",
        fallbackFilePath: "manifest/packageDeployOnce.xml",
        title: "No Overwrite Package - Protected Metadata",
      },
    });
  }

  handleShowDestructiveChanges() {
    window.sendMessageToVSCode({
      type: "showPackageXml",
      data: {
        packageType: "destructive",
        filePath: "manifest/destructiveChanges.xml",
        title: "Destructive Changes - Metadata to Delete",
      },
    });
  }

  handleGenerateDoraReport() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:doc:dora-report",
      },
    });
  }

  // Promotion branches (sfdx-hardis enablePromotionBranches): a major branch with a merge
  // target can be promoted story by story with hardis:project:promotion:create, the only
  // supported way to assemble a promotion branch
  get showCreatePromotionButton() {
    // Only the window of a major branch: the feature-branch modal and the "+N more" group modal
    // also run with modalMode "branch", and a promotion can only be assembled from a major branch
    // that has a merge target
    return (
      this.modalMode === "branch" &&
      !this.modalIsTopBranch &&
      !this.isFeaturePrModal &&
      this._isMajorBranchName(this.modalBranchName) &&
      this.hasBranchPullRequests &&
      this.pipelineData?.promotionBranches?.enabled === true &&
      this._isPromotionSourceAllowed(this.modalBranchName)
    );
  }

  // allowedPromotionSteps: the steps a release manager may assemble, from the sfdx-hardis
  // project config. sfdx-hardis requires the list to use the feature, so an empty one means
  // the project has not written it yet: the button stays, and the command answers with the
  // error that names the setting and links to the documentation. Hiding it there would leave
  // a release manager with a feature that is on and nothing to click.
  get _promotionAllowedSteps() {
    const steps = this.pipelineData?.promotionBranches?.allowedSteps;
    return Array.isArray(steps) ? steps : [];
  }

  // A promotion can start from this branch when a step names it as a source AND the target of
  // that step is reachable: a merge target of the branch, or any of them when the step leaves
  // the target out. A step whose target is not a merge target of its source cannot be resolved
  // by the command either, so offering it here would only lead to an error.
  _isPromotionSourceAllowed(branchName) {
    const steps = this._promotionAllowedSteps;
    if (steps.length === 0) {
      return true;
    }
    const source = (branchName || "").toLowerCase();
    const mergeTargets = this._mergeTargetsOf(branchName);
    return steps.some(
      (step) =>
        (step.source || "").toLowerCase() === source &&
        (!step.target || mergeTargets.includes(step.target.toLowerCase())),
    );
  }

  _mergeTargetsOf(branchName) {
    const source = (branchName || "").toLowerCase();
    return (this.pipelineData?.links || [])
      .filter(
        (link) =>
          link.type === "gitMerge" &&
          (link.source || "").toLowerCase() === source,
      )
      .map((link) => (link.target || "").toLowerCase());
  }

  // The targets allowed from a branch, when the steps name them. A step without a target
  // allows every merge target of the branch, so it contributes nothing here and the
  // command asks for the target itself.
  _allowedPromotionTargets(branchName) {
    const source = (branchName || "").toLowerCase();
    return this._promotionAllowedSteps
      .filter(
        (step) => (step.source || "").toLowerCase() === source && !!step.target,
      )
      .map((step) => step.target);
  }

  _isMajorBranchName(branchName) {
    const name = (branchName || "").toLowerCase();
    return this._majorBranchNames().includes(name);
  }

  get createPromotionLabel() {
    if (this.modalSelectedPrCount > 0) {
      return this.t("createPromotionFromBranchSelected", {
        branch: this.modalBranchName,
        count: this.modalSelectedPrCount,
      });
    }
    return this.t("createPromotionFromBranch", {
      branch: this.modalBranchName,
    });
  }

  get createPromotionTitle() {
    return this.t("createPromotionFromBranchHelp", {
      branch: this.modalBranchName,
    });
  }

  handleCreatePromotion() {
    // The ticked stories preselect the prompt of the command, the user confirms there
    const selection =
      this.modalSelectedPrNumbers.length > 0
        ? ` --pull-requests ${this.modalSelectedPrNumbers.join(",")}`
        : "";
    // A single allowed target leaves nothing to choose: pass it rather than prompt for it
    const allowedTargets = this._allowedPromotionTargets(this.modalBranchName);
    const target =
      allowedTargets.length === 1
        ? ` --target-branch ${allowedTargets[0]}`
        : "";
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: `sf hardis:project:promotion:create --source-branch ${this.modalBranchName}${target}${selection}`,
      },
    });
  }

  handlePreviewReleaseNotes() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: `sf hardis:doc:release-notes --mode prepare --source-branch ${this.modalBranchName}`,
      },
    });
  }

  handleGenerateReleaseNotes() {
    let command = `sf hardis:doc:release-notes --mode post --target-branch ${this.modalBranchName}`;
    // On a top branch, target the selected go-live merge commit so the notes
    // scope to that specific release instead of the whole branch.
    if (this.modalIsTopBranch && this.selectedGoLiveId) {
      command += ` --merge-commit ${this.selectedGoLiveId}`;
    }
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command },
    });
  }

  handleGitConnect() {
    if (this.gitAuthenticated) {
      // Already connected - prompt user for action
      window.sendMessageToVSCode({
        type: "promptGitProviderAction",
        data: {
          providerName: this.repoPlatformLabel || "Git",
          repoUrl: this.repoInfo?.webUrl || null,
        },
      });
    } else {
      // Not connected - initiate connection
      window.sendMessageToVSCode({
        type: "connectToGit",
        data: {},
      });
    }
  }

  handleTicketConnect() {
    if (this.ticketAuthenticated) {
      // Already connected - prompt user for action
      window.sendMessageToVSCode({
        type: "promptTicketProviderAction",
        data: {
          providerName: this.ticketProviderName || "Ticketing",
        },
      });
    } else {
      // Not connected - initiate connection
      window.sendMessageToVSCode({
        type: "connectToTicketing",
        data: {},
      });
    }
  }

  handleToggleFeatureBranches(event) {
    // Get the new state from the toggle
    this.displayFeatureBranches = event.target.checked;

    // Update VS Code configuration
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "pipelineDisplayFeatureBranches",
        value: this.displayFeatureBranches,
      },
    });

    // Switch diagram
    this.currentDiagram = this.displayFeatureBranches
      ? this.pipelineData.mermaidDiagram
      : this.pipelineData.mermaidDiagramMajor;

    // Re-render the diagram
    setTimeout(() => this.renderMermaid(), 0);

    console.log(
      "Feature branches display toggled:",
      this.displayFeatureBranches,
    );
  }

  _handleVisibilityChange() {
    this._isVisible = !document.hidden;
    console.log(
      "Pipeline visibility changed:",
      this._isVisible ? "visible" : "hidden",
    );
    // Restart timer with appropriate interval when visibility changes
    this._startAutoRefresh();
  }

  _startAutoRefresh() {
    // Clear existing timer
    this._stopAutoRefresh();

    // Only auto-refresh if git is authenticated
    if (!this.gitAuthenticated) {
      console.log("Auto-refresh disabled: git not authenticated");
      return;
    }

    // Set interval based on visibility: 1 minute if visible, 5 minutes if not
    const interval = this._isVisible ? 60000 : 600000; // 60s or 600s (10min)

    this._refreshTimer = setInterval(() => {
      console.log("Auto-refreshing pipeline (visible:", this._isVisible, ")");
      this.refreshPipeline(true);
    }, interval);

    console.log(
      `Auto-refresh started: ${interval / 1000}s interval (visible: ${this._isVisible})`,
    );
  }

  _stopAutoRefresh() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
      console.log("Auto-refresh stopped");
    }
  }

  _updatePanelTitle() {
    const prCount = this.openPullRequests ? this.openPullRequests.length : 0;
    const baseTitle = this.i18n.devOpsPipeline;
    const title = prCount > 0 ? `${baseTitle} (${prCount})` : baseTitle;

    window.sendMessageToVSCode({
      type: "updatePanelTitle",
      data: { title: title },
    });
  }

  // Route a branch node click: major branches open the branch PR modal; feature
  // branches (one PR each) open that PR directly in single-PR mode.
  handleShowBranchOrFeaturePRs(branchName) {
    const isMajorBranch =
      this.pipelineData &&
      Array.isArray(this.pipelineData.orgs) &&
      this.pipelineData.orgs.some((org) => org.name === branchName);
    if (isMajorBranch) {
      this.handleShowBranchPRs(branchName);
      return;
    }
    // Feature branch: find its pull request by source branch. The node name is a
    // sanitized form of the branch (slashes become underscores), so compare
    // against the sanitized source branch as well as the raw value.
    const pr = (this.openPullRequests || []).find(
      (pullRequest) =>
        pullRequest.sourceBranch === branchName ||
        this._sanitizeBranchName(pullRequest.sourceBranch) === branchName,
    );
    if (pr) {
      // The same Pull Request view as everywhere else, with its tickets, actions and runs
      this.openPullRequestView({ pr });
      return;
    }
    // Fallback: show the (possibly empty) branch modal.
    this.handleShowBranchPRs(branchName);
  }

  // Mirror of the backend sanitizeNodeName() so a feature node identifier can be
  // matched back to its pull request source branch.
  _sanitizeBranchName(branchName) {
    if (!branchName) {
      return "";
    }
    return branchName
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/-+/g, "-");
  }

  // Open a modal listing all pull requests targeting the branch behind a
  // "+N more" group node (both the folded and still-visible ones).
  handleShowFeatureBranchGroup(nodeIdentifier) {
    const group = this.featureBranchGroupsMap.get(nodeIdentifier);
    if (!group) {
      return;
    }
    this._resetPromotionModalState();
    this.modalMode = "branch";
    this.modalBranchName = group.targetBranch || "";
    this.showJobStatusColumn = true;
    this.isFeaturePrModal = true;
    // Group nodes are never top branches, so no go-lives selector.
    this.modalIsTopBranch = false;
    this.modalGoLives = [];
    this.selectedGoLiveId = "";
    this.modalGoLivePrsLoading = false;
    this.isLoadingReleaseDetails = false;
    this._populateModalFromPrs(group.pullRequests || []);
    this.modalActiveTabValue = "prs";
    this.showPRModal = true;
  }

  // Every promotion-related piece of modal state, cleared whenever a modal opens or closes: a
  // feature-branch or group modal must never inherit the source list or the ticked stories of the
  // branch window that was open before it
  _resetPromotionModalState() {
    this._modalStack = [];
    this._stackPushedForRequest = false;
    this.explorerMode = false;
    this.modalSourcePullRequests = [];
    this.modalSelectedPrIds = [];
    this.modalSelectedPrNumbers = [];
    this.modalShowPromotionPrs = false;
  }

  handleShowBranchPRs(branchName) {
    console.log("Showing PRs for branch:", branchName);
    this._resetPromotionModalState();
    this.modalBranchName = branchName;
    const prs = this._visibleBranchPullRequests(branchName);
    // Major branch PR lists (pending promotion / go-lives) don't show job status
    // and keep the tickets / deployment actions tabs.
    this.showJobStatusColumn = false;
    this.isFeaturePrModal = false;

    // Top branches (no merge target, e.g. main/prod) show their go-lives in a
    // selector. The PRs already loaded correspond to the latest go-live; the
    // selector and other go-lives are loaded lazily.
    this.modalIsTopBranch = this._topBranchNames.has(branchName);
    this.modalGoLives = [];
    this.selectedGoLiveId = "";
    this.modalGoLivePrsLoading = false;
    this.isLoadingReleaseDetails = false;
    if (this.modalIsTopBranch) {
      this._loadGoLives(branchName);
    }

    this._populateModalFromPrs(prs);
    this.modalActiveTabValue = "prs";
    this.showPRModal = true;
  }

  // The Pull Requests a branch still owns: the ones a promotion carried away are listed in the
  // branch they reached instead (see _filterModalPullRequests)
  _visibleBranchPullRequests(branchName) {
    this.modalSourcePullRequests =
      this.branchPullRequestsMap.get(branchName) || [];
    return this._filterModalPullRequests(this.modalSourcePullRequests);
  }

  // Every list shown in a branch modal goes through here, whatever its origin (branch window or
  // selected go-live): a story a promotion carried away is listed in the branch it reached only,
  // and the vehicles toggle applies the same way to both
  _filterModalPullRequests(pullRequests) {
    let prs = Array.isArray(pullRequests) ? pullRequests : [];
    prs = prs.filter((pr) => pr.promotedAway !== true);
    if (!this.modalShowPromotionPrs) {
      prs = prs.filter((pr) => !this._isPromotionOrMajorPr(pr));
    }
    return prs;
  }

  _majorBranchNames() {
    return (this.pipelineData?.orgs || [])
      .map((org) => (org.name || "").toLowerCase())
      .filter(Boolean);
  }

  // A Pull Request that moves other Pull Requests rather than carrying work of its own: a merge
  // between two major branches, or a promotion. Retrofit, feature, fix and every other branch type
  // carry their own change and stay listed.
  // Same rule as utils/pipeline/promotionBranchUtils.ts isVehiclePullRequest.
  _isPromotionOrMajorPr(pr) {
    const source = (pr.sourceBranch || "").toLowerCase();
    const target = (pr.targetBranch || "").toLowerCase();
    // A merge between two major branches is plumbing in every pipeline, promotion branches or not
    const majors = this._majorBranchNames();
    if (majors.includes(source) && majors.includes(target)) {
      return true;
    }
    // A backpromote/<parent>/<sandbox> branch carries a sandbox merge, never a story
    if (/^backpromote\/.+\/[^/]+$/.test(source)) {
      return true;
    }
    // A promotion only exists as such when the project enabled the feature: without it, a
    // promotion/ branch is an ordinary branch, exactly as the deployment jobs treat it
    if (this.pipelineData?.promotionBranches?.enabled !== true) {
      return false;
    }
    if (pr.isPromotion === true) {
      return true;
    }
    // <YYYY-MM-DD>-<HHMM> where HHMM is a time of day, with -<n> when the name was taken,
    // or the <YYYY-MM-DD>-<counter> names of the first releases (no second counter then)
    return /^promotion\/[^/]+\/[^/]+\/\d{4}-\d{2}-\d{2}-(?:([01]\d|2[0-3])[0-5]\d(?:-\d+)?|\d+)$/.test(
      source,
    );
  }

  // The toggle only shows when the current view holds something to reveal
  get modalHasPromotionPrs() {
    if (this.modalMode !== "branch" || !this.modalBranchName) {
      return false;
    }
    return (this.modalSourcePullRequests || []).some((pr) =>
      this._isPromotionOrMajorPr(pr),
    );
  }

  handleToggleModalPromotionPrs(event) {
    this.modalShowPromotionPrs = event.target.checked;
    this.modalSelectedPrIds = [];
    this.modalSelectedPrNumbers = [];
    this._populateModalFromPrs(
      this._filterModalPullRequests(this.modalSourcePullRequests),
    );
  }

  // Stories that can be ticked for the next promotion from this branch: merged into the branch
  // itself (a story brought here by a promotion is promoted through that promotion), not yet
  // carried away, and not a vehicle
  _isSelectableForPromotion(pr) {
    // A branch window holds the stories merged into the branch AND the ones that arrived through
    // its child branches (a story merged into integration reaches uat through the integration ->
    // uat merge, and is waiting in uat for the next promotion). Testing targetBranch against the
    // modal branch would leave nothing selectable on any branch that has children.
    return (
      pr.promotedAway !== true &&
      !this._isPromotionOrMajorPr(pr) &&
      typeof pr.number === "number" &&
      pr.number > 0
    );
  }

  // The checkboxes exist to feed the promotion: they go away with the button, so a branch the
  // project does not allow a promotion from offers nothing to tick either
  get modalHideCheckboxColumn() {
    return !this.showCreatePromotionButton;
  }

  get modalSelectedPrCount() {
    return this.modalSelectedPrNumbers.length;
  }

  get promotionSelectionHint() {
    return this.t("promotionSelectionHint");
  }

  handleModalRowSelection(event) {
    const rows = (event.detail && event.detail.selectedRows) || [];
    const eligible = rows.filter((row) => this._isSelectableForPromotion(row));
    this.modalSelectedPrIds = eligible.map((row) => row.id);
    this.modalSelectedPrNumbers = eligible.map((row) => row.number);
  }

  // Builds the modal content (PR list, tickets, actions, Apex tests by line)
  // from a list of pull requests. Shared by branch open and go-live selection.
  _populateModalFromPrs(prs) {
    const pullRequests = Array.isArray(prs) ? prs : [];
    this.modalPullRequests = this._mapPrsWithIcons(pullRequests);
    // Aggregate all tickets from all PRs
    this.modalTickets = this._aggregateTicketsFromPRs(pullRequests);
    this._requestTicketDetails(pullRequests);

    // Aggregate all deployment actions from all PRs
    this.modalActions = this._aggregateActionsFromPRs(pullRequests);
    this._resetActionFilters();
    this.actionForecast = null;
    this.actionForecastLoading = false;
    this._requestActionStatuses();

    // Per-line breakdown for Apex tests (read-only in branch mode)
    const rows = [];
    for (const pr of pullRequests) {
      const classes =
        pr &&
        pr.deploymentApexTestClasses &&
        Array.isArray(pr.deploymentApexTestClasses)
          ? pr.deploymentApexTestClasses
          : [];

      const normalized = this.normalizeApexTestClasses(classes);

      for (const apexTestClass of normalized) {
        rows.push({
          id: `apexTests-${pr.number || pr.id || "pr"}-${apexTestClass}`,
          prLabel: `#${pr.number || ""} - ${pr.title || ""}`,
          prWebUrl: pr.webUrl || "",
          prNumber: pr.number,
          apexTestClass: apexTestClass,
        });
      }
    }

    // stable order by class then PR number
    rows.sort((a, b) => {
      const classCmp = (a.apexTestClass || "").localeCompare(
        b.apexTestClass || "",
      );
      if (classCmp !== 0) {
        return classCmp;
      }

      const aNum = parseInt((a.prLabel || "").replace(/^#(\d+).*/, "$1"));
      const bNum = parseInt((b.prLabel || "").replace(/^#(\d+).*/, "$1"));
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      return (a.prLabel || "").localeCompare(b.prLabel || "");
    });

    this.apexTestsByLineRows = rows;
    this.deploymentApexTestClasses = [];
    this._deploymentApexTestClassesOriginal = [];
    this.apexTestsMode = "view";
  }

  // A window always opens with every Total pill on
  _resetActionFilters() {
    this.hiddenActionStatusKeys = [];
    this.hiddenActionForecastKeys = [];
  }

  // --- Go-lives selector (top branches) ---

  _loadGoLives(branchName) {
    this.modalGoLivesLoading = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._goLivesRequestId = requestId;
    window.sendMessageToVSCode({
      type: "loadGoLives",
      data: { requestId, branchName },
    });
  }

  handleReturnGoLives(data) {
    if (
      this._goLivesRequestId &&
      data?.requestId &&
      data.requestId !== this._goLivesRequestId
    ) {
      return;
    }
    // Ignore stale responses for a branch the modal no longer shows
    if (data?.branchName && data.branchName !== this.modalBranchName) {
      return;
    }
    const goLives = Array.isArray(data?.goLives) ? data.goLives : [];
    this.modalGoLives = goLives.map((g) => ({
      label: this._formatGoLiveLabel(g),
      value: g.id,
    }));
    // Preselect the latest go-live (its PRs are already displayed)
    if (this.modalGoLives.length > 0 && !this.selectedGoLiveId) {
      this.selectedGoLiveId = this.modalGoLives[0].value;
    }
    this.modalGoLivesLoading = false;
  }

  _formatGoLiveLabel(goLive) {
    const date = goLive?.mergeDate
      ? new Date(goLive.mergeDate).toLocaleDateString()
      : "";
    const prPart = goLive?.prNumber ? `#${goLive.prNumber}` : "";
    const title = goLive?.title || "";
    return [date, prPart, title].filter(Boolean).join(" - ");
  }

  // Combobox options for the go-lives selector.
  // While the list is still loading, returns a single disabled placeholder.
  // Once loaded, returns the real list.
  get goLivesComboboxOptions() {
    if (this.modalGoLivesLoading) {
      return [{ label: this.i18n.loadingReleases, value: "__loading__" }];
    }
    return this.modalGoLives;
  }

  // The combobox is disabled while the go-lives list is loading or while a
  // selected release is being loaded (to prevent double-clicks mid-flight).
  get isGoLivesComboboxDisabled() {
    return this.modalGoLivesLoading || this.isLoadingReleaseDetails;
  }

  handleGoLiveChange(event) {
    const mergeCommitId = event.detail.value;
    if (
      !mergeCommitId ||
      mergeCommitId === this.selectedGoLiveId ||
      mergeCommitId === "__loading__"
    ) {
      return;
    }
    this.selectedGoLiveId = mergeCommitId;
    this.isLoadingReleaseDetails = true;
    this.modalGoLivePrsLoading = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._goLivePrsRequestId = requestId;
    window.sendMessageToVSCode({
      type: "loadGoLivePullRequests",
      data: {
        requestId,
        branchName: this.modalBranchName,
        mergeCommitId,
      },
    });
  }

  handleReturnGoLivePullRequests(data) {
    if (
      this._goLivePrsRequestId &&
      data?.requestId &&
      data.requestId !== this._goLivePrsRequestId
    ) {
      return;
    }
    // Ignore responses for a selection/branch that is no longer current
    if (
      (data?.branchName && data.branchName !== this.modalBranchName) ||
      (data?.mergeCommitId && data.mergeCommitId !== this.selectedGoLiveId)
    ) {
      return;
    }
    // The go-live list is a view of the same branch modal: the toggles apply to it too
    this.modalSourcePullRequests = data?.pullRequests || [];
    this._populateModalFromPrs(
      this._filterModalPullRequests(this.modalSourcePullRequests),
    );
    this.modalGoLivePrsLoading = false;
    this.isLoadingReleaseDetails = false;
  }

  handleOpenOrgNode(nodeIdentifier) {
    const org = this._findOrgByNodeName(nodeIdentifier);
    if (!org) {
      return;
    }
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({
        type: "openOrg",
        data: {
          branchName: org.name,
          alias: org.alias,
          instanceUrl: org.instanceUrl,
          nodeName: nodeIdentifier,
        },
      });
    }
  }

  _findOrgByNodeName(nodeIdentifier) {
    if (!this.pipelineData || !Array.isArray(this.pipelineData.orgs)) {
      return null;
    }
    return (
      this.pipelineData.orgs.find((org) => org.nodeName === nodeIdentifier) ||
      null
    );
  }

  _resolveBranchNameFromNode(nodeIdentifier) {
    const sanitizedBranch = nodeIdentifier.replace(/(Branch|Org)$/i, "");
    const orgMatch = this._findOrgByNodeName(`${sanitizedBranch}Org`);
    if (orgMatch && orgMatch.name) {
      return orgMatch.name;
    }
    return sanitizedBranch;
  }

  _extractNodeIdentifier(nodeId) {
    if (!nodeId) {
      return "";
    }
    // Mermaid >=11.x prefixes node IDs with the graph id passed to render()
    // (e.g. "graphDiv-flowchart-preprodBranch-9"). Strip everything up to and
    // including "flowchart-" so we always get the original node name.
    return nodeId.replace(/^.*flowchart-/, "").replace(/-\d+$/, "");
  }

  _decorateMermaidNodes(mermaidSvg) {
    if (!mermaidSvg) {
      return;
    }
    const nodes = mermaidSvg.querySelectorAll("g.node");
    const svgScale = this._getMermaidEffectiveScale(mermaidSvg);
    nodes.forEach((node) => {
      node.style.cursor = "pointer";
      node.setAttribute("tabindex", "0");
      this._drawNodeCountBubble(node, svgScale);
    });
  }

  // Effective on-screen scale of the mermaid SVG: _applyMermaidZoom shrinks
  // the whole SVG to fit the viewport (typically 0.5-0.8x on real pipelines),
  // so anything drawn in SVG units must compensate to stay readable.
  _getMermaidEffectiveScale(mermaidSvg) {
    try {
      const viewBox = mermaidSvg.viewBox && mermaidSvg.viewBox.baseVal;
      const styledWidth = parseFloat(mermaidSvg.style.width);
      if (viewBox && viewBox.width > 0 && styledWidth > 0) {
        return styledWidth / viewBox.width;
      }
    } catch (e) {
      // fall through to neutral scale
    }
    return 1;
  }

  // Draw the open-PR counter of a branch node as a notification-style bubble
  // half inside / half outside the node's top-right corner. The count travels
  // as a hidden ".hardis-node-count" marker in the HTML label (emitted by
  // BranchStrategyMermaidBuilder): it cannot be shown in the label itself
  // because foreignObject clips any HTML overflowing the label box, while SVG
  // elements appended to the node group are not clipped.
  _drawNodeCountBubble(node, svgScale) {
    const marker = node.querySelector(".hardis-node-count");
    if (!marker) {
      return;
    }
    const count = marker.getAttribute("data-count");
    if (!count || count === "0" || node.querySelector(".hardis-count-bubble")) {
      return;
    }
    const shape = node.querySelector("rect, polygon, path");
    if (!shape || typeof shape.getBBox !== "function") {
      return;
    }
    let box;
    try {
      box = shape.getBBox();
    } catch (e) {
      return;
    }
    const SVG_NS = "http://www.w3.org/2000/svg";
    // Target ON-SCREEN size converted to SVG units: the whole SVG is scaled
    // down to fit the viewport, so the badge is drawn 1/scale larger to still
    // measure ~17px on screen (clamped so it never becomes gigantic).
    const unit = 1 / Math.min(Math.max(svgScale || 1, 0.35), 1);
    const height = Math.round(17 * unit);
    const fontSize = Math.round(11.5 * unit);
    const width = Math.max(
      height,
      Math.round((9 + 7 * String(count).length) * unit),
    );
    const ringWidth = Math.max(1, 1.25 * unit);
    // The badge is styled ENTIRELY inline (style attribute), and every paint
    // property is set explicitly: mermaid compiles classDefs into
    // "#id .gitMajor>*{stroke:...!important}" rules that hit this group (a
    // direct child of the node), so without an explicit inline stroke:none
    // the numeral glyphs get outlined in the node border color and become
    // unreadable. Inline styles also make the badge immune to stale cached
    // stylesheets, and the explicit font stack avoids mermaid's default
    // trebuchet ms.
    // Look: white pill / navy numeral / blue hairline + soft shadow (light),
    // dark surface pill / bright hairline (dark) - separates cleanly from
    // both the node fill and the page background instead of competing with
    // the node blues.
    const isDark = this.colorTheme === "dark";
    const pillFill = isDark ? "#101720" : "#ffffff";
    const pillStroke = isDark ? "#57a3fd" : "#0176d3";
    const numColor = isDark ? "#eaf3ff" : "#032d60";
    const shadow = isDark
      ? `drop-shadow(0 ${1 * unit}px ${1.5 * unit}px rgba(0,0,0,0.5))`
      : `drop-shadow(0 ${1 * unit}px ${1.5 * unit}px rgba(3,45,96,0.35))`;
    const fontFamily =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
    // Bubble centered on the node's top-right corner (coordinates are local
    // to the node group, which mermaid translates to the node center).
    // Exact float geometry: the SVG is CSS-scaled anyway, so rounding to
    // integer SVG units cannot produce pixel alignment and only introduces
    // pill/numeral centering asymmetry.
    const cornerX = box.x + box.width;
    const cornerY = box.y;
    const bubble = document.createElementNS(SVG_NS, "g");
    bubble.setAttribute("class", "hardis-count-bubble");
    const pill = document.createElementNS(SVG_NS, "rect");
    pill.setAttribute("x", String(cornerX - width / 2));
    pill.setAttribute("y", String(cornerY - height / 2));
    pill.setAttribute("width", String(width));
    pill.setAttribute("height", String(height));
    pill.setAttribute("rx", String(height / 2));
    pill.setAttribute(
      "style",
      `fill:${pillFill};stroke:${pillStroke};stroke-width:${ringWidth}px;stroke-dasharray:none;filter:${shadow};`,
    );
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(cornerX));
    text.setAttribute("y", String(cornerY));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute(
      "style",
      `fill:${numColor};stroke:none;font-family:${fontFamily};font-size:${fontSize}px;font-weight:700;font-variant-numeric:tabular-nums;`,
    );
    text.textContent = count;
    bubble.appendChild(pill);
    bubble.appendChild(text);
    node.appendChild(bubble);
    // Optical centering: dominant-baseline centers the em box, not the digit
    // outlines. Measure the rendered glyphs and shift so the glyph bounding
    // box is exactly centered on the pill (both axes).
    try {
      const glyphBox = text.getBBox();
      if (glyphBox && glyphBox.height > 0) {
        const shiftY = cornerY - (glyphBox.y + glyphBox.height / 2);
        const shiftX = cornerX - (glyphBox.x + glyphBox.width / 2);
        text.setAttribute("y", String(cornerY + shiftY));
        text.setAttribute("x", String(cornerX + shiftX));
      }
    } catch (e) {
      // keep baseline-centered position
    }
  }

  // ---- Pull Request view: one entry point, a way back, the explorer ----

  // Toolbar button: the modal with a lookup on top, and nothing below until a Pull Request is picked
  handleOpenExplorer() {
    this._resetPromotionModalState();
    applyModalState(this, null);
    this.modalMode = "singlePR";
    this.explorerMode = true;
    this.prViewLoading = false;
    this.showPRModal = true;
    // The lookup only exists once the modal is rendered
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      const lookup = this.template.querySelector("s-pull-request-lookup");
      if (lookup) {
        lookup.focusInput();
      }
    }, 0);
  }

  /**
   * Every way to open one Pull Request goes through here: the My Pull Request card, the Open Pull
   * Requests tab, a feature branch of the diagram, the explorer, and any reference to a Pull
   * Request inside a window.
   * - pr: the Pull Request when the panel already holds it, else prNumber and it is read first
   * - keepStack: opened from a window that must be there again on the way back
   */
  openPullRequestView({ pr = null, prNumber = null, tab = null, keepStack = false }) {
    const number = pr?.number ?? prNumber;
    if (!pr && !(number > 0)) {
      return;
    }
    const current = this.modalPullRequests[0];
    if (
      this.showPRModal &&
      this.modalMode === "singlePR" &&
      current &&
      current.number === number &&
      number > 0
    ) {
      // Already on screen: only the tab asked for changes, whether it came with this call or
      // was set aside by a deep link
      const wantedTab = tab || this._nextModalTab;
      this._nextModalTab = null;
      if (wantedTab) {
        this._showModalTab(wantedTab);
      }
      return;
    }
    // A request still on its way is replaced: the window it had put aside is not put aside twice
    if (this._stackPushedForRequest) {
      this._modalStack = this._modalStack.slice(0, -1);
    }
    this._stackPushedForRequest = false;
    if (this.showPRModal && keepStack && this.modalPullRequests.length > 0) {
      this._modalStack = [
        ...this._modalStack,
        { label: this.modalCrumbLabel, state: captureModalState(this) },
      ];
      this._stackPushedForRequest = true;
    }
    // The breadcrumb is only emptied once the Pull Request is there: a number that does not
    // exist leaves the window on screen with its way back
    this._clearStackOnAnswer = !keepStack;
    if (tab) {
      this._nextModalTab = tab;
    }
    this.prViewLoading = this.showPRModal;
    this._prViewRequestId += 1;
    window.sendMessageToVSCode({
      type: "getPrInfoForModal",
      data: {
        requestId: this._prViewRequestId,
        ...(pr
          ? { pullRequest: JSON.parse(JSON.stringify(pr)) }
          : { prNumber: number }),
      },
    });
  }

  // Name of the window currently shown, as the breadcrumb will call it once it is left
  get modalCrumbLabel() {
    if (this.modalMode === "singlePR") {
      const pr = this.modalPullRequests[0];
      return pr && pr.number > 0 ? `#${pr.number}` : this.modalTitle;
    }
    return `${this.modalTitlePrefix} ${this.modalBranchName} (${this.modalPrCount})`;
  }

  get modalHasBack() {
    return this._modalStack.length > 0;
  }

  get modalBreadcrumb() {
    return this._modalStack.map((entry, index) => ({
      key: `crumb-${index}`,
      index,
      label: entry.label,
      title: this.t("prViewBackTo", { label: entry.label }),
    }));
  }

  // Back to a window of the breadcrumb, as it was left: nothing is read again
  handleModalBack(event) {
    this._goBackTo(parseInt(event.currentTarget.dataset.index, 10));
  }

  // Previous button: the window shown just before this one
  handleModalPrevious() {
    this._goBackTo(this._modalStack.length - 1);
  }

  get previousTitle() {
    const entry = this._modalStack[this._modalStack.length - 1];
    return entry ? this.t("prViewBackTo", { label: entry.label }) : "";
  }

  _goBackTo(index) {
    const entry = this._modalStack[index];
    if (!entry) {
      return;
    }
    this._modalStack = this._modalStack.slice(0, index);
    this._stackPushedForRequest = false;
    this._clearStackOnAnswer = false;
    // A Pull Request still being read must not replace the window the user came back to
    this._prViewRequestId += 1;
    this.prViewLoading = false;
    applyModalState(this, entry.state);
    // Answers on their way belong to the window that was just left: none is waited for, and
    // what the restored window still misses is asked again
    resetModalLoadingFlags(this);
    this.actionStatusRequestId += 1;
    if (
      this.modalActions.length > 0 &&
      (this.modalActionStatuses === null ||
        (this.promotionMode && !this.actionForecast))
    ) {
      this._requestActionStatuses();
    }
    if (this.modalIsTopBranch && this.modalGoLives.length === 0) {
      this._loadGoLives(this.modalBranchName);
    }
    this._requestTicketDetails(this.modalPullRequests);
    this._showModalTab(entry.state.modalActiveTabValue);
  }

  // The tab the user is on, recorded so a window comes back on it
  handleModalTabActive(event) {
    const value = event.target?.value;
    if (value) {
      this.modalActiveTabValue = value;
    }
  }

  // lightning-tabset only follows a change of its active tab once its tabs are rendered: the
  // value is cleared, then set again after the render
  _showModalTab(value) {
    this.modalActiveTabValue = "";
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      this.modalActiveTabValue = value || "";
    }, 0);
  }

  get showExplorerLookup() {
    return this.explorerMode;
  }

  // Explorer just opened: no Pull Request picked yet
  get showExplorerEmpty() {
    return (
      this.explorerMode &&
      this.modalPullRequests.length === 0 &&
      !this.prViewLoading
    );
  }

  get showModalTabs() {
    return !this.showExplorerEmpty && !this.prViewLoading;
  }

  // Everything the panel already holds: the open Pull Requests and the windows of the branches
  get lookupLoadedPullRequests() {
    const all = [...(this.openPullRequests || [])];
    for (const prs of this.branchPullRequestsMap.values()) {
      all.push(...(prs || []));
    }
    return all;
  }

  handleLookupSearch(event) {
    window.sendMessageToVSCode({
      type: "searchPullRequests",
      data: {
        query: event.detail.query,
        requestId: event.detail.requestId,
      },
    });
  }

  handleReturnSearchPullRequests(data) {
    const lookup = this.template.querySelector("s-pull-request-lookup");
    if (lookup && data) {
      lookup.setRemoteResults(data.requestId, data);
    }
  }

  handleLookupSelect(event) {
    this.openPullRequestView({
      pr: event.detail.pullRequest,
      prNumber: event.detail.prNumber,
    });
  }

  // A reference to a Pull Request inside a window (ticket, workflow run, journey step)
  handleOpenPullRequestRef(event) {
    this.openPullRequestView({
      prNumber: event.detail.prNumber,
      keepStack: true,
    });
  }

  // Number or title of a row of the Pull Requests tab of a window
  handleModalPrRowAction(event) {
    const row = event.detail.row;
    if (event.detail.action?.name !== "view_pr" || !row) {
      return;
    }
    if (row.number > 0 && row.title !== undefined) {
      this.openPullRequestView({ pr: row, keepStack: true });
    } else if (row.prNumber > 0) {
      this.openPullRequestView({ prNumber: row.prNumber, keepStack: true });
    }
  }

  // Header of a group of the Deployment Actions tab
  handleActionGroupPrClick(event) {
    event.preventDefault();
    const prNumber = parseInt(event.currentTarget.dataset.prNumber, 10);
    if (prNumber > 0) {
      this.openPullRequestView({ prNumber, keepStack: true });
    }
  }

  // The Pull Request pills of the diagram open the Pull Request in the panel. Ctrl or Cmd click
  // keeps opening it on the git provider.
  _bindPullRequestPills(mermaidSvg) {
    const byUrl = new Map();
    for (const pr of this.lookupLoadedPullRequests) {
      if (pr && pr.webUrl && pr.number > 0) {
        byUrl.set(pr.webUrl, pr);
      }
    }
    for (const link of mermaidSvg.querySelectorAll("a[href]")) {
      const pr = byUrl.get(link.getAttribute("href"));
      if (!pr) {
        continue;
      }
      link.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        // The diagram was dragged by this pill: the click that ends the drag opens nothing
        if (this._suppressNextMermaidClick) {
          this._suppressNextMermaidClick = false;
          return;
        }
        this.openPullRequestView({ pr });
      });
    }
  }

  // The Pull Request of the checked out branch, or the draft of a branch without one: the only
  // ones whose actions file belongs to the branch it is written in
  get isOwnPullRequest() {
    const pr = this.modalPullRequests[0];
    if (!pr) {
      return false;
    }
    return (
      pr.number === -1 || pr.number === this.currentBranchPullRequest?.number
    );
  }

  get showNotOwnPrNote() {
    return this.isSinglePRMode && !this.modalIsMajorPr && !this.isOwnPullRequest;
  }

  // Shown while the test classes of such a Pull Request are being edited, never while reading
  get showNotOwnPrEditNote() {
    return this.showNotOwnPrNote && this.isApexTestsEditMode;
  }

  // Sent with a change of such a Pull Request, so the extension warns once it is written
  get notOwnPrWarning() {
    if (!this.showNotOwnPrNote) {
      return "";
    }
    return [this.notOwnPrNote, this.alreadyDoneNote].filter(Boolean).join(" ");
  }

  get notOwnPrNote() {
    const branch = this.modalCheckout?.branch || "";
    return branch
      ? this.t("prViewNotYourBranch", { prLabel: this.prLabel, branch })
      : this.t("prViewNotYourBranchNoName", { prLabel: this.prLabel });
  }

  // On a story already deployed, a changed action does not run again where it is done
  get alreadyDoneNote() {
    const pr = this.modalPullRequests[0];
    if (!this.showNotOwnPrNote || !pr || pr.state !== "merged") {
      return "";
    }
    const entries = this.modalActionStatuses?.[String(pr.number)] || [];
    const orgs = [
      ...new Set(
        entries
          .filter((entry) => entry.status === "success")
          .map((entry) => entry.orgBranch)
          .filter(
            (orgBranch) => orgBranch && orgBranch !== DEV_SANDBOXES_BRANCH,
          ),
      ),
    ];
    return orgs.length > 0
      ? this.t("prViewAlreadyDoneIn", { orgs: orgs.join(", ") })
      : "";
  }

  get showCheckoutBehindNote() {
    return this.isSinglePRMode && this.modalCheckout?.behindOrigin === true;
  }

  get checkoutBehindNote() {
    return this.t("prViewCheckoutBehind", {
      branch: this.modalCheckout?.branch || "",
    });
  }

  get singlePullRequest() {
    return this.isSinglePRMode ? this.modalPullRequests[0] : null;
  }

  get singlePullRequestNumber() {
    return this.singlePullRequest?.number;
  }

  // Where the Pull Request stands in the pipeline, from what the panel already knows
  get modalJourney() {
    const pr = this.singlePullRequest;
    if (!pr) {
      return [];
    }
    const windows = {};
    for (const [branch, prs] of this.branchPullRequestsMap) {
      windows[branch] = (prs || [])
        .filter((item) => item.promotedAway !== true)
        .map((item) => item.number);
    }
    return buildPullRequestJourney({
      pr,
      orgs: this.pipelineData?.orgs || [],
      windows,
      statuses: this.modalActionStatuses?.[String(pr.number)] || [],
      workflows: this.modalWorkflows || [],
    });
  }

  // The Validation, Deployment and MegaLinter tabs show the comments of the Pull Request itself,
  // never the ones of a Pull Request that carried it to another branch
  get workflowPrNumbers() {
    const pr = this.singlePullRequest;
    return pr && pr.number > 0 ? [pr.number] : [];
  }

  get showWorkflowsTab() {
    return (
      this.isSinglePRMode &&
      this.workflowPrNumbers.length > 0 &&
      !this.workflowsUnavailable
    );
  }

  get workflowsLoading() {
    return this.modalWorkflows === null;
  }

  _workflowRunsOfKind(kind) {
    return (this.modalWorkflows || []).filter((run) => run.kind === kind);
  }

  get modalValidationRuns() {
    return this._workflowRunsOfKind("validation");
  }

  get modalDeploymentRuns() {
    return this._workflowRunsOfKind("deployment");
  }

  get modalMegaLinterRuns() {
    return this._workflowRunsOfKind("megalinter");
  }

  get noValidationLabel() {
    return this.t("workflowNoValidation", { prLabel: this.prLabel });
  }

  get noDeploymentLabel() {
    return this.t("workflowNoDeployment", { prLabel: this.prLabel });
  }

  get noMegaLinterLabel() {
    return this.t("workflowNoMegaLinter", { prLabel: this.prLabel });
  }

  // General tab: the description of the Pull Request, as written on the git provider, without
  // the line sfdx-hardis adds to jump to its comments: the tabs of this window replace it
  get singlePullRequestDescription() {
    return String(this.singlePullRequest?.description || "")
      .replace(
        /<!-- sfdx-hardis nav-start -->[\s\S]*?<!-- sfdx-hardis nav-end -->/g,
        "",
      )
      .trim();
  }

  // The outcome of the validation and of the deployments is still being read
  get journeyLoading() {
    return (
      this.workflowPrNumbers.length > 0 &&
      !this.workflowsUnavailable &&
      this.modalWorkflows === null
    );
  }

  // Subject, status and assignee of the tickets are read when a window shows them, not with the
  // diagram: one call to the ticketing tool per ticket is too slow to wait for on every load
  _requestTicketDetails(pullRequests) {
    this._ticketSourcePrs = Array.isArray(pullRequests) ? pullRequests : [];
    const pending = new Map();
    for (const pr of this._ticketSourcePrs) {
      for (const ticket of pr.relatedTickets || []) {
        if (ticket?.id && ticket.detailsLoaded !== true && !ticket.subject) {
          pending.set(ticket.id, ticket);
        }
      }
    }
    // An answer on its way belongs to the window shown before
    this._ticketDetailsRequestId += 1;
    this._ticketRequestedIds = [...pending.keys()];
    if (!this.ticketAuthenticated || pending.size === 0) {
      this.ticketDetailsLoading = false;
      return;
    }
    this.ticketDetailsLoading = true;
    window.sendMessageToVSCode({
      type: "loadTicketDetails",
      data: {
        requestId: this._ticketDetailsRequestId,
        tickets: JSON.parse(JSON.stringify([...pending.values()])),
      },
    });
  }

  handleReturnTicketDetails(data) {
    if (!data || data.requestId !== this._ticketDetailsRequestId) {
      return;
    }
    this.ticketDetailsLoading = false;
    const detailsById = new Map(
      (data.tickets || []).map((ticket) => [ticket.id, ticket]),
    );
    const requested = new Set(this._ticketRequestedIds);
    // The same ticket object is listed by every window that names it: completed once, it is
    // complete everywhere, and it is not asked again in this session
    for (const pr of [
      ...this._ticketSourcePrs,
      ...this.lookupLoadedPullRequests,
    ]) {
      for (const ticket of pr.relatedTickets || []) {
        if (!ticket || !requested.has(ticket.id)) {
          continue;
        }
        const details = detailsById.get(ticket.id);
        // A ticket that came back without details is asked again next time
        if (details && details.subject) {
          Object.assign(ticket, details, { detailsLoaded: true });
        }
      }
    }
    this.modalTickets = this._aggregateTicketsFromPRs(this._ticketSourcePrs);
  }

  get noDescriptionLabel() {
    return this.t("prNoDescription", { prLabel: this.prLabel });
  }

  get showTicketPullRequests() {
    return this.modalMode !== "singlePR";
  }

  handleClosePRModal() {
    // Opened from another window (a list of Pull Requests, another Pull Request): closing it
    // brings that window back, as the Previous button does
    if (this._modalStack.length > 0) {
      this._goBackTo(this._modalStack.length - 1);
      return;
    }
    this.showPRModal = false;
    this._resetPromotionModalState();
    // Every field of the modal goes back to its default: see MODAL_STATE_DEFAULTS
    applyModalState(this, null);
    resetModalLoadingFlags(this);
    this.explorerMode = false;
    this.prViewLoading = false;
    // A Pull Request still being read must not open the window again
    this._prViewRequestId += 1;
    this._clearStackOnAnswer = false;
    this._goLivesRequestId = null;
    this._goLivePrsRequestId = null;
  }

  handlePRRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;

    if (action.name === "view_pr" && row) {
      // Find the full PR object
      const pr = this.openPullRequests.find((p) => p.id === row.id);
      if (pr) {
        this.openPullRequestView({ pr });
      }
    }
  }

  handleOpenCurrentPR() {
    if (this.currentBranchPullRequest) {
      // Open modal in singlePR mode with current branch PR
      this.showSinglePRModal(this.currentBranchPullRequest);
    }
  }

  handleOpenAutoFixPR() {
    if (!this.autoFixPullRequest?.webUrl) {
      return;
    }
    window.sendMessageToVSCode({
      type: "openExternal",
      data: { url: this.autoFixPullRequest.webUrl },
    });
  }

  showSinglePRModal(pr) {
    this.openPullRequestView({ pr });
  }

  handleReturnGetPrInfoForModal(pr) {
    // The answer to a request that was replaced, or whose window was closed or left
    if (pr?.requestId && pr.requestId !== this._prViewRequestId) {
      return;
    }
    // The extension answers { notFound } when it has no Pull Request to show
    if (pr?.notFound === true) {
      pr = null;
    }
    this.prViewLoading = false;
    if (!pr) {
      // The backend request failed (no git provider / error): the modal will not
      // open, so drop the tab a deep link may have requested instead of letting
      // it leak into the next successful modal open.
      this._nextModalTab = null;
      // The window that was left for this Pull Request is still the one on screen
      if (this._stackPushedForRequest) {
        this._modalStack = this._modalStack.slice(0, -1);
        this._stackPushedForRequest = false;
      }
      return;
    }
    this._stackPushedForRequest = false;
    if (this._clearStackOnAnswer) {
      this._modalStack = [];
      this._clearStackOnAnswer = false;
    }
    // Nothing of the window shown before (branch window, another Pull Request) must remain
    applyModalState(this, null);
    this.modalCheckout = pr.checkout || null;
    this.modalMode = "singlePR";
    this.modalBranchName = pr.sourceBranch || "";
    this.showJobStatusColumn = true;
    // Single PR details are enriched with tickets / deployment actions, so keep
    // those tabs visible.
    this.isFeaturePrModal = false;
    // A promotion Pull Request (promotion/ branch declaring the stories it carries) is
    // read-only like a Pull Request between two major branches
    this.modalIsPromotionPr = pr.isPromotion === true;
    this.modalPromotionUnresolved = Array.isArray(
      pr.unresolvedPromotionPullRequests,
    )
      ? pr.unresolvedPromotionPullRequests
      : [];
    this.modalIsMajorPr = pr.isMajorToMajor === true || this.modalIsPromotionPr;
    // Map through icons so the job status column (statusPill) is populated.
    this.modalPullRequests = this._mapPrsWithIcons([pr]);

    // Aggregate tickets from this single PR
    this.modalTickets = this._aggregateTicketsFromPRs([pr]);
    this._requestTicketDetails([pr]);

    // Deployment actions: the PR's own ones, or, for a Pull Request between
    // two major branches, the ones of the feature Pull Requests it carries
    this.modalActions = this.modalIsMajorPr
      ? this._aggregateActionsFromPRs(pr.aggregatedPullRequests || [])
      : this._aggregateActionsFromPRs([pr]);
    this._resetActionFilters();
    this._requestActionStatuses();

    // Set Apex tests list for this single PR
    const apexTests =
      pr &&
      pr.deploymentApexTestClasses &&
      Array.isArray(pr.deploymentApexTestClasses)
        ? pr.deploymentApexTestClasses
        : [];
    this.deploymentApexTestClasses = this.normalizeApexTestClasses(apexTests);
    this._deploymentApexTestClassesOriginal = [
      ...this.deploymentApexTestClasses,
    ];
    this.apexTestsMode = "view";
    this.apexTestsByLineRows = [];

    // Open on the tab requested by a deep link, on the Pull Requests tab otherwise
    this.modalActiveTabValue = this._nextModalTab || "general";
    this._nextModalTab = null;

    this.showPRModal = true;
  }

  // Click on the label of an action: its details
  handleActionLabelClick(event) {
    this._onActionRowAction("view_action", event.currentTarget.dataset.rowId);
  }

  // Retry / Mark as done buttons shown on a failed action
  handleActionInlineButton(event) {
    this._onActionRowAction(
      event.currentTarget.dataset.actionName,
      event.currentTarget.dataset.rowId,
    );
  }

  // Menu at the end of an action row
  handleActionMenuSelect(event) {
    this._onActionRowAction(
      event.detail.value,
      event.currentTarget.dataset.rowId,
    );
  }

  _onActionRowAction(actionName, rowId) {
    const row = this.modalActions.find((a) => a.id === rowId);
    if (!actionName || !row) {
      return;
    }

    // Handle the view_action button click
    if (actionName === "view_action") {
      // Find the full action object
      const actionRow = this.modalActions.find((a) => a.id === row.id);
      if (!actionRow || !actionRow._fullAction) {
        return;
      }

      // Show deployment action modal inline
      this.currentDeploymentAction = actionRow._fullAction;
      this.isDeploymentActionEditMode = false;
      this.showDeploymentActionModal = true;
    }

    if (actionName === "delete_action") {
      this.handleDeleteDeploymentAction(row);
    }

    if (
      [
        "retry_action",
        "mark_action_done",
        "move_action_to_my_pr",
        "run_action_in_my_org",
        "run_action_in_other_org",
        "mark_action_done_other_org",
        "mark_action_done_forecast",
      ].includes(actionName)
    ) {
      this.handleRecoverDeploymentAction(actionName, row);
    }
  }

  // Retry, close by hand or move a failed action: sfdx-hardis does the work in
  // the command runner, then refreshes the pipeline (and so the statuses)
  handleRecoverDeploymentAction(actionName, row) {
    const fullAction = row?._fullAction;
    // The id goes into a shell command line: anything but plain characters is refused
    const safeId = String(fullAction?.id || "");
    if (!SAFE_ACTION_ID.test(safeId)) {
      return;
    }
    // One action of the Pull Request of this window, tried in the default org of
    // the user, which sfdx-hardis refuses to touch when it is a major org (--dev-org)
    // Any org authenticated on this computer, major or developer: sfdx-hardis
    // lists them (major orgs first) and records the outcome where it belongs
    if (actionName === "run_action_in_other_org") {
      const prArg = row.prNumber > 0 ? String(row.prNumber) : "draft";
      window.sendMessageToVSCode({
        type: "runCommand",
        data: {
          command: `sf hardis:project:action:run --pr ${prArg} --action-id "${safeId}" --select-org`,
        },
      });
      return;
    }
    if (actionName === "run_action_in_my_org") {
      const prArg = row.prNumber > 0 ? String(row.prNumber) : "draft";
      const runId = safeId;
      window.sendMessageToVSCode({
        type: "runCommand",
        data: {
          command: `sf hardis:project:action:run --pr ${prArg} --action-id "${runId}" --dev-org`,
        },
      });
      return;
    }
    const prNumber = parseInt(row?.prNumber, 10);
    const orgBranch = this.actionStatusOrgBranch;
    if (!prNumber || !SAFE_BRANCH_NAME.test(orgBranch || "")) {
      return;
    }
    const actionId = safeId;
    let command = "";
    if (actionName === "retry_action") {
      command = `sf hardis:project:action:run --pr ${prNumber} --action-id "${actionId}" --org-branch ${orgBranch}`;
    } else if (actionName === "mark_action_done") {
      this._markActionDone(row, orgBranch);
      return;
    } else if (actionName === "mark_action_done_forecast") {
      this._markActionDone(row, this.promotionTargetBranch);
      return;
    } else if (actionName === "mark_action_done_other_org") {
      // sfdx-hardis asks where: a major branch where it is not done yet, or a
      // developer org authenticated on this computer
      command = `sf hardis:project:action:set-status --pr ${prNumber} --action-id "${actionId}" --select-org`;
    } else if (actionName === "move_action_to_my_pr") {
      const myPrNumber = this.currentBranchPullRequest?.number;
      const target = myPrNumber === -1 ? "draft" : String(myPrNumber);
      command = `sf hardis:project:action:update --scope pr --pr-id ${prNumber} --when ${fullAction.when || "post-deploy"} --action-id "${actionId}" --move-to-pr ${target}`;
    }
    if (command) {
      window.sendMessageToVSCode({ type: "runCommand", data: { command } });
    }
  }

  // The runs of the Pull Request shown, in the order of workflowPrNumbers, each one naming the
  // Pull Request whose comment reported it
  _applyWorkflows(data) {
    if (this.workflowPrNumbers.length === 0) {
      return;
    }
    if (!data || !data.workflows) {
      // No git provider token, or a sfdx-hardis older than --with-workflows
      this.workflowsUnavailable = true;
      this.modalWorkflows = [];
      return;
    }
    const runs = [];
    for (const prNumber of this.workflowPrNumbers) {
      const prRuns = data.workflows[String(prNumber)];
      // No entry: the comments of the Pull Request could not be read (no token, provider
      // error). The tabs are hidden rather than saying nothing was posted
      if (!Array.isArray(prRuns)) {
        this.workflowsUnavailable = true;
        this.modalWorkflows = [];
        return;
      }
      for (const run of prRuns) {
        runs.push({ ...run, prNumber });
      }
    }
    this.workflowsUnavailable = false;
    this.modalWorkflows = runs;
  }

  handleReturnDeploymentActionStatuses(data) {
    if (data?.requestId && data.requestId !== this.actionStatusRequestId) {
      return;
    }
    this.actionStatusesLoading = false;
    if (data && "forecast" in data) {
      this.actionForecast = data.forecast || null;
      this.actionForecastLoading = false;
    }
    // The actions marked as done are now in the statuses: their buttons stop spinning
    this.markingDoneKeys = this.markingDoneKeys.filter(
      (key) => !this.markDoneRefreshingKeys.includes(key),
    );
    this.markDoneRefreshingKeys = [];
    this._applyWorkflows(data);
    if (!data || !data.statuses) {
      this.modalActionStatuses = null;
      return;
    }
    this.modalActionStatuses = data.statuses;
  }

  // Outcome of a Mark as done run in the background
  handleDeploymentActionMarkDoneResult(data) {
    const key = data?.key;
    if (!key) {
      return;
    }
    if (data.ok) {
      // Keep spinning until the new statuses show the action as done
      this.markDoneRefreshingKeys = [...this.markDoneRefreshingKeys, key];
      // In "Next promotion" mode, the forecast comes back in the same answer
      this._requestActionStatuses({ refresh: true });
    } else {
      this.markingDoneKeys = this.markingDoneKeys.filter((k) => k !== key);
    }
  }

  _markDoneKey(prNumber, actionId, orgBranch = this.actionStatusOrgBranch) {
    return `${prNumber}|${actionId}|${orgBranch}`;
  }

  // ---- "Next promotion" mode ----

  // The first merge target of the branch of the window: preprod for uat
  get promotionTargetBranch() {
    if (this.modalMode === "singlePR") {
      return "";
    }
    const org = (this.pipelineData?.orgs || []).find(
      (o) => o.name === this.modalBranchName,
    );
    if (Array.isArray(org?.mergeTargets)) {
      return org.mergeTargets[0] || "";
    }
    // Pipeline data computed before mergeTargets was sent: the merge links of
    // the diagram say the same
    const link = (this.pipelineData?.links || []).find(
      (l) => l.source === this.modalBranchName && l.type === "gitMerge",
    );
    return link?.target || "";
  }

  // Shown in a branch window that has a merge target, once the statuses are known
  // (no git provider: no comment to read, no forecast either)
  get showPromotionToggle() {
    return (
      this.modalActionsAggregated &&
      !!this.promotionTargetBranch &&
      !!this.modalActionStatuses
    );
  }

  get isPromotionModeShown() {
    return this.promotionMode && this.showPromotionToggle;
  }

  get promotionToggleCurrentLabel() {
    return this.t("forecastToggleCurrent", { branch: this.modalBranchName });
  }

  get promotionToggleNextLabel() {
    return this.t("forecastToggleNext", { branch: this.promotionTargetBranch });
  }

  get promotionToggleCurrentClass() {
    return this.promotionMode ? "da-seg-button" : "da-seg-button da-seg-on";
  }

  get promotionToggleNextClass() {
    return this.promotionMode ? "da-seg-button da-seg-on" : "da-seg-button";
  }

  get promotionModeOffPressed() {
    return String(!this.promotionMode);
  }

  get promotionModeOnPressed() {
    return String(this.promotionMode);
  }

  handlePromotionModeOff() {
    this.promotionMode = false;
  }

  handlePromotionModeOn() {
    this.promotionMode = true;
    if (!this.actionForecast && !this.actionForecastLoading) {
      this._requestActionStatuses({ refresh: true });
    }
  }

  // The open promotion Pull Request, with the job status of the panel's list of
  // open Pull Requests (the forecast only names it)
  get promotionPullRequest() {
    const pr = this.actionForecast?.promotionPullRequest;
    if (!pr) {
      return null;
    }
    const open = (this.openPullRequests || []).find(
      (o) => Number(o.number) === Number(pr.number),
    );
    return {
      ...pr,
      label: `#${pr.number} ${pr.title || ""}`.trim(),
      jobsLabel: open?.jobsStatusLabel || "",
      jobsPillClass:
        open?.statusPillClass || "hardis-pill hardis-status-unknown",
      jobsUrl: open?.jobsStatusUrl || pr.webUrl,
    };
  }

  get promotionNoPrLabel() {
    return this.t("forecastNoPromotionPr", {
      source: this.modalBranchName,
      target: this.promotionTargetBranch,
    });
  }

  // One pill per action: what the promotion will do with it in the target branch
  _actionForecastFields(row) {
    const target = this.promotionTargetBranch;
    const actionId = row._fullAction?.id;
    const menuItems = [
      {
        label: this.i18n.deploymentActionViewDetails,
        name: "view_action",
        iconName: "utility:preview",
      },
    ];
    const inlineButtons = [];
    const forecast = (
      this.actionForecast?.actions?.[String(row.prNumber)] || []
    ).find((a) => a.actionId === actionId);
    if (!forecast) {
      const loading = this.actionForecastLoading;
      return {
        statusCode: loading ? "loading" : "none",
        showStatus: true,
        statusLabel: loading
          ? this.i18n.loadingLabel
          : this.i18n.actionStatusNotRunYet,
        statusPillClass: loading
          ? "hardis-pill hardis-status-unknown da-pill-loading"
          : "hardis-pill hardis-status-unknown",
        statusDetail: "",
        inlineButtons,
        menuItems,
        expanded: false,
        statusDetailLines: [],
        statusToggleTitle: this.i18n.deploymentActionStatusToggle,
      };
    }
    const display = this._forecastDisplay(forecast, target);
    const markDone = {
      label: this.t("deploymentActionMarkDoneIn", { orgBranch: target }),
      name: "mark_action_done_forecast",
      iconName: "utility:check",
    };
    const busy = this.markingDoneKeys.includes(
      this._markDoneKey(row.prNumber, actionId, target),
    );
    if (forecast.forecast === "waiting" || busy) {
      inlineButtons.push({
        ...markDone,
        label: busy
          ? this.t("deploymentActionMarkingDoneIn", { orgBranch: target })
          : markDone.label,
        className: "slds-button slds-button_neutral da-button",
        busy,
      });
    } else if (
      ["runs-at-validation", "runs-at-deployment", "failed"].includes(
        forecast.forecast,
      ) &&
      // Runs at every deployment whatever its status: marking it done changes nothing
      forecast.reason !== "every-deployment"
    ) {
      menuItems.push(markDone);
    }
    if (row.prNumber > 0) {
      menuItems.push({
        label: this.i18n.deploymentActionMarkDoneOtherOrg,
        name: "mark_action_done_other_org",
        iconName: "utility:check",
      });
    }
    return {
      // An action run once with an identical one of another Pull Request is counted apart
      statusCode: forecast.identicalTo ? "identical" : forecast.forecast,
      showStatus: true,
      statusLabel: display.label,
      statusPillClass: "hardis-pill " + display.pillClass,
      statusDetail: this._forecastReason(forecast, target),
      inlineButtons,
      menuItems,
      ...this._statusExpansionFields(row),
    };
  }

  _forecastDisplay(forecast, target) {
    // The same job runs it once, with the identical action of another Pull Request
    if (forecast.identicalTo) {
      return {
        label: this.t(
          forecast.forecast === "runs-at-validation"
            ? "forecastRunsAtValidationWithIdentical"
            : "forecastRunsAtDeploymentWithIdentical",
          { pr: forecast.identicalTo.pr },
        ),
        pillClass: "hardis-status-info",
      };
    }
    switch (forecast.forecast) {
      case "waiting":
        return {
          label: this.i18n.forecastWaiting,
          pillClass: "hardis-status-pending",
        };
      case "after-merge":
        return {
          label: this.i18n.forecastAfterMerge,
          pillClass: "hardis-status-info",
        };
      case "done":
        return {
          label: this.t("forecastDone", { branch: target }),
          pillClass: "hardis-status-success",
        };
      case "runs-at-validation":
        return {
          label: this.i18n.forecastRunsAtValidation,
          pillClass: "hardis-status-info",
        };
      case "runs-at-deployment":
        return {
          label: this.i18n.forecastRunsAtDeployment,
          pillClass: "hardis-status-info",
        };
      case "failed":
        return {
          label: this.t("forecastFailed", { branch: target }),
          pillClass: "hardis-status-failed",
        };
      case "moved":
        return {
          label: this.t("forecastMoved", { pr: forecast.movedTo || "?" }),
          pillClass: "hardis-status-unknown",
        };
      case "not-in-promotion":
        return {
          label: this.i18n.forecastNotInPromotion,
          pillClass: "hardis-status-unknown",
        };
      default:
        return {
          label: this.t("forecastNotForBranch", { branch: target }),
          pillClass: "hardis-status-unknown",
        };
    }
  }

  // The line under the label saying why
  _forecastReason(forecast, target) {
    const date = (forecast.date || "").substring(0, 10);
    const promotionPr =
      this.actionForecast?.promotionPullRequest?.number || "?";
    switch (forecast.reason) {
      case "manual-before-merge":
        return this.t("forecastReasonBeforeMerge", { branch: target });
      case "manual-after-merge":
        return this.t("forecastReasonAfterMerge", { branch: target });
      case "done-in-branch":
        return forecast.note || date;
      case "every-deployment":
        return this.i18n.forecastReasonEveryDeployment;
      case "deploy-only":
        return this.i18n.forecastReasonDeployOnly;
      case "skipped-by-validation":
        return this.i18n.forecastReasonSkippedByValidation;
      case "validation-first":
        return this.i18n.forecastReasonValidationFirst;
      case "validation-only":
        return this.i18n.forecastReasonValidationOnly;
      case "branch-filter":
        return this.t("forecastReasonBranchFilter", { branch: target });
      case "failed-in-branch":
        return this.t("forecastReasonFailed", { date });
      case "stopped-in-branch":
        return this.i18n.forecastReasonStopped;
      case "not-carried":
        return this.t("forecastReasonNotCarried", { pr: promotionPr });
      case "identical-action":
        return this.t("forecastReasonIdenticalAction", {
          label: forecast.identicalTo?.actionLabel || "",
          pr: forecast.identicalTo?.pr || "?",
        });
      default:
        return "";
    }
  }

  // What needs a person first, then failures, then the rest
  _forecastGroupRank(rows) {
    if (rows.every((row) => row.statusCode === "not-in-promotion")) {
      return 3;
    }
    if (rows.some((row) => ["waiting", "failed"].includes(row.statusCode))) {
      return 0;
    }
    if (
      rows.some((row) =>
        [
          "runs-at-validation",
          "runs-at-deployment",
          "after-merge",
          "identical",
        ].includes(row.statusCode),
      )
    ) {
      return 1;
    }
    return 2;
  }

  // What the promotion does with the actions of a group, or of the whole window
  _forecastGroupSummary(rows) {
    if (!this.actionForecast) {
      return [];
    }
    if (rows.every((row) => row.statusCode === "not-in-promotion")) {
      return [
        {
          key: "not-in-promotion",
          label: this.i18n.forecastNotInPromotion,
          pillClass: "hardis-pill hardis-status-unknown",
        },
      ];
    }
    return this._summaryPills(rows, this._forecastCategories(), {
      branch: this.promotionTargetBranch,
    });
  }

  // The pills of the Next promotion mode, in the order they show: the headers
  // and the Total row count the same things
  _forecastCategories() {
    return [
      {
        key: "waiting",
        codes: ["waiting"],
        labelKey: "forecastSummaryToDo",
        pill: "hardis-status-pending",
      },
      {
        key: "failed",
        codes: ["failed"],
        labelKey: "forecastSummaryFailed",
        pill: "hardis-status-failed",
      },
      {
        key: "validation",
        codes: ["runs-at-validation"],
        labelKey: "forecastSummaryValidation",
        pill: "hardis-status-info",
      },
      {
        key: "deployment",
        codes: ["runs-at-deployment"],
        labelKey: "forecastSummaryDeployment",
        pill: "hardis-status-info",
      },
      {
        key: "identical",
        codes: ["identical"],
        labelKey: "forecastSummaryIdentical",
        pill: "hardis-status-info",
      },
      {
        key: "after-merge",
        codes: ["after-merge"],
        labelKey: "forecastSummaryAfterMerge",
        pill: "hardis-status-info",
      },
      {
        key: "done",
        codes: ["done"],
        labelKey: "forecastSummaryDone",
        pill: "hardis-status-success",
      },
      {
        key: "not-for-branch",
        codes: ["not-for-branch", "moved"],
        labelKey: "forecastSummaryNotForBranch",
        pill: "hardis-status-unknown",
      },
    ];
  }

  // Mark as done in one org branch, in the background: the button spins until
  // the statuses show it done
  _markActionDone(row, orgBranch) {
    const actionId = String(row?._fullAction?.id || "");
    const prNumber = parseInt(row?.prNumber, 10);
    if (
      !SAFE_ACTION_ID.test(actionId) ||
      !SAFE_BRANCH_NAME.test(orgBranch || "") ||
      !(prNumber > 0)
    ) {
      return;
    }
    const key = this._markDoneKey(prNumber, actionId, orgBranch);
    if (this.markingDoneKeys.includes(key)) {
      return;
    }
    this.markingDoneKeys = [...this.markingDoneKeys, key];
    window.sendMessageToVSCode({
      type: "markDeploymentActionDone",
      data: { prNumber, actionId, orgBranch, label: row.label, key },
    });
  }

  // Click on the status pill: show or hide the status of the action in every
  // org of the pipeline, and in the developer orgs (Backpromotes comment)
  handleActionStatusToggle(event) {
    const rowId = event.currentTarget.dataset.rowId;
    if (this.expandedActionRowIds.includes(rowId)) {
      this.expandedActionRowIds = this.expandedActionRowIds.filter(
        (id) => id !== rowId,
      );
      return;
    }
    this.expandedActionRowIds = [...this.expandedActionRowIds, rowId];
    const row = this.modalActions.find((a) => a.id === rowId);
    const prNumber = parseInt(row?.prNumber, 10);
    if (
      prNumber > 0 &&
      !this.actionBackpromotes[String(prNumber)] &&
      !this.actionBackpromotesLoading.includes(prNumber)
    ) {
      this.actionBackpromotesLoading = [
        ...this.actionBackpromotesLoading,
        prNumber,
      ];
      window.sendMessageToVSCode({
        type: "loadDeploymentActionBackpromotes",
        data: { prNumber },
      });
    }
  }

  handleReturnDeploymentActionBackpromotes(data) {
    const prNumber = parseInt(data?.prNumber, 10);
    this.actionBackpromotesLoading = this.actionBackpromotesLoading.filter(
      (n) => n !== prNumber,
    );
    this.actionBackpromotes = {
      ...this.actionBackpromotes,
      [String(prNumber)]: Array.isArray(data?.rows) ? data.rows : [],
    };
  }

  // Mark as done button of one major branch line of the expanded status
  handleActionDetailMarkDone(event) {
    const row = this.modalActions.find(
      (a) => a.id === event.currentTarget.dataset.rowId,
    );
    this._markActionDone(row, event.currentTarget.dataset.branch);
  }

  // The status of an action in every major branch, then in every developer org
  // a backpromote or a try ran it in
  _actionStatusDetailLines(row) {
    const actionId = row._fullAction?.id;
    const statusKey = row.prNumber === -1 ? "draft" : String(row.prNumber);
    const prEntries = this.modalActionStatuses?.[statusKey] || [];
    const lines = [];
    for (const branch of this.majorBranchNames) {
      const entry = prEntries.find(
        (e) => e.actionId === actionId && e.orgBranch === branch,
      );
      const status = entry ? entry.status : "none";
      const display = this._actionStatusDisplay(status, entry);
      const busy = this.markingDoneKeys.includes(
        this._markDoneKey(row.prNumber, actionId, branch),
      );
      lines.push({
        key: `branch-${branch}`,
        name: branch,
        statusLabel: display.label,
        pillClass: "hardis-pill " + display.pillClass,
        date: (entry?.date || "").substring(0, 10),
        jobUrl: entry?.jobUrl || "",
        jobLabel: entry?.jobId || "",
        note: entry?.note || "",
        canMarkDone: row.prNumber > 0 && !["success", "moved"].includes(status),
        markLabel: busy
          ? this.i18n.deploymentActionMarkingDone
          : this.i18n.deploymentActionMarkDone,
        busy,
      });
    }
    if (row.prNumber > 0) {
      const prKey = String(row.prNumber);
      if (this.actionBackpromotesLoading.includes(row.prNumber)) {
        lines.push({
          key: "sandboxes-loading",
          name: this.i18n.deploymentActionDevOrgs,
          statusLabel: this.i18n.loadingLabel,
          pillClass: "hardis-pill hardis-status-unknown da-pill-loading",
          isSandbox: true,
        });
      }
      for (const bp of (this.actionBackpromotes[prKey] || []).filter(
        (r) => r.actionId === actionId,
      )) {
        const status =
          bp.status === "pending"
            ? "manual"
            : bp.status === "failed"
              ? "failed"
              : "success";
        const display = this._actionStatusDisplay(status, null);
        lines.push({
          key: `sandbox-${bp.sandboxName}-${bp.orgId}`,
          name: bp.sandboxName,
          statusLabel: display.label,
          pillClass: "hardis-pill " + display.pillClass,
          date: (bp.date || "").substring(0, 10),
          note: bp.user
            ? this.t("deploymentActionDoneBy", { user: bp.user })
            : "",
          isSandbox: true,
        });
      }
    }
    return lines;
  }

  // The head of the actions: the Status / Next promotion switch, and the totals
  get showActionsHead() {
    return this.showPromotionToggle || this.modalActionTotals.length > 0;
  }

  // The pills of every Pull Request of the window added up, in the mode shown,
  // each one a switch hiding or showing the actions it counts. The Status mode
  // also counts the actions no header pill counts (not run yet, skipped), so
  // that every action can be hidden. A Pull Request the open promotion leaves
  // out is not counted. Shown from two Pull Requests with pills: with a single
  // one, its header already says the same
  get modalActionTotals() {
    const categories = this._totalCategories();
    if (!categories) {
      return [];
    }
    const codes = new Set(categories.flatMap((category) => category.codes));
    const counted = this._actionGroups().filter((group) =>
      group.rows.some((row) => codes.has(row.statusCode)),
    );
    if (counted.length < 2) {
      return [];
    }
    const labelVars = this.isPromotionModeShown
      ? { branch: this.promotionTargetBranch }
      : {};
    const hidden = this._hiddenActionKeys;
    return this._summaryPills(
      counted.flatMap((group) => group.rows),
      categories,
      labelVars,
    ).map((pill) => {
      const off = hidden.includes(pill.key);
      return {
        ...pill,
        pillClass: off
          ? "hardis-pill hardis-status-unknown da-pill-off"
          : pill.pillClass,
        pressed: String(!off),
        toggleTitle: off
          ? this.i18n.clickToShowTheseActions
          : this.i18n.clickToHideTheseActions,
      };
    });
  }

  // Every action hidden by the Total pills: say so rather than show an empty tab
  get everyActionHidden() {
    return this.modalActions.length > 0 && this.modalActionGroups.length === 0;
  }

  // The groups the tab lists: every Pull Request, minus the actions the Total
  // pills hide, and minus a Pull Request whose actions are all hidden. The
  // headers and the numbers of the rows still count every action
  get modalActionGroups() {
    const groups = this._actionGroups();
    const hiddenCodes = this._hiddenActionCodes();
    if (hiddenCodes.size === 0) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => !hiddenCodes.has(row.statusCode)),
      }))
      .filter((group) => group.rows.length > 0);
  }

  // Click on a Total pill: hide the actions it counts, or show them again
  handleActionTotalToggle(event) {
    const key = event.currentTarget.dataset.key;
    const categories = this._totalCategories() || [];
    if (!categories.some((category) => category.key === key)) {
      return;
    }
    const hidden = this._hiddenActionKeys;
    const next = hidden.includes(key)
      ? hidden.filter((hiddenKey) => hiddenKey !== key)
      : [...hidden, key];
    if (this.isPromotionModeShown) {
      this.hiddenActionForecastKeys = next;
    } else {
      this.hiddenActionStatusKeys = next;
    }
  }

  // The pills of the Total row in the mode shown: none until the statuses (or
  // the forecast) are known, nor in the window of a Pull Request of your own
  _totalCategories() {
    if (!this.modalActionsAggregated) {
      return null;
    }
    if (this.isPromotionModeShown) {
      return this.actionForecast ? this._forecastCategories() : null;
    }
    return this.modalActionStatuses ? this._statusCategories(true) : null;
  }

  get _hiddenActionKeys() {
    return this.isPromotionModeShown
      ? this.hiddenActionForecastKeys
      : this.hiddenActionStatusKeys;
  }

  // The statuses the Total pills hide, only while the Total row shows: a window
  // without it lists every action
  _hiddenActionCodes() {
    const hidden = this._hiddenActionKeys;
    if (hidden.length === 0 || this.modalActionTotals.length === 0) {
      return new Set();
    }
    return new Set(
      this._totalCategories()
        .filter((category) => hidden.includes(category.key))
        .flatMap((category) => category.codes),
    );
  }

  // The actions of the modal, one group per Pull Request. Groups with a problem
  // come first, then the ones waiting for someone, then the rest. Inside a group
  // the actions keep the order they run in: pre-deploy, then post-deploy, each
  // in the order of the Pull Request file. Every action, whatever the Total
  // pills hide: the headers and the totals count them all
  _actionGroups() {
    const byPr = new Map();
    for (const row of this.modalActions) {
      if (!byPr.has(row.prNumber)) {
        byPr.set(row.prNumber, []);
      }
      byPr.get(row.prNumber).push(row);
    }
    const whenRank = { "pre-deploy": 0, "post-deploy": 1 };
    const groups = [];
    for (const [prNumber, prRows] of byPr.entries()) {
      const sortedRows = [...prRows].sort(
        (a, b) =>
          (whenRank[a.whenCode] ?? 2) - (whenRank[b.whenCode] ?? 2) ||
          (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
      );
      const rows = sortedRows.map((row, index) => ({
        ...row,
        order: index + 1,
        ...this._actionStatusFields(row, sortedRows),
      }));
      const first = rows[0];
      groups.push({
        key: `pr-${prNumber}`,
        prNumber,
        showHeader: this.modalActionsAggregated,
        prLabel: `#${prNumber} ${first.prTitle}`.trim(),
        prWebUrl: first.prWebUrl,
        authorLabel: first.authorLabel,
        authorInitials: first.authorInitials,
        authorAvatarClass: first.authorAvatarClass || "hardis-avatar",
        summary: this.isPromotionModeShown
          ? this._forecastGroupSummary(rows)
          : this._actionGroupSummary(rows),
        rank: this.isPromotionModeShown
          ? this._forecastGroupRank(rows)
          : this._actionGroupRank(rows),
        groupClass:
          this.isPromotionModeShown &&
          rows.every((row) => row.statusCode === "not-in-promotion")
            ? "da-group da-group-excluded"
            : "da-group",
        rows,
      });
    }
    return groups.sort((a, b) => a.rank - b.rank || b.prNumber - a.prNumber);
  }

  // 0: something failed or was stopped, 1: waiting for someone, 2: the rest.
  // A failure allowed by the action (warning) blocked nothing: like sfdx-hardis,
  // which keeps the Pull Request comment green for it, it does not count as one
  _actionGroupRank(rows) {
    if (rows.some((row) => ["failed", "not-run"].includes(row.statusCode))) {
      return 0;
    }
    if (rows.some((row) => row.statusCode === "manual")) {
      return 1;
    }
    return 2;
  }

  // "1 failed · 2 stopped": what a group, or the whole window, holds once the
  // statuses are known
  _actionGroupSummary(rows) {
    if (!this.modalActionStatuses) {
      return [];
    }
    return this._summaryPills(rows, this._statusCategories(false), {});
  }

  // The pills of the Status mode, in the order they show. The Total row also
  // counts the actions no header pill counts, so that every action can be hidden
  // from there: no status yet, or a pending one, both read "Not run yet"
  _statusCategories(total) {
    const categories = [
      {
        key: "failed",
        codes: ["failed"],
        labelKey: "actionSummaryFailed",
        pill: "hardis-status-failed",
      },
      {
        key: "failedAllowed",
        codes: ["warning"],
        labelKey: "actionSummaryFailedAllowed",
        pill: "hardis-status-unknown",
      },
      {
        key: "stopped",
        codes: ["not-run"],
        labelKey: "actionSummaryStopped",
        pill: "hardis-status-pending",
      },
      {
        key: "waiting",
        codes: ["manual"],
        labelKey: "actionSummaryWaiting",
        pill: "hardis-status-pending",
      },
      {
        key: "moved",
        codes: ["moved"],
        labelKey: "actionSummaryMoved",
        pill: "hardis-status-unknown",
      },
      {
        key: "done",
        codes: ["success"],
        labelKey: "actionSummaryDone",
        pill: "hardis-status-success",
      },
    ];
    if (total) {
      categories.push(
        {
          key: "notRunYet",
          codes: ["none", "pending"],
          labelKey: "actionSummaryNotRunYet",
          pill: "hardis-status-unknown",
        },
        {
          key: "skipped",
          codes: ["skipped"],
          labelKey: "actionSummarySkipped",
          pill: "hardis-status-unknown",
        },
      );
    }
    return categories;
  }

  // The org branch the status column describes: the major branch of the
  // branch window, the target branch of a Pull Request
  get actionStatusOrgBranch() {
    if (this.modalMode === "singlePR") {
      return (this.modalPullRequests[0] || {}).targetBranch || "";
    }
    return this.modalBranchName || "";
  }

  // refresh: keep the statuses on screen while new ones load (after Mark as
  // done), instead of the grey "Loading..." pills of a first load
  _requestActionStatuses({ refresh = false } = {}) {
    if (!refresh) {
      this.modalActionStatuses = null;
    }
    // A draft (no Pull Request yet, number -1) only has the results of the
    // actions tried in a developer org, kept in a local file
    const prNumbers = [
      ...new Set(
        this.modalActions
          .map((row) => parseInt(row.prNumber, 10))
          .map((prNumber) => (prNumber === -1 ? "draft" : prNumber))
          .filter((prNumber) => prNumber === "draft" || prNumber > 0),
      ),
    ];
    // One Pull Request: the same sfdx-hardis call also reads its validation and deployment runs
    const workflowPrNumbers = this.workflowPrNumbers;
    if (prNumbers.length === 0 && workflowPrNumbers.length === 0) {
      this.actionStatusesLoading = false;
      return;
    }
    this.actionStatusesLoading = !refresh;
    this.actionStatusRequestId += 1;
    // In "Next promotion" mode the same sfdx-hardis call also returns the forecast
    const withForecast = this.promotionMode && !!this.promotionTargetBranch;
    if (withForecast && !this.actionForecast) {
      this.actionForecastLoading = true;
    }
    window.sendMessageToVSCode({
      type: "loadDeploymentActionStatuses",
      data: {
        prNumbers,
        workflowPrNumbers,
        requestId: this.actionStatusRequestId,
        forecastBranch: withForecast ? this.promotionTargetBranch : "",
        fromBranch: withForecast ? this.modalBranchName : "",
      },
    });
  }

  // Status pill of an action in the org branch, and the row actions it allows
  _actionStatusFields(row, groupRows = []) {
    if (this.isPromotionModeShown) {
      return this._actionForecastFields(row);
    }
    const actionId = row._fullAction?.id;
    const statusKey = row.prNumber === -1 ? "draft" : String(row.prNumber);
    const prEntries = this.modalActionStatuses?.[statusKey] || [];
    const entry = prEntries.find(
      (e) =>
        e.actionId === actionId && e.orgBranch === this.actionStatusOrgBranch,
    );
    // In the window of one Pull Request, the result of the last try in the
    // developer org of the user, recorded by sfdx-hardis under one name shared
    // by every developer org
    const devBranch = this.modalActionsAggregated ? "" : DEV_SANDBOXES_BRANCH;
    const devEntry = devBranch
      ? prEntries.find(
          (e) => e.actionId === actionId && e.orgBranch === devBranch,
        )
      : null;
    const status = entry ? entry.status : "none";
    const display = this._actionStatusDisplay(status, entry);
    const menuItems = [
      {
        label: this.i18n.deploymentActionViewDetails,
        name: "view_action",
        iconName: "utility:preview",
      },
    ];
    const inlineButtons = [];
    // What sfdx-hardis can run outside a deployment: not a manual action, not a
    // change of the deployment package, not a validation-only action
    const runnable =
      row.typeCode !== "manual" &&
      row.typeCode !== "remove-packagexml-items" &&
      (row.typeCode === "run-batch" ||
        fullActionContext(row) !== "check-deployment-only");
    const recoverable = ["failed", "warning", "not-run"].includes(status);
    const retry = {
      label: this.i18n.deploymentActionRetry,
      name: "retry_action",
      iconName: "utility:refresh",
    };
    const markDone = {
      label: this.t("deploymentActionMarkDoneIn", {
        orgBranch: this.actionStatusOrgBranch,
      }),
      name: "mark_action_done",
      iconName: "utility:check",
    };
    if (recoverable) {
      // The failure itself gets visible buttons; the actions it stopped keep
      // them in the menu, since retrying the failure first usually runs them
      if (status === "not-run") {
        if (runnable) {
          menuItems.push(retry);
        }
        menuItems.push(markDone);
      } else {
        if (runnable) {
          inlineButtons.push({
            ...retry,
            className:
              "slds-button slds-button_neutral hardis-btn-tinted-blue da-button",
          });
        }
        inlineButtons.push({
          ...markDone,
          className: "slds-button slds-button_neutral da-button",
        });
      }
      // Moving needs a Pull Request of your own to move it to: said in the
      // menu rather than hidden, so nobody wonders where the option went
      const myPrNumber = this.currentBranchPullRequest?.number;
      if (myPrNumber !== row.prNumber) {
        const hasMyPr = !!myPrNumber;
        menuItems.push({
          label: hasMyPr
            ? this.i18n.deploymentActionMoveToMyPr
            : this.i18n.deploymentActionMoveToMyPrNoPr,
          name: "move_action_to_my_pr",
          iconName: "utility:move",
          disabled: !hasMyPr,
        });
      }
    } else if (
      this.modalActionsAggregated &&
      runnable &&
      this.modalActionStatuses &&
      ["none", "skipped"].includes(status) &&
      row.prNumber > 0
    ) {
      // Never run in the org of the branch, or skipped there: run it now,
      // sfdx-hardis asks for a confirmation first
      menuItems.push({
        ...retry,
        label: this.t("deploymentActionRunInOrg", {
          orgBranch: this.actionStatusOrgBranch,
        }),
        iconName: "utility:play",
      });
    }
    // A manual action waiting in this org: Mark as done, as ticking its checkbox
    // in the Pull Request comment does, naming who did it
    if (status === "manual" && row.prNumber > 0) {
      inlineButtons.push({
        ...markDone,
        className: "slds-button slds-button_neutral da-button",
      });
    }
    // Done by hand in another org: a major branch before or after this one, or
    // a developer org
    if (row.prNumber > 0) {
      menuItems.push({
        label: this.i18n.deploymentActionMarkDoneOtherOrg,
        name: "mark_action_done_other_org",
        iconName: "utility:check",
      });
    }
    // Any runnable action can be run in any authenticated org
    if (runnable && (row.prNumber > 0 || row.prNumber === -1)) {
      menuItems.push({
        label: this.i18n.deploymentActionRunInOtherOrg,
        name: "run_action_in_other_org",
        iconName: "utility:world",
      });
    }
    // Your own Pull Request: try the action in your org (again, after a failed
    // try), or delete it. No try for an action sfdx-hardis skips in a developer
    // org: a validation-only one, or a change of the deployment package
    const runsInDevOrg =
      row.typeCode !== "remove-packagexml-items" &&
      (row.typeCode === "run-batch" ||
        fullActionContext(row) !== "check-deployment-only");
    if (!this.modalActionsAggregated) {
      if (runsInDevOrg && this.isOwnPullRequest) {
        const lastTryFailed = ["failed", "warning"].includes(devEntry?.status);
        inlineButtons.push({
          label: lastTryFailed
            ? this.i18n.deploymentActionRerunInMyOrg
            : this.i18n.deploymentActionRunInMyOrg,
          name: "run_action_in_my_org",
          className: "slds-button slds-button_neutral da-button",
        });
      }
      menuItems.push({
        label: this.i18n.deleteLabel,
        name: "delete_action",
        iconName: "utility:delete",
      });
    }
    // Mark as done running in the background: its button spins until the
    // statuses come back
    const busyKey = this._markDoneKey(row.prNumber, actionId);
    if (this.markingDoneKeys.includes(busyKey)) {
      const busyButton = {
        ...markDone,
        label: this.t("deploymentActionMarkingDoneIn", {
          orgBranch: this.actionStatusOrgBranch,
        }),
        className: "slds-button slds-button_neutral da-button",
        busy: true,
      };
      const index = inlineButtons.findIndex((b) => b.name === markDone.name);
      if (index >= 0) {
        inlineButtons[index] = busyButton;
      } else {
        inlineButtons.unshift(busyButton);
      }
    }
    const loading = !this.modalActionStatuses && this.actionStatusesLoading;
    return {
      statusCode: status,
      showStatus: !!this.modalActionStatuses || loading,
      statusLabel: loading ? this.i18n.loadingLabel : display.label,
      statusPillClass: loading
        ? "hardis-pill hardis-status-unknown da-pill-loading"
        : "hardis-pill " + display.pillClass,
      statusDetail: [
        this._actionStatusDetail(status, entry, groupRows),
        devEntry ? this._devOrgStatusDetail(devEntry) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      inlineButtons,
      menuItems,
      ...this._statusExpansionFields(row),
    };
  }

  // Expansion of the status pill, shared by the status and the forecast of a row
  _statusExpansionFields(row) {
    const expanded = this.expandedActionRowIds.includes(row.id);
    return {
      expanded,
      statusDetailLines:
        expanded && this.modalActionStatuses
          ? this._actionStatusDetailLines(row)
          : [],
      statusToggleTitle: this.i18n.deploymentActionStatusToggle,
    };
  }

  // Summary pills of a group: one per category holding at least one row
  _summaryPills(rows, categories, labelVars) {
    return categories
      .map((category) => ({
        category,
        count: rows.filter((row) => category.codes.includes(row.statusCode))
          .length,
      }))
      .filter((item) => item.count > 0)
      .map((item) => ({
        key: item.category.key,
        label: this.t(item.category.labelKey, {
          ...labelVars,
          count: item.count,
        }),
        pillClass: "hardis-pill " + item.category.pill,
      }));
  }

  // "In your org: Done (2026-10-03)": the last try in the developer org
  _devOrgStatusDetail(devEntry) {
    const display = this._actionStatusDisplay(devEntry.status, devEntry);
    return this.t("actionStatusInMyOrg", {
      status: display.label,
      date: (devEntry.date || "").substring(0, 10),
    });
  }

  // One line under the label saying why the action is in this state, when the
  // state alone does not: which action stopped it, where it was moved, or the
  // note of a run made outside a deployment job
  _actionStatusDetail(status, entry, groupRows) {
    if (!entry) {
      return "";
    }
    if (status === "not-run" && entry.blockedBy) {
      const blocker = groupRows.findIndex(
        (other) => other._fullAction?.id === entry.blockedBy.actionId,
      );
      return blocker >= 0
        ? this.t("actionStoppedByOrder", { order: blocker + 1 })
        : this.t("actionStoppedByPr", { pr: entry.blockedBy.pr });
    }
    if (status === "moved") {
      return "";
    }
    return entry.note || "";
  }

  _actionStatusDisplay(status, entry) {
    switch (status) {
      case "success":
        return {
          label: this.i18n.actionStatusDone,
          pillClass: "hardis-status-success",
        };
      case "failed":
        return {
          label: this.i18n.actionStatusFailed,
          pillClass: "hardis-status-failed",
        };
      case "warning":
        return {
          label: this.i18n.actionStatusFailedAllowed,
          pillClass: "hardis-status-failed",
        };
      case "not-run":
        return {
          label: this.i18n.actionStatusNotRun,
          pillClass: "hardis-status-pending",
        };
      case "manual":
        return {
          label: this.i18n.actionStatusManual,
          pillClass: "hardis-status-pending",
        };
      case "moved":
        return {
          label: this.t("actionStatusMoved", { pr: entry?.movedTo || "?" }),
          pillClass: "hardis-status-unknown",
        };
      case "skipped":
        return {
          label: this.i18n.actionStatusSkipped,
          pillClass: "hardis-status-unknown",
        };
      default:
        return {
          label: this.i18n.actionStatusNotRunYet,
          pillClass: "hardis-status-unknown",
        };
    }
  }

  handleDeleteDeploymentAction(row) {
    const fullAction = row?._fullAction;
    const prNumber = fullAction?.pullRequest?.number ?? row?.prNumber;
    const commandId = fullAction?.id;
    const when = fullAction?.when ?? row?.whenCode;

    if (!prNumber || !commandId || !when) {
      console.error(
        "Cannot delete deployment action: missing prNumber, commandId, or when",
      );
      return;
    }

    this.modalActions = this.modalActions.filter((actionRow) => {
      return !(
        actionRow?._fullAction?.id === commandId &&
        actionRow?.prNumber === prNumber
      );
    });

    if (this.currentDeploymentAction?.id === commandId) {
      this.showDeploymentActionModal = false;
      this.currentDeploymentAction = null;
      this.isDeploymentActionEditMode = false;
    }

    window.sendMessageToVSCode({
      type: "deleteDeploymentAction",
      data: {
        prNumber,
        commandId,
        when,
        warning: this.notOwnPrWarning,
      },
    });
  }

  handleCloseDeploymentActionModal() {
    this.showDeploymentActionModal = false;
    this.currentDeploymentAction = null;
    this.isDeploymentActionEditMode = false;
  }

  handleEditDeploymentAction() {
    this.isDeploymentActionEditMode = true;
  }

  handleSaveDeploymentAction(event) {
    const { action, originalAction } = event.detail;
    // Get PR number from the action
    const prNumber = action.pullRequest?.number;
    if (!prNumber) {
      console.error("Cannot save deployment action: PR number not found");
      return;
    }

    const when = action.when;
    const whenLabel = this._getActionWhenLabel(when);
    const typeCode = action.type || "command";
    const typeLabel = this._getActionTypeLabel(typeCode);
    const typeIconName = this._getActionTypeIconName(typeCode);

    // Update the modalActions list immediately with the new values
    const actionIndex = this.modalActions.findIndex(
      (a) =>
        a._fullAction &&
        a._fullAction.id === action.id &&
        a.prNumber === prNumber,
    );

    if (actionIndex >= 0) {
      // Update existing action
      const updatedRow = {
        ...this.modalActions[actionIndex],
        label: action.label || this.i18n.unnamedAction,
        type: typeLabel,
        typeIconName: typeIconName,
        when: whenLabel,
        whenCode: when,
        typeCode: typeCode,
        ...this._actionDisplayFields(
          typeCode,
          when,
          this.modalActions[actionIndex].authorLabel,
        ),
        _fullAction: {
          ...action,
          pullRequest: {
            number: prNumber,
            title: action.pullRequest?.title,
            webUrl: action.pullRequest?.webUrl,
          },
        },
      };

      // Create new array with updated action
      const updatedActions = [
        ...this.modalActions.slice(0, actionIndex),
        updatedRow,
        ...this.modalActions.slice(actionIndex + 1),
      ];

      // Sort the actions (Pre-Deploy first, then Post-Deploy)
      this.modalActions = this._sortActions(updatedActions);
    } else {
      // Add new action to the list
      const newRow = {
        id: `${prNumber}-${action.type || "action"}-${this.modalActions.length}`,
        label: action.label || this.i18n.unnamedAction,
        type: typeLabel,
        typeIconName: typeIconName,
        when: whenLabel,
        whenCode: when,
        typeCode: typeCode,
        ...this._actionDisplayFields(
          typeCode,
          when,
          this._modalPrAuthorLabel(),
        ),
        prLabel: `#${prNumber} - ${action.pullRequest?.title || ""}`,
        prWebUrl: action.pullRequest?.webUrl || "",
        prNumber: prNumber,
        _fullAction: {
          ...action,
          pullRequest: {
            number: prNumber,
            title: action.pullRequest?.title,
            webUrl: action.pullRequest?.webUrl,
          },
        },
      };

      // Add to the list and sort
      const updatedActions = [...this.modalActions, newRow];
      this.modalActions = this._sortActions(updatedActions);
    }

    // Send message to extension to save
    window.sendMessageToVSCode({
      type: "saveDeploymentAction",
      data: {
        prNumber: prNumber,
        command: JSON.parse(JSON.stringify(action)),
        originalCommand: originalAction
          ? JSON.parse(JSON.stringify(originalAction))
          : null,
        warning: this.notOwnPrWarning,
      },
    });

    // Close modal
    this.showDeploymentActionModal = false;
    this.currentDeploymentAction = null;
    this.isDeploymentActionEditMode = false;
  }

  // Colored status pill + initials avatar of a ticket row
  _ticketDisplayFields(ticket) {
    const authorLabel = ticket.authorLabel || "";
    return {
      statusPillClass: getTicketStatusPillClass(ticket.statusLabel),
      authorInitials: getInitials(authorLabel),
      authorAvatarClass: authorLabel ? getAvatarClass(authorLabel) : "",
    };
  }

  // Colored type/when pills + initials avatar of the pull request author,
  // shared by the aggregated actions and the ones edited in the modal
  _actionDisplayFields(typeCode, whenCode, authorLabel) {
    const author = authorLabel || "";
    return {
      typePillClass: getActionTypePillClass(typeCode),
      whenPillClass: getActionWhenPillClass(whenCode),
      authorLabel: author,
      authorInitials: getInitials(author),
      authorAvatarClass: author ? getAvatarClass(author) : "",
    };
  }

  // Author of the pull request the modal is currently showing (single PR mode)
  _modalPrAuthorLabel() {
    return this.modalPullRequests.length === 1
      ? this.modalPullRequests[0].authorLabel || ""
      : "";
  }

  _aggregateTicketsFromPRs(prs) {
    if (!Array.isArray(prs)) {
      return [];
    }

    const ticketsMap = new Map();

    // Collect all tickets from all PRs, tracking ALL PRs each ticket belongs to
    for (const pr of prs) {
      if (pr.relatedTickets && Array.isArray(pr.relatedTickets)) {
        for (const ticket of pr.relatedTickets) {
          if (ticket && ticket.id) {
            if (!ticketsMap.has(ticket.id)) {
              // First time seeing this ticket - create entry with first PR
              ticketsMap.set(ticket.id, {
                ticketId: ticket.id,
                subject: ticket.subject || "",
                status: ticket.status || "",
                statusLabel: ticket.statusLabel || "",
                author: ticket.author || "",
                authorLabel: ticket.authorLabel || "",
                url: ticket.url || "",
                ...this._ticketDisplayFields(ticket),
                prs: [
                  {
                    number: pr.number,
                    title: pr.title,
                    webUrl: pr.webUrl,
                  },
                ],
              });
            } else {
              // Ticket already exists - add this PR to the list
              const existingTicket = ticketsMap.get(ticket.id);
              existingTicket.prs.push({
                number: pr.number,
                title: pr.title,
                webUrl: pr.webUrl,
              });
            }
          }
        }
      }
    }

    // Convert to array with one row per ticket (multiple PRs shown in same row)
    const ticketRows = [];
    for (const ticketData of ticketsMap.values()) {
      // Sort PRs by number for consistent display
      ticketData.prs.sort((a, b) => {
        const aNum = parseInt(a.number);
        const bNum = parseInt(b.number);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum;
        }
        return String(a.number).localeCompare(String(b.number));
      });

      // Create multi-line PR label (one line per PR)
      const prLabels = ticketData.prs.map(
        (pr) => `#${pr.number || ""} - ${pr.title || ""}`,
      );
      const prLabel = prLabels.join("\n");

      // Use first PR's webUrl for the link (or could omit link if multiple)
      const prWebUrl = ticketData.prs[0]?.webUrl || "";

      ticketRows.push({
        id: ticketData.ticketId,
        subject: ticketData.subject,
        status: ticketData.status,
        statusLabel: ticketData.statusLabel,
        statusPillClass: ticketData.statusPillClass,
        author: ticketData.author,
        authorLabel: ticketData.authorLabel,
        authorInitials: ticketData.authorInitials,
        authorAvatarClass: ticketData.authorAvatarClass,
        url: ticketData.url,
        prLabel: prLabel,
        prWebUrl: prWebUrl,
        prs: ticketData.prs,
      });
    }

    // Sort by ticket ID
    ticketRows.sort((a, b) => {
      const aTicketNum = parseInt(a.id);
      const bTicketNum = parseInt(b.id);
      if (!isNaN(aTicketNum) && !isNaN(bTicketNum)) {
        return aTicketNum - bTicketNum;
      }
      return a.id.localeCompare(b.id);
    });

    return ticketRows;
  }

  get modalTitle() {
    if (this.modalMode === "singlePR" && this.modalPullRequests.length === 1) {
      const pr = this.modalPullRequests[0];
      if (pr.number === -1) {
        return pr.title || this.i18n.pullRequestLabel;
      }
      return `#${pr.number} - ${pr.title || this.i18n.pullRequestLabel}`;
    }
    if (this.explorerMode && this.modalPullRequests.length === 0) {
      return this.i18n.pullRequestsExplorer;
    }
    const prLabel =
      this.prButtonInfo?.pullRequestLabel || this.i18n.pullRequestLabel;
    const count = this.modalPullRequests.length;
    return this.t("prModalTitle", {
      prLabel,
      branch: this.modalBranchName,
      count,
    });
  }

  // Branch-mode modal header parts: "<PR label>s in" + branch chip + count
  // badge (the single string form stays available through modalTitle).
  get modalTitlePrefix() {
    const prLabel =
      this.prButtonInfo?.pullRequestLabel || this.i18n.pullRequestLabel;
    return this.t("prModalTitlePrefix", { prLabel });
  }

  get modalPrCount() {
    return this.modalPullRequests.length;
  }

  // Branch-mode modals use the chip + badge title layout; single-PR modals
  // whose PR is not yet created (number === -1) fall back to the plain title.
  get showBranchModalTitle() {
    return this.modalMode !== "singlePR";
  }

  get showPlainModalTitle() {
    return this.modalMode === "singlePR" && !this.isSinglePRMode;
  }

  get modalPrsTabLabel() {
    const prLabel =
      this.prButtonInfo?.pullRequestLabel || this.i18n.pullRequestLabel;
    const count = this.modalPullRequests.length;
    return this.t("prModalPrsTab", { prLabel, count });
  }

  get modalTicketsTabLabel() {
    const count = this.modalTickets.length;
    return this.t("ticketsTab", { count });
  }

  get modalActionsTabLabel() {
    const count = this.modalActions.length;
    return this.t("deploymentActionsTab", { count });
  }

  get showPRTab() {
    return this.modalMode !== "singlePR";
  }

  get hasBranchPullRequests() {
    return this.modalPullRequests && this.modalPullRequests.length > 0;
  }

  // "Preview release notes" prepares notes for a not-yet-merged source branch,
  // which is meaningless for a top branch (e.g. main/prod), so hide it there.
  get showPreviewReleaseNotes() {
    return this.hasBranchPullRequests && !this.modalIsTopBranch;
  }

  // Selected go-live combobox option (top branches only), if any.
  get _selectedGoLiveOption() {
    if (!this.modalIsTopBranch || !this.selectedGoLiveId) {
      return null;
    }
    return (
      this.modalGoLives.find((g) => g.value === this.selectedGoLiveId) || null
    );
  }

  // The notes buttons state their exact scope. Merging into a top branch (no
  // merge target, e.g. main) is a release/go-live; merging between other major
  // branches (e.g. integ -> uat) is only a promotion, and sfdx-hardis titles
  // that document "Promotion Notes", so the wording matches:
  // - top branch + go-live selected: release notes of that go-live
  // - top branch fallback: release notes of the latest release in the branch
  // - other branches: promotion notes (latest promotion into the branch)
  get generateReleaseNotesLabel() {
    const goLiveOption = this._selectedGoLiveOption;
    if (goLiveOption) {
      let goLive = goLiveOption.label || "";
      if (goLive.length > 50) {
        goLive = goLive.slice(0, 47) + "…";
      }
      return this.t("generateReleaseNotesForGoLive", { goLive });
    }
    if (this.modalIsTopBranch) {
      return this.t("generateReleaseNotesForBranch", {
        branch: this.modalBranchName,
      });
    }
    return this.t("generatePromotionNotes", {
      branch: this.modalBranchName,
    });
  }

  get generateReleaseNotesTitle() {
    const goLiveOption = this._selectedGoLiveOption;
    if (goLiveOption) {
      return this.t("generateReleaseNotesForGoLiveHelp", {
        goLive: goLiveOption.label || "",
        branch: this.modalBranchName,
      });
    }
    if (this.modalIsTopBranch) {
      return this.t("generateReleaseNotesForBranchHelp", {
        branch: this.modalBranchName,
      });
    }
    return this.t("generatePromotionNotesHelp", {
      branch: this.modalBranchName,
    });
  }

  get previewReleaseNotesLabel() {
    return this.t("previewPromotionNotes", {
      branch: this.modalBranchName,
    });
  }

  get previewReleaseNotesTitle() {
    return this.t("previewPromotionNotesHelp", {
      branch: this.modalBranchName,
    });
  }

  // Show the go-lives selector only for top branches that have at least one
  // go-live to choose from.
  get showGoLivesSelector() {
    return this.modalIsTopBranch && this.modalGoLives.length > 0;
  }

  get isSinglePRMode() {
    if (this.modalMode !== "singlePR") {
      return false;
    }
    // Don't show PR-specific features if PR number is -1 (not yet created)
    if (this.modalPullRequests.length === 1) {
      const pr = this.modalPullRequests[0];
      return pr.number !== -1;
    }
    return false;
  }

  get showAddActionButton() {
    return this.modalMode === "singlePR" && !this.modalIsMajorPr;
  }

  // Actions of several Pull Requests listed in one table (branch mode, or a
  // Pull Request between two major branches): read-only, with author and PR
  get modalActionsAggregated() {
    return this.modalMode !== "singlePR" || this.modalIsMajorPr;
  }

  get showMajorPrActionsHint() {
    return this.modalMode === "singlePR" && this.modalIsMajorPr;
  }

  get majorPrActionsHint() {
    if (this.modalIsPromotionPr) {
      const carried =
        (this.modalPullRequests[0] || {}).aggregatedPullRequests || [];
      let hint = this.t("deploymentActionsPromotionHint", {
        branch: this.modalBranchName,
        count: carried.length,
        prList: carried.map((pr) => `#${pr.number}`).join(", ") || "-",
      });
      if (this.modalPromotionUnresolved.length > 0) {
        hint +=
          " " +
          this.t("deploymentActionsPromotionUnresolved", {
            prList: this.modalPromotionUnresolved
              .map((number) => `#${number}`)
              .join(", "),
          });
      }
      return hint;
    }
    return this.t("deploymentActionsAggregatedHint", {
      branch: this.modalBranchName,
    });
  }

  handleAddNewAction() {
    // Create a new empty action with PR info
    if (this.modalPullRequests.length === 1) {
      const pr = this.modalPullRequests[0];
      this.currentDeploymentAction = {
        id: "",
        label: "",
        type: null,
        when: null,
        command: "",
        parameters: {},
        // Match the sfdx-hardis CLI default so the toggle shows what will
        // actually happen instead of appearing off by default
        runOnlyOnceByOrg: true,
        pullRequest: {
          number: pr.number,
          title: pr.title,
          webUrl: pr.webUrl,
        },
      };
      this.isDeploymentActionEditMode = true;
      this.showDeploymentActionModal = true;
    }
  }

  _sortActions(actionRows) {
    // Sort by when (Pre-Deploy first, then Post-Deploy), then by PR number
    return actionRows.sort((a, b) => {
      // First sort by when code
      const whenOrder = { "pre-deploy": 0, "post-deploy": 1, unknown: 2 };
      const whenA = whenOrder[a.whenCode ?? a.when] ?? 2;
      const whenB = whenOrder[b.whenCode ?? b.when] ?? 2;

      if (whenA !== whenB) {
        return whenA - whenB;
      }

      // Then sort by PR number
      const prNumA = parseInt(a.prNumber) || 0;
      const prNumB = parseInt(b.prNumber) || 0;
      return prNumA - prNumB;
    });
  }

  _aggregateActionsFromPRs(prs) {
    if (!Array.isArray(prs)) {
      return [];
    }

    const actionRows = [];

    for (const pr of prs) {
      if (pr.deploymentActions && Array.isArray(pr.deploymentActions)) {
        for (const [orderIndex, action] of pr.deploymentActions.entries()) {
          if (action) {
            const when = action.when;
            const whenLabel = this._getActionWhenLabel(when);
            const typeCode = action.type || "command";
            const typeLabel = this._getActionTypeLabel(typeCode);
            const typeIconName = this._getActionTypeIconName(typeCode);

            // Store full action object for modal
            const fullAction = {
              ...action,
              pullRequest: {
                number: pr.number,
                title: pr.title,
                webUrl: pr.webUrl,
              },
            };

            actionRows.push({
              id: `${pr.number}-${action.type || "action"}-${actionRows.length}`,
              label: action.label || this.i18n.unnamedAction,
              type: typeLabel,
              typeIconName: typeIconName,
              typeCode: typeCode,
              when: whenLabel,
              whenCode: when,
              ...this._actionDisplayFields(typeCode, when, pr.authorLabel),
              prLabel: `#${pr.number} - ${pr.title || ""}`,
              prWebUrl: pr.webUrl || "",
              prNumber: pr.number || 0,
              prTitle: pr.title || "",
              orderIndex,
              _fullAction: fullAction,
            });
          }
        }
      }
    }

    // Use the shared sorting method
    return this._sortActions(actionRows);
  }

  _getActionWhenLabel(whenCode) {
    if (whenCode === "pre-deploy") {
      return this.i18n.preDeploy;
    }
    if (whenCode === "post-deploy") {
      return this.i18n.postDeploy;
    }
    return this.i18n.unknownLabel;
  }

  _getActionTypeLabel(typeCode) {
    return getActionTypeLabel(
      typeCode,
      (labelKey) => this.t(labelKey),
      this.customFunctions,
    );
  }

  _getActionTypeIconName(typeCode) {
    return getActionTypeIconName(typeCode);
  }
}

// Context of a deployment action as stored in its file, "all" when not set
function fullActionContext(row) {
  return row?._fullAction?.context || "all";
}
