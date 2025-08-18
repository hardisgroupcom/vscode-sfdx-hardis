import * as vscode from "vscode";
import { Logger } from "../logger";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export type CacheSection = "app" | "project" | "orgs";

export class CacheManager {
  private static store: vscode.Memento;
  private static KEYS_INDEX = "__cacheKeys"; // track stored keys safely

  static init(store: vscode.Memento) {
    this.store = store;
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

  static async set<T>(
    section: CacheSection,
    key: string,
    value: T,
    ttlMs: number
  ): Promise<void> {
    const fullKey = this.makeKey(section, key);
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
    };
    await this.store.update(fullKey, entry);
    await this.trackKey(fullKey);
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
    // Log cache hit with expiration in seconds
    const expiresInSeconds = Math.floor((entry.expiresAt - Date.now()) / 1000);
    // Convert seconds in days, hours and minutes format
    const expiresInDaysHoursMinutes = `${Math.floor(expiresInSeconds / 86400)}d ${Math.floor((expiresInSeconds % 86400) / 3600)}h ${Math.floor((expiresInSeconds % 3600) / 60)}m`;
    Logger.log(`Cache hit for ${section}:${key} (expires in ${expiresInDaysHoursMinutes})`);
    return entry.value;
  }

  static has(section: CacheSection, key: string): boolean {
    return this.get(section, key) !== undefined;
  }

  static async delete(section?: CacheSection, key?: string): Promise<void> {
    const keys = this.store.get<string[]>(this.KEYS_INDEX) || [];

    let toDelete: string[] = [];

    if (!section && !key) {
      // delete all
      toDelete = [...keys];
    } else if (section && !key) {
      // delete all in section
      toDelete = keys.filter(k => k.startsWith(section + ":"));
    } else if (section && key) {
      // delete specific
      toDelete = [this.makeKey(section, key)];
    }

    for (const k of toDelete) {
      await this.store.update(k, undefined);
    }

    // update index
    const remaining = keys.filter(k => !toDelete.includes(k));
    await this.store.update(this.KEYS_INDEX, remaining);
  }

  static async clearExpired(): Promise<void> {
    const keys = this.store.get<string[]>(this.KEYS_INDEX) || [];
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const k of keys) {
      const entry = this.store.get<CacheEntry<unknown>>(k);
      if (entry && entry.expiresAt < now) {
        expiredKeys.push(k);
        await this.store.update(k, undefined);
      }
    }

    if (expiredKeys.length > 0) {
      const remaining = keys.filter(k => !expiredKeys.includes(k));
      await this.store.update(this.KEYS_INDEX, remaining);
    }
  }
}
