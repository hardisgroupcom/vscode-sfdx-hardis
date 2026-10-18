/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getPillClass } from "s/pillUtils";
import {
  makeColumnsSortable,
  sortDatatableRows,
  sortStateFromEvent,
} from "s/datatableSortUtils";

/**
 * Replacement Rules panel.
 *
 * It draws what `sf hardis:project:replacement:list --json` answers, as the extension sends it,
 * and asks the extension to change a rule: the extension runs
 * `sf hardis:project:replacement:create|update|delete --agent`. Nothing here writes a
 * configuration file, and no secret value ever comes to this component: only the names of the
 * CI/CD variables a secret is read from.
 */

// Label key and pill hue of each kind of rule
const TYPE_INFO = {
  "xml-value": { labelKey: "replacementRulesTypeXmlValue", hue: "blue" },
  "xml-remove": { labelKey: "replacementRulesTypeXmlRemove", hue: "amber" },
  text: { labelKey: "replacementRulesTypeText", hue: "teal" },
};

// Label key of each place a rule is stored in, or comes from
const ORIGIN_LABEL_KEYS = {
  builtin: "replacementRulesOriginBuiltIn",
  project: "replacementRulesLayerProject",
  branch: "replacementRulesLayerBranch",
  issue: "replacementRulesLayerIssue",
};

// Label key and status pill of each result of a preview
const PREVIEW_STATUS_INFO = {
  changed: { labelKey: "replacementRulesStatusChanged", status: "success" },
  unchanged: { labelKey: "replacementRulesStatusUnchanged", status: "unknown" },
  "not-found": {
    labelKey: "replacementRulesStatusNotFound",
    status: "pending",
  },
  "secret-missing": {
    labelKey: "replacementRulesStatusSecretMissing",
    status: "failed",
  },
  "no-value": { labelKey: "replacementRulesStatusNoValue", status: "pending" },
  disabled: { labelKey: "replacementRulesStatusDisabled", status: "unknown" },
  "risky-element": {
    labelKey: "replacementRulesStatusRiskyElement",
    status: "failed",
  },
};

const DEFAULT_TARGET = "default";
const PREVIEW_COMMAND = "sf hardis:project:replacement:preview --agent";

let requestCounter = 0;

export default class ReplacementRules extends SharedMixin(LightningElement) {
  loading = true;
  data = null;
  readAt = null;
  minimalCliVersion = "";
  error = null;
  busy = false;
  preview = { running: false, targetBranch: "", result: null, error: null };

  activeTab = "rules";
  filterText = "";
  layerFilter = "all";
  previewTarget = "";

  // Rule editor: the definition edited, null for a new rule
  showEditor = false;
  editorIsCreate = false;
  editorDefinition = null;
  editorSaving = false;
  editorError = "";
  editorRequestId = "";

  // Rule waiting for the confirmation of its deletion
  deleteTarget = null;

  @api
  initialize(data) {
    this.applyState(data || {});
  }

  @api
  handleMessage(type, data) {
    if (type === "state") {
      this.applyState(data || {});
    } else if (type === "replacementWriteDone") {
      this.handleWriteDone(data || {});
    }
  }

  // --- States ---

  get hasData() {
    return !!this.data;
  }

  // First reading: nothing to show yet
  get showLoading() {
    return this.loading && !this.hasData;
  }

  // The last rules read stay on screen while sfdx-hardis reads them again
  get isRefreshing() {
    return this.loading && this.hasData;
  }

  get showCliTooOld() {
    return !this.loading && !!this.error && this.error.kind === "cliTooOld";
  }

  get showErrorState() {
    return (
      !this.loading &&
      !!this.error &&
      this.error.kind !== "cliTooOld" &&
      !this.hasData
    );
  }

  // A reading failed after a successful one: the rules read before stay, under the error
  get showErrorNote() {
    return (
      !this.loading &&
      !!this.error &&
      this.error.kind !== "cliTooOld" &&
      this.hasData
    );
  }

  get showContent() {
    return this.hasData && !this.showCliTooOld;
  }

  get errorMessage() {
    return (
      (this.error && this.error.message) ||
      this.i18n.replacementRulesUnknownError
    );
  }

  get cliTooOldDescription() {
    return this.t("replacementRulesOldCliDesc", {
      version: this.minimalCliVersion,
    });
  }

  get refreshDisabled() {
    return this.loading;
  }

  get newRuleDisabled() {
    return !this.hasData || this.busy;
  }

  // --- Status cards ---

  get statusCards() {
    if (!this.data) {
      return [];
    }
    const layers = this.data.layers;
    const branchesWithRules = layers.branches.filter(
      (branch) => branch.count > 0,
    );
    const cards = [
      {
        key: "project",
        cardClass: "hardis-status-card info",
        tileClass: "hardis-tile slate",
        icon: "utility:file",
        title: this.i18n.replacementRulesLayerProject,
        meta: layers.project.file,
        desc: this.t("replacementRulesRuleCount", {
          count: layers.project.count,
        }),
        hasAction: false,
      },
      {
        key: "branches",
        cardClass: "hardis-status-card info",
        tileClass: "hardis-tile violet",
        icon: "utility:hierarchy",
        title: this.i18n.replacementRulesBranchFilesTitle,
        meta: "config/branches/",
        desc:
          branchesWithRules.length > 0
            ? branchesWithRules
                .map((branch) =>
                  this.t("replacementRulesBranchCount", {
                    branch: branch.branch,
                    count: branch.count,
                  }),
                )
                .join(", ")
            : this.i18n.replacementRulesNoBranchRules,
        hasAction: false,
      },
      this.buildIssueCard(layers.issue),
      {
        key: "secrets",
        cardClass: "hardis-status-card ok",
        tileClass: "hardis-tile green",
        icon: "utility:lock",
        title: this.i18n.replacementRulesSecretsTitle,
        meta: "",
        desc: this.i18n.replacementRulesSecretsDesc,
        hasAction: false,
      },
    ];
    return cards.map((card) => ({ ...card, hasMeta: !!card.meta }));
  }

  buildIssueCard(issue) {
    if (!issue.available) {
      return {
        key: "issue",
        cardClass: "hardis-status-card warning",
        tileClass: "hardis-tile amber",
        icon: "utility:comments",
        title: this.i18n.replacementRulesLayerIssue,
        meta: "",
        desc: issue.error || this.i18n.replacementRulesIssueUnavailable,
        hasAction: true,
        action: "connectToGit",
        actionLabel: this.i18n.connectToGit,
        actionClass: "hardis-btn-tinted-amber",
      };
    }
    return {
      key: "issue",
      cardClass: "hardis-status-card info",
      tileClass: "hardis-tile amber",
      icon: "utility:comments",
      title: this.issueLabel,
      meta: "",
      desc: issue.number
        ? this.t("replacementRulesIssueCount", { count: issue.count })
        : this.i18n.replacementRulesIssueNotCreated,
      hasAction: !!issue.url,
      action: "openIssue",
      actionUrl: issue.url,
      actionLabel: this.i18n.replacementRulesOpenIssue,
      actionClass: "",
    };
  }

  get issueLabel() {
    const issue = this.data && this.data.layers.issue;
    return issue && issue.number
      ? this.t("replacementRulesIssueNumbered", { number: issue.number })
      : this.i18n.replacementRulesLayerIssue;
  }

  get issueAvailable() {
    return !!(this.data && this.data.layers.issue.available);
  }

  get hasInvalidRules() {
    return this.invalidRules.length > 0;
  }

  get invalidRules() {
    return ((this.data && this.data.issues) || []).map((issue, index) => ({
      key: `${issue.ruleId}-${index}`,
      text: issue.ruleId
        ? this.t("replacementRulesInvalidRule", {
            id: issue.ruleId,
            place: this.placeLabel(issue.layer, issue.branch),
            message: issue.message,
          })
        : issue.message,
    }));
  }

  // --- Tabs ---

  get rulesTabLabel() {
    return this.t("replacementRulesTabRules", {
      count: this.data ? this.data.definitions.length : 0,
    });
  }

  get builtInTabLabel() {
    return this.t("replacementRulesTabBuiltIn", {
      count: this.data ? this.data.builtInRules.length : 0,
    });
  }

  // --- Rules tab ---

  get layerFilterOptions() {
    return [
      { label: this.i18n.replacementRulesAllPlaces, value: "all" },
      { label: this.i18n.replacementRulesLayerProject, value: "project" },
      { label: this.i18n.replacementRulesBranchFilesTitle, value: "branch" },
      { label: this.i18n.replacementRulesLayerIssue, value: "issue" },
    ];
  }

  // --- Sorting: a click on a column header sorts the table, a second click reverses it ---

  // Column and direction of each table, kept while the panel is open
  sorts = {
    rules: { fieldName: null, direction: "asc" },
    values: { fieldName: null, direction: "asc" },
    builtin: { fieldName: null, direction: "asc" },
    preview: { fieldName: null, direction: "asc" },
  };

  handleTableSort(event) {
    const table = event.currentTarget?.dataset?.table;
    if (!table || !this.sorts[table]) {
      return;
    }
    this.sorts = { ...this.sorts, [table]: sortStateFromEvent(event) };
  }

  get sortableRuleColumns() {
    return makeColumnsSortable(this.ruleColumns);
  }

  get sortedRuleRows() {
    return sortDatatableRows(
      this.ruleRows,
      this.sorts.rules.fieldName,
      this.sorts.rules.direction,
    );
  }

  get sortableMatrixColumns() {
    return makeColumnsSortable(this.matrixColumns);
  }

  get sortedMatrixRows() {
    return sortDatatableRows(
      this.matrixRows,
      this.sorts.values.fieldName,
      this.sorts.values.direction,
    );
  }

  get sortableBuiltInColumns() {
    return makeColumnsSortable(this.builtInColumns);
  }

  get sortedBuiltInRows() {
    return sortDatatableRows(
      this.builtInRows,
      this.sorts.builtin.fieldName,
      this.sorts.builtin.direction,
    );
  }

  get sortablePreviewColumns() {
    return makeColumnsSortable(this.previewColumns);
  }

  get sortedPreviewRows() {
    return sortDatatableRows(
      this.previewRows,
      this.sorts.preview.fieldName,
      this.sorts.preview.direction,
    );
  }

  get ruleColumns() {
    return [
      ...this.ruleIdentityColumns(170),
      {
        label: this.i18n.replacementRulesColumnAction,
        fieldName: "typeLabel",
        type: "typePill",
        initialWidth: 130,
        typeAttributes: {
          label: { fieldName: "typeLabel" },
          pillClass: { fieldName: "typePillClass" },
        },
      },
      {
        label: this.i18n.replacementRulesColumnFiles,
        fieldName: "filesLabel",
        type: "text",
        wrapText: true,
        cellAttributes: { class: "hardis-file-cell" },
      },
      {
        label: this.i18n.replacementRulesColumnTarget,
        fieldName: "targetLabel",
        type: "text",
        wrapText: true,
      },
      {
        label: this.i18n.replacementRulesColumnValue,
        fieldName: "valueLabel",
        type: "typePill",
        initialWidth: 145,
        typeAttributes: {
          label: { fieldName: "valueLabel" },
          pillClass: { fieldName: "valuePillClass" },
          iconName: { fieldName: "valueIcon" },
        },
      },
      {
        label: this.i18n.replacementRulesColumnStoredIn,
        fieldName: "layerLabel",
        type: "typePill",
        initialWidth: 115,
        typeAttributes: {
          label: { fieldName: "layerLabel" },
          pillClass: { fieldName: "layerPillClass" },
          tooltip: { fieldName: "overridesLabel" },
        },
      },
      {
        label: this.i18n.replacementRulesColumnOrgs,
        fieldName: "orgsLabel",
        type: "text",
        initialWidth: 85,
        wrapText: true,
      },
      {
        type: "action",
        typeAttributes: { rowActions: this.getRuleRowActions.bind(this) },
      },
    ];
  }

  // The first columns of the rules and built-in rules tables: on or off, name, description
  ruleIdentityColumns(ruleColumnWidth, descriptionWidth) {
    return [
      {
        label: this.i18n.replacementRulesColumnOn,
        fieldName: "stateLabel",
        type: "statusPill",
        initialWidth: 85,
        typeAttributes: {
          label: { fieldName: "stateLabel" },
          pillClass: { fieldName: "statePillClass" },
        },
      },
      {
        label: this.i18n.replacementRulesColumnRule,
        fieldName: "id",
        type: "branchChip",
        initialWidth: ruleColumnWidth,
      },
      {
        label: this.i18n.replacementRulesColumnDescription,
        fieldName: "description",
        type: "text",
        wrapText: true,
        ...(descriptionWidth ? { initialWidth: descriptionWidth } : {}),
      },
    ];
  }

  get ruleRows() {
    if (!this.data) {
      return [];
    }
    const filter = this.filterText.trim().toLowerCase();
    return this.data.definitions
      .filter(
        (definition) =>
          this.layerFilter === "all" || definition.layer === this.layerFilter,
      )
      .map((definition) => this.buildRuleRow(definition))
      .filter(
        (row) =>
          !filter ||
          `${row.id} ${row.description} ${row.filesLabel}`
            .toLowerCase()
            .includes(filter),
      );
  }

  get hasRuleRows() {
    return this.ruleRows.length > 0;
  }

  get hasDefinitions() {
    return !!this.data && this.data.definitions.length > 0;
  }

  buildRuleRow(definition) {
    const rule = definition.rule;
    const enabled = rule.enabled !== false;
    const type = rule.type || this.inheritedType(definition);
    const typeInfo = TYPE_INFO[type];
    const overridesBuiltIn = definition.overrides.includes("builtin");
    const value = this.describeValue(rule);
    const overrides = definition.overrides
      .map((origin) => this.i18n[ORIGIN_LABEL_KEYS[origin]])
      .join(", ");
    return {
      key: `${definition.layer}:${definition.branch}:${rule.id}`,
      definitionKey: `${definition.layer}:${definition.branch}:${rule.id}`,
      id: rule.id,
      enabled,
      description:
        rule.description ||
        (overrides
          ? this.t("replacementRulesOverrides", { places: overrides })
          : ""),
      stateLabel: enabled
        ? this.i18n.replacementRulesOn
        : this.i18n.replacementRulesOff,
      statePillClass: enabled
        ? "hardis-pill hardis-status-success"
        : "hardis-pill hardis-status-unknown",
      typeLabel: overridesBuiltIn
        ? this.i18n.replacementRulesOriginBuiltIn
        : typeInfo
          ? this.i18n[typeInfo.labelKey]
          : this.i18n.replacementRulesTypeInherited,
      typePillClass: getPillClass(
        overridesBuiltIn ? "slate" : typeInfo ? typeInfo.hue : "slate",
      ),
      filesLabel: asList(rule.files).join(", "),
      targetLabel: this.describeTarget(rule, type),
      valueLabel: value.label,
      valuePillClass: getPillClass(value.hue),
      valueIcon: value.icon,
      layerLabel: this.placeLabel(definition.layer, definition.branch),
      layerPillClass: getPillClass(layerHue(definition.layer)),
      overridesLabel: overrides
        ? this.t("replacementRulesOverrides", { places: overrides })
        : "",
      orgsLabel: this.describeOrgs(rule),
    };
  }

  // Type of the rule an override changes, from the layers below it
  inheritedType(definition) {
    const effective = this.data ? this.data.effective : {};
    for (const rules of Object.values(effective)) {
      const found = rules.find((rule) => rule.id === definition.rule.id);
      if (found && found.type) {
        return found.type;
      }
    }
    return "";
  }

  describeTarget(rule, type) {
    if (type === "text" && rule.find) {
      return rule.regex
        ? this.t("replacementRulesTargetRegex", { find: rule.find })
        : this.t("replacementRulesTargetText", { find: rule.find });
    }
    return rule.xmlPath || "";
  }

  describeValue(rule) {
    if (rule.secret) {
      return { label: rule.secret, hue: "amber", icon: "utility:lock" };
    }
    if (typeof rule.value === "string") {
      return { label: rule.value, hue: "cyan", icon: "" };
    }
    if (rule.values && Object.keys(rule.values).length > 0) {
      const count = Object.keys(rule.values).filter(
        (target) => target !== DEFAULT_TARGET,
      ).length;
      return {
        label:
          rule.values[DEFAULT_TARGET] !== undefined
            ? this.t("replacementRulesValuesWithDefault", { count })
            : this.t("replacementRulesValuesCount", { count }),
        hue: "blue",
        icon: "",
      };
    }
    return { label: this.i18n.replacementRulesNoValue, hue: "slate", icon: "" };
  }

  describeOrgs(rule) {
    const include = rule.includeTargetBranches || [];
    const exclude = rule.excludeTargetBranches || [];
    if (include.length > 0) {
      return this.t("replacementRulesOnlyOrgs", { orgs: include.join(", ") });
    }
    if (exclude.length > 0) {
      return this.t("replacementRulesAllOrgsExcept", {
        orgs: exclude.join(", "),
      });
    }
    return this.i18n.replacementRulesAllOrgs;
  }

  placeLabel(layer, branch) {
    if (layer === "branch") {
      return branch
        ? this.t("replacementRulesLayerBranchNamed", { branch })
        : this.i18n.replacementRulesLayerBranch;
    }
    if (layer === "issue") {
      return this.issueLabel;
    }
    return this.i18n[ORIGIN_LABEL_KEYS[layer]] || layer;
  }

  getRuleRowActions(row, doneCallback) {
    doneCallback([
      { label: this.t("edit"), name: "edit", iconName: "utility:edit" },
      {
        label: row.enabled
          ? this.i18n.replacementRulesTurnOff
          : this.i18n.replacementRulesTurnOn,
        name: "toggle",
        iconName: row.enabled ? "utility:toggle_off" : "utility:toggle_on",
        disabled: this.busy,
      },
      {
        label: this.i18n.deleteLabel,
        name: "delete",
        iconName: "utility:delete",
        disabled: this.busy,
      },
    ]);
  }

  // --- Values per org tab ---

  // Major branches first, from integration to production, then dev sandboxes and scratch orgs
  get targets() {
    if (!this.data) {
      return [];
    }
    return [
      ...this.data.majorBranches.map((branch) => branch.branchName),
      DEFAULT_TARGET,
    ];
  }

  get matrixColumns() {
    const columns = [
      {
        label: this.i18n.replacementRulesColumnRule,
        fieldName: "id",
        type: "branchChip",
        initialWidth: 220,
      },
    ];
    this.targets.forEach((target, index) => {
      columns.push({
        label:
          target === DEFAULT_TARGET
            ? this.i18n.replacementRulesDefaultTarget
            : target,
        fieldName: `cell${index}Label`,
        type: "typePill",
        wrapText: true,
        typeAttributes: {
          label: { fieldName: `cell${index}Label` },
          pillClass: { fieldName: `cell${index}Class` },
          iconName: { fieldName: `cell${index}Icon` },
          tooltip: { fieldName: `cell${index}Tooltip` },
        },
      });
    });
    columns.push({
      type: "action",
      typeAttributes: {
        rowActions: [
          { label: this.t("edit"), name: "edit", iconName: "utility:edit" },
        ],
      },
    });
    return columns;
  }

  // One row per rule that writes a value: removals and built-in rules have no value
  get matrixRows() {
    if (!this.data) {
      return [];
    }
    const ids = [];
    for (const target of this.targets) {
      for (const rule of this.data.effective[target] || []) {
        if (
          !rule.builtIn &&
          rule.type !== "xml-remove" &&
          !ids.includes(rule.id)
        ) {
          ids.push(rule.id);
        }
      }
    }
    return ids.map((id) => {
      const row = { key: id, id };
      this.targets.forEach((target, index) => {
        const rule = (this.data.effective[target] || []).find(
          (item) => item.id === id,
        );
        const cell = this.describeCell(rule);
        row[`cell${index}Label`] = cell.label;
        row[`cell${index}Class`] = getPillClass(cell.hue);
        row[`cell${index}Icon`] = cell.icon;
        row[`cell${index}Tooltip`] = cell.tooltip;
      });
      return row;
    });
  }

  get hasMatrixRows() {
    return this.matrixRows.length > 0;
  }

  describeCell(rule) {
    if (!rule || !rule.applies) {
      return {
        label: this.i18n.replacementRulesNotApplied,
        hue: "slate",
        icon: "",
        tooltip: this.i18n.replacementRulesNotAppliedHelp,
      };
    }
    if (!rule.enabled) {
      return {
        label: this.i18n.replacementRulesOff,
        hue: "slate",
        icon: "utility:toggle_off",
        tooltip: "",
      };
    }
    const resolved = rule.resolved;
    if (resolved.source === "secret") {
      return {
        label: resolved.variables.join(", "),
        hue: "amber",
        icon: "utility:lock",
        tooltip: this.i18n.replacementRulesSecretCellHelp,
      };
    }
    if (resolved.source === "default") {
      return {
        label: this.t("replacementRulesDefaultValue", {
          value: resolved.value,
        }),
        hue: "teal",
        icon: "",
        tooltip: this.i18n.replacementRulesDefaultValueHelp,
      };
    }
    if (resolved.source === "branch" || resolved.source === "value") {
      return { label: resolved.value, hue: "blue", icon: "", tooltip: "" };
    }
    return {
      label: this.i18n.replacementRulesNotApplied,
      hue: "slate",
      icon: "",
      tooltip: this.i18n.replacementRulesNotAppliedHelp,
    };
  }

  // --- Built-in rules tab ---

  get builtInColumns() {
    return [
      ...this.ruleIdentityColumns(260),
      {
        label: this.i18n.replacementRulesColumnElements,
        fieldName: "elementsLabel",
        type: "text",
        wrapText: true,
      },
      {
        label: this.i18n.replacementRulesColumnRemovedWhen,
        fieldName: "whenLabel",
        type: "text",
        initialWidth: 200,
        wrapText: true,
      },
      {
        label: this.i18n.replacementRulesColumnChangedIn,
        fieldName: "changedInLabel",
        type: "text",
        initialWidth: 170,
        wrapText: true,
      },
      {
        type: "action",
        typeAttributes: { rowActions: this.getBuiltInRowActions.bind(this) },
      },
    ];
  }

  get builtInRows() {
    if (!this.data) {
      return [];
    }
    return this.data.builtInRules.map((rule) => {
      let changedIn = rule.overriddenIn
        .map((override) => this.placeLabel(override.layer, override.branch))
        .join(", ");
      if (!changedIn) {
        changedIn = rule.defaultEnabled
          ? this.i18n.replacementRulesOnByDefault
          : this.i18n.replacementRulesOffByDefault;
      }
      return {
        key: rule.id,
        id: rule.id,
        enabled: rule.enabled,
        overriddenIn: rule.overriddenIn,
        description: rule.warnWhenDisabled
          ? `${rule.description} ${this.i18n.replacementRulesWarnsWhenOff}`
          : rule.description,
        stateLabel: rule.enabled
          ? this.i18n.replacementRulesOn
          : this.i18n.replacementRulesOff,
        statePillClass: rule.enabled
          ? "hardis-pill hardis-status-success"
          : "hardis-pill hardis-status-unknown",
        elementsLabel: rule.xmlPaths.join(", "),
        whenLabel:
          rule.introducedIn !== null
            ? this.t("replacementRulesBuiltInBelow", {
                version: formatApiVersion(rule.introducedIn),
              })
            : rule.removedIn !== null
              ? this.t("replacementRulesBuiltInFrom", {
                  version: formatApiVersion(rule.removedIn),
                })
              : "",
        changedInLabel: changedIn,
      };
    });
  }

  // Turning a built-in rule on or off writes an override in the project or in the issue;
  // an override can be removed, which brings back the default of sfdx-hardis
  getBuiltInRowActions(row, doneCallback) {
    const turn = row.enabled ? "off" : "on";
    const actions = [
      {
        label: row.enabled
          ? this.i18n.replacementRulesTurnOffInProject
          : this.i18n.replacementRulesTurnOnInProject,
        name: `${turn}|project|`,
        iconName: row.enabled ? "utility:toggle_off" : "utility:toggle_on",
        disabled: this.busy,
      },
    ];
    if (this.issueAvailable) {
      actions.push({
        label: row.enabled
          ? this.i18n.replacementRulesTurnOffInIssue
          : this.i18n.replacementRulesTurnOnInIssue,
        name: `${turn}|issue|`,
        iconName: row.enabled ? "utility:toggle_off" : "utility:toggle_on",
        disabled: this.busy,
      });
    }
    for (const override of row.overriddenIn || []) {
      actions.push({
        label: this.t("replacementRulesResetBuiltIn", {
          place: this.placeLabel(override.layer, override.branch),
        }),
        name: `reset|${override.layer}|${override.branch || ""}`,
        iconName: "utility:undo",
        disabled: this.busy,
      });
    }
    doneCallback(actions);
  }

  // --- Preview tab ---

  get previewTargetOptions() {
    return this.targets.map((target) => ({
      label:
        target === DEFAULT_TARGET
          ? this.i18n.replacementRulesDefaultTargetLong
          : target,
      value: target,
    }));
  }

  get previewTargetValue() {
    if (this.previewTarget) {
      return this.previewTarget;
    }
    const targets = this.targets;
    return targets.length > 0 ? targets[0] : DEFAULT_TARGET;
  }

  get previewCommand() {
    const target = this.previewTargetValue;
    return target === DEFAULT_TARGET
      ? PREVIEW_COMMAND
      : `${PREVIEW_COMMAND} --target-branch ${target}`;
  }

  get previewRunning() {
    return !!(this.preview && this.preview.running);
  }

  get previewRunDisabled() {
    return this.previewRunning || !this.hasData;
  }

  get previewResult() {
    return (this.preview && this.preview.result) || null;
  }

  get hasPreviewResult() {
    return !!this.previewResult && !this.previewRunning;
  }

  get showPreviewCliTooOld() {
    const error = this.preview && this.preview.error;
    return !this.previewRunning && !!error && error.kind === "cliTooOld";
  }

  get showPreviewError() {
    const error = this.preview && this.preview.error;
    return !this.previewRunning && !!error && error.kind !== "cliTooOld";
  }

  get previewErrorMessage() {
    const error = this.preview && this.preview.error;
    return (error && error.message) || this.i18n.replacementRulesUnknownError;
  }

  get showPreviewIntro() {
    return (
      !this.previewRunning &&
      !this.previewResult &&
      !(this.preview && this.preview.error)
    );
  }

  get previewTargetText() {
    const result = this.previewResult;
    if (!result) {
      return "";
    }
    return result.target.apiVersion !== null
      ? this.t("replacementRulesPreviewTarget", {
          target: result.target.label,
          version: formatApiVersion(result.target.apiVersion),
        })
      : this.t("replacementRulesPreviewTargetNoVersion", {
          target: result.target.label,
        });
  }

  get previewSummary() {
    const result = this.previewResult;
    if (!result) {
      return "";
    }
    return this.t("replacementRulesPreviewSummary", {
      rules: result.appliedRules.length,
      files: new Set(
        result.results
          .filter((item) => item.status === "changed")
          .map((item) => item.file),
      ).size,
    });
  }

  get previewWarnings() {
    const result = this.previewResult;
    return ((result && result.warnings) || []).map((warning, index) => ({
      key: `${warning.kind}-${index}`,
      text: warning.message,
    }));
  }

  get hasPreviewWarnings() {
    return this.previewWarnings.length > 0;
  }

  get previewColumns() {
    return [
      {
        label: this.i18n.replacementRulesColumnFile,
        fieldName: "file",
        type: "text",
        wrapText: true,
        cellAttributes: { class: "hardis-file-cell" },
      },
      {
        label: this.i18n.replacementRulesColumnRule,
        fieldName: "ruleId",
        type: "branchChip",
        initialWidth: 240,
      },
      {
        label: this.i18n.replacementRulesColumnResult,
        fieldName: "statusLabel",
        type: "statusPill",
        initialWidth: 170,
        typeAttributes: {
          label: { fieldName: "statusLabel" },
          pillClass: { fieldName: "statusPillClass" },
        },
      },
      {
        label: this.i18n.replacementRulesColumnCount,
        fieldName: "count",
        type: "number",
        initialWidth: 90,
        cellAttributes: { alignment: "left" },
      },
      {
        label: this.i18n.replacementRulesColumnDetail,
        fieldName: "detail",
        type: "text",
        wrapText: true,
      },
    ];
  }

  get previewRows() {
    const result = this.previewResult;
    if (!result) {
      return [];
    }
    return result.results.map((item, index) => {
      const info =
        PREVIEW_STATUS_INFO[item.status] || PREVIEW_STATUS_INFO.unchanged;
      return {
        key: `${item.file}-${item.ruleId}-${index}`,
        file: item.file,
        ruleId: item.ruleId,
        statusLabel: this.i18n[info.labelKey],
        statusPillClass: `hardis-pill hardis-status-${info.status}`,
        count: item.count,
        detail: item.detail,
      };
    });
  }

  get hasPreviewRows() {
    return this.previewRows.length > 0;
  }

  // --- Dialogs ---

  get editorBusy() {
    return this.editorSaving || this.busy;
  }

  get showDeleteModal() {
    return !!this.deleteTarget;
  }

  get deleteConfirmText() {
    if (!this.deleteTarget) {
      return "";
    }
    return this.t("replacementRulesDeleteConfirm", {
      id: this.deleteTarget.id,
      place: this.placeLabel(this.deleteTarget.layer, this.deleteTarget.branch),
    });
  }

  // --- Handlers ---

  handleRefresh() {
    this.requestLoad();
  }

  handleRetry() {
    this.requestLoad();
  }

  handleOpenSetup() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "vscode-sfdx-hardis.showSetup" },
    });
  }

  handleNewRule() {
    this.openEditor(null);
  }

  handleTabActive(event) {
    const value = event.target && event.target.value;
    if (value) {
      this.activeTab = value;
    }
  }

  handleStatusAction(event) {
    const dataset = event.currentTarget.dataset;
    if (dataset.action === "connectToGit") {
      window.sendMessageToVSCode({ type: "connectToGit", data: {} });
    } else if (dataset.action === "openIssue") {
      this.openExternal(dataset.url);
    }
  }

  handleFilterChange(event) {
    this.filterText = event.target.value || "";
  }

  handleLayerFilterChange(event) {
    this.layerFilter = event.detail.value || "all";
  }

  handleRuleRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    const definition = this.findDefinition(row.definitionKey);
    if (!action || !definition) {
      return;
    }
    if (action.name === "edit") {
      this.openEditor(definition);
    } else if (action.name === "toggle") {
      this.sendWrite("setReplacementRuleEnabled", {
        layer: definition.layer,
        branch: definition.branch,
        id: definition.rule.id,
        enabled: definition.rule.enabled === false,
      });
    } else if (action.name === "delete") {
      this.deleteTarget = {
        layer: definition.layer,
        branch: definition.branch,
        id: definition.rule.id,
      };
    }
  }

  // The values of a rule are edited where they win: in the highest place that stores the rule
  handleMatrixRowAction(event) {
    const row = event.detail.row;
    if (!row || !this.data) {
      return;
    }
    const definitions = this.data.definitions.filter(
      (definition) => definition.rule.id === row.id,
    );
    const order = ["issue", "branch", "project"];
    definitions.sort(
      (first, second) =>
        order.indexOf(first.layer) - order.indexOf(second.layer),
    );
    if (definitions.length > 0) {
      this.openEditor(definitions[0]);
    }
  }

  handleBuiltInRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    if (!action || !row) {
      return;
    }
    const [verb, layer, branch] = String(action.name).split("|");
    if (verb === "reset") {
      this.sendWrite("deleteReplacementRule", { layer, branch, id: row.id });
    } else if (verb === "on" || verb === "off") {
      this.sendWrite("setReplacementRuleEnabled", {
        layer,
        branch: "",
        id: row.id,
        enabled: verb === "on",
      });
    }
  }

  handlePreviewTargetChange(event) {
    this.previewTarget = event.detail.value;
  }

  handleRunPreview() {
    window.sendMessageToVSCode({
      type: "previewReplacementRules",
      data: { targetBranch: this.previewTargetValue },
    });
  }

  handleEditorClose() {
    if (!this.editorSaving) {
      this.closeEditor();
    }
  }

  handleEditorSave(event) {
    const detail = event.detail || {};
    this.editorError = "";
    this.editorSaving = true;
    this.editorRequestId = this.sendWrite("saveReplacementRule", {
      mode: this.editorIsCreate ? "create" : "update",
      rule: detail.rule,
      layer: detail.layer,
      branch: detail.branch,
      originalLayer: this.editorDefinition ? this.editorDefinition.layer : "",
      originalBranch: this.editorDefinition ? this.editorDefinition.branch : "",
    });
  }

  handleDeleteCancel() {
    this.deleteTarget = null;
  }

  handleDeleteConfirm() {
    const target = this.deleteTarget;
    this.deleteTarget = null;
    if (target) {
      this.sendWrite("deleteReplacementRule", target);
    }
  }

  // --- State ---

  // jscpd:ignore-start
  applyState(data) {
    if (Object.prototype.hasOwnProperty.call(data, "loading")) {
      this.loading = data.loading === true;
    }
    if (Object.prototype.hasOwnProperty.call(data, "minimalCliVersion")) {
      this.minimalCliVersion = data.minimalCliVersion || "";
    }
    if (Object.prototype.hasOwnProperty.call(data, "error")) {
      this.error = data.error || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "readAt")) {
      this.readAt = data.readAt || null;
    }
    // jscpd:ignore-end
    if (Object.prototype.hasOwnProperty.call(data, "data")) {
      this.data = data.data || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "busy")) {
      this.busy = data.busy === true;
    }
    if (Object.prototype.hasOwnProperty.call(data, "preview")) {
      this.preview = data.preview || {
        running: false,
        targetBranch: "",
        result: null,
        error: null,
      };
    }
  }

  handleWriteDone(data) {
    if (data.requestId && data.requestId === this.editorRequestId) {
      this.editorSaving = false;
      this.editorRequestId = "";
      if (data.ok) {
        this.closeEditor();
      } else {
        this.editorError =
          data.message || this.i18n.replacementRulesUnknownError;
      }
    }
  }

  requestLoad() {
    this.loading = true;
    this.error = null;
    window.sendMessageToVSCode({ type: "loadReplacementRules", data: {} });
  }

  // Sends a change of a rule to the extension, which runs it with sfdx-hardis. Returns its id.
  sendWrite(type, data) {
    requestCounter += 1;
    const requestId = `rr-${Date.now()}-${requestCounter}`;
    window.sendMessageToVSCode({ type, data: { ...data, requestId } });
    return requestId;
  }

  openEditor(definition) {
    this.editorDefinition = definition;
    this.editorIsCreate = !definition;
    this.editorError = "";
    this.editorSaving = false;
    this.showEditor = true;
  }

  closeEditor() {
    this.showEditor = false;
    this.editorDefinition = null;
    this.editorError = "";
  }

  findDefinition(definitionKey) {
    if (!this.data) {
      return null;
    }
    return (
      this.data.definitions.find(
        (definition) =>
          `${definition.layer}:${definition.branch}:${definition.rule.id}` ===
          definitionKey,
      ) || null
    );
  }

  get editorInheritedType() {
    return this.editorDefinition
      ? this.inheritedType(this.editorDefinition)
      : "";
  }

  get majorBranchNames() {
    return this.data
      ? this.data.majorBranches.map((branch) => branch.branchName)
      : [];
  }

  get issueNumber() {
    return this.data ? this.data.layers.issue.number : null;
  }

  get secretLookups() {
    return this.data ? this.data.secretLookups : {};
  }

  // --- Opening links: only http(s) addresses leave the panel ---

  openExternal(url) {
    const safeUrl = httpUrl(url);
    if (safeUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: { url: safeUrl },
      });
    }
  }
}

function asList(files) {
  if (Array.isArray(files)) {
    return files;
  }
  return files ? [files] : [];
}

function layerHue(layer) {
  if (layer === "branch") {
    return "violet";
  }
  if (layer === "issue") {
    return "amber";
  }
  return "slate";
}

// 68 is written 68.0, as sfdx-hardis and Salesforce write an API version
function formatApiVersion(version) {
  return Number.isInteger(version) ? `${version}.0` : String(version);
}

// The address when it is an http(s) one, else an empty string
function httpUrl(value) {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\/\S+$/i.test(url) ? url : "";
}
