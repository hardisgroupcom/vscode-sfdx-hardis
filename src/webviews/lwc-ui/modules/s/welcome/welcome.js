/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

export default class Welcome extends LightningElement {
  @track isLoading = false;

  @api
  initialize(data) {
    console.log("Welcome component initialized:", data);
    this.isLoading = false;
  }

  @api
  handleMessage(type, data) {
    console.log("Welcome component received message:", type, data);
    // Handle specific message types if needed
  }

  // Navigation methods for major features
  navigateToOrgsManager() {
    window.sendMessageToVSCode({
      type: "navigateToOrgsManager"
    });
  }

  navigateToPipeline() {
    window.sendMessageToVSCode({
      type: "navigateToPipeline"
    });
  }

  navigateToFilesWorkbench() {
    window.sendMessageToVSCode({
      type: "navigateToFilesWorkbench"
    });
  }

  navigateToExtensionConfig() {
    window.sendMessageToVSCode({
      type: "navigateToExtensionConfig"
    });
  }

  navigateToInstalledPackages() {
    window.sendMessageToVSCode({
      type: "navigateToInstalledPackages"
    });
  }

  navigateToDocumentation() {
    window.sendMessageToVSCode({
      type: "navigateToDocumentation"
    });
  }

  // Quick action methods
  handleNewUserStory() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:work:new"
      }
    });
  }

  handlePullFromOrg() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:scratch:pull"
      }
    });
  }

  handleSaveUserStory() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:work:save"
      }
    });
  }

  handleConnectToOrg() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:connect"
      }
    });
  }

  // Additional tools methods
  handleOrgMonitoring() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:monitor:all"
      }
    });
  }

  // External links
  openDocumentation() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://sfdx-hardis.cloudity.com/"
    });
  }

  openTutorials() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/"
    });
  }
}