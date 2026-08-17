import * as assert from "assert";
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
