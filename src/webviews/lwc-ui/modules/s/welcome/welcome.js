/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { ColorThemeMixin } from "s/colorThemeMixin";

export default class Welcome extends ColorThemeMixin(LightningElement) {
  @track isLoading = false;
  @track showWelcomeAtStartup = true;
  @track colorThemeConfig = "auto";
  @track themeVariants = { light: "neutral", dark: "neutral", auto: "brand" };
 
  @track setupHidden = false;
  scrollThreshold = 100; // Hide toggle after scrolling 100px
  
  connectedCallback() {
    // Bind handler once so we can remove it later
    this._boundHandleScroll = this.handleScroll.bind(this);
    window.addEventListener("scroll", this._boundHandleScroll);
  }

  disconnectedCallback() {
    window.removeEventListener("scroll", this._boundHandleScroll);
  }

  handleScroll() {
    // hide the setup button areas when scrolling past threshold
    const shouldHide = window.scrollY > this.scrollThreshold;
    this.setupHidden = shouldHide;

    const heroElements = this.template.querySelectorAll(".hero-settings, .hero-top-left, .hero-bottom-right");
    heroElements.forEach((element) => {
      element.classList.toggle("hidden", shouldHide);
    });
  }

  @api
  initialize(data) {
    console.log("Welcome component initialized:", data);
    this.isLoading = false;

    // Initialize the setting value
    if (data && data.showWelcomeAtStartup !== undefined) {
      this.showWelcomeAtStartup = data.showWelcomeAtStartup;
    }
    if (data && data.colorThemeConfig) {
      this.setColorThemeVariants(data.colorThemeConfig);
    }
  }
  
  setColorThemeVariants(colorThemeConfig) {
    this.themeVariants.light = (colorThemeConfig === "light") ? "brand" : "neutral";
    this.themeVariants.dark = (colorThemeConfig === "dark") ? "brand" : "neutral";
    this.themeVariants.auto = (colorThemeConfig === "auto") ? "brand" : "neutral";
  }

  @api
  handleMessage(type, data) {
    console.log("Welcome component received message:", type, data);
    // Handle specific message types if needed
  }

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the ColorThemeMixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }

  // Navigation methods for major features
  navigateToOrgsManager() {
    window.sendMessageToVSCode({
      type: "navigateToOrgsManager",
    });
  }

  navigateToSetup() {
    window.sendMessageToVSCode({
      type: "navigateToSetup",
    });
  }

  navigateToPipeline() {
    window.sendMessageToVSCode({
      type: "navigateToPipeline",
    });
  }

  navigateToMetadataRetriever() {
    window.sendMessageToVSCode({
      type: "navigateToMetadataRetriever",
    });
  }

  navigateToFilesWorkbench() {
    window.sendMessageToVSCode({
      type: "navigateToFilesWorkbench",
    });
  }

  navigateToDataWorkbench() {
    window.sendMessageToVSCode({
      type: "navigateToDataWorkbench",
    });
  }

  navigateToOrgMonitoring() {
    window.sendMessageToVSCode({
      type: "navigateToOrgMonitoring",
    });
  }

  navigateToDocumentationWorkbench() {
    window.sendMessageToVSCode({
      type: "navigateToDocumentationWorkbench",
    });
  }

  navigateToExtensionConfig() {
    window.sendMessageToVSCode({
      type: "navigateToExtensionConfig",
    });
  }

  navigateToRunAnonymousApex() {
    window.sendMessageToVSCode({
      type: "navigateToRunAnonymousApex",
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
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "vsCodeSfdxHardis.showWelcomeAtStartup",
        value: newValue,
      },
    });
  }

  // Settings handler
  handleThemeChange(event) {
    const button = event.target;
    let colorThemeConfig = button.name;
    this.setColorThemeVariants(colorThemeConfig);

    // Send message to VS Code to update the setting
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "vsCodeSfdxHardis.theme.colorTheme",
        value: colorThemeConfig,
      },
    });
  }
}