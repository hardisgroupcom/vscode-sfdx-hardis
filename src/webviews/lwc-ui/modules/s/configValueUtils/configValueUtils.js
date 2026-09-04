/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Shared helpers rendering the value of a configuration setting in the
 * read-only state of a configuration panel (Pipeline Settings, branch
 * settings, and any future panel built on the .hardis-field-row kit).
 *
 * Before these helpers, a value that WAS set (a branch name, a regex, a
 * number, an enum) was printed with the SLDS "weak" text color, the very
 * color used by the row help text and by the "Not defined" placeholder: a
 * configured setting looked exactly like an empty one. Booleans (status
 * pill) and arrays (chips) were the only readable values of the panel.
 *
 * The rules applied here, so every panel renders a value the same way:
 * - a value that is set uses the strong .hardis-field-value class
 * - technical strings (regex, path, api name) also get the monospace variant
 * - git branch names reuse the .hardis-branch-chip of the array chips
 * - an empty value keeps the italic .hardis-not-set placeholder
 * - a value nobody configured (the panel receives the schema default in place
 *   of the missing value) is marked as such, so a default is never passed off
 *   as a deliberate choice
 */

/** Text values starting with http(s): rendered as a clickable link. */
export const URL_VALUE_REGEX = /^https?:\/\//i;

/**
 * Configuration keys holding git branch names (scalar or array): their values
 * are rendered as monospace branch chips instead of plain text.
 */
export const BRANCH_NAME_KEYS = new Set([
  "mergeTargets",
  "availableTargetBranches",
  "developmentBranch",
]);

// A technical string carries characters that matter and must stay legible
// (regex metacharacters, path separators, dotted api names).
// A regular expression is recognized by its anchors, even when it holds
// spaces ("^CRM-[0-9]+ .*").
const REGEX_ANCHOR_REGEX = /^\^|\$$/;
// Any other value must be a single token: a sentence holding a parenthesis
// ("New features (BUILD)") is prose and stays in the panel font.
const TECHNICAL_TOKEN_REGEX = /[\\/^$*+?()[\]{}|]|^\S+\.\S+$/;

/** True when the key holds one or several git branch names. */
export function isBranchNameKey(key) {
  return BRANCH_NAME_KEYS.has(key);
}

/** CSS class of the chip(s) rendering the value(s) of a setting. */
export function configChipClass(key) {
  return isBranchNameKey(key) ? "hardis-branch-chip" : "hardis-chip";
}

/** True when the value is a http(s) URL, rendered as a clickable link. */
export function isUrlConfigValue(value) {
  return typeof value === "string" && URL_VALUE_REGEX.test(value.trim());
}

/** True when a setting holds no value at all (unset, null or blank string). */
export function isEmptyConfigValue(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return String(value).trim() === "";
}

/** True when the string is technical enough to deserve a monospace render. */
export function isTechnicalConfigValue(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return false;
  }
  if (REGEX_ANCHOR_REGEX.test(trimmed)) {
    return true;
  }
  return !/\s/.test(trimmed) && TECHNICAL_TOKEN_REGEX.test(trimmed);
}

/**
 * Printable form of a scalar or array value, for a read-only row or a tooltip.
 * Objects are JSON so a nested block never shows up as "[object Object]".
 */
export function formatConfigValue(value) {
  if (isEmptyConfigValue(value)) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatConfigValue(item)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * CSS classes of a value that is set: strong text, monospace when technical.
 * @param {*} value the value about to be displayed
 */
export function configValueClass(value) {
  return isTechnicalConfigValue(value)
    ? "hardis-field-value mono"
    : "hardis-field-value";
}

/**
 * Printable default of a setting, recalled next to an empty value.
 * Returns "" when the schema has no usable default (unset, empty string,
 * empty array or nested object: none of them tells the user anything).
 * @param {object} schema the JSON schema of the setting
 * @param {Array} enumNames human labels of schema.enum, when any
 */
export function formatConfigDefault(schema, enumNames) {
  if (!schema || isEmptyConfigValue(schema.default)) {
    return "";
  }
  const defaultValue = schema.default;
  if (typeof defaultValue === "object") {
    return "";
  }
  if (Array.isArray(schema.enum) && Array.isArray(enumNames)) {
    const idx = schema.enum.indexOf(defaultValue);
    if (idx !== -1 && enumNames[idx]) {
      return String(enumNames[idx]);
    }
  }
  return formatConfigValue(defaultValue);
}
