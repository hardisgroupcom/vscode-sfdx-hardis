/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";

export default class Pipeline extends LightningElement {
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
  @track currentBranchPullRequest = null;
  @track openPullRequests = [];
  @track displayFeatureBranches = false;
  @track loading = false;
  @track projectApexScripts = [];
  @track projectSfdmuWorkspaces = [];
  _refreshTimer = null;
  _isVisible = true;
  _isAutoRefresh = false;
  @track images = {};
  prColumns = [
    {
      key: "number",
      label: "#",
      fieldName: "webUrl",
      type: "url",
      typeAttributes: { label: { fieldName: "number" }, target: "_blank" },
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
    // Jobs status column (emoji indicator) - clickable, uses PR webUrl but shows emoji as label
    {
      key: "status",
      label: "",
      fieldName: "webUrl",
      type: "url",
      initialWidth: 32,
      wrapText: false,
      typeAttributes: {
        label: { fieldName: "jobsStatusEmoji" },
        target: "_blank",
      },
      cellAttributes: { class: "hardis-emoji-cell" },
    },
    {
      key: "author",
      label: "Author",
      fieldName: "authorLabel",
      type: "text",
      wrapText: true,
    },
    {
      key: "source",
      label: "Source",
      fieldName: "sourceBranch",
      type: "text",
      wrapText: true,
    },
    {
      key: "target",
      label: "Target",
      fieldName: "targetBranch",
      type: "text",
      wrapText: true,
    },
  ];

  // Columns for modal PR display (without jobs status, with merge date)
  modalPrColumns = [
    {
      key: "number",
      label: "#",
      fieldName: "number",
      type: "text",
      initialWidth: 40,
      wrapText: true,
    },
    {
      key: "title",
      label: "Title",
      fieldName: "webUrl",
      type: "url",
      typeAttributes: { label: { fieldName: "title" }, target: "_blank" },
      initialWidth: 300,
      wrapText: true,
    },
    {
      key: "author",
      label: "Author",
      fieldName: "authorLabel",
      type: "text",
      wrapText: true,
    },
    {
      key: "mergeDate",
      label: "Merged",
      fieldName: "mergeDateFormatted",
      type: "text",
      wrapText: true,
      initialWidth: 100,
    },
    {
      key: "source",
      label: "Source",
      fieldName: "sourceBranch",
      type: "text",
      wrapText: true,
      initialWidth: 200,
    },
    {
      key: "target",
      label: "Target",
      fieldName: "targetBranch",
      type: "text",
      wrapText: true,
    },
  ];

  modalTicketColumns = [];

  // Compute actions columns to dynamically set Pull Request label
  get computedModalActionsColumns() {
    const columns = [
      {
        key: "label",
        label: "Label",
        fieldName: "label",
        type: "button",
        typeAttributes: {
          label: { fieldName: "label" },
          name: "view_action",
          variant: "base",
        },
        wrapText: true,
      },
      {
        key: "type",
        label: "Type",
        fieldName: "type",
        type: "text",
        wrapText: true,
        initialWidth: 150,
      },
      {
        key: "when",
        label: "When",
        fieldName: "when",
        type: "text",
        wrapText: true,
        initialWidth: 120,
      },
    ];

    // Only show PR column in branch mode
    if (this.modalMode !== "singlePR") {
      columns.push({
        key: "pullRequest",
        label: this.prButtonInfo?.pullRequestLabel || "Pull Request",
        fieldName: "prWebUrl",
        type: "url",
        typeAttributes: { label: { fieldName: "prLabel" }, target: "_blank" },
        wrapText: true,
      });
    }

    return columns;
  }

  // Compute ticket columns based on authentication state
  get computedModalTicketColumns() {
    const columns = [
      {
        key: "id",
        label: "ID",
        fieldName: "url",
        type: "url",
        typeAttributes: { label: { fieldName: "id" }, target: "_blank" },
        wrapText: true,
      },
    ];

    // Only show subject, status, and author if ticketing provider is authenticated
    if (this.ticketAuthenticated) {
      columns.push(
        {
          key: "subject",
          label: "Subject",
          fieldName: "subject",
          type: "text",
          wrapText: true,
        },
        {
          key: "status",
          label: "Status",
          fieldName: "statusLabel",
          type: "text",
          wrapText: true,
        },
        {
          key: "author",
          label: "Author",
          fieldName: "authorLabel",
          type: "text",
          wrapText: true,
        },
      );
    }

    // Only show PR column in branch mode (not in singlePR mode)
    if (this.modalMode !== "singlePR") {
      columns.push({
        key: "pullRequest",
        label: this.prButtonInfo?.pullRequestLabel || "Pull Request",
        fieldName: "prWebUrl",
        type: "url",
        typeAttributes: { label: { fieldName: "prLabel" }, target: "_blank" },
        wrapText: true,
      });
    }

    return columns;
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
  modalMode = "branch"; // "branch" or "singlePR"
  modalBranchName = "";
  modalPullRequests = [];
  modalTickets = [];
  modalActions = [];
  branchPullRequestsMap = new Map();

  // Apex tests modal state (per-PR)
  availableApexTestClasses = [];
  deploymentApexTestClasses = [];
  _deploymentApexTestClassesOriginal = [];
  apexTestsMode = "view"; // 'view' | 'edit'
  apexTestsByLineRows = [];

  get apexTestsByLineColumns() {
    return [
      {
        key: "apexTestClass",
        label: "Apex Test Class",
        fieldName: "apexTestClass",
        type: "text",
        wrapText: true,
      },
      {
        key: "pullRequest",
        label: this.prButtonInfo?.pullRequestLabel || "Pull Request",
        fieldName: "prWebUrl",
        type: "url",
        typeAttributes: { label: { fieldName: "prLabel" }, target: "_blank" },
        wrapText: true,
      },
    ];
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
    return [
      {
        key: "apexTestClass",
        label: "Apex Test Class",
        fieldName: "apexTestClass",
        type: "text",
        wrapText: true,
      },
      {
        key: "pullRequest",
        label: this.prButtonInfo?.pullRequestLabel || "Pull Request",
        fieldName: "prWebUrl",
        type: "url",
        typeAttributes: { label: { fieldName: "prLabel" }, target: "_blank" },
        wrapText: true,
      },
    ];
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
    if (key && this.images && this.images[key.toLowerCase()]) {
      return this.images[key.toLowerCase()];
    }
    // fallback to a neutral link icon if none available
    return this.images["git"];
  }

  get ticketProviderIconUrl() {
    const key = (this.ticketProviderName || "").toLowerCase();
    if (key && this.images && this.images[key]) {
      return this.images[key];
    }
    // default ticket icon (jira) if available
    return this.images["ticket"];
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

  get currentPrCardClasses() {
    return `command-card${this.hasCurrentBranchPullRequest ? "" : " disabled"}`;
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
    this.loading = this._isAutoRefresh ? false : false;
    this._isAutoRefresh = false;
    this.pipelineData = data.pipelineData;
    this.repoPlatformLabel = data.repoPlatformLabel || "Git";
    this.prButtonInfo = data.prButtonInfo;
    this.warnings = this.pipelineData.warnings || [];
    this.hasWarnings = this.warnings.length > 0;
    this.showOnlyMajor = false;
    this.displayFeatureBranches = data?.displayFeatureBranches ?? false;
    this.enableDeploymentApexTestClasses =
      !!data?.enableDeploymentApexTestClasses;
    this.availableApexTestClasses = Array.isArray(
      data?.availableApexTestClasses,
    )
      ? data.availableApexTestClasses
      : [];

    // Store branch PR data for modal display
    this.branchPullRequestsMap = new Map();
    if (this.pipelineData && this.pipelineData.orgs) {
      for (const org of this.pipelineData.orgs) {
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
    // Select diagram based on displayFeatureBranches toggle
    this.currentDiagram = this.displayFeatureBranches
      ? this.pipelineData.mermaidDiagram
      : this.pipelineData.mermaidDiagramMajor;
    this.error = undefined;
    this.lastDiagram = "";
    this.gitAuthenticated = data?.gitAuthenticated ?? false;
    this.connectedLabel = this.gitAuthenticated
      ? `Connected to ${this.repoPlatformLabel}`
      : `Connect to ${this.repoPlatformLabel}`;
    this.connectedIconName = this.gitAuthenticated
      ? "utility:check"
      : "utility:link";

    // Update ticketing authentication state
    this.ticketAuthenticated = data?.ticketAuthenticated ?? false;
    this.ticketProviderName = data?.ticketProviderName || "Ticketing";
    this.ticketConnectedLabel = this.ticketAuthenticated
      ? `Connected to ${this.ticketProviderName}`
      : `Connect to ${this.ticketProviderName}`;
    this.ticketConnectedIconName = this.ticketAuthenticated
      ? "utility:check"
      : "utility:link";
    this.ticketConnectedVariant = this.ticketAuthenticated
      ? "success"
      : "neutral";

    this.openPullRequests = this._mapPrsWithIcons(data.openPullRequests || []);
    // ensure reactivity for computed label
    this.openPullRequests = Array.isArray(this.openPullRequests)
      ? this.openPullRequests
      : [];
    // Store current branch PR
    this.currentBranchPullRequest = data.currentBranchPullRequest || null;
    // Store project resources
    this.projectApexScripts = data.projectApexScripts || [];
    this.projectSfdmuWorkspaces = data.projectSfdmuWorkspaces || [];
    // adjust columns to fit the available width immediately
    setTimeout(() => this.adjustPrColumns(), 50);
    // Render the Mermaid diagram after a brief delay to ensure DOM is ready
    setTimeout(() => this.renderMermaid(), 0);
    console.log("Pipeline data initialized:", this.pipelineData);
    // Update panel title with PR count
    this._updatePanelTitle();
    // Start auto-refresh timer
    this._startAutoRefresh();
    if (data.firstDisplay) {
      this.refreshPipeline();
    }
  }

  get prLabel() {
    return this.prButtonInfo?.pullRequestLabel || "Pull Request";
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
    return `Apex Tests (${count}) (beta)`;
  }

  get canEditApexTestsInModal() {
    return this.modalMode === "singlePR" && this.modalPullRequests.length === 1;
  }

  normalizeApexTestClasses(list) {
    const raw = Array.isArray(list) ? list : [];
    const seen = new Set();
    const out = [];
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
      // Add a SLDS-friendly emoji indicator column (quick, robust fallback)
      const emojiMap = {
        running: "⚙️",
        pending: "⏳",
        success: "✅",
        failed: "❌",
        unknown: "❔",
      };
      // Show emoji only (accessibility: we may add a visually-hidden label later if needed)
      copy.jobsStatusEmoji = emojiMap[normalized] || emojiMap.unknown;

      // Format merge date for display
      if (pr.mergeDate) {
        try {
          const date = new Date(pr.mergeDate);
          copy.mergeDateFormatted = date.toLocaleString();
        } catch (e) {
          copy.mergeDateFormatted = pr.mergeDate;
        }
      } else {
        copy.mergeDateFormatted = "";
      }

      return copy;
    });
  }

  connectedCallback() {
    this._boundAdjust = this.adjustPrColumns.bind(this);
    this._boundVisibilityChange = this._handleVisibilityChange.bind(this);
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", this._boundAdjust);
      document.addEventListener(
        "visibilitychange",
        this._boundVisibilityChange,
      );
    }
    this._isVisible = !document.hidden;
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
    // Clean up auto-refresh timer
    this._stopAutoRefresh();
  }

  adjustPrColumns() {
    try {
      const dt = this.template.querySelector("lightning-datatable");
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
      const minStatus = 36;
      const minAuthor = 140;
      const minSource = 220;
      const minTarget = 140;

      // Sum of minimums
      const sumMin =
        minNumber + minStatus + minAuthor + minSource + minTarget + 120; // 120 is a sensible minimum for title
      // We'll compute float widths first, then convert to integers and distribute rounding
      const absMin = {
        number: 40,
        status: 24,
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
        else if (k === "status" || k === "jobsStatusEmoji")
          copy.initialWidth = statusW;
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
    const prLabel = this.prButtonInfo?.pullRequestLabel
      ? this.prButtonInfo.pullRequestLabel + "s"
      : "Pull Requests";
    return count > 0 ? `Open ${prLabel} (${count})` : `Open ${prLabel}`;
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

      // Get the text content from the label (may be nested in foreignObject/div/span/p/a)
      const labelText = label.textContent || "";

      // Check for running (🔄) or pending (⏳) emoji
      const hasRunning = labelText.includes("🔄");
      const hasPending = labelText.includes("⏳");

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

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "refreshPipeline":
        this.refreshPipeline();
        break;
      case "openPullRequestsUpdated":
        // allow dynamic updates from extension host
        this.openPullRequests = this._mapPrsWithIcons(data || []);
        setTimeout(() => this.adjustPrColumns(), 50);
        this._updatePanelTitle();
        break;
      default:
        console.log("Unknown message type:", messageType, data);
    }
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
    this.loading = !isAutoRefresh;
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
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:scratch:pull",
      },
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

  handleGitConnect() {
    window.sendMessageToVSCode({
      type: "connectToGit",
      data: {},
    });
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
    const interval = this._isVisible ? 60000 : 300000; // 60s or 300s

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
    const baseTitle = "DevOps Pipeline";
    const title = prCount > 0 ? `${baseTitle} (${prCount})` : baseTitle;

    window.sendMessageToVSCode({
      type: "updatePanelTitle",
      data: { title: title },
    });
  }
}
