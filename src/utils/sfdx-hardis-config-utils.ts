import * as vscode from "vscode";
import { getConfig } from "./pipeline/sfdxHardisConfig";
import * as yaml from "js-yaml";
import * as fs from "fs-extra";
import * as path from "path";
import axios from "axios";
import { t } from "../i18n/i18n";

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
  /** SLDS/Lightning icon name for the welcome LWC (e.g. "utility:apex"). Defaults to "utility:apex". */
  sldsIcon?: string;
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
  /** SLDS/Lightning icon name for the welcome LWC card (e.g. "utility:apps"). Defaults to "utility:apps". */
  sldsIcon?: string;
  /** Optional description shown under the menu label in the welcome panel */
  description?: string;
}

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

/** Returns true once both project config and extension settings config data are ready */
export function isAllConfigLoaded(): boolean {
  return projectConfigLoaded && settingsConfigLoaded;
}

export async function resetSfdxHardisConfigCache() {
  PROJECT_CONFIG = null;
  REMOTE_CONFIGS = {};
  IN_FLIGHT_PROJECT_CONFIG = null;
  IN_FLIGHT_EXTENSION_CONFIG = null;
  projectConfigLoaded = false;
  settingsConfigLoaded = false;
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
      menus: applyDefaultCommandIcons(projectConfig.customCommands),
      position: projectConfig.customCommandsPosition || "last",
    });
  }

  const settingsConfig = await loadExtensionSettingsSfdxHardisConfiguration();
  if (settingsConfig.customCommands) {
    result.push({
      menus: applyDefaultCommandIcons(settingsConfig.customCommands),
      position: settingsConfig.customCommandsPosition || "last",
    });
  }

  return result;
}

function applyDefaultCommandIcons(customCommands: CustomCommandMenu[]): CustomCommandMenu[] {
  const customLabel = t("customMenuLabel");
  return customCommands.map((menu) => ({
    ...menu,
    label: `${menu.label} ${customLabel}`,
    vscodeIcon: menu.vscodeIcon ?? "symbol-misc",
    sldsIcon: menu.sldsIcon ?? "utility:apps",
    commands: (menu.commands || []).map((cmd) => ({
      ...cmd,
      icon: cmd.icon ?? "cloudity-logo.svg",
      vscodeIcon: cmd.vscodeIcon ?? "run",
      sldsIcon: cmd.sldsIcon ?? "utility:apex",
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

// Read filesystem config file
export async function loadFromLocalConfigFile(file: string): Promise<any> {
  try {
    const localConfig = yaml.load(fs.readFileSync(file).toString());
    return localConfig;
  } catch {
    return {};
  }
}