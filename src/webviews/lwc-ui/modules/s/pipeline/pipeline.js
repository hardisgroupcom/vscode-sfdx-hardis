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
  @track openPullRequests = [];
  prColumns = [
    {
      key: "number",
      label: "#",
      fieldName: "number",
      type: "text",
      initialWidth: 80,
      wrapText: true,
    },
    {
      key: "title",
      label: "Title",
      fieldName: "webUrl",
      type: "url",
      typeAttributes: { label: { fieldName: "title" }, target: "_blank" },
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
      initialWidth: 160,
      wrapText: true,
    },
    {
      key: "source",
      label: "Source",
      fieldName: "sourceBranch",
      type: "text",
      initialWidth: 280,
      wrapText: true,
    },
    {
      key: "target",
      label: "Target",
      fieldName: "targetBranch",
      type: "text",
      initialWidth: 180,
      wrapText: true,
    },
  ];

  pipelineData;
  repoInfo;
  error;
  currentDiagram = "";
  lastDiagram = "";
  hasWarnings = false;
  warnings = [];
  showOnlyMajor = false;

  // Dynamically compute the icon URL for the PR button
  get prButtonIconUrl() {
    if (!this.prButtonInfo || !this.prButtonInfo.icon) return null;
    // The icons are copied to /resources/git-icons in the webview root
    return `/resources/git-icons/${this.prButtonInfo.icon}.svg`;
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
    this.pipelineData = data.pipelineData;
    this.repoPlatformLabel = data.repoPlatformLabel || "Git";
    this.prButtonInfo = data.prButtonInfo;
    this.warnings = this.pipelineData.warnings || [];
    this.hasWarnings = this.warnings.length > 0;
    this.showOnlyMajor = false;
    this.currentDiagram = this.pipelineData.mermaidDiagram;
    this.error = undefined;
    this.lastDiagram = "";
    this.gitAuthenticated = data?.gitAuthenticated ?? false;
    this.connectedLabel = this.gitAuthenticated
      ? `Connected to ${this.repoPlatformLabel}`
      : `Connect to ${this.repoPlatformLabel}`;
    this.connectedIconName = this.gitAuthenticated
      ? "utility:check"
      : "utility:link";
    this.connectedVariant = this.gitAuthenticated ? "success" : "neutral";
    this.openPullRequests = this._mapPrsWithIcons(data.openPullRequests || []);
    // ensure reactivity for computed label
    this.openPullRequests = Array.isArray(this.openPullRequests)
      ? this.openPullRequests
      : [];
    // adjust columns to fit the available width immediately
    setTimeout(() => this.adjustPrColumns(), 50);
    // Render the Mermaid diagram after a brief delay to ensure DOM is ready
    setTimeout(() => this.renderMermaid(), 0);
    console.log("Pipeline data initialized:", this.pipelineData);
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
      return copy;
    });
  }

  connectedCallback() {
    this._boundAdjust = this.adjustPrColumns.bind(this);
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", this._boundAdjust);
    }
  }

  disconnectedCallback() {
    if (
      typeof window !== "undefined" &&
      window.removeEventListener &&
      this._boundAdjust
    ) {
      window.removeEventListener("resize", this._boundAdjust);
    }
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
      // Prefer datatable's clientWidth when available (excludes scrollbar) and use smaller padding reservation
      const rawWidth =
        dt && dt.clientWidth
          ? dt.clientWidth
          : rect && rect.width
            ? rect.width
            : null;
      const available = rawWidth ? Math.max(rawWidth, 600) : 800;

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
      })
      .catch((error) => {
        this.error = error?.message || "Mermaid rendering error";
        mermaidDiv.innerHTML = "";
        if (debugDiv) debugDiv.textContent = this.error + "\n" + diagram;
        console.error("Mermaid rendering error:", error);
      });
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

  // Added refreshPipeline method
  refreshPipeline() {
    window.sendMessageToVSCode({
      type: "refreshPipeline",
      data: {},
    });
    console.log("Pipeline refresh event dispatched");
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
}
