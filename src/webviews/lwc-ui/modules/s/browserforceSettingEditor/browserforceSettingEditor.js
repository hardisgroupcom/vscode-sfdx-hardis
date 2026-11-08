/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import {
  addGroupItem,
  buildFormSections,
  configToFormModel,
  defaultConfigOf,
  findDeprecatedSetting,
  formModelToConfig,
  listSelectableSettings,
  listVariableNames,
  removeGroupItem,
  setEntryName,
  updateFieldState,
} from "s/browserforceFormUtils";

/**
 * Editor of the value of a "browser" deployment action: one Browserforce setting and its value.
 *
 * The setting list and the form come from the Browserforce catalog the extension reads
 * (sf browserforce plugins list). A value written ${NAME} is a CI/CD variable sfdx-hardis resolves
 * for the target branch: a password is always one, any other field can be one ("Use ENV variable").
 * The editor only emits the setting and its value (settingchange); the deployment action editor
 * stores them, and asks the extension to check them (checkvalue). It never installs Browserforce:
 * when the plugin is missing, it sends the user to the SFDX Hardis Setup panel, which installs it.
 */

// Entry name patterns said in words; any other pattern is shown as it is
const KNOWN_NAME_PATTERNS = {
  "^[a-zA-Z0-9_]+$": "browserforcePatternLettersDigitsUnderscore",
  "^[A-Za-z0-9_]+$": "browserforcePatternLettersDigitsUnderscore",
  "^\\w+$": "browserforcePatternLettersDigitsUnderscore",
  "^[a-zA-Z0-9]+$": "browserforcePatternLettersDigits",
  "^[A-Za-z0-9]+$": "browserforcePatternLettersDigits",
  "^[a-zA-Z_][a-zA-Z0-9_]*$": "browserforcePatternIdentifier",
  "^[A-Za-z_][A-Za-z0-9_]*$": "browserforcePatternIdentifier",
};

// Sentence telling how to fill a field the catalog does not describe, by typeHelp code
const TYPE_HELP_KEYS = {
  boolean: "browserforceHelpBoolean",
  enum: "browserforceHelpEnum",
  integer: "browserforceHelpInteger",
  json: "browserforceHelpJson",
  list: "browserforceHelpList",
  number: "browserforceHelpNumber",
  password: "browserforceHelpPassword",
  text: "browserforceHelpText",
};

const ERROR_LABEL_KEYS = {
  invalidNumber: "browserforceErrorInvalidNumber",
  invalidJson: "browserforceErrorInvalidJson",
  invalidVariableName: "browserforceErrorInvalidVariableName",
  missingEntryName: "browserforceErrorMissingEntryName",
  invalidEntryName: "browserforceErrorInvalidEntryName",
  duplicateEntryName: "browserforceErrorDuplicateEntryName",
};

export default class BrowserforceSettingEditor extends SharedMixin(
  LightningElement,
) {
  @api readOnly = false;
  @api catalogLoading = false;
  @api validating = false;
  @api validation = null;

  @track model = null;
  @track formErrors = [];
  @track jsonMode = false;
  @track jsonText = "{}";
  @track jsonError = "";
  // Why Edit as JSON was refused (fields of the form in error)
  @track jsonSwitchError = "";
  _setting = "";
  _config = {};
  _configJson = "{}";
  _catalogState = null;
  // JSON of the catalog the form model was built from
  _catalogJson = "null";

  @api
  set setting(val) {
    const next = typeof val === "string" ? val : "";
    if (next === this._setting) {
      return;
    }
    this._setting = next;
    this._rebuildModel();
  }
  get setting() {
    return this._setting;
  }

  // The value comes back from the parent after each change: an echo of what was emitted is ignored,
  // so the form keeps what is being typed
  @api
  set config(val) {
    const json = JSON.stringify(val === undefined ? {} : val);
    if (json === this._configJson) {
      return;
    }
    this._config = JSON.parse(json);
    this._configJson = json;
    this.jsonText = JSON.stringify(this._config, null, 2);
    this.jsonError = "";
    this._rebuildModel();
  }
  get config() {
    return this._config;
  }

  // The extension answers twice when the CI/CD variable names arrive after the catalog: the form
  // is only rebuilt when the catalog itself changed, so what is being typed stays
  @api
  set catalogState(val) {
    this._catalogState = val || null;
    const catalogJson = JSON.stringify(this._catalogState?.catalog || null);
    if (catalogJson === this._catalogJson) {
      return;
    }
    this._catalogJson = catalogJson;
    this._rebuildModel();
  }
  get catalogState() {
    return this._catalogState;
  }

  // --- Catalog state ---------------------------------------------------------

  get catalog() {
    return this._catalogState?.catalog || null;
  }

  get hasCatalog() {
    return Array.isArray(this.catalog?.plugins);
  }

  get showCatalogLoading() {
    return this.catalogLoading === true && !this.hasCatalog;
  }

  get showNotInstalled() {
    return !this.catalogLoading && this._catalogState?.notInstalled === true;
  }

  get notInstalledText() {
    if (this._catalogState?.outdated) {
      return this.t("browserforceOutdated", {
        version: this._catalogState.installedVersion || "",
        minimum: this._catalogState.minimumVersion || "",
      });
    }
    return this.t("browserforceNotInstalled");
  }

  get showCatalogError() {
    return (
      !this.catalogLoading && !!this._catalogState?.error && !this.hasCatalog
    );
  }

  get catalogErrorText() {
    return this.t("browserforceCatalogError", {
      message: this._catalogState?.error || "",
    });
  }

  // --- Setting ---------------------------------------------------------------

  get entry() {
    if (!this.hasCatalog || !this._setting) {
      return null;
    }
    return (
      this.catalog.plugins.find((plugin) => plugin.key === this._setting) ||
      null
    );
  }

  // While the catalog loads, the picker is shown disabled, the loading text inside it
  get showSettingPicker() {
    return !this.readOnly && (this.hasCatalog || this.showCatalogLoading);
  }

  get settingPickerDisabled() {
    return this.inputsDisabled || this.showCatalogLoading;
  }

  // Empty while the catalog loads, so the picker shows its loading placeholder
  get settingPickerValue() {
    return this.showCatalogLoading ? "" : this._setting;
  }

  get settingPickerPlaceholder() {
    return this.showCatalogLoading
      ? this.i18n.browserforceCatalogLoading
      : this.i18n.browserforceSettingPlaceholder;
  }

  // Without a catalog, the key is typed and the value edited as JSON
  get showSettingKeyInput() {
    return !this.readOnly && !this.hasCatalog && !this.showCatalogLoading;
  }

  get settingOptions() {
    const options = listSelectableSettings(this.catalog).map((plugin) => ({
      label: plugin.title ? `${plugin.title} (${plugin.key})` : plugin.key,
      value: plugin.key,
    }));
    // A removed or unknown setting stays displayed: the action holds it
    if (
      this._setting &&
      !options.some((option) => option.value === this._setting)
    ) {
      options.unshift({ label: this._setting, value: this._setting });
    }
    return options;
  }

  get settingTitle() {
    const entry = this.entry;
    if (entry?.title) {
      return `${entry.title} (${entry.key})`;
    }
    return this._setting || this.t("browserforceNoSetting");
  }

  // The panel of the setting, its value and its check: once a setting is chosen and the catalog
  // is there to describe it
  get showValuePanel() {
    return !!this._setting && !this.showCatalogLoading;
  }

  // Title and description of the selected setting, above its warnings
  get showSettingHead() {
    return !!this.entry;
  }

  get settingHeadTitle() {
    return this.entry?.title || this._setting;
  }

  get settingDescription() {
    return this.entry?.description || "";
  }

  get hasSettingDescription() {
    return !!this.settingDescription;
  }

  get deprecatedText() {
    const deprecated = findDeprecatedSetting(this.catalog, this._setting);
    if (!deprecated) {
      return "";
    }
    const text = this.t("browserforceSettingDeprecated", {
      message: deprecated.message || "",
    });
    return deprecated.alternatives
      ? `${text} ${this.t("browserforceSettingAlternatives", { alternatives: deprecated.alternatives })}`
      : text;
  }

  get hasDeprecatedText() {
    return !!this.deprecatedText;
  }

  get showUnknownSetting() {
    return (
      this.hasCatalog &&
      !!this._setting &&
      !this.entry &&
      !this.hasDeprecatedText
    );
  }

  get unknownSettingText() {
    return this.t("browserforceUnknownSetting", {
      setting: this._setting,
      version: this.catalog?.browserforceVersion || "",
    });
  }

  get warnings() {
    const entry = this.entry;
    if (!entry?.warnings) {
      return [];
    }
    const warnings = [];
    const irreversible = entry.warnings.irreversibleFields || [];
    if (irreversible.length > 0) {
      const titles = irreversible.map((path) => {
        const field = (entry.fields || []).find((item) => item.path === path);
        return field?.title || path;
      });
      warnings.push({
        key: "irreversible",
        text: this.t("browserforceWarningIrreversible", {
          fields: titles.join(", "),
        }),
      });
    }
    if (entry.warnings.userInterface === "classic") {
      warnings.push({
        key: "classic",
        text: this.t("browserforceWarningClassicOnly"),
      });
    } else if (entry.warnings.userInterface === "lightning") {
      warnings.push({
        key: "lightning",
        text: this.t("browserforceWarningLightningOnly"),
      });
    }
    const prerequisites = entry.warnings.prerequisites || [];
    if (prerequisites.length > 0) {
      warnings.push({
        key: "prerequisites",
        text: this.t("browserforceWarningPrerequisites", {
          prerequisites: prerequisites.join(", "),
        }),
      });
    }
    return warnings;
  }

  get hasWarnings() {
    return this.warnings.length > 0;
  }

  // --- Value -------------------------------------------------------------------

  get showForm() {
    return !this.readOnly && !!this.entry && !this.jsonMode && !!this.model;
  }

  // Nothing to edit while the catalog loads: the form or the JSON comes with it
  get showJsonEditor() {
    return (
      !this.readOnly &&
      !this.showCatalogLoading &&
      !!this._setting &&
      (this.jsonMode || !this.entry)
    );
  }

  get showJsonSwitch() {
    return !this.readOnly && !!this.entry;
  }

  get showReadOnlyValue() {
    return this.readOnly;
  }

  get configPretty() {
    return JSON.stringify(this._config, null, 2);
  }

  get formSections() {
    if (!this.entry || !this.model) {
      return [];
    }
    return buildFormSections(this.entry, this.model, this.formErrors).map(
      (section) => ({
        ...section,
        showSubsectionTitle: section.isSubsection && !!section.title,
        // The setting head already says it when the group is the whole setting
        hasHelp: section.hasHelp && section.help !== this.settingDescription,
        keyPatternText: this._patternText(section.keyPattern),
        // A pattern with no words for it is shown as it is, in a chip
        keyPatternChip: KNOWN_NAME_PATTERNS[section.keyPattern]
          ? ""
          : section.keyPattern,
        items: section.items.map((item) => ({
          ...item,
          title: this._itemTitle(item),
          nameErrorText: this._errorText(
            item.nameErrorCode,
            this.i18n[KNOWN_NAME_PATTERNS[section.keyPattern]] ||
              section.keyPattern,
          ),
          fields: item.fields.map((field) => this._fieldView(field)),
        })),
      }),
    );
  }

  // --- CI/CD variables ---------------------------------------------------------

  get variables() {
    const lookup = this._catalogState?.secretsLookup;
    const branches = Array.isArray(lookup?.branches) ? lookup.branches : [];
    return listVariableNames(this._config).map((name) => ({
      name,
      rows: this._lookupRows(name),
      hasRows: branches.length > 0,
    }));
  }

  get hasVariables() {
    return this.variables.length > 0;
  }

  // The form shows the names read for each variable under its field: this list is for the JSON
  // and read-only views
  get showVariablesSection() {
    return this.hasVariables && !this.showForm;
  }

  get hasSecretsLookup() {
    return Array.isArray(this._catalogState?.secretsLookup?.branches);
  }

  get variablesHelp() {
    return this.hasSecretsLookup
      ? this.t("browserforceVariablesHelp")
      : this.t("browserforceVariablesNoLookup");
  }

  get showGithubNote() {
    return this.hasVariables && this._catalogState?.gitProvider === "github";
  }

  // --- Check -------------------------------------------------------------------

  get showCheckButton() {
    return !this.readOnly && !this.showCatalogLoading && !!this._setting;
  }

  // Never checks a value other than the one the form shows: not while a field is in error. While
  // Browserforce answers, the button stays readable (spinner and label) and ignores clicks.
  get isCheckDisabled() {
    return !!this.jsonError || this.formErrors.length > 0;
  }

  // The value cannot change while Browserforce checks it
  get inputsDisabled() {
    return this.validating === true;
  }

  get showValidating() {
    return this.validating === true;
  }

  get checkButtonBusy() {
    return this.showValidating ? "true" : "false";
  }

  get checkButtonLabel() {
    return this.showValidating
      ? this.i18n.browserforceChecking
      : this.i18n.browserforceCheck;
  }

  get showValidationValid() {
    return !this.validating && this.validation?.valid === true;
  }

  get showValidationErrors() {
    return (
      !this.validating &&
      !!this.validation &&
      this.validation.valid !== true &&
      !this.validation.error
    );
  }

  get validationErrorRows() {
    const errors = Array.isArray(this.validation?.errors)
      ? this.validation.errors
      : [];
    return errors.map((error, index) => ({
      key: `${index}`,
      text: error.path ? `${error.path}: ${error.message}` : error.message,
    }));
  }

  get showValidationUnavailable() {
    return !this.validating && !!this.validation?.error;
  }

  get validationUnavailableText() {
    return this.t("browserforceCheckUnavailable", {
      message: this.validation?.error || "",
    });
  }

  // --- Handlers ------------------------------------------------------------------

  // A new setting starts from its first example, so the form opens on a usable value
  handleSettingSelect(event) {
    const key = event.detail?.value || "";
    if (key === this._setting) {
      return;
    }
    this._setting = key;
    const entry = this.entry;
    this._setConfig(entry ? defaultConfigOf(entry) : {});
    this.jsonMode = false;
    this._rebuildModel();
    this._emitChange(false);
  }

  handleSettingKeyChange(event) {
    this._setting = String(event.target.value || "").trim();
    this._rebuildModel();
    this._emitChange(!!this.jsonError);
  }

  handleTextChange(event) {
    this._applyModel(
      updateFieldState(this.model, event.target.dataset.key, {
        text: event.detail?.value ?? event.target.value ?? "",
      }),
    );
  }

  handleBooleanChange(event) {
    this._applyModel(
      updateFieldState(this.model, event.target.dataset.key, {
        checked: event.target.checked === true,
        present: true,
      }),
    );
  }

  // An optional boolean goes back to "not set": the org keeps what it has
  handleClearValue(event) {
    this._applyModel(
      updateFieldState(this.model, event.currentTarget.dataset.key, {
        checked: false,
        present: false,
      }),
    );
  }

  // Turned on, the variable name starts from the suggested one when none was typed before
  handleVariableToggle(event) {
    const { key, variable, suggested, current } = event.currentTarget.dataset;
    const turnOn = variable !== "true";
    const patch = { isVariable: turnOn };
    if (turnOn && !current) {
      patch.variable = suggested || "";
      patch.variableAuto = true;
    }
    this._applyModel(updateFieldState(this.model, key, patch));
  }

  // Environment variable names are written in capitals: the name is uppercased as it is typed
  handleVariableNameChange(event) {
    const name = String(event.target.value || "")
      .toUpperCase()
      .trim()
      .replace(/[\s-]+/g, "_");
    if (event.target.value !== name) {
      event.target.value = name;
    }
    this._applyModel(
      updateFieldState(this.model, event.target.dataset.key, {
        variable: name,
        variableAuto: false,
      }),
    );
  }

  handleEntryNameChange(event) {
    const { groupPath, index } = event.target.dataset;
    this._applyModel(
      setEntryName(
        this.model,
        groupPath,
        Number(index),
        event.target.value || "",
        this.entry,
      ),
    );
  }

  handleAddItem(event) {
    this._applyModel(
      addGroupItem(
        this.entry,
        this.model,
        event.currentTarget.dataset.groupPath,
      ),
    );
  }

  handleRemoveItem(event) {
    const { groupPath, index } = event.currentTarget.dataset;
    this._applyModel(
      removeGroupItem(this.model, groupPath, Number(index), this.entry),
    );
  }

  // To JSON only from a form without errors, as the JSON shows the value the form holds; back to
  // the form only with a JSON that parses, as the form is built from it. The parent is told the
  // error state after each switch.
  handleJsonModeToggle(event) {
    const checked = event.target.checked === true;
    if (checked) {
      if (this.formErrors.length > 0) {
        event.target.checked = false;
        this.jsonSwitchError = this.t("browserforceFixFormBeforeJson");
        return;
      }
      this.jsonSwitchError = "";
      this.jsonText = JSON.stringify(this._config, null, 2);
      this.jsonError = "";
      this.jsonMode = true;
      this._emitChange(this._hasErrors());
      return;
    }
    if (this.jsonError) {
      event.target.checked = true;
      return;
    }
    this.jsonMode = false;
    this._rebuildModel();
    this._emitChange(this._hasErrors());
  }

  handleJsonChange(event) {
    const text = event.target.value || "";
    this.jsonText = text;
    try {
      const parsed = JSON.parse(text.trim() === "" ? "{}" : text);
      this.jsonError = "";
      this._setConfig(parsed);
      this._emitChange(false);
    } catch (error) {
      this.jsonError = this.t("browserforceInvalidJson", {
        message: error?.message || "",
      });
      this._emitChange(true);
    }
  }

  handleCheck() {
    if (this.validating === true) {
      return;
    }
    this.dispatchEvent(new CustomEvent("checkvalue"));
  }

  // The SFDX Hardis Setup panel lists the dependencies and installs or updates Browserforce
  handleOpenSetup() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "vscode-sfdx-hardis.showSetup" },
    });
  }

  handleReloadCatalog() {
    this.dispatchEvent(new CustomEvent("reloadcatalog"));
  }

  // --- Private -------------------------------------------------------------------

  // A rebuilt form has no field in error: the parent is told when it had some. Told after the
  // current update, as a property set by the parent while it renders also rebuilds the form.
  _rebuildModel() {
    const entry = this.entry;
    this.model = entry ? configToFormModel(entry, this._config) : null;
    const hadFormErrors = this.formErrors.length > 0;
    this.formErrors = [];
    this.jsonSwitchError = "";
    if (hadFormErrors) {
      Promise.resolve().then(() => this._emitChange(this._hasErrors()));
    }
  }

  _applyModel(model) {
    if (!model) {
      return;
    }
    this.model = model;
    const { config, errors } = formModelToConfig(this.entry, model);
    this.formErrors = errors;
    if (errors.length === 0) {
      this.jsonSwitchError = "";
    }
    this._setConfig(config);
    this._emitChange(this._hasErrors());
  }

  _hasErrors() {
    return !!this.jsonError || this.formErrors.length > 0;
  }

  _setConfig(config) {
    this._config = config === undefined ? {} : config;
    this._configJson = JSON.stringify(this._config);
  }

  _emitChange(hasErrors) {
    this.dispatchEvent(
      new CustomEvent("settingchange", {
        detail: {
          setting: this._setting,
          config: JSON.parse(this._configJson),
          hasErrors: hasErrors === true,
        },
      }),
    );
  }

  // "Item 2: Customer" when the item holds a text, "Item 2" otherwise; an entry keyed by name
  // shows its name
  _itemTitle(item) {
    if (item.isRecordEntry) {
      return item.name || this.t("browserforceNewEntry");
    }
    const title = this.t("browserforceItemNumber", { number: item.number });
    return item.summary ? `${title}: ${item.summary}` : title;
  }

  // What the template shows for a field, from what the form utils describe
  _fieldView(field) {
    const notSet = this.i18n.browserforceNotSet;
    return {
      ...field,
      label: field.label || this.i18n.browserforceValueLabel,
      helpText: this._fieldHelp(field),
      options: field.options.map((option) =>
        option.value === "" ? { ...option, label: notSet } : option,
      ),
      // A boolean nobody set says so on both sides of the toggle
      toggleActiveText: field.isSet ? this.i18n.browserforceToggleOn : notSet,
      toggleInactiveText: field.isSet
        ? this.i18n.browserforceToggleOff
        : notSet,
      variableSwitchLabel: field.isVariable
        ? this.i18n.browserforceUseFixedValue
        : this.i18n.browserforceUseEnvVariable,
      variableSwitchIcon: field.isVariable ? "utility:edit" : "utility:variable",
      variableState: field.isVariable ? "true" : "false",
      // A value read from a variable takes the whole row: the names read per org need room
      rowClass: field.isVariable ? "hardis-field-row stacked" : field.rowClass,
      lookupRows: field.hasVariableName
        ? this._lookupRows(field.variableName.trim())
        : [],
      hasLookupRows: field.hasVariableName && this.hasSecretsLookup,
      showNoLookup: field.hasVariableName && !this.hasSecretsLookup,
      errorText: this._errorText(field.errorCode, ""),
    };
  }

  // Help icon of a field: the catalog description, or how to fill a field of its type, then its
  // example, then what an empty value does. HTML: the help icon renders rich text.
  _fieldHelp(field) {
    const lines = [
      escapeHtml(
        field.description || this.i18n[TYPE_HELP_KEYS[field.typeHelp]] || "",
      ),
    ];
    if (field.example) {
      lines.push(
        this.t("browserforceHelpExample", {
          example: escapeHtml(field.example),
        }),
      );
    }
    if (!field.required && !field.isPassword) {
      lines.push(
        field.isBoolean
          ? this.i18n.browserforceHelpOptionalBoolean
          : this.i18n.browserforceHelpOptional,
      );
    }
    return lines.filter((line) => !!line).join("<br/>");
  }

  // "Allowed: letters, digits and _ only" for a known entry name pattern, the sentence that
  // introduces the pattern chip otherwise
  _patternText(pattern) {
    if (!pattern) {
      return "";
    }
    const knownKey = KNOWN_NAME_PATTERNS[pattern];
    return knownKey ? this.i18n[knownKey] : this.i18n.browserforceEntryNameMustMatch;
  }

  // The names sfdx-hardis reads for a variable: one row per major branch with the names of its
  // own, then one row for the name any org without its own variable reads (developer sandboxes
  // included). Names differing only by case are one name for whoever declares them: the one in
  // capitals is shown.
  _lookupRows(name) {
    const lookup = this._catalogState?.secretsLookup;
    const branches = Array.isArray(lookup?.branches) ? lookup.branches : [];
    const fallback = name.toUpperCase();
    let hasFallback = false;
    const rows = [];
    for (const branch of branches) {
      const names = [];
      for (const pattern of branch.names || []) {
        const variableName = String(pattern).replace(/\{NAME\}/g, name);
        if (variableName.toUpperCase() === fallback) {
          hasFallback = true;
          continue;
        }
        const sameName = names.findIndex(
          (known) => known.toUpperCase() === variableName.toUpperCase(),
        );
        if (sameName === -1) {
          names.push(variableName);
        } else if (variableName === variableName.toUpperCase()) {
          names[sameName] = variableName;
        }
      }
      if (names.length > 0) {
        rows.push(
          this._lookupRow(
            branch.branch,
            branch.branch === "dev-sandboxes"
              ? this.t("devSandboxesOption")
              : branch.branch,
            names,
            false,
          ),
        );
      }
    }
    if (hasFallback) {
      rows.push(
        this._lookupRow("*", this.i18n.browserforceAnyOtherOrg, [name], true),
      );
    }
    return rows;
  }

  _lookupRow(branchKey, label, names, isFallback) {
    return {
      key: `${names[0]}-${branchKey}`,
      branch: label,
      branchClass: isFallback
        ? "muted bfe-lookup-branch bfe-lookup-other"
        : "hardis-chip bfe-lookup-branch",
      names: names.map((variableName, index) => ({
        key: `${branchKey}-${variableName}`,
        name: variableName,
        showThen: index > 0,
      })),
    };
  }

  _errorText(code, pattern) {
    if (!code || !ERROR_LABEL_KEYS[code]) {
      return "";
    }
    return this.t(ERROR_LABEL_KEYS[code], { pattern: pattern || "" });
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
