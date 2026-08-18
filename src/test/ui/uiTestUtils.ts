import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";

/**
 * Shared helpers for the UI integration suites (real Extension Development
 * Host, dummy SFDX project, mocked sf CLI).
 */

export const EXTENSION_ID = "NicolasVuillamy.vscode-sfdx-hardis";

/**
 * Polls `producer` until it returns a truthy value or the timeout elapses.
 */
export async function waitFor<T>(
  producer: () => T | undefined | null | false,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = producer();
    if (value) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Activates the extension and returns its test API.
 */
export async function activateExtension(): Promise<any> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Extension ${EXTENSION_ID} not found`);
  const api = await extension!.activate();
  assert.ok(api, "activate() must return the test API");
  return api;
}

/**
 * Runs a sfdx-hardis command in background mode and returns the id of the
 * command execution panel it opens. The panel id is not predictable (it holds
 * the command context id), so it is identified as the one that appeared.
 */
export async function runCommandAndWaitForPanel(
  panelManager: any,
  command: string,
  timeoutMs = 20000,
): Promise<string> {
  const knownPanels = new Set<string>(panelManager.getActivePanelIds());
  void vscode.commands.executeCommand(
    "vscode-sfdx-hardis.execute-command",
    command,
  );
  return await waitFor(
    () =>
      panelManager
        .getActivePanelIds()
        .find(
          (id: string) =>
            id.startsWith("s-command-execution-") && !knownPanels.has(id),
        ),
    timeoutMs,
    `command execution panel of ${command} to open`,
  );
}

/**
 * One invocation of the mocked sf CLI (test/fixtures/sf-shim), as appended to
 * the JSON-lines file pointed to by the SF_MOCK_LOG environment variable.
 */
export interface MockLogEntry {
  time: number;
  args: string[];
  contextId: string | null;
  event?: string;
  promptName?: string;
}

/**
 * Reads the mocked sf CLI invocation log, or returns an empty list when the
 * log file is not set yet or does not exist.
 */
export function readMockLog(): MockLogEntry[] {
  const logFile = process.env.SF_MOCK_LOG || "";
  if (!logFile || !fs.existsSync(logFile)) {
    return [];
  }
  return fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MockLogEntry);
}
