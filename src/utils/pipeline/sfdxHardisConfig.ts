/*
sfdx-hardis is managed in 3 layers, with the following priority
- project, stored in /config
- branches, stored in /config/branches
- user, stored in /config/users

getConfig(layer) returns:
- project + branches + user if layer is user
- project + branches if layer is branch
- project if layer is project
*/

import axios from "axios";
import c from "chalk";
import { cosmiconfig } from "cosmiconfig";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import * as os from "os";
import * as path from "path";
import { simpleGit } from "simple-git";
import * as child from "child_process";
import { getWorkspaceRoot } from "../../utils";
import { Logger } from "../../logger";

const MODULE_NAME = "sfdx-hardis";
const PROJECT_CONFIG_FILES = [
  "package.json",
  `.${MODULE_NAME}.yaml`,
  `.${MODULE_NAME}.yml`,
  `config/.${MODULE_NAME}.yaml`,
  `config/.${MODULE_NAME}.yml`,
];
const username = os.userInfo().username;
const userConfigFiles = [
  `config/user/.${MODULE_NAME}.${username}.yaml`,
  `config/user/.${MODULE_NAME}.${username}.yml`,
];
const REMOTE_CONFIGS: any = {};
const IN_FLIGHT_CONFIGS: Map<string, Promise<any>> = new Map();

async function getBranchConfigFiles() {
  if (!isGitRepo()) {
    return [];
  }
  const gitBranchFormatted = await getCurrentGitBranch({ formatted: true });
  const branchConfigFiles = [
    `config/branches/.${MODULE_NAME}.${gitBranchFormatted}.yaml`,
    `config/branches/.${MODULE_NAME}.${gitBranchFormatted}.yml`,
  ];
  return branchConfigFiles;
}

export const getConfig = async (
  layer: "project" | "branch" | "user" = "user",
): Promise<any> => {
  if (IN_FLIGHT_CONFIGS.has(layer)) {
    return IN_FLIGHT_CONFIGS.get(layer)!;
  }
  const promise = (async () => {
    try {
      const defaultConfig = await loadFromConfigFile(PROJECT_CONFIG_FILES);
      if (layer === "project") {
        return defaultConfig;
      }
      let branchConfig = await loadFromConfigFile(await getBranchConfigFiles());
      branchConfig = Object.assign(defaultConfig, branchConfig);
      if (layer === "branch") {
        return branchConfig;
      }
      const workspaceRoot = getWorkspaceRoot();
      const userConfigFilesWithWorkspaceRoot = userConfigFiles.map((file) => {
        return path.isAbsolute(file)
          ? file
          : path.join(workspaceRoot || "", file);
      });
      let userConfig = await loadFromConfigFile(
        userConfigFilesWithWorkspaceRoot,
      );
      userConfig = Object.assign(branchConfig, userConfig);
      return userConfig;
    } finally {
      IN_FLIGHT_CONFIGS.delete(layer);
    }
  })();
  IN_FLIGHT_CONFIGS.set(layer, promise);
  return promise;
};

// Set data in configuration file
export const setConfig = async (
  layer: string,
  propValues: any,
): Promise<void> => {
  if (
    layer === "user" &&
    (fs.readdirSync(process.cwd()).length === 0 || !isGitRepo())
  ) {
    console.warn(
      "log",
      this,
      c.grey(
        "Skip update user config file because current directory is not a salesforce project",
      ),
    );
    return;
  }
  const workspaceRoot = getWorkspaceRoot();
  const userConfigFilesWithWorkspaceRoot = userConfigFiles.map((file) => {
    return path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
  });
  const configSearchPlaces =
    layer === "project"
      ? PROJECT_CONFIG_FILES
      : layer === "user"
        ? userConfigFilesWithWorkspaceRoot
        : layer === "branch"
          ? await getBranchConfigFiles()
          : [];
  await setInConfigFile(configSearchPlaces, propValues);
};

// Load configuration from file
async function loadFromConfigFile(searchPlaces: string[]): Promise<any> {
  const workspaceRoot = getWorkspaceRoot();
  const configExplorer = await cosmiconfig(MODULE_NAME, {
    searchPlaces,
  }).search(workspaceRoot);
  let config = configExplorer !== null ? configExplorer.config : {};
  if (config.extends) {
    const remoteConfig = await loadFromRemoteConfigFile(config.extends);
    config = Object.assign(remoteConfig, config);
  }
  return config;
}

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

// Update configuration file
export async function setInConfigFile(
  searchPlaces: string[],
  propValues: any,
  configFile: string = "",
) {
  let explorer;
  if (configFile === "") {
    explorer = cosmiconfig(MODULE_NAME, { searchPlaces });
    const workspaceRoot = getWorkspaceRoot();
    const configExplorer = await explorer.search(workspaceRoot);
    configFile =
      configExplorer !== null
        ? configExplorer.filepath
        : searchPlaces.slice(-1)[0];
  }
  let doc: any = {};
  if (fs.existsSync(configFile)) {
    doc = yaml.load(fs.readFileSync(configFile, "utf-8"));
  }
  doc = Object.assign(doc, propValues);
  await fs.ensureDir(path.dirname(configFile));
  await fs.writeFile(configFile, yaml.dump(doc));
  if (explorer) {
    explorer.clearCaches();
  }
  Logger.log(
    `Updated config file ${c.bold(configFile)} with values: \n${JSON.stringify(propValues, null, 2)}`,
  );
}

let isGitRepoCache: boolean | null = null;
export function isGitRepo() {
  if (isGitRepoCache !== null) {
    return isGitRepoCache;
  }
  const isInsideWorkTree = child.spawnSync(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  isGitRepoCache = isInsideWorkTree.status === 0;
  return isGitRepoCache;
}

export async function getCurrentGitBranch(options: any = { formatted: false }) {
  if (!isGitRepo()) {
    return null;
  }
  let gitBranch: string | null = process.env.CI_COMMIT_REF_NAME || null;
  if (!gitBranch) {
    try {
      gitBranch = (await simpleGit().branchLocal()).current;
    } catch {
      return null;
    }
  }
  if (options.formatted === true) {
    return gitBranch.replace("/", "__");
  }
  return gitBranch;
}
