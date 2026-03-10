/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

export default class Welcome extends SharedMixin(LightningElement) {
  @track isLoading = false;
  @track showWelcomeAtStartup = true;
  @track colorThemeConfig = "auto";
  @track themeVariants = { light: "neutral", dark: "neutral", auto: "brand" };
  @track langSetting = "auto";
  @track langDropdownOpen = false;
  @track themeDropdownOpen = false;
  @track bannerImageUrl = "";
  @track websiteUrl = "";
  @track docsiteUrl = "";
  @track contributersUrl = "";
  @track contactFormUrl = "";

  @track setupHidden = false;
  scrollThreshold = 100; // Hide toggle after scrolling 100px

  connectedCallback() {
    super.connectedCallback();
    // Bind handler once so we can remove it later
    this._boundHandleScroll = this.handleScroll.bind(this);
    this._boundHandleOutsideClick = this.handleOutsideClick.bind(this);
    window.addEventListener("scroll", this._boundHandleScroll);
  }

  disconnectedCallback() {
    window.removeEventListener("scroll", this._boundHandleScroll);
    document.removeEventListener("click", this._boundHandleOutsideClick);
  }

  handleOutsideClick(event) {
    if (!this.template.contains(event.target)) {
      this.langDropdownOpen = false;
      this.themeDropdownOpen = false;
      document.removeEventListener("click", this._boundHandleOutsideClick);
    }
  }

  handleScroll() {
    // hide the setup button areas when scrolling past threshold
    const shouldHide = window.scrollY > this.scrollThreshold;
    this.setupHidden = shouldHide;

    const heroElements = this.template.querySelectorAll(
      ".hero-settings, .hero-top-left",
    );
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
      this.colorThemeConfig = data.colorThemeConfig;
      this.setColorThemeVariants(data.colorThemeConfig);
    }
    if (data && data.langSetting) {
      this.langSetting = data.langSetting;
    }
    if (data && data.bannerImageUrl) {
      this.bannerImageUrl = data.bannerImageUrl;
    }
    if (data && data.websiteUrl) {
      this.websiteUrl = data.websiteUrl;
    }
    if (data && data.docsiteUrl) {
      this.docsiteUrl = data.docsiteUrl;
    }
    if (data && data.contributersUrl) {
      this.contributersUrl = data.contributersUrl;
    }
    if (data && data.contactFormUrl) {
      this.contactFormUrl = data.contactFormUrl;
    }
  }

  setColorThemeVariants(colorThemeConfig) {
    this.themeVariants.light =
      colorThemeConfig === "light" ? "brand" : "neutral";
    this.themeVariants.dark = colorThemeConfig === "dark" ? "brand" : "neutral";
    this.themeVariants.auto = colorThemeConfig === "auto" ? "brand" : "neutral";
  }

  @api
  handleMessage(type, data) {
    console.log("Welcome component received message:", type, data);
  }

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the SharedMixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }

  get currentLangFlagSrc() {
    const map = {
      auto: "flagGlobe",
      en: "flagEn",
      es: "flagEs",
      fr: "flagFr",
      ja: "flagJa",
    };
    const key = map[this.langSetting] || "flagGlobe";
    return this.getImageUrl(key, "flagGlobe");
  }

  get flagGlobeSrc() {
    return this.getImageUrl("flagGlobe");
  }

  get flagEnSrc() {
    return this.getImageUrl("flagEn");
  }

  get flagEsSrc() {
    return this.getImageUrl("flagEs");
  }

  get flagFrSrc() {
    return this.getImageUrl("flagFr");
  }

  get flagJaSrc() {
    return this.getImageUrl("flagJa");
  }

  toggleLangDropdown(event) {
    event.stopPropagation();
    this.langDropdownOpen = !this.langDropdownOpen;
    this.themeDropdownOpen = false;
    this._syncOutsideClickListener();
  }

  toggleThemeDropdown(event) {
    event.stopPropagation();
    this.themeDropdownOpen = !this.themeDropdownOpen;
    this.langDropdownOpen = false;
    this._syncOutsideClickListener();
  }

  _syncOutsideClickListener() {
    if (this.langDropdownOpen || this.themeDropdownOpen) {
      // Use setTimeout to avoid the current click event immediately closing the dropdown
      setTimeout(
        () => document.addEventListener("click", this._boundHandleOutsideClick),
        0,
      );
    } else {
      document.removeEventListener("click", this._boundHandleOutsideClick);
    }
  }

  get currentThemeIconSrc() {
    const map = { auto: "themeAuto", light: "themeLight", dark: "themeDark" };
    const key = map[this.colorThemeConfig] || "themeAuto";
    return this.getImageUrl(key, "themeAuto");
  }

  get themeAutoSrc() {
    return this.getImageUrl("themeAuto");
  }

  get themeLightSrc() {
    return this.getImageUrl("themeLight");
  }

  get themeDarkSrc() {
    return this.getImageUrl("themeDark");
  }

  handleLangChange(event) {
    const lang = event.currentTarget.dataset.lang;
    this.langSetting = lang;
    this.langDropdownOpen = false;
    this._syncOutsideClickListener();

    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "vsCodeSfdxHardis.lang",
        value: lang,
      },
    });
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
      data: this.docsiteUrl,
    });
  }

  openCloudityServices() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.contactFormUrl,
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
    const colorThemeConfig = event.currentTarget.dataset.theme;
    this.colorThemeConfig = colorThemeConfig;
    this.themeDropdownOpen = false;
    this._syncOutsideClickListener();
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

  // Banner click handler
  handleBannerClick() {
    if (this.websiteUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: this.websiteUrl,
      });
    }
  }
}
