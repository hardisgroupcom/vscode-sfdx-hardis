/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

export default class Welcome extends LightningElement {
  @track isLoading = false;
  @track showWelcomeAtStartup = true;
  scrollThreshold = 100; // Hide toggle after scrolling 100px

  connectedCallback() {
    // Add scroll event listener when component is connected
    window.addEventListener("scroll", this.handleScroll.bind(this));
  }

  disconnectedCallback() {
    // Remove scroll event listener when component is disconnected
    window.removeEventListener("scroll", this.handleScroll.bind(this));
  }

  handleScroll() {
    const heroSettings = this.template.querySelector(".hero-settings");
    if (heroSettings) {
      if (window.scrollY > this.scrollThreshold) {
        heroSettings.classList.add("hidden");
      } else {
        heroSettings.classList.remove("hidden");
      }
    }
  }

  @api
  initialize(data) {
    console.log("Welcome component initialized:", data);
    this.isLoading = false;

    // Initialize the setting value
    if (data && data.showWelcomeAtStartup !== undefined) {
      this.showWelcomeAtStartup = data.showWelcomeAtStartup;
    }
  }

  @api
  handleMessage(type, data) {
    console.log("Welcome component received message:", type, data);
    // Handle specific message types if needed
  }

  // Navigation methods for major features
  navigateToOrgsManager() {
    window.sendMessageToVSCode({
      type: "navigateToOrgsManager",
    });
  }

  navigateToPipeline() {
    window.sendMessageToVSCode({
      type: "navigateToPipeline",
    });
  }

  navigateToFilesWorkbench() {
    window.sendMessageToVSCode({
      type: "navigateToFilesWorkbench",
    });
  }

  navigateToOrgMonitoring() {
    window.sendMessageToVSCode({
      type: "navigateToOrgMonitoring",
    });
  }

  navigateToExtensionConfig() {
    window.sendMessageToVSCode({
      type: "navigateToExtensionConfig",
    });
  }

  // Quick action methods
  handleConnectToOrg() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:select",
      },
    });
  }

  // External links
  openDocumentation() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://sfdx-hardis.cloudity.com/",
    });
  }

  openCloudityServices() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://cloudity.com/?ref=sfdxhardis#form",
    });
  }

  // Settings handler
  handleWelcomeSettingChange(event) {
    const newValue = event.target.checked;
    this.showWelcomeAtStartup = newValue;

    // Send message to VS Code to update the setting
    window.sendMessageToVSCode({
      type: "updateSetting",
      data: {
        setting: "vsCodeSfdxHardis.showWelcomeAtStartup",
        value: newValue,
      },
    });
  }
}
