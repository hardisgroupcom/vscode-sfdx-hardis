/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

export default class Pipeline extends LightningElement {
  @track prButtonInfo;
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
  images = {};
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
        running: "🔄",
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

  get currentPRCardTitle() {
    const prLabel = this.prButtonInfo?.pullRequestLabel || "Pull Request";
    return `My ${prLabel}`;
  }

  get currentPRDescription() {
    if (!this.currentBranchPullRequest) {
      return "You need to connect to your Git Server to see pull request details.";
    }
    return `#${this.currentBranchPullRequest.number} - ${this.currentBranchPullRequest.title || ""}. Click to see related tickets and manage deployment actions.`;
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

        // Catch clicks on Nodes
        const mermaidSvg = this.template.querySelector(".mermaid svg");
        if (mermaidSvg) {
          mermaidSvg.addEventListener("click", (event) => {
            const target = event.target;
            // Get node where the click happened
            const mermaidNode = target.closest("g.node");
            if (!mermaidNode) {
              return;
            }
            const targetId = mermaidNode.getAttribute("id") || "";
            // Extract branch name from id (id example: from "flowchart-uatBranch-6" extract "uat" without "Branch")
            const branchMatch = targetId.match(/flowchart-(.+?)(Branch)?-\d+/);
            if (branchMatch && branchMatch[1]) {
              const branchName = branchMatch[1];
              this.handleShowBranchPRs(branchName);
            }
          });
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
      case "imageResources":
        this.handleImageResources(data);
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
      default:
        console.log("Unknown message type:", messageType, data);
    }
  }

  handleImageResources(data) {
    if (data && data?.images) {
      // Normalize keys to lowercase for easy lookup (e.g., GitHub -> github)
      const normalized = {};
      for (const [key, url] of Object.entries(data.images)) {
        if (!key) {
          continue;
        }
        normalized[key.toLowerCase()] = url;
      }
      // merge into existing images map
      this.images = Object.assign({}, this.images || {}, normalized);
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

  handleTicketConnect() {
    window.sendMessageToVSCode({
      type: "connectToTicketing",
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

  handleShowBranchPRs(branchName) {
    console.log("Showing PRs for branch:", branchName);
    const prs = this.branchPullRequestsMap.get(branchName);
    if (prs && prs.length > 0) {
      this.modalBranchName = branchName;
      this.modalPullRequests = this._mapPrsWithIcons(prs);

      // Aggregate all tickets from all PRs
      this.modalTickets = this._aggregateTicketsFromPRs(prs);

      // Aggregate all deployment actions from all PRs
      this.modalActions = this._aggregateActionsFromPRs(prs);

      this.showPRModal = true;
      console.log("Modal data:", {
        branchName,
        prCount: prs.length,
        ticketCount: this.modalTickets.length,
        actionCount: this.modalActions.length,
      });
    } else {
      console.warn("No PRs found for branch:", branchName);
    }
  }

  handleClosePRModal() {
    this.showPRModal = false;
    this.modalMode = "branch";
    this.modalBranchName = "";
    this.modalPullRequests = [];
    this.modalTickets = [];
    this.modalActions = [];
  }

  handlePRRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    
    if (action.name === "view_pr" && row) {
      // Find the full PR object
      const pr = this.openPullRequests.find(p => p.id === row.id);
      if (pr) {
        this.showSinglePRModal(pr);
      }
    }
  }

  handleOpenCurrentPR() {
    if (this.currentBranchPullRequest) {
      // Open modal in singlePR mode with current branch PR
      this.showSinglePRModal(this.currentBranchPullRequest);
    }
  }

  showSinglePRModal(pr) {
    // Call VsCode backend to get PR info with tickets and actions
    window.sendMessageToVSCode({
      type: "getPrInfoForModal",
      data: {
        pullRequest: JSON.parse(JSON.stringify(pr)),
      },
    });
  }

  handleReturnGetPrInfoForModal(pr) {
    this.modalMode = "singlePR";
    this.modalBranchName = pr.sourceBranch || "";
    this.modalPullRequests = [pr];
    
    // Aggregate tickets from this single PR
    this.modalTickets = this._aggregateTicketsFromPRs([pr]);
    
    // Aggregate deployment actions from this single PR
    this.modalActions = this._aggregateActionsFromPRs([pr]);
    
    this.showPRModal = true;
  }

  handleActionRowClick(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    
    if (!action || !row) {
      return;
    }

    // Handle the view_action button click
    if (action.name === "view_action") {
      // Find the full action object
      const actionRow = this.modalActions.find(a => a.id === row.id);
      if (!actionRow || !actionRow._fullAction) {
        return;
      }

      // Show deployment action modal inline
      this.currentDeploymentAction = actionRow._fullAction;
      this.isDeploymentActionEditMode = false;
      this.showDeploymentActionModal = true;
    }
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
    const action = event.detail;
    // Get PR number from the action
    const prNumber = action.pullRequest?.number;
    if (!prNumber) {
      console.error("Cannot save deployment action: PR number not found");
      return;
    }
    
    const when = action.when;
    const whenLabel = when === "pre-deploy" ? "Pre-Deploy" :
                     when === "post-deploy" ? "Post-Deploy" : "Unknown";
    
    // Update the modalActions list immediately with the new values
    const actionIndex = this.modalActions.findIndex(
      a => a._fullAction && a._fullAction.id === action.id && a.prNumber === prNumber
    );
    
    if (actionIndex >= 0) {
      // Update existing action
      const updatedRow = {
        ...this.modalActions[actionIndex],
        label: action.label || "Unnamed Action",
        type: action.type || "command",
        when: whenLabel,
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
        ...this.modalActions.slice(actionIndex + 1)
      ];
      
      // Sort the actions (Pre-Deploy first, then Post-Deploy)
      this.modalActions = this._sortActions(updatedActions);
    } else {
      // Add new action to the list
      const newRow = {
        id: `${prNumber}-${action.type || "action"}-${this.modalActions.length}`,
        label: action.label || "Unnamed Action",
        type: action.type || "command",
        when: whenLabel,
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
      },
    });
    
    // Close modal
    this.showDeploymentActionModal = false;
    this.currentDeploymentAction = null;
    this.isDeploymentActionEditMode = false;
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
        author: ticketData.author,
        authorLabel: ticketData.authorLabel,
        url: ticketData.url,
        prLabel: prLabel,
        prWebUrl: prWebUrl,
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
      return `#${pr.number} - ${pr.title || "Pull Request"}`;
    }
    const prLabel = this.prButtonInfo?.pullRequestLabel || "Pull Request";
    const count = this.modalPullRequests.length;
    return `${prLabel}s in ${this.modalBranchName} (${count})`;
  }

  get modalPrsTabLabel() {
    const prLabel = this.prButtonInfo?.pullRequestLabel || "Pull Request";
    const count = this.modalPullRequests.length;
    return `${prLabel}s (${count})`;
  }

  get modalTicketsTabLabel() {
    const count = this.modalTickets.length;
    return `Tickets (${count})`;
  }

  get modalActionsTabLabel() {
    const count = this.modalActions.length;
    return `Deployment Actions (${count}) (beta)`;
  }

  get showPRTab() {
    return this.modalMode !== "singlePR";
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

  get singlePRViewButtonLabel() {
    if (this.modalPullRequests.length === 1) {
      const pr = this.modalPullRequests[0];
      const gitProvider = this.repoPlatformLabel || "Git";
      return `View #${pr.number} - ${pr.title || ""} on ${gitProvider}`;
    }
    return "View Pull Request";
  }

  handleOpenSinglePRUrl(event) {
    event.preventDefault();
    if (this.modalPullRequests.length === 1) {
      const pr = this.modalPullRequests[0];
      if (pr.webUrl) {
        window.sendMessageToVSCode({
          type: "openExternal",
          data: { url: pr.webUrl },
        });
      }
    }
  }

  get showAddActionButton() {
    return this.modalMode === "singlePR";
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
      // First sort by when label
      const whenOrder = { "Pre-Deploy": 0, "Post-Deploy": 1, "Unknown": 2 };
      const whenA = whenOrder[a.when] ?? 2;
      const whenB = whenOrder[b.when] ?? 2;
      
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
        for (const action of pr.deploymentActions) {
          if (action) {
            const when = action.when;
            const whenLabel = when === "pre-deploy" ? "Pre-Deploy" :
                             when === "post-deploy" ? "Post-Deploy" : "Unknown";
            
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
              label: action.label || "Unnamed Action",
              type: action.type || "command",
              when: whenLabel,
              prLabel: `#${pr.number} - ${pr.title || ""}`,
              prWebUrl: pr.webUrl || "",
              prNumber: pr.number || 0,
              _fullAction: fullAction,
            });
          }
        }
      }
    }

    // Use the shared sorting method
    return this._sortActions(actionRows);
  }
}
