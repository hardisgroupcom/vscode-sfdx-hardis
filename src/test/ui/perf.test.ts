import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";

/**
 * UI integration tests focused on the performance issues reported by users:
 *  - slow startup (trees blocked, commands rejected right after activation)
 *  - dozens of seconds between a click on a menu entry and the moment the
 *    sf hardis command is visibly running in its dedicated tab.
 *
 * They run in a real Extension Development Host, on a dummy SFDX project,
 * with a mocked `sf` CLI on the PATH (see test/fixtures/sf-shim) that answers
 * instantly and speaks the sfdx-hardis WebSocket protocol.
 */

const EXTENSION_ID = "NicolasVuillamy.vscode-sfdx-hardis";

interface MockInvocation {
  time: number;
  args: string[];
  contextId: string | null;
  event?: string;
}

function readMockLog(): MockInvocation[] {
  const logFile = process.env.SF_MOCK_LOG || "";
  if (!logFile || !fs.existsSync(logFile)) {
    return [];
  }
  return fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MockInvocation);
}

async function waitFor<T>(
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

suite("Performance UI tests", function () {
  let api: any;

  suiteSetup(async function () {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension ${EXTENSION_ID} not found`);
    api = await extension!.activate();
    assert.ok(api, "activate() must return the test API");
  });

  test("workspace is detected as an SFDX project", async function () {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, "A workspace folder must be open");
    const sfdxProjectUri = vscode.Uri.joinPath(
      folders![0].uri,
      "sfdx-project.json",
    );
    await vscode.workspace.fs.stat(sfdxProjectUri);
  });

  test("activation is fast (no blocking work in activate())", function () {
    assert.ok(
      typeof api.activationTimeSeconds === "number",
      "activationTimeSeconds must be exported",
    );
    // The synchronous part of activation must stay well under a second on a
    // dev machine; 10s is a generous CI-proof regression guard.
    assert.ok(
      api.activationTimeSeconds < 10,
      `activate() took ${api.activationTimeSeconds}s (>= 10s)`,
    );
  });

  test("WebSocket server is ready shortly after activation (no fixed 5s delay)", async function () {
    const start = Date.now();
    await waitFor(
      () => api.commands?.disposableWebSocketServer?.websocketHostPort,
      4000,
      "WebSocket server host:port to be set",
    );
    const elapsed = Date.now() - start;
    // With the old fixed 5s startup delay this could not succeed in 4s
    // (unless activation happened long before this test ran, which the
    // suiteSetup right above makes very unlikely).
    assert.ok(elapsed < 4000, `WebSocket server took ${elapsed}ms`);
  });

  test("background command: execution panel opens instantly, then completes through the WebSocket protocol", async function () {
    const panelManager = api.getLwcPanelManager();
    const knownPanels = new Set(panelManager.getActivePanelIds());

    const clickTime = Date.now();
    void vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      "sf hardis:org:mock-background-run",
    );

    // The dedicated tab must appear right at click time, NOT after the CLI
    // boot (pre-fix, the panel appeared only when the CLI connected, which
    // takes 10+ seconds with the real CLI)
    const panelId = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !knownPanels.has(id),
          ),
      5000,
      "command execution panel to open",
    );
    const panelOpenMs = Date.now() - clickTime;
    assert.ok(
      panelOpenMs < 5000,
      `Command panel took ${panelOpenMs}ms to open after the click`,
    );

    // The mock CLI connects, is adopted (same context id passed through
    // SFDX_HARDIS_COMMAND_CONTEXT_ID), streams logs and closes: the SAME
    // panel must transition to completed
    await waitFor(
      () => {
        const panel = panelManager.getPanel(panelId);
        return panel && panel.commandStatus === "completed";
      },
      60000,
      "command panel to complete via websocket protocol",
    );

    // The mock CLI must have been spawned with the provisional context id
    // and really connected through the WebSocket
    const entries = readMockLog().filter(
      (entry) => entry.args[0] === "hardis:org:mock-background-run",
    );
    assert.ok(entries.length > 0, "sf mock must have been invoked");
    assert.ok(
      entries.some((entry) => entry.contextId),
      "SFDX_HARDIS_COMMAND_CONTEXT_ID must be passed to the CLI",
    );
    assert.ok(
      entries.some((entry) => entry.event === "wsOpen"),
      "mock CLI must have connected to the extension WebSocket server",
    );
  });

  test("background command: closing the tab while the CLI boots cancels the command and an instant re-run works", async function () {
    const panelManager = api.getLwcPanelManager();
    // "slow-boot" makes the mock CLI wait 3s before connecting, like a real
    // CLI boot: the panel stays in pending state during that window
    const command = "sf hardis:org:mock-slow-boot-run";

    const known1 = new Set(panelManager.getActivePanelIds());
    void vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      command,
    );
    const panelId1: string = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !known1.has(id),
          ),
      5000,
      "first slow-boot panel to open",
    );
    // User closes the tab while the CLI is still booting
    panelManager.disposePanel(panelId1);

    // ...and immediately runs the same command again: it must NOT be blocked
    // by the duplicate-command detection (the first run was cancelled)
    const known2 = new Set(panelManager.getActivePanelIds());
    void vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      command,
    );
    const panelId2: string = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !known2.has(id),
          ),
      5000,
      "re-run panel to open right after cancelling the first run",
    );
    await waitFor(
      () => {
        const panel = panelManager.getPanel(panelId2);
        return panel && panel.commandStatus === "completed";
      },
      60000,
      "re-run to complete via the websocket protocol",
    );
  });

  test("background command: closing the tab of a running command cancels the CLI and an instant re-run works", async function () {
    const panelManager = api.getLwcPanelManager();
    // "long-run" makes the mock CLI stay connected until it receives the
    // cancelCommand event sent by the extension when the tab is closed
    const command = "sf hardis:org:mock-long-run";
    const countCancelled = () =>
      readMockLog().filter(
        (entry) =>
          entry.args[0] === "hardis:org:mock-long-run" &&
          entry.event === "cancelled",
      ).length;

    const known1 = new Set(panelManager.getActivePanelIds());
    void vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      command,
    );
    const panelId1: string = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !known1.has(id),
          ),
      5000,
      "first long-run panel to open",
    );
    // Wait until the CLI has connected and adopted the panel
    await waitFor(
      () => panelManager.getPanel(panelId1)?.commandStatus === "running",
      30000,
      "first long-run to be adopted (running)",
    );
    // User closes the tab of the running command...
    panelManager.disposePanel(panelId1);

    // ...and immediately runs the same command again
    const known2 = new Set(panelManager.getActivePanelIds());
    void vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      command,
    );
    const panelId2: string = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !known2.has(id),
          ),
      5000,
      "re-run panel to open right after cancelling the running command",
    );
    // The first CLI must have been cancelled through the WebSocket protocol
    await waitFor(
      () => countCancelled() >= 1,
      15000,
      "first long-run CLI to receive cancelCommand",
    );
    // The re-run must connect and run normally
    await waitFor(
      () => panelManager.getPanel(panelId2)?.commandStatus === "running",
      30000,
      "re-run to be adopted (running)",
    );
    // Cleanup: cancel the second run too, and wait until its CLI exits
    panelManager.disposePanel(panelId2);
    await waitFor(
      () => countCancelled() >= 2,
      15000,
      "re-run CLI to receive cancelCommand",
    );
  });

  test("terminal command: terminal opens instantly (no fixed 4s wait) and the command really runs", async function () {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    await config.update(
      "userInputCommandLineIfLWC",
      "terminal",
      vscode.ConfigurationTarget.Workspace,
    );
    try {
      const terminalOpened = new Promise<number>((resolve) => {
        const disposable = vscode.window.onDidOpenTerminal(() => {
          disposable.dispose();
          resolve(Date.now());
        });
      });

      const clickTime = Date.now();
      void vscode.commands.executeCommand(
        "vscode-sfdx-hardis.execute-command",
        "sf hardis:project:mock-terminal-run",
      );

      const openedAt = await Promise.race([
        terminalOpened,
        new Promise<number>((resolve) => setTimeout(() => resolve(-1), 10000)),
      ]);
      assert.ok(openedAt !== -1, "A terminal must be created for the command");
      const terminalDelayMs = openedAt - clickTime;
      // Pre-fix this was a hard-coded 4000ms wait before even sending the text
      assert.ok(
        terminalDelayMs < 3000,
        `Terminal took ${terminalDelayMs}ms to open (old fixed delay was 4000ms)`,
      );

      // The command must actually execute in the shell (mock writes a log line)
      await waitFor(
        () =>
          readMockLog().some(
            (entry) => entry.args[0] === "hardis:project:mock-terminal-run",
          ),
        90000,
        "terminal command to reach the sf mock",
      );
    } finally {
      await config.update(
        "userInputCommandLineIfLWC",
        "background",
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });

  test("terminal command: re-running the same command after cooldown is not blocked as duplicate", async function () {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    await config.update(
      "userInputCommandLineIfLWC",
      "terminal",
      vscode.ConfigurationTarget.Workspace,
    );
    // A non-auto language makes runCommandInTerminal prefix the command with
    // SFDX_HARDIS_LANG=..., which pre-fix leaked the duplicate-detection key
    // and permanently blocked any re-run of the same command
    await config.update("lang", "fr", vscode.ConfigurationTarget.Workspace);
    try {
      const command = "sf hardis:project:mock-duplicate-run";
      const countRuns = () =>
        readMockLog().filter(
          (entry) => entry.args[0] === "hardis:project:mock-duplicate-run",
        ).length;

      void vscode.commands.executeCommand(
        "vscode-sfdx-hardis.execute-command",
        command,
      );
      await waitFor(() => countRuns() >= 1, 90000, "first duplicate-run");

      // Wait for the duplicate-detection cooldown (3s) to elapse
      await new Promise((resolve) => setTimeout(resolve, 4000));

      void vscode.commands.executeCommand(
        "vscode-sfdx-hardis.execute-command",
        command,
      );
      await waitFor(
        () => countRuns() >= 2,
        90000,
        "second duplicate-run (must not be blocked by stale duplicate key)",
      );
    } finally {
      await config.update("lang", "auto", vscode.ConfigurationTarget.Workspace);
      await config.update(
        "userInputCommandLineIfLWC",
        "background",
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });

  test("startup CLI probes hit the mocked sf CLI (no real CLI required)", async function () {
    // preLoadCache() fires sf --version / sf plugins / sf org display /
    // sf config get at activation: they must all have reached the mock
    await waitFor(
      () => readMockLog().some((entry) => entry.args[0] === "--version"),
      30000,
      "sf --version probe",
    );
    await waitFor(
      () => readMockLog().some((entry) => entry.args[0] === "org"),
      30000,
      "sf org display probe",
    );
  });
});
