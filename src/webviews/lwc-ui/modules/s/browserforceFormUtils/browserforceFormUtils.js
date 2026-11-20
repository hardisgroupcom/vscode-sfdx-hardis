/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

// Pure helpers of the Browserforce setting editor (s/browserforceSettingEditor): the form model of
// one setting value, built from the fields and groups of the Browserforce catalog
// (sf browserforce plugins list), and back. No import: the unit tests evaluate this source as is.
//
// Field paths of the catalog: a dot path, "[]" for the items of an array and "*" for the entries
// of an object keyed by name ("portals[].name", "*.consumerKey"). A setting that is itself an
// array has the group "[]", a setting keyed by name the group "*".
//
// The model keeps one state per field, as typed (a number being typed, invalid JSON), so the form
// never loses what the user wrote. formModelToConfig() turns it back into a value, starting from
// the value the form was built from: keys the form does not know are kept.

// A value written exactly ${NAME} is a CI/CD variable sfdx-hardis resolves for the target branch
const VARIABLE_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
// The names the form accepts: what CI/CD tools expect of an environment variable
const VARIABLE_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
// Written in capitals in a label made from a key (authProviderApiName: "Auth provider API name")
const ACRONYMS = new Set([
  "API",
  "CPQ",
  "CSV",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "ISO",
  "JSON",
  "PDF",
  "SAML",
  "SOQL",
  "SSO",
  "UI",
  "URI",
  "URL",
  "XML",
]);
// Longest example shown in the help of a field
const MAX_EXAMPLE_LENGTH = 120;
const ROOT_GROUP = "";
const ROOT_INDEX = -1;
// Pseudo path of the name of an entry keyed by name
export const ENTRY_NAME_PATH = "#name";

/** Form model of a setting value: one state per field, the items of each group, the source value. */
export function configToFormModel(entry, config) {
  const fields = Array.isArray(entry?.fields) ? entry.fields : [];
  const model = { base: clone(config), fields: {}, groups: {} };
  for (const field of rootFields(entry)) {
    model.fields[field.path] = fieldToState(
      field,
      getAtPath(config, field.path),
    );
  }
  for (const group of groupsOf(entry)) {
    const container = getAtPath(config, groupContainerPath(group));
    const groupFields = fields.filter((field) => field.group === group.path);
    let items = [];
    if (group.kind === "array" && Array.isArray(container)) {
      items = container.map((item) => buildItem(group, groupFields, "", item));
    } else if (group.kind === "record" && isPlainObject(container)) {
      items = Object.entries(container).map(([name, item]) =>
        buildItem(group, groupFields, name, item),
      );
    }
    model.groups[group.path] = items;
  }
  return model;
}

/**
 * The setting value the form model describes, and the fields that could not be turned into a
 * value ({ key, code }: invalidNumber, invalidJson, invalidVariableName, missingEntryName,
 * invalidEntryName, duplicateEntryName). A field in error keeps its previous value.
 */
export function formModelToConfig(entry, model) {
  const fields = Array.isArray(entry?.fields) ? entry.fields : [];
  const errors = [];
  let config = clone(model?.base);
  for (const field of rootFields(entry)) {
    const result = stateToValue(field, model?.fields?.[field.path]);
    if (result.error) {
      errors.push({
        key: fieldStateKey(ROOT_GROUP, ROOT_INDEX, field.path),
        code: result.error,
      });
      continue;
    }
    config = result.set
      ? setAtPath(config, field.path, result.value)
      : deleteAtPath(config, field.path);
  }
  for (const group of groupsOf(entry)) {
    const groupFields = fields.filter((field) => field.group === group.path);
    const items = model?.groups?.[group.path] || [];
    const containerPath = groupContainerPath(group);
    if (
      items.length === 0 &&
      getAtPath(model?.base, containerPath) === undefined
    ) {
      continue;
    }
    const built =
      group.kind === "array"
        ? buildArrayItems(group, groupFields, items, errors)
        : buildRecordEntries(group, groupFields, items, errors);
    config = setAtPath(config, containerPath, built);
  }
  if (config === undefined) {
    config = rootIsArray(entry) ? [] : {};
  }
  return { config, errors };
}

/**
 * What the template renders: the fields of the setting itself, then one section per group with its
 * items. Every flag the template switches on is computed here (no expression in LWC templates).
 */
export function buildFormSections(entry, model, errors = []) {
  const errorByKey = new Map(
    (errors || []).map((error) => [error.key, error.code]),
  );
  const fields = Array.isArray(entry?.fields) ? entry.fields : [];
  const sections = [];
  // Fields of the setting itself, one section per object they belong to ("lineEditor.x" and
  // "lineEditor.y" under "Line editor"), the fields at the top first
  const topFields = rootFields(entry);
  const prefixes = [];
  for (const field of topFields) {
    const prefix = parentPath(field.path);
    if (!prefixes.includes(prefix)) {
      prefixes.push(prefix);
    }
  }
  prefixes.sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
  for (const prefix of prefixes) {
    sections.push({
      key: `root-${prefix}`,
      isGroup: false,
      isRecord: false,
      isSubsection: prefix !== "",
      title: humanizePath(prefix),
      items: [
        {
          key: `root-item-${prefix}`,
          itemClass: "bfe-root-item",
          isGroupItem: false,
          isRecordEntry: false,
          fields: topFields
            .filter((field) => parentPath(field.path) === prefix)
            .map((field) =>
              describeField(
                entry,
                field,
                field.path,
                model?.fields?.[field.path],
                fieldStateKey(ROOT_GROUP, ROOT_INDEX, field.path),
                errorByKey,
                suggestVariableName(entry, null, null, ROOT_INDEX, field.path),
              ),
            ),
        },
      ],
    });
  }
  for (const group of groupsOf(entry)) {
    const groupFields = fields.filter((field) => field.group === group.path);
    const items = model?.groups?.[group.path] || [];
    sections.push({
      key: `group-${group.path}`,
      groupPath: group.path,
      isGroup: true,
      isRecord: group.kind === "record",
      isSubsection: false,
      title:
        group.title ||
        humanizePath(groupContainerPath(group)) ||
        entry?.title ||
        group.path,
      help: group.description || "",
      hasHelp: !!group.description,
      keyPattern: group.keyPattern || "",
      isEmpty: items.length === 0,
      items: items.map((item, index) => {
        const nameKey = fieldStateKey(group.path, index, ENTRY_NAME_PATH);
        const describedFields = groupFields.map((field) => {
          const relativePath = relativeFieldPath(group, field);
          return describeField(
            entry,
            field,
            relativePath,
            item.fields?.[relativePath],
            fieldStateKey(group.path, index, relativePath),
            errorByKey,
            suggestVariableName(entry, group, item, index, relativePath),
          );
        });
        return {
          key: `${group.path}#${index}`,
          groupPath: group.path,
          index: String(index),
          number: index + 1,
          // What tells the items apart: the first text the item holds
          summary: itemSummary(describedFields),
          itemClass: "hardis-card bfe-item",
          isGroupItem: true,
          isRecordEntry: group.kind === "record",
          name: item.name || "",
          nameKey,
          nameErrorCode: errorByKey.get(nameKey) || "",
          hasNameError: errorByKey.has(nameKey),
          fields: describedFields,
        };
      }),
    });
  }
  return sections;
}

/**
 * Readable label of a key path: its last segment in words, known acronyms in capitals
 * ("authenticationConfiguration.services" -> "Services", "authProviderApiName" ->
 * "Auth provider API name"). "" for an empty path.
 */
export function humanizeKey(path) {
  const segments = String(path || "")
    .split(".")
    .map((segment) => segment.replace(/\[\]$/, ""))
    .filter((segment) => segment !== "" && segment !== "*" && segment !== "[]");
  if (segments.length === 0) {
    return "";
  }
  return wordsToLabel(splitWords(segments[segments.length - 1]));
}

/**
 * Suggested CI/CD variable name of a field: the setting key, the entry name or the item number,
 * then the field path, in capitals ("AUTH_PROVIDERS_MYPROVIDER_CONSUMER_SECRET").
 */
export function suggestVariableName(entry, group, item, index, path) {
  const parts = [snakeCase(entry?.key || "")];
  if (group) {
    if (group.kind === "record") {
      parts.push(String(item?.name || "").toUpperCase());
    } else {
      const container = groupContainerPath(group);
      if (container) {
        parts.push(snakeCase(container.split(".").pop()));
      }
      parts.push(String(index + 1));
    }
  }
  for (const segment of String(path || "").split(".")) {
    parts.push(snakeCase(segment));
  }
  let name = parts
    .join("_")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (/^[0-9]/.test(name)) {
    name = `_${name}`;
  }
  return name || "MY_VARIABLE";
}

/** Key of the state of a field: the group path, the item index (-1 outside a group), the field path. */
export function fieldStateKey(groupPath, index, path) {
  return `${groupPath}|${index}|${path}`;
}

export function parseFieldStateKey(key) {
  const [groupPath, index, ...rest] = String(key || "").split("|");
  return { groupPath, index: Number(index), path: rest.join("|") };
}

/** Changes the state of one field (patch of text, checked, present, isVariable, variable). */
export function updateFieldState(model, key, patch) {
  const next = clone(model);
  const { groupPath, index, path } = parseFieldStateKey(key);
  const states =
    index === ROOT_INDEX
      ? next.fields
      : next.groups?.[groupPath]?.[index]?.fields;
  if (!states) {
    return next;
  }
  states[path] = { ...emptyState(), ...(states[path] || {}), ...patch };
  return next;
}

/** Renames an entry. With the entry of the catalog, the suggested variable names follow. */
export function setEntryName(model, groupPath, index, name, entry = null) {
  const next = clone(model);
  const item = next.groups?.[groupPath]?.[index];
  if (item) {
    item.name = name;
  }
  return refreshSuggestedVariables(entry, next, groupPath);
}

/**
 * Adds an empty item to a group: its fields start empty, defaults are applied by Browserforce. A
 * password starts with its suggested variable name, as it can only be a variable.
 */
export function addGroupItem(entry, model, groupPath) {
  const next = clone(model);
  const group = groupsOf(entry).find(
    (candidate) => candidate.path === groupPath,
  );
  if (!group) {
    return next;
  }
  const groupFields = (entry.fields || []).filter(
    (field) => field.group === groupPath,
  );
  const item = buildItem(group, groupFields, "", undefined);
  for (const field of groupFields.filter((candidate) => candidate.isPassword)) {
    const state = item.fields[relativeFieldPath(group, field)];
    state.variableAuto = true;
  }
  next.groups[groupPath] = [...(next.groups[groupPath] || []), item];
  return refreshSuggestedVariables(entry, next, groupPath);
}

/** Removes an item. With the entry of the catalog, the suggested variable names follow. */
export function removeGroupItem(model, groupPath, index, entry = null) {
  const next = clone(model);
  const items = next.groups?.[groupPath];
  if (Array.isArray(items)) {
    items.splice(index, 1);
  }
  return refreshSuggestedVariables(entry, next, groupPath);
}

/** Value of a new action of this setting: its first example, or an empty value of the right kind. */
export function defaultConfigOf(entry) {
  if (Array.isArray(entry?.examples) && entry.examples.length > 0) {
    return clone(entry.examples[0]);
  }
  return rootIsArray(entry) ? [] : {};
}

/** The variable name when the value is exactly ${NAME}. */
export function getVariableName(value) {
  if (typeof value !== "string") {
    return "";
  }
  const match = VARIABLE_REFERENCE_PATTERN.exec(value);
  return match ? match[1] : "";
}

export function isValidVariableName(name) {
  return VARIABLE_NAME_PATTERN.test(String(name || ""));
}

/** The CI/CD variables a setting value references, in the order they appear, without duplicates. */
export function listVariableNames(config) {
  const names = [];
  const visit = (value) => {
    const name = getVariableName(value);
    if (name) {
      if (!names.includes(name)) {
        names.push(name);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (isPlainObject(value)) {
      Object.values(value).forEach(visit);
    }
  };
  visit(config);
  return names;
}

/** The settings a new action can use: every catalog entry Browserforce has not removed. */
export function listSelectableSettings(catalog) {
  const plugins = Array.isArray(catalog?.plugins) ? catalog.plugins : [];
  return plugins.filter(
    (plugin) => !findDeprecatedSetting(catalog, plugin.key),
  );
}

/**
 * The documentation page of a setting, given by Browserforce 7.1.0 and later, or "" when the
 * installed Browserforce does not give one: the editor then shows no Documentation button.
 */
export function getSettingDocUrl(entry) {
  const url = entry?.docUrl;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : "";
}

/** The removal notice of a setting Browserforce no longer applies, if any. */
export function findDeprecatedSetting(catalog, key) {
  const deprecated = Array.isArray(catalog?.deprecatedSettings)
    ? catalog.deprecatedSettings
    : [];
  return deprecated.find((item) => item?.path === key) || null;
}

// A variable name the form suggested (variableAuto) follows the entry name and the item number
function refreshSuggestedVariables(entry, model, groupPath) {
  const group = groupsOf(entry).find(
    (candidate) => candidate.path === groupPath,
  );
  const items = model?.groups?.[groupPath];
  if (!group || !Array.isArray(items)) {
    return model;
  }
  items.forEach((item, index) => {
    for (const [path, state] of Object.entries(item.fields || {})) {
      if (state?.variableAuto) {
        state.variable = suggestVariableName(entry, group, item, index, path);
      }
    }
  });
  return model;
}

function rootFields(entry) {
  return (Array.isArray(entry?.fields) ? entry.fields : []).filter(
    (field) => !field.group,
  );
}

function groupsOf(entry) {
  return Array.isArray(entry?.groups) ? entry.groups : [];
}

function rootIsArray(entry) {
  return groupsOf(entry).some((group) => group.path === "[]");
}

// Where the items of a group live: "portals[]" -> "portals", "[]" -> "", "a.*" -> "a", "*" -> ""
function groupContainerPath(group) {
  if (group.path === "[]" || group.path === "*") {
    return "";
  }
  // Both suffixes ("[]" and ".*") are two characters long
  return group.path.slice(0, -2);
}

// Path of a group field inside one item: "portals[].name" -> "name", "*" -> ""
function relativeFieldPath(group, field) {
  if (field.path === group.path) {
    return "";
  }
  return field.path.slice(group.path.length + 1);
}

function buildItem(group, groupFields, name, item) {
  const fields = {};
  for (const field of groupFields) {
    const relativePath = relativeFieldPath(group, field);
    fields[relativePath] = fieldToState(field, getAtPath(item, relativePath));
  }
  return { name, base: clone(item), fields };
}

function buildArrayItems(group, groupFields, items, errors) {
  return items.map((item, index) =>
    buildItemValue(group, groupFields, item, index, errors),
  );
}

function buildRecordEntries(group, groupFields, items, errors) {
  const entries = {};
  let keyPattern = null;
  try {
    keyPattern = group.keyPattern ? new RegExp(group.keyPattern) : null;
  } catch {
    keyPattern = null;
  }
  items.forEach((item, index) => {
    const value = buildItemValue(group, groupFields, item, index, errors);
    const name = String(item.name || "").trim();
    const nameKey = fieldStateKey(group.path, index, ENTRY_NAME_PATH);
    if (!name) {
      errors.push({ key: nameKey, code: "missingEntryName" });
    } else if (keyPattern && !keyPattern.test(name)) {
      errors.push({ key: nameKey, code: "invalidEntryName" });
    } else if (Object.prototype.hasOwnProperty.call(entries, name)) {
      errors.push({ key: nameKey, code: "duplicateEntryName" });
    } else {
      entries[name] = value;
    }
  });
  return entries;
}

function buildItemValue(group, groupFields, item, index, errors) {
  let value = clone(item.base);
  let primitiveItem = false;
  for (const field of groupFields) {
    const relativePath = relativeFieldPath(group, field);
    primitiveItem = primitiveItem || relativePath === "";
    const result = stateToValue(field, item.fields?.[relativePath]);
    if (result.error) {
      errors.push({
        key: fieldStateKey(group.path, index, relativePath),
        code: result.error,
      });
      continue;
    }
    value = result.set
      ? setAtPath(value, relativePath, result.value)
      : deleteAtPath(value, relativePath);
  }
  if (value === undefined) {
    return primitiveItem ? null : {};
  }
  return value;
}

function emptyState() {
  return {
    present: false,
    text: "",
    checked: false,
    isVariable: false,
    variable: "",
    // The variable name is the one the form suggested: it follows the entry name
    variableAuto: false,
    literalSecret: null,
  };
}

// State of a field as the form shows it, from its value in the setting
function fieldToState(field, value) {
  const state = emptyState();
  state.present = value !== undefined && value !== null;
  const variable = getVariableName(value);
  if (variable) {
    state.isVariable = true;
    state.variable = variable;
    return state;
  }
  if (field.isPassword) {
    // A secret written in clear stays as it is until a variable name replaces it
    state.isVariable = true;
    state.literalSecret = state.present ? value : null;
    return state;
  }
  switch (field.type) {
    case "boolean":
      state.checked =
        value === true || (value === undefined && field.default === true);
      break;
    case "string[]":
      state.text = Array.isArray(value)
        ? value.map((item) => String(item)).join("\n")
        : state.present
          ? String(value)
          : "";
      break;
    case "json":
      state.text = state.present ? JSON.stringify(value, null, 2) : "";
      break;
    default:
      state.text = state.present ? String(value) : "";
  }
  return state;
}

// Value of a field from its state: { set: false } leaves it out of the setting
function stateToValue(field, rawState) {
  const state = { ...emptyState(), ...(rawState || {}) };
  if (field.isPassword || state.isVariable) {
    const name = String(state.variable || "").trim();
    if (!name) {
      if (
        field.isPassword &&
        state.literalSecret !== null &&
        state.literalSecret !== undefined
      ) {
        return { set: true, value: state.literalSecret };
      }
      return { set: false };
    }
    if (!isValidVariableName(name)) {
      return { error: "invalidVariableName" };
    }
    return { set: true, value: "${" + name + "}" };
  }
  const text = String(state.text ?? "");
  switch (field.type) {
    case "boolean":
      return state.present
        ? { set: true, value: state.checked === true }
        : { set: false };
    case "number":
    case "integer": {
      const trimmed = text.trim();
      if (trimmed === "") {
        return { set: false };
      }
      const number = Number(trimmed);
      if (
        !Number.isFinite(number) ||
        (field.type === "integer" && !Number.isInteger(number))
      ) {
        return { error: "invalidNumber" };
      }
      return { set: true, value: number };
    }
    case "string[]": {
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      return lines.length > 0 ? { set: true, value: lines } : { set: false };
    }
    case "json": {
      const trimmed = text.trim();
      if (trimmed === "") {
        return { set: false };
      }
      try {
        return { set: true, value: JSON.parse(trimmed) };
      } catch {
        return { error: "invalidJson" };
      }
    }
    default: {
      if (text === "") {
        // A required text the value holds empty stays empty: it has a meaning there (the
        // default layout of a profile)
        return field.required === true && state.present
          ? { set: true, value: "" }
          : { set: false };
      }
      if (Array.isArray(field.enum)) {
        const enumValue = field.enum.find((option) => String(option) === text);
        return { set: true, value: enumValue === undefined ? text : enumValue };
      }
      return { set: true, value: text };
    }
  }
}

// Everything the template needs to render one field: no expression in LWC templates. The texts
// that need a translation are codes (typeHelp) the editor turns into labels.
function describeField(
  entry,
  field,
  path,
  rawState,
  key,
  errorByKey,
  suggestedVariable,
) {
  const state = { ...emptyState(), ...(rawState || {}) };
  const variableMode = field.isPassword || state.isVariable;
  const hasEnum = Array.isArray(field.enum) && field.enum.length > 0;
  const type = field.type || "string";
  const required = field.required === true;
  const errorCode = errorByKey.get(key) || "";
  const isBoolean = !variableMode && type === "boolean";
  const isStringList = !variableMode && type === "string[]";
  const isJson = !variableMode && type === "json";
  const rawKey = path || field.path || "";
  return {
    key,
    path,
    rawKey,
    label: field.title || humanizeKey(rawKey),
    description: field.description || "",
    typeHelp: typeHelpOf(field, type, hasEnum),
    example: field.isPassword ? "" : exampleOf(entry, field),
    required,
    isPassword: field.isPassword === true,
    isIrreversible: field.isIrreversible === true,
    canToggleVariable: field.isPassword !== true,
    isVariable: variableMode,
    showVariableInput: variableMode,
    variableName: state.variable || "",
    suggestedVariable,
    hasVariableName:
      variableMode && isValidVariableName(String(state.variable || "").trim()),
    hasLiteralSecret:
      field.isPassword === true &&
      !state.variable &&
      state.literalSecret !== null &&
      state.literalSecret !== undefined,
    isString: !variableMode && type === "string" && !hasEnum,
    isEnum: !variableMode && type === "string" && hasEnum,
    // An optional list can go back to "not set": its first option has an empty value, the
    // editor gives it its label
    options: hasEnum
      ? [
          ...(required ? [] : [{ label: "", value: "" }]),
          ...field.enum.map((option) => ({
            label: String(option),
            value: String(option),
          })),
        ]
      : [],
    isBoolean,
    checked: state.checked === true,
    // A boolean nobody set keeps what the org has: shown as "not set", and an optional one
    // that was set can go back to it
    isSet: state.present === true,
    canClear: isBoolean && state.present === true && !required,
    isNumber: !variableMode && (type === "number" || type === "integer"),
    step: type === "integer" ? "1" : "any",
    isStringList,
    isJson,
    text: state.text || "",
    errorCode,
    hasError: !!errorCode,
  };
}

// Code of the sentence that tells how to fill a field without description in the catalog
function typeHelpOf(field, type, hasEnum) {
  if (field.isPassword) {
    return "password";
  }
  if (hasEnum) {
    return "enum";
  }
  if (["boolean", "string[]", "json", "number", "integer"].includes(type)) {
    return type === "string[]" ? "list" : type;
  }
  return "text";
}

// The value the first example of the setting gives to a field, as text: "" when none does
function exampleOf(entry, field) {
  if (field.type === "boolean") {
    return "";
  }
  const group = field.group
    ? groupsOf(entry).find((candidate) => candidate.path === field.group)
    : null;
  for (const example of Array.isArray(entry?.examples) ? entry.examples : []) {
    let values = [];
    if (!group) {
      values = [getAtPath(example, field.path)];
    } else {
      const container = getAtPath(example, groupContainerPath(group));
      const items = Array.isArray(container)
        ? container
        : isPlainObject(container)
          ? Object.values(container)
          : [];
      const relativePath = relativeFieldPath(group, field);
      values = items.map((item) => getAtPath(item, relativePath));
    }
    const value = values.find(
      (candidate) => candidate !== undefined && candidate !== null,
    );
    if (value !== undefined && !getVariableName(value)) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > MAX_EXAMPLE_LENGTH
        ? `${text.slice(0, MAX_EXAMPLE_LENGTH)}...`
        : text;
    }
  }
  return "";
}

// The first text an item holds, required texts first, then picked values: the title of its card
function itemSummary(describedFields) {
  const filled = describedFields.filter((field) => field.text.trim() !== "");
  const ordered = [
    ...filled.filter((field) => field.isString && field.required),
    ...filled.filter((field) => field.isString && !field.required),
    ...filled.filter((field) => field.isEnum),
  ];
  return ordered.length > 0 ? ordered[0].text.trim() : "";
}

// "lineEditor.totalsField" -> "lineEditor", "enabled" -> ""
function parentPath(path) {
  const index = String(path || "").lastIndexOf(".");
  return index === -1 ? "" : path.slice(0, index);
}

// Every segment of a path in words: "authenticationConfiguration.services" ->
// "Authentication configuration services"
function humanizePath(path) {
  const words = String(path || "")
    .split(".")
    .map((segment) => segment.replace(/\[\]$/, ""))
    .filter((segment) => segment !== "" && segment !== "*")
    .flatMap(splitWords);
  return wordsToLabel(words);
}

// "authProviderApiName" -> ["auth", "Provider", "Api", "Name"], "SSOEnabled" -> ["SSO", "Enabled"]
function splitWords(segment) {
  return String(segment || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter((word) => word !== "");
}

function wordsToLabel(words) {
  const label = words
    .map((word) => {
      const upper = word.toUpperCase();
      return ACRONYMS.has(upper) ? upper : word.toLowerCase();
    })
    .join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// "authProviders" -> "AUTH_PROVIDERS"
function snakeCase(segment) {
  return splitWords(String(segment || "").replace(/\[\]$/, ""))
    .join("_")
    .toUpperCase();
}

function getAtPath(value, path) {
  if (path === "" || path === undefined || path === null) {
    return value;
  }
  let current = value;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

// Returns the new root: a path "" replaces the value itself
function setAtPath(root, path, value) {
  if (path === "") {
    return value;
  }
  const result = isPlainObject(root) ? root : {};
  const segments = path.split(".");
  let current = result;
  segments.slice(0, -1).forEach((segment) => {
    if (!isPlainObject(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  });
  current[segments[segments.length - 1]] = value;
  return result;
}

// Removes the value at the path, and the objects this removal leaves empty. An object that was
// already empty in the source value is kept: the value at the path was not there to remove.
function deleteAtPath(root, path) {
  if (path === "") {
    return undefined;
  }
  if (!isPlainObject(root)) {
    return root;
  }
  const segments = path.split(".");
  const parents = [root];
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(current[segment])) {
      return root;
    }
    current = current[segment];
    parents.push(current);
  }
  const lastSegment = segments[segments.length - 1];
  if (!Object.prototype.hasOwnProperty.call(current, lastSegment)) {
    return root;
  }
  delete current[lastSegment];
  for (let index = parents.length - 1; index > 0; index--) {
    if (Object.keys(parents[index]).length > 0) {
      break;
    }
    delete parents[index - 1][segments[index - 1]];
  }
  return root;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
