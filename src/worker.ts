import { parentPort } from "worker_threads";
import * as childProcess from "child_process";
import {
  loadSalesforceCoreFrom,
  parseSfCommand,
  runSfCoreCommand,
} from "./utils/sfCoreCommands";

// Execute a command concurrently

function execCliCommand(cmd: string, execOptions: any, requestId: string) {
  childProcess.exec(cmd, execOptions, (error, stdout, stderr) => {
    if (parentPort) {
      if (error) {
        parentPort.postMessage({
          error: error,
          requestId: requestId,
          stdout: stdout,
          stderr: stderr,
        });
      } else {
        parentPort.postMessage({ stdout: stdout, stderr: stderr, requestId });
      }
    }
  });
}

// --- In-process sf commands (@salesforce/core loaded from the installed CLI) ---
// The library is loaded once per worker; every request then costs a few ms of
// CPU here instead of a 2 to 4 s CLI process, and never blocks the extension host.

const log = (message: string) => {
  parentPort?.postMessage({ sfCoreLog: message });
};

let loadedCore: { coreDir: string; core: any } | null = null;

// NODE_TLS_REJECT_UNAUTHORIZED as inherited from the extension host, restored
// whenever a request does not ask for relaxed TLS (see applyTlsPreference)
const INHERITED_TLS_REJECT = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

// Mirror the env of the spawned CLI: when the disableTlsRejectUnauthorized
// setting is on, the CLI runs with NODE_TLS_REJECT_UNAUTHORIZED=0 (corporate
// SSL-inspection proxies), so the in-process connections must do the same.
function applyTlsPreference(tlsRejectUnauthorizedDisabled?: boolean): void {
  if (tlsRejectUnauthorizedDisabled) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  } else if (INHERITED_TLS_REJECT === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = INHERITED_TLS_REJECT;
  }
}

function getCore(coreDir: string): any {
  if (loadedCore && loadedCore.coreDir === coreDir) {
    return loadedCore.core;
  }
  const t0 = Date.now();
  const { core, version } = loadSalesforceCoreFrom(coreDir);
  loadedCore = { coreDir, core };
  log(
    `Loaded @salesforce/core ${version} from ${coreDir} (${Date.now() - t0}ms, worker thread)`,
  );
  return core;
}

async function runSfCoreRequest(
  request: {
    coreDir: string;
    command?: string;
    cwd?: string;
    preload?: boolean;
    tlsRejectUnauthorizedDisabled?: boolean;
  },
  requestId: string | undefined,
) {
  try {
    const core = getCore(request.coreDir);
    if (request.preload || !request.command) {
      return;
    }
    applyTlsPreference(request.tlsRejectUnauthorizedDisabled);
    const parsed = parseSfCommand(request.command);
    const result =
      parsed === null
        ? null
        : await runSfCoreCommand(core, parsed, request.cwd, log);
    parentPort?.postMessage({ requestId, sfCoreResult: result });
  } catch (e: any) {
    if (requestId) {
      parentPort?.postMessage({
        requestId,
        sfCoreError: e?.message || String(e),
      });
    } else {
      log(`preload failed: ${e?.message || String(e)}`);
    }
  }
}

if (parentPort) {
  parentPort.on("message", (msg) => {
    if (msg && msg.cliCommand) {
      execCliCommand(
        msg.cliCommand.cmd,
        JSON.parse(msg.cliCommand.execOptions),
        msg.requestId,
      );
    } else if (msg && msg.sfCore) {
      void runSfCoreRequest(msg.sfCore, msg.requestId);
    }
  });
}
