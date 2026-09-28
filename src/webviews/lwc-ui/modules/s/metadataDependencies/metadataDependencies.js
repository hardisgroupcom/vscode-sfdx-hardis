import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getMetadataTypePillClass } from "s/pillUtils";

// Common types of the search form, with an example API name. Any other type
// reaches the panel from the Metadata Retriever or a file, and is added to the list.
const COMMON_TYPES = [
  { value: "ApexClass", hint: "MyClass" },
  { value: "ApexTrigger", hint: "MyTrigger" },
  { value: "ApexPage", hint: "MyPage" },
  { value: "ApexComponent", hint: "MyComponent" },
  { value: "AuraDefinitionBundle", hint: "myAuraBundle" },
  { value: "LightningComponentBundle", hint: "myLwc" },
  { value: "FlexiPage", hint: "My_Record_Page" },
  { value: "Flow", hint: "My_Flow" },
  { value: "CustomObject", hint: "MyObject__c" },
  { value: "CustomField", hint: "Account.MyField__c" },
  { value: "Layout", hint: "Account-Account Layout" },
  { value: "ValidationRule", hint: "Account.My_Rule" },
  { value: "StaticResource", hint: "myResource" },
  { value: "CustomPermission", hint: "My_Permission" },
];

// Salesforce returns at most this number of rows to one Tooling query
const TOOLING_ROW_CAP = 2000;

function decodeName(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default class MetadataDependencies extends SharedMixin(
  LightningElement,
) {
  @track orgs = [];
  username = null;
  formType = "ApexClass";
  formName = "";
  // Drill-down path: one level per searched component, each keeping its result
  @track levels = [];
  currentLevel = -1;
  @track selectedIds = [];
  @track reportFiles = [];
  sortedBy = "typeLabel";
  sortedDirection = "asc";
  isRetrieving = false;
  isGeneratingReport = false;
  requestSequence = 0;
  lastInitKey = null;
  lastInitAt = 0;

  connectedCallback() {
    super.connectedCallback();
    window.sendMessageToVSCode({ type: "listOrgs" });
  }

  @api
  initialize(data) {
    data = data || {};
    if (Array.isArray(data.orgs) && data.orgs.length > 0) {
      this.orgs = data.orgs;
    }
    if (data.username) {
      this.username = data.username;
    }
    if (data.query) {
      // The same init data can arrive twice when the panel is created: search once
      const initKey = JSON.stringify({ query: data.query, username: this.username });
      if (initKey === this.lastInitKey && Date.now() - this.lastInitAt < 3000) {
        return;
      }
      this.lastInitKey = initKey;
      this.lastInitAt = Date.now();
      // A new entry point (retriever row, file, card) starts a new path
      this.levels = [];
      this.currentLevel = -1;
      this.openLevel(data.query);
    }
  }

  // "initialize" also reaches initialize() directly: it is not handled here
  @api
  handleMessage(type, data) {
    if (type === "listOrgsResults") {
      this.orgs = data?.orgs || [];
      if (!this.username && this.orgs.length > 0) {
        const defaultOrg =
          this.orgs.find((org) => org.isDefaultUsername) || this.orgs[0];
        this.username = defaultOrg.username;
      }
    } else if (type === "dependenciesResult" || type === "dependenciesError") {
      this.handleDependencies(type, data || {});
    } else if (type === "retrieveState") {
      this.isRetrieving = data?.isRetrieving === true;
    } else if (type === "retrieveDone") {
      this.isRetrieving = false;
      this.selectedIds = [];
      // Refresh the "In project" column of the current level
      this.refreshCurrentLevel();
    } else if (type === "reportGenerated") {
      this.isGeneratingReport = false;
      this.reportFiles = (data?.reportFiles || []).map((file) => ({
        file: file.file,
        label:
          file.type === "xlsx" ? this.t("openExcelReport") : this.t("openCsvReport"),
      }));
    } else if (type === "reportError") {
      this.isGeneratingReport = false;
      this.levelError(data?.error);
    }
  }

  // ---- Levels ------------------------------------------------------------

  get level() {
    return this.currentLevel >= 0 ? this.levels[this.currentLevel] : null;
  }

  openLevel(query) {
    const title =
      query.name ||
      (query.sourceFile ? query.sourceFile.split(/[\\/]/).pop() : "") ||
      query.id ||
      "";
    const level = {
      query,
      title,
      type: query.type || "",
      result: null,
      error: null,
      loading: true,
      requestId: null,
      readAt: null,
    };
    this.levels = [...this.levels.slice(0, this.currentLevel + 1), level];
    this.currentLevel = this.levels.length - 1;
    this.selectedIds = [];
    this.reportFiles = [];
    if (query.type) {
      this.formType = query.type;
    }
    this.formName = query.name || "";
    this.requestDependencies(level);
  }

  requestDependencies(level) {
    this.requestSequence += 1;
    level.requestId = this.requestSequence;
    level.loading = true;
    level.error = null;
    this.levels = [...this.levels];
    window.sendMessageToVSCode({
      type: "findDependencies",
      data: {
        requestId: level.requestId,
        query: level.query,
        username: this.username,
      },
    });
  }

  refreshCurrentLevel() {
    if (this.level) {
      this.requestDependencies(this.level);
    }
  }

  handleDependencies(type, data) {
    const level = this.levels.find((item) => item.requestId === data.requestId);
    if (!level) {
      // Answer to a level the user already left
      return;
    }
    level.loading = false;
    if (type === "dependenciesError") {
      level.error = data.error || this.t("metadataDependenciesError");
    } else {
      level.result = data.result || null;
      level.readAt = new Date();
      const component = data.result?.component;
      if (component) {
        level.title = component.name || level.title;
        level.type = component.type || level.type;
        if (component.type && component.type !== "Unknown") {
          this.formType = component.type;
        }
        this.formName = component.name || this.formName;
      }
    }
    this.levels = [...this.levels];
  }

  levelError(message) {
    if (this.level) {
      this.level.error = message || this.t("metadataDependenciesError");
      this.levels = [...this.levels];
    }
  }

  // ---- Search form ---------------------------------------------------------

  get typeOptions() {
    const options = COMMON_TYPES.map((entry) => ({
      label: entry.value,
      value: entry.value,
    }));
    if (this.formType && !COMMON_TYPES.some((e) => e.value === this.formType)) {
      options.push({ label: this.formType, value: this.formType });
    }
    return options;
  }

  get formNamePlaceholder() {
    const entry = COMMON_TYPES.find((e) => e.value === this.formType);
    return entry ? entry.hint : "";
  }

  get searchDisabled() {
    return !this.username || !this.formType || !this.formName.trim();
  }

  handleTypeChange(event) {
    this.formType = event.detail.value;
  }

  handleNameChange(event) {
    this.formName = event.detail.value || "";
  }

  handleSearch(event) {
    if (event) {
      event.preventDefault();
    }
    if (this.searchDisabled) {
      return;
    }
    // A search from the form starts a new path
    this.levels = [];
    this.currentLevel = -1;
    this.openLevel({ type: this.formType, name: this.formName.trim() });
  }

  get orgOptions() {
    const label = (org) =>
      org.alias ||
      (org.instanceUrl || "")
        .replace(/^https?:\/\//i, "")
        .replace(/\/$/, "")
        .replace(/\.my\.salesforce\.com$/i, "") ||
      org.username;
    const options = [...(this.orgs || [])]
      .map((org) => ({ label: label(org), value: org.username }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (this.username && !options.some((o) => o.value === this.username)) {
      options.push({ label: this.username, value: this.username });
    }
    return options;
  }

  get refreshDisabled() {
    return !this.level || this.level.loading;
  }

  handleRefresh() {
    this.refreshCurrentLevel();
  }

  handleOrgChange(event) {
    this.username = event.detail.value;
    // Another org gives other dependencies: search again at the current level
    this.refreshCurrentLevel();
  }

  // ---- Path ----------------------------------------------------------------

  get hasLevels() {
    return this.levels.length > 0;
  }

  get pathItems() {
    return this.levels.map((level, index) => {
      const isCurrent = index === this.currentLevel;
      return {
        key: `${index}-${level.type}-${level.title}`,
        index,
        type: level.type || "?",
        label: decodeName(level.title),
        title: `${level.type} ${decodeName(level.title)}`,
        showSeparator: index > 0,
        pillClass: getMetadataTypePillClass(level.type),
        buttonClass: isCurrent
          ? "deps-path-button deps-path-current"
          : "deps-path-button",
        ariaCurrent: isCurrent ? "page" : null,
      };
    });
  }

  handlePathClick(event) {
    const index = Number(event.currentTarget.dataset.level);
    if (Number.isNaN(index) || index === this.currentLevel) {
      return;
    }
    // Going back keeps the result of each level: no new org call
    this.levels = this.levels.slice(0, index + 1);
    this.currentLevel = index;
    this.selectedIds = [];
    this.reportFiles = [];
    const level = this.levels[index];
    this.formType = level.type || this.formType;
    this.formName = level.title || this.formName;
  }

  // ---- States --------------------------------------------------------------

  get isLoading() {
    return this.level?.loading === true;
  }

  get loadingText() {
    return this.t("findingDependencies", {
      name: decodeName(this.level?.title || ""),
      org: this.orgLabel,
    });
  }

  get errorMessage() {
    return this.level && !this.level.loading ? this.level.error : null;
  }

  get usedBy() {
    return this.level?.result?.usedBy || [];
  }

  get showEmptyForm() {
    return !this.hasLevels;
  }

  get showNoResult() {
    return (
      !!this.level &&
      !this.level.loading &&
      !this.level.error &&
      !!this.level.result &&
      this.usedBy.length === 0
    );
  }

  get showResults() {
    return (
      !!this.level &&
      !this.level.loading &&
      !this.level.error &&
      this.usedBy.length > 0
    );
  }

  get orgLabel() {
    const org = (this.orgs || []).find((o) => o.username === this.username);
    return org?.alias || this.username || "";
  }

  get noResultTitle() {
    return this.t("noComponentUsesItem", {
      name: decodeName(this.level?.title || ""),
      org: this.orgLabel,
    });
  }

  get summaryText() {
    return this.t("componentsUseItem", {
      count: this.usedBy.length,
      name: decodeName(this.level?.title || ""),
      org: this.orgLabel,
    });
  }

  get readFromOrgText() {
    const readAt = this.level?.readAt;
    const time = readAt
      ? readAt.toLocaleTimeString(this.locale, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return this.t("dependenciesReadFromOrg", { org: this.orgLabel, time });
  }

  get rowCapWarning() {
    return this.usedBy.length >= TOOLING_ROW_CAP
      ? this.t("dependenciesRowCapWarning", { count: TOOLING_ROW_CAP })
      : null;
  }

  get hasReportFiles() {
    return this.reportFiles.length > 0;
  }

  // ---- Table ---------------------------------------------------------------

  get columns() {
    return [
      {
        label: this.t("metadataTypeLabel"),
        fieldName: "typeLabel",
        type: "typePill",
        sortable: true,
        initialWidth: 210,
        typeAttributes: {
          label: { fieldName: "typeLabel" },
          pillClass: { fieldName: "pillClass" },
        },
      },
      {
        label: this.t("metadataNameLabel"),
        fieldName: "displayName",
        type: "button",
        sortable: true,
        wrapText: true,
        typeAttributes: {
          label: { fieldName: "displayName" },
          title: { fieldName: "openTitle" },
          name: "open",
          variant: "base",
          disabled: { fieldName: "openDisabled" },
        },
      },
      {
        label: this.t("componentLabel"),
        fieldName: "componentLabel",
        type: "text",
        wrapText: true,
      },
      {
        label: this.t("inThisProject"),
        fieldName: "localText",
        type: "text",
        sortable: true,
        initialWidth: 150,
        cellAttributes: {
          iconName: { fieldName: "localIcon" },
          iconPosition: "left",
        },
      },
      {
        type: "action",
        typeAttributes: { rowActions: { fieldName: "rowActions" } },
      },
    ];
  }

  get tableRows() {
    const rows = this.usedBy.map((row) => {
      const displayName = decodeName(row.usedByApiName || row.usedByName || "");
      const hasLocalFile = !!row.usedByLocalFile;
      return {
        ...row,
        typeLabel: row.usedByType,
        pillClass: getMetadataTypePillClass(row.usedByType),
        displayName,
        componentLabel:
          row.usedByName && row.usedByName !== displayName ? row.usedByName : "",
        openDisabled: !hasLocalFile,
        openTitle: hasLocalFile ? row.usedByLocalFile : this.t("notInProject"),
        localText: hasLocalFile ? this.t("inProject") : this.t("onlyInOrg"),
        localIcon: hasLocalFile ? "utility:check" : "utility:cloud",
        rowActions: this.buildRowActions(row, hasLocalFile),
      };
    });
    const direction = this.sortedDirection === "asc" ? 1 : -1;
    const field = this.sortedBy;
    return rows.sort(
      (a, b) =>
        direction * String(a[field] || "").localeCompare(String(b[field] || "")) ||
        a.displayName.localeCompare(b.displayName),
    );
  }

  buildRowActions(row, hasLocalFile) {
    return [
      {
        label: hasLocalFile
          ? this.t("openLocalFile")
          : `${this.t("openLocalFile")} (${this.t("notInProject")})`,
        name: "open",
        iconName: "utility:file",
        disabled: !hasLocalFile,
      },
      {
        label:
          row.usedByType === "Flow"
            ? this.t("openInFlowBuilder")
            : this.t("openInSetup"),
        name: "setup",
        iconName: "utility:setup",
        disabled: !row.usedBySetupPath,
      },
      {
        label: this.t("findWhereUsedLabel"),
        name: "drill",
        iconName: "utility:hierarchy",
      },
      {
        label: row.usedByApiName
          ? this.t("retrieveIntoProject")
          : `${this.t("retrieveIntoProject")} (${this.t("noApiNameCannotRetrieve")})`,
        name: "retrieve",
        iconName: "utility:download",
        disabled: !row.usedByApiName,
      },
    ];
  }

  handleSort(event) {
    this.sortedBy = event.detail.fieldName;
    this.sortedDirection = event.detail.sortDirection;
  }

  handleRowSelection(event) {
    this.selectedIds = (event.detail.selectedRows || []).map(
      (row) => row.usedById,
    );
  }

  handleRowAction(event) {
    const actionName = event.detail.action?.name;
    const row = event.detail.row;
    if (!row) {
      return;
    }
    if (actionName === "open" && row.usedByLocalFile) {
      window.sendMessageToVSCode({
        type: "openLocalFile",
        data: { path: row.usedByLocalFile },
      });
    } else if (actionName === "setup" && row.usedBySetupPath) {
      window.sendMessageToVSCode({
        type: "openInSetup",
        data: { username: this.username, path: row.usedBySetupPath },
      });
    } else if (actionName === "drill") {
      // Without an API name, the dependent is found by its Id
      this.openLevel(
        row.usedByApiName
          ? { type: row.usedByType, name: row.usedByApiName }
          : { type: row.usedByType, id: row.usedById },
      );
    } else if (actionName === "retrieve" && row.usedByApiName) {
      this.retrieve([row]);
    }
  }

  // ---- Retrieve and report ---------------------------------------------------

  get retrievableSelectedRows() {
    return this.usedBy.filter(
      (row) => this.selectedIds.includes(row.usedById) && row.usedByApiName,
    );
  }

  get retrieveSelectedLabel() {
    return this.t("retrieveSelectedCount", {
      count: this.retrievableSelectedRows.length,
    });
  }

  get retrieveDisabled() {
    return this.isRetrieving || this.retrievableSelectedRows.length === 0;
  }

  get reportDisabled() {
    return this.isGeneratingReport || !this.level?.result;
  }

  handleRetrieveSelected() {
    this.retrieve(this.retrievableSelectedRows);
  }

  retrieve(rows) {
    if (!this.username || rows.length === 0) {
      return;
    }
    this.isRetrieving = true;
    window.sendMessageToVSCode({
      type: "retrieveComponents",
      data: {
        username: this.username,
        components: rows.map((row) => ({
          memberType: row.usedByType,
          memberName: row.usedByApiName,
        })),
      },
    });
  }

  handleGenerateReport() {
    if (!this.level) {
      return;
    }
    this.isGeneratingReport = true;
    this.reportFiles = [];
    window.sendMessageToVSCode({
      type: "generateReport",
      data: { query: this.level.query, username: this.username },
    });
  }

  handleOpenReportFile(event) {
    const file = event.currentTarget.dataset.file;
    if (file) {
      window.sendMessageToVSCode({ type: "openReportFile", data: { path: file } });
    }
  }
}
