/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

// Built-in feature cards, rendered group by group.
// "essentials" is the featured row (bigger cards, always above the fold).
const FEATURE_CARDS = [
  {
    id: "pipeline",
    icon: "utility:flow",
    hue: "violet",
    labelKey: "devOpsPipeline",
    descriptionKey: "devOpsPipelineDescription",
    group: "essentials",
  },
  {
    id: "orgMonitoring",
    icon: "utility:graph",
    hue: "violet",
    labelKey: "orgMonitoring",
    descriptionKey: "orgMonitoringDescription",
    group: "essentials",
  },
  {
    id: "documentationWorkbench",
    icon: "utility:knowledge_base",
    hue: "amber",
    labelKey: "documentationWorkbench",
    descriptionKey: "documentationWorkbenchDescription",
    group: "essentials",
  },
  {
    id: "orgsManager",
    icon: "utility:connected_apps",
    hue: "cyan",
    labelKey: "orgsManager",
    descriptionKey: "orgsManagerDescription",
    group: "org",
  },
  {
    id: "metadataRetriever",
    icon: "utility:download",
    hue: "cyan",
    labelKey: "metadataRetriever",
    descriptionKey: "metadataRetrieverDescription",
    group: "org",
  },
  {
    id: "runAnonymousApex",
    icon: "utility:apex",
    hue: "cyan",
    labelKey: "runAnonymousApex",
    descriptionKey: "runAnonymousApexDescription",
    group: "org",
  },
  {
    id: "dataWorkbench",
    icon: "utility:database",
    hue: "teal",
    labelKey: "dataWorkbench",
    descriptionKey: "dataWorkbenchDescription",
    group: "data",
  },
  {
    id: "filesWorkbench",
    icon: "utility:file",
    hue: "teal",
    labelKey: "filesWorkbench",
    descriptionKey: "filesWorkbenchDescription",
    group: "data",
  },
];

const LANGUAGES = [
  { code: "auto", flagKey: "flagGlobe", labelKey: "langVsCodeAuto" },
  { code: "en", flagKey: "flagEn", labelKey: "langEnglish" },
  { code: "fr", flagKey: "flagFr", labelKey: "langFrench" },
  { code: "es", flagKey: "flagEs", labelKey: "langSpanish" },
  { code: "de", flagKey: "flagDe", labelKey: "langGerman" },
  { code: "nl", flagKey: "flagNl", labelKey: "langDutch" },
  { code: "pl", flagKey: "flagPl", labelKey: "langPolish" },
  { code: "ja", flagKey: "flagJa", labelKey: "langJapanese" },
  { code: "pt-BR", flagKey: "flagPtBR", labelKey: "langPortugueseBrazil" },
  { code: "it", flagKey: "flagIt", labelKey: "langItalian" },
];

const THEMES = [
  { code: "auto", iconKey: "themeAuto", labelKey: "autoTheme" },
  { code: "light", iconKey: "themeLight", labelKey: "lightTheme" },
  { code: "dark", iconKey: "themeDark", labelKey: "darkTheme" },
];

export default class Welcome extends SharedMixin(LightningElement) {
  @track isLoading = false;
  @track showWelcomeAtStartup = true;
  @track colorThemeConfig = "auto";
  @track langSetting = "auto";
  @track langDropdownOpen = false;
  @track themeDropdownOpen = false;
  @track bannerImageUrl = "";
  @track websiteUrl = "";
  @track docsiteUrl = "";
  @track contributersUrl = "";
  @track contactFormUrl = "";
  @track repositoryUrl = "";
  @track whatsNewUrl = "";
  @track extensionVersion = "";
  @track customMenus = [];
  @track activeCustomMenu = null;

  connectedCallback() {
    super.connectedCallback();
    this._boundHandleOutsideClick = this.handleOutsideClick.bind(this);
  }

  disconnectedCallback() {
    document.removeEventListener("click", this._boundHandleOutsideClick);
  }

  handleOutsideClick(event) {
    if (!this.template.contains(event.target)) {
      this.langDropdownOpen = false;
      this.themeDropdownOpen = false;
      document.removeEventListener("click", this._boundHandleOutsideClick);
    }
  }

  @api
  initialize(data) {
    console.log("Welcome component initialized:", data);
    this.isLoading = false;

    if (data && data.showWelcomeAtStartup !== undefined) {
      this.showWelcomeAtStartup = data.showWelcomeAtStartup;
    }
    if (data && data.colorThemeConfig) {
      this.colorThemeConfig = data.colorThemeConfig;
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
    if (data && data.repositoryUrl) {
      this.repositoryUrl = data.repositoryUrl;
    }
    if (data && data.whatsNewUrl) {
      this.whatsNewUrl = data.whatsNewUrl;
    }
    if (data && data.extensionVersion) {
      this.extensionVersion = data.extensionVersion;
    }
    if (data && data.customMenus) {
      this.customMenus = this.normalizeMenus(data.customMenus);
    }
  }

  normalizeMenus(menus) {
    return (menus || []).map((menu) => this.normalizeMenu(menu));
  }

  normalizeMenu(menu) {
    const sourceType = menu?.sourceType || "custom";
    const iconClass =
      menu?.welcomeIconClass ||
      (sourceType === "plugin"
        ? "hardis-tile small pink"
        : "hardis-tile small indigo");
    return {
      ...menu,
      sourceType,
      welcomeIconClass: iconClass,
      commands: (menu?.commands || []).map((cmd) =>
        this.normalizeCommand(cmd, sourceType),
      ),
    };
  }

  normalizeCommand(command, parentSourceType) {
    const sourceType = command?.sourceType || parentSourceType || "custom";
    const iconClass =
      command?.welcomeIconClass ||
      (sourceType === "plugin"
        ? "hardis-tile small pink"
        : "hardis-tile small indigo");
    return {
      ...command,
      sourceType,
      welcomeIconClass: iconClass,
    };
  }

  @api
  handleMessage(type, data) {
    console.log("Welcome component received message:", type, data);
    if (type === "updateCustomMenus") {
      this.customMenus = this.normalizeMenus(data || []);
    }
  }

  get isHomeView() {
    return !this.activeCustomMenu;
  }

  get isCustomMenuView() {
    return !!this.activeCustomMenu;
  }

  get activeCustomMenuLabel() {
    return this.activeCustomMenu ? this.activeCustomMenu.label : "";
  }

  get activeCustomMenuCommands() {
    return this.activeCustomMenu ? this.activeCustomMenu.commands || [] : [];
  }

  get versionLabel() {
    return this.extensionVersion ? "v" + this.extensionVersion : "";
  }

  // Feature cards grouped for rendering: featured essentials first, then
  // compact secondary groups, then custom menus from .sfdx-hardis.yml if any.
  get featureGroups() {
    const groups = [
      {
        id: "essentials",
        label: this.t("welcomeEssentialsGroup"),
        featured: true,
      },
      { id: "org", label: this.t("welcomeOrgGroup"), featured: false },
      { id: "data", label: this.t("welcomeDataFilesGroup"), featured: false },
    ].map((group) => ({
      ...group,
      groupClass: group.featured ? "welcome-group featured" : "welcome-group",
      cards: FEATURE_CARDS.filter((card) => card.group === group.id).map(
        (card) => this.buildCard(card, group.featured),
      ),
    }));
    if (this.customMenus && this.customMenus.length > 0) {
      groups.push({
        id: "custom",
        label: this.t("welcomeCustomMenusGroup"),
        featured: false,
        groupClass: "welcome-group",
        cards: this.customMenus.map((menu) => ({
          id: menu.id,
          menuId: menu.id,
          target: "",
          icon: menu.sldsIcon,
          iconSize: "x-small",
          title: menu.label,
          description: menu.description,
          tileClass: menu.welcomeIconClass,
          cardClass: "hardis-card clickable",
        })),
      });
    }
    return groups;
  }

  buildCard(card, featured) {
    return {
      id: card.id,
      target: card.id,
      menuId: "",
      icon: card.icon,
      iconSize: featured ? "small" : "x-small",
      title: this.t(card.labelKey),
      description: this.t(card.descriptionKey),
      tileClass: featured
        ? "hardis-tile featured " + card.hue
        : "hardis-tile small " + card.hue,
      cardClass: featured
        ? "hardis-card featured clickable"
        : "hardis-card clickable",
    };
  }

  handleCardClick(event) {
    const menuId = event.currentTarget.dataset.menuId;
    if (menuId) {
      const menu = this.customMenus.find((m) => m.id === menuId);
      if (menu) {
        this.activeCustomMenu = menu;
      }
      return;
    }
    const target = event.currentTarget.dataset.target;
    if (target) {
      window.sendMessageToVSCode({
        type: "navigateTo",
        data: { target: target },
      });
    }
  }

  handleCardKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  backToHome() {
    this.activeCustomMenu = null;
  }

  executeCustomCommand(event) {
    const command = event.currentTarget.dataset.command;
    if (!command) {
      return;
    }
    if (
      command.startsWith("vscode-sfdx-hardis") ||
      command.startsWith("workbench")
    ) {
      window.sendMessageToVSCode({
        type: "runVsCodeCommand",
        data: { command: command.split(" ")[0] },
      });
    } else {
      window.sendMessageToVSCode({
        type: "runCommand",
        data: { command: command },
      });
    }
  }

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the SharedMixin's implementation
    if (super.handleColorThemeMessage) {
      super.handleColorThemeMessage(type, data);
    }
  }

  get langOptions() {
    return LANGUAGES.map((lang) => ({
      code: lang.code,
      label: this.t(lang.labelKey),
      flagSrc: this.getImageUrl(lang.flagKey, "flagGlobe"),
    }));
  }

  get themeOptions() {
    return THEMES.map((theme) => ({
      code: theme.code,
      label: this.t(theme.labelKey),
      iconSrc: this.getImageUrl(theme.iconKey, "themeAuto"),
    }));
  }

  get currentLangFlagSrc() {
    const lang =
      LANGUAGES.find((entry) => entry.code === this.langSetting) ||
      LANGUAGES[0];
    return this.getImageUrl(lang.flagKey, "flagGlobe");
  }

  get currentThemeIconSrc() {
    const theme =
      THEMES.find((entry) => entry.code === this.colorThemeConfig) || THEMES[0];
    return this.getImageUrl(theme.iconKey, "themeAuto");
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

  handleThemeChange(event) {
    const colorThemeConfig = event.currentTarget.dataset.theme;
    this.colorThemeConfig = colorThemeConfig;
    this.themeDropdownOpen = false;
    this._syncOutsideClickListener();

    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "vsCodeSfdxHardis.theme.colorTheme",
        value: colorThemeConfig,
      },
    });
  }

  navigateToSetup() {
    window.sendMessageToVSCode({
      type: "navigateTo",
      data: { target: "setup" },
    });
  }

  navigateToExtensionConfig() {
    window.sendMessageToVSCode({
      type: "navigateTo",
      data: { target: "extensionConfig" },
    });
  }

  navigateToSearchCommands() {
    window.sendMessageToVSCode({
      type: "navigateTo",
      data: { target: "searchCommands" },
    });
  }

  // Quick action methods
  handleConnectToOrg() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:select --set-default",
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

  openRepository() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.repositoryUrl,
    });
  }

  openWhatsNew() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.whatsNewUrl,
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

    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "vsCodeSfdxHardis.showWelcomeAtStartup",
        value: newValue,
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
