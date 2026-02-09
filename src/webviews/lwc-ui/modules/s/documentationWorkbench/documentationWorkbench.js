import { LightningElement, api, track } from "lwc";

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
export default class DocumentationWorkbench extends LightningElement {
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

  @api
  initialize(data) {
    if (data) {
      // Initialize generation options if provided
      if (data.generatePdf !== undefined) {
        this.generatePdf = data.generatePdf;
      }
      if (data.generateExcel !== undefined) {
        this.generateExcel = data.generateExcel;
      }
      if (data.withHistory !== undefined) {
        this.withHistory = data.withHistory;
      }
      if (data.generatePackagesDoc !== undefined) {
        this.generatePackagesDoc = data.generatePackagesDoc;
      }
      if (data.generateApexDoc !== undefined) {
        this.generateApexDoc = data.generateApexDoc;
      }
      if (data.generateFlowDoc !== undefined) {
        this.generateFlowDoc = data.generateFlowDoc;
      }
      if (data.generatePagesDoc !== undefined) {
        this.generatePagesDoc = data.generatePagesDoc;
      }
      if (data.generateProfilesDoc !== undefined) {
        this.generateProfilesDoc = data.generateProfilesDoc;
      }
      if (data.generateObjectsDoc !== undefined) {
        this.generateObjectsDoc = data.generateObjectsDoc;
      }
      if (data.generateAutomationsDoc !== undefined) {
        this.generateAutomationsDoc = data.generateAutomationsDoc;
      }
      if (data.generateLwcDoc !== undefined) {
        this.generateLwcDoc = data.generateLwcDoc;
      }
    }
  }

  @api
  handleMessage(type, data) {
    if (type === "initialize") {
      this.initialize(data);
    }
  }

  // ─── Event handlers ──────────────────────────────────────────────────

  handleOptionChange(event) {
    const name = event.target.name;
    const checked = event.target.checked;
    if (name === "generatePdf") {
      this.generatePdf = checked;
    }
    else if (name === "generateExcel") {
      this.generateExcel = checked;
    }
    else if (name === "withHistory") {
      this.withHistory = checked;
    }
    else if (name === "generatePackagesDoc") {
      this.generatePackagesDoc = checked;
    }
    else if (name === "generateApexDoc") {
      this.generateApexDoc = checked;
    }
    else if (name === "generateFlowDoc") {
      this.generateFlowDoc = checked;
    }
    else if (name === "generatePagesDoc") {
      this.generatePagesDoc = checked;
    }
    else if (name === "generateProfilesDoc") {
      this.generateProfilesDoc = checked;
    }
    else if (name === "generateObjectsDoc") {
      this.generateObjectsDoc = checked;
    }
    else if (name === "generateAutomationsDoc") {
      this.generateAutomationsDoc = checked;
    }
    else if (name === "generateLwcDoc") {
      this.generateLwcDoc = checked;
    }
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
      data: { command: command },
    });
  }

  handleDeployCloudflare() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command: "sf hardis:doc:mkdocs-to-cf" },
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
      data: "https://sfdx-hardis.cloudity.com/salesforce-project-documentation/",
    });
  }
}
