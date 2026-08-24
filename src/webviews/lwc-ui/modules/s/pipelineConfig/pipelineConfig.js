import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import {
  getActionTypeLabel,
  getActionTypeIconName,
  getActionContextLabel,
  getActionTypePillClass,
  getActionContextPillClass,
} from "s/deploymentActionUtils";

// Config keys that hold git branch names: rendered as monospace branch chips
// instead of plain chips in the read-only view.
const BRANCH_NAME_ARRAY_KEYS = new Set([
  "mergeTargets",
  "availableTargetBranches",
]);
// Text values starting with http(s) are rendered as a truncated clickable link.
const URL_VALUE_REGEX = /^https?:\/\//i;
// A section made only of these keys gets the compact "Salesforce Org" card
// layout in read-only mode instead of a list of field rows.
const SALESFORCE_ORG_KEYS = ["instanceUrl", "targetUsername"];

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
export default class PipelineConfig extends SharedMixin(LightningElement) {
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
  // Deployment actions are edited with the same modal as the DevOps Pipeline panel,
  // instead of the generic form built from the schema, so that both places offer
  // the action types, their parameters and the target orgs restriction
  @track showDeploymentActionModal = false;
  @track currentDeploymentAction = null;
  // The modal opens read-only when the settings panel itself is in view mode
  @track deploymentActionModalEditMode = false;
  @track projectApexScripts = [];
  @track projectSfdmuWorkspaces = [];
  @track projectSchedulableClasses = [];
  @track schedulableClassesLoading = false;
  @track projectCommunities = [];
  @track communitiesLoading = false;
  _deploymentActionKey = null; // commandsPreDeploy | commandsPostDeploy
  _deploymentActionEditIndex = -1;
  _schedulableClassesRequestId = null;
  _communitiesRequestId = null;
  _apexTestsFieldOriginal = [];
  initData = {};

  // Config keys holding deployment actions, and the "when" each one implies
  get deploymentActionKeys() {
    return {
      commandsPreDeploy: "pre-deploy",
      commandsPostDeploy: "post-deploy",
    };
  }

  get isEditMode() {
    return this.mode === "edit";
  }

  get isViewMode() {
    return this.mode !== "edit";
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
    const options = [{ label: this.t("globalSettings"), value: "global" }];

    // Add branch options
    if (this.availableBranches && Array.isArray(this.availableBranches)) {
      this.availableBranches.forEach((branch) => {
        options.push({
          label: this.t("branchLabel", { branch }),
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
            isNumber = false,
            isObject = false;
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
          } else if (schema.type === "number" || schema.type === "integer") {
            isNumber = true;
          } else if (schema.type === "object") {
            // Nested object properties have no generic form: each one is
            // rendered by its own editor component (ex: anonymization)
            isObject = true;
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
            } else if (isObject) {
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
          const isDeploymentActions =
            isArrayObject && this.deploymentActionKeys[key] !== undefined;
          // The field row always shows a one-line help text; the info bubble
          // is only kept for descriptions that are genuinely long/multi-line,
          // so it can still surface the full text.
          const isMultilineHelp = description.includes("\n");
          const helpFirstLine = description.split(/\r?\n/)[0] || "";
          // Read-only rendering helpers: booleans become a status pill (never
          // a disabled toggle), git-branch arrays get monospace branch chips,
          // http(s) text values become a truncated clickable link.
          const booleanPillClass = value
            ? "hardis-pill hardis-status-success"
            : "hardis-pill hardis-status-unknown";
          const booleanPillLabel = value
            ? this.i18n.enabledLabel
            : this.i18n.disabledLabel;
          const isUrlValue =
            isText &&
            typeof value === "string" &&
            URL_VALUE_REGEX.test(value.trim());
          const isBranchArrayValue = BRANCH_NAME_ARRAY_KEYS.has(key);
          const arrayChipClass = isBranchArrayValue
            ? "hardis-branch-chip"
            : "hardis-chip";
          // Doc links move inline in the field label; array-of-object fields
          // never carried one (they use their own datatable/modal editor).
          // Nested-object editors carry their own doc link inside the component
          const showDocLink = hasDocUrl && !isArrayObject && !isObject;
          // Arrays/objects need the full row width (chips, dual-listbox,
          // datatable) instead of the compact right-aligned control column.
          // Except when empty in view mode: a lone "Not defined" fits the
          // right column like any scalar, keeping one value placement.
          const hasArrayItems =
            Array.isArray(valueDisplay) && valueDisplay.length > 0;
          // Nested-object editors (ex: anonymization) always need the full
          // row width, in view mode as much as in edit mode
          const isWideControl =
            isObject ||
            ((isArrayEnum || isArrayText || isArrayObject) &&
              (this.isEditMode || hasArrayItems));
          const fieldRowClass = isWideControl
            ? "hardis-field-row stacked"
            : "hardis-field-row";
          // Nested objects are edited by a dedicated component, one flag per
          // supported property so the template can pick the right one
          const isAnonymization = isObject && key === "anonymization";
          entries.push({
            key,
            isAnonymization,
            isDeploymentActions,
            isGenericArrayObject: isArrayObject && !isDeploymentActions,
            label,
            description,
            isMultilineHelp,
            helpFirstLine,
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
            isObject,
            options,
            optionsLwc,
            docUrl,
            hasDocUrl,
            showDocLink,
            booleanPillClass,
            booleanPillLabel,
            isUrlValue,
            isBranchArrayValue,
            arrayChipClass,
            isWideControl,
            fieldRowClass,
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
        // A branch section made only of the Salesforce Org fields (Instance
        // URL + Target Username) gets a single summary card in read-only
        // mode instead of two sparse field rows.
        const isSalesforceOrgSection =
          entries.length > 0 &&
          entries.every((entry) => SALESFORCE_ORG_KEYS.includes(entry.key));
        let salesforceOrgInstanceLabel = "";
        let salesforceOrgInstanceDisplay = "";
        let salesforceOrgUsernameLabel = "";
        let salesforceOrgUsernameDisplay = "";
        if (isSalesforceOrgSection) {
          const instanceEntry = entries.find((e) => e.key === "instanceUrl");
          const usernameEntry = entries.find((e) => e.key === "targetUsername");
          salesforceOrgInstanceLabel = instanceEntry ? instanceEntry.label : "";
          salesforceOrgInstanceDisplay =
            instanceEntry && instanceEntry.hasValue
              ? instanceEntry.value
              : this.i18n.notDefined;
          salesforceOrgUsernameLabel = usernameEntry ? usernameEntry.label : "";
          salesforceOrgUsernameDisplay =
            usernameEntry && usernameEntry.hasValue
              ? usernameEntry.value
              : this.i18n.notDefined;
        }
        return {
          label: section.label,
          iconName: section.iconName || "utility:settings",
          description: section.description,
          entries,
          isSalesforceOrgSectionReadOnly:
            isSalesforceOrgSection && !this.isEditMode,
          salesforceOrgInstanceLabel,
          salesforceOrgInstanceDisplay,
          salesforceOrgUsernameLabel,
          salesforceOrgUsernameDisplay,
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
      this.projectApexScripts = Array.isArray(this.initData.projectApexScripts)
        ? this.initData.projectApexScripts
        : [];
      this.projectSfdmuWorkspaces = Array.isArray(
        this.initData.projectSfdmuWorkspaces,
      )
        ? this.initData.projectSfdmuWorkspaces
        : [];

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
    } else if (schema.type === "number" || schema.type === "integer") {
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

  /**
   * Nested-object property edited by its own component (ex: anonymization).
   * The component emits the whole object, or null when the user reset it to
   * the sfdx-hardis defaults: storing the null is what makes the save remove
   * the property from the YAML instead of writing an empty block.
   */
  handleObjectEditorChange(event) {
    const key = event.target.dataset.key;
    if (!key) {
      return;
    }
    const value = event.detail?.value ?? null;
    // Guard against a `change` bubbling out of a control nested in the editor
    // (lightning-combobox and lightning-input dispatch composed events): only
    // the whole object, or null, may replace the config value
    if (value !== null && typeof value !== "object") {
      return;
    }
    this.editedConfig = {
      ...this.editedConfig,
      [key]: value,
    };
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
  // --- Deployment actions: edited with the s-deployment-action modal ----------

  _openDeploymentActionModal(key, index) {
    const currentArray = this.editedConfig[key] || this.config[key] || [];
    const action =
      index >= 0
        ? JSON.parse(JSON.stringify(currentArray[index] || {}))
        : { id: "", label: "", type: null, command: "", parameters: {} };
    // Match the sfdx-hardis CLI default so the toggle always shows what will
    // actually happen instead of appearing off for an action that has no
    // explicit value yet (ex: a newly created action, or one written by hand)
    action.runOnlyOnceByOrg = action.runOnlyOnceByOrg ?? true;
    // The array an action is stored in is what defines when it runs
    action.when = this.deploymentActionKeys[key];
    this._deploymentActionKey = key;
    this._deploymentActionEditIndex = index;
    this.currentDeploymentAction = action;
    this.deploymentActionModalEditMode = this.isEditMode;
    this.showDeploymentActionModal = true;
  }

  handleCloseDeploymentActionModal() {
    this.showDeploymentActionModal = false;
    this.currentDeploymentAction = null;
    this._deploymentActionKey = null;
    this._deploymentActionEditIndex = -1;
  }

  handleSaveDeploymentActionItem(event) {
    const action = JSON.parse(JSON.stringify(event.detail.action));
    const sourceKey = this._deploymentActionKey;
    const editIndex = this._deploymentActionEditIndex;
    if (!sourceKey) {
      return;
    }
    // The modal was opened read-only from the view mode, and its Edit button
    // was used: switch the whole panel to edit mode so the change is kept and
    // the Save / Cancel header buttons appear
    if (!this.isEditMode) {
      this.handleEdit();
    }
    // "when" can be changed in the modal, and it is also forced by some action
    // types (ex: schedule-batch is always post-deploy): the action then belongs
    // to the other config key, so move it instead of storing an inconsistent one
    const targetKey =
      Object.keys(this.deploymentActionKeys).find(
        (key) => this.deploymentActionKeys[key] === action.when,
      ) || sourceKey;
    // "when" is implied by the array itself and is not stored in the config file
    delete action.when;
    delete action.pullRequest;

    const sourceArray = [
      ...(this.editedConfig[sourceKey] || this.config[sourceKey] || []),
    ];
    if (targetKey === sourceKey) {
      if (editIndex >= 0) {
        sourceArray[editIndex] = action;
      } else {
        sourceArray.push(action);
      }
      this._applyDeploymentActions({ [sourceKey]: sourceArray });
    } else {
      if (editIndex >= 0) {
        sourceArray.splice(editIndex, 1);
      }
      const targetArray = [
        ...(this.editedConfig[targetKey] || this.config[targetKey] || []),
      ];
      targetArray.push(action);
      this._applyDeploymentActions({
        [sourceKey]: sourceArray,
        [targetKey]: targetArray,
      });
    }
    this.handleCloseDeploymentActionModal();
  }

  _applyDeploymentActions(arraysByKey) {
    for (const [key, array] of Object.entries(arraysByKey)) {
      this.editedConfig[key] = array;
    }
    this.editedConfig = { ...this.editedConfig };
    // Force refresh of config to update the datatable display
    this.config = { ...this.config, ...arraysByKey };
  }

  handleLoadSchedulableClasses() {
    this.schedulableClassesLoading = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._schedulableClassesRequestId = requestId;
    window.sendMessageToVSCode({
      type: "loadSchedulableClasses",
      data: { requestId },
    });
  }

  handleReturnSchedulableClasses(data) {
    if (
      this._schedulableClassesRequestId &&
      data?.requestId &&
      data.requestId !== this._schedulableClassesRequestId
    ) {
      return;
    }
    this.projectSchedulableClasses = Array.isArray(data?.values)
      ? data.values
      : [];
    this.schedulableClassesLoading = false;
  }

  handleLoadCommunities() {
    this.communitiesLoading = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._communitiesRequestId = requestId;
    window.sendMessageToVSCode({
      type: "loadCommunities",
      data: { requestId },
    });
  }

  handleReturnCommunities(data) {
    if (
      this._communitiesRequestId &&
      data?.requestId &&
      data.requestId !== this._communitiesRequestId
    ) {
      return;
    }
    this.projectCommunities = Array.isArray(data?.values) ? data.values : [];
    this.communitiesLoading = false;
  }

  handleAddArrayObjectItem(event) {
    const key = event.target.dataset.key;
    if (this.deploymentActionKeys[key] !== undefined) {
      this._openDeploymentActionModal(key, -1);
      return;
    }
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
    if (this.deploymentActionKeys[key] !== undefined) {
      this._openDeploymentActionModal(key, index);
      return;
    }
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
      case "view_action":
        // Click on the action label: open the full-detail modal (read-only in
        // view mode, editable in edit mode)
        if (this.deploymentActionKeys[key] !== undefined) {
          this._openDeploymentActionModal(key, index);
        }
        break;
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
        if (this.deploymentActionKeys[key] !== undefined) {
          this._openDeploymentActionModal(key, index);
          break;
        }
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

  // Compact columns for the pre/post deployment actions tables: the label
  // opens the full-detail modal, so the other action properties do not need
  // their own column (same pattern as the DevOps Pipeline panel actions tab)
  getDeploymentActionsDatatableColumns() {
    return [
      {
        label: this.t("actionLabelField"),
        fieldName: "_displayLabel",
        type: "button",
        typeAttributes: {
          label: { fieldName: "_displayLabel" },
          name: "view_action",
          variant: "base",
        },
        wrapText: true,
      },
      // Type and execution context as colored pills, exactly like the
      // deployment actions tab of the DevOps Pipeline panel
      {
        label: this.t("typeLabel"),
        fieldName: "_typeLabel",
        type: "typePill",
        typeAttributes: {
          label: { fieldName: "_typeLabel" },
          pillClass: { fieldName: "_typePillClass" },
          iconName: { fieldName: "_typeIconName" },
          tooltip: { fieldName: "_typeLabel" },
        },
        wrapText: false,
        initialWidth: 190,
      },
      {
        label: this.t("executionContextsLabel"),
        fieldName: "_contextLabel",
        type: "typePill",
        typeAttributes: {
          label: { fieldName: "_contextLabel" },
          pillClass: { fieldName: "_contextPillClass" },
          tooltip: { fieldName: "_contextLabel" },
        },
        wrapText: false,
        initialWidth: 230,
      },
    ];
  }

  // Helper to get datatable columns for array of objects
  getArrayObjectDatatableColumns(entry) {
    if (!entry || !entry.schemaItems || !entry.schemaItems.properties)
      return [];
    const isDeploymentActions =
      this.deploymentActionKeys[entry.key] !== undefined;
    const properties = entry.schemaItems.properties || {};
    const columns = [];

    if (isDeploymentActions) {
      columns.push(...this.getDeploymentActionsDatatableColumns());
    } else {
      // Add columns for each property - let lightning-datatable handle auto-sizing
      Object.keys(properties).forEach((fieldKey) => {
        const fieldSchema = properties[fieldKey];
        let columnType = "text";

        // Determine column type based on schema
        if (fieldSchema.type === "boolean") {
          columnType = "boolean";
        } else if (
          fieldSchema.type === "number" ||
          fieldSchema.type === "integer"
        ) {
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
    }

    // Add actions column only in edit mode
    if (entry.isEditMode) {
      columns.push({
        type: "action",
        typeAttributes: {
          rowActions: [
            {
              label: this.t("moveUp"),
              name: "move_up",
              iconName: "utility:chevronup",
            },
            {
              label: this.t("moveDown"),
              name: "move_down",
              iconName: "utility:chevrondown",
            },
            { label: this.t("edit"), name: "edit", iconName: "utility:edit" },
            {
              label: this.t("deleteLabel"),
              name: "delete",
              iconName: "utility:delete",
            },
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
    const isDeploymentActions =
      this.deploymentActionKeys[entry.key] !== undefined;
    const translate = (labelKey) => this.t(labelKey);
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

      // Computed display fields for the compact deployment actions columns
      if (isDeploymentActions) {
        const typeCode = obj.type || "command";
        rowData._displayLabel =
          obj.label || obj.command || obj.id || this.t("unnamedAction");
        const contextCode = obj.context || "all";
        rowData._typeLabel = getActionTypeLabel(typeCode, translate);
        rowData._typeIconName = getActionTypeIconName(typeCode);
        rowData._typePillClass = getActionTypePillClass(typeCode);
        rowData._contextLabel = getActionContextLabel(contextCode, translate);
        rowData._contextPillClass = getActionContextPillClass(contextCode);
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

    // Properties written by sfdx-hardis itself, that users must not set by hand
    const cliManagedProps = ["when"];

    Object.keys(properties).forEach((propKey) => {
      const propSchema = properties[propKey];
      // Skip deprecated properties (ex: skipIfError, now ignored by sfdx-hardis)
      // and properties maintained by the CLI
      if (propSchema.deprecated === true || cliManagedProps.includes(propKey)) {
        return;
      }
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
    } else if (type === "returnSchedulableClasses") {
      this.handleReturnSchedulableClasses(data);
    } else if (type === "returnCommunities") {
      this.handleReturnCommunities(data);
    }
  }
}
