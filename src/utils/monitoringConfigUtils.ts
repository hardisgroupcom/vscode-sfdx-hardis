import * as fs from "fs-extra";
import * as path from "path";
import yaml from "js-yaml";
import simpleGit from "simple-git";
import { execSfdxJson, getWorkspaceRoot } from "../utils";
import { CacheManager } from "./cache-manager";
import { Logger } from "../logger";

export type MonitoringFrequency =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "off";

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type NotificationThreshold =
  | "critical"
  | "error"
  | "warning"
  | "info"
  | "success"
  | "log"
  | "off";

export type NotificationChannel = "messaging" | "email" | "api";

export interface MonitoringEmailChannel {
  threshold?: NotificationThreshold;
  recipients?: string[];
  replaceRecipients?: boolean;
}

export interface MonitoringNotifications {
  messaging?: NotificationThreshold;
  email?: NotificationThreshold | MonitoringEmailChannel;
  api?: NotificationThreshold;
}

export interface MonitoringCommandEntry {
  key: string;
  title?: string;
  command?: string;
  category?: string;
  frequency?: MonitoringFrequency;
  frequencyDay?: Weekday;
  frequencyDayOfMonth?: number;
  notificationTypes?: string[];
}

export interface NotificationConfigEntry {
  key: string;
  title?: string;
  category?: string;
  notifications?: MonitoringNotifications;
}

export interface MonitoringCommandDefault {
  key: string;
  title: string;
  description?: string;
  category: string;
  command?: string;
  frequency?: MonitoringFrequency;
  frequencyDay?: Weekday;
  frequencyDayOfMonth?: number;
  notificationTypes?: string[];
}

export interface NotificationConfigDefault {
  key: string;
  title: string;
  description?: string;
  category: string;
  notifications: Record<NotificationChannel, NotificationThreshold>;
  /**
   * Severities this notification type can actually be emitted with, plus "off".
   * Sorted most-restrictive to least-restrictive; last element is always "off".
   * Drives the threshold selector options in the Workbench.
   */
  availableThresholds?: NotificationThreshold[];
}

export interface MonitoringCatalogCategory {
  key: string;
  title: string;
  description: string;
  order: number;
}

export interface MonitoringCatalogPayload {
  monitoringCommands: MonitoringCommandDefault[];
  notificationConfig: NotificationConfigDefault[];
  categories: MonitoringCatalogCategory[];
  options: {
    frequencies: MonitoringFrequency[];
    frequencyDays: Weekday[];
    thresholds: NotificationThreshold[];
    channels: NotificationChannel[];
  };
}

export interface MonitoringUserConfig {
  monitoringCommands: MonitoringCommandEntry[];
  notificationConfig: NotificationConfigEntry[];
}

const NOTIFICATION_THRESHOLD_ORDER: NotificationThreshold[] = [
  "critical",
  "error",
  "warning",
  "info",
  "success",
  "log",
  "off",
];

const CONFIG_FILE = ".sfdx-hardis.yml";

function getRootConfigPath(): string {
  return path.join(getWorkspaceRoot(), CONFIG_FILE);
}

const MONITORING_DEFAULTS_CMD = "sf hardis:config:monitoring-defaults";
const MONITORING_DEFAULTS_CACHE_KEY = MONITORING_DEFAULTS_CMD + " --json";

function normalizeThresholds(
  thresholds: NotificationThreshold[] | undefined,
): NotificationThreshold[] {
  if (!Array.isArray(thresholds) || thresholds.length === 0) {
    return NOTIFICATION_THRESHOLD_ORDER;
  }
  const thresholdSet = new Set(thresholds);
  const normalized = NOTIFICATION_THRESHOLD_ORDER.filter((threshold) =>
    thresholdSet.has(threshold),
  );
  for (const threshold of thresholds) {
    if (!normalized.includes(threshold)) {
      normalized.push(threshold);
    }
  }
  return normalized;
}

function normalizeMonitoringCatalog(
  payload: MonitoringCatalogPayload,
): MonitoringCatalogPayload {
  return {
    ...payload,
    monitoringCommands: Array.isArray(payload.monitoringCommands)
      ? payload.monitoringCommands
      : [],
    notificationConfig: Array.isArray(payload.notificationConfig)
      ? payload.notificationConfig
      : [],
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    options: {
      ...(payload.options || ({} as MonitoringCatalogPayload["options"])),
      thresholds: normalizeThresholds(payload.options?.thresholds),
    },
  };
}

export async function clearMonitoringCatalogCache(): Promise<void> {
  await CacheManager.delete("app", MONITORING_DEFAULTS_CACHE_KEY);
}

export async function fetchMonitoringCatalog(): Promise<MonitoringCatalogPayload> {
  const res = await execSfdxJson(MONITORING_DEFAULTS_CMD, {
    fail: false,
    output: false,
    debug: false,
    cacheSection: "app",
    cacheExpiration: 1000 * 60 * 60 * 24 * 7,
  });
  if (!res || res.status !== 0 || !res.result) {
    const errorMsg =
      res?.errorMessage || res?.stderr || "Unknown error fetching catalog";
    throw new Error(errorMsg);
  }
  const payload = normalizeMonitoringCatalog(
    res.result as MonitoringCatalogPayload,
  );
  // Detect stale cached payloads produced by an older CLI shape (no monitoringCommands key).
  if (
    !Array.isArray((res.result as any).monitoringCommands) &&
    !Array.isArray((res.result as any).notificationConfig)
  ) {
    await CacheManager.delete("app", MONITORING_DEFAULTS_CACHE_KEY);
    const fresh = await execSfdxJson(MONITORING_DEFAULTS_CMD, {
      fail: false,
      output: false,
      debug: false,
      cacheSection: "app",
      cacheExpiration: 1000 * 60 * 60 * 24 * 7,
    });
    if (fresh?.status === 0 && fresh?.result) {
      return normalizeMonitoringCatalog(
        fresh.result as MonitoringCatalogPayload,
      );
    }
  }
  return payload;
}

/**
 * Read the user-defined `monitoringCommands:` and `notificationConfig:` arrays
 * from the root `.sfdx-hardis.yml`. Returns empty arrays when the file or keys
 * are missing.
 */
export async function readCurrentMonitoringConfig(): Promise<MonitoringUserConfig> {
  const configPath = getRootConfigPath();
  if (!(await fs.pathExists(configPath))) {
    return { monitoringCommands: [], notificationConfig: [] };
  }
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = (yaml.load(raw) as any) || {};
    return {
      monitoringCommands: Array.isArray(parsed.monitoringCommands)
        ? parsed.monitoringCommands
        : [],
      notificationConfig: Array.isArray(parsed.notificationConfig)
        ? parsed.notificationConfig
        : [],
    };
  } catch (e) {
    Logger.log(`Error reading monitoring config from ${configPath}: ${e}`);
    return { monitoringCommands: [], notificationConfig: [] };
  }
}

/**
 * Read `monitoringCommands:` and `notificationConfig:` from `.sfdx-hardis.yml`
 * on another branch (without checkout). Returns empty arrays when the file
 * doesn't exist on that branch or the keys are missing.
 */
export async function readMonitoringConfigFromBranch(
  branch: string,
): Promise<MonitoringUserConfig> {
  const workspaceRoot = getWorkspaceRoot();
  const git = simpleGit(workspaceRoot);
  try {
    const raw = await git.raw(["show", `${branch}:${CONFIG_FILE}`]);
    if (!raw) {
      return { monitoringCommands: [], notificationConfig: [] };
    }
    const parsed = (yaml.load(raw) as any) || {};
    return {
      monitoringCommands: Array.isArray(parsed.monitoringCommands)
        ? parsed.monitoringCommands
        : [],
      notificationConfig: Array.isArray(parsed.notificationConfig)
        ? parsed.notificationConfig
        : [],
    };
  } catch (e) {
    Logger.log(`No ${CONFIG_FILE} on branch ${branch}: ${e}`);
    return { monitoringCommands: [], notificationConfig: [] };
  }
}

export async function listAvailableBranches(): Promise<string[]> {
  const workspaceRoot = getWorkspaceRoot();
  const git = simpleGit(workspaceRoot);
  try {
    const out = await git.raw([
      "for-each-ref",
      "--format=%(refname:short)|%(committerdate:unix)",
      "refs/heads",
      "refs/remotes/origin",
    ]);
    const freshestByLogical = new Map<string, { ref: string; timestamp: number }>();
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.endsWith("/HEAD")) {
        continue;
      }
      const sep = trimmed.lastIndexOf("|");
      const ref = sep === -1 ? trimmed : trimmed.slice(0, sep);
      const timestamp = sep === -1 ? 0 : parseInt(trimmed.slice(sep + 1), 10) || 0;
      const logical = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
      if (!logical.toLowerCase().startsWith("monitoring")) {
        continue;
      }
      const existing = freshestByLogical.get(logical);
      if (!existing || timestamp > existing.timestamp) {
        freshestByLogical.set(logical, { ref, timestamp });
      }
    }
    return Array.from(freshestByLogical.values()).map((entry) => entry.ref);
  } catch (e) {
    Logger.log(`Error listing branches: ${e}`);
    return [];
  }
}

/**
 * Persist `monitoringCommands:` and `notificationConfig:` to the root
 * `.sfdx-hardis.yml`, preserving all other keys and overall file formatting.
 * Either array, if empty, is removed from the YAML so the file stays clean.
 */
export async function saveMonitoringConfig(
  config: MonitoringUserConfig,
): Promise<void> {
  const configPath = getRootConfigPath();
  let existing: Record<string, any> = {};
  if (await fs.pathExists(configPath)) {
    try {
      existing = (yaml.load(await fs.readFile(configPath, "utf8")) as any) || {};
    } catch (e) {
      Logger.log(`Error parsing existing ${configPath}: ${e}`);
      existing = {};
    }
  }
  if (Array.isArray(config.monitoringCommands) && config.monitoringCommands.length > 0) {
    existing.monitoringCommands = config.monitoringCommands;
  }
  else {
    delete existing.monitoringCommands;
  }
  if (Array.isArray(config.notificationConfig) && config.notificationConfig.length > 0) {
    existing.notificationConfig = config.notificationConfig;
  }
  else {
    delete existing.notificationConfig;
  }
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, yaml.dump(existing), "utf8");
}
