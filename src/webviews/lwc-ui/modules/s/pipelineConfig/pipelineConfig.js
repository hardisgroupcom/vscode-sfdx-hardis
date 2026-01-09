import { LightningElement, api, track } from "lwc";

/**
 * LWC to display and edit .sfdx-hardis.yml configuration (global or branch-scoped)
 * Props:
 *   config: the loaded config object (merged if branch + global)
 *   branchConfig: the branch config object (if any)
 *   globalConfig: the global config object (if any)
 *   isBranch: true if branch config is loaded
 *   branchName: name of the branch (if any)
 *   mode: 'view' | 'edit'
 *   availableBranches: array of available branch names for selection
 */
export default class PipelineConfig extends LightningElement {
  @api config = {};
  @api branchConfig = null;
  @api globalConfig = null;
  @api isBranch = false;
  @api branchName = "";
  @api availableBranches = [];
  @api availableApexTestClasses = [];
  @track mode = "view";
  @track editedConfig = {};
  @track sections = [];
  @track selectedConfigScope = "global";
  @track arrayObjectEditorState = {}; // { key: { showForm: bool, editIndex: number, formData: {} } }
  @track activeTabValue;
  @track initialActiveTableValue;
  @track apexTestsFieldMode = "view"; // 'view' | 'edit' (field-level toggle)
  _apexTestsFieldOriginal = [];
  initData = {};

  get isEditMode() {
    return this.mode === "edit";
  }

  get isApexTestsFieldEditMode() {
    return this.apexTestsFieldMode === "edit";
  }

  get isApexTestsFieldViewMode() {
    return this.apexTestsFieldMode === "view";
  }

  resetApexTestsFieldToggle() {
    this.apexTestsFieldMode = "view";
    this._apexTestsFieldOriginal = [];
  }

  get configScopeOptions() {
    const options = [{ label: "Global Settings", value: "global" }];

    // Add branch options
    if (this.availableBranches && Array.isArray(this.availableBranches)) {
      this.availableBranches.forEach((branch) => {
        options.push({
          label: `Branch: ${branch}`,
          value: `branch:${branch}`,
        });
      });
    }

    return options;
  }

  @track configSchema = {};
  get configSections() {
    // Returns array of { label, description, entries: [...] } for each section, omitting empty ones
    if (!this.config || !this.sections) return [];
    const config = this.config;
    const branchConfig = this.branchConfig;
    const globalConfig = this.globalConfig;
    const isBranch = this.isBranch;
    // configSchema is an object: { [key]: schema }
    const configSchema = this.configSchema || {};
    /* jscpd:ignore-start */
    const allConfigSections = (this.sections || [])
      .map((section) => {
        const entries = [];
        for (const key of section.keys) {
          const schema = configSchema[key];
          if (!schema) continue;
          let inherited = false;
          let branchValue = undefined;
          let globalValue = undefined;
          if (isBranch && branchConfig && globalConfig) {
            branchValue = branchConfig[key];
            globalValue = globalConfig[key];
            inherited = branchValue === undefined && globalValue !== undefined;
          }
          let isEnum = false,
            isArrayEnum = false,
            isArrayText = false,
            isArrayObject = false,
            isText = false,
            isBoolean = false,
            isNumber = false;
          let options = [];
          let label = schema.title || key;
          let description = schema.description || "";
          const docUrl = schema.docUrl || null;
          const hasDocUrl = docUrl !== null;
          let optionsLwc = [];
          // Detect type
          let enumNames = null;
          if (schema.enum) {
            isEnum = true;
            options = schema.enum;
            enumNames = Array.isArray(schema.enumNames)
              ? schema.enumNames
              : null;
            optionsLwc = schema.enum.map((opt, idx) => ({
              label:
                enumNames && enumNames[idx]
                  ? String(enumNames[idx])
                  : String(opt),
              value: String(opt),
            }));
          } else if (
            schema.type === "array" &&
            schema.items &&
            schema.items.enum
          ) {
            isArrayEnum = true;
            options = schema.items.enum;
            enumNames = Array.isArray(schema.items.enumNames)
              ? schema.items.enumNames
              : null;
            optionsLwc = schema.items.enum.map((opt, idx) => ({
              label:
                enumNames && enumNames[idx]
                  ? String(enumNames[idx])
                  : String(opt),
              value: String(opt),
            }));
          } else if (
            schema.type === "array" &&
            schema.items &&
            schema.items.type === "string"
          ) {
            isArrayText = true;
          } else if (
            schema.type === "array" &&
            schema.items &&
            schema.items.type === "object"
          ) {
            isArrayObject = true;
          } else if (schema.type === "string") {
            isText = true;
          } else if (schema.type === "boolean") {
            isBoolean = true;
          } else if (schema.type === "number") {
            isNumber = true;
          }
          let valueEdit = this.editedConfig
            ? this.editedConfig[key]
            : undefined;
          const value = config[key];
          // Always initialize valueEdit for edit mode for enums, array enums, array text, array object, number
          if (this.isEditMode) {
            if (isEnum) {
              if (valueEdit === undefined)
                valueEdit = value !== undefined ? value : "";
            } else if (isArrayEnum) {
              if (!Array.isArray(valueEdit))
                valueEdit = Array.isArray(value) ? value : [];
            } else if (isArrayText) {
              if (!Array.isArray(valueEdit))
                valueEdit = Array.isArray(value) ? value : [];
            } else if (isArrayObject) {
              if (!Array.isArray(valueEdit))
                valueEdit = Array.isArray(value) ? value : [];
            } else if (isText) {
              if (valueEdit === undefined)
                valueEdit = value !== undefined ? value : "";
            } else if (isBoolean) {
              if (valueEdit === undefined)
                valueEdit = value !== undefined ? value : false;
            } else if (isNumber) {
              if (valueEdit === undefined)
                valueEdit = value !== undefined ? value : null;
            }
          }
          let valueEditText = "";
          let valueDisplay = "";
          if (isArrayEnum) {
            // Map enum values to labels for display
            if (Array.isArray(value)) {
              valueDisplay = enumNames
                ? value.map((v) => {
                    const idx = options.indexOf(v);
                    return idx !== -1 && enumNames[idx] ? enumNames[idx] : v;
                  })
                : value;
            } else if (typeof value === "string") {
              const arr = value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
              valueDisplay = enumNames
                ? arr.map((v) => {
                    const idx = options.indexOf(v);
                    return idx !== -1 && enumNames[idx] ? enumNames[idx] : v;
                  })
                : arr;
            } else {
              valueDisplay = [];
            }
          } else if (isArrayText) {
            if (Array.isArray(value)) {
              valueDisplay = value;
            } else if (typeof value === "string") {
              valueDisplay = value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
            } else {
              valueDisplay = [];
            }
          } else if (isArrayObject) {
            // For array of objects, display as formatted JSON or structured list
            if (Array.isArray(value)) {
              // Convert objects to array of key-value pairs for easier display
              valueDisplay = value.map((obj, idx) => {
                const kvPairs = Object.keys(obj).map((k) => ({
                  key: k,
                  value:
                    typeof obj[k] === "object"
                      ? JSON.stringify(obj[k])
                      : String(obj[k]),
                }));
                return {
                  properties: kvPairs,
                  canMoveUp: idx > 0,
                  canMoveDown: idx < value.length - 1,
                  index: idx,
                };
              });
            } else {
              valueDisplay = [];
            }
          } else if (isEnum) {
            // Map enum value to label for display
            if (enumNames && options && options.length > 0) {
              const idx = options.indexOf(value);
              valueDisplay =
                idx !== -1 && enumNames[idx] ? enumNames[idx] : value;
            } else {
              valueDisplay = value;
            }
          } else {
            valueDisplay = value;
          }
          if ((isArrayText || isArrayEnum) && Array.isArray(valueEdit)) {
            valueEditText = valueEdit.join("\n");
          } else if (isArrayText || isArrayEnum) {
            valueEditText = "";
          } else if (isArrayObject && Array.isArray(valueEdit)) {
            // For array of objects, format as JSON for editing
            valueEditText = JSON.stringify(valueEdit, null, 2);
          } else if (isArrayObject) {
            valueEditText = "[]";
          }
          // Compute hasValue for text and number fields
          let hasValue = false;
          if (isText) {
            hasValue =
              value !== undefined &&
              value !== null &&
              String(value).trim() !== "";
          } else if (isNumber) {
            hasValue = value !== undefined && value !== null && value !== "";
          }

          const isApexTestsSelect =
            key === "deploymentApexTestClasses" && isArrayText === true;
          const hasApexTestsSelected =
            isApexTestsSelect &&
            Array.isArray(valueEdit) &&
            valueEdit.length > 0;
          entries.push({
            key,
            label,
            description,
            value,
            valueDisplay,
            valueEdit,
            valueEditText,
            inherited,
            branchValue,
            globalValue,
            isEnum,
            isArrayEnum,
            isArrayText,
            isApexTestsSelect,
            hasApexTestsSelected,
            isArrayObject,
            isText,
            isBoolean,
            isNumber,
            options,
            optionsLwc,
            docUrl,
            hasDocUrl,
            columnClass: isArrayObject
              ? "slds-col"
              : "slds-col slds-size_9-of-12",
            hasArrayEnumValues:
              isArrayEnum &&
              Array.isArray(valueDisplay) &&
              valueDisplay.length > 0,
            hasArrayTextValues:
              isArrayText &&
              Array.isArray(valueDisplay) &&
              valueDisplay.length > 0,
            hasArrayObjectValues:
              isArrayObject &&
              Array.isArray(valueDisplay) &&
              valueDisplay.length > 0,
            hasValue,
            schemaItems: schema.items || null,
            arrayObjectEditorOpen:
              this.arrayObjectEditorState[key]?.showForm || false,
            arrayObjectEditIndex:
              this.arrayObjectEditorState[key]?.editIndex ?? -1,
            arrayObjectFormData:
              this.arrayObjectEditorState[key]?.formData || {},
            arrayObjectFormFields: this.getArrayObjectFormFields({
              key,
              schemaItems: schema.items,
            }),
            arrayObjectDatatableColumns: isArrayObject
              ? this.getArrayObjectDatatableColumns({
                  key,
                  schemaItems: schema.items,
                  isEditMode: this.isEditMode,
                })
              : [],
            arrayObjectDatatableData: isArrayObject
              ? this.getArrayObjectDatatableData({
                  key,
                  value,
                  schemaItems: schema.items,
                })
              : [],
          });
        }
        return {
          label: section.label,
          description: section.description,
          entries,
        };
      })
      .filter((section) => section.entries.length > 0);
    return allConfigSections;
    /* jscpd:ignore-end */
  }

  @api
  initialize(data) {
    if (data && data.config && data.configSchema) {
      this.initData = Object.assign({}, data);
      this.config = this.initData.config;
      this.configSchema = this.initData.configSchema;
      this.availableApexTestClasses = Array.isArray(
        this.initData.availableApexTestClasses,
      )
        ? this.initData.availableApexTestClasses
        : [];
      this.branchConfig = this.initData.branchConfig || null;
      this.globalConfig = this.initData.globalConfig || null;
      this.isBranch =
        typeof this.initData.isBranch === "boolean"
          ? this.initData.isBranch
          : false;
      this.branchName = this.initData.branchName || "";
      this.sections = this.initData.sections || [];
      this.availableBranches = this.initData.availableBranches || [];

      this.resetApexTestsFieldToggle();

      // Set the selected config scope based on current state
      if (this.isBranch && this.branchName) {
        this.selectedConfigScope = `branch:${this.branchName}`;
      } else {
        this.selectedConfigScope = "global";
      }
    }
    if (data && data.initialSectionSelected) {
      this.initialActiveTableValue = data.initialSectionSelected;
    }
  }

  renderedCallback() {
    // Set active tab if initialActiveTableValue is set
    if (
      this.initialActiveTableValue &&
      this.activeTabValue !== this.initialActiveTableValue
    ) {
      this.activeTabValue = this.initialActiveTableValue;
      this.initialActiveTableValue = null; // Clear after setting
    }
  }

  handleEdit() {
    this.mode = "edit";
    this.editedConfig = JSON.parse(JSON.stringify(this.config));
    this.resetApexTestsFieldToggle();
  }

  handleCancel() {
    this.mode = "view";
    this.editedConfig = {};
    this.resetApexTestsFieldToggle();
    this.handleRefresh();
  }

  handleEditApexTestsField() {
    if (!this.isEditMode) {
      return;
    }
    const key = "deploymentApexTestClasses";
    const current = Array.isArray(this.editedConfig[key])
      ? this.editedConfig[key]
      : [];
    this._apexTestsFieldOriginal = [...current];
    this.apexTestsFieldMode = "edit";
  }

  handleDoneApexTestsField() {
    this.apexTestsFieldMode = "view";
  }

  handleCancelApexTestsField() {
    const key = "deploymentApexTestClasses";
    this.editedConfig[key] = Array.isArray(this._apexTestsFieldOriginal)
      ? [...this._apexTestsFieldOriginal]
      : [];
    this.editedConfig = { ...this.editedConfig };
    this.apexTestsFieldMode = "view";
  }

  handleConfigScopeChange(event) {
    if (this.isEditMode) {
      // Don't allow changing scope while in edit mode
      return;
    }

    const newScope = event.detail.value;
    this.selectedConfigScope = newScope;

    if (newScope === "global") {
      // Request global config
      this.requestConfigData(null);
    } else if (newScope.startsWith("branch:")) {
      // Extract branch name and request branch config
      const branchName = newScope.substring(7); // Remove "branch:" prefix
      this.requestConfigData(branchName);
    }
  }

  requestConfigData(branchName) {
    // Send message to VS Code to reload config for the specified branch
    window.sendMessageToVSCode({
      type: "loadPipelineConfig",
      data: {
        branchName: branchName,
      },
    });
  }

  handleOpenDocUrl(event) {
    const url = event.target.dataset.docUrl;
    window.sendMessageToVSCode({ type: "openExternal", data: url });
  }

  handleInputChange(event) {
    const key = event.target.dataset.key;
    let value = event.target.value;
    // Find schema from configSchema object
    let schema =
      this.configSchema && this.configSchema[key]
        ? this.configSchema[key]
        : { type: "string" };

    // Robustly handle all input types
    if (schema.type === "boolean") {
      // Toggle: checked property
      value = event.target.checked;
      this.editedConfig[key] = value;
    } else if (schema.enum) {
      // Combobox: single value
      value =
        event.detail && event.detail.value !== undefined
          ? event.detail.value
          : value;
      this.editedConfig[key] = value;
    } else if (schema.type === "array" && schema.items && schema.items.enum) {
      // Dual-listbox: array of enums
      value =
        event.detail && Array.isArray(event.detail.value)
          ? event.detail.value
          : [];
      this.editedConfig[key] = value;
    } else if (
      schema.type === "array" &&
      schema.items &&
      schema.items.type === "string"
    ) {
      // Textarea: array of strings, split by line
      if (typeof value === "string") {
        value = value
          .split(/\r?\n/)
          .map((v) => v.trim())
          .filter(Boolean);
      }
      this.editedConfig[key] = value;
    } else if (
      schema.type === "array" &&
      schema.items &&
      schema.items.type === "object"
    ) {
      // Textarea with JSON: array of objects
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
          if (!Array.isArray(value)) {
            value = [];
          }
        } catch (e) {
          console.error("Invalid JSON for array of objects", e);
          value = [];
        }
      }
      this.editedConfig[key] = value;
    } else if (schema.type === "number") {
      // Number input
      if (typeof value === "string") {
        value = value.trim() === "" ? null : Number(value);
      }
      this.editedConfig[key] = value;
    } else if (schema.type === "string") {
      // Text input
      this.editedConfig[key] = value;
    } else {
      // Fallback: assign value
      this.editedConfig[key] = value;
    }
  }

  handleApexTestsSelectChange(event) {
    const key = event.target?.dataset?.key;
    const value = event?.detail?.value;
    if (!key) {
      return;
    }

    const normalized = Array.isArray(value)
      ? value.map((v) => String(v || "").trim()).filter(Boolean)
      : [];
    this.editedConfig[key] = normalized;
    this.editedConfig = { ...this.editedConfig };
  }

  // For template: expose input type checks as properties for each entry
  getInputTypeEnum(entry) {
    const schema = this.configSchema[entry.key] || { type: "text" };
    return schema.type === "enum";
  }

  getInputTypeArrayEnum(entry) {
    const schema = this.configSchema[entry.key] || { type: "text" };
    return schema.type === "array" && schema.itemType === "enum";
  }

  getInputTypeArrayText(entry) {
    const schema = this.configSchema[entry.key] || { type: "text" };
    return schema.type === "array" && schema.itemType === "text";
  }

  getInputTypeText(entry) {
    const schema = this.configSchema[entry.key] || { type: "text" };
    return schema.type === "text";
  }

  handleSave() {
    // Send updated config to VS Code
    window.sendMessageToVSCode({
      type: "saveSfdxHardisConfig",
      data: {
        config: JSON.parse(JSON.stringify(this.editedConfig)),
        isBranch: this.isBranch,
        branchName: this.branchName,
      },
    });
    this.mode = "view";
    this.config = { ...this.editedConfig };
    this.editedConfig = {};
    this.handleRefresh();
  }

  handleRefresh() {
    // Update config in initData and reinitialize
    this.initData.config = Object.assign({}, this.config);
    this.initialize(this.initData);
  }

  // Array Object Form Management
  handleAddArrayObjectItem(event) {
    const key = event.target.dataset.key;
    const schema = this.configSchema[key];
    const formData = {};
    // Initialize form data with defaults from schema
    if (schema && schema.items && schema.items.properties) {
      Object.keys(schema.items.properties).forEach((propKey) => {
        const propSchema = schema.items.properties[propKey];
        if (propSchema.default !== undefined) {
          formData[propKey] = propSchema.default;
        } else if (propSchema.type === "boolean") {
          formData[propKey] = false;
        } else if (propSchema.type === "string") {
          formData[propKey] = "";
        }
      });
    }
    this.arrayObjectEditorState[key] = {
      showForm: true,
      editIndex: -1,
      formData: formData,
    };
    this.arrayObjectEditorState = { ...this.arrayObjectEditorState };
  }

  handleEditArrayObjectItem(event) {
    const key = event.target.dataset.key;
    const index = parseInt(event.target.dataset.index, 10);
    const currentArray = this.editedConfig[key] || this.config[key] || [];
    const itemToEdit = currentArray[index] || {};
    this.arrayObjectEditorState[key] = {
      showForm: true,
      editIndex: index,
      formData: JSON.parse(JSON.stringify(itemToEdit)),
    };
    this.arrayObjectEditorState = { ...this.arrayObjectEditorState };
  }

  handleDeleteArrayObjectItem(event) {
    const key = event.target.dataset.key;
    const index = parseInt(event.target.dataset.index, 10);
    let currentArray = [...(this.editedConfig[key] || this.config[key] || [])];
    currentArray.splice(index, 1);
    this.editedConfig[key] = currentArray;
    this.editedConfig = { ...this.editedConfig };
  }

  handleMoveArrayObjectItemUp(event) {
    const key = event.target.dataset.key;
    const index = parseInt(event.target.dataset.index, 10);
    if (index === 0) return; // Already at top

    let currentArray = [...(this.editedConfig[key] || this.config[key] || [])];
    // Swap with previous item
    const temp = currentArray[index];
    currentArray[index] = currentArray[index - 1];
    currentArray[index - 1] = temp;

    this.editedConfig[key] = currentArray;
    this.editedConfig = { ...this.editedConfig };
  }

  handleMoveArrayObjectItemDown(event) {
    const key = event.target.dataset.key;
    const index = parseInt(event.target.dataset.index, 10);
    let currentArray = [...(this.editedConfig[key] || this.config[key] || [])];

    if (index === currentArray.length - 1) return; // Already at bottom

    // Swap with next item
    const temp = currentArray[index];
    currentArray[index] = currentArray[index + 1];
    currentArray[index + 1] = temp;

    this.editedConfig[key] = currentArray;
    this.editedConfig = { ...this.editedConfig };
  }

  handleArrayObjectRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    const key = event.currentTarget.dataset.key;
    const index = row._index;

    switch (action.name) {
      case "move_up":
        if (row._canMoveUp) {
          let currentArray = [
            ...(this.editedConfig[key] || this.config[key] || []),
          ];
          const temp = currentArray[index];
          currentArray[index] = currentArray[index - 1];
          currentArray[index - 1] = temp;
          this.editedConfig[key] = currentArray;
          this.editedConfig = { ...this.editedConfig };
          // Force refresh of config to update datatable display
          this.config = { ...this.config, [key]: currentArray };
        }
        break;
      case "move_down":
        if (row._canMoveDown) {
          let currentArray = [
            ...(this.editedConfig[key] || this.config[key] || []),
          ];
          const temp = currentArray[index];
          currentArray[index] = currentArray[index + 1];
          currentArray[index + 1] = temp;
          this.editedConfig[key] = currentArray;
          this.editedConfig = { ...this.editedConfig };
          // Force refresh of config to update datatable display
          this.config = { ...this.config, [key]: currentArray };
        }
        break;
      case "edit":
        const currentArrayEdit =
          this.editedConfig[key] || this.config[key] || [];
        const itemToEdit = currentArrayEdit[index] || {};
        this.arrayObjectEditorState[key] = {
          showForm: true,
          editIndex: index,
          formData: JSON.parse(JSON.stringify(itemToEdit)),
        };
        this.arrayObjectEditorState = { ...this.arrayObjectEditorState };
        break;
      case "delete":
        let currentArrayDel = [
          ...(this.editedConfig[key] || this.config[key] || []),
        ];
        currentArrayDel.splice(index, 1);
        this.editedConfig[key] = currentArrayDel;
        this.editedConfig = { ...this.editedConfig };
        // Force refresh of config to update datatable display
        this.config = { ...this.config, [key]: currentArrayDel };
        break;
    }
  }

  handleArrayObjectFormFieldChange(event) {
    const key = event.target.dataset.key;
    const fieldName = event.target.dataset.fieldName;
    const fieldType = event.target.dataset.fieldType;
    let value = event.target.value;

    if (fieldType === "boolean") {
      value = event.target.checked;
    } else if (event.detail && event.detail.value !== undefined) {
      value = event.detail.value;
    }

    if (!this.arrayObjectEditorState[key]) {
      this.arrayObjectEditorState[key] = {
        showForm: true,
        editIndex: -1,
        formData: {},
      };
    }
    this.arrayObjectEditorState[key].formData[fieldName] = value;
    this.arrayObjectEditorState = { ...this.arrayObjectEditorState };
  }

  handleSaveArrayObjectItem(event) {
    const key = event.target.dataset.key;
    const state = this.arrayObjectEditorState[key];
    if (!state) return;

    let currentArray = [...(this.editedConfig[key] || this.config[key] || [])];
    if (state.editIndex >= 0) {
      // Update existing item
      currentArray[state.editIndex] = { ...state.formData };
    } else {
      // Add new item
      currentArray.push({ ...state.formData });
    }
    this.editedConfig[key] = currentArray;
    this.editedConfig = { ...this.editedConfig };

    // Close form
    delete this.arrayObjectEditorState[key];
    this.arrayObjectEditorState = { ...this.arrayObjectEditorState };

    // Force refresh of config to update datatable display
    this.config = { ...this.config, [key]: currentArray };
  }

  handleCancelArrayObjectForm(event) {
    const key = event.target.dataset.key;
    delete this.arrayObjectEditorState[key];
    this.arrayObjectEditorState = { ...this.arrayObjectEditorState };
  }

  // Helper to get datatable columns for array of objects
  getArrayObjectDatatableColumns(entry) {
    if (!entry || !entry.schemaItems || !entry.schemaItems.properties)
      return [];
    const properties = entry.schemaItems.properties || {};
    const columns = [];

    // Add columns for each property - let lightning-datatable handle auto-sizing
    Object.keys(properties).forEach((fieldKey) => {
      const fieldSchema = properties[fieldKey];
      let columnType = "text";

      // Determine column type based on schema
      if (fieldSchema.type === "boolean") {
        columnType = "boolean";
      } else if (fieldSchema.type === "number") {
        columnType = "number";
      } else if (fieldSchema.type === "url") {
        columnType = "url";
      }

      columns.push({
        label: fieldSchema.title || fieldKey,
        fieldName: fieldKey,
        type: columnType,
        wrapText: columnType !== "boolean",
      });
    });

    // Add actions column only in edit mode
    if (entry.isEditMode) {
      columns.push({
        type: "action",
        typeAttributes: {
          rowActions: [
            {
              label: "Move Up",
              name: "move_up",
              iconName: "utility:chevronup",
            },
            {
              label: "Move Down",
              name: "move_down",
              iconName: "utility:chevrondown",
            },
            { label: "Edit", name: "edit", iconName: "utility:edit" },
            { label: "Delete", name: "delete", iconName: "utility:delete" },
          ],
        },
        initialWidth: 120,
      });
    }

    return columns;
  }

  // Helper to get datatable data for array of objects
  getArrayObjectDatatableData(entry) {
    if (!entry || !entry.value || !Array.isArray(entry.value)) return [];
    return entry.value.map((obj, idx) => {
      // Convert object to include proper boolean values and metadata
      const rowData = { ...obj };

      // Ensure boolean values are actual booleans for datatable display
      if (entry.schemaItems && entry.schemaItems.properties) {
        Object.keys(entry.schemaItems.properties).forEach((propKey) => {
          const propSchema = entry.schemaItems.properties[propKey];
          if (propSchema.type === "boolean" && rowData[propKey] !== undefined) {
            rowData[propKey] = Boolean(rowData[propKey]);
          }
        });
      }

      return {
        ...rowData,
        _index: idx,
        _canMoveUp: idx > 0,
        _canMoveDown: idx < entry.value.length - 1,
      };
    });
  }

  // Helper to get form fields for array object items
  getArrayObjectFormFields(entry) {
    if (!entry.schemaItems || !entry.schemaItems.properties) return [];
    const fields = [];
    const properties = entry.schemaItems.properties;
    const required = entry.schemaItems.required || [];

    // Get examples from schema for placeholders
    const schemaExamples = this.configSchema[entry.key]?.examples;
    let exampleItem = null;
    if (
      schemaExamples &&
      Array.isArray(schemaExamples) &&
      schemaExamples.length > 0 &&
      Array.isArray(schemaExamples[0]) &&
      schemaExamples[0].length > 0
    ) {
      exampleItem = schemaExamples[0][0]; // Get first item from first example array
    }

    Object.keys(properties).forEach((propKey) => {
      const propSchema = properties[propKey];
      const formData = this.arrayObjectEditorState[entry.key]?.formData || {};
      const value =
        formData[propKey] !== undefined
          ? formData[propKey]
          : propSchema.default || "";

      // Get example value for placeholder
      const exampleValue =
        exampleItem && exampleItem[propKey] ? String(exampleItem[propKey]) : "";
      const placeholder = exampleValue
        ? `ex: ${exampleValue}`
        : propSchema.description || "";

      fields.push({
        key: propKey,
        label: propSchema.title || propKey,
        description: propSchema.description || "",
        placeholder: placeholder,
        type: propSchema.type,
        required: required.includes(propKey),
        value: value,
        enum: propSchema.enum || null,
        enumNames: propSchema.enumNames || null,
        options: propSchema.enum
          ? propSchema.enum.map((opt, idx) => ({
              label:
                propSchema.enumNames && propSchema.enumNames[idx]
                  ? propSchema.enumNames[idx]
                  : String(opt),
              value: String(opt),
            }))
          : null,
        isEnum: !!propSchema.enum,
        isBoolean: propSchema.type === "boolean",
        isText: propSchema.type === "string" && !propSchema.enum,
      });
    });

    return fields;
  }

  @api
  handleMessage(type, data) {
    if (type === "initialize") {
      this.initialize(data);
    }
  }
}
