/*
What the two on-disk caches of the DevOps Pipeline have in common.

`pullRequestDescriptionCache` and `pipelineQueryCache` both keep one JSON file per repository under
~/.sfdx, both age their entries out, both cap how many a repository may hold, and both write
through a temporary file so two writers cannot leave a half-written file behind.

Only the shape of an entry, the name of the map that holds them and the two limits differ, so those
are the parameters. The on-disk format of each cache stays the business of each cache: this module
is handed a file name and a payload, it never decides either.
*/

import * as fs from "fs";
import * as path from "path";

/** The one field every cached entry carries: when it was written, as an ISO string. */
export interface DatedCacheEntry {
  cachedAt: string;
}

/** An entry with no readable date is treated as expired, so a corrupted one is never served. */
export function isEntryExpired(
  entry: DatedCacheEntry | undefined | null,
  maxAgeDays: number,
): boolean {
  const cachedAt = Date.parse(entry?.cachedAt || "");
  if (isNaN(cachedAt)) {
    return true;
  }
  return Date.now() - cachedAt > maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Drops the expired entries, then the oldest ones above the per-repository cap. */
export function pruneCacheEntries<T extends DatedCacheEntry>(
  entries: Record<string, T>,
  maxAgeDays: number,
  maxEntries: number,
): Record<string, T> {
  const alive = Object.entries(entries).filter(
    ([, entry]) => entry && !isEntryExpired(entry, maxAgeDays),
  );
  if (alive.length <= maxEntries) {
    return Object.fromEntries(alive);
  }
  const newestFirst = alive.sort(
    (a, b) => Date.parse(b[1].cachedAt || "") - Date.parse(a[1].cachedAt || ""),
  );
  return Object.fromEntries(newestFirst.slice(0, maxEntries));
}

/**
 * The entries held by a cache file, or an empty map when there is nothing usable to read.
 *
 * A file written by a newer version is left alone rather than misread, and an unreadable one is not
 * an error: it only means the next read costs the API calls the cache would have saved.
 */
export function readCacheFileEntries<T>(
  file: string,
  version: number,
  entriesProperty: string,
): Record<string, T> {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (parsed?.version === version && parsed?.[entriesProperty]) {
        return parsed[entriesProperty] as Record<string, T>;
      }
    }
  } catch {
    // Corrupted or unreadable file: the caller starts from an empty cache
  }
  return {};
}

/**
 * Writes a cache file through a temporary file and renames it, so a concurrent reader sees either
 * the previous file or the new one, never half of either.
 */
export function writeCacheFileAtomically(file: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload));
  fs.renameSync(tempFile, file);
}
