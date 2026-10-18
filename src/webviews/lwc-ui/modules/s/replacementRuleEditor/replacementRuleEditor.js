/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";

/**
 * Editor of one replacement rule, as one place (project, branch file or issue) stores it.
 *
 * It only edits and emits a rule. Saving goes through the extension, which writes the rule to a
 * temporary file and runs `sf hardis:project:replacement:create|update --agent --rule-file`:
 * sfdx-hardis stays the engine and validates the rule again. A secret is the NAME of a CI/CD
 * variable: no secret value is ever typed here.
 */

const DEFAULT_TARGET = "default";
// Same rules as sfdx-hardis: an id of lowercase letters, digits and "-", a secret named like a variable
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const TYPE_CHOICES = [
  {
    type: "xml-value",
    titleKey: "replacementRulesTypeXmlValue",
    descKey: "replacementRulesTypeXmlValueDesc",
    hue: "blue",
    icon: "utility:edit_form",
  },
  {
    type: "xml-remove",
    titleKey: "replacementRulesTypeXmlRemove",
    descKey: "replacementRulesTypeXmlRemoveDesc",
    hue: "amber",
    icon: "utility:delete",
  },
  {
    type: "text",
    titleKey: "replacementRulesTypeText",
    descKey: "replacementRulesTypeTextDesc",
    hue: "teal",
    icon: "utility:search",
  },
];

export default class ReplacementRuleEditor extends SharedMixin(
  LightningElement,
) {
  @api definition = null;
  @api isCreate = false;
  // Type of the rule this override changes, read from the layers below it
  @api inheritedType = "";
  @api majorBranches = [];
  @api issueAvailable = false;
  @api issueNumber = null;
  @api secretLookups = {};
  @api saving = false;
  @api errorMessage = "";

  draft = {
    id: "",
    description: "",
    enabled: undefined,
    type: "xml-value",
    typeChanged: false,
    filesText: "",
    xmlPath: "",
    find: "",
    regex: false,
    valueMode: "values",
    value: "",
    values: {},
    secret: "",
    orgsMode: "all",
    orgs: [],
    required: false,
    store: "project",
  };
  validationError = "";

  connectedCallback() {
    super.connectedCallback();
    this.draft = this.buildDraft();
  }

  // --- Draft ---

  buildDraft() {
    const definition = this.definition;
    const rule = (definition && definition.rule) || {};
    const include = rule.includeTargetBranches || [];
    const exclude = rule.excludeTargetBranches || [];
    let valueMode = "values";
    if (typeof rule.value === "string") {
      valueMode = "value";
    } else if (rule.secret) {
      valueMode = "secret";
    } else if (rule.values && Object.keys(rule.values).length > 0) {
      valueMode = "values";
    } else if (this.isOverride) {
      valueMode = "inherit";
    }
    return {
      id: rule.id || "",
      description: rule.description || "",
      enabled: typeof rule.enabled === "boolean" ? rule.enabled : undefined,
      type: rule.type || this.inheritedType || "xml-value",
      typeChanged: false,
      filesText: asList(rule.files).join("\n"),
      xmlPath: rule.xmlPath || "",
      find: rule.find || "",
      regex: rule.regex === true,
      valueMode,
      value: typeof rule.value === "string" ? rule.value : "",
      values: { ...(rule.values || {}) },
      secret: rule.secret || "",
      orgsMode:
        include.length > 0 ? "include" : exclude.length > 0 ? "exclude" : "all",
      orgs: include.length > 0 ? [...include] : [...exclude],
      required: rule.required === true,
      store: definition
        ? definition.layer === "branch"
          ? `branch:${definition.branch}`
          : definition.layer
        : "project",
    };
  }

  // A definition that changes a rule of a lower place: its empty fields keep the value from there
  get isOverride() {
    return (
      !this.isCreate &&
      !!this.definition &&
      Array.isArray(this.definition.overrides) &&
      this.definition.overrides.length > 0
    );
  }

  get overrideNote() {
    const places = (this.definition && this.definition.overrides) || [];
    return this.t("replacementRulesOverrideNote", {
      places: places
        .map((place) => this.i18n[originLabelKey(place)] || place)
        .join(", "),
    });
  }

  // --- Header ---

  get modalTitle() {
    return this.isCreate
      ? this.i18n.replacementRulesNewRuleTitle
      : this.t("replacementRulesEditRuleTitle", { id: this.draft.id });
  }

  get isIdReadOnly() {
    return !this.isCreate;
  }

  // --- What the rule does ---

  get typeCards() {
    return TYPE_CHOICES.map((choice) => {
      const selected = this.draft.type === choice.type;
      return {
        ...choice,
        title: this.i18n[choice.titleKey],
        description: this.i18n[choice.descKey],
        cardClass: selected
          ? "hardis-card clickable selected"
          : "hardis-card clickable",
        tileClass: `hardis-tile small ${choice.hue}`,
        ariaPressed: selected ? "true" : "false",
      };
    });
  }

  get isText() {
    return this.draft.type === "text";
  }

  get isRemove() {
    return this.draft.type === "xml-remove";
  }

  get showValue() {
    return !this.isRemove;
  }

  // --- Where the rule is stored ---

  get storeOptions() {
    const options = [
      { label: this.i18n.replacementRulesStoreProject, value: "project" },
    ];
    const branches = [...(this.majorBranches || [])];
    if (
      this.definition &&
      this.definition.layer === "branch" &&
      this.definition.branch &&
      !branches.includes(this.definition.branch)
    ) {
      branches.push(this.definition.branch);
    }
    for (const branch of branches) {
      options.push({
        label: this.t("replacementRulesStoreBranch", { branch }),
        value: `branch:${branch}`,
      });
    }
    if (this.issueAvailable || this.draft.store === "issue") {
      options.push({
        label: this.issueNumber
          ? this.t("replacementRulesStoreIssueNumbered", {
              number: this.issueNumber,
            })
          : this.i18n.replacementRulesStoreIssue,
        value: "issue",
      });
    }
    return options;
  }

  get storeHelp() {
    return this.draft.store === "issue"
      ? this.i18n.replacementRulesStoreIssueHelp
      : this.i18n.replacementRulesStoreFileHelp;
  }

  get storeLayer() {
    return this.draft.store.startsWith("branch:") ? "branch" : this.draft.store;
  }

  get storeBranch() {
    return this.draft.store.startsWith("branch:")
      ? this.draft.store.slice("branch:".length)
      : "";
  }

  // --- Value ---

  get valueModes() {
    const modes = [];
    if (this.isOverride) {
      modes.push({ mode: "inherit", labelKey: "replacementRulesValueInherit" });
    }
    modes.push(
      { mode: "value", labelKey: "replacementRulesValueSame" },
      { mode: "values", labelKey: "replacementRulesValuePerOrg" },
    );
    // sfdx-hardis never reads a secret from the issue: its rules reach the deployments without review
    if (this.storeLayer !== "issue") {
      modes.push({ mode: "secret", labelKey: "replacementRulesValueSecret" });
    }
    return modes.map((item) => ({
      ...item,
      label: this.i18n[item.labelKey],
      segClass:
        this.draft.valueMode === item.mode ? "hardis-seg on" : "hardis-seg",
      ariaPressed: this.draft.valueMode === item.mode ? "true" : "false",
    }));
  }

  // Removing one user permission from a Profile is the most common removal: the example shows it
  get xmlPathPlaceholder() {
    return this.isRemove
      ? "Profile/userPermissions[name=ViewSetup]"
      : "NamedCredential/endpoint";
  }

  get isSingleValue() {
    return this.draft.valueMode === "value";
  }

  get isPerOrg() {
    return this.draft.valueMode === "values";
  }

  get isSecret() {
    return this.draft.valueMode === "secret";
  }

  // Each major branch, the targets the rule already names, then the default
  get orgValueRows() {
    const targets = [...(this.majorBranches || [])];
    for (const target of Object.keys(this.draft.values)) {
      if (target !== DEFAULT_TARGET && !targets.includes(target)) {
        targets.push(target);
      }
    }
    targets.push(DEFAULT_TARGET);
    return targets.map((target) => ({
      key: target,
      target,
      label:
        target === DEFAULT_TARGET
          ? this.i18n.replacementRulesDefaultValueLabel
          : target,
      placeholder:
        target === DEFAULT_TARGET
          ? this.i18n.replacementRulesDefaultValuePlaceholder
          : this.i18n.replacementRulesOrgValuePlaceholder,
      value: this.draft.values[target] || "",
    }));
  }

  // The variables sfdx-hardis reads for this secret, when it already described them
  get secretLookupRows() {
    const lookups = (this.secretLookups || {})[this.draft.secret] || [];
    return lookups.map((lookup) => ({
      key: lookup.target,
      target:
        lookup.target === DEFAULT_TARGET
          ? this.i18n.replacementRulesDefaultTarget
          : lookup.target,
      variables: lookup.variables.join(", "),
    }));
  }

  get hasSecretLookupRows() {
    return this.secretLookupRows.length > 0;
  }

  // --- Orgs ---

  get orgsModeOptions() {
    return [
      { label: this.i18n.replacementRulesAllOrgs, value: "all" },
      { label: this.i18n.replacementRulesOrgsInclude, value: "include" },
      { label: this.i18n.replacementRulesOrgsExclude, value: "exclude" },
    ];
  }

  get showOrgsPicker() {
    return this.draft.orgsMode !== "all";
  }

  get orgOptions() {
    return (this.majorBranches || []).map((branch) => ({
      label: branch,
      value: branch,
    }));
  }

  // --- Footer ---

  get commandLines() {
    const layer = this.storeLayer;
    const branchFlag =
      layer === "branch" ? ` --branch ${this.storeBranch}` : "";
    const original = this.definition;
    const moved =
      !this.isCreate &&
      !!original &&
      (original.layer !== layer ||
        (layer === "branch" && original.branch !== this.storeBranch));
    const id = this.draft.id || "<id>";
    const lines = [];
    if (this.isCreate || moved) {
      lines.push(
        `sf hardis:project:replacement:create --agent --layer ${layer}${branchFlag} --rule-file <${id}.json>`,
      );
    } else {
      lines.push(
        `sf hardis:project:replacement:update --agent --layer ${layer}${branchFlag} --id ${id} --rule-file <${id}.json>`,
      );
    }
    if (moved) {
      const originalBranchFlag =
        original.layer === "branch" ? ` --branch ${original.branch}` : "";
      lines.push(
        `sf hardis:project:replacement:delete --agent --layer ${original.layer}${originalBranchFlag} --id ${id}`,
      );
    }
    return lines.map((text, index) => ({ key: `line-${index}`, text }));
  }

  get shownError() {
    return this.validationError || this.errorMessage || "";
  }

  get hasError() {
    return this.shownError !== "";
  }

  get saveLabel() {
    return this.saving
      ? this.i18n.replacementRulesSaving
      : this.i18n.replacementRulesSaveRule;
  }

  // --- Handlers ---

  handleClose() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  handleTypeClick(event) {
    const type = event.currentTarget.dataset.type;
    if (!type || type === this.draft.type) {
      return;
    }
    const draft = { ...this.draft, type, typeChanged: true };
    if (
      type !== "xml-remove" &&
      draft.valueMode === "inherit" &&
      !this.isOverride
    ) {
      draft.valueMode = "values";
    }
    this.draft = draft;
  }

  handleTypeKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  handleFieldChange(event) {
    const field = event.target.dataset.field;
    const value =
      event.target.type === "checkbox" || event.target.type === "toggle"
        ? event.target.checked
        : event.detail && event.detail.value !== undefined
          ? event.detail.value
          : event.target.value;
    this.draft = { ...this.draft, [field]: value };
    this.validationError = "";
  }

  handleValueModeClick(event) {
    this.draft = { ...this.draft, valueMode: event.currentTarget.dataset.mode };
  }

  handleOrgValueChange(event) {
    const target = event.target.dataset.target;
    const values = { ...this.draft.values };
    const value =
      event.detail && event.detail.value !== undefined
        ? event.detail.value
        : event.target.value;
    if (value) {
      values[target] = value;
    } else {
      delete values[target];
    }
    this.draft = { ...this.draft, values };
  }

  handleOrgsChange(event) {
    this.draft = { ...this.draft, orgs: event.detail.value || [] };
  }

  handleSave() {
    if (this.saving) {
      return;
    }
    const error = this.validate();
    if (error) {
      this.validationError = error;
      return;
    }
    this.validationError = "";
    this.dispatchEvent(
      new CustomEvent("save", {
        detail: {
          rule: this.buildRule(),
          layer: this.storeLayer,
          branch: this.storeBranch,
        },
      }),
    );
  }

  // --- Validation and output ---

  // The checks sfdx-hardis makes too, so that most mistakes are told before the command runs
  validate() {
    const draft = this.draft;
    if (!RULE_ID_PATTERN.test(draft.id.trim())) {
      return this.i18n.replacementRulesIdInvalid;
    }
    if (this.storeLayer === "branch" && !this.storeBranch) {
      return this.i18n.replacementRulesInvalidBranch;
    }
    if (
      draft.valueMode === "secret" &&
      !this.isRemove &&
      this.storeLayer === "issue"
    ) {
      return this.i18n.replacementRulesSecretNotInIssue;
    }
    if (
      draft.valueMode === "secret" &&
      !this.isRemove &&
      !SECRET_NAME_PATTERN.test(draft.secret.trim())
    ) {
      return this.i18n.replacementRulesSecretInvalid;
    }
    if (draft.orgsMode !== "all" && draft.orgs.length === 0) {
      return this.i18n.replacementRulesOrgsRequired;
    }
    if (this.isOverride) {
      return "";
    }
    if (fileList(draft.filesText).length === 0) {
      return this.i18n.replacementRulesFilesRequired;
    }
    if (draft.type === "text" && draft.find.trim() === "") {
      return this.i18n.replacementRulesFindRequired;
    }
    if (draft.type !== "text" && draft.xmlPath.trim() === "") {
      return this.i18n.replacementRulesXmlPathRequired;
    }
    if (!this.isRemove) {
      if (draft.valueMode === "value" && draft.value === "") {
        return this.i18n.replacementRulesValueRequired;
      }
      if (
        draft.valueMode === "values" &&
        Object.keys(draft.values).length === 0
      ) {
        return this.i18n.replacementRulesValueRequired;
      }
    }
    return "";
  }

  // The rule as the place stores it: empty fields are left out, and an override only writes
  // the type when it was changed here
  buildRule() {
    const draft = this.draft;
    const rule = { id: draft.id.trim() };
    if (draft.description.trim()) {
      rule.description = draft.description.trim();
    }
    if (typeof draft.enabled === "boolean") {
      rule.enabled = draft.enabled;
    }
    const definitionType =
      this.definition && this.definition.rule ? this.definition.rule.type : "";
    if (!this.isOverride || definitionType || draft.typeChanged) {
      rule.type = draft.type;
    }
    const files = fileList(draft.filesText);
    if (files.length > 0) {
      rule.files = files.length === 1 ? files[0] : files;
    }
    if (draft.type === "text") {
      if (draft.find.trim() !== "") {
        rule.find = draft.find;
        if (draft.regex) {
          rule.regex = true;
        }
      }
    } else if (draft.xmlPath.trim()) {
      rule.xmlPath = draft.xmlPath.trim();
    }
    if (draft.type !== "xml-remove") {
      if (draft.valueMode === "value" && draft.value !== "") {
        rule.value = draft.value;
      } else if (
        draft.valueMode === "values" &&
        Object.keys(draft.values).length > 0
      ) {
        rule.values = { ...draft.values };
      } else if (draft.valueMode === "secret" && draft.secret.trim()) {
        rule.secret = draft.secret.trim();
      }
    }
    if (draft.orgsMode === "include" && draft.orgs.length > 0) {
      rule.includeTargetBranches = [...draft.orgs];
    } else if (draft.orgsMode === "exclude" && draft.orgs.length > 0) {
      rule.excludeTargetBranches = [...draft.orgs];
    }
    if (draft.required) {
      rule.required = true;
    }
    return rule;
  }
}

function asList(files) {
  if (Array.isArray(files)) {
    return files;
  }
  return files ? [files] : [];
}

// One file pattern per line (a comma belongs to a pattern like **/*.{cls,trigger})
function fileList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function originLabelKey(origin) {
  if (origin === "builtin") {
    return "replacementRulesOriginBuiltIn";
  }
  if (origin === "branch") {
    return "replacementRulesLayerBranch";
  }
  if (origin === "issue") {
    return "replacementRulesLayerIssue";
  }
  return "replacementRulesLayerProject";
}
