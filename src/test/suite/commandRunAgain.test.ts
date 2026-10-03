import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT, readModuleFile } from "./lwcSourceUtils";

/**
 * Contract of Run again in the command execution tab: the command is replayed
 * in the tab it was clicked in. The LWC asks for it, the panel passes its own
 * id to the command runner, and the runner hands the finished tab over to the
 * new run. The provisional context id of each run tells the new run from the
 * previous one, on both sides of the message bridge.
 */
suite("Command Runner Run again contract", () => {
  const componentSource = readModuleFile(
    "commandExecution",
    "commandExecution.js",
  );
  const templateSource = readModuleFile(
    "commandExecution",
    "commandExecution.html",
  );
  const readSource = (...parts: string[]) =>
    fs.readFileSync(path.join(REPO_ROOT, "src", ...parts), "utf8");
  const panelSource = readSource("webviews", "lwc-ui-panel.ts");
  const runnerSource = readSource("command-runner.ts");
  const serverSource = readSource("hardis-websocket-server.ts");

  test("Run again asks to replay the command in its own tab, once", () => {
    assert.match(
      componentSource,
      /data: \{ command, reusePanel: true \}/,
      "handleRunAgain must ask the extension to replay the command in this panel",
    );
    assert.match(
      componentSource,
      /handleRunAgain\(\) \{[\s\S]*?this\.runAgainRequested\) \{\s*return;\s*\}[\s\S]*?this\.runAgainRequested = true;/,
      "a second click must not send the request twice",
    );
    assert.ok(
      templateSource.includes("disabled={runAgainRequested}"),
      "the button must be disabled while the request is in flight",
    );
  });

  test("a webview can only ask to reuse its own panel", () => {
    assert.match(
      panelSource,
      /data\.reusePanel === true\s*\?\s*\{ reusePanelLwcId: this\.lwcId \}\s*:\s*undefined/,
      "the panel id must come from the panel that received the message",
    );
  });

  test("a new run clears what the previous run left in the tab", () => {
    assert.match(
      componentSource,
      /if \(this\.isNewRun\(context\)\) \{\s*this\.resetRunState\(\);\s*\}\s*this\.commandContext = context;/,
      "initializeCommand must reset the run state before taking the new context",
    );
    const start = componentSource.indexOf("resetRunState() {");
    assert.ok(start > -1, "commandExecution must define resetRunState");
    const body = componentSource.slice(
      start,
      componentSource.indexOf("\n  }", start),
    );
    for (const field of [
      "commandLabel",
      "commandLogFile",
      "targetOrgUsername",
      "promptRenderError",
      "runAgainRequested",
    ]) {
      assert.ok(
        body.includes(`this.${field} =`),
        `resetRunState must clear ${field}`,
      );
    }
  });

  test("the end of a previous run never fails the run Run again started", () => {
    assert.match(
      runnerSource,
      /contextId: pendingContextId \|\| undefined/,
      "backgroundCommandEnded must name the run it belongs to",
    );
    assert.match(
      componentSource,
      /data\?\.contextId\s*\?\s*String\(data\.contextId\) === String\(this\.commandContext\?\.id\)/,
      "handleBackgroundCommandEnded must match on the context id when there is one",
    );
  });

  test("the wiring of a previous run leaves a reused tab alone", () => {
    assert.match(
      runnerSource,
      /if \(panel\.commandRunId !== provisionalContextId\) \{\s*unsubscribePanelDisposed\(\);\s*return;\s*\}\s*if \(messageType !== "panelDisposed"\)/,
      "the cancel-on-close listener must first check that its run still owns the panel",
    );
  });

  test("a tab opened at click time is not revealed when its CLI connects", () => {
    assert.match(
      serverSource,
      /getOrCreatePanel\(lwcId, data\.context, \{\s*reveal: !pendingPanel,\s*\}\)/,
      "the adoption must leave the tab in its group, without taking the focus",
    );
  });
});
