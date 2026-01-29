/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";

export default class DeploymentAction extends LightningElement {
  @api action = null;
  @api isEditMode = false;
  @api apexScripts = [];
  @api sfdmuWorkspaces = [];
  @track editedAction = {};

  // Available action types
  typeOptions = [
    { label: "Command", value: "command" },
    { label: "Data", value: "data" },
    { label: "Apex", value: "apex" },
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
          label: `${selectedValue} (not visible from this git branch)`,
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
          label: `${selectedValue} (not visible from this git branch)`,
          value: selectedValue,
        },
        ...options,
      ];
    }

    return options;
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
  }

  get modalTitle() {
    if (this.isEditMode) {
      return `Edit Deployment Action`;
    }
    return `Deployment Action Details`;
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
    // Force re-render to show/hide fields by reassigning the tracked property
    this.editedAction = { ...this.editedAction };
    // Trigger reactivity by reassigning to force getter recalculation
    this.isEditMode = this.isEditMode;
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
