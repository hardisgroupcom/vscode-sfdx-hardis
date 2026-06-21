/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

// The CLI catalog exposes SLDS icons for categories (`categories[].icon`, e.g. "utility:refresh").
// The org-monitoring home page renders emoji glyphs instead of SLDS icons for the section
// headers, so we keep a local emoji map for that surface. Per-command icons / colorClass and
// per-category colorClass still come from the CLI catalog — see categorySections.
// The "custom" pseudo-category exists purely in this UI, so its colorClass also stays local.
const CATEGORY_ICONS = {
  orgActivity: { icon: "🔄" },
  userActivity: { icon: "👤" },
  apexTestsSecurity: { icon: "🔒" },
  orgInfo: { icon: "ℹ️" },
  technicalDebt: { icon: "🏚️" },
  licensesPackages: { icon: "📦" },
  other: { icon: "🧩" },
  custom: { icon: "➕", colorClass: "backup" },
};

const DEFAULT_CATEGORY_COLOR_CLASS = "legacy";
const FALLBACK_ICON_NAME = "utility:settings";

// Commands shown on the Org Monitoring home page that are not (yet) part of the
// CLI monitoring catalog. Listed here so users can still launch them from the
// home page; safe to remove individual entries once the CLI exposes them.
// `colorClass` is per-command (matches the CLI catalog convention) so the badge
// theming stays in sync once the entry migrates into the CLI catalog.
const EXTRA_COMMANDS = [
  {
    key: "EXTRA_BACKUP",
    titleKey: "metadataBackup",
    descriptionKey: "metadataBackupDescription",
    category: "orgActivity",
    command: "sf hardis:org:monitor:backup",
    icon: "utility:archive",
    colorClass: "backup",
  },
  {
    key: "EXTRA_APEX_TESTS",
    titleKey: "apexTests",
    descriptionKey: "apexTestsDescription",
    category: "apexTestsSecurity",
    command: "sf hardis:org:test:apex",
    icon: "utility:check",
    colorClass: "tests",
  },
  {
    key: "EXTRA_OBJECT_FIELD_USAGE",
    titleKey: "objectFieldUsage",
    descriptionKey: "objectFieldUsageDescription",
    category: "technicalDebt",
    command: "sf hardis:doc:object-field-usage",
    icon: "utility:table",
    colorClass: "metadata-access",
  },
];

export default class OrgMonitoring extends SharedMixin(LightningElement) {
  @track isInstalled = false;
  @track isLoading = true;
  @track isCiCdRepo = false;
  @track monitoringRepository = null;
  @track instanceUrl = null;
  @track monitoringHomeUrl = "";
  @track monitoringConfigUrl = "";
  @track catalog = null;
  @track catalogLoading = true;
  _catalogReceived = false;

  @api
  initialize(data) {
    console.log("Org Monitoring component initialized:", data);
    this.isInstalled = data?.isInstalled || false;
    this.isCiCdRepo = data?.isCiCdRepo || false;
    this.monitoringRepository = data?.monitoringRepository || null;
    this.instanceUrl = data?.instanceUrl || null;
    this.monitoringHomeUrl = data?.monitoringHomeUrl || "";
    this.monitoringConfigUrl = data?.monitoringConfigUrl || "";
    // Catalog can arrive via a message *before* this initialize() runs (cache hit
    // race: monitoringCatalogLoaded flushes from the pending queue right after
    // mount, then bootstrap calls initialize() a moment later with the original
    // null-catalog payload). Once a catalog has been received, do not let
    // initialize overwrite it back to the loading state.
    if (!this._catalogReceived) {
      this.catalog = data?.catalog || null;
      this.catalogLoading = data?.catalogLoading !== false;
    }
    this.isLoading = false;
  }

  @api
  handleMessage(type, data) {
    console.log("Org Monitoring component received message:", type, data);
    if (type === "installationStatusUpdated") {
      this.isInstalled = data?.isInstalled || false;
      if (data?.isCiCdRepo !== undefined) {
        this.isCiCdRepo = !!data.isCiCdRepo;
      }
      if (data?.monitoringRepository !== undefined) {
        this.monitoringRepository = data.monitoringRepository || null;
      }
      if (data?.instanceUrl !== undefined) {
        this.instanceUrl = data.instanceUrl || null;
      }
      if (data?.catalogLoading === true) {
        this._catalogReceived = false;
        this.catalogLoading = true;
        this.catalog = null;
      }
    } else if (type === "monitoringCatalogLoaded") {
      this.catalog = data?.catalog || null;
      this.catalogLoading = false;
      this._catalogReceived = true;
    }
  }

  // ----- Catalog-driven category groups -----

  get hasCatalog() {
    return !!(
      this.catalog &&
      Array.isArray(this.catalog.monitoringCommands) &&
      this.catalog.monitoringCommands.length > 0
    );
  }

  get hasNoCatalog() {
    return !this.catalogLoading && !this.hasCatalog;
  }

  get isCatalogLoading() {
    return this.catalogLoading;
  }

  get categorySections() {
    if (!this.hasCatalog) {
      return [];
    }
    const rowMap = {};
    for (const entry of this.catalog.monitoringCommands || []) {
      if (!entry.command) {
        continue;
      }
      const catKey = entry.category || "other";
      if (!rowMap[catKey]) {
        rowMap[catKey] = [];
      }
      const iconName = entry.icon || FALLBACK_ICON_NAME;
      // Prefer the per-command colorClass from the CLI catalog; fall back to the category one.
      const colorClass = entry.colorClass || this.colorClassForCategory(catKey);
      const rawTitle = entry.title || entry.key;
      rowMap[catKey].push({
        key: entry.key,
        title: (rawTitle || "").replace(/\*\*/g, ""),
        description: entry.description || "",
        command: entry.command,
        iconName,
        iconContainerClass: "command-icon-container " + colorClass,
      });
    }

    // Merge hardcoded extras that the CLI catalog does not list yet.
    // Collected per category first so EXTRA_COMMANDS declaration order is
    // preserved when prepended in front of the catalog entries.
    const catalogCommands = new Set(
      (this.catalog.monitoringCommands || [])
        .map((e) => e.command)
        .filter(Boolean),
    );
    const extrasByCategory = {};
    for (const extra of EXTRA_COMMANDS) {
      if (catalogCommands.has(extra.command)) {
        continue;
      }
      if (!extrasByCategory[extra.category]) {
        extrasByCategory[extra.category] = [];
      }
      extrasByCategory[extra.category].push({
        key: extra.key,
        title: this.t(extra.titleKey),
        description: this.t(extra.descriptionKey),
        command: extra.command,
        iconName: extra.icon || FALLBACK_ICON_NAME,
        iconContainerClass:
          "command-icon-container " +
          (extra.colorClass || this.colorClassForCategory(extra.category)),
      });
    }
    for (const catKey of Object.keys(extrasByCategory)) {
      rowMap[catKey] = extrasByCategory[catKey].concat(rowMap[catKey] || []);
    }

    let catalogCategories = (this.catalog.categories || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (catalogCategories.length === 0) {
      catalogCategories = Object.keys(rowMap).map((k) => ({
        key: k,
        title: k,
        description: "",
        order: 0,
      }));
    }

    const result = [];
    for (const cat of catalogCategories) {
      const catRows = rowMap[cat.key] || [];
      if (catRows.length === 0) {
        continue;
      }
      const catIconData = CATEGORY_ICONS[cat.key] || { icon: "🧩" };
      result.push({
        key: cat.key,
        title: cat.title,
        description: cat.description || "",
        emoji: catIconData.icon,
        rows: catRows,
      });
    }
    return result;
  }

  // Resolve a CSS colorClass for a category key. Real categories come from the CLI catalog
  // (`categories[].colorClass`); the only pseudo-category here is "custom", which falls back
  // to the local CATEGORY_ICONS map.
  /* jscpd:ignore-start */
  colorClassForCategory(categoryKey) {
    const fromCatalog = (this.catalog?.categories || []).find(
      (c) => c && c.key === categoryKey,
    );
    if (fromCatalog && fromCatalog.colorClass) {
      return fromCatalog.colorClass;
    }
    return (
      CATEGORY_ICONS[categoryKey]?.colorClass || DEFAULT_CATEGORY_COLOR_CLASS
    );
  }
  /* jscpd:ignore-end */

  // ----- User-facing actions -----

  openInstanceUrl() {
    if (this.instanceUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: this.instanceUrl,
      });
    }
  }

  openMonitoringRepository() {
    if (this.monitoringRepository) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: this.monitoringRepository,
      });
    }
  }

  checkInstallationStatus() {
    window.sendMessageToVSCode({
      type: "checkOrgMonitoringInstallation",
    });
  }

  installOrgMonitoring() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:configure:monitoring",
      },
    });
  }

  reconfigureMonitoringAuth() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:configure:monitoring",
      },
    });
  }

  configureAnotherOrg() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:configure:monitoring",
      },
    });
  }

  openMonitoringConfig() {
    window.sendMessageToVSCode({
      type: "openMonitoringConfig",
    });
  }

  viewSkipItemsPackage() {
    window.sendMessageToVSCode({
      type: "viewPackageConfig",
      data: {
        packageType: "skip",
        filePath: "manifest/package-skip-items.xml",
        title: "Skip Items Package",
      },
    });
  }

  viewBackupItemsPackage() {
    window.sendMessageToVSCode({
      type: "viewPackageConfig",
      data: {
        packageType: "backup",
        filePath: "manifest/package-backup-items.xml",
        title: "Backup Items Package",
      },
    });
  }

  viewAllOrgItemsPackage() {
    window.sendMessageToVSCode({
      type: "viewPackageConfig",
      data: {
        packageType: "all-org",
        filePath: "manifest/package-all-org-items.xml",
        title: "All Org Items Package",
      },
    });
  }

  handleAuthMenuSelect(event) {
    const value = event.detail.value;
    if (value === "reconfigure") {
      this.reconfigureMonitoringAuth();
    } else if (value === "anotherOrg") {
      this.configureAnotherOrg();
    }
  }

  handlePackageMenuSelect(event) {
    const value = event.detail.value;
    if (value === "skip") {
      this.viewSkipItemsPackage();
    } else if (value === "backup") {
      this.viewBackupItemsPackage();
    } else if (value === "all-org") {
      this.viewAllOrgItemsPackage();
    }
  }

  learnMore() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.monitoringHomeUrl,
    });
  }

  handleRunCommand(event) {
    const command = event.currentTarget?.dataset?.command;
    if (!command) {
      return;
    }
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command },
    });
  }

  openMonitoringDocs() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.monitoringHomeUrl,
    });
  }

  openSetupGuide() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: this.monitoringConfigUrl,
    });
  }
}
