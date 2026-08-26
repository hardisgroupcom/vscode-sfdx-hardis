/*
 * In-process replacements for a few `sf` commands (extension host side).
 *
 * Spawning the Salesforce CLI costs 2.5 to 4 seconds per call, almost all of it
 * startup. The commands handled here only read local auth/config files or do a
 * single API call, which `@salesforce/core` / jsforce do in a few milliseconds
 * (plus the network round trip).
 *
 * `@salesforce/core` is NOT a dependency of this extension: it is loaded at
 * runtime from the user's own Salesforce CLI installation, so the bundle stays
 * small and the core version is always the one the installed `sf` uses.
 *
 * The libraries run in a dedicated worker thread (src/worker.ts): loading core
 * (~1 s of CPU) and running the commands must never compete with the
 * extension host main thread, which is busiest right at startup when these
 * commands are needed.
 *
 * Safety rules:
 * - The JSON returned mirrors the `--json` output of the real command, so
 *   call sites are unchanged.
 * - Anything not recognized (extra flags, scratch org display, unknown keys,
 *   core not found, worker failure, any exception) returns null and the
 *   caller spawns the real `sf`.
 * - Disabled by the "disablePerformanceEnhancementsForSfCommands" setting.
 */
import * as fs from "fs";
import * as path from "path";
import { Worker } from "worker_threads";
import { Logger } from "../logger";
import {
  findExecutable,
  findUpwardsFromExecutable,
} from "./executableUtils";
import { parseSfCommand } from "./sfCoreCommands";
import { isSfPerformanceEnhancementDisabled } from "./sfPerformanceUtils";

// Pure helpers re-exported for the unit tests and the callers
export {
  buildOrgListResult,
  isActiveScratchOrg,
  parseSfCommand,
  tokenizeCommand,
} from "./sfCoreCommands";
export type { ParsedSfCommand } from "./sfCoreCommands";

// A command that has not answered after this delay is handed to the real CLI
const IN_PROCESS_TIMEOUT_MS = 120000;

/**
 * Finds the `@salesforce/core` package shipped inside the installed Salesforce
 * CLI, starting from the resolved `sf` executable and walking up its parent
 * folders. Handles the npm global install (`<prefix>/node_modules/@salesforce/cli`,
 * hoisted or nested core) and the standalone installers (`<root>/bin/sf` +
 * `<root>/node_modules`). Returns null when nothing is found.
 */
export function findSalesforceCoreDir(sfExecutablePath: string): string | null {
  return findUpwardsFromExecutable(
    sfExecutablePath,
    (dir) => [
      path.join(dir, "node_modules", "@salesforce", "core"),
      path.join(
        dir,
        "node_modules",
        "@salesforce",
        "cli",
        "node_modules",
        "@salesforce",
        "core",
      ),
    ],
    (candidate) => fs.existsSync(path.join(candidate, "package.json")),
  );
}

let coreDirPromise: Promise<string | null> | null = null;

// Locates @salesforce/core once. Resolves to null when it can not be found:
// callers then spawn the real CLI.
export function resolveSalesforceCoreDir(): Promise<string | null> {
  if (coreDirPromise) {
    return coreDirPromise;
  }
  coreDirPromise = (async () => {
    try {
      const sfPath = await findExecutable("sf");
      if (!sfPath) {
        Logger.log(
          "[sfdx-hardis][in-process] sf executable not found in PATH, using the CLI for every command",
        );
        return null;
      }
      const coreDir = findSalesforceCoreDir(sfPath);
      if (!coreDir) {
        Logger.log(
          `[sfdx-hardis][in-process] @salesforce/core not found near ${sfPath}, using the CLI for every command`,
        );
      }
      return coreDir;
    } catch (e: any) {
      Logger.log(
        `[sfdx-hardis][in-process] Unable to locate @salesforce/core, using the CLI for every command: ${e?.message}`,
      );
      return null;
    }
  })();
  return coreDirPromise;
}

/* ------------------------------------------------------------------------- */
/* Worker thread                                                              */
/* ------------------------------------------------------------------------- */

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let coreWorker: Worker | null = null;
let coreWorkerFailed = false;
const pendingRequests = new Map<string, PendingRequest>();
let requestSeq = 0;

function rejectAllPending(reason: Error): void {
  const pending = Array.from(pendingRequests.values());
  pendingRequests.clear();
  for (const request of pending) {
    clearTimeout(request.timer);
    request.reject(reason);
  }
}

function getCoreWorker(): Worker | null {
  if (coreWorker) {
    return coreWorker;
  }
  if (coreWorkerFailed) {
    return null;
  }
  try {
    // src/worker.ts, bundled next to extension.js. The worker gets a copy of
    // process.env: the log file of core is disabled there without touching the
    // environment of the extension host or of the commands it spawns.
    const worker = new Worker(path.join(__dirname, "worker.js"), {
      env: { ...process.env, SF_DISABLE_LOG_FILE: "true" },
    });
    worker.on("message", (message: any) => {
      if (message?.sfCoreLog) {
        Logger.log(`[sfdx-hardis][in-process] ${message.sfCoreLog}`);
        return;
      }
      const requestId = message?.requestId;
      if (!requestId || !pendingRequests.has(requestId)) {
        return;
      }
      const request = pendingRequests.get(requestId)!;
      pendingRequests.delete(requestId);
      clearTimeout(request.timer);
      if (message.sfCoreError) {
        request.reject(new Error(message.sfCoreError));
      } else {
        request.resolve(message.sfCoreResult);
      }
    });
    worker.on("error", (error) => {
      Logger.log(
        `[sfdx-hardis][in-process] worker error, using the CLI for every command: ${error?.message}`,
      );
      coreWorker = null;
      coreWorkerFailed = true;
      rejectAllPending(error);
    });
    worker.on("exit", (code) => {
      coreWorker = null;
      if (code !== 0) {
        Logger.log(
          `[sfdx-hardis][in-process] worker exited with code ${code}, using the CLI for every command`,
        );
        coreWorkerFailed = true;
      }
      rejectAllPending(new Error(`in-process worker exited (${code})`));
    });
    coreWorker = worker;
    return worker;
  } catch (e: any) {
    Logger.log(
      `[sfdx-hardis][in-process] could not start the worker, using the CLI for every command: ${e?.message}`,
    );
    coreWorkerFailed = true;
    return null;
  }
}

// Sends a command to the worker and waits for its JSON payload (or null)
function runInWorker(
  worker: Worker,
  coreDir: string,
  command: string,
  cwd: string | undefined,
): Promise<any | null> {
  return new Promise((resolve, reject) => {
    const requestId = `sfcore_${Date.now()}_${requestSeq++}`;
    const timer = setTimeout(() => {
      if (pendingRequests.delete(requestId)) {
        reject(new Error(`no answer after ${IN_PROCESS_TIMEOUT_MS}ms`));
      }
    }, IN_PROCESS_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timer });
    worker.postMessage({ sfCore: { coreDir, command, cwd }, requestId });
  });
}

/**
 * Starts the worker and loads @salesforce/core in it ahead of the first
 * command. Called at activation (deferred), never blocks.
 */
export function prewarmSfCoreWorker(): void {
  if (isSfPerformanceEnhancementDisabled()) {
    return;
  }
  resolveSalesforceCoreDir()
    .then((coreDir) => {
      if (!coreDir) {
        return;
      }
      const worker = getCoreWorker();
      if (worker) {
        worker.postMessage({ sfCore: { coreDir, preload: true } });
      }
    })
    .catch(() => {
      // The first command will report the problem
    });
}

/**
 * Tries to run an `sf ... --json` command in-process. Returns the parsed JSON
 * payload the CLI would have printed, or null when the real CLI must run
 * (unsupported shape, setting disabled, core unavailable, any failure).
 */
export async function tryRunSfCommandInProcess(
  command: string,
  cwd: string | undefined,
): Promise<any | null> {
  if (!command.includes("--json") || isSfPerformanceEnhancementDisabled()) {
    return null;
  }
  if (parseSfCommand(command) === null) {
    return null;
  }
  const coreDir = await resolveSalesforceCoreDir();
  if (!coreDir) {
    return null;
  }
  const worker = getCoreWorker();
  if (!worker) {
    return null;
  }
  const t0 = Date.now();
  try {
    const result = await runInWorker(worker, coreDir, command, cwd);
    if (result === null) {
      return null;
    }
    Logger.log(
      `[sfdx-hardis][in-process] ${command} (${Date.now() - t0}ms, no CLI spawn)`,
    );
    return result;
  } catch (e: any) {
    // Any failure: fall back to the real CLI so behavior and error messages stay unchanged
    Logger.log(
      `[sfdx-hardis][in-process] "${command}" failed after ${Date.now() - t0}ms, falling back to the CLI: ${e?.message}`,
    );
    return null;
  }
}

// Test hook: forget the resolved core and the worker
export function resetSalesforceCoreForTests(): void {
  coreDirPromise = null;
  coreWorkerFailed = false;
  if (coreWorker) {
    void coreWorker.terminate();
    coreWorker = null;
  }
}
