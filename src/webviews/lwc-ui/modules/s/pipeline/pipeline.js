/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

export default class Pipeline extends LightningElement {
  @track prButtonInfo;
  @track showGitConnectModal = false;
  // Internal provider id (normalized) used when sending messages
  gitProvider = "gitlab";
  // Selection value in combobox distinguishes cloud vs self-hosted options
  gitProviderSelection = "gitlab.com";
  providerOptions = [
    { label: "GitHub (github.com)", value: "github.com" },
    { label: "GitHub (self-hosted)", value: "github.self" },
    { label: "GitLab (gitlab.com)", value: "gitlab.com" },
    { label: "GitLab (self-hosted)", value: "gitlab.self" },
    { label: "Azure DevOps (azure.dev)", value: "azure.dev" },
    { label: "Azure DevOps (self-hosted)", value: "azure.self" },
    { label: "Bitbucket (bitbucket.org)", value: "bitbucket.org" },
    { label: "Bitbucket (self-hosted)", value: "bitbucket.self" },
  ];
  // Show host input only for self-hosted selections
  showHostInput = false;
  // When true, hide manual inputs and show a single Connect button that triggers native auth
  showNativeConnect = false;
  gitHost = "";
  gitUsername = "";
  gitToken = "";
  isSaving = false;
  saveMessage = "";
  saveMessageClass = "";
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

  openGitConnectModal() {
    // Prefill modal with detected defaults if available
    if (this.defaultGitProvider && !this.gitProvider) {
      this.gitProvider = this.defaultGitProvider;
    }
    if (this.defaultGitHost && !this.gitHost) {
      this.gitHost = this.defaultGitHost;
    }

    // If a cloud provider was detected, switch selection accordingly and hide host input
    if (this.gitProvider === "github") {
      this.gitProviderSelection = "github.com";
      this.showHostInput = false;
    } else if (this.gitProvider === "gitlab") {
      this.gitProviderSelection = "gitlab.com";
      this.showHostInput = false;
    } else if (this.gitProvider === "bitbucket") {
      this.gitProviderSelection = "bitbucket.org";
      this.showHostInput = false;
    } else if (this.gitProvider === "azure") {
      this.gitProviderSelection = "azure.dev";
      this.showHostInput = false;
    }

    // If provider supports VS Code native authentication (cloud variants), show modal with Connect button
    if (this.gitProvider === "github" || this.gitProvider === "azure") {
      this.showNativeConnect = true;
    }

    this.showGitConnectModal = true;
  }

  handleCancelGitModal() {
    this.showGitConnectModal = false;
  }

  handleProviderChange(event) {
    // event.detail.value is selection (cloud vs self-hosted)
    const selection = event.detail.value;
    this.gitProviderSelection = selection;
    // Map selection to normalized provider id and host visibility
    if (selection === "github.com") {
      this.gitProvider = "github";
      this.gitHost = "github.com";
      this.showHostInput = false;
    } else if (selection === "github.self") {
      this.gitProvider = "github";
      this.gitHost = "";
      this.showHostInput = true;
      this.showNativeConnect = false;
    } else if (selection === "gitlab.com") {
      this.gitProvider = "gitlab";
      this.gitHost = "gitlab.com";
      this.showHostInput = false;
      this.showNativeConnect = false;
    } else if (selection === "gitlab.self") {
      this.gitProvider = "gitlab";
      this.gitHost = "";
      this.showHostInput = true;
      this.showNativeConnect = false;
    } else if (selection === "azure.dev") {
      this.gitProvider = "azure";
      this.gitHost = "visualstudio.com";
      this.showHostInput = false;
      // Azure cloud supports native auth via VS Code
      this.showNativeConnect = true;
    } else if (selection === "azure.self") {
      this.gitProvider = "azure";
      this.gitHost = "";
      this.showHostInput = true;
      this.showNativeConnect = false;
    } else if (selection === "bitbucket.org") {
      this.gitProvider = "bitbucket";
      this.gitHost = "bitbucket.org";
      this.showHostInput = false;
      this.showNativeConnect = false;
    } else if (selection === "bitbucket.self") {
      this.gitProvider = "bitbucket";
      this.gitHost = "";
      this.showHostInput = true;
      this.showNativeConnect = false;
    }
  }

  // Trigger native auth flow in the extension (Connect button)
  handleRequestNativeAuth() {
    this.isSaving = true;
    this.saveMessage = "Requesting authentication...";
    this.saveMessageClass = "";
    window.sendMessageToVSCode({ type: "requestNativeAuth", data: { provider: this.gitProvider, host: this.gitHost || undefined } });
  }

  handleHostChange(event) {
    this.gitHost = event.target.value;
  }

  handleUsernameChange(event) {
    this.gitUsername = event.target.value;
  }

  handleTokenChange(event) {
    this.gitToken = event.target.value;
  }

  handleSaveGitCredentials() {
    // Basic client-side validation for host when required
    if (this.showHostInput && this.gitHost) {
      try {
        // eslint-disable-next-line no-new
        new URL(this.gitHost);
      } catch (e) {
        this.saveMessage = "Host URL seems invalid. Please enter a valid URL (https://... ).";
        this.saveMessageClass = "slds-text-color_error";
        return;
      }
    }

    this.isSaving = true;
    this.saveMessage = "Saving credentials...";
    this.saveMessageClass = "";

    // Send credentials to the extension for secure storage via SecretsManager and request server-side host validation
    window.sendMessageToVSCode({
      type: "saveGitCredentials",
      data: {
        provider: this.gitProvider,
        host: this.gitHost || undefined,
        username: this.gitUsername || undefined,
        token: this.gitToken || undefined,
        validateHost: this.showHostInput ? true : false,
      },
    });
  }

  @api
  initialize(data) {
    this.pipelineData = data.pipelineData;
    this.prButtonInfo = data.prButtonInfo;
    // Accept optional defaults for the Connect Git modal
    this.defaultGitProvider = data.defaultGitProvider;
    this.defaultGitHost = data.defaultGitHost;
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
      case "gitCredentialsSaved":
        this.isSaving = false;
        // Close modal immediately on success
        this.saveMessage = "";
        this.saveMessageClass = "";
        this.showGitConnectModal = false;
        break;
      case "gitCredentialsSaveError":
        this.isSaving = false;
        this.saveMessage = data && data.error ? data.error : "Error saving credentials";
        this.saveMessageClass = "slds-text-color_error";
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
