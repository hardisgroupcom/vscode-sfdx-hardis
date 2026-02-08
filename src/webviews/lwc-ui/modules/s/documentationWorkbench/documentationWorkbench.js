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
  @track withHistory = true;

  @api
  initialize(data) {
    if (data) {
      // Initialize generation options if provided
      if (data.generatePdf !== undefined) {
        this.generatePdf = data.generatePdf;
      }
      if (data.withHistory !== undefined) {
        this.withHistory = data.withHistory;
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
    } else if (name === "withHistory") {
      this.withHistory = checked;
    }
  }

  handleGenerate() {
    let command = "sf hardis:doc:project2markdown";
    if (this.generatePdf) {
      command += " --pdf";
    }
    if (this.withHistory) {
      command += " --with-history";
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
        withHistory: this.withHistory,
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
