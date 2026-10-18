/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import {
  getOrgInitStepTypeLabel,
  getOrgInitStepTypePillClass,
} from "s/deploymentActionUtils";

// Top-level fields of the scratch org definition shown in the form: the other ones (template,
// username, adminEmail...) are kept as they are when the file is saved
const SCRATCH_DEF_FORM_FIELDS = [
  "orgName",
  "edition",
  "features",
  "hasSampleData",
  "language",
  "country",
  "description",
  "release",
  "settings",
];

export default class OrgInit extends SharedMixin(LightningElement) {
  @track config = null;
  @track steps = [];
  @track selectedStepIds = [];
  @track apexScripts = [];
  @track sfdmuWorkspaces = [];
  @track permissionSets = [];
  @track customFunctions = [];
  @track orgs = [];
  @track targetOrg = "";
  stepsDirty = false;
  // A save was sent and the extension has not answered yet
  stepsSaving = false;

  // Step editor (s-deployment-action in orgInit mode)
  @track showStepModal = false;
  @track currentStep = null;
  @track stepModalEditMode = false;
  editedStepIndex = -1;
  @track schedulableClasses = [];
  @track projectOnlySchedulableClasses = [];
  schedulableClassesLoading = false;
  @track batchableClasses = [];
  @track projectOnlyBatchableClasses = [];
  batchableClassesLoading = false;
  @track communities = [];
  communitiesLoading = false;

  // Scratch org definition editor
  @track scratchDef = {};
  @track featuresText = "";
  @track settingsText = "";
  @track rawScratchDefText = "";
  @track scratchOrgDuration = "";
  // Issues block the save, warnings do not (a value Salesforce knows and the bundled schema does not)
  @track scratchDefIssues = [];
  @track scratchDefWarnings = [];
  @track localScratchDefIssues = [];
  @track localScratchDefWarnings = [];
  rawMode = false;
  scratchDefSaving = false;
  scratchDefDirty = false;

  @api
  initialize(data) {
    data = data || {};
    this.applyLoadingState(data);
    if (!data.config) {
      return;
    }
    this.config = data.config;
    this.steps = (data.config.steps || []).map((step) => ({ ...step }));
    this.stepsDirty = false;
    this.stepsSaving = false;
    this.selectedStepIds = [];
    this.apexScripts = data.apexScripts || [];
    this.sfdmuWorkspaces = data.sfdmuWorkspaces || [];
    this.permissionSets = data.permissionSets || [];
    this.customFunctions = data.customFunctions || [];
    this.orgs = data.orgs || [];
    const defaultOrg = this.orgs.find((org) => org.isDefault);
    if (!this.orgs.find((org) => org.value === this.targetOrg)) {
      this.targetOrg = defaultOrg ? defaultOrg.value : "";
    }
    // A reload after a steps save or a Refresh must not drop what is being typed in the other tab
    if (!this.scratchDefDirty) {
      this._loadScratchDef(data.config);
    }
  }

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "initialize":
        this.initialize(data);
        break;
      case "scratchDefValidated":
        this.scratchDefSaving = false;
        this.scratchDefIssues = data?.issues || [];
        this.scratchDefWarnings = data?.warnings || [];
        break;
      case "scratchDefSaved":
        this.scratchDefSaving = false;
        this.scratchDefIssues = [];
        this.scratchDefWarnings = data?.warnings || [];
        this.scratchDefDirty = false;
        break;
      case "orgInitStepsSaveFailed":
        // The steps stay unsaved: Save is offered again
        this.stepsSaving = false;
        break;
      case "returnSchedulableClasses":
        this.schedulableClasses = data?.values || [];
        this.projectOnlySchedulableClasses = data?.projectOnlyValues || [];
        this.schedulableClassesLoading = false;
        break;
      case "returnBatchableClasses":
        this.batchableClasses = data?.values || [];
        this.projectOnlyBatchableClasses = data?.projectOnlyValues || [];
        this.batchableClassesLoading = false;
        break;
      case "returnCommunities":
        this.communities = data?.values || [];
        this.communitiesLoading = false;
        break;
      default:
        break;
    }
  }

  @api
  handleColorThemeMessage(type, data) {
    if (super.handleColorThemeMessage) {
      super.handleColorThemeMessage(type, data);
    }
  }

  handleRetry() {
    this.loadError = null;
    this.loading = true;
    window.sendMessageToVSCode({ type: "retryInit" });
  }

  handleRefresh() {
    window.sendMessageToVSCode({ type: "refresh" });
  }

  // ---------------------------------------------------------------- Steps tab

  // Built-in step types offered by the editor, as the CLI lists them
  get stepTypes() {
    return this.config?.stepTypes || [];
  }

  get isLegacySource() {
    return this.config?.source === "legacy";
  }

  get legacyBanner() {
    const keys = this.config?.legacyKeys || [];
    return keys.length > 0
      ? this.t("orgInitLegacyBannerWithKeys", { keys: keys.join(", ") })
      : this.t("orgInitLegacyBanner");
  }

  get hasDefinitionErrors() {
    return (this.config?.definitionErrors || []).length > 0;
  }

  get definitionErrors() {
    return (this.config?.definitionErrors || []).map((error, index) => ({
      key: `${error.stepId}-${index}`,
      text: `[${error.stepId}] ${error.message}`,
    }));
  }

  get hasSteps() {
    return this.steps.length > 0;
  }

  get canSaveSteps() {
    return this.stepsDirty || this.isLegacySource;
  }

  get saveStepsDisabled() {
    return !this.canSaveSteps || this.stepsSaving;
  }

  get saveStepsLabel() {
    return this.isLegacySource && !this.stepsDirty
      ? this.t("orgInitConvertAndSave")
      : this.t("saveLabel");
  }

  get stepColumns() {
    return [
      {
        label: this.t("orgInitColumnOrder"),
        fieldName: "order",
        type: "number",
        initialWidth: 70,
        cellAttributes: { alignment: "left" },
      },
      {
        label: this.t("orgInitColumnStep"),
        fieldName: "label",
        type: "text",
        wrapText: true,
      },
      {
        label: this.t("orgInitColumnType"),
        fieldName: "typeLabel",
        type: "typePill",
        typeAttributes: {
          label: { fieldName: "typeLabel" },
          pillClass: { fieldName: "typePillClass" },
        },
        initialWidth: 190,
      },
      {
        label: this.t("orgInitColumnOrgTypes"),
        fieldName: "orgTypesLabel",
        type: "text",
        initialWidth: 210,
      },
      {
        label: this.t("orgInitColumnPoolFill"),
        fieldName: "poolFillLabel",
        type: "text",
        initialWidth: 120,
      },
      {
        label: this.t("orgInitColumnOnError"),
        fieldName: "onErrorLabel",
        type: "text",
        initialWidth: 130,
      },
      {
        label: this.t("orgInitColumnStatus"),
        fieldName: "statusLabel",
        type: "statusPill",
        typeAttributes: {
          label: { fieldName: "statusLabel" },
          pillClass: { fieldName: "statusPillClass" },
        },
        initialWidth: 120,
      },
      {
        type: "action",
        typeAttributes: { rowActions: this._getRowActions.bind(this) },
      },
    ];
  }

  get stepRows() {
    return this.steps.map((step, index) => {
      const orgTypes =
        Array.isArray(step.orgTypes) && step.orgTypes.length > 0
          ? step.orgTypes
          : ["scratch", "sandbox"];
      const enabled = step.enabled !== false;
      return {
        id: step.id,
        order: index + 1,
        label: step.label,
        typeLabel: getOrgInitStepTypeLabel(
          step.type || "command",
          (key, params) => this.t(key, params),
          this.customFunctions,
        ),
        typePillClass: getOrgInitStepTypePillClass(step.type || "command"),
        orgTypesLabel: orgTypes
          .map((orgType) =>
            orgType === "scratch"
              ? this.t("orgInitOrgTypeScratch")
              : this.t("orgInitOrgTypeSandbox"),
          )
          .join(", "),
        poolFillLabel:
          step.runAtPoolFill === false ? this.t("noLabel") : this.t("yesLabel"),
        onErrorLabel:
          step.allowFailure === true
            ? this.t("orgInitOnErrorContinue")
            : this.t("orgInitOnErrorStop"),
        statusLabel: enabled
          ? this.t("orgInitStepEnabled")
          : this.t("orgInitStepDisabled"),
        statusPillClass: enabled
          ? "hardis-pill hardis-status-success"
          : "hardis-pill hardis-status-unknown",
        enabled,
      };
    });
  }

  _getRowActions(row, doneCallback) {
    doneCallback([
      { label: this.t("edit"), name: "edit", iconName: "utility:edit" },
      {
        label: row.enabled
          ? this.t("orgInitDisableStep")
          : this.t("orgInitEnableStep"),
        name: "toggle",
        iconName: row.enabled ? "utility:pause" : "utility:play",
      },
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
      {
        label: this.t("deleteLabel"),
        name: "delete",
        iconName: "utility:delete",
      },
    ]);
  }

  handleStepRowAction(event) {
    const actionName = event.detail.action.name;
    const index = this.steps.findIndex(
      (step) => step.id === event.detail.row.id,
    );
    if (index < 0) {
      return;
    }
    const steps = [...this.steps];
    if (actionName === "edit") {
      this._openStepModal(index, true);
      return;
    }
    if (actionName === "toggle") {
      steps[index] = {
        ...steps[index],
        enabled: steps[index].enabled === false,
      };
    } else if (actionName === "move_up" && index > 0) {
      [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
    } else if (actionName === "move_down" && index < steps.length - 1) {
      [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]];
    } else if (actionName === "delete") {
      steps.splice(index, 1);
    } else {
      return;
    }
    this.steps = steps;
    this.stepsDirty = true;
  }

  handleStepSelection(event) {
    this.selectedStepIds = (event.detail.selectedRows || []).map(
      (row) => row.id,
    );
  }

  handleAddStep() {
    this.editedStepIndex = -1;
    this.currentStep = {
      id: "",
      label: "",
      type: "command",
      command: "",
      parameters: {},
      enabled: true,
      orgTypes: ["scratch", "sandbox"],
      runAtPoolFill: true,
      allowFailure: false,
    };
    this.stepModalEditMode = true;
    this.showStepModal = true;
  }

  _openStepModal(index, editMode) {
    this.editedStepIndex = index;
    this.currentStep = JSON.parse(JSON.stringify(this.steps[index]));
    this.stepModalEditMode = editMode;
    this.showStepModal = true;
  }

  handleCloseStepModal() {
    this.showStepModal = false;
    this.currentStep = null;
  }

  handleSaveStep(event) {
    const step = event.detail.action;
    const steps = [...this.steps];
    // The CLI selects steps by id: two steps cannot share one
    const duplicate = steps.findIndex(
      (other, index) => other.id === step.id && index !== this.editedStepIndex,
    );
    if (duplicate >= 0) {
      step.id = `${step.id}-${Date.now()}`;
    }
    if (this.editedStepIndex >= 0) {
      steps[this.editedStepIndex] = step;
    } else {
      steps.push(step);
    }
    this.steps = steps;
    this.stepsDirty = true;
    this.handleCloseStepModal();
  }

  handleSaveSteps() {
    window.sendMessageToVSCode({
      type: "saveOrgInitSteps",
      data: { steps: JSON.parse(JSON.stringify(this.steps)) },
    });
    // stepsDirty is cleared by the reload that follows a successful save, never before
    this.stepsSaving = true;
  }

  handleOpenInstalledPackages() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "vscode-sfdx-hardis.showInstalledPackages" },
    });
  }

  handleLoadSchedulableClasses() {
    this.schedulableClassesLoading = true;
    window.sendMessageToVSCode({ type: "loadSchedulableClasses", data: {} });
  }

  handleLoadBatchableClasses() {
    this.batchableClassesLoading = true;
    window.sendMessageToVSCode({ type: "loadBatchableClasses", data: {} });
  }

  handleLoadCommunities() {
    this.communitiesLoading = true;
    window.sendMessageToVSCode({ type: "loadCommunities", data: {} });
  }

  // ------------------------------------------------------------------ Run now

  get hasOrgs() {
    return this.orgs.length > 0;
  }

  get runNowDisabled() {
    return (
      !this.targetOrg || this.stepsDirty || this.stepsSaving || !this.hasSteps
    );
  }

  get runNowLabel() {
    return this.selectedStepIds.length > 0
      ? this.t("orgInitRunSelected", { count: this.selectedStepIds.length })
      : this.t("orgInitRunAll");
  }

  get runNowHint() {
    return this.stepsDirty
      ? this.t("orgInitSaveBeforeRun")
      : this.t("orgInitRunNowHint");
  }

  handleTargetOrgChange(event) {
    this.targetOrg = event.detail.value;
  }

  handleRunNow() {
    window.sendMessageToVSCode({
      type: "runOrgInit",
      data: { stepIds: this.selectedStepIds, targetOrg: this.targetOrg },
    });
  }

  // ------------------------------------------------- Scratch org definition tab

  get scratchDefExists() {
    return this.config?.scratchDef?.exists === true;
  }

  get scratchDefPath() {
    return this.config?.scratchDef?.path || "config/project-scratch-def.json";
  }

  get editionOptions() {
    const editions = this.config?.scratchDefHints?.editions || [];
    const current = this.scratchDef.edition;
    const values =
      current && !editions.includes(current)
        ? [current, ...editions]
        : editions;
    return values.map((edition) => ({ label: edition, value: edition }));
  }

  get releaseOptions() {
    return [
      { label: this.t("orgInitReleaseCurrent"), value: "" },
      { label: this.t("orgInitReleasePreview"), value: "preview" },
      { label: this.t("orgInitReleasePrevious"), value: "previous" },
    ];
  }

  get scratchDefRelease() {
    return this.scratchDef.release || "";
  }

  get hasSampleData() {
    return this.scratchDef.hasSampleData === true;
  }

  get isFormMode() {
    return !this.rawMode;
  }

  get rawModeLabel() {
    return this.rawMode
      ? this.t("orgInitShowForm")
      : this.t("orgInitShowRawJson");
  }

  get allScratchDefIssues() {
    return [...this.localScratchDefIssues, ...this.scratchDefIssues].map(
      (text, index) => ({ key: `issue-${index}`, text }),
    );
  }

  get hasScratchDefIssues() {
    return this.allScratchDefIssues.length > 0;
  }

  get allScratchDefWarnings() {
    const warnings = [
      ...new Set([...this.localScratchDefWarnings, ...this.scratchDefWarnings]),
    ];
    return warnings.map((text, index) => ({ key: `warning-${index}`, text }));
  }

  get hasScratchDefWarnings() {
    return this.allScratchDefWarnings.length > 0;
  }

  get saveScratchDefDisabled() {
    return (
      this.scratchDefSaving ||
      !this.scratchDefDirty ||
      this.localScratchDefIssues.length > 0
    );
  }

  get saveScratchDefLabel() {
    return this.scratchDefSaving
      ? this.t("orgInitValidating")
      : this.t("orgInitValidateAndSave");
  }

  get knownFeaturesHint() {
    const count = (this.config?.scratchDefHints?.features || []).length;
    return this.t("orgInitFeaturesHint", { count });
  }

  _loadScratchDef(config) {
    const content = config?.scratchDef?.content;
    this.scratchDef =
      content && typeof content === "object" ? { ...content } : {};
    this.featuresText = (this.scratchDef.features || []).join("\n");
    this.settingsText = this.scratchDef.settings
      ? JSON.stringify(this.scratchDef.settings, null, 2)
      : "";
    this.rawScratchDefText = JSON.stringify(this.scratchDef, null, 2);
    this.scratchOrgDuration =
      config?.scratchOrgDuration !== null &&
      config?.scratchOrgDuration !== undefined
        ? String(config.scratchOrgDuration)
        : "";
    this.scratchDefIssues = config?.scratchDef?.issues || [];
    this.scratchDefWarnings = config?.scratchDef?.warnings || [];
    this.localScratchDefIssues = [];
    this.localScratchDefWarnings = [];
    this.scratchDefDirty = false;
  }

  handleScratchDefFieldChange(event) {
    const field = event.target.dataset.field;
    const value =
      event.target.type === "checkbox" || event.target.type === "toggle"
        ? event.target.checked
        : event.detail?.value !== undefined
          ? event.detail.value
          : event.target.value;
    const scratchDef = { ...this.scratchDef };
    if (value === "" || value === null || value === undefined) {
      delete scratchDef[field];
    } else {
      scratchDef[field] = value;
    }
    this.scratchDef = scratchDef;
    this._onScratchDefChanged();
  }

  handleFeaturesChange(event) {
    this.featuresText = event.target.value || "";
    this._onScratchDefChanged();
  }

  handleSettingsChange(event) {
    this.settingsText = event.target.value || "";
    this._onScratchDefChanged();
  }

  handleRawScratchDefChange(event) {
    this.rawScratchDefText = event.target.value || "";
    this._onScratchDefChanged();
  }

  handleDurationChange(event) {
    this.scratchOrgDuration = event.target.value || "";
    this._onScratchDefChanged();
  }

  handleToggleRawMode() {
    // Switching keeps what was typed: the form and the raw text describe the same definition
    const built = this._buildScratchDefContent();
    if (!built.content) {
      // The other side would show stale content and overwrite these edits later
      this.localScratchDefIssues = built.issues;
      return;
    }
    if (this.rawMode) {
      this.scratchDef = { ...built.content };
      this.featuresText = (built.content.features || []).join("\n");
      this.settingsText = built.content.settings
        ? JSON.stringify(built.content.settings, null, 2)
        : "";
    } else {
      this.rawScratchDefText = JSON.stringify(built.content, null, 2);
    }
    this.rawMode = !this.rawMode;
    this._checkScratchDefLocally();
  }

  handleSaveScratchDef() {
    const built = this._buildScratchDefContent();
    if (!built.content) {
      this.localScratchDefIssues = built.issues;
      return;
    }
    this.scratchDefSaving = true;
    window.sendMessageToVSCode({
      type: "saveScratchDef",
      data: {
        content: built.content,
        scratchOrgDuration: this.scratchOrgDuration,
      },
    });
  }

  _onScratchDefChanged() {
    this.scratchDefDirty = true;
    // The CLI issues were about the saved file: they come back at the next validation
    this.scratchDefIssues = [];
    this.scratchDefWarnings = [];
    this._checkScratchDefLocally();
  }

  // Quick checks while typing. The CLI validates against the Salesforce CLI schema on save.
  _checkScratchDefLocally() {
    const built = this._buildScratchDefContent();
    const issues = [...built.issues];
    this.localScratchDefWarnings = built.content
      ? this._checkKnownValues(built.content)
      : [];
    const duration = this.scratchOrgDuration;
    if (duration !== "" && !/^([1-9]|[12][0-9]|30)$/.test(String(duration))) {
      issues.push(this.t("orgInitDurationInvalid"));
    }
    this.localScratchDefIssues = issues;
  }

  _checkKnownValues(content) {
    const hints = this.config?.scratchDefHints || {};
    const issues = [];
    const settingsNames = (hints.settingsNames || []).map((name) =>
      name.toLowerCase(),
    );
    if (
      content.settings &&
      typeof content.settings === "object" &&
      settingsNames.length > 0
    ) {
      for (const name of Object.keys(content.settings)) {
        if (!settingsNames.includes(name.toLowerCase())) {
          issues.push(this.t("orgInitUnknownSettings", { name }));
        }
      }
    }
    const features = (hints.features || []).map((feature) =>
      feature.toLowerCase(),
    );
    if (Array.isArray(content.features) && features.length > 0) {
      for (const feature of content.features) {
        if (!this._isKnownFeature(String(feature), features)) {
          issues.push(this.t("orgInitUnknownFeature", { feature }));
        }
      }
    }
    return issues;
  }

  // Known features are plain names, or "Name:<value>" for the ones that take a number.
  // Salesforce does not care about the case, so neither does this check.
  _isKnownFeature(feature, features) {
    const lowerFeature = feature.toLowerCase();
    if (features.includes(lowerFeature)) {
      return true;
    }
    const name = lowerFeature.split(":")[0];
    return features.includes(`${name}:<value>`);
  }

  _buildScratchDefContent() {
    if (this.rawMode) {
      try {
        const content = JSON.parse(this.rawScratchDefText || "{}");
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          return {
            content: null,
            issues: [this.t("orgInitScratchDefNotObject")],
          };
        }
        return { content, issues: [] };
      } catch (e) {
        return {
          content: null,
          issues: [this.t("orgInitInvalidJson", { message: e.message })],
        };
      }
    }
    const content = {};
    // Fields the form does not show keep their value and their place
    for (const [key, value] of Object.entries(this.scratchDef)) {
      if (!SCRATCH_DEF_FORM_FIELDS.includes(key)) {
        content[key] = value;
      }
    }
    for (const key of [
      "orgName",
      "edition",
      "language",
      "country",
      "description",
      "release",
    ]) {
      if (this.scratchDef[key]) {
        content[key] = this.scratchDef[key];
      }
    }
    if (this.scratchDef.hasSampleData === true) {
      content.hasSampleData = true;
    }
    const features = (this.featuresText || "")
      .split(/\r?\n/)
      .map((feature) => feature.trim())
      .filter(Boolean);
    if (features.length > 0) {
      content.features = features;
    }
    if ((this.settingsText || "").trim() !== "") {
      try {
        const settings = JSON.parse(this.settingsText);
        if (
          !settings ||
          typeof settings !== "object" ||
          Array.isArray(settings)
        ) {
          return {
            content: null,
            issues: [this.t("orgInitSettingsNotObject")],
          };
        }
        content.settings = settings;
      } catch (e) {
        return {
          content: null,
          issues: [
            this.t("orgInitInvalidSettingsJson", { message: e.message }),
          ],
        };
      }
    }
    return { content, issues: [] };
  }
}
