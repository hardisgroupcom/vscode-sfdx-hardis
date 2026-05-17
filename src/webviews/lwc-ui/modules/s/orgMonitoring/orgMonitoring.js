/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

const CATEGORY_ICONS = {
  orgActivity: { icon: "🔄", colorClass: "tests" },
  userActivity: { icon: "👤", colorClass: "users" },
  apexTestsSecurity: { icon: "🔒", colorClass: "security" },
  orgInfo: { icon: "ℹ️", colorClass: "health" },
  technicalDebt: { icon: "🏚️", colorClass: "limits" },
  licensesPackages: { icon: "📦", colorClass: "licenses" },
  other: { icon: "🧩", colorClass: "legacy" },
  custom: { icon: "➕", colorClass: "backup" },
};

const COMMAND_ICONS = {
  AUDIT_TRAIL: { icon: "utility:trail", colorClass: "audit" },
  LEGACY_API: { icon: "utility:deprecate", colorClass: "legacy" },
  APEX_FLOW_ERRORS: { icon: "utility:error", colorClass: "alerts" },
  APEX_FLEX_QUEUE: { icon: "utility:list", colorClass: "tests" },
  DEPLOYMENTS: { icon: "utility:upload", colorClass: "audit" },
  ORG_LIMITS: { icon: "utility:graph", colorClass: "limits" },
  UNSECURED_CONNECTED_APPS: { icon: "utility:shield", colorClass: "security" },
  ORG_HEALTH_CHECK: { icon: "utility:check", colorClass: "health" },
  ORG_INFO: { icon: "utility:info", colorClass: "health" },
  RELEASE_UPDATES: { icon: "utility:new", colorClass: "updates" },
  LINT_ACCESS: { icon: "utility:lock", colorClass: "metadata-access" },
  UNUSED_METADATAS: { icon: "utility:custom_apps", colorClass: "unused-metadata" },
  UNUSED_APEX_CLASSES: { icon: "utility:apex", colorClass: "apex" },
  APEX_API_VERSION: { icon: "utility:apex", colorClass: "legacy" },
  CONNECTED_APPS: { icon: "utility:connected_apps", colorClass: "connected-apps" },
  METADATA_STATUS: { icon: "utility:flow", colorClass: "legacy" },
  MISSING_ATTRIBUTES: { icon: "utility:description", colorClass: "metadata-access" },
  UNDERUSED_PERMSETS: { icon: "utility:lock", colorClass: "licenses" },
  MINIMAL_PERMSETS: { icon: "utility:shield", colorClass: "metadata-access" },
  LICENSES: { icon: "utility:package", colorClass: "licenses" },
  UNUSED_LICENSES: { icon: "utility:key", colorClass: "licenses" },
  UNUSED_USERS: { icon: "utility:user", colorClass: "users" },
  UNUSED_USERS_CRM_6_MONTHS: { icon: "utility:user", colorClass: "users" },
  UNUSED_USERS_EXPERIENCE_6_MONTHS: { icon: "utility:user", colorClass: "users" },
  ACTIVE_USERS_CRM_WEEKLY: { icon: "utility:user", colorClass: "tests" },
  ACTIVE_USERS_EXPERIENCE_MONTHLY: { icon: "utility:user", colorClass: "tests" },
  BACKUP: { icon: "utility:save", colorClass: "backup" },
  DEPLOYMENT: { icon: "utility:upload", colorClass: "audit" },
  APEX_TESTS: { icon: "utility:apex", colorClass: "tests" },
  APEX_ERROR: { icon: "utility:error", colorClass: "alerts" },
  FLOW_ERROR: { icon: "utility:flow", colorClass: "alerts" },
  ACTIVE_USERS: { icon: "utility:user", colorClass: "users" },
  MONITORING_SUMMARY: { icon: "utility:report", colorClass: "backup" },
  RELEASE_NOTES: { icon: "utility:description", colorClass: "updates" },
  DORA_REPORT: { icon: "utility:chart", colorClass: "health" },
  AGENTFORCE_CONVERSATIONS: { icon: "utility:chat", colorClass: "tests" },
  AGENTFORCE_FEEDBACK: { icon: "utility:like", colorClass: "tests" },
  SERVICENOW_REPORT: { icon: "utility:table", colorClass: "backup" },
  OBJECT_FIELD_USAGE: { icon: "utility:table", colorClass: "metadata-access" },
};

const DEFAULT_ICON = { icon: "utility:settings", colorClass: "legacy" };

// Commands shown on the Org Monitoring home page that are not (yet) part of the
// CLI monitoring catalog. Listed here so users can still launch them from the
// home page; safe to remove individual entries once the CLI exposes them.
const EXTRA_COMMANDS = [
  {
    key: "EXTRA_BACKUP",
    titleKey: "metadataBackup",
    descriptionKey: "metadataBackupDescription",
    category: "orgActivity",
    command: "sf hardis:org:monitor:backup",
    iconKey: "BACKUP",
  },
  {
    key: "EXTRA_APEX_TESTS",
    titleKey: "apexTests",
    descriptionKey: "apexTestsDescription",
    category: "apexTestsSecurity",
    command: "sf hardis:org:test:apex",
    iconKey: "APEX_TESTS",
  },
  {
    key: "EXTRA_OBJECT_FIELD_USAGE",
    titleKey: "objectFieldUsage",
    descriptionKey: "objectFieldUsageDescription",
    category: "technicalDebt",
    command: "sf hardis:doc:object-field-usage",
    iconKey: "OBJECT_FIELD_USAGE",
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
    }
    else if (type === "monitoringCatalogLoaded") {
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
      const iconData = COMMAND_ICONS[entry.key] || DEFAULT_ICON;
      const rawTitle = entry.title || entry.key;
      rowMap[catKey].push({
        key: entry.key,
        title: (rawTitle || "").replace(/\*\*/g, ""),
        description: entry.description || "",
        command: entry.command,
        iconName: iconData.icon,
        iconContainerClass: "command-icon-container " + iconData.colorClass,
      });
    }

    // Merge hardcoded extras that the CLI catalog does not list yet.
    // Collected per category first so EXTRA_COMMANDS declaration order is
    // preserved when prepended in front of the catalog entries.
    const catalogCommands = new Set(
      (this.catalog.monitoringCommands || []).map((e) => e.command).filter(Boolean),
    );
    const extrasByCategory = {};
    for (const extra of EXTRA_COMMANDS) {
      if (catalogCommands.has(extra.command)) {
        continue;
      }
      const iconData = COMMAND_ICONS[extra.iconKey] || DEFAULT_ICON;
      if (!extrasByCategory[extra.category]) {
        extrasByCategory[extra.category] = [];
      }
      extrasByCategory[extra.category].push({
        key: extra.key,
        title: this.t(extra.titleKey),
        description: this.t(extra.descriptionKey),
        command: extra.command,
        iconName: iconData.icon,
        iconContainerClass: "command-icon-container " + iconData.colorClass,
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
      const catIconData = CATEGORY_ICONS[cat.key] || { icon: "🧩", colorClass: "legacy" };
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
    }
    else if (value === "anotherOrg") {
      this.configureAnotherOrg();
    }
  }

  handlePackageMenuSelect(event) {
    const value = event.detail.value;
    if (value === "skip") {
      this.viewSkipItemsPackage();
    }
    else if (value === "backup") {
      this.viewBackupItemsPackage();
    }
    else if (value === "all-org") {
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
