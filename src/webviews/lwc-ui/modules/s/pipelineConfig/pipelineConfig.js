import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

/**
 * LWC to display and edit .sfdx-hardis.yml configuration (global or branch-scoped)
 * Props:
 *   config: the loaded config object (merged if branch + global)
 *   branchConfig: the branch config object (if any)
 *   globalConfig: the global config object (if any)
 *   isBranch: true if branch config is loaded
 *   branchName: name of the branch (if any)
 *   mode: 'view' | 'edit'
 */
export default class PipelineConfig extends LightningElement {
  @api config = {};
  @api branchConfig = null;
  @api globalConfig = null;
  @api isBranch = false;
  @api branchName = "";
  @track mode = "view";
  @track editedConfig = {};
  @track sections = [];
  initData = {};

  get isEditMode() {
    return this.mode === "edit";
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
    return (this.sections || [])
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
          // Always initialize valueEdit for edit mode for enums, array enums, array text, number
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
            isText,
            isBoolean,
            isNumber,
            options,
            optionsLwc,
            docUrl,
            hasDocUrl,
            hasArrayEnumValues:
              isArrayEnum &&
              Array.isArray(valueDisplay) &&
              valueDisplay.length > 0,
            hasArrayTextValues:
              isArrayText &&
              Array.isArray(valueDisplay) &&
              valueDisplay.length > 0,
            hasValue,
          });
        }
        return {
          label: section.label,
          description: section.description,
          entries,
        };
      })
      .filter((section) => section.entries.length > 0);
  }

  handleEdit() {
    this.mode = "edit";
    this.editedConfig = JSON.parse(JSON.stringify(this.config));
  }

  handleCancel() {
    this.mode = "view";
    this.editedConfig = {};
    this.handleRefresh();
  }

  handleOpenDocUrl(event) {
    const url = event.target.dataset.docUrl;
    if (url && typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({ type: "openExternal", data: url });
    } else if (url) {
      window.open(url, "_blank");
    }
  }

  @api
  initialize(data) {
    if (data && data.config && data.configSchema) {
      this.initData = Object.assign({}, data);
      this.config = this.initData.config;
      this.configSchema = this.initData.configSchema;
      this.branchConfig = this.initData.branchConfig || null;
      this.globalConfig = this.initData.globalConfig || null;
      this.isBranch =
        typeof this.initData.isBranch === "boolean"
          ? this.initData.isBranch
          : false;
      this.branchName = this.initData.branchName || "";
      this.sections = this.initData.sections || [];
    }
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
      // Checkbox: checked property
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
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
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
  }

  handleRefresh() {
    this.initData.config = Object.assign({}, this.config);
    this.initialize(this.initData);
  }
}
