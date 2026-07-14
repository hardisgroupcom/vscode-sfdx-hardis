import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import * as yaml from "js-yaml";
import { Logger } from "../logger";
import { listMetadataTypes } from "./metadataList";
import {
  readSfdxHardisConfig,
  loadExtensionSettingsSfdxHardisConfiguration,
} from "./sfdx-hardis-config-utils";

/** Key used in .sfdx-hardis.yml to define metadata retriever presets */
export const METADATA_PRESETS_CONFIG_KEY = "metadataRetrieverPresets";

/** Key used in .sfdx-hardis.yml to hide the built-in presets */
export const METADATA_PRESETS_OVERRIDE_KEY =
  "metadataRetrieverPresetsOverrideDefaults";

/**
 * A named group of metadata types, used to query several metadata types at once
 * in the Metadata Retriever panel (instead of one type at a time).
 */
export interface MetadataPreset {
  /** Unique identifier of the preset. Used to override a default preset. */
  id: string;
  /** Display label shown in the preset dropdown */
  label: string;
  /** Optional description shown as a tooltip */
  description?: string;
  /** Metadata API xmlNames included in the preset (e.g. ApexClass, Flow) */
  types: string[];
  /** True when the preset is shipped with the extension (not user-defined) */
  isDefault?: boolean;
}

/**
 * Presets shipped with the extension. They are always available unless
 * `metadataRetrieverPresetsOverrideDefaults: true` is set in .sfdx-hardis.yml.
 * A user preset declaring the same `id` replaces the default one.
 */
export const DEFAULT_METADATA_PRESETS: MetadataPreset[] = [
  {
    id: "developerMetadata",
    label: "Developer Metadata",
    description: "Apex, Flows, LWCs and other code metadata",
    types: [
      "ApexClass",
      "ApexTrigger",
      "AuraDefinitionBundle",
      "CustomLabel",
      "CustomMetadata",
      "Flow",
      "LightningComponentBundle",
      "StaticResource",
    ],
    isDefault: true,
  },
  {
    id: "generalMetadata",
    label: "General Metadata",
    description:
      "Apex, LWC, Objects, fields, validation rules, layouts, profiles and permission sets",
    types: [
      "ApexClass",
      "ApexTrigger",
      "AuraDefinitionBundle",
      "CustomField",
      "CustomLabel",
      "CustomMetadata",
      "CustomObject",
      "FlexiPage",
      "Flow",
      "GlobalValueSet",
      "Layout",
      "LightningComponentBundle",
      "ListView",
      "PermissionSet",
      "PermissionSetGroup",
      "QuickAction",
      "RecordType",
      "StaticResource",
      "ValidationRule",
    ],
    isDefault: true,
  },
];

let KNOWN_METADATA_TYPES: Set<string> | null = null;

function getKnownMetadataTypes(): Set<string> {
  if (!KNOWN_METADATA_TYPES) {
    KNOWN_METADATA_TYPES = new Set(
      listMetadataTypes().map((mt: any) => mt.xmlName),
    );
  }
  return KNOWN_METADATA_TYPES;
}

/**
 * Validates a raw preset coming from a config file and returns a clean preset,
 * or null when the entry is unusable (no label, no valid metadata type...).
 * Unknown metadata types are dropped and logged, so a typo never breaks the panel.
 */
function sanitizePreset(rawPreset: any, source: string): MetadataPreset | null {
  if (!rawPreset || typeof rawPreset !== "object") {
    Logger.log(
      `[sfdx-hardis] Ignored invalid metadata preset in ${source}: not an object`,
    );
    return null;
  }

  const label = (rawPreset.label || rawPreset.name || "").toString().trim();
  if (!label) {
    Logger.log(
      `[sfdx-hardis] Ignored metadata preset without label in ${source}`,
    );
    return null;
  }

  const rawTypes = Array.isArray(rawPreset.types) ? rawPreset.types : [];
  const knownTypes = getKnownMetadataTypes();
  const types: string[] = [];
  for (const rawType of rawTypes) {
    const type = (rawType || "").toString().trim();
    if (!type) {
      continue;
    }
    if (!knownTypes.has(type)) {
      Logger.log(
        `[sfdx-hardis] Ignored unknown metadata type "${type}" in preset "${label}" (${source})`,
      );
      continue;
    }
    if (!types.includes(type)) {
      types.push(type);
    }
  }

  if (types.length === 0) {
    Logger.log(
      `[sfdx-hardis] Ignored metadata preset "${label}" in ${source}: no valid metadata type`,
    );
    return null;
  }

  const id = (rawPreset.id || label).toString().trim();
  const preset: MetadataPreset = {
    id,
    label,
    types: types.sort((a, b) => a.localeCompare(b)),
    isDefault: false,
  };
  if (rawPreset.description) {
    preset.description = rawPreset.description.toString();
  }
  return preset;
}

function sanitizePresets(rawPresets: any, source: string): MetadataPreset[] {
  if (!rawPresets) {
    return [];
  }
  if (!Array.isArray(rawPresets)) {
    Logger.log(
      `[sfdx-hardis] Ignored ${METADATA_PRESETS_CONFIG_KEY} in ${source}: it must be a list`,
    );
    return [];
  }
  return rawPresets
    .map((rawPreset) => sanitizePreset(rawPreset, source))
    .filter((preset): preset is MetadataPreset => preset !== null);
}

/**
 * Returns the metadata presets available in the current workspace.
 *
 * Sources, by increasing priority:
 *  1. Default presets shipped with the extension
 *  2. Presets defined in the shared config file (VsCode setting `customCommandsConfiguration`)
 *  3. Presets defined in the project `.sfdx-hardis.yml` (root or `config/` folder)
 *
 * A user preset having the same `id` as another one replaces it.
 * Set `metadataRetrieverPresetsOverrideDefaults: true` to hide the default presets.
 */
export async function listMetadataPresets(): Promise<MetadataPreset[]> {
  const presetsById = new Map<string, MetadataPreset>();

  let projectConfig: any = {};
  try {
    projectConfig = (await readSfdxHardisConfig()) || {};
  } catch (error: any) {
    Logger.log(
      `[sfdx-hardis] Unable to read .sfdx-hardis.yml metadata presets: ${error?.message || error}`,
    );
  }

  let settingsConfig: any = {};
  try {
    settingsConfig =
      (await loadExtensionSettingsSfdxHardisConfiguration()) || {};
  } catch (error: any) {
    Logger.log(
      `[sfdx-hardis] Unable to read metadata presets from settings config file: ${error?.message || error}`,
    );
  }

  const hideDefaults =
    projectConfig[METADATA_PRESETS_OVERRIDE_KEY] === true ||
    settingsConfig[METADATA_PRESETS_OVERRIDE_KEY] === true;

  if (!hideDefaults) {
    for (const preset of DEFAULT_METADATA_PRESETS) {
      presetsById.set(preset.id, { ...preset, types: [...preset.types] });
    }
  }

  const userPresets = [
    ...sanitizePresets(
      settingsConfig[METADATA_PRESETS_CONFIG_KEY],
      "extension settings config file",
    ),
    ...sanitizePresets(
      projectConfig[METADATA_PRESETS_CONFIG_KEY],
      ".sfdx-hardis.yml",
    ),
  ];
  for (const preset of userPresets) {
    presetsById.set(preset.id, preset);
  }

  return [...presetsById.values()];
}

/** Returns the metadata types of a preset, or an empty array when not found */
export async function getMetadataPresetTypes(
  presetId: string | null,
): Promise<string[]> {
  if (!presetId) {
    return [];
  }
  const presets = await listMetadataPresets();
  const preset = presets.find((item) => item.id === presetId);
  return preset ? [...preset.types] : [];
}

/**
 * Returns the .sfdx-hardis.yml file where presets must be edited.
 * Priority: existing root file, then existing config/ file, then config/ file (default location).
 */
function getPresetsConfigFilePath(): string | null {
  if (!vscode.workspace.workspaceFolders) {
    return null;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const rootConfigFile = path.join(workspaceRoot, ".sfdx-hardis.yml");
  if (fs.existsSync(rootConfigFile)) {
    return rootConfigFile;
  }
  return path.join(workspaceRoot, "config", ".sfdx-hardis.yml");
}

/**
 * Opens the config file where metadata presets are defined.
 * When the file does not define any preset yet, the default ones are appended
 * as a commented, ready-to-edit YAML block (existing content and comments are preserved).
 *
 * @returns The path of the opened file, or null when there is no workspace
 */
export async function openMetadataPresetsConfigFile(): Promise<string | null> {
  const configFile = getPresetsConfigFilePath();
  if (!configFile) {
    return null;
  }

  let hasPresets = false;
  if (fs.existsSync(configFile)) {
    try {
      const config: any = yaml.load(await fs.readFile(configFile, "utf-8"));
      hasPresets = !!(config && config[METADATA_PRESETS_CONFIG_KEY]);
    } catch (error: any) {
      Logger.log(
        `[sfdx-hardis] Unable to parse ${configFile}: ${error?.message || error}`,
      );
    }
  }

  if (!hasPresets) {
    // Append (never rewrite) so user comments and formatting are kept as-is
    await fs.ensureDir(path.dirname(configFile));
    const existingContent = fs.existsSync(configFile)
      ? await fs.readFile(configFile, "utf-8")
      : "";
    const separator =
      existingContent.length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
    await fs.appendFile(
      configFile,
      `${separator}${buildDefaultPresetsYamlBlock()}`,
    );
  }

  const document = await vscode.workspace.openTextDocument(configFile);
  const editor = await vscode.window.showTextDocument(document);

  // Scroll to the presets section
  const lineIndex = document
    .getText()
    .split("\n")
    .findIndex((line) => line.startsWith(METADATA_PRESETS_CONFIG_KEY));
  if (lineIndex >= 0) {
    const position = new vscode.Position(lineIndex, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  return configFile;
}

/** Builds the YAML block written in .sfdx-hardis.yml when no preset is defined yet */
function buildDefaultPresetsYamlBlock(): string {
  const presets = DEFAULT_METADATA_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    types: preset.types,
  }));
  const yamlBody = yaml.dump(
    { [METADATA_PRESETS_CONFIG_KEY]: presets },
    { lineWidth: 120 },
  );
  return [
    "",
    "# Metadata Retriever presets: query several metadata types at once.",
    "# Each preset needs an id, a label and a list of Metadata API types.",
    "# Set metadataRetrieverPresetsOverrideDefaults to true to hide the built-in presets.",
    yamlBody,
  ].join("\n");
}

/** True when the saved file is a .sfdx-hardis.yml config file */
export function isSfdxHardisConfigFile(filePath: string): boolean {
  return path.basename(filePath) === ".sfdx-hardis.yml";
}
