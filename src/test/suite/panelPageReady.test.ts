import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LwcUiPanel } from "../../webviews/lwc-ui-panel";
import { REPO_ROOT } from "./lwcSourceUtils";

/**
 * A webview created while VS Code is still restoring its window can fail to
 * register its service worker: the page never loads and never posts
 * webviewReady. The Welcome page opened at startup waits for that message and
 * opens itself again once when it does not come.
 */
suite("Panel page ready", () => {
  const extensionUri = vscode.Uri.file(REPO_ROOT);
  const panels: LwcUiPanel[] = [];

  function openPanel(): LwcUiPanel {
    const panel = LwcUiPanel.display(extensionUri, "s-welcome", {});
    panels.push(panel);
    return panel;
  }

  suiteTeardown(() => {
    panels.forEach((panel) => panel.dispose());
  });

  test("waitForPageReady resolves true when the page posts webviewReady", async () => {
    const panel = openPanel();
    const waiting = panel.waitForPageReady(10000);
    panel.simulateWebviewMessage({ type: "webviewReady" });
    assert.strictEqual(await waiting, true);
    assert.strictEqual(panel.pageReady, true);
    assert.strictEqual(await panel.waitForPageReady(1), true);
  });

  test("waitForPageReady resolves false when the panel is disposed", async () => {
    const panel = openPanel();
    const waiting = panel.waitForPageReady(10000);
    panel.dispose();
    assert.strictEqual(await waiting, false);
    assert.strictEqual(panel.isVisible(), false);
  });

  test("waitForPageReady resolves false when the time is up", async () => {
    const panel = openPanel();
    if (panel.pageReady) {
      return;
    }
    assert.strictEqual(await panel.waitForPageReady(1), false);
  });

  test("the Welcome page opens at startup through the retry wrapper", () => {
    const extensionSource = fs.readFileSync(
      path.join(REPO_ROOT, "src", "extension.ts"),
      "utf8",
    );
    assert.ok(
      extensionSource.includes("openWelcomeAtStartup()"),
      "extension.ts must open the startup Welcome page with openWelcomeAtStartup",
    );
  });
});
