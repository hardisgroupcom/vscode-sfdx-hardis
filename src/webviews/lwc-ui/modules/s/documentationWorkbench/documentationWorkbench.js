import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

/**
 * Documentation Workbench LWC Component
 *
 * Provides a user-friendly UI for generating and deploying Salesforce project documentation.
 * Commands available:
 *  - Generate documentation (Markdown, with configurable options)
 *  - Deploy to Cloudflare Pages
 *  - Deploy to Salesforce as Static Resource
 *  - Run locally (MkDocs)
 *  - Open configuration panel for advanced options
 */
export default class DocumentationWorkbench extends SharedMixin(
  LightningElement,
) {
  // Panel-level loading state (true until init data arrives from backend)
  @track panelLoading = true;
  @track loadError = null;

  // Generation options (state tracked here, synced with config panel)
  @track generatePdf = false;
  @track generateExcel = false;
  @track withHistory = true;
  @track generatePackagesDoc = true;
  @track generateApexDoc = true;
  @track generateFlowDoc = true;
  @track generatePagesDoc = true;
  @track generateProfilesDoc = true;
  @track generateObjectsDoc = true;
  @track generateAutomationsDoc = true;
  @track generateLwcDoc = true;
  @track docLanguage = ""; // empty = use VS Code language setting
  @track helpUrl = "";

  // jscpd:ignore-start
  // Panel-level three-state render getters
  get isPanelLoading() {
    return this.panelLoading === true && !this.loadError;
  }

  get hasPanelError() {
    return !!this.loadError;
  }

  get isPanelReady() {
    return this.panelLoading !== true && !this.loadError;
  }
  // jscpd:ignore-end

  @api
  initialize(data) {
    data = data || {};

    // jscpd:ignore-start
    // Handle panel-level loading/error state
    if (Object.prototype.hasOwnProperty.call(data, "loading")) {
      this.panelLoading = data.loading === true;
      if (this.panelLoading) {
        this.loadError = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "loadError")) {
      this.loadError = data.loadError || null;
    }
    // jscpd:ignore-end

    // First call only carries {loading:true} — guard all content fields
    if (!Object.prototype.hasOwnProperty.call(data, "helpUrl")) {
      return;
    }

    // Initialize generation options if provided
    if (Object.prototype.hasOwnProperty.call(data, "generatePdf")) {
      this.generatePdf = data.generatePdf;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generateExcel")) {
      this.generateExcel = data.generateExcel;
    }
    if (Object.prototype.hasOwnProperty.call(data, "withHistory")) {
      this.withHistory = data.withHistory;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generatePackagesDoc")) {
      this.generatePackagesDoc = data.generatePackagesDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generateApexDoc")) {
      this.generateApexDoc = data.generateApexDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generateFlowDoc")) {
      this.generateFlowDoc = data.generateFlowDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generatePagesDoc")) {
      this.generatePagesDoc = data.generatePagesDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generateProfilesDoc")) {
      this.generateProfilesDoc = data.generateProfilesDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generateObjectsDoc")) {
      this.generateObjectsDoc = data.generateObjectsDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generateAutomationsDoc")) {
      this.generateAutomationsDoc = data.generateAutomationsDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "generateLwcDoc")) {
      this.generateLwcDoc = data.generateLwcDoc;
    }
    if (Object.prototype.hasOwnProperty.call(data, "docLanguage")) {
      this.docLanguage = data.docLanguage;
    }
    if (Object.prototype.hasOwnProperty.call(data, "helpUrl")) {
      this.helpUrl = data.helpUrl;
    }
  }

  handleRetry() {
    this.loadError = null;
    this.panelLoading = true;
    window.sendMessageToVSCode({ type: "retryInit" });
  }

  @api
  handleMessage(type, data) {
    if (type === "initialize") {
      this.initialize(data);
    } else if (type === "configLoaded") {
      // configLoaded carries real content — apply it as init data clearing loading state
      this.initialize({ ...data, loading: false });
    }
  }

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the SharedMixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }

  // ─── Event handlers ──────────────────────────────────────────────────

  handleOptionChange(event) {
    const name = event.target.name;
    const checked = event.target.checked;
    if (name === "generatePdf") {
      this.generatePdf = checked;
    } else if (name === "generateExcel") {
      this.generateExcel = checked;
    } else if (name === "withHistory") {
      this.withHistory = checked;
    } else if (name === "generatePackagesDoc") {
      this.generatePackagesDoc = checked;
    } else if (name === "generateApexDoc") {
      this.generateApexDoc = checked;
    } else if (name === "generateFlowDoc") {
      this.generateFlowDoc = checked;
    } else if (name === "generatePagesDoc") {
      this.generatePagesDoc = checked;
    } else if (name === "generateProfilesDoc") {
      this.generateProfilesDoc = checked;
    } else if (name === "generateObjectsDoc") {
      this.generateObjectsDoc = checked;
    } else if (name === "generateAutomationsDoc") {
      this.generateAutomationsDoc = checked;
    } else if (name === "generateLwcDoc") {
      this.generateLwcDoc = checked;
    }
  }

  get languageOptions() {
    return [
      { label: this.t("langVsCodeAuto"), value: "" },
      { label: this.t("langEnglish"), value: "en" },
      { label: this.t("langFrench"), value: "fr" },
      { label: this.t("langSpanish"), value: "es" },
      { label: this.t("langGerman"), value: "de" },
      { label: this.t("langJapanese"), value: "ja" },
      { label: this.t("langPortugueseBrazil"), value: "pt-BR" },
      { label: this.t("langItalian"), value: "it" },
    ];
  }

  handleLanguageChange(event) {
    this.docLanguage = event.detail.value;
  }

  get deployToSalesforceDescHtml() {
    return this.t("deployToSalesforceDesc");
  }

  handleGenerate() {
    let command = "sf hardis:doc:project2markdown";
    if (this.generatePdf) {
      command += " --pdf";
    }
    if (this.generateExcel) {
      command += " --excel";
    }
    if (this.withHistory) {
      command += " --with-history";
    }
    if (!this.generatePackagesDoc) {
      command += " --no-generate-packages-doc";
    }
    if (!this.generateApexDoc) {
      command += " --no-generate-apex-doc";
    }
    if (!this.generateFlowDoc) {
      command += " --no-generate-flow-doc";
    }
    if (!this.generatePagesDoc) {
      command += " --no-generate-pages-doc";
    }
    if (!this.generateProfilesDoc) {
      command += " --no-generate-profiles-doc";
    }
    if (!this.generateObjectsDoc) {
      command += " --no-generate-objects-doc";
    }
    if (!this.generateAutomationsDoc) {
      command += " --no-generate-automations-doc";
    }
    if (!this.generateLwcDoc) {
      command += " --no-generate-lwc-doc";
    }
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: command,
        envVars: this.docLanguage
          ? {
              PROMPTS_LANGUAGE: this.docLanguage,
              SFDX_HARDIS_LANG: this.docLanguage,
            }
          : undefined,
      },
    });
  }

  handleDeployCloudflare() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command: "sf hardis:doc:mkdocs-to-cf" },
    });
  }

  handleDeployToConfluence() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command: "sf hardis:doc:mkdocs-to-confluence" },
    });
  }

  handleDeployToOrg() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command: "sf hardis:doc:mkdocs-to-salesforce" },
    });
  }

  handleRunLocally() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "vscode-sfdx-hardis.runLocalHtmlDocPages" },
    });
  }

  handleMoreOptions() {
    window.sendMessageToVSCode({
      type: "openDocConfig",
      data: {
        generatePdf: this.generatePdf,
        generateExcel: this.generateExcel,
        withHistory: this.withHistory,
        generatePackagesDoc: this.generatePackagesDoc,
        generateApexDoc: this.generateApexDoc,
        generateFlowDoc: this.generateFlowDoc,
        generatePagesDoc: this.generatePagesDoc,
        generateProfilesDoc: this.generateProfilesDoc,
        generateObjectsDoc: this.generateObjectsDoc,
        generateAutomationsDoc: this.generateAutomationsDoc,
        generateLwcDoc: this.generateLwcDoc,
      },
    });
  }

  handleOpenHelp() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.helpUrl,
    });
  }
}
