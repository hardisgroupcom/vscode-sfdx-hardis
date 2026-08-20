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
// Width of the activity bar + side bar in a capture: recordings crop it out
// (must match SIDE_BAR_WIDTH in scripts/build-doc-images.py)
const SIDE_BAR_WIDTH = 435;

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
    /** Open and capture even when the name is not in the ONLY filter (used by
     * the recording tests, whose pre-shot must not depend on the filter) */
    force?: boolean;
  },
): Promise<any> {
  if (!options.force && !shouldTake(options.name)) {
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
  // Purge frames of a previous run: a shorter new recording must not leave
  // stale trailing frames that would end up in the assembled GIF
  fs.rmSync(outDir, { recursive: true, force: true });
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
      // The documentation GIFs show the panel only: the activity bar and the
      // side bar are cropped out (they carry nothing relevant to the scenario)
      "-CropLeft",
      String(SIDE_BAR_WIDTH),
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

/**
 * Returns a predicate telling whether the mocked CLI asked a given prompt
 * since the moment this tracker was created (see promptAsked entries logged
 * by test/fixtures/sf-shim/sf-mock.js).
 */
/**
 * The DevOps Pipeline renders twice: first without pull requests (short
 * diagram), then with them once the git provider answered (taller diagram,
 * cards pushed down). Clicking before the second render hits the wrong card,
 * so every pipeline capture waits for the final payload.
 */
function pipelineFullyLoaded(data: any): boolean {
  return (
    data.prLoading === false &&
    Array.isArray(data.openPullRequests) &&
    data.openPullRequests.length > 0
  );
}

function trackAskedPrompts(): (promptName: string) => boolean {
  const mockLogStart = readMockLog().length;
  return (promptName: string) =>
    readMockLog()
      .slice(mockLogStart)
      .some(
        (entry) =>
          entry.event === "promptAsked" && entry.promptName === promptName,
      );
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
      ready: pipelineFullyLoaded,
      // The mermaid bundle is loaded and the diagram built after the panel
      // opens: captureStable() then waits for the SVG to actually be painted
      settleMs: 9000,
    });
  });

  test("pipeline: contribution cards and branch modal", async function () {
    if (!shouldTake("pipeline-modals")) {
      this.skip();
    }
    // Zoom the window out one level so the second row of contribution cards
    // (with the "My Pull Request" card) fits in the capture
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(800);
    try {
      await shootPanel(panelManager, {
        name: "pipeline-workflow-cards",
        command: "vscode-sfdx-hardis.showPipeline",
        lwcId: "s-pipeline",
        ready: pipelineFullyLoaded,
        settleMs: 9000,
        force: true,
      });
      // Single-PR modal of the current branch: Deployment Actions tab, then the
      // Add New Action editor (still zoomed out; the published image is a crop
      // of the modal, so the zoom only affects its resolution)
      await click(1500, 750); // "My Pull Request" card
      await sleep(2500);
      await cleanChrome();
      await captureStable("pipeline-pr-modal");
      await click(543, 156); // "Deployment Actions" tab of the PR modal
      await sleep(1200);
      await captureStable("pipeline-pr-actions-empty");
      await click(425, 205); // "Add New Action"
      await sleep(1500);
      await captureStable("pipeline-edit-action");
      // Close the editor and the PR modal before the branch-modal shots
      await click(1355, 675); // Cancel button of the action editor
      await sleep(800);
      await click(1863, 54); // close cross of the PR modal
      await sleep(800);
    } finally {
      // Always restore the zoom: a leaked zoom level would skew every
      // following capture of the run
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await sleep(800);
    }
    // Branch modal: click the "integration" branch node of the mermaid, then
    // its Deployment Actions tab
    await sleep(1000);
    await click(850, 405); // integration branch node
    await sleep(2500);
    await cleanChrome();
    await captureStable("pipeline-branch-modal");
    await click(958, 227); // "Deployment Actions" tab of the modal
    await sleep(1500);
    await captureStable("pipeline-branch-modal-actions");
  });

  // One screenshot of the "Edit Deployment Action" editor per action type,
  // pre-filled from the PR #125 fixture actions
  // (test/fixtures/doc-screenshots-project/scripts/actions/.sfdx-hardis.125.yml).
  // Feeds the docs images screenshot-deployment-action-<type>.jpg of
  // salesforce-ci-cd-work-on-task-deployment-actions.md.
  test("pipeline: deployment action editors", async function () {
    if (!shouldTake("pipeline-action-editors")) {
      this.skip();
    }
    // Rows of the Deployment Actions tab of the PR modal, in display order
    // editY: y of the Edit button of the read-only details view, which
    // depends on the height of the modal (one height per action type)
    const ACTION_EDITOR_SHOTS: Array<{
      name: string;
      row: number;
      editY: number;
    }> = [
      { name: "pipeline-edit-action-command", row: 0, editY: 672 },
      { name: "pipeline-edit-action-data", row: 1, editY: 671 },
      {
        name: "pipeline-edit-action-remove-packagexml-items",
        row: 2,
        editY: 696,
      },
      { name: "pipeline-edit-action-apex", row: 3, editY: 671 },
      { name: "pipeline-edit-action-schedule-batch", row: 4, editY: 740 },
      { name: "pipeline-edit-action-publish-community", row: 5, editY: 671 },
      { name: "pipeline-edit-action-manual", row: 6, editY: 714 },
    ];
    const FIRST_ROW_CENTER_Y = 270;
    const ROW_STEP = 36;
    // Clicking the action label opens its editor
    const EDIT_BUTTON_X = 610;
    // Zoomed out two levels, like the other modal shots: the editors of every
    // type fit in the window and the published images are crops of the modal
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(800);
    let firstIteration = true;
    try {
      for (const shot of ACTION_EDITOR_SHOTS) {
        // Reload the panel for each editor: closing all editors resets every
        // modal state, which is more robust than clicking per-type Cancel
        // buttons whose position depends on the editor height
        await shootPanel(panelManager, {
          name: "pipeline-action-editors-base",
          command: "vscode-sfdx-hardis.showPipeline",
          lwcId: "s-pipeline",
          ready: pipelineFullyLoaded,
          settleMs: 8000,
          force: true,
        });
        await click(1500, 750); // "My Pull Request" card
        await sleep(2500);
        await click(543, 156); // "Deployment Actions" tab of the PR modal
        await sleep(1500);
        if (firstIteration) {
          await cleanChrome();
          await captureStable("pipeline-pr-actions-list");
          firstIteration = false;
        }
        await click(EDIT_BUTTON_X, FIRST_ROW_CENTER_Y + shot.row * ROW_STEP);
        await sleep(1800);
        // Switch the read-only details view to the editable form: the published
        // screenshots must show the values inside editable fields
        await click(1360, shot.editY); // "Edit" button of the details view
        await sleep(1500);
        await captureStable(shot.name);
      }
    } finally {
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await sleep(800);
    }
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
    const asked = trackAskedPrompts();
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:org:mock-showcase",
    );
    const panel = panelManager.getPanel(panelId);

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

  // Productivity command example: reactivation of the sandbox users whose
  // email was suffixed with .invalid by a refresh. Its multiselect question is
  // the docs image ProductivityCommands.png.
  test("command runner (activate invalid users)", async function () {
    if (!shouldTake("user-activateinvalid")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const asked = trackAskedPrompts();
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:org:user:activateinvalid",
    );
    const panel = panelManager.getPanel(panelId);

    await waitFor(() => asked("confirmSelect"), 30000, "confirm prompt");
    await sleep(1200);
    panel.simulateWebviewMessage({
      type: "submit",
      data: { confirmSelect: "select" },
    });

    // The users multiselect: the most representative state of the command
    await waitFor(() => asked("selectUsers"), 30000, "users multiselect");
    await sleep(1500);
    await cleanChrome();
    capture("user-activateinvalid-multiselect");
    panel.simulateWebviewMessage({
      type: "submit",
      data: {
        selectUsers: [
          "alex.martin@mycompany.com",
          "amelia.clark@mycompany.com",
          "bruno.keller@mycompany.com",
          "carla.mendes@mycompany.com",
          "david.osei@mycompany.com",
          "elena.petrova@mycompany.com",
          "farid.haddad@mycompany.com",
        ],
      },
    });

    await waitFor(
      () => panelManager.getPanel(panelId)?.commandStatus === "completed",
      60000,
      "activateinvalid to complete",
    );
    await sleep(1500);
    await cleanChrome();
    capture("user-activateinvalid-completed");
  });

  // Full package installation journey, recorded for
  // docs/assets/images/animation-install-packages.gif: Manage Packages card of
  // the DevOps Pipeline -> Installed Packages workbench -> Install new package
  // -> hardis:package:install run -> back to the workbench where the newly
  // installed package appears after a refresh.
  test("recording: install packages", async function () {
    if (!shouldTake("rec-install-packages")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "pipeline-for-recording",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      ready: pipelineFullyLoaded,
      settleMs: 9000,
      force: true,
    });
    const asked = trackAskedPrompts();
    await record("install-packages", 42, async () => {
      await sleep(1500);
      await click(1630, 850); // "Manage Packages" contribution card
      await waitFor(
        () => panelManager.getPanel("s-installed-packages"),
        20000,
        "installed packages panel to open",
      );
      await sleep(3000);
      const knownPanels = new Set<string>(panelManager.getActivePanelIds());
      await click(1636, 109); // "Install new package"
      const commandPanelId = await waitFor(
        () =>
          panelManager
            .getActivePanelIds()
            .find(
              (id: string) =>
                id.startsWith("s-command-execution-") && !knownPanels.has(id),
            ),
        20000,
        "package install command panel to open",
      );
      const commandPanel = panelManager.getPanel(commandPanelId);
      const answers: Array<{ prompt: string; data: any }> = [
        { prompt: "selectPackage", data: { selectPackage: "other" } },
        {
          prompt: "packageVersionId",
          data: { packageVersionId: "04t5p000001BlVPAA0" },
        },
        { prompt: "installationKey", data: { installationKey: "" } },
        { prompt: "packagesToConfig", data: { packagesToConfig: ["dlrs"] } },
        { prompt: "installConfig", data: { installConfig: "scratch-deploy" } },
      ];
      for (const answer of answers) {
        await waitFor(() => asked(answer.prompt), 30000, answer.prompt);
        await sleep(1800); // the question must be readable in the recording
        commandPanel.simulateWebviewMessage({
          type: "submit",
          data: answer.data,
        });
      }
      await waitFor(
        () =>
          panelManager.getPanel(commandPanelId)?.commandStatus === "completed",
        40000,
        "package install to complete",
      );
      await sleep(2500);
      // Back to the Installed Packages workbench: the new package appears
      // after a refresh (the mocked CLI registered it in .sfdx-hardis.yml)
      panelManager.getPanel("s-installed-packages").reveal();
      await sleep(1500);
      await click(1815, 109); // "Refresh"
      await sleep(3500);
    });
  });

  // ---------------------------------------------------------------------
  // Animated recordings: the documentation illustrates several panels with a
  // GIF. Each scenario drives the panel while the screen is recorded.
  // ---------------------------------------------------------------------

  test("recording: orgs manager", async function () {
    if (!shouldTake("rec-orgs-manager")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "orgs-manager-for-recording",
      force: true,
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
      force: true,
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      ready: pipelineFullyLoaded,
      settleMs: 5000,
    });
    await record("devops-pipeline", 16, async () => {
      await sleep(2000);
      await click(910, 733); // "Open Pull Requests" tab
      await sleep(3000);
      await click(618, 733); // "Project Contribution Workflow" tab
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
      force: true,
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
      force: true,
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
      force: true,
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
    const asked = trackAskedPrompts();
    await record(name, seconds, async () => {
      const panelId = await runCommandAndWaitForPanel(panelManager, command);
      const panel = panelManager.getPanel(panelId);
      for (const answer of answers) {
        await waitFor(
          () => asked(answer.prompt),
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
    await recordWorkflowCommand("work-new", "sf hardis:work:new", 32, [
      { prompt: "targetBranch", data: { targetBranch: "integration" } },
      { prompt: "storyType", data: { storyType: "feature" } },
      {
        prompt: "storyName",
        data: { storyName: "CRM-123 Sync accounts with SAP" },
      },
      { prompt: "orgType", data: { orgType: "sandbox" } },
      { prompt: "sandboxOrg", data: { sandboxOrg: "dev" } },
      { prompt: "openOrg", data: { openOrg: "no" } },
    ]);
  });

  test("recording: save / publish user story", async function () {
    if (!shouldTake("rec-work-save")) {
      this.skip();
    }
    await recordWorkflowCommand("work-save", "sf hardis:work:save", 26, [
      { prompt: "commitReady", data: { commitReady: "commitReady" } },
      { prompt: "pushCommits", data: { pushCommits: "yes" } },
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
