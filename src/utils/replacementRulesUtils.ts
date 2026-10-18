/*
Helpers of the Replacement Rules panel (src/commands/showReplacementRules.ts).

sfdx-hardis is the only engine of the replacement rules: the panel reads
`sf hardis:project:replacement:list --json`, previews with `sf hardis:project:replacement:preview`
and changes a rule with `sf hardis:project:replacement:create|update|delete --agent`. It never
writes a configuration file itself. This module builds those command lines, tells the kinds of
failure apart and keeps only the documented fields of the answers. No vscode import, so it runs
in the unit tests as is.
*/

import {
  asAnswerCount,
  asAnswerObjects,
  cleanAnswerText,
  failedCommandMessage,
} from "./cliAnswerUtils";
import { safeWebUrl } from "./doraReportUtils";
import { quote } from "./shellQuote";

export const REPLACEMENT_RULE_TYPES = [
  "xml-value",
  "xml-remove",
  "text",
] as const;
export type ReplacementRuleType = (typeof REPLACEMENT_RULE_TYPES)[number];

// Where a rule is stored and can be changed by the panel
export const REPLACEMENT_RULE_LAYERS = ["project", "branch", "issue"] as const;
export type ReplacementRuleLayer = (typeof REPLACEMENT_RULE_LAYERS)[number];

// Where an effective rule comes from: a layer, or the list shipped with sfdx-hardis
export type ReplacementRuleOrigin = ReplacementRuleLayer | "builtin";

// Key of a values map used by dev sandboxes, scratch orgs and every org without its own value
export const DEFAULT_TARGET = "default";

/** A rule as stored in a layer. An override only holds the fields it changes. */
export interface ReplacementRule {
  id: string;
  description?: string;
  enabled?: boolean;
  type?: ReplacementRuleType;
  files?: string | string[];
  xmlPath?: string;
  find?: string;
  regex?: boolean;
  value?: string;
  values?: Record<string, string>;
  secret?: string;
  includeTargetBranches?: string[];
  excludeTargetBranches?: string[];
  required?: boolean;
}

/** One rule as one layer stores it */
export interface ReplacementRuleDefinition {
  layer: ReplacementRuleLayer;
  branch: string;
  file: string;
  rule: ReplacementRule;
  overrides: ReplacementRuleOrigin[];
}

/** A rule after sfdx-hardis merged the layers, for one target */
export interface EffectiveReplacementRule {
  id: string;
  description: string;
  type: ReplacementRuleType | "";
  files: string[];
  xmlPath: string;
  find: string;
  regex: boolean;
  secret: string;
  enabled: boolean;
  origins: ReplacementRuleOrigin[];
  builtIn: boolean;
  applies: boolean;
  required: boolean;
  resolved: {
    source: "value" | "branch" | "default" | "secret" | "none";
    value: string;
    variables: string[];
  };
}

export interface BuiltInReplacementRuleView {
  id: string;
  description: string;
  files: string[];
  xmlPaths: string[];
  introducedIn: number | null;
  removedIn: number | null;
  defaultEnabled: boolean;
  enabled: boolean;
  warnWhenDisabled: boolean;
  overriddenIn: Array<{ layer: ReplacementRuleLayer; branch: string }>;
  source: string;
}

// Everything the webview receives from sf hardis:project:replacement:list: the fields listed
// here and no other
export interface ReplacementRulesView {
  definitions: ReplacementRuleDefinition[];
  effective: Record<string, EffectiveReplacementRule[]>;
  builtInRules: BuiltInReplacementRuleView[];
  layers: {
    project: { file: string; count: number };
    branches: Array<{ branch: string; file: string; count: number }>;
    issue: {
      available: boolean;
      number: number | null;
      url: string;
      error: string;
      count: number;
    };
  };
  majorBranches: Array<{ branchName: string; level: number }>;
  secretsProvider: string;
  secretLookups: Record<string, Array<{ target: string; variables: string[] }>>;
  issues: Array<{
    ruleId: string;
    layer: string;
    branch: string;
    message: string;
  }>;
}

// cliTooOld: the installed sfdx-hardis has no replacement rules commands
// other: anything else, with the message of sfdx-hardis
export interface ReplacementRulesPanelError {
  kind: "cliTooOld" | "other";
  message: string;
}

export type ReplacementRulesOutcome =
  { view: ReplacementRulesView } | { error: ReplacementRulesPanelError };

export type ReplacementPreviewStatus =
  | "changed"
  | "unchanged"
  | "not-found"
  | "secret-missing"
  | "no-value"
  | "disabled"
  | "risky-element";

const PREVIEW_STATUSES: ReplacementPreviewStatus[] = [
  "changed",
  "unchanged",
  "not-found",
  "secret-missing",
  "no-value",
  "disabled",
  "risky-element",
];

export interface ReplacementPreviewView {
  target: {
    targetBranch: string | null;
    label: string;
    apiVersion: number | null;
  };
  results: Array<{
    file: string;
    ruleId: string;
    origins: ReplacementRuleOrigin[];
    status: ReplacementPreviewStatus;
    count: number;
    detail: string;
  }>;
  warnings: Array<{ kind: string; ruleId: string; message: string }>;
  appliedRules: Array<{
    id: string;
    origins: ReplacementRuleOrigin[];
    files: number;
  }>;
}

export type ReplacementPreviewOutcome =
  { preview: ReplacementPreviewView } | { error: ReplacementRulesPanelError };

/** One change of a rule, as sfdx-hardis makes it */
export interface ReplacementWriteOperation {
  action: "create" | "update" | "delete";
  layer: ReplacementRuleLayer;
  // Major branch of a branch file, for the branch layer only
  branch?: string;
  // The rule changed, for update and delete
  id?: string;
  // JSON file holding the whole rule: with update, it replaces what the layer stores
  ruleFile?: string;
  // Turns the rule on or off in the layer, adding an override entry when it has none
  enabled?: boolean;
}

// Same rule as sfdx-hardis: lowercase letters, digits and "-"
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// A git branch name that can be written on a command line
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const ORIGINS: ReplacementRuleOrigin[] = [
  "builtin",
  "project",
  "branch",
  "issue",
];
const RESOLVED_SOURCES = ["value", "branch", "default", "secret", "none"];
const MAX_ROWS = 2000;
const MAX_TEXT_LENGTH = 2000;
const MAX_ERROR_LENGTH = 4000;

/**
 * The command the panel reads the rules with. No other flag: an older sfdx-hardis answers that
 * the command does not exist, and the panel says it is too old.
 */
export function buildReplacementListCommand(): string {
  return "sf hardis:project:replacement:list --json";
}

/**
 * The command that computes, on the local files, what the rules would change for a target.
 * @param targetBranch a major branch, or null (or "default") for a dev sandbox or a scratch org
 */
export function buildReplacementPreviewCommand(
  targetBranch: string | null,
  platform: string = process.platform,
): string {
  let command = "sf hardis:project:replacement:preview --agent";
  if (targetBranch && targetBranch !== DEFAULT_TARGET) {
    command += ` --target-branch ${quote(targetBranch, platform)}`;
  }
  return command + " --json";
}

/** The command line of one change of a rule */
export function buildReplacementWriteCommand(
  operation: ReplacementWriteOperation,
  platform: string = process.platform,
): string {
  let command = `sf hardis:project:replacement:${operation.action} --agent --layer ${operation.layer}`;
  if (operation.layer === "branch") {
    command += ` --branch ${quote(operation.branch || "", platform)}`;
  }
  if (operation.id) {
    command += ` --id ${quote(operation.id, platform)}`;
  }
  if (operation.ruleFile) {
    command += ` --rule-file ${quote(operation.ruleFile, platform)}`;
  }
  if (typeof operation.enabled === "boolean") {
    command += ` --enabled ${operation.enabled ? "true" : "false"}`;
  }
  return command + " --json";
}

/**
 * Why an operation sent by the webview cannot run, as an i18n key, or null when it can.
 * Ids and branches end up on a command line: only the names sfdx-hardis accepts pass.
 */
export function checkReplacementWriteOperation(
  operation: ReplacementWriteOperation,
): string | null {
  if (!REPLACEMENT_RULE_LAYERS.includes(operation.layer)) {
    return "replacementRulesInvalidLayer";
  }
  if (
    operation.layer === "branch" &&
    !BRANCH_NAME_PATTERN.test(operation.branch || "")
  ) {
    return "replacementRulesInvalidBranch";
  }
  if (
    operation.action !== "create" &&
    !isValidReplacementRuleId(operation.id)
  ) {
    return "replacementRulesInvalidId";
  }
  return null;
}

/** True for an id sfdx-hardis accepts for a rule, built-in ids included */
export function isValidReplacementRuleId(id: unknown): boolean {
  return typeof id === "string" && RULE_ID_PATTERN.test(id);
}

/** True for a branch name the panel can write on a command line */
export function isSafeReplacementBranch(branch: unknown): boolean {
  return typeof branch === "string" && BRANCH_NAME_PATTERN.test(branch);
}

/**
 * The rule the webview edited, with only the fields of a rule, each of the type sfdx-hardis
 * expects. Empty fields are left out: in an override, a field left out keeps the value of the
 * layer below. A rule that removes an element takes no value.
 */
export function normalizeReplacementRuleDraft(draft: any): ReplacementRule {
  const rule: ReplacementRule = { id: cleanText(draft?.id, 200) };
  const description = cleanText(draft?.description);
  if (description) {
    rule.description = description;
  }
  if (typeof draft?.enabled === "boolean") {
    rule.enabled = draft.enabled;
  }
  if (REPLACEMENT_RULE_TYPES.includes(draft?.type)) {
    rule.type = draft.type;
  }
  const files = asStringList(draft?.files);
  if (files.length > 0) {
    rule.files = files.length === 1 ? files[0] : files;
  }
  if (rule.type !== "text") {
    const xmlPath = cleanText(draft?.xmlPath);
    if (xmlPath) {
      rule.xmlPath = xmlPath;
    }
  }
  if (rule.type === "text" || rule.type === undefined) {
    // A searched text keeps its spaces: they are part of what is found
    const find = typeof draft?.find === "string" ? draft.find : "";
    if (find.trim() !== "") {
      rule.find = find;
      if (draft?.regex === true) {
        rule.regex = true;
      }
    }
  }
  if (rule.type !== "xml-remove") {
    if (typeof draft?.value === "string" && draft.value !== "") {
      rule.value = draft.value;
    } else if (draft?.values && typeof draft.values === "object") {
      const values: Record<string, string> = {};
      for (const [target, value] of Object.entries(draft.values)) {
        if (typeof value === "string" && value !== "" && cleanText(target)) {
          values[cleanText(target)] = value;
        }
      }
      if (Object.keys(values).length > 0) {
        rule.values = values;
      }
    } else if (typeof draft?.secret === "string" && draft.secret.trim()) {
      rule.secret = draft.secret.trim();
    }
  }
  const include = asStringList(draft?.includeTargetBranches);
  if (include.length > 0) {
    rule.includeTargetBranches = include;
  }
  const exclude = asStringList(draft?.excludeTargetBranches);
  if (exclude.length > 0) {
    rule.excludeTargetBranches = exclude;
  }
  if (typeof draft?.required === "boolean" && draft.required) {
    rule.required = true;
  }
  return rule;
}

/**
 * What the answer of sf hardis:project:replacement:list --json means for the panel.
 * @param result the parsed answer of execSfdxJson, a failure included
 */
export function readReplacementListOutcome(
  result: any,
): ReplacementRulesOutcome {
  const read = readReplacementAnswer(result, "definitions");
  return "error" in read
    ? read
    : { view: sanitizeReplacementList(read.answer) };
}

/** What the answer of sf hardis:project:replacement:preview --json means for the panel */
export function readReplacementPreviewOutcome(
  result: any,
): ReplacementPreviewOutcome {
  const read = readReplacementAnswer(result, "results");
  return "error" in read
    ? read
    : { preview: sanitizeReplacementPreview(read.answer) };
}

/**
 * True when the installed sfdx-hardis does not know the replacement rules commands: the sf CLI
 * then answers that the command is not found.
 */
export function isReplacementCommandUnknown(result: any): boolean {
  if (!result || result.status === 0) {
    return false;
  }
  const text = [
    result.name,
    result.code,
    result.message,
    result.stderr,
    result.stdout,
  ]
    .filter((part) => typeof part === "string")
    .join("\n");
  return /CommandNotFound|is not a sf command|command [\w:-]*replacement[\w:-]* not found|Unknown command/i.test(
    text,
  );
}

/** The list answer with only the fields the panel draws, each one of the type it expects */
export function sanitizeReplacementList(answer: any): ReplacementRulesView {
  const effective: Record<string, EffectiveReplacementRule[]> = {};
  if (answer?.effective && typeof answer.effective === "object") {
    for (const [target, rules] of Object.entries(answer.effective)) {
      const name = cleanText(target, 200);
      if (name) {
        effective[name] = asObjects(rules).map(sanitizeEffectiveRule);
      }
    }
  }
  const secretLookups: ReplacementRulesView["secretLookups"] = {};
  if (answer?.secretLookups && typeof answer.secretLookups === "object") {
    for (const [name, lookups] of Object.entries(answer.secretLookups)) {
      secretLookups[cleanText(name, 200)] = asObjects(lookups).map(
        (lookup) => ({
          target: cleanText(lookup.target, 200),
          variables: asStringList(lookup.variables),
        }),
      );
    }
  }
  const layers = answer?.layers || {};
  const issue = layers.issue || {};
  return {
    definitions: asObjects(answer?.definitions)
      .map((definition) => ({
        layer: asLayer(definition.layer),
        branch: cleanText(definition.branch, 200),
        file: cleanText(definition.file),
        rule: sanitizeStoredRule(definition.rule),
        overrides: asOrigins(definition.overrides),
      }))
      .filter((definition) => definition.rule.id !== ""),
    effective,
    builtInRules: asObjects(answer?.builtInRules).map((rule) => ({
      id: cleanText(rule.id, 200),
      description: cleanText(rule.description),
      files: asStringList(rule.files),
      xmlPaths: asStringList(rule.xmlPaths),
      introducedIn: asNumberOrNull(rule.introducedIn),
      removedIn: asNumberOrNull(rule.removedIn),
      defaultEnabled: rule.defaultEnabled === true,
      enabled: rule.enabled === true,
      warnWhenDisabled: rule.warnWhenDisabled === true,
      overriddenIn: asObjects(rule.overriddenIn).map((override) => ({
        layer: asLayer(override.layer),
        branch: cleanText(override.branch, 200),
      })),
      source: cleanText(rule.source),
    })),
    layers: {
      project: {
        file: cleanText(layers.project?.file) || "config/.sfdx-hardis.yml",
        count: asAnswerCount(layers.project?.count),
      },
      branches: asObjects(layers.branches).map((branch) => ({
        branch: cleanText(branch.branch, 200),
        file: cleanText(branch.file),
        count: asAnswerCount(branch.count),
      })),
      issue: {
        available: issue.available === true,
        number: asNumberOrNull(issue.number),
        url: safeWebUrl(issue.url),
        error: cleanText(issue.error, MAX_ERROR_LENGTH),
        count: asAnswerCount(issue.count),
      },
    },
    majorBranches: asObjects(answer?.majorBranches)
      .map((branch) => ({
        branchName: cleanText(branch.branchName, 200),
        level: asAnswerCount(branch.level),
      }))
      .filter((branch) => branch.branchName !== ""),
    secretsProvider: cleanText(answer?.secretsProvider, 50) || "ciVariables",
    secretLookups,
    issues: asObjects(answer?.issues).map((issueItem) => ({
      ruleId: cleanText(issueItem.ruleId, 200),
      layer: cleanText(issueItem.layer, 50),
      branch: cleanText(issueItem.branch, 200),
      message: cleanText(issueItem.message, MAX_ERROR_LENGTH),
    })),
  };
}

/** The preview answer with only the fields the panel draws */
export function sanitizeReplacementPreview(
  answer: any,
): ReplacementPreviewView {
  const target = answer?.target || {};
  return {
    target: {
      targetBranch: cleanText(target.targetBranch, 200) || null,
      label: cleanText(target.label, 200),
      apiVersion: asNumberOrNull(target.apiVersion),
    },
    results: asObjects(answer?.results).map((result) => ({
      file: cleanText(result.file),
      ruleId: cleanText(result.ruleId, 200),
      origins: asOrigins(result.origins),
      status: PREVIEW_STATUSES.includes(result.status)
        ? result.status
        : "unchanged",
      count: asAnswerCount(result.count),
      detail: cleanText(result.detail),
    })),
    warnings: asObjects(answer?.warnings).map((warning) => ({
      kind: cleanText(warning.kind, 50),
      ruleId: cleanText(warning.ruleId, 200),
      message: cleanText(warning.message, MAX_ERROR_LENGTH),
    })),
    appliedRules: asObjects(answer?.appliedRules).map((rule) => ({
      id: cleanText(rule.id, 200),
      origins: asOrigins(rule.origins),
      files: asAnswerCount(rule.files),
    })),
  };
}

/** Message of a failed --json command, as sfdx-hardis wrote it */
export function replacementErrorMessage(result: any): string {
  return failedCommandMessage(result, MAX_ERROR_LENGTH, [
    result?.result?.message,
  ]);
}

/**
 * The answer of a replacement --json command when it worked and holds its list, else the error
 * to show: an sfdx-hardis without the command, or the message of the failure.
 * @param listKey the list a working answer always holds (ex: "definitions")
 */
function readReplacementAnswer(
  result: any,
  listKey: string,
): { answer: any } | { error: ReplacementRulesPanelError } {
  if (isReplacementCommandUnknown(result)) {
    return { error: { kind: "cliTooOld", message: "" } };
  }
  const answer = result?.result;
  if (
    result?.status === 0 &&
    answer &&
    typeof answer === "object" &&
    Array.isArray(answer[listKey])
  ) {
    return { answer };
  }
  return {
    error: { kind: "other", message: replacementErrorMessage(result) },
  };
}

function sanitizeStoredRule(rule: any): ReplacementRule {
  const stored: ReplacementRule = { id: cleanText(rule?.id, 200) };
  if (typeof rule?.description === "string") {
    stored.description = cleanText(rule.description);
  }
  if (typeof rule?.enabled === "boolean") {
    stored.enabled = rule.enabled;
  }
  if (REPLACEMENT_RULE_TYPES.includes(rule?.type)) {
    stored.type = rule.type;
  }
  if (typeof rule?.files === "string" || Array.isArray(rule?.files)) {
    const files = asStringList(rule.files);
    stored.files = typeof rule.files === "string" ? files[0] || "" : files;
  }
  for (const key of ["xmlPath", "find", "value", "secret"] as const) {
    if (typeof rule?.[key] === "string") {
      stored[key] = String(rule[key]).slice(0, MAX_TEXT_LENGTH);
    }
  }
  if (typeof rule?.regex === "boolean") {
    stored.regex = rule.regex;
  }
  if (rule?.values && typeof rule.values === "object") {
    stored.values = asStringMap(rule.values);
  }
  if (Array.isArray(rule?.includeTargetBranches)) {
    stored.includeTargetBranches = asStringList(rule.includeTargetBranches);
  }
  if (Array.isArray(rule?.excludeTargetBranches)) {
    stored.excludeTargetBranches = asStringList(rule.excludeTargetBranches);
  }
  if (typeof rule?.required === "boolean") {
    stored.required = rule.required;
  }
  return stored;
}

function sanitizeEffectiveRule(rule: any): EffectiveReplacementRule {
  const resolved = rule?.resolved || {};
  return {
    id: cleanText(rule?.id, 200),
    description: cleanText(rule?.description),
    type: REPLACEMENT_RULE_TYPES.includes(rule?.type) ? rule.type : "",
    files: asStringList(rule?.files),
    xmlPath: cleanText(rule?.xmlPath),
    find:
      typeof rule?.find === "string" ? rule.find.slice(0, MAX_TEXT_LENGTH) : "",
    regex: rule?.regex === true,
    secret: cleanText(rule?.secret, 200),
    enabled: rule?.enabled !== false,
    origins: asOrigins(rule?.origins),
    builtIn: rule?.builtIn === true,
    applies: rule?.applies !== false,
    required: rule?.required === true,
    resolved: {
      source: RESOLVED_SOURCES.includes(resolved.source)
        ? resolved.source
        : "none",
      // A secret value never comes from sfdx-hardis: only the names of its variables
      value:
        resolved.source === "secret" || typeof resolved.value !== "string"
          ? ""
          : resolved.value.slice(0, MAX_TEXT_LENGTH),
      variables: asStringList(resolved.variables),
    },
  };
}

function asLayer(value: unknown): ReplacementRuleLayer {
  return REPLACEMENT_RULE_LAYERS.includes(value as ReplacementRuleLayer)
    ? (value as ReplacementRuleLayer)
    : "project";
}

function asOrigins(value: unknown): ReplacementRuleOrigin[] {
  return (Array.isArray(value) ? value : []).filter((origin) =>
    ORIGINS.includes(origin),
  );
}

function asObjects(value: unknown): any[] {
  return asAnswerObjects(value, MAX_ROWS);
}

function asStringList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((item) => typeof item === "string")
    .map((item) => cleanText(item))
    .filter((item) => item !== "")
    .slice(0, MAX_ROWS);
}

function asStringMap(value: any): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (typeof item === "string" && cleanText(key, 200)) {
      map[cleanText(key, 200)] = item.slice(0, MAX_TEXT_LENGTH);
    }
  }
  return map;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return cleanAnswerText(value, maxLength);
}

/**
 * Title of the progress notification of a change: what is written, and where (the project
 * file, a branch file, or the issue of the git provider), as an i18n key and its variables.
 */
export function describeWriteRequest(
  operations: Array<ReplacementWriteOperation & { rule?: any }>,
  layers?: ReplacementRulesView["layers"] | null,
): {
  key: string;
  vars: Record<string, string>;
  placeKey?: string;
  placeVars?: Record<string, string>;
} {
  const first = operations[0];
  const id = String(first?.id || first?.rule?.id || "");
  const place = describeWritePlace(first, layers);
  if (typeof first?.enabled === "boolean") {
    return {
      key: first.enabled
        ? "replacementRulesTurningOnIn"
        : "replacementRulesTurningOffIn",
      vars: { id },
      ...place,
    };
  }
  if (first?.action === "delete") {
    return { key: "replacementRulesDeletingFrom", vars: { id }, ...place };
  }
  if (operations.length > 1) {
    return { key: "replacementRulesMovingTo", vars: { id }, ...place };
  }
  return { key: "replacementRulesSavingIn", vars: { id }, ...place };
}

// The place of an operation: a file path shown as is, or the issue, translated by the caller
function describeWritePlace(
  operation: ReplacementWriteOperation | undefined,
  layers?: ReplacementRulesView["layers"] | null,
): { placeKey?: string; placeVars?: Record<string, string>; vars?: never } & {
  place?: string;
} {
  if (!operation) {
    return {};
  }
  if (operation.layer === "issue") {
    const issueNumber = layers?.issue?.number;
    return issueNumber
      ? {
          placeKey: "replacementRulesPlaceIssueNumber",
          placeVars: { number: String(issueNumber) },
        }
      : { placeKey: "replacementRulesPlaceIssue", placeVars: {} };
  }
  if (operation.layer === "branch") {
    const branch = String(operation.branch || "");
    const known = (layers?.branches || []).find(
      (item) => item.branch === branch.replace(/\//g, "__"),
    );
    return {
      place:
        known?.file ||
        `config/branches/.sfdx-hardis.${branch.replace(/\//g, "__")}.yml`,
    };
  }
  return { place: layers?.project?.file || "config/.sfdx-hardis.yml" };
}
