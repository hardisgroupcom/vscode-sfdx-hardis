import * as vscode from "vscode";
import { getConfig } from "./pipeline/sfdxHardisConfig";
import * as yaml from "js-yaml";
import * as fs from "fs-extra";
import * as path from "path";
import axios from "axios";
import { t } from "../i18n/i18n";
import { execSfdxJson } from "../utils";
import { Logger } from "../logger";

/** A single command entry inside a custom menu */
export interface CustomCommand {
  /** Unique identifier for the command */
  id: string;
  /** Display label shown in the menu */
  label: string;
  /** CLI command line to execute when clicked */
  command: string;
  /** SVG icon filename (e.g. "file.svg"). Defaults to "cloudity-logo.svg" if omitted. */
  icon?: string;
  /** Tooltip text shown on hover */
  tooltip?: string;
  /** URL to open as help documentation */
  helpUrl?: string;
  /** VS Code ThemeIcon id for the command tree item (e.g. "run"). Defaults to "run". */
  vscodeIcon?: string;
  /** VS Code ThemeColor token id applied to the command icon (e.g. "charts.blue"). */
  vscodeIconColor?: string;
  /** SLDS/Lightning icon name for the welcome LWC (e.g. "utility:apex"). Defaults to "utility:apex". */
  sldsIcon?: string;
  /** Source of this command, used to style and label it in UI. */
  sourceType?: CustomCommandsSource;
  /** CSS classes for the icon container in the welcome panel. */
  welcomeIconClass?: string;
}

/** A menu group that groups related custom commands */
export interface CustomCommandMenu {
  /** Unique identifier for the menu */
  id: string;
  /** Display label for the menu group */
  label: string;
  /** Commands listed under this menu */
  commands?: CustomCommand[];
  /** VS Code ThemeIcon id for the section tree item (e.g. "symbol-misc"). Defaults to "symbol-misc". */
  vscodeIcon?: string;
  /** VS Code ThemeColor token id applied to the section icon (e.g. "charts.blue"). */
  vscodeIconColor?: string;
  /** SLDS/Lightning icon name for the welcome LWC card (e.g. "utility:apps"). Defaults to "utility:apps". */
  sldsIcon?: string;
  /** Optional description shown under the menu label in the welcome panel */
  description?: string;
  /** Source of this menu, used to style and label it in UI. */
  sourceType?: CustomCommandsSource;
  /** CSS classes for the icon container in the welcome panel. */
  welcomeIconClass?: string;
}

/** Source type for menus and commands contributed to the custom commands UI */
export type CustomCommandsSource = "custom" | "plugin";

/** Insertion position for a custom command source's menus in the commands tree */
export type CustomCommandsPosition = "first" | "last";

/** Result item returned by listCustomCommands() — one per config source */
export interface CustomCommandsGroup {
  menus: CustomCommandMenu[];
  position: CustomCommandsPosition;
}

let PROJECT_CONFIG: any = null;
let REMOTE_CONFIGS: Record<string, any> = {};
let IN_FLIGHT_PROJECT_CONFIG: Promise<any> | null = null;
let IN_FLIGHT_EXTENSION_CONFIG: Promise<any> | null = null;
let projectConfigLoaded = false;
let settingsConfigLoaded = false;
let pluginCommandsLoaded = false;
let IN_FLIGHT_PLUGIN_COMMANDS: Promise<CustomCommandsGroup[]> | null = null;
let CACHED_PLUGIN_COMMANDS: CustomCommandsGroup[] = [];
let CUSTOM_AND_PLUGINS_COMMANDS: Set<string> = new Set();

/** Returns true once both project config and extension settings config data are ready */
export function isAllConfigLoaded(): boolean {
  return projectConfigLoaded && settingsConfigLoaded;
}

/** Returns true once plugin custom commands have been discovered */
export function isPluginCommandsLoaded(): boolean {
  return pluginCommandsLoaded;
}

/** Returns true once both config-based and plugin-based custom commands are ready */
export function isAllCustomCommandsLoaded(): boolean {
  return isAllConfigLoaded() && pluginCommandsLoaded;
}

/**
 * Loads both config-based and plugin-based custom command groups in parallel.
 * Returns the combined list of all groups once both sources are ready.
 * Safe to call multiple times — individual loaders handle in-flight deduplication.
 * Also caches allowed background command prefixes for validation.
 */
export async function loadAllCustomCommandGroups(): Promise<
  CustomCommandsGroup[]
> {
  const [configGroups, pluginGroups] = await Promise.all([
    listCustomCommands(),
    listPluginCustomCommands(),
  ]);
  const allGroups = [...configGroups, ...pluginGroups];

  // Cache allowed background commands
  CUSTOM_AND_PLUGINS_COMMANDS = new Set();
  for (const group of allGroups) {
    for (const menu of group.menus || []) {
      for (const cmd of menu.commands || []) {
        const command = (cmd.command || "").trim();
        CUSTOM_AND_PLUGINS_COMMANDS.add(command);
      }
    }
  }

  return allGroups;
}

/**
 * Returns true if the given command is in the allowed background commands list.
 */
export function isCommandAllowedByCustomOrPluginRegistry(
  command: string,
): boolean {
  return CUSTOM_AND_PLUGINS_COMMANDS.has(command.trim());
}

export async function resetSfdxHardisConfigCache() {
  PROJECT_CONFIG = null;
  REMOTE_CONFIGS = {};
  IN_FLIGHT_PROJECT_CONFIG = null;
  IN_FLIGHT_EXTENSION_CONFIG = null;
  projectConfigLoaded = false;
  settingsConfigLoaded = false;
  pluginCommandsLoaded = false;
  IN_FLIGHT_PLUGIN_COMMANDS = null;
  CACHED_PLUGIN_COMMANDS = [];
  CUSTOM_AND_PLUGINS_COMMANDS = new Set();
}

export async function loadProjectSfdxHardisConfig() {
  if (PROJECT_CONFIG) {
    return PROJECT_CONFIG;
  }
  if (IN_FLIGHT_PROJECT_CONFIG) {
    return IN_FLIGHT_PROJECT_CONFIG;
  }
  IN_FLIGHT_PROJECT_CONFIG = (async () => {
    try {
      const config = await getConfig("project");
      PROJECT_CONFIG = config;
      projectConfigLoaded = true;
      return config;
    } finally {
      IN_FLIGHT_PROJECT_CONFIG = null;
    }
  })();
  return IN_FLIGHT_PROJECT_CONFIG;
}

export async function loadExtensionSettingsSfdxHardisConfiguration() {
  if (IN_FLIGHT_EXTENSION_CONFIG) {
    return IN_FLIGHT_EXTENSION_CONFIG;
  }
  IN_FLIGHT_EXTENSION_CONFIG = (async () => {
    try {
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      if (config.get("customCommandsConfiguration")) {
        // load config
        const customCommandsConfiguration: string =
          config.get("customCommandsConfiguration") || "";
        const remoteConfig = customCommandsConfiguration.startsWith("http")
          ? await loadFromRemoteConfigFile(customCommandsConfiguration)
          : loadFromLocalConfigFile(customCommandsConfiguration);
        settingsConfigLoaded = true;
        return remoteConfig;
      }
      settingsConfigLoaded = true;
      return {};
    } finally {
      IN_FLIGHT_EXTENSION_CONFIG = null;
    }
  })();
  return IN_FLIGHT_EXTENSION_CONFIG;
}

// Fetch remote config file
/* jscpd:ignore-start */
async function loadFromRemoteConfigFile(url: string) {
  if (REMOTE_CONFIGS[url]) {
    return REMOTE_CONFIGS[url];
  }
  const remoteConfigResp = await axios.get(url);
  if (remoteConfigResp.status !== 200) {
    throw new Error(
      "[sfdx-hardis] Unable to read remote configuration file at " +
        url +
        "\n" +
        JSON.stringify(remoteConfigResp),
    );
  }
  const remoteConfig = yaml.load(remoteConfigResp.data);
  REMOTE_CONFIGS[url] = remoteConfig;
  return remoteConfig;
}
/* jscpd:ignore-end */

/**
 * Helper function to get the config file paths for .sfdx-hardis.yml
 * Returns both root and config directory paths
 */
function getSfdxHardisConfigPaths(): {
  rootConfigFile: string;
  configConfigFile: string;
} | null {
  if (!vscode.workspace.workspaceFolders) {
    return null;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const rootConfigFile = path.join(workspaceRoot, `.sfdx-hardis.yml`);
  const configConfigFile = path.join(workspaceRoot, `config/.sfdx-hardis.yml`);
  return { rootConfigFile, configConfigFile };
}

export async function readSfdxHardisConfig(): Promise<any> {
  const configPaths = getSfdxHardisConfigPaths();
  if (configPaths) {
    const { rootConfigFile, configConfigFile } = configPaths;
    if (fs.existsSync(rootConfigFile)) {
      return await loadFromLocalConfigFile(rootConfigFile);
    }
    if (fs.existsSync(configConfigFile)) {
      return await loadFromLocalConfigFile(configConfigFile);
    }
  }
  return {};
}

export async function writeSfdxHardisConfig(
  key: string,
  value: any,
): Promise<any> {
  const configPaths = getSfdxHardisConfigPaths();
  if (configPaths) {
    const { rootConfigFile, configConfigFile } = configPaths;
    const configFile = fs.existsSync(rootConfigFile)
      ? rootConfigFile
      : configConfigFile;
    await fs.ensureDir(path.dirname(configFile));
    const config = await readSfdxHardisConfig();
    config[key] = value;
    await fs.writeFile(configFile, yaml.dump(config));
  }
  return {};
}

/**
 * Returns all custom command menus from both project config and extension settings config.
 * Each entry contains the menus for one source and the desired insertion position.
 * Applies a default icon to each command that does not define one.
 */
export async function listCustomCommands(): Promise<CustomCommandsGroup[]> {
  const result: CustomCommandsGroup[] = [];

  const projectConfig = await loadProjectSfdxHardisConfig();
  if (projectConfig.customCommands) {
    result.push({
      menus: applyDefaultCommandIcons(projectConfig.customCommands, "custom"),
      position: projectConfig.customCommandsPosition || "last",
    });
  }

  const settingsConfig = await loadExtensionSettingsSfdxHardisConfiguration();
  if (settingsConfig.customCommands) {
    result.push({
      menus: applyDefaultCommandIcons(settingsConfig.customCommands, "custom"),
      position: settingsConfig.customCommandsPosition || "last",
    });
  }

  return result;
}

function applyDefaultCommandIcons(
  customCommands: CustomCommandMenu[],
  sourceType: CustomCommandsSource,
): CustomCommandMenu[] {
  const sourceLabel =
    sourceType === "plugin" ? t("pluginMenuLabel") : t("customMenuLabel");
  const iconClass =
    sourceType === "plugin"
      ? "feature-icon-container orange"
      : "feature-icon-container purple";
  const iconColor = sourceType === "plugin" ? "charts.orange" : "charts.blue";
  return customCommands.map((menu) => ({
    ...menu,
    label: `${menu.label} ${sourceLabel}`,
    vscodeIcon: menu.vscodeIcon ?? "symbol-misc",
    vscodeIconColor: menu.vscodeIconColor ?? iconColor,
    sldsIcon: menu.sldsIcon ?? "utility:apps",
    sourceType,
    welcomeIconClass: menu.welcomeIconClass ?? iconClass,
    commands: (menu.commands || []).map((cmd) => ({
      ...cmd,
      label: `${cmd.label} ${sourceLabel}`,
      icon: cmd.icon ?? "cloudity-logo.svg",
      vscodeIcon: cmd.vscodeIcon ?? "run",
      vscodeIconColor: cmd.vscodeIconColor ?? iconColor,
      sldsIcon: cmd.sldsIcon ?? "utility:apex",
      sourceType,
      welcomeIconClass: cmd.welcomeIconClass ?? iconClass,
    })),
  }));
}

/** A custom plugin entry shown in the Dependencies panel */
export interface CustomPlugin {
  /** npm package name of the plugin */
  name: string;
  /** Alternate name used when matching installed plugin output */
  altName?: string;
  /** URL to the plugin documentation or repository */
  helpUrl?: string;
}

/**
 * Returns all custom plugins from both project config and extension settings config.
 */
export async function listCustomPlugins(): Promise<CustomPlugin[]> {
  const result: CustomPlugin[] = [];

  const projectConfig = await loadProjectSfdxHardisConfig();
  result.push(...(projectConfig.customPlugins || []));

  const settingsConfig = await loadExtensionSettingsSfdxHardisConfiguration();
  result.push(...(settingsConfig.customPlugins || []));

  return result;
}

/** Plugins that should never be queried for hardis-commands */
const CORE_PLUGIN_PREFIXES = ["@salesforce/", "@oclif/"];
const KNOWN_PLUGINS = [
  "sfdx-hardis",
  "sfdx-git-delta",
  "sf-git-merge-driver",
  "sfdmu",
  "sfpowerkit",
];

/**
 * Returns the list of non-core installed plugin names (type === "user" or "link").
 * Uses the "app" cache section with a 1-day TTL.
 */
async function listNonCorePluginNames(): Promise<string[]> {
  const result = await execSfdxJson("sf plugins --json", {
    fail: false,
    output: false,
    cacheSection: "app",
    cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
  });
  const plugins: any[] = result?.result ?? result ?? [];
  if (!Array.isArray(plugins)) {
    return [];
  }
  return plugins
    .filter((p: any) => {
      const pType = p.type || "";
      if (pType !== "user" && pType !== "link") {
        return false;
      }
      const name = p.alias || p.name || "";
      return (
        !CORE_PLUGIN_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
        !KNOWN_PLUGINS.includes(name)
      );
    })
    .map((p: any) => p.alias || p.name);
}

/**
 * Queries a single plugin for custom menus/commands via `sf PLUGIN:hardis-commands --json`.
 * Returns a CustomCommandsGroup if the plugin provides menus, otherwise null.
 */
async function fetchPluginHardisCommands(
  pluginName: string,
): Promise<CustomCommandsGroup | null> {
  try {
    const result = await execSfdxJson(
      `sf ${pluginName}:hardis-commands --json`,
      {
        fail: false,
        output: false,
        cacheSection: "app",
        cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
      },
    );
    const data = result?.result ?? result;
    const menus: CustomCommandMenu[] = data?.customCommands ?? [];
    if (menus.length === 0) {
      return null;
    }
    return {
      menus: applyDefaultCommandIcons(menus, "plugin"),
      position: "last",
    };
  } catch (e: any) {
    Logger.log(
      `[sfdx-hardis] Plugin ${pluginName} does not provide hardis-commands: ${e.message || e}`,
    );
    return null;
  }
}

/**
 * Discovers custom menus and commands exposed by installed SF plugins.
 * Queries all non-core plugins in parallel.
 * Results are cached in memory so subsequent calls return instantly.
 */
export async function listPluginCustomCommands(): Promise<
  CustomCommandsGroup[]
> {
  if (pluginCommandsLoaded) {
    return CACHED_PLUGIN_COMMANDS;
  }
  if (IN_FLIGHT_PLUGIN_COMMANDS) {
    return IN_FLIGHT_PLUGIN_COMMANDS;
  }
  IN_FLIGHT_PLUGIN_COMMANDS = (async () => {
    try {
      const pluginNames = await listNonCorePluginNames();
      const results = await Promise.allSettled(
        pluginNames.map((name) => fetchPluginHardisCommands(name)),
      );
      const groups: CustomCommandsGroup[] = [];
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          groups.push(result.value);
        }
      }
      CACHED_PLUGIN_COMMANDS = groups;
      pluginCommandsLoaded = true;
      return groups;
    } finally {
      IN_FLIGHT_PLUGIN_COMMANDS = null;
    }
  })();
  return IN_FLIGHT_PLUGIN_COMMANDS;
}

// Read filesystem config file
export async function loadFromLocalConfigFile(file: string): Promise<any> {
  try {
    const localConfig = yaml.load(fs.readFileSync(file).toString());
    return localConfig;
  } catch {
    return {};
  }
}
