import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getMetadataTypePillClass } from "s/pillUtils";

// Example API name of common types, shown as the placeholder of the name field
const NAME_HINTS = [
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

// Same identifier rule as the CLI (isMetadataType)
const METADATA_TYPE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

// Value of a folder suggestion in the name field (folder types list their folders first)
const FOLDER_PREFIX = "__folder__:";

// Maximum number of name suggestions rendered at once: filtering narrows the rest
const MAX_NAME_OPTIONS = 50;

// Same empty list on each render, so the typeahead does not filter again
const EMPTY_OPTIONS = [];

// Types the CLI can not list: no name suggestions to prefetch
const NOT_LISTABLE_TYPES = ["Unknown", "StandardEntity"];

// Directions of sf hardis:doc:metadata-deps --direction
const USED_BY = "used-by";
const USES = "uses";

// A standard object on the used side is a StandardEntity: it is drilled into and retrieved as a CustomObject
function metadataTypeOf(row) {
  return row.type === "StandardEntity" ? "CustomObject" : row.type;
}

const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

// A component can be drilled into by its API name, else by a real Salesforce Id
// (some dependency rows carry a name instead of an Id, like "User")
function canDrill(row) {
  return !!row.apiName || SALESFORCE_ID_RE.test(row.id || "");
}

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
  // Direction of the next search from the form: used-by or uses
  formDirection = USED_BY;
  // Folder picked in the name field, for Report, Dashboard, Document and EmailTemplate
  nameFolder = null;
  // Text of the type field while it is typed (committed to formType on Enter or blur)
  typeDraft = null;
  // Every Metadata API type, bundled in the extension: no org call
  metadataTypes = [];
  // Name suggestions per "username|type|folder", filled in the background
  @track namesCache = {};
  namesLoadingKeys = [];
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
  // Render-time memo: its properties change during render, so they are never reactive fields
  _memo = {};

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
    if (Array.isArray(data.metadataTypes) && data.metadataTypes.length > 0) {
      this.metadataTypes = data.metadataTypes;
    }
    if (data.query) {
      // The same init data can arrive twice when the panel is created: search once
      const initKey = JSON.stringify({
        query: data.query,
        username: this.username,
      });
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
    if (type === "namesResult") {
      this.handleNamesResult(data || {});
    } else if (type === "listOrgsResults") {
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
      this.applyRetrievedFiles(data?.files || []);
    } else if (type === "reportGenerated") {
      this.isGeneratingReport = false;
      this.reportFiles = (data?.reportFiles || []).map((file) => ({
        file: file.file,
        label:
          file.type === "xlsx"
            ? this.t("openExcelReport")
            : this.t("openCsvReport"),
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

  // What the current level shows: its result in the selected direction
  get view() {
    return this.level ? this.level.views[this.level.direction] || null : null;
  }

  // One per direction of a level: switching direction shows the other view, without a new level
  newView() {
    return {
      result: null,
      error: null,
      loading: true,
      // A last known result is on screen while the org is read again
      refreshing: false,
      requestId: null,
      readAt: null,
    };
  }

  // The query of a level in a direction, its current one by default
  levelQuery(level, direction = level.direction) {
    return { ...level.query, direction };
  }

  openLevel(query) {
    const title =
      query.name ||
      (query.sourceFile ? query.sourceFile.split(/[\\/]/).pop() : "") ||
      query.id ||
      "";
    const direction = query.direction === USES ? USES : USED_BY;
    this.formDirection = direction;
    const baseQuery = { ...query };
    delete baseQuery.direction;
    const level = {
      query: baseQuery,
      direction,
      title,
      type: query.type || "",
      views: { [direction]: this.newView() },
    };
    this.levels = [...this.levels.slice(0, this.currentLevel + 1), level];
    this.currentLevel = this.levels.length - 1;
    this.selectedIds = [];
    this.reportFiles = [];
    if (query.type) {
      this.formType = query.type;
    }
    this.formName = query.name || "";
    this.nameFolder = null;
    this.typeDraft = null;
    this.requestDependencies(level);
  }

  // lowPriority: a background read (the other direction), queued behind what the user asked for
  requestDependencies(level, direction = level.direction, options = {}) {
    const view =
      level.views[direction] || (level.views[direction] = this.newView());
    this.requestSequence += 1;
    view.requestId = this.requestSequence;
    view.loading = true;
    view.refreshing = false;
    view.error = null;
    this.levels = [...this.levels];
    window.sendMessageToVSCode({
      type: "findDependencies",
      data: {
        requestId: view.requestId,
        query: this.levelQuery(level, direction),
        username: this.username,
        lowPriority: options.lowPriority === true,
      },
    });
  }

  refreshCurrentLevel() {
    if (this.level) {
      this.requestDependencies(this.level);
    }
  }

  handleDependencies(type, data) {
    let level = null;
    let view = null;
    for (const item of this.levels) {
      view = Object.values(item.views).find(
        (candidate) => candidate.requestId === data.requestId,
      );
      if (view) {
        level = item;
        break;
      }
    }
    if (!level) {
      // Answer to a level the user already left
      return;
    }
    view.loading = false;
    // A stale answer is the last known result: the fresh one follows with the same request Id
    view.refreshing = data.stale === true;
    if (type === "dependenciesError") {
      view.error = data.error || this.t("metadataDependenciesError");
    } else {
      view.error = null;
      view.result = data.result || null;
      view.readAt = data.readAt ? new Date(data.readAt) : new Date();
      const component = data.result?.selected;
      if (component) {
        level.title = component.name || level.title;
        // Same pill in both directions: a standard object is a CustomObject for the form too
        level.type = component.type
          ? metadataTypeOf({ type: component.type })
          : level.type;
      }
      // Only the view on screen updates the form: an answer for a level or a direction the user
      // left must not overwrite what they see or type
      if (level === this.level && view === this.view) {
        if (component) {
          if (component.type && component.type !== "Unknown") {
            this.formType = metadataTypeOf({ type: component.type });
            this.typeDraft = null;
          }
          this.formName = component.name || this.formName;
        }
        // The result is shown: prefetch the names of this type in the background, at low priority
        this.requestNames();
      }
      // The other direction is read in the background, so the Used by / Uses switch answers at once
      const other = level.direction === USES ? USED_BY : USES;
      if (!data.stale && !level.views[other]) {
        this.requestDependencies(level, other, { lowPriority: true });
      }
    }
    this.levels = [...this.levels];
  }

  // Marks the retrieved dependents as in the project, in every level of the path
  applyRetrievedFiles(files) {
    const filesByComponent = new Map();
    for (const file of files) {
      const key = `${file.type}:${file.fullName}`;
      filesByComponent.set(key, [
        ...(filesByComponent.get(key) || []),
        file.filePath,
      ]);
    }
    const pickFile = (paths, name) =>
      [".js", ".cmp", ".app"]
        .map((extension) =>
          paths.find((p) => p.endsWith(`/${name}${extension}`)),
        )
        .find(Boolean) ||
      paths.find((p) => !p.endsWith("-meta.xml")) ||
      paths[0];
    const views = this.levels.flatMap((level) => Object.values(level.views));
    for (const view of views) {
      for (const row of view.result?.dependencies || []) {
        const paths = filesByComponent.get(
          `${metadataTypeOf(row)}:${row.apiName}`,
        );
        if (paths && paths.length > 0) {
          row.localFile = pickFile(paths, row.apiName);
        }
      }
    }
    this.levels = [...this.levels];
  }

  levelError(message) {
    if (this.view) {
      this.view.error = message || this.t("metadataDependenciesError");
      this.levels = [...this.levels];
    }
  }

  // ---- Search form ---------------------------------------------------------

  // Built once per (type list, current type): the list holds about 570 types
  get typeOptions() {
    const memo = this._memo.typeOptions;
    if (
      memo &&
      memo.types === this.metadataTypes &&
      memo.formType === this.formType
    ) {
      return memo.options;
    }
    const options = this.metadataTypes.map((type) => ({
      label: type,
      value: type,
    }));
    // A typed type, or one reaching the panel from a file or a drill-down, stays selectable
    if (this.formType && !this.metadataTypes.includes(this.formType)) {
      options.unshift({ label: this.formType, value: this.formType });
    }
    this._memo.typeOptions = {
      types: this.metadataTypes,
      formType: this.formType,
      options,
    };
    return options;
  }

  // What the type field shows: the text being typed, else the committed type
  get typeText() {
    return this.typeDraft !== null ? this.typeDraft : this.formType || "";
  }

  get isTypeValid() {
    return METADATA_TYPE_RE.test(this.formType || "");
  }

  get typeError() {
    const text = this.typeText.trim();
    return text && !METADATA_TYPE_RE.test(text)
      ? this.t("invalidMetadataType")
      : null;
  }

  get formNamePlaceholder() {
    if (this.namesEntry?.kind === "folders" && !this.nameFolder) {
      return this.t("pickFolderHint");
    }
    const entry = NAME_HINTS.find((e) => e.value === this.formType);
    return entry ? entry.hint : "";
  }

  // Follows the text of both fields as it is typed, so the button is enabled before any blur
  get searchDisabled() {
    const name = this.formName.trim();
    return (
      !this.username ||
      !METADATA_TYPE_RE.test(this.typeText.trim()) ||
      !name ||
      name.endsWith("/")
    );
  }

  handleTypeText(event) {
    this.typeDraft = event.detail.value || "";
  }

  handleTypeChange(event) {
    const type = (event.detail.value || "").trim();
    this.typeDraft = null;
    if (type === this.formType) {
      return;
    }
    this.formType = type;
    this.formName = "";
    this.nameFolder = null;
    // Suggestions of the new type load in the background
    this.requestNames();
  }

  handleNameFocus() {
    this.requestNames();
  }

  handleNameChange(event) {
    const value = event.detail.value || "";
    if (value.startsWith(FOLDER_PREFIX)) {
      // A folder was picked: its content becomes the suggestions
      this.nameFolder = value.slice(FOLDER_PREFIX.length);
      this.formName = `${this.nameFolder}/`;
      this.requestNames();
      return;
    }
    this.setTypedName(value);
  }

  // Every keystroke of the name field: the typed text is the name, and its folder part
  // decides whether the suggestions are the folders or the content of one folder
  handleNameText(event) {
    this.setTypedName(event.detail.value || "");
  }

  setTypedName(value) {
    this.formName = value;
    // Leaving the picked folder (cleared field, another folder typed) goes back to the folder list
    if (this.nameFolder && !value.startsWith(`${this.nameFolder}/`)) {
      this.nameFolder = null;
    }
    // "Folder/" typed by hand lists the content of that folder
    const slash = value.indexOf("/");
    if (!this.nameFolder && slash > 0) {
      const folders = this.namesCache[this.namesKey(null)];
      const folder = value.slice(0, slash);
      if (
        folders?.kind === "folders" &&
        folders.items.some((item) => item.fullName === folder)
      ) {
        this.nameFolder = folder;
        this.requestNames();
      }
    }
  }

  // Enter in the name field searches, once the typeahead has committed the name
  handleNameKeydown(event) {
    if (event.key === "Enter") {
      this.handleSearch(event);
    }
  }

  // ---- Name suggestions (background, low priority) ----------------------------

  namesKey(folder = this.nameFolder) {
    return `${this.username}|${this.formType}|${folder || ""}`;
  }

  // Suggestions of the current type: the folder list, or the content of the picked folder
  get namesEntry() {
    return this.namesCache[this.namesKey()] || null;
  }

  requestNames() {
    if (
      !this.username ||
      !this.isTypeValid ||
      NOT_LISTABLE_TYPES.includes(this.formType)
    ) {
      return;
    }
    const key = this.namesKey();
    if (this.namesCache[key] || this.namesLoadingKeys.includes(key)) {
      return;
    }
    this.namesLoadingKeys = [...this.namesLoadingKeys, key];
    window.sendMessageToVSCode({
      type: "listNames",
      data: {
        requestKey: key,
        username: this.username,
        type: this.formType,
        folder: this.nameFolder,
      },
    });
  }

  handleNamesResult(data) {
    const key = data.requestKey;
    this.namesLoadingKeys = this.namesLoadingKeys.filter((k) => k !== key);
    // A result for an org changed since is dropped, and a failure is not kept: the next focus tries again
    if (!key || !key.startsWith(`${this.username}|`) || data.error) {
      return;
    }
    const kind = data.kind || "components";
    const items = Array.isArray(data.items) ? data.items : [];
    this.namesCache = {
      ...this.namesCache,
      [key]: {
        kind,
        items,
        listable: data.listable !== false,
        options:
          kind === "folders"
            ? items.map((item) => ({
                label: `${item.fullName}/`,
                value: `${FOLDER_PREFIX}${item.fullName}`,
              }))
            : items.map((item) => ({
                label: item.fullName,
                value: item.fullName,
              })),
      },
    };
  }

  // Built once per listing, in handleNamesResult: a listing can hold thousands of names
  get nameOptions() {
    return this.namesEntry?.options || EMPTY_OPTIONS;
  }

  get namesLoading() {
    return this.namesLoadingKeys.includes(this.namesKey());
  }

  get namesEmptyText() {
    return this.t("noNamesForType");
  }

  get maxNameOptions() {
    return MAX_NAME_OPTIONS;
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
    this.openLevel({
      type: this.formType,
      name: this.formName.trim(),
      direction: this.currentDirection,
    });
  }

  // ---- Direction -------------------------------------------------------------

  // The search button says what it will look for
  get searchButtonLabel() {
    return this.currentDirection === USES
      ? this.t("seeWhatItUsesLabel")
      : this.t("findWhereUsedLabel");
  }

  get currentDirection() {
    return this.level?.direction || this.formDirection;
  }

  get directionOptions() {
    return [
      { label: this.t("directionUsedBy"), value: USED_BY },
      { label: this.t("directionUses"), value: USES },
    ];
  }

  // Shows the current component the other way, on the same level of the path. Each direction keeps
  // its result: switching back and forth reads the org once per direction (Refresh reads it again).
  handleDirectionChange(event) {
    const direction = event.detail.value;
    this.formDirection = direction;
    const level = this.level;
    if (!level || level.direction === direction) {
      return;
    }
    level.direction = direction;
    this.selectedIds = [];
    this.reportFiles = [];
    const view = level.views[direction];
    // A background read that failed is tried again now that the user asks for it
    if (view && !(view.error && !view.loading)) {
      this.levels = [...this.levels];
    } else {
      this.requestDependencies(level);
    }
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
    return !this.view || this.view.loading || this.view.refreshing;
  }

  get isRefreshing() {
    return this.view?.refreshing === true && !this.view.loading;
  }

  get refreshingText() {
    const readAt = this.view?.readAt;
    const time = readAt
      ? readAt.toLocaleTimeString(this.locale, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return this.t("dependenciesRefreshing", { time, org: this.orgLabel });
  }

  handleRefresh() {
    this.refreshCurrentLevel();
  }

  handleOrgChange(event) {
    this.username = event.detail.value;
    // Another org has other names: suggestions load again when needed
    this.namesCache = {};
    this.namesLoadingKeys = [];
    // Another org gives other dependencies: every level of the path is read again when shown
    for (const level of this.levels) {
      level.views = {};
    }
    this.levels = [...this.levels];
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
        directionIcon:
          level.direction === USES ? "utility:arrowdown" : "utility:arrowup",
        directionLabel:
          level.direction === USES
            ? this.t("directionUses")
            : this.t("directionUsedBy"),
        // Levels after the current one stay reachable, dimmed like forward pages
        buttonClass: isCurrent
          ? "deps-path-button deps-path-current"
          : index > this.currentLevel
            ? "deps-path-button deps-path-forward"
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
    // Like a browser history: going back keeps the next levels, to go forward again, and each
    // level keeps its result (no new org call). Drilling down from here replaces the next levels.
    this.currentLevel = index;
    this.selectedIds = [];
    this.reportFiles = [];
    const level = this.levels[index];
    this.formType = level.type
      ? metadataTypeOf({ type: level.type })
      : this.formType;
    this.formName = level.title || this.formName;
    this.formDirection = level.direction;
    this.nameFolder = null;
    this.typeDraft = null;
    // A level left without result (the org changed since) is read again
    const view = level.views[level.direction];
    if (!view || (!view.result && !view.loading)) {
      this.requestDependencies(level);
    }
  }

  // ---- States --------------------------------------------------------------

  get isLoading() {
    return this.view?.loading === true;
  }

  get isUsesLevel() {
    return this.level?.direction === USES;
  }

  get loadingText() {
    return this.t(this.isUsesLevel ? "findingUses" : "findingDependencies", {
      name: decodeName(this.level?.title || ""),
      org: this.orgLabel,
    });
  }

  get errorMessage() {
    return this.view && !this.view.loading ? this.view.error : null;
  }

  get dependencies() {
    return this.view?.result?.dependencies || [];
  }

  get showEmptyForm() {
    return !this.hasLevels;
  }

  get showNoResult() {
    return (
      !!this.view &&
      !this.view.loading &&
      !this.view.error &&
      !!this.view.result &&
      this.dependencies.length === 0
    );
  }

  get showResults() {
    return (
      !!this.view &&
      !this.view.loading &&
      !this.view.error &&
      this.dependencies.length > 0
    );
  }

  get orgLabel() {
    const org = (this.orgs || []).find((o) => o.username === this.username);
    return org?.alias || this.username || "";
  }

  get noResultTitle() {
    return this.t(
      this.isUsesLevel ? "itemUsesNoComponent" : "noComponentUsesItem",
      {
        name: decodeName(this.level?.title || ""),
        org: this.orgLabel,
      },
    );
  }

  get summaryText() {
    return this.t(
      this.isUsesLevel ? "itemUsesComponents" : "componentsUseItem",
      {
        count: this.dependencies.length,
        name: decodeName(this.level?.title || ""),
        org: this.orgLabel,
      },
    );
  }

  get readFromOrgText() {
    const readAt = this.view?.readAt;
    const time = readAt
      ? readAt.toLocaleTimeString(this.locale, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return this.t("dependenciesReadFromOrg", { org: this.orgLabel, time });
  }

  get rowCapWarning() {
    return this.dependencies.length >= TOOLING_ROW_CAP
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
    const rows = this.dependencies.map((row) => {
      const displayName = decodeName(row.apiName || row.name || "");
      const hasLocalFile = !!row.localFile;
      return {
        ...row,
        typeLabel: row.type,
        pillClass: getMetadataTypePillClass(row.type),
        displayName,
        componentLabel: this.buildComponentLabel(row, displayName),
        openDisabled: !hasLocalFile,
        openTitle: hasLocalFile ? row.localFile : this.t("notInProject"),
        localText: hasLocalFile ? this.t("inProject") : this.t("onlyInOrg"),
        localIcon: hasLocalFile ? "utility:check" : "utility:cloud",
        rowActions: this.buildRowActions(row, hasLocalFile),
      };
    });
    const direction = this.sortedDirection === "asc" ? 1 : -1;
    const field = this.sortedBy;
    return rows.sort(
      (a, b) =>
        direction *
          String(a[field] || "").localeCompare(String(b[field] || "")) ||
        a.displayName.localeCompare(b.displayName),
    );
  }

  // Label of the dependent, plus the versions of a Flow that use the component:
  // "Installation Assign Crew · Versions v4 (active), v3, v2, v1"
  buildComponentLabel(row, displayName) {
    const parts = [];
    const versions = row.versions || [];
    // Deleting the obsolete versions of such a Flow removes the dependency
    if (
      versions.length > 0 &&
      versions.every((version) => version.status === "Obsolete")
    ) {
      parts.push(this.t("onlyObsoleteFlowVersions"));
    }
    if (row.name && row.name !== displayName) {
      parts.push(row.name);
    }
    if (versions.length > 0) {
      const versionsText = versions
        .map((version) =>
          version.status === "Active"
            ? `v${version.versionNumber} (${this.t("flowVersionActive")})`
            : `v${version.versionNumber}`,
        )
        .join(", ");
      parts.push(this.t("flowVersionsLabel", { versions: versionsText }));
    }
    return parts.join(" · ");
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
          row.type === "Flow"
            ? this.t("openInFlowBuilder")
            : this.t("openInSetup"),
        name: "setup",
        iconName: "utility:setup",
        disabled: !row.setupPath,
      },
      {
        label: this.t("findWhereUsedLabel"),
        name: "drill",
        iconName: "utility:arrowup",
        disabled: !canDrill(row),
      },
      {
        label: this.t("seeWhatItUsesLabel"),
        name: "drillUses",
        iconName: "utility:arrowdown",
        disabled: !canDrill(row),
      },
      {
        label: row.apiName
          ? this.t("retrieveIntoProject")
          : `${this.t("retrieveIntoProject")} (${this.t("noApiNameCannotRetrieve")})`,
        name: "retrieve",
        iconName: "utility:download",
        disabled: !row.apiName,
      },
    ];
  }

  handleSort(event) {
    this.sortedBy = event.detail.fieldName;
    this.sortedDirection = event.detail.sortDirection;
  }

  handleRowSelection(event) {
    this.selectedIds = (event.detail.selectedRows || []).map((row) => row.id);
  }

  handleRowAction(event) {
    const actionName = event.detail.action?.name;
    const row = event.detail.row;
    if (!row) {
      return;
    }
    if (actionName === "open" && row.localFile) {
      window.sendMessageToVSCode({
        type: "openLocalFile",
        data: { path: row.localFile },
      });
    } else if (actionName === "setup" && row.setupPath) {
      window.sendMessageToVSCode({
        type: "openInSetup",
        data: {
          username: this.username,
          path: row.setupPath,
          name: row.displayName,
        },
      });
    } else if (
      (actionName === "drill" || actionName === "drillUses") &&
      canDrill(row)
    ) {
      // Without an API name, the component is found by its Id
      const direction = actionName === "drillUses" ? USES : USED_BY;
      this.openLevel(
        row.apiName
          ? { type: metadataTypeOf(row), name: row.apiName, direction }
          : { type: row.type, id: row.id, direction },
      );
    } else if (actionName === "retrieve" && row.apiName) {
      this.retrieve([row]);
    }
  }

  // ---- Retrieve and report ---------------------------------------------------

  get retrievableSelectedRows() {
    return this.dependencies.filter(
      (row) => this.selectedIds.includes(row.id) && row.apiName,
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
    return this.isGeneratingReport || !this.view?.result;
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
          memberType: metadataTypeOf(row),
          memberName: row.apiName,
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
      data: { query: this.levelQuery(this.level), username: this.username },
    });
  }

  handleOpenReportFile(event) {
    const file = event.currentTarget.dataset.file;
    if (file) {
      window.sendMessageToVSCode({
        type: "openReportFile",
        data: { path: file },
      });
    }
  }
}
