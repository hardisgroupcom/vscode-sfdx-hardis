/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

export default class DeploymentAction extends SharedMixin(LightningElement) {
  @api action = null;
  _isEditMode = false;

  @api
  set isEditMode(val) {
    const wasViewMode = !this._isEditMode;
    this._isEditMode = val;
    if (val && wasViewMode) {
      // Switched into edit mode — trigger schedulable class loading if needed
      this._requestSchedulableClassesIfNeeded(this.displayedAction?.type);
      this._requestCommunitiesIfNeeded(this.displayedAction?.type);
    }
  }
  get isEditMode() {
    return this._isEditMode;
  }

  @api apexScripts = [];
  @api sfdmuWorkspaces = [];
  _storedSchedulableClasses = null;
  _storedCommunities = null;

  @api
  set schedulableClasses(val) {
    if (Array.isArray(val) && val.length > 0) {
      this._storedSchedulableClasses = val;
    }
  }
  get schedulableClasses() {
    return this._storedSchedulableClasses || [];
  }

  @api
  set communities(val) {
    if (Array.isArray(val) && val.length > 0) {
      this._storedCommunities = val;
    }
  }
  get communities() {
    return this._storedCommunities || [];
  }

  @api schedulableClassesLoading = false;
  @api communitiesLoading = false;
  @track editedAction = {};
  @track validationError = "";
  _schedulableClassesRequested = false;
  _communitiesRequested = false;

  @api
  set parentTranslations(val) {
    if (val) {
      this._initOptions();
    }
  }
  get parentTranslations() {
    return this.translations;
  }

  _initOptions() {
    this.typeOptions = [
      { label: this.t("commandType"), value: "command" },
      { label: this.t("dataType"), value: "data" },
      { label: this.t("apexType"), value: "apex" },
      { label: this.t("scheduleBatchType"), value: "schedule-batch" },
      { label: this.t("publishCommunityType"), value: "publish-community" },
      { label: this.t("manualType"), value: "manual" },
    ];
    this.whenOptions = this._getWhenOptions();
    this.contextOptions = this._getContextOptions();
  }

  _getWhenOptions() {
    return [
      { label: this.t("beforeDeployment"), value: "pre-deploy" },
      { label: this.t("afterDeployment"), value: "post-deploy" },
    ];
  }

  _getContextOptions() {
    return [
      { label: this.t("checkAndProcessDeployment"), value: "all" },
      { label: this.t("checkDeploymentOnly"), value: "check-deployment-only" },
      {
        label: this.t("processDeploymentOnly"),
        value: "process-deployment-only",
      },
    ];
  }

  // Available action types
  typeOptions = [
    { label: this.t("commandType"), value: "command" },
    { label: this.t("dataType"), value: "data" },
    { label: this.t("apexType"), value: "apex" },
    { label: this.t("scheduleBatchType"), value: "schedule-batch" },
    { label: this.t("publishCommunityType"), value: "publish-community" },
    { label: this.t("manualType"), value: "manual" },
  ];

  // apexScripts already come as {label, value} objects from backend
  /* jscpd:ignore-start */
  get apexScriptOptions() {
    const options = this.apexScripts || [];
    const selectedValue = this.displayedAction?.parameters?.apexScript;

    // If a value is selected but not in the available options, add it with a special label
    if (selectedValue && !options.find((opt) => opt.value === selectedValue)) {
      return [
        {
          label: this.t("notVisibleFromBranch", { value: selectedValue }),
          value: selectedValue,
        },
        ...options,
      ];
    }

    return options;
  }
  /* jscpd:ignore-end */

  // sfdmuWorkspaces already come as {label, value} objects from backend
  get sfdmuWorkspaceOptions() {
    const options = this.sfdmuWorkspaces || [];
    const selectedValue = this.displayedAction?.parameters?.sfdmuProject;

    // If a value is selected but not in the available options, add it with a special label
    if (selectedValue && !options.find((opt) => opt.value === selectedValue)) {
      return [
        {
          label: this.t("notVisibleFromBranch", { value: selectedValue }),
          value: selectedValue,
        },
        ...options,
      ];
    }

    return options;
  }

  get schedulableClassOptions() {
    const selectedClassName = this.displayedAction?.parameters?.className;
    if (this.isViewMode) {
      return selectedClassName ? [{ label: selectedClassName, value: selectedClassName }] : [];
    }
    if (this.schedulableClassesLoading) {
      const loadingOption = { label: this.t("loadingSchedulableClasses"), value: "" };
      return selectedClassName
        ? [{ label: selectedClassName, value: selectedClassName }, loadingOption]
        : [loadingOption];
    }
    const classes = Array.isArray(this.schedulableClasses) ? this.schedulableClasses : [];
    if (this._schedulableClassesRequested && classes.length === 0) {
      return [{ label: this.t("noSchedulableClassFound"), value: "" }];
    }
    // If a value is selected but not in the available options, add it with a special label
    if (selectedClassName && !classes.find((item) => item === selectedClassName)) {
      return [{ label: this.t("notVisibleFromOrg", { value: selectedClassName }), value: selectedClassName }, ...classes.map((item) => ({ label: item, value: item }))];
    }
    return classes.map((item) => ({ label: item, value: item }));
  }

  get communityOptions() {
    const selectedCommunity = this.displayedAction?.parameters?.communityName;
    if (this.isViewMode) {
      return selectedCommunity ? [{ label: selectedCommunity, value: selectedCommunity }] : [];
    }
    if (this.communitiesLoading) {
      const loadingOption = { label: this.t("loadingCommunities"), value: "" };
      return selectedCommunity
        ? [{ label: selectedCommunity, value: selectedCommunity }, loadingOption]
        : [loadingOption];
    }
    const communities = Array.isArray(this.communities) ? this.communities : [];
    if (this._communitiesRequested && communities.length === 0) {
      return [{ label: this.t("noCommunityFound"), value: "" }];
    }
    if (selectedCommunity && !communities.find((item) => item === selectedCommunity)) {
      return [{ label: this.t("notVisibleFromOrg", { value: selectedCommunity }), value: selectedCommunity }, ...communities.map((item) => ({ label: item, value: item }))];
    }
    return communities.map((item) => ({ label: item, value: item }));
  }

  get isSchedulableClassComboboxDisabled() {
    return this.isViewMode;
  }

  // When options
  whenOptions = this._getWhenOptions();

  // Context options
  contextOptions = this._getContextOptions();

  connectedCallback() {
    super.connectedCallback();
    // Options arrays depend on translations — init them after auto-translation load.
    this._initOptions();
    if (this.isEditMode && this.action) {
      this.editedAction = JSON.parse(JSON.stringify(this.action));
      // Ensure parameters object exists
      if (!this.editedAction.parameters) {
        this.editedAction.parameters = {};
      }
      // Set default type to "command" if not set
      if (!this.editedAction.type) {
        this.editedAction.type = "command";
      }
    } else if (this.action) {
      // Ensure action has parameters object for view mode
      if (!this.action.parameters) {
        this.action.parameters = {};
      }
      // Set default type to "command" if not set
      if (!this.action.type) {
        this.action.type = "command";
      }
    }
    this._requestSchedulableClassesIfNeeded(this.displayedAction?.type);
    this._requestCommunitiesIfNeeded(this.displayedAction?.type);
  }

  get modalTitle() {
    if (this.isEditMode) {
      return this.t("editDeploymentAction");
    }
    return this.t("deploymentActionDetails");
  }

  get isViewMode() {
    return !this.isEditMode;
  }

  get displayedAction() {
    return this.isEditMode ? this.editedAction : this.action;
  }

  get hasValidationError() {
    return !!this.validationError;
  }

  get actionType() {
    return this.action?.type || "command";
  }

  get actionWhen() {
    return this.action?.when || "pre-deploy";
  }

  get actionContext() {
    return this.action?.context || "all";
  }

  // Dynamic field visibility based on type
  get showApexScriptField() {
    const type = this.displayedAction?.type;
    return type === "apex";
  }

  get showSfdmuProjectField() {
    const type = this.displayedAction?.type;
    return type === "data";
  }

  get showCommunityNameField() {
    const type = this.displayedAction?.type;
    return type === "publish-community";
  }

  get showInstructionsField() {
    const type = this.displayedAction?.type;
    return type === "manual";
  }

  get showScheduleBatchClassNameField() {
    const type = this.displayedAction?.type;
    return type === "schedule-batch";
  }

  get showScheduleBatchCronExpressionField() {
    const type = this.displayedAction?.type;
    return type === "schedule-batch";
  }

  get showScheduleBatchJobNameField() {
    const type = this.displayedAction?.type;
    return type === "schedule-batch";
  }

  get showCommandField() {
    const type = this.displayedAction?.type;
    return type === "command";
  }

  get showAllowFailureField() {
    const type = this.displayedAction?.type;
    return type !== "manual";
  }

  get showSkipIfErrorField() {
    const when = this.displayedAction?.when;
    return when !== "pre-deploy";
  }

  get showCustomUsernameField() {
    const type = this.displayedAction?.type;
    return type !== "manual";
  }

  get hasApexScriptSelected() {
    return !!this.displayedAction?.parameters?.apexScript;
  }

  get hasSfdmuProjectSelected() {
    return !!this.displayedAction?.parameters?.sfdmuProject;
  }

  get hasScheduleBatchClassNameSelected() {
    return !!this.displayedAction?.parameters?.className;
  }

  get hasScheduleBatchCronExpressionSelected() {
    return !!this.displayedAction?.parameters?.cronExpression;
  }

  // Get parameter values
  get apexScript() {
    return this.action?.parameters?.apexScript || "";
  }

  get sfdmuProject() {
    return this.action?.parameters?.sfdmuProject || "";
  }

  get communityName() {
    return this.action?.parameters?.communityName || "";
  }

  get instructions() {
    return this.action?.parameters?.instructions || "";
  }

  get scheduleBatchClassName() {
    return this.action?.parameters?.className || "";
  }

  get scheduleBatchCronExpression() {
    return this.action?.parameters?.cronExpression || "";
  }

  get scheduleBatchJobName() {
    return this.action?.parameters?.jobName || "";
  }

  get command() {
    return this.action?.command || "";
  }

  get prLabel() {
    if (this.action?.pullRequest) {
      return `#${this.action.pullRequest.number} - ${this.action.pullRequest.title || ""}`;
    }
    return "N/A";
  }

  get prWebUrl() {
    return this.action?.pullRequest?.webUrl || "";
  }

  get hasPullRequest() {
    return !!this.action?.pullRequest;
  }

  handleEdit() {
    this.editedAction = JSON.parse(JSON.stringify(this.action));
    // Ensure parameters object exists
    if (!this.editedAction.parameters) {
      this.editedAction.parameters = {};
    }
    // Dispatch event to parent
    this.dispatchEvent(new CustomEvent("edit"));
  }

  handleCancel() {
    // Reset edited action and dispatch close event
    this.handleClose();
  }

  handleClose() {
    // Dispatch close event to parent
    this.dispatchEvent(new CustomEvent("close"));
  }

  handleFieldChange(event) {
    const field = event.target.dataset.field;
    const value = event.target.value;

    // Ignore empty-value sentinel options (loading / no results placeholders)
    const isCombobox =
      event.target.tagName &&
      event.target.tagName.toLowerCase() === "lightning-combobox";
    if (value === "" && isCombobox) {
      return;
    }

    if (field.startsWith("parameters.")) {
      const paramName = field.substring(11);
      if (!this.editedAction.parameters) {
        this.editedAction.parameters = {};
      }
      this.editedAction.parameters[paramName] = value;
    } else {
      this.editedAction[field] = value;
    }
    this.validationError = "";
  }

  handleCheckboxChange(event) {
    const field = event.target.dataset.field;
    const checked = event.target.checked;
    this.editedAction[field] = checked;
    this.validationError = "";
  }

  handleTypeChange(event) {
    const newType = event.detail.value;
    this.editedAction.type = newType;
    this.validationError = "";
    this._requestSchedulableClassesIfNeeded(newType);
    this._requestCommunitiesIfNeeded(newType);
    // Force re-render to show/hide fields by reassigning the tracked property
    this.editedAction = { ...this.editedAction };
    // Trigger reactivity by reassigning to force getter recalculation
    this.isEditMode = this.isEditMode;
  }

  _requestSchedulableClassesIfNeeded(type) {
    if (type !== "schedule-batch") {
      return;
    }
    if (this.isViewMode) {
      return;
    }
    if (this._schedulableClassesRequested) {
      return;
    }
    if (Array.isArray(this.schedulableClasses) && this.schedulableClasses.length) {
      return;
    }
    this._schedulableClassesRequested = true;
    this.dispatchEvent(new CustomEvent("loadschedulableclasses"));
  }

  _requestCommunitiesIfNeeded(type) {
    if (type !== "publish-community") {
      return;
    }
    if (this.isViewMode) {
      return;
    }
    if (this._communitiesRequested) {
      return;
    }
    if (Array.isArray(this.communities) && this.communities.length) {
      return;
    }
    this._communitiesRequested = true;
    this.dispatchEvent(new CustomEvent("loadcommunities"));
  }

  handleSave() {
    const isValid = this._validateRequiredFields();
    if (!isValid) {
      this.validationError = this.t("deploymentActionMissingRequiredFields");
      return;
    }

    this.validationError = "";
    // Dispatch save event to parent with edited action
    this.dispatchEvent(
      new CustomEvent("save", {
        detail: this.editedAction,
      }),
    );
  }

  _validateRequiredFields() {
    const requiredFieldPaths = this._getRequiredFieldPaths();
    const missingFieldPaths = requiredFieldPaths.filter((fieldPath) => {
      const value = this._getFieldValueByPath(fieldPath);
      return typeof value !== "string" ? value === undefined || value === null : value.trim() === "";
    });

    requiredFieldPaths.forEach((fieldPath) => {
      const element = this.template.querySelector(`[data-field="${fieldPath}"]`);
      if (!element || typeof element.setCustomValidity !== "function") {
        return;
      }
      if (missingFieldPaths.includes(fieldPath)) {
        element.setCustomValidity(this.t("requiredField"));
      } else {
        element.setCustomValidity("");
      }
      if (typeof element.reportValidity === "function") {
        element.reportValidity();
      }
    });

    return missingFieldPaths.length === 0;
  }

  _getRequiredFieldPaths() {
    const requiredFields = ["label", "type", "when", "context"];
    const currentType = this.editedAction?.type || "command";

    if (currentType === "command") {
      requiredFields.push("command");
    } else if (currentType === "apex") {
      requiredFields.push("parameters.apexScript");
    } else if (currentType === "data") {
      requiredFields.push("parameters.sfdmuProject");
    } else if (currentType === "publish-community") {
      requiredFields.push("parameters.communityName");
    } else if (currentType === "manual") {
      requiredFields.push("parameters.instructions");
    } else if (currentType === "schedule-batch") {
      requiredFields.push("parameters.className", "parameters.cronExpression");
    }

    return requiredFields;
  }

  _getFieldValueByPath(path) {
    if (!path) {
      return undefined;
    }
    const segments = path.split(".");
    let current = this.editedAction;
    for (const segment of segments) {
      if (current == null) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  handleOpenApexScript() {
    const apexScriptPath = this.displayedAction?.parameters?.apexScript;
    if (apexScriptPath) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: apexScriptPath },
      });
    }
  }

  handleOpenSfdmuExport() {
    const sfdmuProjectPath = this.displayedAction?.parameters?.sfdmuProject;
    if (sfdmuProjectPath) {
      // Construct path to export.json
      const exportJsonPath = `scripts/data/${sfdmuProjectPath}/export.json`;
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: exportJsonPath },
      });
    }
  }
}
