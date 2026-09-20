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

// A value just written is served from memory (see pendingWrites) and checked
// after each of these delays. An echo that drops it lands within a round trip of
// the write that carries it, so it has landed long before the last one: a value
// still there at the end is one globalState kept, and the memory answer stops.
const WRITE_SETTLE_DELAYS_MS = [50, 250, 1000, 1000];

export class CacheManager {
  private static store: vscode.Memento;
  private static largeValueDir: string | null = null;
  private static KEYS_INDEX = "__cacheKeys"; // track stored keys safely
  // Avoids re-reading/re-parsing a large value file on every get
  private static largeValueMemo: Map<string, unknown> = new Map();

  // Values written to globalState that it does not hold (yet).
  //
  // VS Code keeps the whole globalState of an extension in ONE object inside its
  // Memento, and replaces that object wholesale every time the main process
  // echoes a storage change back (mainThreadStorage -> $acceptValue), this
  // window's own writes included. An echo carrying a snapshot taken before a
  // write lands right after it: the key just written disappears from the
  // Memento, and the flush that follows persists that snapshot, without it.
  // update() resolves all the same, so the write is acknowledged and lost. Two
  // writes one tick apart are enough (a panel pushing its state, then saving the
  // choice the user just made), and the loss is silent.
  //
  // Reads are therefore answered from here until globalState is seen holding the
  // value, and a value it dropped is written again.
  private static pendingWrites: Map<string, unknown> = new Map();

  static init(store: vscode.Memento, storageDirPath?: string) {
    this.store = store;
    this.largeValueMemo = new Map();
    this.pendingWrites = new Map();
    this.largeValueDir = storageDirPath
      ? path.join(storageDirPath, "large-cache")
      : null;
    if (!this.read<string[]>(this.KEYS_INDEX)) {
      void this.write(this.KEYS_INDEX, []);
    }
  }

  private static makeKey(section: CacheSection, key: string) {
    return `${section}:${key}`;
  }

  /** What this window last wrote, until globalState is seen holding it */
  private static read<T>(fullKey: string): T | undefined {
    if (this.pendingWrites.has(fullKey)) {
      return this.pendingWrites.get(fullKey) as T | undefined;
    }
    return this.store.get<T>(fullKey);
  }

  /**
   * Writes to globalState and keeps the value readable whatever its Memento does
   * with it. The caller waits for the write itself only: the check that it
   * survived runs in the background.
   */
  private static async write(fullKey: string, value: unknown): Promise<void> {
    this.pendingWrites.set(fullKey, value);
    try {
      await this.store.update(fullKey, value);
    } finally {
      void this.settleWrite(fullKey, value);
    }
  }

  /** True when globalState holds exactly what was written (it clones values, so no identity) */
  private static storeHolds(fullKey: string, value: unknown): boolean {
    const stored = this.store.get(fullKey);
    if (stored === undefined || value === undefined) {
      return stored === value;
    }
    try {
      return JSON.stringify(stored) === JSON.stringify(value);
    } catch {
      return true;
    }
  }

  /**
   * Waits for globalState to hold the value, and writes it again when an echo
   * dropped it: the flush that followed that echo persisted a state without it,
   * so only a new write brings it back for the next VS Code session. The value
   * stays served from memory until then, and for the whole session when
   * globalState keeps refusing it.
   */
  private static async settleWrite(
    fullKey: string,
    value: unknown,
  ): Promise<void> {
    for (const delay of WRITE_SETTLE_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.pendingWrites.get(fullKey) !== value) {
        return; // A newer write owns the key now
      }
      if (!this.storeHolds(fullKey, value)) {
        await this.store.update(fullKey, value).then(undefined, () => undefined);
      }
    }
    if (this.pendingWrites.get(fullKey) !== value) {
      return;
    }
    if (this.storeHolds(fullKey, value)) {
      this.pendingWrites.delete(fullKey);
      return;
    }
    Logger.log(
      `[vscode-sfdx-hardis][WARNING] globalState did not keep ${fullKey}: the value is only held in memory for this session`,
    );
  }

  private static async trackKey(fullKey: string) {
    // A copy: the array read back can be the very one a previous write still holds
    const keys = [...(this.read<string[]>(this.KEYS_INDEX) || [])];
    if (!keys.includes(fullKey)) {
      keys.push(fullKey);
      await this.write(this.KEYS_INDEX, keys);
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
    // Any early return below must leave the previously stored entry (and its
    // file) fully intact: a rejected NEW value must never destroy a still
    // valid OLD one, so nothing is deleted before the new entry is committed
    const previousEntry = this.read<CacheEntry<unknown>>(fullKey);
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
      // Large value: store it in a file, keep only its name in globalState.
      // Written to a temp file then renamed: the deterministic name means
      // another VS Code window can be reading the previous version of this
      // very file, and it must never observe a partial write
      const fileName =
        crypto.createHash("md5").update(fullKey).digest("hex") + ".json";
      const finalPath = this.largeValueFilePath(fileName);
      try {
        fs.mkdirSync(this.largeValueDir, { recursive: true });
        const tmpPath = `${finalPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, serialized, "utf8");
        fs.renameSync(tmpPath, finalPath);
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
      this.largeValueMemo.delete(fullKey);
    }
    await this.write(fullKey, entry);
    // Only now that the new entry is committed: a file the entry no longer
    // references (large -> small transition) must not leak on disk. The
    // large -> large case overwrote the same deterministic file name in place.
    if (previousEntry?.largeValueFile && !entry.largeValueFile) {
      this.removeLargeValueFile(previousEntry);
    }
    await this.trackKey(fullKey);
    const expiresInDaysHoursMinutes = this.buildHumanExpiry(expiresAt);
    Logger.logPerf(
      `Cache set for ${section}:${key} (expires in ${expiresInDaysHoursMinutes})`,
    );
  }

  static get<T>(section: CacheSection, key: string): T | undefined {
    const fullKey = this.makeKey(section, key);
    const entry = this.read<CacheEntry<T>>(fullKey);
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
        } catch (e: any) {
          // A missing or corrupted file is a real miss: drop the entry. A
          // transient read error (EBUSY/EACCES: antivirus scan, file locked by
          // another VS Code window) must NOT delete the shared entry and file
          if (e?.code === "ENOENT" || e instanceof SyntaxError) {
            this.delete(section, key);
          } else {
            Logger.log(
              `[vscode-sfdx-hardis][WARNING] Unable to read large cache file for ${fullKey}: ${e?.message}`,
            );
          }
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
    return this.read<T>(this.PREF_PREFIX + key);
  }

  static async setPreference<T>(key: string, value: T): Promise<void> {
    await this.write(this.PREF_PREFIX + key, value);
  }

  static async delete(section?: CacheSection, key?: string): Promise<void> {
    const keys = this.read<string[]>(this.KEYS_INDEX) || [];

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
      const entry = this.read<CacheEntry<unknown>>(k);
      if (entry?.largeValueFile) {
        this.removeLargeValueFile(entry);
      }
      this.largeValueMemo.delete(k);
      await this.write(k, undefined);
      Logger.log(`Cache deleted for key ${k}`);
    }
  }

  static async clearExpired(): Promise<void> {
    const keys = this.read<string[]>(this.KEYS_INDEX) || [];
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const k of keys) {
      const entry = this.read<CacheEntry<unknown>>(k);
      if (entry && entry.expiresAt < now) {
        expiredKeys.push(k);
        if (entry.largeValueFile) {
          this.removeLargeValueFile(entry);
        }
        this.largeValueMemo.delete(k);
        await this.write(k, undefined);
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
