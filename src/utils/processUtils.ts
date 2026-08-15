import { execFile, spawn } from "child_process";

// Tiny local replacement for the "tree-kill" dependency.
// Kills a process and, on POSIX, all of its descendants (the reason tree-kill
// was used: killing a spawned CLI process must also kill the child processes
// it spawns). Mirrors tree-kill's call shape: killProcessTree(pid, signal?, callback?).

export function killProcessTree(
  pid: number,
  signal?: string | ((err?: Error) => void),
  callback?: (err?: Error) => void,
): void {
  let resolvedSignal: string | undefined;
  let resolvedCallback: ((err?: Error) => void) | undefined;
  if (typeof signal === "function") {
    resolvedCallback = signal;
    resolvedSignal = undefined;
  } else {
    resolvedSignal = signal;
    resolvedCallback = callback;
  }

  if (Number.isNaN(pid)) {
    const error = new Error("pid must be a number");
    if (resolvedCallback) {
      resolvedCallback(error);
      return;
    }
    throw error;
  }

  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], (err) => {
      resolvedCallback && resolvedCallback(err ?? undefined);
    });
    return;
  }

  collectDescendantPids(pid, (descendantPids) => {
    const allPids = [...descendantPids, pid];
    try {
      for (const pidToKill of allPids) {
        killSinglePid(pidToKill, resolvedSignal);
      }
    } catch (err) {
      resolvedCallback && resolvedCallback(err as Error);
      return;
    }
    resolvedCallback && resolvedCallback();
  });
}

function killSinglePid(pid: number, signal?: string): void {
  try {
    process.kill(pid, signal as any);
  } catch (err: any) {
    // ESRCH: no such process (already exited) -- not an error for our purposes
    if (err?.code !== "ESRCH") {
      throw err;
    }
  }
}

// Recursively collects the pids of all descendants of parentPid, using `ps` (Linux)
// / `pgrep` (macOS), the same tools tree-kill relies on.
function collectDescendantPids(
  parentPid: number,
  done: (descendantPids: number[]) => void,
): void {
  const descendantPids: number[] = [];
  const pidsToProcess = new Set<number>([parentPid]);

  const listChildren = (pid: number, onDone: (childPids: number[]) => void) => {
    const child =
      process.platform === "darwin"
        ? spawn("pgrep", ["-P", String(pid)])
        : spawn("ps", ["-o", "pid", "--no-headers", "--ppid", String(pid)]);
    let allData = "";
    child.stdout?.on("data", (data) => {
      allData += data.toString("ascii");
    });
    child.on("error", () => {
      onDone([]);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        onDone([]);
        return;
      }
      const childPids = (allData.match(/\d+/g) || []).map((value) =>
        parseInt(value, 10),
      );
      onDone(childPids);
    });
  };

  const processPid = (pid: number) => {
    listChildren(pid, (childPids) => {
      pidsToProcess.delete(pid);
      for (const childPid of childPids) {
        descendantPids.push(childPid);
        pidsToProcess.add(childPid);
        processPid(childPid);
      }
      if (pidsToProcess.size === 0) {
        done(descendantPids);
      }
    });
  };

  processPid(parentPid);
}
