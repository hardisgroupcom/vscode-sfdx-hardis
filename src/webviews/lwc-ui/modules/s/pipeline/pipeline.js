/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

export default class Pipeline extends LightningElement {
  @track prButtonInfo;
  pipelineData;
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
    this.prButtonInfo = data.prButtonInfo;
    this.warnings = this.pipelineData.warnings || [];
    this.hasWarnings = this.warnings.length > 0;
    this.showOnlyMajor = false;
    this.currentDiagram = this.pipelineData.mermaidDiagram;
    this.error = undefined;
    this.lastDiagram = "";
    setTimeout(() => this.renderMermaid(), 0);
    console.log("Pipeline data initialized:", this.pipelineData);
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

  handleShowPipelineConfig() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: {
        command: "vscode-sfdx-hardis.showPipelineConfig",
        args: [],
      },
    });
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
      type: "refreshpipeline",
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
}
