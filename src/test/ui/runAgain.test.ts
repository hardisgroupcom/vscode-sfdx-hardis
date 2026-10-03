import * as assert from "assert";
import {
  activateExtension,
  readMockLog,
  runCommandAndWaitForPanel,
  waitFor,
} from "./uiTestUtils";

/**
 * Run again replays a command in the tab it was clicked in (real Extension
 * Development Host, mocked sf CLI). A click is simulated with the message the
 * commandExecution LWC posts to its panel. Each test uses its own command id,
 * because the mocked CLI log is shared by the whole run.
 */
suite("Run again UI tests", function () {
  let api: any;

  suiteSetup(async function () {
    api = await activateExtension();
  });

  test("Run again replays the command in the same tab", async function () {
    const panelManager = api.getLwcPanelManager();
    const commandId = "hardis:org:mock-run-again";
    const { panel, firstId } = await runToEnd(panelManager, commandId);
    const knownIds = new Set(commandPanelIds(panelManager));

    clickRunAgain(panel, commandId);
    await waitForNewRun(panel, firstId);
    await waitForStatus(panel, ["completed"], "the second run to complete");

    const secondId = panel.getLwcId();
    assert.strictEqual(
      panelManager.getPanel(secondId),
      panel,
      "the second run must be shown in the same panel",
    );
    assert.strictEqual(
      panelManager.getPanel(firstId),
      null,
      "the id of the first run must be released",
    );
    assert.deepStrictEqual(
      commandPanelIds(panelManager).filter(
        (id) => !knownIds.has(id) && id !== secondId,
      ),
      [],
      "Run again must not open another tab",
    );
    const contextIds = invocationsOf(commandId).map((entry) =>
      String(entry.contextId),
    );
    assert.strictEqual(contextIds.length, 2, "the command must run twice");
    assert.notStrictEqual(
      contextIds[0],
      contextIds[1],
      "each run must have its own context id",
    );
    assert.strictEqual(
      secondId,
      `s-command-execution-${contextIds[1]}`,
      "the tab must be keyed by the context id of the second run",
    );
  });

  test("Run again is not refused while the previous CLI is still exiting", async function () {
    const panelManager = api.getLwcPanelManager();
    // "slow-exit": the mocked CLI keeps its process 3 seconds after it
    // reported its end
    const commandId = "hardis:org:mock-slow-exit-run-again";
    const { panel, firstId } = await runToEnd(panelManager, commandId);

    clickRunAgain(panel, commandId);
    await waitForNewRun(panel, firstId);
    await waitForStatus(panel, ["completed"], "the second run to complete");

    const invocations = invocationsOf(commandId);
    assert.strictEqual(invocations.length, 2, "the command must run twice");
    // The second run is usually over before the first process exits
    const firstExit = await waitFor(
      () =>
        mockEntriesOf(commandId).find(
          (entry) =>
            entry.event === "wsClosed" &&
            entry.contextId === invocations[0].contextId,
        ),
      15000,
      "the process of the first run to exit",
    );
    assert.ok(
      invocations[1].time < firstExit.time,
      "the second run must start while the first process is still exiting, instead of being refused as a duplicate",
    );
  });

  test("the end of a failed run does not reach the run Run again started", async function () {
    const panelManager = api.getLwcPanelManager();
    // "mock-fail": the mocked CLI reports an error and exits with code 1
    const commandId = "hardis:org:mock-fail-run-again";
    const { panel, firstId } = await runToEnd(panelManager, commandId, [
      "error",
    ]);
    const firstRunId = panel.commandRunId;
    // The end of a process reaches the panels 3 seconds after it exited
    const endMessages: any[] = [];
    const originalSendMessage = panel.sendMessage;
    panel.sendMessage = (message: any) => {
      if (
        message?.type === "backgroundCommandEnded" &&
        String(message.data?.command || "").includes(commandId)
      ) {
        endMessages.push(message.data);
      }
      originalSendMessage.call(panel, message);
    };
    try {
      clickRunAgain(panel, commandId);
      await waitForNewRun(panel, firstId);
      await waitFor(
        () => endMessages.length > 0,
        15000,
        "the end of the failed run to reach the panel",
      );
    } finally {
      panel.sendMessage = originalSendMessage;
    }

    const firstEnd = endMessages[0];
    assert.strictEqual(firstEnd.exitCode, 1, "the first run must fail");
    assert.strictEqual(
      firstEnd.contextId,
      firstRunId,
      "the end must name the run it belongs to",
    );
    assert.notStrictEqual(
      firstEnd.contextId,
      panel.commandRunId,
      "the tab must show another run, which the end of the first one cannot fail",
    );
    await waitForStatus(panel, ["error"], "the second run to end");
  });

  test("a double click on Run again starts a single run", async function () {
    const panelManager = api.getLwcPanelManager();
    const commandId = "hardis:org:mock-double-run-again";
    const { panel, firstId } = await runToEnd(panelManager, commandId);
    const knownIds = new Set(commandPanelIds(panelManager));

    clickRunAgain(panel, commandId);
    clickRunAgain(panel, commandId);
    await waitForNewRun(panel, firstId);
    await waitForStatus(panel, ["completed"], "the second run to complete");

    assert.strictEqual(
      invocationsOf(commandId).length,
      2,
      "the second click must not start a third run",
    );
    assert.deepStrictEqual(
      commandPanelIds(panelManager).filter(
        (id) => !knownIds.has(id) && id !== panel.getLwcId(),
      ),
      [],
      "the second click must not open another tab",
    );
  });

  test("a tab opened at click time is not revealed when its CLI connects", async function () {
    const panelManager = api.getLwcPanelManager();
    // "slow-boot": the mocked CLI waits 3 seconds before connecting, which
    // leaves the time to watch the panel before its adoption
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:org:mock-slow-boot-no-reveal",
      5000,
    );
    const panel = panelManager.getPanel(panelId);
    assert.ok(panel, "the command execution tab must be open");
    let revealCalls = 0;
    const originalReveal = panel.reveal;
    panel.reveal = (...args: any[]) => {
      revealCalls++;
      originalReveal.apply(panel, args);
    };
    try {
      await waitForStatus(panel, ["completed"], "the command to complete");
    } finally {
      panel.reveal = originalReveal;
    }
    assert.strictEqual(
      revealCalls,
      0,
      "the tab must stay where it is when its CLI connects",
    );
  });
});

/** Runs a mocked command in a new tab, and waits for the end of the run */
async function runToEnd(
  panelManager: any,
  commandId: string,
  statuses: string[] = ["completed"],
): Promise<{ panel: any; firstId: string }> {
  const firstId = await runCommandAndWaitForPanel(
    panelManager,
    `sf ${commandId}`,
  );
  const panel = panelManager.getPanel(firstId);
  assert.ok(panel, "the command execution tab must be open");
  await waitForStatus(panel, statuses, `${commandId} to end`);
  return { panel, firstId };
}

/**
 * Waits for a status of the run a panel shows. Read from the panel object,
 * since its id changes when Run again hands it over to a new run.
 */
async function waitForStatus(
  panel: any,
  statuses: string[],
  label: string,
): Promise<void> {
  await waitFor(() => statuses.includes(panel.commandStatus), 60000, label);
}

/** Ids of the command execution tabs currently open */
function commandPanelIds(panelManager: any): string[] {
  return panelManager
    .getActivePanelIds()
    .filter((id: string) => id.startsWith("s-command-execution-"));
}

/** Simulates a click on the Run again button of a tab */
function clickRunAgain(panel: any, commandId: string): void {
  panel.simulateWebviewMessage({
    type: "runCommand",
    data: { command: `sf ${commandId}`, reusePanel: true },
  });
}

/** Waits until Run again handed the tab over to a new run */
async function waitForNewRun(panel: any, previousId: string): Promise<void> {
  await waitFor(
    () => panel.getLwcId() !== previousId,
    20000,
    "the tab to be handed over to the run Run again started",
  );
}

/** Invocations of a command by the extension, in the order they started */
function invocationsOf(commandId: string) {
  return mockEntriesOf(commandId).filter((entry) => !entry.event);
}

/** Everything the mocked CLI logged for a command id */
function mockEntriesOf(commandId: string) {
  return readMockLog().filter((entry) => entry.args[0] === commandId);
}
