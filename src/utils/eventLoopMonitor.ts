import * as vscode from "vscode";
import { Logger } from "../logger";

// How often the probe timer is scheduled. A short interval keeps the reported
// lag close to the real stall duration without adding meaningful overhead.
const SAMPLE_INTERVAL_MS = 250;
// Only stalls above this are reported, to ignore ordinary GC / scheduling jitter.
const LAG_REPORT_THRESHOLD_MS = 500;

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;
// Wall-clock of the previous report, used to annotate how long after the last
// stall the new one happened (helps correlate consecutive bursts).
let lastReportAt = 0;

/**
 * Event-loop lag monitor (diagnostic).
 *
 * A timer scheduled every {@link SAMPLE_INTERVAL_MS} records how late each tick
 * fires. When the extension-host event loop is blocked by heavy synchronous work
 * — or CPU-starved by a burst of `sf` process spawns at startup — the timer
 * fires late and the drift equals the stall duration. Late ticks are logged via
 * {@link Logger} so they can be correlated with the `console.time(command)` and
 * `[shell-perf]` traces already emitted during activation.
 *
 * Gated behind the `vsCodeSfdxHardis.debugVsCodeSfdxHardis` setting (the same
 * flag that enables `Logger.logPerf`) so it stays silent for normal users.
 * Toggling the setting starts/stops the monitor live, with no reload required.
 */
export function startEventLoopMonitor(context: vscode.ExtensionContext): void {
  const apply = () => {
    const enabled =
      vscode.workspace
        .getConfiguration("vsCodeSfdxHardis")
        .get("debugVsCodeSfdxHardis") === true;
    if (enabled) {
      start();
    } else {
      stop();
    }
  };

  apply();

  // React to the setting being toggled at runtime.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("vsCodeSfdxHardis.debugVsCodeSfdxHardis")
      ) {
        apply();
      }
    }),
  );

  // Ensure the timer is cleared on extension shutdown.
  context.subscriptions.push({ dispose: stop });
}

function start(): void {
  if (monitorTimer) {
    return;
  }
  lastTick = Date.now();
  lastReportAt = 0;
  monitorTimer = setInterval(() => {
    const now = Date.now();
    const lag = now - lastTick - SAMPLE_INTERVAL_MS;
    lastTick = now;
    if (lag >= LAG_REPORT_THRESHOLD_MS) {
      const sincePrevious =
        lastReportAt > 0
          ? ` (+${now - lastReportAt}ms since previous stall)`
          : "";
      lastReportAt = now;
      Logger.log(
        `[event-loop-lag] Extension host stalled ~${lag}ms${sincePrevious} ` +
          `— ended at ${new Date(now).toISOString()}. ` +
          `Correlate with the nearest preceding console.time(command) / [shell-perf] lines.`,
      );
    }
  }, SAMPLE_INTERVAL_MS);
  // Do not keep the host process alive solely for this probe.
  if (typeof monitorTimer.unref === "function") {
    monitorTimer.unref();
  }
  Logger.log(
    `[event-loop-lag] Monitor started (sampling every ${SAMPLE_INTERVAL_MS}ms, ` +
      `reporting stalls >= ${LAG_REPORT_THRESHOLD_MS}ms)`,
  );
}

function stop(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
