/*
On-disk cache for the DevOps Pipeline queries whose answer can never change.

A "go live" is the merge of a preprod-like branch into a top branch. The set of Pull Requests it
carried is fixed the moment that merge commit exists: the commits it introduced are those between
the merge commit and its first parent, and neither moves again. Recomputing it costs a
getCommitsBatch plus one Pull Request listing per branch, on every reload of the pipeline.

The provider already memoizes this per instance (`latestMergePrCache`), but that map lives and dies
with the provider: opening the pipeline again, refreshing it, or reloading the window pays the full
price once more. This store keeps it between sessions.

Only IMMUTABLE answers belong here. The window of a branch that is still receiving merges does not:
it moves every time someone merges.

  ~/.sfdx/sfdx-hardis-pipeline-cache/<sanitized repository key>.json

  {
    "version": 1,
    "repository": "dev.azure.com/acme/salesforce/_git/sfdx-project",
    "entries": { "<key>": { "value": <json>, "cachedAt": "2026-09-08T..." } }
  }

Set NO_CACHE=true, or SFDX_HARDIS_NO_PIPELINE_CACHE=true, to bypass it.
*/

import * as os from "os";
import * as path from "path";
import { sanitizeRepositoryKey } from "./pullRequestDescriptionCache";
import {
  isEntryExpired,
  pruneCacheEntries,
  readCacheFileEntries,
  writeCacheFileAtomically,
} from "./cacheFileStore";

export const PIPELINE_CACHE_VERSION = 1;

// A go live never changes, but a repository can be rewritten (a force push, a migration), so an
// entry does not live forever
export const MAX_AGE_DAYS = 30;

// Keeps the file small enough to read on every pipeline load
export const MAX_ENTRIES_PER_REPOSITORY = 500;

interface CacheEntry {
  value: unknown;
  cachedAt: string;
}

interface PipelineCacheFile {
  version: number;
  repository: string;
  entries: Record<string, CacheEntry>;
}

const MEMORY_CACHE: Map<string, PipelineCacheFile> = new Map();

export function isPipelineQueryCacheDisabled(): boolean {
  return (
    !!process.env?.NO_CACHE || !!process.env?.SFDX_HARDIS_NO_PIPELINE_CACHE
  );
}

export function pipelineCacheDir(): string {
  return path.join(os.homedir(), ".sfdx", "sfdx-hardis-pipeline-cache");
}

export function pipelineCacheFile(repositoryKey: string): string {
  return path.join(
    pipelineCacheDir(),
    `${sanitizeRepositoryKey(repositoryKey)}.json`,
  );
}

function isExpired(entry: CacheEntry): boolean {
  return isEntryExpired(entry, MAX_AGE_DAYS);
}

function readCacheFile(repositoryKey: string): PipelineCacheFile {
  const inMemory = MEMORY_CACHE.get(repositoryKey);
  if (inMemory) {
    return inMemory;
  }
  const loaded: PipelineCacheFile = {
    version: PIPELINE_CACHE_VERSION,
    repository: repositoryKey,
    entries: readCacheFileEntries<CacheEntry>(
      pipelineCacheFile(repositoryKey),
      PIPELINE_CACHE_VERSION,
      "entries",
    ),
  };
  MEMORY_CACHE.set(repositoryKey, loaded);
  return loaded;
}

/** The cached answer of an immutable query, or undefined when there is none to use. */
export function getCachedPipelineQuery<T>(
  repositoryKey: string,
  key: string,
): T | undefined {
  if (isPipelineQueryCacheDisabled()) {
    return undefined;
  }
  const entry = readCacheFile(repositoryKey).entries[key];
  if (!entry || isExpired(entry)) {
    return undefined;
  }
  return entry.value as T;
}

/**
 * Remember the answer of an immutable query.
 *
 * The file is re-read and merged before being written, then written through a temporary file and
 * renamed, so two VS Code windows on the same repository cannot lose each other's entries or leave
 * a half-written file behind.
 */
export function setCachedPipelineQuery(
  repositoryKey: string,
  key: string,
  value: unknown,
): void {
  if (isPipelineQueryCacheDisabled() || value === undefined) {
    return;
  }
  const cache = readCacheFile(repositoryKey);
  cache.entries[key] = { value, cachedAt: new Date().toISOString() };
  const file = pipelineCacheFile(repositoryKey);
  try {
    // Merge with whatever another window wrote since this one loaded the file
    const onDisk = readCacheFileEntries<CacheEntry>(
      file,
      PIPELINE_CACHE_VERSION,
      "entries",
    );
    const merged = pruneEntries({ ...onDisk, ...cache.entries });
    cache.entries = merged;
    MEMORY_CACHE.set(repositoryKey, cache);
    const payload: PipelineCacheFile = {
      version: PIPELINE_CACHE_VERSION,
      repository: repositoryKey,
      entries: merged,
    };
    writeCacheFileAtomically(file, payload);
  } catch {
    // The cache is an optimization: failing to write it must never break the pipeline view
  }
}

// Drops the expired entries, then the oldest ones above the per-repository cap
export function pruneEntries(
  entries: Record<string, CacheEntry>,
): Record<string, CacheEntry> {
  return pruneCacheEntries(entries, MAX_AGE_DAYS, MAX_ENTRIES_PER_REPOSITORY);
}

// Testing seam: forget what was loaded so the next read goes back to the file
export function resetPipelineQueryCacheMemory(): void {
  MEMORY_CACHE.clear();
}
