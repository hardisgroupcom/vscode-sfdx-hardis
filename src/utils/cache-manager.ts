import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Logger } from "../logger";

interface CacheEntry<T> {
  value?: T;
  // Set when the value is stored in a file instead of globalState (large values)
  largeValueFile?: string;
  expiresAt: number;
}

export type CacheSection = "app" | "project" | "orgs";

// globalState is serialized synchronously on every update, so large values
// must not live there: above this size they are written to a file in the
// extension's globalStorage folder, and only the file name + expiration are
// kept in globalState.
const LARGE_VALUE_THRESHOLD_CHARS = 100_000;
// Absolute cap: a value this big is a design smell, cache a trimmed value instead
const MAX_VALUE_CHARS = 20_000_000;

export class CacheManager {
  private static store: vscode.Memento;
  private static largeValueDir: string | null = null;
  private static KEYS_INDEX = "__cacheKeys"; // track stored keys safely
  // Avoids re-reading/re-parsing a large value file on every get
  private static largeValueMemo: Map<string, unknown> = new Map();

  static init(store: vscode.Memento, storageDirPath?: string) {
    this.store = store;
    this.largeValueMemo = new Map();
    this.largeValueDir = storageDirPath
      ? path.join(storageDirPath, "large-cache")
      : null;
    if (!this.store.get<string[]>(this.KEYS_INDEX)) {
      this.store.update(this.KEYS_INDEX, []);
    }
  }

  private static makeKey(section: CacheSection, key: string) {
    return `${section}:${key}`;
  }

  private static async trackKey(fullKey: string) {
    const keys = this.store.get<string[]>(this.KEYS_INDEX) || [];
    if (!keys.includes(fullKey)) {
      keys.push(fullKey);
      await this.store.update(this.KEYS_INDEX, keys);
    }
  }

  private static largeValueFilePath(fileName: string): string {
    return path.join(this.largeValueDir || "", fileName);
  }

  private static removeLargeValueFile(entry: CacheEntry<unknown>) {
    if (entry?.largeValueFile && this.largeValueDir) {
      try {
        fs.unlinkSync(this.largeValueFilePath(entry.largeValueFile));
      } catch {
        // Already removed (temp cleanup, manual delete): nothing to do
      }
    }
  }

  static async set<T>(
    section: CacheSection,
    key: string,
    value: T,
    ttlMs: number,
  ): Promise<void> {
    const fullKey = this.makeKey(section, key);
    const expiresAt = Date.now() + ttlMs;
    this.largeValueMemo.delete(fullKey);
    // A large value previously stored for this key must not leak on overwrite
    const previousEntry = this.store.get<CacheEntry<unknown>>(fullKey);
    if (previousEntry?.largeValueFile) {
      this.removeLargeValueFile(previousEntry);
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(value) ?? "";
    } catch {
      Logger.log(
        `[vscode-sfdx-hardis][WARNING] Value for cache key ${fullKey} is not serializable: not cached`,
      );
      return;
    }
    if (serialized.length > MAX_VALUE_CHARS) {
      Logger.log(
        `[vscode-sfdx-hardis][WARNING] Value for cache key ${fullKey} is too large to be cached (${serialized.length} characters): cache a trimmed value instead`,
      );
      return;
    }
    let entry: CacheEntry<T>;
    if (serialized.length > LARGE_VALUE_THRESHOLD_CHARS && this.largeValueDir) {
      // Large value: store it in a file, keep only its name in globalState
      const fileName =
        crypto.createHash("md5").update(fullKey).digest("hex") + ".json";
      try {
        fs.mkdirSync(this.largeValueDir, { recursive: true });
        fs.writeFileSync(this.largeValueFilePath(fileName), serialized, "utf8");
      } catch (e: any) {
        Logger.log(
          `[vscode-sfdx-hardis][WARNING] Unable to write large cache file for ${fullKey}: ${e?.message}`,
        );
        return;
      }
      entry = { largeValueFile: fileName, expiresAt: expiresAt };
      this.largeValueMemo.set(fullKey, value);
      Logger.logPerf(
        `Cache value for ${fullKey} stored in file ${fileName} (${serialized.length} characters)`,
      );
    } else {
      entry = { value, expiresAt: expiresAt };
    }
    await this.store.update(fullKey, entry);
    await this.trackKey(fullKey);
    const expiresInDaysHoursMinutes = this.buildHumanExpiry(expiresAt);
    Logger.logPerf(
      `Cache set for ${section}:${key} (expires in ${expiresInDaysHoursMinutes})`,
    );
  }

  static get<T>(section: CacheSection, key: string): T | undefined {
    const fullKey = this.makeKey(section, key);
    const entry = this.store.get<CacheEntry<T>>(fullKey);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.delete(section, key); // auto cleanup expired
      return undefined;
    }
    let value: T | undefined = entry.value;
    if (entry.largeValueFile) {
      if (this.largeValueMemo.has(fullKey)) {
        value = this.largeValueMemo.get(fullKey) as T;
      } else {
        try {
          value = JSON.parse(
            fs.readFileSync(
              this.largeValueFilePath(entry.largeValueFile),
              "utf8",
            ),
          );
          this.largeValueMemo.set(fullKey, value);
        } catch {
          // File removed or unreadable: behave as a cache miss
          this.delete(section, key);
          return undefined;
        }
      }
    }
    // Hot path: keys are already tracked by set(); logging goes through
    // logPerf so cache hits cost nothing when the debug setting is off
    const expiresInDaysHoursMinutes = this.buildHumanExpiry(entry.expiresAt);
    Logger.logPerf(
      `Cache hit for ${section}:${key} (expires in ${expiresInDaysHoursMinutes})`,
    );
    return value;
  }

  static has(section: CacheSection, key: string): boolean {
    return this.get(section, key) !== undefined;
  }

  // ---- Persistent user preferences (no expiration) ----
  // Stored outside the tracked cache keys so cache clears via delete()
  // never reset a user choice.
  private static PREF_PREFIX = "pref:";

  static getPreference<T>(key: string): T | undefined {
    return this.store.get<T>(this.PREF_PREFIX + key);
  }

  static async setPreference<T>(key: string, value: T): Promise<void> {
    await this.store.update(this.PREF_PREFIX + key, value);
  }

  static async delete(section?: CacheSection, key?: string): Promise<void> {
    const keys = this.store.get<string[]>(this.KEYS_INDEX) || [];

    let toDelete: string[] = [];

    if (!section && !key) {
      // delete all
      toDelete = [...keys];
    } else if (section && !key) {
      // delete all in section
      toDelete = keys.filter((k) => k.startsWith(section + ":"));
    } else if (section && key) {
      // delete specific
      toDelete = [this.makeKey(section, key)];
    }

    for (const k of toDelete) {
      const entry = this.store.get<CacheEntry<unknown>>(k);
      if (entry?.largeValueFile) {
        this.removeLargeValueFile(entry);
      }
      this.largeValueMemo.delete(k);
      await this.store.update(k, undefined);
      Logger.log(`Cache deleted for key ${k}`);
    }
  }

  static async clearExpired(): Promise<void> {
    const keys = this.store.get<string[]>(this.KEYS_INDEX) || [];
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const k of keys) {
      const entry = this.store.get<CacheEntry<unknown>>(k);
      if (entry && entry.expiresAt < now) {
        expiredKeys.push(k);
        if (entry.largeValueFile) {
          this.removeLargeValueFile(entry);
        }
        this.largeValueMemo.delete(k);
        await this.store.update(k, undefined);
      }
    }
  }

  // Utility to build human-readable expiry from timestamp
  static buildHumanExpiry(expiresAt: number): string {
    // Log cache hit with expiration in seconds
    const expiresInSeconds = Math.floor((expiresAt - Date.now()) / 1000);
    // Convert seconds in days, hours and minutes format
    const expiresInDaysHoursMinutes = `${Math.floor(expiresInSeconds / 86400)}d ${Math.floor((expiresInSeconds % 86400) / 3600)}h ${Math.floor((expiresInSeconds % 3600) / 60)}m`;
    return expiresInDaysHoursMinutes;
  }
}
