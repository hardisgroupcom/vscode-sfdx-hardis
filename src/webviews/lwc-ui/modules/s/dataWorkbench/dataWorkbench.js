import { LightningElement, api, track } from "lwc";
import { ColorThemeMixin } from "s/colorThemeMixin";

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

export default class DataWorkbench extends ColorThemeMixin(LightningElement) {
  workspaces = [];
  selectedWorkspace = null;
  isLoading = false;
  showCreateWorkspace = false;
  editingWorkspace = null;
  pendingSelectedWorkspacePath = null;
  showLargeActions = true;
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

  @track soqlErrors = [];

  @track newWorkspace = {
    name: "",
    label: "",
    description: "",
    objects: [
      {
        query: "SELECT Id, Name FROM Account",
        operation: "Upsert",
        externalId: "",
        deleteOldData: false,
        useQueryAll: false,
        allOrNone: true,
        batchSize: null,
        objectName: "Account",
      },
    ],
  };

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
      case "workspaceCreated":
        if (data && data.path) {
          this.pendingSelectedWorkspacePath = data.path;
        }
        this.loadWorkspaces();
        this.showCreateWorkspace = false;
        this.editingWorkspace = null;
        this.soqlErrors = [];
        this.isLoading = false;
        break;
      case "workspaceUpdated":
        const selectedPath = this.selectedWorkspace?.path;
        this.loadWorkspaces();
        this.showCreateWorkspace = false;
        this.editingWorkspace = null;
        if (selectedPath) {
          this.pendingSelectedWorkspacePath = selectedPath;
        }
        this.soqlErrors = [];
        this.isLoading = false;
        break;
      case "workspaceCreateFailed":
      case "workspaceUpdateFailed":
        if (data && Array.isArray(data.soqlErrors)) {
          this.soqlErrors = data.soqlErrors;
        }
        this.isLoading = false;
        break;
      case "workspaceDeleted":
        this.loadWorkspaces();
        this.showCreateWorkspace = false;
        this.editingWorkspace = null;
        this.selectedWorkspace = null;
        this.isLoading = false;
        break;
      default:
        break;
    }
  }

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the mixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
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

    if (this.pendingSelectedWorkspacePath) {
      const updatedWorkspace = this.workspaces.find(
        (w) => w.path === this.pendingSelectedWorkspacePath,
      );
      if (updatedWorkspace) {
        this.selectedWorkspace = updatedWorkspace;
      }
      this.pendingSelectedWorkspacePath = null;
    }
  }

  normalizeWorkspaces(workspacesInput) {
    return (workspacesInput || []).map((ws) => ({
      ...ws,
      exportedFiles: Array.isArray(ws.exportedFiles) ? ws.exportedFiles : [],
      objects: (ws.objects || []).map((obj) => ({
        ...obj,
        objectName: obj.objectName || inferObjectNameFromQuery(obj.query),
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

  get isCreateMode() {
    return this.showCreateWorkspace && !this.editingWorkspace;
  }

  get isEditMode() {
    return this.showCreateWorkspace && !!this.editingWorkspace;
  }

  get modalTitle() {
    return this.isEditMode
      ? "Edit Data Import/Export Workspace"
      : "Create New Data Import/Export Workspace";
  }

  get canSaveWorkspace() {
    const hasName =
      this.newWorkspace.name && this.newWorkspace.name.trim().length > 0;
    const hasLabel =
      this.newWorkspace.label && this.newWorkspace.label.trim().length > 0;
    const hasObjects =
      this.newWorkspace.objects &&
      this.newWorkspace.objects.length > 0 &&
      this.newWorkspace.objects.every(
        (obj) => obj.query && obj.query.trim().length > 0,
      );

    return hasName && hasLabel && hasObjects && !this.hasSoqlErrors;
  }
  // jscpd:ignore-end

  get saveButtonDisabled() {
    return !this.canSaveWorkspace;
  }

  get saveButtonLabel() {
    return this.isEditMode ? "Update Workspace" : "Create Workspace";
  }

  get operationOptions() {
    return [
      { label: "Upsert", value: "Upsert" },
      { label: "Insert", value: "Insert" },
      { label: "Update", value: "Update" },
      { label: "Delete", value: "Delete" },
      { label: "Export (read-only)", value: "Export" },
    ];
  }

  get objectsWithDisplayIndex() {
    return (this.newWorkspace.objects || []).map((obj, idx) => ({
      ...obj,
      displayIndex: idx + 1,
      soqlError: (this.soqlErrors || [])[idx] || "",
      soqlHasError: !!((this.soqlErrors || [])[idx] || ""),
      soqlFormElementClass: !!((this.soqlErrors || [])[idx] || "")
        ? "slds-form-element slds-has-error slds-m-bottom_medium"
        : "slds-form-element slds-m-bottom_medium",
    }));
  }

  get hasSoqlErrors() {
    return (this.newWorkspace.objects || []).some(
      (_obj, idx) => !!(this.soqlErrors || [])[idx],
    );
  }

  get hasMultipleObjects() {
    return (this.newWorkspace.objects || []).length > 1;
  }

  get hasExportedFiles() {
    const files = this.selectedWorkspace?.exportedFiles || [];
    return files.length > 0;
  }

  get exportedFilesForDisplay() {
    return (this.selectedWorkspace?.exportedFiles || []).map((file) => ({
      ...file,
      sizeLabel: formatBytes(file.size),
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

  handleCreateWorkspace() {
    this.showCreateWorkspace = true;
    this.editingWorkspace = null;
    this.resetNewWorkspace();
  }

  handleEditWorkspace(event) {
    let workspacePath;

    if (event.detail && event.detail.value === "edit") {
      workspacePath = this.selectedWorkspace?.path;
    } else {
      workspacePath =
        event.currentTarget?.dataset?.path || this.selectedWorkspace?.path;
    }

    const workspace = this.workspaces.find((w) => w.path === workspacePath);

    if (workspace) {
      this.editingWorkspace = workspace;
      this.newWorkspace = {
        name: workspace.name,
        label: workspace.label,
        description: workspace.description,
        objects:
          (workspace.objects || []).map((obj) => ({
            ...obj,
            query: obj.query || "",
            operation: obj.operation || "Upsert",
            externalId: obj.externalId || "",
            deleteOldData: obj.deleteOldData === true,
            useQueryAll: obj.useQueryAll === true,
            allOrNone: obj.allOrNone ?? true,
            batchSize: this.normalizeBatchSizeValue(obj.batchSize),
            objectName: inferObjectNameFromQuery(obj.query),
          })) || [],
      };
      this.showCreateWorkspace = true;
      this.soqlErrors = new Array(
        (this.newWorkspace.objects || []).length,
      ).fill("");
    }

    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
  }

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
        type: "openFolder",
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

  handleCancel() {
    this.showCreateWorkspace = false;
    this.editingWorkspace = null;
    this.resetNewWorkspace();
  }

  handleSave() {
    this.isLoading = true;
    const action = this.isEditMode ? "updateWorkspace" : "createWorkspace";
    const data = {
      ...this.newWorkspace,
      originalPath: this.editingWorkspace?.path,
    };

    // LWC tracked objects are reactive proxies and can't be structured-cloned
    // by the webview MessagePort. Convert to a plain JSON object before sending.
    const safeData = JSON.parse(JSON.stringify(data));

    window.sendMessageToVSCode({
      type: action,
      data: safeData,
    });
  }

  handleNameChange(event) {
    this.newWorkspace.name = event.detail?.value ?? event.target.value;
  }

  handleLabelChange(event) {
    this.newWorkspace.label = event.detail?.value ?? event.target.value;
  }

  handleDescriptionChange(event) {
    this.newWorkspace.description = event.detail?.value ?? event.target.value;
  }

  handleObjectFieldChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const value =
      event.detail?.value ??
      (event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value);
    const objects = [...this.newWorkspace.objects];
    if (!objects[index]) {
      return;
    }
    objects[index] = { ...objects[index], [field]: value };
    if (field === "query") {
      objects[index].objectName = inferObjectNameFromQuery(value);
      const nextErrors = [...(this.soqlErrors || [])];
      nextErrors[index] = "";
      this.soqlErrors = nextErrors;
    }
    this.newWorkspace.objects = objects;
  }

  handleObjectToggleChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const value = event.detail?.checked ?? event.target.checked;
    const objects = [...this.newWorkspace.objects];
    if (!objects[index]) {
      return;
    }
    objects[index] = { ...objects[index], [field]: value };
    this.newWorkspace.objects = objects;
  }
  // jscpd:ignore-end

  handleBatchSizeChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const valueRaw = event.detail?.value ?? event.target.value;
    const valueNum = this.normalizeBatchSizeValue(valueRaw);
    const objects = [...this.newWorkspace.objects];
    if (!objects[index]) {
      return;
    }
    objects[index] = { ...objects[index], batchSize: valueNum };
    this.newWorkspace.objects = objects;
  }

  addObjectConfig() {
    const objects = [...(this.newWorkspace.objects || [])];
    objects.push({
      query: "SELECT Id FROM Account",
      operation: "Upsert",
      externalId: "",
      deleteOldData: false,
      useQueryAll: false,
      allOrNone: true,
      batchSize: "",
      objectName: "Account",
    });
    this.newWorkspace.objects = objects;
    this.soqlErrors = [...(this.soqlErrors || []), ""];
  }

  removeObjectConfig(event) {
    const index = Number(event.currentTarget.dataset.index);
    if ((this.newWorkspace.objects || []).length <= 1) {
      return;
    }
    const objects = [...this.newWorkspace.objects];
    objects.splice(index, 1);
    this.newWorkspace.objects = objects;
    const nextErrors = [...(this.soqlErrors || [])];
    nextErrors.splice(index, 1);
    this.soqlErrors = nextErrors;
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

  handleOpenExportedFile(event) {
    const filePath = event?.currentTarget?.dataset?.path;
    if (!filePath) {
      return;
    }
    window.sendMessageToVSCode({
      type: "openFile",
      data: { filePath },
    });
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

  // jscpd:ignore-end

  resetNewWorkspace() {
    this.newWorkspace = {
      name: "",
      label: "",
      description: "",
      objects: [
        {
          query: "SELECT Id, Name FROM Account",
          operation: "Upsert",
          externalId: "",
          deleteOldData: false,
          useQueryAll: false,
          allOrNone: true,
          batchSize: "",
          objectName: "Account",
        },
      ],
    };

    this.soqlErrors = [""];
  }

  normalizeBatchSizeValue(value) {
    if (value === "" || value === null || value === undefined) {
      return "";
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? "" : numeric;
  }
}
