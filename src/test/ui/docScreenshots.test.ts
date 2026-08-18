import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  activateExtension,
  readMockLog,
  runCommandAndWaitForPanel,
  waitFor,
} from "./uiTestUtils";
import { CacheManager } from "../../utils/cache-manager";

/**
 * Documentation screenshot harness.
 *
 * Opens every LWC panel of the extension in a real Extension Development Host
 * (light theme, English, realistic fixture data served by the mocked sf CLI)
 * and saves a PNG of the VS Code window for each one, so the screenshots used
 * by the sfdx-hardis and vscode-sfdx-hardis documentation can be regenerated
 * in one command instead of being taken by hand.
 *
 * Run it with:
 *   yarn dev && yarn compile && yarn screenshots
 *
 * Environment:
 *   SFDX_HARDIS_DOC_SCREENSHOTS      "true" enables the suite (else it skips)
 *   SFDX_HARDIS_DOC_SCREENSHOTS_DIR  output folder for the PNGs
 *   SFDX_HARDIS_DOC_SCREENSHOTS_ONLY comma separated list of shot names to take
 *   SF_MOCK_DEPS_STATE               "ok" | "missing" (Setup panel state)
 *
 * Only Windows can capture the screen here (the capture goes through
 * test/fixtures/screenshot/capture-window.ps1); on other platforms the suite
 * still opens every panel, which keeps it useful as a smoke test.
 */

const ENABLED = process.env.SFDX_HARDIS_DOC_SCREENSHOTS === "true";
const OUT_DIR =
  process.env.SFDX_HARDIS_DOC_SCREENSHOTS_DIR ||
  path.join(process.cwd(), "doc-screenshots");
const ONLY = (process.env.SFDX_HARDIS_DOC_SCREENSHOTS_ONLY || "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);
const SCRIPT_DIR = path.resolve(__dirname, "../../../test/fixtures/screenshot");
const CAPTURE_SCRIPT = path.join(SCRIPT_DIR, "capture-window.ps1");
const CLICK_SCRIPT = path.join(SCRIPT_DIR, "click-window.ps1");
const RECORD_SCRIPT = path.join(SCRIPT_DIR, "record-window.ps1");

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldTake(name: string): boolean {
  return ONLY.length === 0 || ONLY.includes(name);
}

/**
 * Saves the VS Code window as <OUT_DIR>/<name>.png.
 */
// The Extension Development Host prefixes its window title with
// "[Extension Development Host]", which has no place in a documentation
// screenshot: the title bar is cropped out of every capture.
const TITLE_BAR_HEIGHT = 38;

function capture(
  name: string,
  options: { crop?: { top?: number; bottom?: number } } = {},
): void {
  if (process.platform !== "win32") {
    console.log(`      [shot] ${name}: skipped (capture is Windows only)`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    CAPTURE_SCRIPT,
    "-OutFile",
    file,
    // Matches the Extension Development Host only: any other VS Code window
    // open on the machine must not be captured
    "-TitleMatch",
    "MyCompany-CRM",
    "-Maximize",
  ];
  args.push("-CropTop", String(options.crop?.top ?? TITLE_BAR_HEIGHT));
  if (options.crop?.bottom) {
    args.push("-CropBottom", String(options.crop.bottom));
  }
  try {
    const out = execFileSync("powershell", args, {
      stdio: "pipe",
      timeout: 30000,
    });
    console.log(`      [shot] ${out.toString().trim()}`);
  } catch (error: any) {
    console.log(
      `      [shot] ${name}: FAILED ${error?.stderr?.toString() || error?.message}`,
    );
  }
}

/**
 * Captures the window once the panel stopped changing.
 *
 * Panels finish rendering asynchronously (the pipeline builds its mermaid
 * diagram, tables paint their rows), and a fixed wait either captures a
 * spinner or wastes time. Capturing twice and comparing the bytes is what
 * tells that the panel is actually done.
 */
async function captureStable(
  name: string,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 1200;
  const file = path.join(OUT_DIR, `${name}.png`);
  let previous: Buffer | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    capture(name);
    if (process.platform !== "win32" || !fs.existsSync(file)) {
      return;
    }
    const current = fs.readFileSync(file);
    if (previous && current.equals(previous)) {
      return;
    }
    previous = current;
    await sleep(intervalMs);
  }
  console.log(`      [shot] ${name}: still animating after ${attempts} tries`);
}

/**
 * Clicks inside the webview, in the coordinate system of the captured PNG.
 * Some panel states (selected workspace, active tab, expanded section) live in
 * the LWC and can only be reached with a real click.
 */
async function click(
  x: number,
  y: number,
  options: { scroll?: number } = {},
): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    CLICK_SCRIPT,
    "-X",
    String(x),
    "-Y",
    String(y),
    "-CropTop",
    String(TITLE_BAR_HEIGHT),
  ];
  if (options.scroll) {
    args.push("-Scroll", String(options.scroll));
  }
  try {
    execFileSync("powershell", args, { stdio: "pipe", timeout: 20000 });
  } catch (error: any) {
    console.log(
      `      [shot] click(${x},${y}) FAILED ${error?.stderr?.toString() || error?.message}`,
    );
  }
  await sleep(900);
}

/**
 * Opens a panel through its VS Code command, waits for the webview to be ready
 * and for its data to arrive, then captures the window.
 */
async function shootPanel(
  panelManager: any,
  options: {
    name: string;
    command: string;
    lwcId: string;
    /** Extra settle time (ms) for panels that load their data asynchronously */
    settleMs?: number;
    /** Predicate on the panel initialization data, polled before capturing */
    ready?: (initData: any) => boolean;
    /** Clicks to perform inside the webview before capturing */
    clicks?: Array<{ x: number; y: number; scroll?: number }>;
  },
): Promise<any> {
  if (!shouldTake(options.name)) {
    return null;
  }
  // One tab per screenshot: a crowded tab bar hides the panel title and pushes
  // the earlier tabs out of view
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await sleep(400);
  await vscode.commands.executeCommand(options.command);
  const panel = await waitFor(
    () => panelManager.getPanel(options.lwcId),
    20000,
    `${options.lwcId} panel to open`,
  );
  if (options.ready) {
    try {
      await waitFor(
        () => options.ready!(panel.getInitializationData() || {}),
        25000,
        `${options.lwcId} panel data`,
      );
    } catch (error) {
      console.log(`      [shot] ${options.name}: ${(error as Error).message}`);
    }
  }
  panel.reveal();
  await sleep(options.settleMs ?? 2500);
  await cleanChrome();
  for (const step of options.clicks || []) {
    await click(step.x, step.y, { scroll: step.scroll });
  }
  if (options.clicks?.length) {
    await cleanChrome();
  }
  await captureStable(options.name);
  return panel;
}

/**
 * Records the window while `scenario` drives the UI, into
 * <OUT_DIR>/recordings/<name>/frame-NNNN.png. The animated GIFs of the
 * documentation are recorded by hand (see docs/animated-gifs.md); these frames
 * are only raw material for them.
 */
async function record(
  name: string,
  seconds: number,
  scenario: () => Promise<void>,
  fps = 5,
): Promise<void> {
  if (process.platform !== "win32") {
    await scenario();
    return;
  }
  const outDir = path.join(OUT_DIR, "recordings", name);
  fs.mkdirSync(outDir, { recursive: true });
  const recorder = spawn(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      RECORD_SCRIPT,
      "-OutDir",
      outDir,
      "-Seconds",
      String(seconds),
      "-Fps",
      String(fps),
      "-CropTop",
      String(TITLE_BAR_HEIGHT),
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: false },
  );
  let recorderOutput = "";
  recorder.stdout?.on("data", (chunk) => (recorderOutput += chunk.toString()));
  recorder.stderr?.on("data", (chunk) => (recorderOutput += chunk.toString()));
  const finished = new Promise<void>((resolve) => recorder.on("exit", resolve));
  // Toasts (extension activation warnings, upgrade prompts) can pop up in the
  // middle of a scenario: keep dismissing them while recording
  const toastCleaner = setInterval(() => {
    void vscode.commands.executeCommand("notifications.clearAll");
  }, 1200);
  await sleep(1200); // let the recorder attach before the first action
  try {
    await scenario();
    await finished;
  } finally {
    clearInterval(toastCleaner);
  }
  const frames = fs.readdirSync(outDir).filter((f) => f.endsWith(".png"));
  console.log(
    `      [rec] ${name}: ${frames.length} frames ${recorderOutput.trim()}`,
  );
}

/**
 * Writes the versions served by the mocked CLI into the npm "latest version"
 * cache, and marks them fresh so no background refresh overwrites them.
 */
async function seedNpmVersionCache(): Promise<void> {
  const versionsFile = process.env.SF_MOCK_VERSIONS_FILE || "";
  if (!versionsFile || !fs.existsSync(versionsFile)) {
    return;
  }
  const versions = JSON.parse(fs.readFileSync(versionsFile, "utf8"));
  const ONE_DAY_MS = 1000 * 60 * 60 * 24;
  try {
    for (const [packageName, version] of Object.entries(versions)) {
      if (packageName === "node") {
        continue;
      }
      await CacheManager.set(
        "app",
        `npmLatest:${packageName}`,
        version,
        ONE_DAY_MS * 7,
      );
      await CacheManager.set(
        "app",
        `npmLatestFresh:${packageName}`,
        true,
        ONE_DAY_MS,
      );
    }
  } catch (error) {
    // Only possible when out/extension.js is the webpack bundle, which owns
    // its own copy of CacheManager. Outbound HTTP is blocked anyway, so the
    // panels simply show no "latest version" instead of a wrong one.
    console.log(
      `      [shot] npm version cache not seeded: ${(error as Error).message}`,
    );
  }
}

/**
 * Removes everything that must not appear in a documentation screenshot:
 * toast notifications (upgrade prompts, warnings) and the auxiliary side bar.
 */
async function cleanChrome(): Promise<void> {
  await vscode.commands.executeCommand("notifications.clearAll");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await sleep(600);
}

suite("Documentation screenshots", function () {
  this.timeout(600000);
  let panelManager: any;

  suiteSetup(async function () {
    if (!ENABLED) {
      this.skip();
    }
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();

    // Show the SFDX Hardis activity bar view: it is part of most screenshots
    await vscode.commands.executeCommand(
      "workbench.view.extension.sfdx-hardis-explorer",
    );
    // Let the trees, the status bar and the CLI probes settle
    await sleep(6000);

    // Make the "latest published version" of every dependency equal to the
    // version the mocked CLI reports as installed: nothing shows up as
    // "upgrade available". Seeding happens after the startup probes so a late
    // answer cannot overwrite it, and the trees are refreshed afterwards.
    await seedNpmVersionCache();
    await vscode.commands.executeCommand(
      "vscode-sfdx-hardis.refreshPluginsView",
      true,
    );
    await sleep(5000);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`      [shot] writing screenshots to ${OUT_DIR}`);
  });

  test("sidebar: commands, status and dependencies trees", async function () {
    if (!shouldTake("sidebar")) {
      this.skip();
    }
    // No editor open: the sidebar is the subject of this shot
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand(
      "workbench.view.extension.sfdx-hardis-explorer",
    );
    await sleep(3000);
    await cleanChrome();
    await captureStable("sidebar");
  });

  // The CI/CD guides illustrate their steps with a crop of a single menu entry
  // (docs/assets/images/btn-*.jpg). Those crops are cut out of these captures
  // by scripts/crop-doc-screenshots.js.
  test("welcome page", async function () {
    await shootPanel(panelManager, {
      name: "welcome",
      command: "vscode-sfdx-hardis.showWelcome",
      lwcId: "s-welcome",
      settleMs: 3500,
    });
  });

  test("setup / install dependencies", async function () {
    await shootPanel(panelManager, {
      name: "setup",
      command: "vscode-sfdx-hardis.showSetup",
      lwcId: "s-setup",
      // The panel checks every dependency one by one after mounting
      settleMs: 9000,
    });
  });

  test("orgs manager", async function () {
    await shootPanel(panelManager, {
      name: "orgs-manager",
      command: "vscode-sfdx-hardis.openOrgsManager",
      lwcId: "s-org-manager",
      settleMs: 3500,
      ready: (data) => Array.isArray(data.orgs) && data.orgs.length > 0,
    });
  });

  test("devops pipeline", async function () {
    await shootPanel(panelManager, {
      name: "devops-pipeline",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      // The mermaid bundle is loaded and the diagram built after the panel
      // opens: captureStable() then waits for the SVG to actually be painted
      settleMs: 9000,
    });
  });

  test("pipeline configuration", async function () {
    await shootPanel(panelManager, {
      name: "pipeline-config",
      command: "vscode-sfdx-hardis.showPipelineConfig",
      lwcId: "s-pipeline-config",
      settleMs: 3500,
    });
  });

  test("metadata retriever", async function () {
    await shootPanel(panelManager, {
      name: "metadata-retriever",
      command: "vscode-sfdx-hardis.showMetadataRetriever",
      lwcId: "s-metadata-retriever",
      settleMs: 5000,
      // "Search Metadata": the panel opens on an empty state
      clicks: [{ x: 571, y: 301 }],
    });
  });

  test("data workbench", async function () {
    await shootPanel(panelManager, {
      name: "data-workbench",
      command: "vscode-sfdx-hardis.showDataWorkbench",
      lwcId: "s-data-workbench",
      settleMs: 3500,
      // Select the first SFDMU workspace, else the panel shows its empty state
      clicks: [{ x: 625, y: 272 }],
    });
  });

  test("files workbench", async function () {
    await shootPanel(panelManager, {
      name: "files-workbench",
      command: "vscode-sfdx-hardis.showFilesWorkbench",
      lwcId: "s-files-workbench",
      settleMs: 3500,
      // Select the first files workspace, else the panel shows its empty state
      clicks: [{ x: 625, y: 272 }],
    });
  });

  test("documentation workbench", async function () {
    await shootPanel(panelManager, {
      name: "documentation-workbench",
      command: "vscode-sfdx-hardis.showDocumentationWorkbench",
      lwcId: "s-documentation-workbench",
      settleMs: 3500,
    });
  });

  test("org monitoring", async function () {
    await shootPanel(panelManager, {
      name: "org-monitoring",
      command: "vscode-sfdx-hardis.showOrgMonitoring",
      lwcId: "s-org-monitoring",
      settleMs: 3500,
    });
  });

  test("monitoring configuration", async function () {
    await shootPanel(panelManager, {
      name: "monitoring-config",
      command: "vscode-sfdx-hardis.showMonitoringConfig",
      lwcId: "s-monitoring-config",
      settleMs: 3500,
    });
  });

  test("installed packages", async function () {
    await shootPanel(panelManager, {
      name: "installed-packages",
      command: "vscode-sfdx-hardis.showInstalledPackages",
      lwcId: "s-installed-packages",
      settleMs: 4000,
    });
  });

  test("command runner (showcase run)", async function () {
    if (!shouldTake("command-runner")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const mockLogStart = readMockLog().length;
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:org:mock-showcase",
    );
    const panel = panelManager.getPanel(panelId);
    const asked = (promptName: string) =>
      readMockLog()
        .slice(mockLogStart)
        .some(
          (entry) =>
            entry.event === "promptAsked" && entry.promptName === promptName,
        );

    // 1. Sections, sub-command, warning, table and the first question
    await waitFor(() => asked("setDefault"), 30000, "first prompt");
    await sleep(1500);
    await cleanChrome();
    capture("command-runner-question");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { setDefault: "yes" },
    });

    // 2. Multiselect prompt: the most representative state of the panel
    await waitFor(() => asked("customSettings"), 30000, "multiselect prompt");
    await sleep(1500);
    await cleanChrome();
    capture("command-runner-multiselect");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { customSettings: ["APITalenDev__c", "Languages__c"] },
    });

    await waitFor(() => asked("auditDays"), 30000, "list prompt");
    await sleep(1200);
    panel.simulateWebviewMessage({ type: "submit", data: { auditDays: 30 } });

    // 3. Completed run, with its report files bar
    await waitFor(
      () => panelManager.getPanel(panelId)?.commandStatus === "completed",
      60000,
      "command panel to complete",
    );
    await sleep(1500);
    await cleanChrome();
    capture("command-runner-completed");
  });

  // ---------------------------------------------------------------------
  // Animated recordings: the documentation illustrates several panels with a
  // GIF. Each scenario drives the panel while the screen is recorded.
  // ---------------------------------------------------------------------

  test("recording: welcome page tour", async function () {
    if (!shouldTake("rec-welcome")) {
      this.skip();
    }
    const panel = await shootPanel(panelManager, {
      name: "welcome-for-recording",
      command: "vscode-sfdx-hardis.showWelcome",
      lwcId: "s-welcome",
      settleMs: 2500,
    });
    void panel;
    await record("welcome", 16, async () => {
      for (let i = 0; i < 5; i++) {
        await click(1170, 600, { scroll: -3 });
      }
      await sleep(1500);
      for (let i = 0; i < 5; i++) {
        await click(1170, 600, { scroll: 3 });
      }
      await sleep(1500);
    });
  });

  test("recording: orgs manager", async function () {
    if (!shouldTake("rec-orgs-manager")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "orgs-manager-for-recording",
      command: "vscode-sfdx-hardis.openOrgsManager",
      lwcId: "s-org-manager",
      settleMs: 2500,
      ready: (data) => Array.isArray(data.orgs) && data.orgs.length > 0,
    });
    await record("orgs-manager", 15, async () => {
      await click(1318, 95); // "View all orgs" toggle
      await sleep(2500);
      await click(1846, 211); // row actions of the default org
      await sleep(2500);
      await click(1318, 95); // back to the recommended orgs
      await sleep(2000);
    });
  });

  test("recording: devops pipeline", async function () {
    if (!shouldTake("rec-pipeline")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "pipeline-for-recording",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      settleMs: 5000,
    });
    await record("devops-pipeline", 16, async () => {
      await sleep(2000);
      await click(880, 771); // "Open Pull Requests" tab
      await sleep(3000);
      await click(618, 771); // "Project Contribution Workflow" tab
      await sleep(2500);
      for (let i = 0; i < 3; i++) {
        await click(1170, 600, { scroll: -2 });
      }
      await sleep(1500);
    });
  });

  test("recording: metadata retriever", async function () {
    if (!shouldTake("rec-metadata-retriever")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "metadata-retriever-for-recording",
      command: "vscode-sfdx-hardis.showMetadataRetriever",
      lwcId: "s-metadata-retriever",
      settleMs: 4000,
    });
    await record("metadata-retriever", 18, async () => {
      await click(571, 301); // Search Metadata
      await sleep(3000);
      await click(476, 428); // select the first result
      await sleep(1200);
      await click(476, 479); // and the second one
      await sleep(1500);
      for (let i = 0; i < 3; i++) {
        await click(1170, 700, { scroll: -2 });
      }
      await sleep(2000);
    });
  });

  test("recording: monitoring configuration", async function () {
    if (!shouldTake("rec-monitoring-config")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "monitoring-config-for-recording",
      command: "vscode-sfdx-hardis.showMonitoringConfig",
      lwcId: "s-monitoring-config",
      settleMs: 3000,
    });
    await record("monitoring-config", 18, async () => {
      await sleep(1500);
      await click(1230, 291); // open a frequency picker
      await sleep(2500);
      await click(1230, 291); // close it
      await sleep(1000);
      for (let i = 0; i < 6; i++) {
        await click(1170, 600, { scroll: -3 });
      }
      await sleep(2000);
    });
  });

  test("recording: documentation workbench", async function () {
    if (!shouldTake("rec-documentation-workbench")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "documentation-workbench-for-recording",
      command: "vscode-sfdx-hardis.showDocumentationWorkbench",
      lwcId: "s-documentation-workbench",
      settleMs: 3000,
    });
    await record("documentation-workbench", 15, async () => {
      await sleep(1500);
      for (let i = 0; i < 6; i++) {
        await click(1170, 600, { scroll: -3 });
      }
      await sleep(2000);
      for (let i = 0; i < 6; i++) {
        await click(1170, 600, { scroll: 3 });
      }
      await sleep(1500);
    });
  });

  /**
   * Runs one of the CI/CD workflow commands and records it, answering each
   * question after a pause long enough for the prompt to be visible in the GIF.
   */
  async function recordWorkflowCommand(
    name: string,
    command: string,
    seconds: number,
    answers: Array<{ prompt: string; data: any }>,
  ): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const mockLogStart = readMockLog().length;
    await record(name, seconds, async () => {
      const panelId = await runCommandAndWaitForPanel(panelManager, command);
      const panel = panelManager.getPanel(panelId);
      for (const answer of answers) {
        await waitFor(
          () =>
            readMockLog()
              .slice(mockLogStart)
              .some(
                (entry) =>
                  entry.event === "promptAsked" &&
                  entry.promptName === answer.prompt,
              ),
          30000,
          `prompt ${answer.prompt}`,
        );
        await sleep(1800); // the question must be readable in the recording
        panel.simulateWebviewMessage({ type: "submit", data: answer.data });
      }
      await waitFor(
        () => panelManager.getPanel(panelId)?.commandStatus === "completed",
        40000,
        `${command} to complete`,
      );
      await sleep(2500);
    });
  }

  test("recording: new user story", async function () {
    if (!shouldTake("rec-work-new")) {
      this.skip();
    }
    await recordWorkflowCommand("work-new", "sf hardis:work:new", 26, [
      { prompt: "project", data: { project: "CRM" } },
      { prompt: "userStoryType", data: { userStoryType: "features" } },
      {
        prompt: "userStoryName",
        data: { userStoryName: "CRM-1042 Account hierarchy" },
      },
      { prompt: "targetOrg", data: { targetOrg: "sandbox" } },
    ]);
  });

  test("recording: save user story", async function () {
    if (!shouldTake("rec-work-save")) {
      this.skip();
    }
    await recordWorkflowCommand("work-save", "sf hardis:work:save", 24, [
      { prompt: "confirmUpdates", data: { confirmUpdates: "yes" } },
    ]);
  });

  test("recording: publish user story", async function () {
    if (!shouldTake("rec-work-publish")) {
      this.skip();
    }
    await recordWorkflowCommand("work-publish", "sf hardis:work:publish", 22, [
      { prompt: "targetBranch", data: { targetBranch: "integration" } },
    ]);
  });

  test("extension configuration", async function () {
    await shootPanel(panelManager, {
      name: "extension-config",
      command: "vscode-sfdx-hardis.showExtensionConfig",
      lwcId: "s-extension-config",
      settleMs: 3000,
    });
  });

  test("sidebar: dependencies tree alone", async function () {
    if (!shouldTake("sidebar-dependencies")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand(
      "workbench.view.extension.sfdx-hardis-explorer",
    );
    await sleep(2000);
    await click(130, 57); // COMMANDS header: collapse
    await click(130, 85); // STATUS header (moved up): collapse
    await cleanChrome();
    await captureStable("sidebar-dependencies");
    // Restore the default side bar layout for the next screenshots
    await click(130, 85); // STATUS: expand
    await click(130, 57); // COMMANDS: expand
  });
  test("sidebar: commands tree with every CI/CD section expanded", async function () {
    if (!shouldTake("sidebar-commands")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand(
      "workbench.view.extension.sfdx-hardis-explorer",
    );
    await sleep(2000);
    // Collapse the Status and Dependencies views so the commands tree gets the
    // full height of the side bar
    await click(130, 664); // DEPENDENCIES header
    await click(130, 362); // STATUS header
    await cleanChrome();
    capture("sidebar-commands-collapsed");

    // Expand, capture and collapse again each section holding a documented
    // menu entry. Row positions are stable: 27.5px per row, first row at 85.
    const sections: Array<{ name: string; y: number }> = [
      { name: "advanced", y: 278 }, // CI/CD (advanced)
      { name: "misc", y: 305 }, // CI/CD (misc)
      { name: "org-operations", y: 415 }, // Org Operations
      { name: "setup", y: 498 }, // Setup Configuration
      { name: "packaging", y: 525 }, // Packaging
    ];
    for (const section of sections) {
      await click(150, section.y);
      await cleanChrome();
      capture(`sidebar-commands-${section.name}`);
      await click(150, section.y);
    }
    // Restore the default side bar layout for the next screenshots
    await click(130, 362); // STATUS: expand
    await click(130, 664); // DEPENDENCIES: expand
  });
});
