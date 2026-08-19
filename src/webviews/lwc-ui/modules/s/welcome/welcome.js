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

// i18n key of the "what is it / why do I need it" explanation shown in the
// missing-prerequisites modal, keyed by PrerequisiteId (see
// src/utils/dependenciesStatus.ts on the extension side)
const PREREQUISITE_EXPLANATION_KEYS = {
  node: "depNodeExplanation",
  git: "depGitExplanation",
  sf: "depSfCliExplanation",
  sfdxHardis: "depSfdxHardisExplanation",
  vscodeExtensionPack: "depSalesforceExtensionPackExplanation",
};

const DEPENDENCIES_STATUS_CHECKING = {
  state: "checking",
  prerequisites: [],
  missingPrerequisites: [],
  missingCount: 0,
  outdatedCount: 0,
  actionableCount: 0,
};

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
  @track marketplaceUrl = "";
  @track whatsNewUrl = "";
  @track quickStartCollapsed = false;
  @track extensionVersion = "";
  @track customMenus = [];
  @track activeCustomMenu = null;
  @track dependenciesStatus = DEPENDENCIES_STATUS_CHECKING;
  @track prerequisitesModalDismissed = false;

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
    if (data && data.marketplaceUrl) {
      this.marketplaceUrl = data.marketplaceUrl;
    }
    if (data && data.quickStartCollapsed === true) {
      this.quickStartCollapsed = true;
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
    if (data && data.dependenciesStatus) {
      this.dependenciesStatus = data.dependenciesStatus;
    }
    if (data && data.dependenciesModalDismissed !== undefined) {
      this.prerequisitesModalDismissed =
        data.dependenciesModalDismissed === true;
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
    } else if (type === "updateDependenciesStatus") {
      if (data && data.dependenciesStatus) {
        this.dependenciesStatus = data.dependenciesStatus;
      }
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
          tileClass: this.tileClassForHue(menu.welcomeIconClass),
          cardClass: "hardis-card clickable",
        })),
      });
    }
    return groups;
  }

  /**
   * Tile class of a custom menu declared in .sfdx-hardis.yml. `welcomeIconClass`
   * is a hue of the .hardis-tile kit (cyan, violet, amber…); older configs may
   * still carry a full legacy class, so only its last word is kept.
   */
  tileClassForHue(welcomeIconClass) {
    const hue = String(welcomeIconClass || "slate")
      .trim()
      .split(/\s+/)
      .pop();
    return `hardis-tile small ${hue}`;
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

  // ── Dependencies button (checking / upgrades required / all up to date) ──

  get dependenciesButtonState() {
    return (
      (this.dependenciesStatus && this.dependenciesStatus.state) || "checking"
    );
  }

  get isDependenciesChecking() {
    return this.dependenciesButtonState === "checking";
  }

  get isDependenciesUpgradesRequired() {
    return this.dependenciesButtonState === "upgradesRequired";
  }

  get dependenciesButtonLabel() {
    if (this.isDependenciesChecking) {
      return this.i18n.checkInProgress;
    }
    if (this.isDependenciesUpgradesRequired) {
      return this.t("welcomeDependenciesUpdatesNeeded", {
        count: this.dependenciesStatus.actionableCount,
      });
    }
    return this.i18n.dependenciesUpToDate;
  }

  get dependenciesButtonIcon() {
    if (this.isDependenciesChecking) {
      return "utility:hourglass";
    }
    if (this.isDependenciesUpgradesRequired) {
      return "utility:warning";
    }
    return "utility:check";
  }

  get dependenciesButtonClass() {
    // Only the actionable state is tinted. "All up to date" and "checking" stay
    // visually discrete on purpose: nothing needs the user's attention there,
    // so coloring them would compete with the rest of the Welcome page.
    if (this.isDependenciesUpgradesRequired) {
      return "hardis-btn-tinted-amber";
    }
    return "";
  }

  get dependenciesButtonDisabled() {
    return this.isDependenciesChecking;
  }

  // ── Missing-prerequisites modal (Git / sf CLI / Node.js / sfdx-hardis /
  // Salesforce Extension Pack entirely missing — guidance for new users) ──

  get missingPrerequisites() {
    return (
      (this.dependenciesStatus &&
        this.dependenciesStatus.missingPrerequisites) ||
      []
    );
  }

  get showPrerequisitesModal() {
    return (
      this.missingPrerequisites.length > 0 && !this.prerequisitesModalDismissed
    );
  }

  get missingPrerequisiteItems() {
    return this.missingPrerequisites.map((item) =>
      this.buildMissingPrerequisiteItem(item),
    );
  }

  buildMissingPrerequisiteItem(item) {
    const explanationKey = PREREQUISITE_EXPLANATION_KEYS[item.id] || "";
    return {
      id: item.id,
      label: item.label,
      explanation: explanationKey ? this.t(explanationKey) : "",
    };
  }

  handleDismissPrerequisitesModal() {
    this.prerequisitesModalDismissed = true;
    window.sendMessageToVSCode({ type: "dismissPrerequisitesModal" });
  }

  /**
   * The modal's single call to action: close it and hand the user over to the
   * Setup panel, which is where dependencies are actually checked and installed.
   */
  handleOpenSetupFromModal() {
    this.handleDismissPrerequisitesModal();
    this.navigateToSetup();
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

  get quickStartExpanded() {
    return !this.quickStartCollapsed;
  }

  toggleQuickStart() {
    this.quickStartCollapsed = !this.quickStartCollapsed;
    window.sendMessageToVSCode({
      type: "setQuickStartCollapsed",
      data: { collapsed: this.quickStartCollapsed },
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

  openMarketplace() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.marketplaceUrl,
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
