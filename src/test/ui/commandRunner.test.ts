import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { activateExtension, waitFor } from "./uiTestUtils";

/**
 * UI integration tests for the command execution panel (Command Runner).
 *
 * The mocked sf CLI (test/fixtures/sf-shim) exposes a "showcase" command that
 * streams the full sfdx-hardis WebSocket protocol: action sections, raw logs,
 * sub-commands, a warning, a table, a select question, a progress bar, a
 * multiselect question and report files. The test answers the prompts through
 * the panel message bridge and asserts the run completes.
 *
 * Visual QA: set SFDX_HARDIS_VISUAL_SHOWCASE=true to also capture full-screen
 * PNGs of the panel at each interesting state (prompt shown, progress running,
 * multiselect shown, completed) into SFDX_HARDIS_VISUAL_SHOWCASE_DIR (defaults
 * to <tmp>/sfdx-hardis-visual). Combine with a slower pace if needed.
 */

interface MockLogEntry {
  time: number;
  args: string[];
  contextId: string | null;
  event?: string;
  promptName?: string;
}

function readMockLog(): MockLogEntry[] {
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

const VISUAL_MODE = process.env.SFDX_HARDIS_VISUAL_SHOWCASE === "true";

function captureScreen(name: string): void {
  if (!VISUAL_MODE || process.platform !== "win32") {
    return;
  }
  const outDir =
    process.env.SFDX_HARDIS_VISUAL_SHOWCASE_DIR ||
    path.join(os.tmpdir(), "sfdx-hardis-visual");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}.png`);
  const psScript = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
    "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;",
    "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;",
    "$g=[System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size);",
    `$bmp.Save('${file.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png);`,
  ].join(" ");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", psScript], {
      stdio: "pipe",
      timeout: 15000,
    });
    console.log(`      [visual] captured ${file}`);
  } catch (error) {
    console.log(`      [visual] screenshot failed: ${(error as Error).message}`);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Screenshots are full-screen: bring the showcase panel to the foreground
// first, so a panel left open by a previous test does not cover it
async function focusAndCapture(panel: any, name: string): Promise<void> {
  if (VISUAL_MODE) {
    try {
      panel.reveal();
    } catch {
      // Panel may already be disposed at capture time
    }
    await sleep(400);
  }
  captureScreen(name);
}

suite("Command Runner UI tests", function () {
  this.timeout(120000);
  let api: any;

  suiteSetup(async function () {
    api = await activateExtension();
  });

  test("showcase command streams the full protocol (sections, sub-commands, table, prompts, progress, reports) and completes", async function () {
    const panelManager = api.getLwcPanelManager();
    const knownPanels = new Set<string>(panelManager.getActivePanelIds());
    const mockLogStart = readMockLog().length;

    void vscode.commands.executeCommand(
      "vscode-sfdx-hardis.execute-command",
      "sf hardis:org:mock-showcase",
    );
    const panelId: string = await waitFor(
      () =>
        panelManager
          .getActivePanelIds()
          .find(
            (id: string) =>
              id.startsWith("s-command-execution-") && !knownPanels.has(id),
          ),
      10000,
      "showcase command execution panel to open",
    );

    const newEntries = () => readMockLog().slice(mockLogStart);

    // First prompt: simple select question shown inside the panel
    await waitFor(
      () =>
        newEntries().some(
          (entry) =>
            entry.event === "promptAsked" && entry.promptName === "setDefault",
        ),
      30000,
      "select prompt to be asked by the showcase command",
    );
    // Leave time for the prompt card to render in the webview
    await sleep(VISUAL_MODE ? 1200 : 300);
    const panel = panelManager.getPanel(panelId);
    assert.ok(panel, "command execution panel must exist");
    await focusAndCapture(panel, "command-runner-1-select-prompt");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { setDefault: "yes" },
    });

    // Progress bar runs after the first answer
    if (VISUAL_MODE) {
      await sleep(500);
      await focusAndCapture(panel, "command-runner-2-progress");
    }

    // Second prompt: multiselect
    await waitFor(
      () =>
        newEntries().some(
          (entry) =>
            entry.event === "promptAsked" &&
            entry.promptName === "customSettings",
        ),
      30000,
      "multiselect prompt to be asked by the showcase command",
    );
    await sleep(VISUAL_MODE ? 1200 : 300);
    await focusAndCapture(panel, "command-runner-3-multiselect-prompt");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { customSettings: ["APITalenDev__c", "Languages__c"] },
    });

    // Third prompt: select with many choices (filterable list variant)
    await waitFor(
      () =>
        newEntries().some(
          (entry) =>
            entry.event === "promptAsked" && entry.promptName === "auditDays",
        ),
      30000,
      "list select prompt to be asked by the showcase command",
    );
    await sleep(VISUAL_MODE ? 1200 : 300);
    await focusAndCapture(panel, "command-runner-4-select-list");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { auditDays: 30 },
    });

    // The run completes and the panel transitions to completed
    await waitFor(
      () => panelManager.getPanel(panelId)?.commandStatus === "completed",
      60000,
      "showcase command panel to complete",
    );
    await sleep(VISUAL_MODE ? 1200 : 100);
    await focusAndCapture(panel, "command-runner-5-completed");

    // The mock really went through the whole scenario
    const events = newEntries().map((entry) => entry.event);
    assert.ok(events.includes("wsOpen"), "mock CLI must have connected");
    assert.strictEqual(
      newEntries().filter((entry) => entry.event === "promptAsked").length,
      3,
      "all three showcase prompts must have been asked",
    );
  });
});
