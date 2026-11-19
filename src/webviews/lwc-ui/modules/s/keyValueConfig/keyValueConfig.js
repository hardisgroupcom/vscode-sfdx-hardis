/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

/**
 * Editor of a `.sfdx-hardis.yml` property that maps names to scalar values,
 * an object whose JSON schema only declares `additionalProperties` (ex:
 * releaseVersioningMinimumVariables: { PI: 3, IT: 1 }).
 *
 * Props:
 *   value         : the object of the config, or null when unset
 *   read-only     : renders the pairs as chips, without any control
 *   name-pattern  : regex a name must match (schema propertyNames.pattern)
 *   value-pattern : regex a value must match (schema additionalProperties.pattern)
 * Fires:
 *   change        : { value } - the object, or null when no complete pair is
 *                   left, so the save removes the property instead of writing
 *                   an empty block
 */

let rowCounter = 0;

// An empty text is incomplete, not invalid. A pattern the browser cannot
// compile checks nothing
function matchesPattern(text, pattern) {
  if (!text || !pattern) {
    return true;
  }
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return true;
  }
}

// Same names and same values, 3 and "3" being the same value
function sameEntries(a, b) {
  const keysA = Object.keys(a);
  return (
    keysA.length === Object.keys(b).length &&
    keysA.every((key) => key in b && String(a[key]) === String(b[key]))
  );
}

export default class KeyValueConfig extends SharedMixin(LightningElement) {
  @api readOnly = false;
  @api namePattern = null;
  @api valuePattern = null;

  @track rows = [];

  @api
  get value() {
    return this._buildValue();
  }
  set value(newValue) {
    const source =
      newValue && typeof newValue === "object" && !Array.isArray(newValue)
        ? newValue
        : {};
    // The panel sends back the object this editor just emitted: rebuilding the
    // rows then would drop a pair being typed and the focus of its input
    if (sameEntries(source, this._buildValue() || {})) {
      return;
    }
    this.rows = Object.entries(source).map(([name, value]) =>
      this._newRow(name, value === null || value === undefined ? "" : String(value)),
    );
  }

  // --- Derived state --------------------------------------------------------

  get isEditable() {
    return this.readOnly !== true;
  }

  get hasRows() {
    return this.rows.length > 0;
  }

  get chips() {
    return this.rows
      .filter((row) => row.name && row.value !== "")
      .map((row) => ({ id: row.id, text: `${row.name} = ${row.value}` }));
  }

  // --- Handlers -------------------------------------------------------------

  handleAdd() {
    this.rows = [...this.rows, this._newRow("", "")];
  }

  handleRemove(event) {
    const id = event.currentTarget.dataset.id;
    this.rows = this.rows.filter((row) => row.id !== id);
    this._emitChange();
  }

  handleNameChange(event) {
    this._updateRow(event, "name");
  }

  handleValueChange(event) {
    this._updateRow(event, "value");
  }

  // --- Private --------------------------------------------------------------

  _updateRow(event, field) {
    // The inputs dispatch their own composed change event: it must not reach
    // the hosting panel as if it were the whole object
    event.stopPropagation();
    const input = event.target;
    const id = input.dataset.id;
    const text = String(event.detail?.value ?? input.value ?? "").trim();
    const valid = matchesPattern(
      text,
      field === "name" ? this.namePattern : this.valuePattern,
    );
    // Checked here, not with the pattern attribute: browsers compile it with
    // the v flag, which refuses the JSON schema patterns ([A-Za-z0-9_-])
    input.setCustomValidity(valid ? "" : this.i18n.keyValueInvalid);
    input.reportValidity();
    this.rows = this.rows.map((row) =>
      row.id === id
        ? { ...row, [field]: text, invalid: { ...row.invalid, [field]: !valid } }
        : row,
    );
    this._emitChange();
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: this._buildValue() },
      }),
    );
  }

  // Only complete and valid pairs are kept. A whole number is written as a
  // number (PI: 3), unless a leading zero would be lost (IT: "05")
  _buildValue() {
    const built = {};
    for (const row of this.rows) {
      if (!row.name || row.value === "" || row.invalid.name || row.invalid.value) {
        continue;
      }
      built[row.name] = /^(0|[1-9]\d{0,14})$/.test(row.value)
        ? Number(row.value)
        : row.value;
    }
    return Object.keys(built).length > 0 ? built : null;
  }

  _newRow(name, value) {
    rowCounter++;
    return { id: `kv-${rowCounter}`, name, value, invalid: {} };
  }
}
