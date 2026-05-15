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
  frequency?: MonitoringFrequency;
  frequencyDay?: Weekday;
  frequencyDayOfMonth?: number;
  notifications?: MonitoringNotifications;
}

export interface MonitoringCatalogEntry {
  key: string;
  kind: "monitoringCommand" | "notificationType";
  title: string;
  description: string;
  category?: string;
  command?: string;
  frequency?: MonitoringFrequency;
  frequencyDay?: Weekday;
  frequencyDayOfMonth?: number;
  notifications: Record<NotificationChannel, NotificationThreshold>;
}

export interface MonitoringCatalogCategory {
  key: string;
  title: string;
  description: string;
  order: number;
}

export interface MonitoringCatalogPayload {
  entries: MonitoringCatalogEntry[];
  categories: MonitoringCatalogCategory[];
  options: {
    frequencies: MonitoringFrequency[];
    frequencyDays: Weekday[];
    thresholds: NotificationThreshold[];
    channels: NotificationChannel[];
  };
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
// execSfdxJson appends " --json" before caching, so the stored key has the suffix
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
    options: {
      ...payload.options,
      thresholds: normalizeThresholds(payload.options?.thresholds),
    },
  };
}

/**
 * Fetch the monitoring catalog (defaults + option lists) from sfdx-hardis CLI.
 * Throws if the command is unavailable so callers can prompt the user to upgrade.
 */
export async function fetchMonitoringCatalog(): Promise<MonitoringCatalogPayload> {
  const res = await execSfdxJson(MONITORING_DEFAULTS_CMD, {
    fail: false,
    output: false,
    debug: false,
    cacheSection: "app",
    cacheExpiration: 1000 * 60 * 60 * 24, // 1 day
  });
  if (!res || res.status !== 0 || !res.result) {
    const errorMsg =
      res?.errorMessage || res?.stderr || "Unknown error fetching catalog";
    throw new Error(errorMsg);
  }
  const payload = normalizeMonitoringCatalog(
    res.result as MonitoringCatalogPayload,
  );
  // Stale cache: old CLI format had no categories. Bust cache and re-fetch once.
  if (!payload.categories || payload.categories.length === 0) {
    await CacheManager.delete("app", MONITORING_DEFAULTS_CACHE_KEY);
    const fresh = await execSfdxJson(MONITORING_DEFAULTS_CMD, {
      fail: false,
      output: false,
      debug: false,
      cacheSection: "app",
      cacheExpiration: 1000 * 60 * 60 * 24,
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
 * Read the current monitoringCommands array from the root .sfdx-hardis.yml.
 * Returns [] if the file or key is missing.
 */
export async function readCurrentMonitoringCommands(): Promise<
  MonitoringCommandEntry[]
> {
  const configPath = getRootConfigPath();
  if (!(await fs.pathExists(configPath))) {
    return [];
  }
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = (yaml.load(raw) as any) || {};
    const list = parsed.monitoringCommands;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    Logger.log(`Error reading monitoringCommands from ${configPath}: ${e}`);
    return [];
  }
}

/**
 * Read monitoringCommands from .sfdx-hardis.yml on another branch (without checkout).
 * Returns [] if the file doesn't exist on that branch or the key is missing.
 */
export async function readMonitoringCommandsFromBranch(
  branch: string,
): Promise<MonitoringCommandEntry[]> {
  const workspaceRoot = getWorkspaceRoot();
  const git = simpleGit(workspaceRoot);
  try {
    const raw = await git.raw(["show", `${branch}:${CONFIG_FILE}`]);
    if (!raw) {
      return [];
    }
    const parsed = (yaml.load(raw) as any) || {};
    const list = parsed.monitoringCommands;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    Logger.log(`No ${CONFIG_FILE} on branch ${branch}: ${e}`);
    return [];
  }
}

/**
 * List local + remote-tracking branches in the workspace's git repo.
 * Filters out HEAD pointer refs (e.g. origin/HEAD).
 */
export async function listAvailableBranches(): Promise<string[]> {
  const workspaceRoot = getWorkspaceRoot();
  const git = simpleGit(workspaceRoot);
  try {
    const out = await git.raw([
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes/origin",
    ]);
    const branches = out
      .split(/\r?\n/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !b.endsWith("/HEAD"));
    return Array.from(new Set(branches));
  } catch (e) {
    Logger.log(`Error listing branches: ${e}`);
    return [];
  }
}

/**
 * Persist the monitoringCommands array to the root .sfdx-hardis.yml,
 * preserving all other keys and overall file formatting.
 */
export async function saveMonitoringCommands(
  commands: MonitoringCommandEntry[],
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
  existing.monitoringCommands = commands;
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, yaml.dump(existing), "utf8");
}
