/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

export default class SoqlBuilder extends SharedMixin(LightningElement) {
  @track isLoadingObjects = false;
  @track isLoadingFields = false;
  @track isRunningQuery = false;
  @track objects = [];
  @track fields = [];
  @track selectedObject = "";
  @track selectedFields = [];
  @track whereConditions = [];
  @track orderByField = "";
  @track orderByDirection = "ASC";
  @track limitValue = "200";
  @track generatedQuery = "";
  @track queryResultRecords = [];
  @track queryTotalSize = 0;
  @track queryColumns = [];
  @track hasResults = false;
  @track errorMessage = "";
  @track hasError = false;

  // Condition counter for unique IDs
  _conditionIdCounter = 0;

  connectedCallback() {
    super.connectedCallback();
    this._loadObjects();
  }

  @api
  initialize(data) {
    // re-use if panel re-opened with data
  }

  @api
  handleMessage(type, data) {
    switch (type) {
      case "objectsLoaded":
        this.isLoadingObjects = false;
        this.objects = (data.objects || []).map((name) => ({
          label: name,
          value: name,
        }));
        break;
      case "objectsLoadError":
        this.isLoadingObjects = false;
        this._setError(data.message);
        break;
      case "fieldsLoaded":
        this.isLoadingFields = false;
        this.fields = (data.fields || []).map((f) => ({
          label: `${f.label} (${f.name})`,
          value: f.name,
          type: f.type,
        }));
        // Reset selected fields when object changes
        this.selectedFields = [];
        this._rebuildQuery();
        break;
      case "fieldsLoadError":
        this.isLoadingFields = false;
        this._setError(data.message);
        break;
      case "queryResults":
        this.isRunningQuery = false;
        this.queryTotalSize = data.totalSize || 0;
        this.queryResultRecords = data.records || [];
        this.queryColumns =
          this.queryResultRecords.length > 0
            ? Object.keys(this.queryResultRecords[0]).filter(
                (k) => k !== "attributes",
              )
            : [];
        this.hasResults = true;
        this.hasError = false;
        break;
      case "queryError":
        this.isRunningQuery = false;
        this._setError(data.message);
        this.hasResults = false;
        break;
    }
  }

  // ---------------------- Private helpers ----------------------

  _loadObjects() {
    this.isLoadingObjects = true;
    this.hasError = false;
    window.sendMessageToVSCode({ type: "loadObjects" });
  }

  _setError(message) {
    this.errorMessage = message || "Unknown error";
    this.hasError = true;
  }

  _rebuildQuery() {
    if (!this.selectedObject) {
      this.generatedQuery = "";
      return;
    }
    const fields =
      this.selectedFields.length > 0 ? this.selectedFields.join(", ") : "Id";
    let query = `SELECT ${fields} FROM ${this.selectedObject}`;

    const validConditions = this.whereConditions.filter(
      (c) => c.field && c.operator && c.value,
    );
    if (validConditions.length > 0) {
      const whereParts = validConditions.map((c, idx) => {
        const joinOp = idx === 0 ? "" : ` ${c.join} `;
        const val = this._formatConditionValue(c);
        return `${joinOp}${c.field} ${c.operator} ${val}`;
      });
      query += ` WHERE ${whereParts.join("")}`;
    }

    if (this.orderByField) {
      query += ` ORDER BY ${this.orderByField} ${this.orderByDirection}`;
    }

    if (this.limitValue && parseInt(this.limitValue, 10) > 0) {
      query += ` LIMIT ${parseInt(this.limitValue, 10)}`;
    }

    this.generatedQuery = query;
  }

  _formatConditionValue(condition) {
    const stringOperators = ["LIKE", "NOT LIKE"];
    const nullOperators = ["= null", "!= null"];
    if (nullOperators.includes(condition.operator)) {
      return "null";
    }
    if (
      stringOperators.includes(condition.operator) ||
      condition.fieldType === "string" ||
      condition.fieldType === "id" ||
      condition.fieldType === "reference" ||
      condition.fieldType === "email" ||
      condition.fieldType === "phone" ||
      condition.fieldType === "url" ||
      condition.fieldType === "picklist" ||
      condition.fieldType === "multipicklist" ||
      condition.fieldType === "textarea"
    ) {
      return `'${condition.value}'`;
    }
    return condition.value;
  }

  // ---------------------- Getters ----------------------

  get hasObjects() {
    return this.objects.length > 0;
  }

  get hasFields() {
    return this.fields.length > 0;
  }

  get hasObjectSelected() {
    return !!this.selectedObject;
  }

  get hasQueryGenerated() {
    return !!this.generatedQuery;
  }

  get isLoading() {
    return this.isLoadingObjects || this.isLoadingFields;
  }

  get orderByOptions() {
    return this.fields;
  }

  get orderByDirectionOptions() {
    return [
      { label: "ASC", value: "ASC" },
      { label: "DESC", value: "DESC" },
    ];
  }

  get operatorOptions() {
    return [
      { label: "=", value: "=" },
      { label: "!=", value: "!=" },
      { label: ">", value: ">" },
      { label: ">=", value: ">=" },
      { label: "<", value: "<" },
      { label: "<=", value: "<=" },
      { label: "LIKE", value: "LIKE" },
      { label: "NOT LIKE", value: "NOT LIKE" },
      { label: "IN", value: "IN" },
      { label: "NOT IN", value: "NOT IN" },
    ];
  }

  get joinOptions() {
    return [
      { label: "AND", value: "AND" },
      { label: "OR", value: "OR" },
    ];
  }

  get resultRows() {
    return this.queryResultRecords.map((rec, idx) => ({
      _rowId: idx,
      cells: this.queryColumns.map((col) => ({
        col,
        value:
          rec[col] === null || rec[col] === undefined ? "" : String(rec[col]),
      })),
    }));
  }

  get resultCountLabel() {
    return this.t("soqlBuilderResultCount", { count: this.queryTotalSize });
  }

  // ---------------------- Event handlers ----------------------

  handleObjectChange(event) {
    this.selectedObject = event.detail.value;
    this.selectedFields = [];
    this.whereConditions = [];
    this.orderByField = "";
    this.hasResults = false;
    this.generatedQuery = "";
    if (this.selectedObject) {
      this.isLoadingFields = true;
      window.sendMessageToVSCode({
        type: "loadFields",
        data: { sobjectName: this.selectedObject },
      });
    }
  }

  handleFieldToggle(event) {
    const fieldName = event.target.dataset.field;
    if (!fieldName) {
      return;
    }
    if (this.selectedFields.includes(fieldName)) {
      this.selectedFields = this.selectedFields.filter((f) => f !== fieldName);
    } else {
      this.selectedFields = [...this.selectedFields, fieldName];
    }
    this._rebuildQuery();
  }

  handleSelectAllFields() {
    this.selectedFields = this.fields.map((f) => f.value);
    this._rebuildQuery();
  }

  handleClearFields() {
    this.selectedFields = [];
    this._rebuildQuery();
  }

  handleAddCondition() {
    this._conditionIdCounter++;
    this.whereConditions = [
      ...this.whereConditions,
      {
        id: this._conditionIdCounter,
        join: "AND",
        field: "",
        operator: "=",
        value: "",
        fieldType: "string",
      },
    ];
  }

  handleRemoveCondition(event) {
    const condId = parseInt(event.target.dataset.conditionId, 10);
    this.whereConditions = this.whereConditions.filter((c) => c.id !== condId);
    this._rebuildQuery();
  }

  handleConditionFieldChange(event) {
    const condId = parseInt(event.target.dataset.conditionId, 10);
    const fieldName = event.detail.value;
    const fieldDef = this.fields.find((f) => f.value === fieldName);
    this.whereConditions = this.whereConditions.map((c) => {
      if (c.id === condId) {
        return { ...c, field: fieldName, fieldType: fieldDef?.type || "string" };
      }
      return c;
    });
    this._rebuildQuery();
  }

  handleConditionOperatorChange(event) {
    const condId = parseInt(event.target.dataset.conditionId, 10);
    const operator = event.detail.value;
    this.whereConditions = this.whereConditions.map((c) => {
      if (c.id === condId) {
        return { ...c, operator };
      }
      return c;
    });
    this._rebuildQuery();
  }

  handleConditionValueChange(event) {
    const condId = parseInt(event.target.dataset.conditionId, 10);
    const value = event.detail.value;
    this.whereConditions = this.whereConditions.map((c) => {
      if (c.id === condId) {
        return { ...c, value };
      }
      return c;
    });
    this._rebuildQuery();
  }

  handleConditionJoinChange(event) {
    const condId = parseInt(event.target.dataset.conditionId, 10);
    const join = event.detail.value;
    this.whereConditions = this.whereConditions.map((c) => {
      if (c.id === condId) {
        return { ...c, join };
      }
      return c;
    });
    this._rebuildQuery();
  }

  handleOrderByChange(event) {
    this.orderByField = event.detail.value;
    this._rebuildQuery();
  }

  handleOrderByDirectionChange(event) {
    this.orderByDirection = event.detail.value;
    this._rebuildQuery();
  }

  handleLimitChange(event) {
    this.limitValue = event.detail.value;
    this._rebuildQuery();
  }

  handleRunQuery() {
    if (!this.generatedQuery) {
      return;
    }
    this.isRunningQuery = true;
    this.hasError = false;
    this.hasResults = false;
    window.sendMessageToVSCode({
      type: "runQuery",
      data: { query: this.generatedQuery },
    });
  }

  handleCopyQuery() {
    window.sendMessageToVSCode({
      type: "copyToClipboard",
      data: { text: this.generatedQuery },
    });
  }

  handleRefreshObjects() {
    this.selectedObject = "";
    this.selectedFields = [];
    this.fields = [];
    this.whereConditions = [];
    this.orderByField = "";
    this.generatedQuery = "";
    this.hasResults = false;
    this._loadObjects();
  }

  isFieldSelected(fieldValue) {
    return this.selectedFields.includes(fieldValue);
  }

  get fieldsWithSelection() {
    return this.fields.map((f) => ({
      ...f,
      isSelected: this.selectedFields.includes(f.value),
      buttonVariant: this.selectedFields.includes(f.value)
        ? "brand"
        : "neutral",
    }));
  }
}
