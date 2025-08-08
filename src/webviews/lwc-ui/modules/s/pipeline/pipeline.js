
import { LightningElement, api } from "lwc";

export default class Pipeline extends LightningElement {
  pipelineData;
  error;
  currentDiagram = "";
  lastDiagram = "";

  showOnlyMajor = false;

  @api
  initialize(data) {
    this.pipelineData = data.pipelineData;
    this.showOnlyMajor = false;
    this.currentDiagram = this.pipelineData.mermaidDiagram;
    this.error = undefined;
    this.lastDiagram = "";
    setTimeout(() => this.renderMermaid(), 0);
    console.log("Pipeline data initialized:", this.pipelineData);
  }

  configureAuth() {
    if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({
        type: 'runCommand',
        data: {
          command: 'sf hardis:project:configure:auth'
        }
      });
    }
    console.log('Configure Auth button clicked');
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
    if (!mermaidDiv) {
      this.error = "Mermaid container not found in template.";
      if (debugDiv) debugDiv.textContent = this.error;
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
              console.log('Unknown message type:', messageType, data);
      }
  }
  
  // Added refreshPipeline method
  refreshPipeline() {
    if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
        window.sendMessageToVSCode({
              type: 'refreshpipeline',
              data: {}
        });
    }
    console.log("Pipeline refresh event dispatched");
  }
}
