import { LightningElement, api, track } from "lwc";

// Lightweight SOQL object name extraction. Full parsing/validation lives in
// showDataWorkbench.ts to keep @jetstreamapp/soql-parser-js out of the webview bundle.
function inferObjectNameFromQuery(query) {
  if (!query) {
    return "";
  }
  const match = query.match(
    /from\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)?(?:__[A-Za-z0-9_]+)*)/i,
  );
  return match ? match[1] : "";
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function coerceBoolean(value, defaultValue = false) {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }
  if (
    value === false ||
    value === "false" ||
    value === 0 ||
    value === "0" ||
    value === ""
  ) {
    return false;
  }
  return defaultValue;
}

function createDefaultObject() {
  return {
    query: "SELECT Id, Name FROM Account",
    operation: "Upsert",
    externalId: "",
    deleteOldData: false,
    useQueryAll: false,
    allOrNone: true,
    updateWithMockData: false,
    mockFields: [],
    objectName: "Account",
  };
}

export default class DataWorkbench extends LightningElement {
  workspaces = [];
  selectedWorkspace = null;
  isLoading = false;
  pendingSelectedWorkspacePath = null;
  showLargeActions = true;

  // Properties modal state (create / edit workspace properties)
  showPropertiesModal = false;
  editingWorkspace = null; // null = create mode, non-null = edit mode
  @track workspaceProperties = { name: "", label: "", description: "" };

  // Object editor modal state (add / edit single object)
  showObjectModal = false;
  editingObjectIndex = -1; // -1 = add new, >= 0 = edit existing
  @track editingObject = null;
  objectSoqlError = "";

  // Global settings modal state
  showGlobalSettingsModal = false;
  @track editingScriptSettings = {};

  exportedFilesColumns = [
    {
      label: "File",
      fieldName: "relativePath",
      type: "button",
      typeAttributes: {
        label: { fieldName: "relativePath" },
        name: "open",
        variant: "base",
      },
    },
    {
      label: "Created Date",
      fieldName: "createdLabel",
      type: "text",
    },
    {
      label: "Size",
      fieldName: "sizeLabel",
      type: "text",
      cellAttributes: { alignment: "right" },
    },
    {
      label: "Lines",
      fieldName: "lineCount",
      type: "number",
      cellAttributes: { alignment: "right" },
    },
  ];

  logFilesColumns = [
    {
      label: "File",
      fieldName: "name",
      type: "button",
      typeAttributes: {
        label: { fieldName: "name" },
        name: "open",
        variant: "base",
      },
    },
    {
      label: "Log Type",
      fieldName: "logType",
      type: "text",
    },
    {
      label: "Created Date",
      fieldName: "createdLabel",
      type: "text",
    },
    {
      label: "Size",
      fieldName: "sizeLabel",
      type: "text",
      cellAttributes: { alignment: "right" },
    },
    {
      label: "Lines",
      fieldName: "lineCount",
      type: "number",
      cellAttributes: { alignment: "right" },
    },
  ];

  // jscpd:ignore-start
  connectedCallback() {
    this.loadWorkspaces();
    this.updateActionsVisibility();
    this._boundResize = this.updateActionsVisibility.bind(this);
    window.addEventListener("resize", this._boundResize);
  }

  disconnectedCallback() {
    if (this._boundResize) {
      window.removeEventListener("resize", this._boundResize);
      this._boundResize = null;
    }
  }

  updateActionsVisibility() {
    try {
      this.showLargeActions = (window.innerWidth || 0) > 1024;
    } catch (e) {
      this.showLargeActions = true;
    }
  }
  // jscpd:ignore-end

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "initialize":
        this.handleInitialize(data);
        break;
      case "workspacesLoaded":
        this.handleWorkspacesLoaded(data);
        break;
      case "refreshWorkspaces":
        this.loadWorkspaces();
        break;
      case "workspaceCreated":
        if (data && data.path) {
          this.pendingSelectedWorkspacePath = data.path;
        }
        this.loadWorkspaces();
        this.showPropertiesModal = false;
        this.editingWorkspace = null;
        this.isLoading = false;
        break;
      case "workspaceUpdated": {
        const selectedPath = this.selectedWorkspace?.path;
        this.loadWorkspaces();
        this.showPropertiesModal = false;
        this.showObjectModal = false;
        this.editingWorkspace = null;
        this.editingObject = null;
        this.editingObjectIndex = -1;
        this.objectSoqlError = "";
        if (selectedPath) {
          this.pendingSelectedWorkspacePath = selectedPath;
        }
        this.isLoading = false;
        break;
      }
      case "workspaceCreateFailed":
        this.isLoading = false;
        break;
      case "workspaceUpdateFailed":
        if (this.showObjectModal && data && Array.isArray(data.soqlErrors)) {
          const idx =
            this.editingObjectIndex >= 0
              ? this.editingObjectIndex
              : (this.selectedWorkspace?.objects || []).length;
          this.objectSoqlError = data.soqlErrors[idx] || "";
        }
        this.isLoading = false;
        break;
      case "workspaceDeleted":
        this.loadWorkspaces();
        this.showPropertiesModal = false;
        this.showObjectModal = false;
        this.editingWorkspace = null;
        this.editingObject = null;
        this.selectedWorkspace = null;
        this.isLoading = false;
        break;
      default:
        break;
    }
  }

  @api
  initialize(data) {
    if (data && data.workspaces) {
      this.workspaces = this.normalizeWorkspaces(data.workspaces);
    }
  }

  handleInitialize(data) {
    this.initialize(data);
  }

  handleWorkspacesLoaded(data) {
    this.workspaces = this.normalizeWorkspaces(data.workspaces || []);
    this.isLoading = false;

    const targetPath =
      this.pendingSelectedWorkspacePath ||
      (this.selectedWorkspace ? this.selectedWorkspace.path : null);
    if (targetPath) {
      const updatedWorkspace = this.workspaces.find(
        (w) => w.path === targetPath,
      );
      this.selectedWorkspace = updatedWorkspace || null;
    }
    this.pendingSelectedWorkspacePath = null;
  }

  normalizeWorkspaces(workspacesInput) {
    return (workspacesInput || []).map((ws) => ({
      ...ws,
      scriptSettings: ws.scriptSettings || {},
      description:
        typeof ws.description === "string"
          ? ws.description
          : typeof ws.sfdxHardisDescription === "string"
            ? ws.sfdxHardisDescription
            : "",
      exportedFiles: Array.isArray(ws.exportedFiles) ? ws.exportedFiles : [],
      logFiles: Array.isArray(ws.logFiles) ? ws.logFiles : [],
      objects: (ws.objects || []).map((obj) => ({
        ...obj,
        objectName: obj.objectName || inferObjectNameFromQuery(obj.query),
        deleteOldData: coerceBoolean(obj.deleteOldData),
        useQueryAll: coerceBoolean(obj.useQueryAll),
        allOrNone: coerceBoolean(obj.allOrNone, true),
        updateWithMockData: coerceBoolean(obj.updateWithMockData),
        mockFields: this.normalizeMockFields(obj.mockFields),
      })),
    }));
  }

  // jscpd:ignore-start
  loadWorkspaces() {
    this.isLoading = true;
    window.sendMessageToVSCode({
      type: "loadWorkspaces",
      data: {},
    });
  }

  get hasWorkspaces() {
    return this.workspaces && this.workspaces.length > 0;
  }

  get workspacesForDisplay() {
    return this.workspaces
      .map((workspace) => ({
        ...workspace,
        iconName: "standard:dataset",
        hasDescription: !!workspace.description,
        objectsCount: workspace.objectsCount || 0,
        operationsSummary: (workspace.objects || [])
          .map((obj) => obj.operation || "Upsert")
          .join(", "),
        cssClass: this.getWorkspaceCssClass(workspace),
      }))
      .sort((a, b) => {
        const labelA = (a.label || a.name || "").toLowerCase();
        const labelB = (b.label || b.name || "").toLowerCase();
        return labelA.localeCompare(labelB);
      });
  }
  // jscpd:ignore-end

  // jscpd:ignore-start
  getWorkspaceCssClass(workspace) {
    const baseClasses = "slds-box slds-box_x-small workspace-item";
    const isSelected =
      this.selectedWorkspace && this.selectedWorkspace.path === workspace.path;
    return isSelected ? `${baseClasses} selected` : baseClasses;
  }

  // --- Properties modal computed ---

  get propertiesModalTitle() {
    return this.editingWorkspace
      ? "Edit Workspace Properties"
      : "Create New Workspace";
  }

  get canSaveProperties() {
    const hasName =
      this.workspaceProperties.name &&
      this.workspaceProperties.name.trim().length > 0;
    const hasLabel =
      this.workspaceProperties.label &&
      this.workspaceProperties.label.trim().length > 0;
    return hasName && hasLabel;
  }
  // jscpd:ignore-end

  get savePropertiesButtonDisabled() {
    return !this.canSaveProperties;
  }

  get savePropertiesButtonLabel() {
    return this.editingWorkspace ? "Update Properties" : "Create Workspace";
  }

  // --- Object modal computed ---

  get objectModalTitle() {
    return this.editingObjectIndex >= 0 ? "Edit Object" : "Add Object";
  }

  get canSaveObject() {
    return (
      this.editingObject &&
      this.editingObject.query &&
      this.editingObject.query.trim().length > 0 &&
      !this.objectSoqlError
    );
  }

  get saveObjectButtonDisabled() {
    return !this.canSaveObject;
  }

  get saveObjectButtonLabel() {
    return this.editingObjectIndex >= 0 ? "Update Object" : "Add Object";
  }

  get objectHasSoqlError() {
    return !!this.objectSoqlError;
  }

  get objectSoqlFormElementClass() {
    return this.objectSoqlError
      ? "slds-form-element slds-has-error slds-m-bottom_medium"
      : "slds-form-element slds-m-bottom_medium";
  }

  get editingObjectShowMockFields() {
    return this.editingObject && this.editingObject.updateWithMockData === true;
  }

  get editingObjectMockFieldsWithIndex() {
    if (!this.editingObject) {
      return [];
    }
    return this.normalizeMockFields(this.editingObject.mockFields).map(
      (f, i) => ({
        ...f,
        displayIndex: i + 1,
      }),
    );
  }

  get editingObjectDisableMockFieldRemove() {
    if (!this.editingObject) {
      return true;
    }
    return this.normalizeMockFields(this.editingObject.mockFields).length <= 1;
  }

  get editingObjectName() {
    return this.editingObject ? this.editingObject.objectName : "";
  }

  get selectedWorkspaceHasDescription() {
    if (!this.selectedWorkspace) {
      return false;
    }
    if (typeof this.selectedWorkspace.description !== "string") {
      return false;
    }
    return this.selectedWorkspace.description.trim().length > 0;
  }

  // --- Objects display in main view ---

  get selectedWorkspaceObjectsForDisplay() {
    if (!this.selectedWorkspace || !this.selectedWorkspace.objects) {
      return [];
    }
    return this.selectedWorkspace.objects.map((obj, idx) => ({
      ...obj,
      displayIndex: idx + 1,
      index: idx,
      hasMockFields:
        (this.normalizeMockFields(obj.mockFields) || []).length > 0,
      mockFieldsCount: (this.normalizeMockFields(obj.mockFields) || []).length,
      isExcluded: coerceBoolean(obj.excluded),
      hasHardDelete: coerceBoolean(obj.hardDelete),
      hasDeleteByHierarchy: coerceBoolean(obj.deleteByHierarchy),
      hasDeleteFromSource: coerceBoolean(obj.deleteFromSource),
      hasQueryAllTarget: coerceBoolean(obj.queryAllTarget),
      hasSkipExistingRecords: coerceBoolean(obj.skipExistingRecords),
      hasUseFieldMapping: coerceBoolean(obj.useFieldMapping),
      hasUseValuesMapping: coerceBoolean(obj.useValuesMapping),
      hasUseSourceCSVFile: coerceBoolean(obj.useSourceCSVFile),
      hasBulkApiV1BatchSize: !!obj.bulkApiV1BatchSize,
      hasRestApiBatchSize: !!obj.restApiBatchSize,
    }));
  }

  get hasSelectedWorkspaceObjects() {
    return (
      this.selectedWorkspace &&
      this.selectedWorkspace.objects &&
      this.selectedWorkspace.objects.length > 0
    );
  }

  get operationOptions() {
    return [
      { label: "Upsert", value: "Upsert" },
      { label: "Insert", value: "Insert" },
      { label: "Update", value: "Update" },
      { label: "Delete", value: "Delete" },
      { label: "Readonly", value: "Readonly" },
    ];
  }

  get mockPatternOptions() {
    return [
      { label: "Address - Country", value: "country" },
      { label: "Address - City", value: "city" },
      { label: "Address - Street", value: "street" },
      { label: "Address - Address", value: "address" },
      { label: "Address - ZIP Code", value: "zip" },
      { label: "Personal - Name", value: "name" },
      { label: "Personal - Full Name", value: "full_name" },
      { label: "Personal - Username", value: "username" },
      { label: "Personal - First Name", value: "first_name" },
      { label: "Personal - Last Name", value: "last_name" },
      { label: "Personal - Email", value: "email" },
      { label: "Text - Sentence", value: "sentence" },
      { label: "Text - Title", value: "title" },
      { label: "Text - Text", value: "text" },
      { label: "Text - Word", value: "word" },
      { label: "Internet - IP Address", value: "ip" },
      { label: "Internet - Domain Name", value: "domain" },
      { label: "Internet - URL", value: "url" },
      { label: "Numbers/Date - Random Number", value: "integer" },
      { label: "Numbers/Date - Date", value: "date" },
      { label: "Numbers/Date - Time", value: "time" },
      { label: "Numbers/Date - Year", value: "year" },
    ];
  }

  get hasExportedFiles() {
    const files = this.selectedWorkspace?.exportedFiles || [];
    return files.length > 0;
  }

  get exportedFilesForDisplay() {
    return (this.selectedWorkspace?.exportedFiles || []).map((file) => ({
      ...file,
      sizeLabel: formatBytes(file.size),
      createdLabel: file.created ? new Date(file.created).toLocaleString() : "",
      modifiedLabel: file.modified
        ? new Date(file.modified).toLocaleString()
        : "",
    }));
  }

  get hasLogFiles() {
    const files = this.selectedWorkspace?.logFiles || [];
    return files.length > 0;
  }

  get logFilesForDisplay() {
    return (this.selectedWorkspace?.logFiles || []).map((file) => ({
      ...file,
      sizeLabel: formatBytes(file.size),
      createdLabel: file.created ? new Date(file.created).toLocaleString() : "",
      modifiedLabel: file.modified
        ? new Date(file.modified).toLocaleString()
        : "",
    }));
  }

  // Event Handlers

  // jscpd:ignore-start
  handleWorkspaceSelect(event) {
    const workspacePath = event.currentTarget.dataset.path;
    const workspace = this.workspaces.find((w) => w.path === workspacePath);
    this.selectedWorkspace = workspace;
  }

  // --- SFDMU Documentation ---

  handleOpenSfdmuDoc() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://help.sfdmu.com/full-documentation/export-json-file-objects-specification/export-json-file-overview",
    });
  }

  // --- Create workspace ---

  handleCreateWorkspace() {
    this.editingWorkspace = null;
    this.workspaceProperties = { name: "", label: "", description: "" };
    this.showPropertiesModal = true;
  }

  // --- Edit properties ---

  handleEditProperties(event) {
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    if (!this.selectedWorkspace) {
      return;
    }
    this.editingWorkspace = this.selectedWorkspace;
    this.workspaceProperties = {
      name: this.selectedWorkspace.name,
      label: this.selectedWorkspace.label,
      description: this.selectedWorkspace.description || "",
    };
    this.showPropertiesModal = true;
  }

  handlePropertiesNameChange(event) {
    this.workspaceProperties = {
      ...this.workspaceProperties,
      name: event.detail?.value ?? event.target.value,
    };
  }

  handlePropertiesLabelChange(event) {
    this.workspaceProperties = {
      ...this.workspaceProperties,
      label: event.detail?.value ?? event.target.value,
    };
  }

  handlePropertiesDescriptionChange(event) {
    this.workspaceProperties = {
      ...this.workspaceProperties,
      description: event.detail?.value ?? event.target.value,
    };
  }

  handleCancelProperties() {
    this.showPropertiesModal = false;
    this.editingWorkspace = null;
  }

  handleSaveProperties() {
    this.isLoading = true;
    if (this.editingWorkspace) {
      const data = {
        name: this.workspaceProperties.name,
        label: this.workspaceProperties.label,
        description: this.workspaceProperties.description,
        objects: this.editingWorkspace.objects || [],
        scriptSettings: this.editingWorkspace.scriptSettings || {},
        originalPath: this.editingWorkspace.path,
      };
      window.sendMessageToVSCode({
        type: "updateWorkspace",
        data: JSON.parse(JSON.stringify(data)),
      });
    } else {
      const data = {
        name: this.workspaceProperties.name,
        label: this.workspaceProperties.label,
        description: this.workspaceProperties.description,
        objects: [],
      };
      window.sendMessageToVSCode({
        type: "createWorkspace",
        data: JSON.parse(JSON.stringify(data)),
      });
    }
  }

  // --- Add / Edit / Delete object ---

  handleAddObject() {
    if (!this.selectedWorkspace) {
      return;
    }
    this.editingObjectIndex = -1;
    this.editingObject = createDefaultObject();
    this.objectSoqlError = "";
    this.showObjectModal = true;
  }

  handleEditObject(event) {
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    const index = Number(event.currentTarget.dataset.index);
    if (!this.selectedWorkspace || !this.selectedWorkspace.objects[index]) {
      return;
    }
    const obj = this.selectedWorkspace.objects[index];
    this.editingObjectIndex = index;
    this.editingObject = {
      ...obj,
      query: obj.query || "",
      operation: obj.operation || "Upsert",
      externalId: obj.externalId || "",
      deleteOldData: coerceBoolean(obj.deleteOldData),
      useQueryAll: coerceBoolean(obj.useQueryAll),
      allOrNone: coerceBoolean(obj.allOrNone, true),
      bulkApiV1BatchSize: this.normalizeBatchSizeValue(
        obj.bulkApiV1BatchSize ?? obj.batchSize,
      ),
      restApiBatchSize: this.normalizeBatchSizeValue(obj.restApiBatchSize),
      updateWithMockData: coerceBoolean(obj.updateWithMockData),
      mockFields: this.normalizeMockFields(obj.mockFields),
      objectName: inferObjectNameFromQuery(obj.query),
    };
    this.objectSoqlError = "";
    this.showObjectModal = true;
  }

  handleDeleteObject(event) {
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    const index = Number(event.currentTarget.dataset.index);
    if (!this.selectedWorkspace || !this.selectedWorkspace.objects[index]) {
      return;
    }
    const objects = [...this.selectedWorkspace.objects];
    objects.splice(index, 1);
    this.isLoading = true;
    const data = {
      name: this.selectedWorkspace.name,
      label: this.selectedWorkspace.label,
      description: this.selectedWorkspace.description,
      objects: objects,
      scriptSettings: this.selectedWorkspace.scriptSettings || {},
      originalPath: this.selectedWorkspace.path,
    };
    window.sendMessageToVSCode({
      type: "updateWorkspace",
      data: JSON.parse(JSON.stringify(data)),
    });
  }

  // --- Object modal field handlers ---

  handleObjFieldChange(event) {
    const field = event.currentTarget.dataset.field;
    const value =
      event.detail?.value ??
      (event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value);
    this.editingObject = { ...this.editingObject, [field]: value };
    if (field === "query") {
      this.editingObject = {
        ...this.editingObject,
        objectName: inferObjectNameFromQuery(value),
      };
      this.objectSoqlError = "";
    }
  }

  handleObjToggleChange(event) {
    const field =
      event?.currentTarget?.dataset?.field || event?.target?.dataset?.field;
    if (!field) {
      return;
    }
    const rawValue =
      event.detail?.checked ?? event.target?.checked ?? event.detail?.value;
    const currentValue = this.editingObject ? this.editingObject[field] : false;
    const defaultValue = field === "allOrNone" ? true : currentValue;
    const value = coerceBoolean(rawValue, defaultValue);
    let updated = { ...this.editingObject, [field]: value };
    if (field === "updateWithMockData" && value === true) {
      const mockFields = this.normalizeMockFields(updated.mockFields);
      if (mockFields.length === 0) {
        updated = { ...updated, mockFields: [{ name: "", pattern: "" }] };
      }
    }
    this.editingObject = updated;
  }

  handleObjBatchSizeChange(event) {
    const field = event.currentTarget.dataset.field || "bulkApiV1BatchSize";
    const valueRaw = event.detail?.value ?? event.target.value;
    const valueNum = this.normalizeBatchSizeValue(valueRaw);
    this.editingObject = { ...this.editingObject, [field]: valueNum };
  }

  handleObjMockFieldChange(event) {
    const fieldIndex = Number(event.currentTarget.dataset.fieldindex);
    const field = event.currentTarget.dataset.field;
    const value = event.detail?.value ?? event.target.value;
    const mockFields = [
      ...this.normalizeMockFields(this.editingObject.mockFields),
    ];
    if (!mockFields[fieldIndex]) {
      return;
    }
    mockFields[fieldIndex] = { ...mockFields[fieldIndex], [field]: value };
    this.editingObject = { ...this.editingObject, mockFields };
  }

  handleAddObjMockField() {
    const mockFields = [
      ...this.normalizeMockFields(this.editingObject.mockFields),
    ];
    mockFields.push({ name: "", pattern: "" });
    this.editingObject = { ...this.editingObject, mockFields };
  }

  handleRemoveObjMockField(event) {
    const fieldIndex = Number(event.currentTarget.dataset.fieldindex);
    const mockFields = [
      ...this.normalizeMockFields(this.editingObject.mockFields),
    ];
    if (mockFields.length <= 1) {
      return;
    }
    mockFields.splice(fieldIndex, 1);
    this.editingObject = { ...this.editingObject, mockFields };
  }

  handleCancelObject() {
    this.showObjectModal = false;
    this.editingObject = null;
    this.editingObjectIndex = -1;
    this.objectSoqlError = "";
  }

  handleSaveObject() {
    if (!this.selectedWorkspace || !this.editingObject) {
      return;
    }
    this.isLoading = true;
    const cleanedEditingObject = this.normalizeObjectForSave(
      this.editingObject,
    );
    const objects = [...(this.selectedWorkspace.objects || [])];
    if (this.editingObjectIndex >= 0) {
      objects[this.editingObjectIndex] = { ...cleanedEditingObject };
    } else {
      objects.push({ ...cleanedEditingObject });
      // Track index for error handling on validation failure
      this.editingObjectIndex = objects.length - 1;
    }
    const data = {
      name: this.selectedWorkspace.name,
      label: this.selectedWorkspace.label,
      description: this.selectedWorkspace.description,
      objects: objects,
      scriptSettings: this.selectedWorkspace.scriptSettings || {},
      originalPath: this.selectedWorkspace.path,
    };
    window.sendMessageToVSCode({
      type: "updateWorkspace",
      data: JSON.parse(JSON.stringify(data)),
    });
  }

  // --- Workspace actions ---

  handleDeleteWorkspace(event) {
    let path;

    if (event.detail && event.detail.value === "deleteWorkspace") {
      path = this.selectedWorkspace?.path;
    } else {
      const pathFromDataset = event?.currentTarget?.dataset?.path;
      path =
        (this.selectedWorkspace && this.selectedWorkspace.path) ||
        pathFromDataset;
    }

    if (path) {
      const ws =
        this.workspaces.find((w) => w.path === path) || this.selectedWorkspace;
      window.sendMessageToVSCode({
        type: "deleteWorkspace",
        data: { path, label: ws?.label || ws?.name || path },
      });
    }

    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
  }

  handleOpenFolder() {
    if (this.selectedWorkspace && this.selectedWorkspace.path) {
      window.sendMessageToVSCode({
        type: "openWorkspaceFolder",
        data: { path: this.selectedWorkspace.path },
      });
    }
  }

  handleRefreshExportedFiles() {
    if (this.selectedWorkspace?.path) {
      this.pendingSelectedWorkspacePath = this.selectedWorkspace.path;
    }
    this.isLoading = true;
    this.loadWorkspaces();
  }

  handleExportData(event) {
    if (event && event.detail && event.detail.value === "export") {
      // menu click
    } else if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }

    if (this.selectedWorkspace) {
      window.sendMessageToVSCode({
        type: "runCommand",
        data: {
          command: `sf hardis:org:data:export --path "${this.selectedWorkspace.path}"`,
        },
      });
    }
  }

  handleImportData(event) {
    if (event && event.detail && event.detail.value === "import") {
      // menu click
    } else if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }

    if (this.selectedWorkspace) {
      window.sendMessageToVSCode({
        type: "runCommand",
        data: {
          command: `sf hardis:org:data:import --path "${this.selectedWorkspace.path}"`,
        },
      });
    }
  }

  handleDeleteData(event) {
    if (event && event.detail && event.detail.value === "deleteData") {
      // menu click
    } else if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }

    if (this.selectedWorkspace) {
      window.sendMessageToVSCode({
        type: "runCommand",
        data: {
          command: `sf hardis:org:data:delete --path "${this.selectedWorkspace.path}"`,
        },
      });
    }
  }

  handleConfigureWorkspace() {
    if (this.selectedWorkspace) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: this.selectedWorkspace.configPath },
      });
    }
  }

  handleExportedFileAction(event) {
    const actionName = event?.detail?.action?.name;
    const row = event?.detail?.row;
    if (actionName === "open" && row?.path) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: row.path },
      });
    }
  }

  handleLogFileAction(event) {
    const actionName = event?.detail?.action?.name;
    const row = event?.detail?.row;
    if (actionName === "open" && row?.path) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: row.path },
      });
    }
  }
  // jscpd:ignore-end

  // --- Utilities ---

  normalizeBatchSizeValue(value) {
    if (value === "" || value === null || value === undefined) {
      return "";
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? "" : numeric;
  }

  normalizeObjectForSave(objectConfig) {
    const result = { ...objectConfig };

    // Core fields
    result.deleteOldData = coerceBoolean(result.deleteOldData);
    result.useQueryAll = coerceBoolean(result.useQueryAll);
    result.allOrNone = coerceBoolean(result.allOrNone, true);
    result.updateWithMockData = coerceBoolean(result.updateWithMockData);
    result.mockFields = this.normalizeMockFields(result.mockFields);

    // Optional booleans - normalize if present
    const optionalBooleans = [
      "hardDelete",
      "deleteByHierarchy",
      "deleteFromSource",
      "excluded",
      "queryAllTarget",
      "skipExistingRecords",
      "skipRecordsComparison",
      "useFieldMapping",
      "useValuesMapping",
      "useSourceCSVFile",
      "alwaysUseRestApi",
      "alwaysUseBulkApi",
      "alwaysUseBulkApiToUpdateRecords",
      "respectOrderByOnDeleteRecords",
    ];
    for (const field of optionalBooleans) {
      if (result[field] !== undefined) {
        result[field] = coerceBoolean(result[field]);
      }
    }
    if (result.master !== undefined) {
      result.master = coerceBoolean(result.master, true);
    }

    // Integer fields
    const intFields = [
      "bulkApiV1BatchSize",
      "restApiBatchSize",
      "parallelBulkJobs",
      "parallelRestJobs",
    ];
    for (const field of intFields) {
      result[field] = this.normalizeBatchSizeValue(result[field]);
    }

    // Migrate legacy batchSize
    if (result.batchSize !== undefined) {
      if (
        result.bulkApiV1BatchSize === "" ||
        result.bulkApiV1BatchSize === undefined
      ) {
        result.bulkApiV1BatchSize = this.normalizeBatchSizeValue(
          result.batchSize,
        );
      }
      delete result.batchSize;
    }

    // Handle excludedFields / excludedFromUpdateFields as arrays
    const arrayStringFields = ["excludedFields", "excludedFromUpdateFields"];
    for (const field of arrayStringFields) {
      if (typeof result[field] === "string") {
        result[field] = result[field]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    return result;
  }

  normalizeMockFields(mockFields) {
    if (!Array.isArray(mockFields)) {
      return [];
    }
    return mockFields
      .filter((mockField) => mockField && typeof mockField === "object")
      .map((mockField) => {
        const result = {
          name: mockField.name || "",
          pattern: mockField.pattern || "",
        };
        if (mockField.locale !== undefined) {
          result.locale = mockField.locale || "";
        }
        if (mockField.excludedRegex !== undefined) {
          result.excludedRegex = mockField.excludedRegex || "";
        }
        if (mockField.includedRegex !== undefined) {
          result.includedRegex = mockField.includedRegex || "";
        }
        return result;
      });
  }

  // --- Global Settings ---

  get hasScriptSettings() {
    if (!this.selectedWorkspace || !this.selectedWorkspace.scriptSettings) {
      return false;
    }
    const settings = this.selectedWorkspace.scriptSettings;
    const keys = Object.keys(settings).filter(
      (k) => k !== "$schema" && k !== "objectSets",
    );
    return keys.length > 0;
  }

  get scriptSettingsSummary() {
    if (!this.selectedWorkspace || !this.selectedWorkspace.scriptSettings) {
      return "No global settings configured.";
    }
    const settings = this.selectedWorkspace.scriptSettings;
    const keys = Object.keys(settings).filter(
      (k) => k !== "$schema" && k !== "objectSets",
    );
    if (keys.length === 0) {
      return "No global settings configured.";
    }
    return `${keys.length} global setting(s) configured.`;
  }

  get _ss() {
    return (
      (this.selectedWorkspace && this.selectedWorkspace.scriptSettings) || {}
    );
  }

  get ssHasApiVersion() {
    return !!this._ss.apiVersion;
  }

  get ssApiVersion() {
    return this._ss.apiVersion || "";
  }

  get ssSimulationMode() {
    return !!this._ss.simulationMode;
  }

  get ssAllOrNone() {
    return !!this._ss.allOrNone;
  }

  get ssAllowFieldTruncation() {
    return !!this._ss.allowFieldTruncation;
  }

  get ssKeepObjectOrder() {
    return !!this._ss.keepObjectOrderWhileExecute;
  }

  get ssHasBulkApiVersion() {
    return !!this._ss.bulkApiVersion;
  }

  get ssBulkApiVersion() {
    return this._ss.bulkApiVersion || "";
  }

  get ssHasConcurrencyMode() {
    return (
      !!this._ss.concurrencyMode && this._ss.concurrencyMode !== "Parallel"
    );
  }

  get ssConcurrencyMode() {
    return this._ss.concurrencyMode || "";
  }

  get ssHasBulkThreshold() {
    return this._ss.bulkThreshold != null && this._ss.bulkThreshold !== "";
  }

  get ssBulkThreshold() {
    return this._ss.bulkThreshold;
  }

  get ssHasQueryBulkApiThreshold() {
    return (
      this._ss.queryBulkApiThreshold != null &&
      this._ss.queryBulkApiThreshold !== ""
    );
  }

  get ssQueryBulkApiThreshold() {
    return this._ss.queryBulkApiThreshold;
  }

  get ssHasBulkApiV1BatchSize() {
    return (
      this._ss.bulkApiV1BatchSize != null && this._ss.bulkApiV1BatchSize !== ""
    );
  }

  get ssBulkApiV1BatchSize() {
    return this._ss.bulkApiV1BatchSize;
  }

  get ssHasRestApiBatchSize() {
    return (
      this._ss.restApiBatchSize != null && this._ss.restApiBatchSize !== ""
    );
  }

  get ssRestApiBatchSize() {
    return this._ss.restApiBatchSize;
  }

  get ssAlwaysUseRestApiToUpdateRecords() {
    return !!this._ss.alwaysUseRestApiToUpdateRecords;
  }

  get ssHasParallelBulkJobs() {
    return (
      this._ss.parallelBulkJobs != null &&
      this._ss.parallelBulkJobs !== "" &&
      this._ss.parallelBulkJobs > 1
    );
  }

  get ssParallelBulkJobs() {
    return this._ss.parallelBulkJobs;
  }

  get ssHasParallelRestJobs() {
    return (
      this._ss.parallelRestJobs != null &&
      this._ss.parallelRestJobs !== "" &&
      this._ss.parallelRestJobs > 1
    );
  }

  get ssParallelRestJobs() {
    return this._ss.parallelRestJobs;
  }

  get ssHasParallelBinaryDownloads() {
    return (
      this._ss.parallelBinaryDownloads != null &&
      this._ss.parallelBinaryDownloads !== "" &&
      this._ss.parallelBinaryDownloads > 1
    );
  }

  get ssParallelBinaryDownloads() {
    return this._ss.parallelBinaryDownloads;
  }

  get ssCreateTargetCSVFiles() {
    return !!this._ss.createTargetCSVFiles;
  }

  get ssCsvInsertNulls() {
    return !!this._ss.csvInsertNulls;
  }

  get ssCsvUseEuropeanDateFormat() {
    return !!this._ss.csvUseEuropeanDateFormat;
  }

  get ssHasCsvFileEncoding() {
    return !!this._ss.csvFileEncoding && this._ss.csvFileEncoding !== "utf8";
  }

  get ssCsvFileEncoding() {
    return this._ss.csvFileEncoding || "";
  }

  get ssHasBinaryDataCache() {
    return (
      !!this._ss.binaryDataCache && this._ss.binaryDataCache !== "InMemory"
    );
  }

  get ssBinaryDataCache() {
    return this._ss.binaryDataCache || "";
  }

  get ssHasSourceRecordsCache() {
    return (
      !!this._ss.sourceRecordsCache &&
      this._ss.sourceRecordsCache !== "InMemory"
    );
  }

  get ssSourceRecordsCache() {
    return this._ss.sourceRecordsCache || "";
  }

  get ssHasExcludedObjects() {
    return !!this._ss.excludedObjects;
  }

  get ssExcludedObjects() {
    return this._ss.excludedObjects || "";
  }

  get ssHasProxyUrl() {
    return !!this._ss.proxyUrl;
  }

  get bulkApiVersionOptions() {
    return [
      { label: "2.0 (default)", value: "2.0" },
      { label: "1.0", value: "1.0" },
    ];
  }

  get concurrencyModeOptions() {
    return [
      { label: "Parallel (default)", value: "Parallel" },
      { label: "Serial", value: "Serial" },
    ];
  }

  get cacheOptions() {
    return [
      { label: "InMemory (default)", value: "InMemory" },
      { label: "CleanFileCache", value: "CleanFileCache" },
      { label: "FileCache", value: "FileCache" },
    ];
  }

  get csvEncodingOptions() {
    return [
      { label: "utf8 (default)", value: "utf8" },
      { label: "utf-16le", value: "utf16le" },
      { label: "latin1", value: "latin1" },
      { label: "ascii", value: "ascii" },
      { label: "base64", value: "base64" },
    ];
  }

  handleEditGlobalSettings() {
    if (!this.selectedWorkspace) {
      return;
    }
    this.editingScriptSettings = {
      ...(this.selectedWorkspace.scriptSettings || {}),
    };
    this.showGlobalSettingsModal = true;
  }

  handleCancelGlobalSettings() {
    this.showGlobalSettingsModal = false;
    this.editingScriptSettings = {};
  }

  handleScriptSettingChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail?.value ?? event.target.value;
    this.editingScriptSettings = {
      ...this.editingScriptSettings,
      [field]: value,
    };
  }

  handleScriptSettingToggle(event) {
    const field =
      event?.currentTarget?.dataset?.field || event?.target?.dataset?.field;
    if (!field) {
      return;
    }
    const rawValue =
      event.detail?.checked ?? event.target?.checked ?? event.detail?.value;
    const value = coerceBoolean(rawValue);
    this.editingScriptSettings = {
      ...this.editingScriptSettings,
      [field]: value,
    };
  }

  handleScriptSettingNumberChange(event) {
    const field = event.currentTarget.dataset.field;
    const raw = event.detail?.value ?? event.target.value;
    if (raw === "" || raw === null || raw === undefined) {
      const updated = { ...this.editingScriptSettings };
      delete updated[field];
      this.editingScriptSettings = updated;
    } else {
      const num = Number(raw);
      this.editingScriptSettings = {
        ...this.editingScriptSettings,
        [field]: Number.isNaN(num) ? undefined : num,
      };
    }
  }

  handleSaveGlobalSettings() {
    if (!this.selectedWorkspace) {
      return;
    }
    this.isLoading = true;
    // Clean up scriptSettings: remove empty/undefined values
    const cleaned = {};
    for (const [key, value] of Object.entries(this.editingScriptSettings)) {
      if (value !== undefined && value !== null && value !== "") {
        cleaned[key] = value;
      }
    }
    const data = {
      name: this.selectedWorkspace.name,
      label: this.selectedWorkspace.label,
      description: this.selectedWorkspace.description,
      objects: this.selectedWorkspace.objects || [],
      scriptSettings: cleaned,
      originalPath: this.selectedWorkspace.path,
    };
    window.sendMessageToVSCode({
      type: "updateWorkspace",
      data: JSON.parse(JSON.stringify(data)),
    });
    this.showGlobalSettingsModal = false;
  }

  // --- Object editor: excludedFields handling ---

  get editingObjectExcludedFieldsString() {
    if (!this.editingObject) {
      return "";
    }
    const val = this.editingObject.excludedFields;
    if (Array.isArray(val)) {
      return val.join(", ");
    }
    return typeof val === "string" ? val : "";
  }

  get editingObjectExcludedFromUpdateFieldsString() {
    if (!this.editingObject) {
      return "";
    }
    const val = this.editingObject.excludedFromUpdateFields;
    if (Array.isArray(val)) {
      return val.join(", ");
    }
    return typeof val === "string" ? val : "";
  }

  handleObjArrayFieldChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail?.value ?? event.target.value;
    this.editingObject = { ...this.editingObject, [field]: value };
  }
}
