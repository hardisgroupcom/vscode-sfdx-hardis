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
    }
  }
  get isEditMode() {
    return this._isEditMode;
  }

  @api apexScripts = [];
  @api sfdmuWorkspaces = [];
  _storedSchedulableClasses = null;

  @api
  set schedulableClasses(val) {
    if (Array.isArray(val) && val.length > 0) {
      this._storedSchedulableClasses = val;
    }
  }
  get schedulableClasses() {
    return this._storedSchedulableClasses || [];
  }

  @api schedulableClassesLoading = false;
  @track editedAction = {};
  _schedulableClassesRequested = false;

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
    this.whenOptions = [
      { label: this.t("beforeDeployment"), value: "pre-deploy" },
      { label: this.t("afterDeployment"), value: "post-deploy" },
    ];
    this.contextOptions = [
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
    { label: "Command", value: "command" },
    { label: "Data", value: "data" },
    { label: "Apex", value: "apex" },
    { label: "Schedule Batch", value: "schedule-batch" },
    { label: "Publish Community", value: "publish-community" },
    { label: "Manual", value: "manual" },
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

  get isSchedulableClassComboboxDisabled() {
    return this.isViewMode;
  }

  // When options
  whenOptions = [
    { label: "Before Deployment", value: "pre-deploy" },
    { label: "After Deployment", value: "post-deploy" },
  ];

  // Context options
  contextOptions = [
    { label: "Check & Process Deployment", value: "all" },
    { label: "Check Deployment Only", value: "check-deployment-only" },
    { label: "Process Deployment Only", value: "process-deployment-only" },
  ];

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
    if (value === "") {
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
  }

  handleCheckboxChange(event) {
    const field = event.target.dataset.field;
    const checked = event.target.checked;
    this.editedAction[field] = checked;
  }

  handleTypeChange(event) {
    const newType = event.detail.value;
    this.editedAction.type = newType;
    this._requestSchedulableClassesIfNeeded(newType);
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

  handleSave() {
    // Dispatch save event to parent with edited action
    this.dispatchEvent(
      new CustomEvent("save", {
        detail: this.editedAction,
      }),
    );
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
