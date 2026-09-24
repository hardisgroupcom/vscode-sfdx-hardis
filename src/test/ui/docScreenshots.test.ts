import { execFileSync, execSync, spawn } from "child_process";
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
const WINDOW_TITLE =
  process.env.SFDX_HARDIS_DOC_SCREENSHOTS_TITLE || "MyCompany-CRM";
const SCRIPT_DIR = path.resolve(__dirname, "../../../test/fixtures/screenshot");
const CAPTURE_SCRIPT = path.join(SCRIPT_DIR, "capture-window.ps1");
const CLICK_SCRIPT = path.join(SCRIPT_DIR, "click-window.ps1");
const RECORD_SCRIPT = path.join(SCRIPT_DIR, "record-window.ps1");

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// The gate the running test was let through by. Every capture records it in
// <OUT_DIR>/.shot-gates.json, so a caller that needs one image again (the
// training course) knows which name to pass instead of taking everything.
let currentGate = "";

function shouldTake(name: string): boolean {
  const take = ONLY.length === 0 || ONLY.includes(name);
  if (take) {
    currentGate = name;
  }
  return take;
}

function recordGate(name: string): void {
  if (!currentGate || currentGate.startsWith("rec-")) {
    return;
  }
  const file = path.join(OUT_DIR, ".shot-gates.json");
  let gates: Record<string, { gate: string; state?: string }> = {};
  try {
    gates = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // First capture into this folder
  }
  const entry: { gate: string; state?: string } = { gate: currentGate };
  if (process.env.SF_MOCK_PIPELINE_STATE) {
    entry.state = process.env.SF_MOCK_PIPELINE_STATE;
  }
  gates[name] = entry;
  const sorted = Object.fromEntries(
    Object.keys(gates)
      .sort()
      .map((key) => [key, gates[key]]),
  );
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
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
    // open on the machine must not be captured. The title follows the fixture
    // universe (SF_MOCK_UNIVERSE), so a training run matches its own window.
    "-TitleMatch",
    WINDOW_TITLE,
    "-Maximize",
  ];
  args.push("-CropTop", String(options.crop?.top ?? TITLE_BAR_HEIGHT));
  if (options.crop?.bottom) {
    args.push("-CropBottom", String(options.crop.bottom));
  }
  try {
    const out = execFileSync("powershell", args, {
      stdio: "pipe",
      // Generous: while the extension host is busy the window reports an empty
      // title and the script waits for it to come back rather than losing the
      // screenshot. The Metadata Retriever blocks the host for tens of seconds
      // when it opens.
      timeout: 150000,
    });
    console.log(`      [shot] ${out.toString().trim()}`);
    recordGate(name);
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
    "-TitleMatch",
    WINDOW_TITLE,
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
    /** Argument passed to the VS Code command (ex: a pipeline deep link).
     * An array is spread, for the commands taking several arguments. */
    commandArgs?: any;
  },
): Promise<any> {
  if (!options.force && !shouldTake(options.name)) {
    return null;
  }
  // One tab per screenshot: a crowded tab bar hides the panel title and pushes
  // the earlier tabs out of view
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await sleep(400);
  if (Array.isArray(options.commandArgs)) {
    await vscode.commands.executeCommand(
      options.command,
      ...options.commandArgs,
    );
  } else if (options.commandArgs !== undefined) {
    await vscode.commands.executeCommand(options.command, options.commandArgs);
  } else {
    await vscode.commands.executeCommand(options.command);
  }
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
 * Switches the git branch of the test workspace. The "My Pull Request" card
 * and its modal show the pull request of the current branch: the workspace is
 * on `integration` (whose pull request is the promotion to uat), and the
 * deployment actions of the documentation are declared on a feature pull
 * request, so the modal shots check out its branch first.
 */
function checkoutWorkspaceBranch(branchName: string): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error("No workspace folder to check out a branch in");
  }
  execFileSync("git", ["checkout", "-q", branchName], {
    cwd: workspaceRoot,
    stdio: "pipe",
  });
}

/**
 * Where the major branch node sits in the diagram, for the click that opens its
 * window. Mermaid lays the node out from the branches the fixture carries, so
 * each universe names its own point.
 */
function universeSetting(key: string): string | null {
  const dir = process.env.SF_MOCK_UNIVERSE_DIR;
  if (!dir) {
    return null;
  }
  try {
    const universe = JSON.parse(
      fs.readFileSync(path.join(dir, "universe.json"), "utf8"),
    );
    const value = universe?.[key];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** "x,y" from a universe setting, with a fallback when it says nothing usable */
function parsePoint(
  raw: string | null,
  fallbackX: number,
  fallbackY: number,
): { x: number; y: number } {
  // Number("") is 0, not NaN, so a missing setting would silently click the
  // left edge of the window instead of falling back to the point below
  const [x, y] = (raw || "").split(",").map((part) => {
    const text = part.trim();
    return text === "" ? Number.NaN : Number(text);
  });
  return {
    x: Number.isFinite(x) ? x : fallbackX,
    y: Number.isFinite(y) ? y : fallbackY,
  };
}

const BRANCH_NODE = (() => {
  // The universe carries the point, so a fixture that changes the diagram
  // updates it in the same commit rather than in an environment variable
  // somebody has to remember. The variable still wins, for a one-off run.
  const raw =
    process.env.SFDX_HARDIS_DOC_SCREENSHOTS_BRANCH_NODE ||
    universeSetting("branchNode") ||
    "850,405";
  const [x, y] = raw.split(",").map((part) => Number(part.trim()));
  return { x: Number.isFinite(x) ? x : 850, y: Number.isFinite(y) ? y : 405 };
})();

/**
 * Feature branch the contribution cards and the deployment action editors are
 * captured from. It belongs to the fixture universe, so an alternate universe
 * (SF_MOCK_UNIVERSE) names its own through SFDX_HARDIS_DOC_SCREENSHOTS_BRANCH.
 */
const FEATURE_BRANCH =
  process.env.SFDX_HARDIS_DOC_SCREENSHOTS_BRANCH ||
  universeSetting("featureBranch") ||
  "feature/CRM-1042-account-hierarchy";
/**
 * Promotion branches variant of the run (SFDX_HARDIS_DOC_SCREENSHOTS_PROMOTION):
 * enablePromotionBranches is on in the workspace config and the git provider
 * fixture holds the uat window and the open promotion to preprod. The feature is
 * in Beta and off by default, so its shots are taken apart rather than
 * changing every pipeline screenshot of the documentation.
 */
const PROMOTION_VARIANT =
  process.env.SFDX_HARDIS_DOC_SCREENSHOTS_PROMOTION === "true";
/**
 * uat branch node of the diagram, in the coordinates of the captured PNG.
 * Mermaid lays it out from the branches the fixture carries, so a universe
 * names its own point through `promotionNode` in its universe.json.
 */
const PROMOTION_UAT_NODE = parsePoint(
  universeSetting("promotionNode"),
  1097,
  366,
);
/** Promotion branch of the fixture, source of the open promotion it carries */
const PROMOTION_BRANCH =
  universeSetting("promotionBranch") || "promotion/uat/preprod/2026-08-20-0930";
/**
 * Checkboxes of the approved User Stories of the uat window (#115 and #113 in
 * the base fixture): the same ones the promotion of the fixture carries, so the
 * branch window and the promotion Pull Request screenshots tell one story. A
 * universe with a different number of rows names its own through
 * `promotionRows`, as "x,y;x,y".
 */
const PROMOTION_TICKED_ROWS = (
  universeSetting("promotionRows") || "512,422;512,500"
)
  .split(";")
  .map((pair) => parsePoint(pair, 512, 422));
const PROMOTION_MODAL_CLOSE = { x: 1843, y: 78 };
const PIPELINE_ACTIONS_DEEP_LINK = { focus: "deploymentActions" };
/**
 * The commits the selection prompt of hardis:project:promotion:create is
 * answered with: the ones of the stories the scenario says the panel ticked,
 * read from the universe overlay when it carries the scenario, else the two of
 * the base universe (PR 113 and PR 115 of the promotion documentation).
 */
function promotionSelectedCommits(): string[] {
  const dir = process.env.SF_MOCK_UNIVERSE_DIR;
  if (dir) {
    try {
      const overlay = JSON.parse(
        fs.readFileSync(path.join(dir, "sf-mock-overlay.json"), "utf8"),
      );
      const scenario = overlay?.scenario?.promotionCreate;
      if (scenario?.candidates && scenario?.selected) {
        return scenario.candidates
          .filter((c: any) => scenario.selected.includes(c.number))
          .map((c: any) => c.commit);
      }
    } catch {
      // No overlay, or an unreadable one: the base universe's answer below
    }
  }
  return ["7c41ab9", "2f90d34"];
}
/**
 * A layout as hardis:project:promotion:create commits it when a cherry-pick
 * conflicts and the answer is to keep the markers: the target side is empty,
 * the story side brings its own item with the one it was written under. The
 * base universe's stand-in for the conflict editor shot; a universe ships its
 * own files under promotion-conflict/.
 *
 * Cut where git cuts it, not on an element boundary: the <layoutItems> and
 * <behavior> lines that open the first incoming row also open the row that
 * follows on the target, so git keeps them above the markers, and the incoming
 * side runs from the first field to the opening lines of the row after the
 * last one. Proven on a real promotion on 2026-09-24.
 */
const DEFAULT_CONFLICT_SAMPLE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Layout xmlns="http://soap.sforce.com/2006/04/metadata">',
  "    <layoutSections>",
  "        <customLabel>false</customLabel>",
  "        <detailHeading>false</detailHeading>",
  "        <editHeading>true</editHeading>",
  "        <label>Information</label>",
  "        <layoutColumns>",
  "            <layoutItems>",
  "                <behavior>Required</behavior>",
  "                <field>Name</field>",
  "            </layoutItems>",
  "            <layoutItems>",
  "                <behavior>Edit</behavior>",
  "                <field>StartDate</field>",
  "            </layoutItems>",
  "            <layoutItems>",
  "                <behavior>Edit</behavior>",
  "<<<<<<< HEAD",
  "=======",
  "                <field>Pricing_Rule__c</field>",
  "            </layoutItems>",
  "            <layoutItems>",
  "                <behavior>Edit</behavior>",
  "                <field>Appointment_Slot__c</field>",
  "            </layoutItems>",
  "            <layoutItems>",
  "                <behavior>Edit</behavior>",
  ">>>>>>> 2f90d34 (CRM-1012 Service appointment scheduler (#115))",
  "                <field>ContractTerm</field>",
  "            </layoutItems>",
  "        </layoutColumns>",
  "        <layoutColumns/>",
  "        <style>TwoColumnsTopToBottom</style>",
  "    </layoutSections>",
  "</Layout>",
  "",
].join("\n");

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
      "-TitleMatch",
      WINDOW_TITLE,
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
  // The assembler (scripts/build-doc-images.py) needs the frame rate to time
  // the GIF frames: recordings may use a higher rate than the default
  fs.writeFileSync(
    path.join(outDir, "recording.json"),
    JSON.stringify({ fps }, null, 2),
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
/** Scrolls the panel to its bottom (the result of a run), then captures the window */
async function captureBottomOfPage(name: string): Promise<void> {
  await sleep(3000);
  await cleanChrome();
  for (let step = 0; step < 6; step++) {
    await click(1100, 500, { scroll: -30 });
  }
  await sleep(1500);
  await captureStable(name);
}

async function cleanChrome(): Promise<void> {
  await vscode.commands.executeCommand("notifications.clearAll");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await sleep(600);
}

/**
 * Moves the pointer out of the side bar. A tree row left under the cursor shows
 * its tooltip, which covers the two rows below it, so every side bar capture
 * moves the pointer away first. Setting Cursor.Position is not enough: Electron
 * only drops the hover when it receives a real move, so this clicks the empty
 * editor background, which has nothing to activate.
 */
async function parkPointer(x = 1200, y = 500): Promise<void> {
  await click(x, y);
  await sleep(500);
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
  let commandsProvider: any;
  let commandsTreeView: any;

  suiteSetup(async function () {
    if (!ENABLED) {
      this.skip();
    }
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
    commandsProvider = api.hardisCommandsProvider;
    commandsTreeView = api.hardisCommandsTreeView;

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

  // There is deliberately no capture of the Extensions view here. This VS Code
  // has no access to the marketplace, so the view renders "Error while fetching
  // extensions", and the test also left the side bar on Extensions, which leaked
  // into every capture that followed it. The training uses a screenshot taken on
  // a real machine instead: labs/_assets/vscode/extensions-install.png in the
  // sfdx-hardis-training repository, which nothing here may overwrite.

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

  // The custom menus a project declares, opened on the Welcome page. Clicking a
  // card replaces the page with that menu's commands, and for a reader who does
  // not live in the side bar that page is the menu. The training has one menu
  // per level and walks all three, so all three are captured; a project with no
  // customCommands has no cards here and these come out as the plain Welcome
  // page, which is harmless.
  test("welcome page: the custom menus, opened", async function () {
    const cards = [
      { name: "welcome-custom-menu", x: 715 },
      { name: "welcome-custom-menu-2", x: 1167 },
      { name: "welcome-custom-menu-3", x: 1620 },
    ];
    // Only as many captures as the project declares menus. Without this the
    // product fixture, which declares none, would write three copies of the
    // plain Welcome page into the documentation folder.
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showWelcome");
    const welcome = await waitFor(
      () => panelManager.getPanel("s-welcome"),
      20000,
      "s-welcome panel to open",
    );
    const menus = (welcome.getInitializationData() || {}).customMenus || [];
    for (const card of cards.slice(0, menus.length)) {
      await shootPanel(panelManager, {
        name: card.name,
        command: "vscode-sfdx-hardis.showWelcome",
        lwcId: "s-welcome",
        settleMs: 3500,
        // The CUSTOM MENUS row, first band of cards under the getting started
        // strip. One click opens the menu, and the panel is reopened between
        // captures so each starts from the same page.
        clicks: [{ x: card.x, y: 470 }],
      });
    }
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

  // The row menu of the orgs table, open on the development org. Every lab that
  // says "open your org" means this menu, and the table alone does not show it:
  // the actions column is a chevron, and what it holds is the whole point.
  test("orgs manager: the actions of one org", async function () {
    await shootPanel(panelManager, {
      name: "orgs-manager-actions",
      command: "vscode-sfdx-hardis.openOrgsManager",
      lwcId: "s-org-manager",
      settleMs: 3500,
      ready: (data) => Array.isArray(data.orgs) && data.orgs.length > 0,
      // The chevron at the end of the first row, which is the dev org
      clicks: [{ x: 1826, y: 275 }],
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

  // The two menus of the DevOps Pipeline header, opened, then the package
  // viewer each entry of the second one opens. The course sends learners to
  // manifest/package.xml through this viewer, never through the Explorer, and
  // creates package-no-overwrite.xml from it (the viewer shows a missing one
  // empty, and its first Add writes it).
  test("pipeline: header menus and package viewer", async function () {
    if (!shouldTake("pipeline-menus")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "devops-pipeline",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      ready: pipelineFullyLoaded,
      settleMs: 9000,
      force: true,
    });
    await click(1720, 104); // gear menu of the header
    await sleep(2500);
    await captureStable("pipeline-settings-menu");
    // A click elsewhere does not close a lightning menu: the panel is opened again
    await shootPanel(panelManager, {
      name: "devops-pipeline",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      ready: pipelineFullyLoaded,
      settleMs: 9000,
      force: true,
    });
    await click(1772, 104); // "Deployment packages" menu
    await sleep(2500);
    await captureStable("pipeline-packages-menu");
    await shootPanel(panelManager, {
      name: "package-xml",
      command: "vscode-sfdx-hardis.showPackageXml",
      commandArgs: {
        packageType: "deploy",
        filePath: "manifest/package.xml",
        title: "Package XML - All Deployable Elements",
      },
      lwcId: "s-package-xml",
      settleMs: 2500,
      force: true,
    });
    await shootPanel(panelManager, {
      name: "package-no-overwrite",
      command: "vscode-sfdx-hardis.showPackageXml",
      commandArgs: {
        packageType: "no-overwrite",
        filePath: "manifest/package-no-overwrite.xml",
        fallbackFilePath: "manifest/packageDeployOnce.xml",
        title: "No Overwrite Package - Protected Metadata",
      },
      lwcId: "s-package-xml",
      settleMs: 2500,
      force: true,
    });
    // Edit mode, then the Add type window: how the training creates the list
    // without typing XML. Nothing is added: the window is cancelled
    await click(1582, 87); // "Edit mode" toggle
    await sleep(1200);
    await captureStable("package-no-overwrite-edit");
    await click(1830, 316); // "Add type", where Expand all was
    await sleep(1200);
    await captureStable("package-no-overwrite-add-type");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("pipeline: contribution cards and branch modal", async function () {
    if (!shouldTake("pipeline-modals")) {
      this.skip();
    }
    // The "My Pull Request" card must show a feature pull request (#128, with
    // the deployment actions fixture), not the integration -> uat promotion
    checkoutWorkspaceBranch(FEATURE_BRANCH);
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
    // Deployment Actions tab of the feature pull request modal, opened through
    // the deep link used by hardis:work:save, so no coordinate is involved.
    // Feeds screenshot-pr-deployment-actions-list.jpg. One zoom level out, so
    // that the nine actions of the fixture all fit in the modal: at two levels
    // out the lightning-datatable leaves a grey gap right of the table.
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(800);
    try {
      await shootPanel(panelManager, {
        name: "pipeline-pr-actions-list",
        command: "vscode-sfdx-hardis.showPipeline",
        lwcId: "s-pipeline",
        ready: pipelineFullyLoaded,
        settleMs: 9000,
        force: true,
        commandArgs: PIPELINE_ACTIONS_DEEP_LINK,
      });
    } finally {
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await sleep(800);
      checkoutWorkspaceBranch("integration");
    }
    // Branch modal: click the "integration" branch node of the mermaid, then
    // its Deployment Actions tab
    await shootPanel(panelManager, {
      name: "pipeline-branch-modal-base",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      ready: pipelineFullyLoaded,
      settleMs: 9000,
      force: true,
    });
    await sleep(1000);
    // Click the major branch node of the diagram to open its window. The node is
    // laid out by mermaid, so where it lands depends on how many feature
    // branches the fixture carries: an alternate universe names its own point
    // through SFDX_HARDIS_DOC_SCREENSHOTS_BRANCH_NODE ("x,y"). With the wrong
    // point the click hits empty canvas and the capture is a pipeline with no
    // window, which is what happened before this was configurable.
    await click(BRANCH_NODE.x, BRANCH_NODE.y);
    await sleep(2500);
    await cleanChrome();
    await captureStable("pipeline-branch-modal");
    await click(958, 227); // "Deployment Actions" tab of the modal
    await sleep(1500);
    await captureStable("pipeline-branch-modal-actions");
  });

  // Promotion branches (Beta), for
  // docs/salesforce-devops-promotion-branches.md. Only in the promotion variant
  // of the run:
  //   SFDX_HARDIS_DOC_SCREENSHOTS_PROMOTION=true \
  //   SFDX_HARDIS_DOC_SCREENSHOTS_DIR=doc-screenshots/promotion \
  //   yarn screenshots promotion
  test("promotion branches", async function () {
    if (!PROMOTION_VARIANT || !shouldTake("promotion")) {
      this.skip();
    }
    // The diagram, with the open promotion drawn on the uat -> preprod arrow
    await shootPanel(panelManager, {
      name: "promotion-pipeline",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      ready: pipelineFullyLoaded,
      settleMs: 9000,
      force: true,
    });
    // Window of uat: the User Stories waiting there, with the checkbox column
    // and the "Create promotion" button the release manager uses
    await sleep(1000);
    await click(PROMOTION_UAT_NODE.x, PROMOTION_UAT_NODE.y);
    await sleep(2500);
    await cleanChrome();
    for (const row of PROMOTION_TICKED_ROWS) {
      await click(row.x, row.y);
    }
    await sleep(1200);
    await captureStable("promotion-branch-modal");
    await click(PROMOTION_MODAL_CLOSE.x, PROMOTION_MODAL_CLOSE.y);
    await sleep(1500);
    // Modal of the promotion Pull Request itself, on its Deployment Actions
    // tab: the actions declared on the User Stories it carries, read-only.
    // Opened from the promotion branch through the deep link of
    // hardis:work:save, so no coordinate is involved.
    checkoutWorkspaceBranch(PROMOTION_BRANCH);
    try {
      await shootPanel(panelManager, {
        name: "promotion-pr-modal",
        command: "vscode-sfdx-hardis.showPipeline",
        lwcId: "s-pipeline",
        ready: pipelineFullyLoaded,
        settleMs: 9000,
        force: true,
        commandArgs: PIPELINE_ACTIONS_DEEP_LINK,
      });
    } finally {
      checkoutWorkspaceBranch("integration");
    }
    // Danger Zone of the Pipeline Settings, where the two project settings of
    // the feature are switched on
    await shootPanel(panelManager, {
      name: "promotion-settings",
      command: "vscode-sfdx-hardis.showPipelineConfig",
      commandArgs: [null, "Danger Zone"],
      lwcId: "s-pipeline-config",
      settleMs: 3500,
      force: true,
    });
  });

  // The command the Create promotion button runs, captured at the conflict
  // question and at the end of the run: the scenario comes from the mocked CLI
  // (DOCS_SCENARIOS in test/fixtures/sf-shim/sf-mock.js) and names the stories
  // of the current fixture universe. A lab compares the questions with the ones
  // it gets, so the panel has to replay the real command, never a stand-in.
  test("command runner (promotion create)", async function () {
    if (!PROMOTION_VARIANT || !shouldTake("promotion-create")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const asked = trackAskedPrompts();
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      universeSetting("promotionCreateCommand") ||
        "sf hardis:project:promotion:create --source-branch uat --target-branch preprod --pull-requests 113,115",
    );
    const panel = panelManager.getPanel(panelId);
    // The panel passed the ticked stories, the command asks to confirm them:
    // what the prompt pre-fills is what the button ticked, and the answer is
    // the commits of those stories, read from the scenario the mock replays
    await waitFor(() => asked("pullRequests"), 30000, "selection prompt");
    await sleep(1500);
    await cleanChrome();
    capture("promotion-create-select");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { pullRequests: promotionSelectedCommits() },
    });
    // One cherry-pick conflicts: the four answers, the recommended one first
    await waitFor(() => asked("conflict"), 30000, "conflict prompt");
    await sleep(1500);
    await cleanChrome();
    capture("promotion-create-conflict");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { conflict: "commit-with-markers-all" },
    });
    await waitFor(
      () => panelManager.getPanel(panelId)?.commandStatus === "completed",
      60000,
      "promotion create to complete",
    );
    await captureBottomOfPage("promotion-create-completed");
  });

  // A file the promotion committed with its conflict markers, open in the
  // editor: the built-in merge-conflict extension draws the Accept Current /
  // Accept Incoming / Accept Both code lenses over each block, which is the
  // by-hand route of solving a promotion conflict. The files come from the
  // universe fixture (promotion-conflict/ next to its universe.json), committed
  // on the promotion branch of the workspace for the shot and gone with it.
  test("promotion conflict editor", async function () {
    if (!PROMOTION_VARIANT || !shouldTake("promotion-conflict")) {
      this.skip();
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error("No workspace folder to write the conflicted file in");
    }
    const conflictFile =
      universeSetting("promotionConflictFile") ||
      "force-app/main/default/layouts/Contract-Contract Layout.layout-meta.xml";
    const sampleDir = process.env.SF_MOCK_UNIVERSE_DIR
      ? path.join(process.env.SF_MOCK_UNIVERSE_DIR, "promotion-conflict")
      : "";
    const gitIn = (args: string[]) =>
      execFileSync("git", args, { cwd: workspaceRoot, stdio: "pipe" });
    checkoutWorkspaceBranch(PROMOTION_BRANCH);
    try {
      const target = path.join(workspaceRoot, conflictFile);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (sampleDir && fs.existsSync(sampleDir)) {
        fs.cpSync(sampleDir, workspaceRoot, { recursive: true });
      } else {
        // The base universe: the same shape on a MyCompany-CRM layout
        fs.writeFileSync(target, DEFAULT_CONFLICT_SAMPLE, "utf8");
      }
      gitIn(["add", "-A"]);
      gitIn([
        "commit",
        "-q",
        "--no-gpg-sign",
        "-m",
        "CRM-1012 Service appointment scheduler (#115)",
      ]);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await sleep(400);
      const document = await vscode.workspace.openTextDocument(target);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      // The first conflict block in the middle of the editor, its code lenses
      // in view
      const firstMarker = document
        .getText()
        .split("\n")
        .findIndex((line) => line.startsWith("<<<<<<< "));
      const anchor = Math.max(0, firstMarker);
      editor.revealRange(
        new vscode.Range(anchor, 0, anchor + 14, 0),
        vscode.TextEditorRevealType.InCenter,
      );
      await sleep(3500);
      await cleanChrome();
      await captureStable("promotion-conflict-editor");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await sleep(300);
      checkoutWorkspaceBranch("integration");
    }
  });

  // One screenshot of the "Edit Deployment Action" editor per action type,
  // pre-filled from the PR #128 fixture actions
  // (test/fixtures/doc-screenshots-project/scripts/actions/.sfdx-hardis.128.yml).
  // Feeds the docs images screenshot-deployment-action-<type>.jpg of
  // salesforce-devops-work-on-user-story-deployment-actions.md.
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
      // The two last actions of the fixture restrict their target orgs, so
      // their editor also shows the branch selector (taller modal)
      { name: "pipeline-edit-action-target-orgs-include", row: 7, editY: 796 },
      { name: "pipeline-edit-action-target-orgs-exclude", row: 8, editY: 796 },
      // A custom function type: the form below the common fields is built from
      // the inputs the function declares, so the modal is taller again
      { name: "pipeline-edit-action-custom-function", row: 9, editY: 796 },
    ];
    // A universe whose Pull Request declares its actions in another order says
    // so, because these shots are taken by row position. The names are the shot
    // names without their "pipeline-edit-action-" prefix.
    const declaredOrder = (universeSetting("actionEditorOrder") || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const rowOf = (shot: { name: string; row: number }) => {
      if (declaredOrder.length === 0) {
        return shot.row;
      }
      const index = declaredOrder.indexOf(
        shot.name.replace("pipeline-edit-action-", ""),
      );
      return index === -1 ? shot.row : index;
    };
    const FIRST_ROW_CENTER_Y = 270;
    const ROW_STEP = 36;
    // Clicking the action label opens its editor
    const EDIT_BUTTON_X = 610;
    // The actions belong to the feature pull request of the fixture branch
    checkoutWorkspaceBranch(FEATURE_BRANCH);
    // Zoomed out two levels, like the other modal shots: the editors of every
    // type fit in the window and the published images are crops of the modal
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(800);
    try {
      for (const shot of ACTION_EDITOR_SHOTS) {
        // Reload the panel for each editor, straight on the Deployment Actions
        // tab of the pull request modal (deep link of hardis:work:save):
        // closing all editors resets every modal state, which is more robust
        // than clicking per-type Cancel buttons whose position depends on the
        // editor height
        await shootPanel(panelManager, {
          name: "pipeline-action-editors-base",
          command: "vscode-sfdx-hardis.showPipeline",
          lwcId: "s-pipeline",
          ready: pipelineFullyLoaded,
          settleMs: 8000,
          force: true,
          commandArgs: PIPELINE_ACTIONS_DEEP_LINK,
        });
        await click(EDIT_BUTTON_X, FIRST_ROW_CENTER_Y + rowOf(shot) * ROW_STEP);
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
      checkoutWorkspaceBranch("integration");
    }
  });

  // The Backpromote panel, with the plan of test/fixtures/backpromote/backpromote-plan.json
  // served by the mocked CLI: the plan and its default selection, the same plan once Merge all
  // prepared every differing item (with the notification of the copied prompt), then the result
  // of a run. The side bar, the activity bar and the status bar are hidden: the panel fills the
  // window, so the images need no side crop. Feeds salesforce-devops-backpromote.md and the README
  // of the extension.
  test("backpromote panel", async function () {
    if (!shouldTake("backpromote")) {
      this.skip();
    }
    const lwcId = "s-backpromote";
    const planReady = (data: any) => data.loading === false && !!data.plan;
    // The default org of the documentation workspace is the integration org, which a
    // backpromote refuses: the developer sandbox is chosen the way the picker does
    const openWithSandbox = async (): Promise<any> => {
      panelManager.disposePanel(lwcId);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await sleep(400);
      await vscode.commands.executeCommand(
        "vscode-sfdx-hardis.showBackpromote",
      );
      const opened = await waitFor(
        () => panelManager.getPanel(lwcId),
        20000,
        "backpromote panel to open",
      );
      const setup = await waitFor(
        () => opened.getInitializationData()?.setup,
        30000,
        "the backpromote setup",
      );
      const allowedOrgs = (setup.orgs || []).filter(
        (org: any) => !org.disabledReason,
      );
      const sandbox =
        allowedOrgs.find((org: any) => /\.dev\d*$/.test(org.username)) ||
        allowedOrgs[0];
      if (sandbox && !opened.getInitializationData()?.plan) {
        opened.simulateWebviewMessage({
          type: "changeTargetOrg",
          data: {
            targetOrg: sandbox.username,
            parentBranch: setup.defaultParentBranch || "integration",
          },
        });
      }
      await waitFor(
        () => {
          const current = opened.getInitializationData();
          return current && planReady(current) ? current : null;
        },
        40000,
        "the backpromote plan",
      );
      opened.reveal();
      return opened;
    };
    // The panel asks for a git provider token first: the mocked CLI never calls GitHub
    const tokenBefore = process.env.GITHUB_TOKEN;
    // Without a git provider connection first: the panel sends to the DevOps Pipeline
    if (!tokenBefore) {
      panelManager.disposePanel(lwcId);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand(
        "vscode-sfdx-hardis.showBackpromote",
      );
      const noToken = await waitFor(
        () => panelManager.getPanel(lwcId),
        20000,
        "backpromote panel without token",
      );
      await waitFor(
        () => noToken.getInitializationData()?.tokenMissing === true,
        30000,
        "the git provider token state",
      );
      await sleep(2500);
      await cleanChrome();
      await captureStable("backpromote-token-missing");
      panelManager.disposePanel(lwcId);
    }
    process.env.GITHUB_TOKEN = tokenBefore || "ghp_mock_token";
    const workbench = vscode.workspace.getConfiguration("workbench");
    // Workspace level: the settings of the documentation workspace pin the activity bar
    const activityBarBefore = workbench.inspect(
      "activityBar.location",
    )?.workspaceValue;
    const statusBarBefore =
      workbench.inspect("statusBar.visible")?.workspaceValue;
    try {
      await workbench.update(
        "activityBar.location",
        "hidden",
        vscode.ConfigurationTarget.Workspace,
      );
      await workbench.update(
        "statusBar.visible",
        false,
        vscode.ConfigurationTarget.Workspace,
      );
    } catch (error: any) {
      console.log(
        `      [shot] backpromote: layout settings not written: ${error?.message}`,
      );
    }
    const layout = vscode.workspace.getConfiguration("workbench");
    console.log(
      `      [shot] backpromote layout: activityBar=${layout.get("activityBar.location")} statusBar=${layout.get("statusBar.visible")}`,
    );
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("workbench.action.closePanel");
    await sleep(1200);
    try {
      // The plan while it is computed: the steps done, then the one in progress with its spinner
      process.env.SF_MOCK_BACKPROMOTE_STEP_DELAY_MS = "3000";
      const loading = openWithSandbox();
      await sleep(10000);
      await vscode.commands.executeCommand(
        "workbench.action.closeAuxiliaryBar",
      );
      capture("backpromote-loading");
      await loading;
      delete process.env.SF_MOCK_BACKPROMOTE_STEP_DELAY_MS;
      const panel = await openWithSandbox();
      await sleep(3500);
      await cleanChrome();
      await captureStable("backpromote");
      // Lower in the What block: the package-no-overwrite.xml item, the deletion, the actions
      await click(1100, 650, { scroll: -6 });
      await sleep(800);
      await captureStable("backpromote-what");
      await click(1100, 650, { scroll: 12 });
      await sleep(800);
      const initData = panel.getInitializationData();
      // A slower mocked CLI keeps the preparing modal on screen long enough to capture it
      // (its spinner never stops moving, so the capture is taken once)
      process.env.SF_MOCK_BOOT_DELAY_MS = "10000";
      panel.simulateWebviewMessage({
        type: "mergeAll",
        data: { selection: initData.selection, revision: 900 },
      });
      await sleep(3500);
      capture("backpromote-preparing");
      delete process.env.SF_MOCK_BOOT_DELAY_MS;
      // Not every fixture universe has an item that differs on both sides, and
      // when none does, Merge all has nothing to prepare. That is not a reason
      // to lose the captures that come after it.
      try {
        await waitFor(
          () => {
            const current = panel.getInitializationData();
            return current?.plan?.comparison?.some(
              (entry: any) => entry.prepared,
            )
              ? current
              : null;
          },
          30000,
          "Merge all to prepare the differing items",
        );
        // The notification of the copied prompt is part of this shot: only the
        // auxiliary bar is closed
        await sleep(3000);
        await vscode.commands.executeCommand(
          "workbench.action.closeAuxiliaryBar",
        );
        await captureStable("backpromote-merge-all");
      } catch (error: any) {
        console.log(`      [shot] backpromote-merge-all: ${error?.message}`);
      }

      // A fresh panel for the run: the prepared merges above would block it
      await vscode.commands.executeCommand("notifications.clearAll");
      const runPanel = await openWithSandbox();
      const runData = runPanel.getInitializationData();
      runPanel.simulateWebviewMessage({
        type: "runBackpromote",
        data: { selection: runData.selection, revision: 901, dirtyTree: null },
      });
      await waitFor(
        () => runPanel.getInitializationData()?.runResult,
        40000,
        "the backpromote run to finish",
      );
      runPanel.reveal();
      // The result sits under the Go block, at the bottom of the page
      await captureBottomOfPage("backpromote-result");

      // A run in progress (its modal), then a failed deployment with the components in error
      process.env.SF_MOCK_BACKPROMOTE_CLI = "deployFailed";
      const failPanel = await openWithSandbox();
      process.env.SF_MOCK_BACKPROMOTE_STEP_DELAY_MS = "3000";
      failPanel.simulateWebviewMessage({
        type: "runBackpromote",
        data: {
          selection: failPanel.getInitializationData().selection,
          revision: 902,
          dirtyTree: null,
        },
      });
      await sleep(5000);
      await vscode.commands.executeCommand(
        "workbench.action.closeAuxiliaryBar",
      );
      capture("backpromote-running");
      await waitFor(
        () => failPanel.getInitializationData()?.runError,
        40000,
        "the failed backpromote run",
      );
      delete process.env.SF_MOCK_BACKPROMOTE_STEP_DELAY_MS;
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
      await captureBottomOfPage("backpromote-deploy-failed");

      // Opened again on the backpromote branch: the panel resumes the backpromote left above, with
      // its selection and its deployment errors, and offers to start it again
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const previousBranch = workspaceRoot
        ? execFileSync("git", ["branch", "--show-current"], {
            cwd: workspaceRoot,
            encoding: "utf8",
          }).trim()
        : "";
      if (workspaceRoot) {
        execFileSync(
          "git",
          ["checkout", "-q", "-B", "backpromote/integration/dev1"],
          { cwd: workspaceRoot, stdio: "pipe" },
        );
      }
      try {
        panelManager.disposePanel(lwcId);
        await vscode.commands.executeCommand(
          "workbench.action.closeAllEditors",
        );
        await sleep(400);
        await vscode.commands.executeCommand(
          "vscode-sfdx-hardis.showBackpromote",
        );
        const resumed = await waitFor(
          () => panelManager.getPanel(lwcId),
          20000,
          "backpromote panel to open on the backpromote branch",
        );
        await waitFor(
          () => {
            const current = resumed.getInitializationData();
            return current && planReady(current) ? current : null;
          },
          40000,
          "the resumed backpromote plan",
        );
        resumed.reveal();
        await sleep(3500);
        await cleanChrome();
        await captureStable("backpromote-resumed");
      } finally {
        if (previousBranch) {
          checkoutWorkspaceBranch(previousBranch);
        }
      }
    } finally {
      delete process.env.SF_MOCK_BACKPROMOTE_STEP_DELAY_MS;
      delete process.env.SF_MOCK_BACKPROMOTE_CLI;
      await workbench.update(
        "activityBar.location",
        activityBarBefore,
        vscode.ConfigurationTarget.Workspace,
      );
      await workbench.update(
        "statusBar.visible",
        statusBarBefore,
        vscode.ConfigurationTarget.Workspace,
      );
      await vscode.commands.executeCommand(
        "workbench.view.extension.sfdx-hardis-explorer",
      );
      await sleep(800);
      panelManager.disposePanel(lwcId);
      if (tokenBefore === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = tokenBefore;
      }
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

  // Custom Functions tab of the same panel: the catalog of functions the project
  // declares, then the editor of one of them. The tab only exists on the project
  // scope, since a function id is a deployment action type.
  // Feeds screenshot-custom-functions-tab.jpg and screenshot-custom-function-editor.jpg
  // of salesforce-devops-work-on-user-story-custom-functions.md.
  test("pipeline configuration (custom functions)", async function () {
    if (!shouldTake("pipeline-config-custom-functions")) {
      this.skip();
    }
    // Edit button of the first function card. The two cards sit side by side in
    // the card grid, so this is the left one.
    const FIRST_CARD_EDIT_X = 772;
    const FIRST_CARD_EDIT_Y = 350;
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(800);
    try {
      await shootPanel(panelManager, {
        name: "pipeline-config-custom-functions",
        command: "vscode-sfdx-hardis.showPipelineConfig",
        commandArgs: [null, "Custom Functions"],
        lwcId: "s-pipeline-config",
        settleMs: 3500,
        force: true,
      });
      // The editor of the first function, so the form shows a filled contract
      // (runtime, script, and the inputs and outputs it declares) rather than
      // the empty form the Add button opens
      await click(FIRST_CARD_EDIT_X, FIRST_CARD_EDIT_Y);
      await sleep(1500);
      await captureStable("pipeline-config-custom-function-editor");
    } finally {
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await sleep(800);
    }
  });

  // Deployment tab of the same panel, zoomed out so the whole section fits in
  // one capture. The training needs the Org Authentication Mode row, which sits
  // below the fold at 100%.
  test("pipeline configuration (deployment tab)", async function () {
    if (!shouldTake("pipeline-config-deployment")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(800);
    try {
      await shootPanel(panelManager, {
        name: "pipeline-config-deployment",
        command: "vscode-sfdx-hardis.showPipelineConfig",
        commandArgs: [null, "Deployment"],
        lwcId: "s-pipeline-config",
        settleMs: 3500,
        force: true,
      });
    } finally {
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await sleep(800);
    }
  });

  // Security & Privacy tab of the same panel: the anonymization editor, opened
  // through the section deep link of the command (2nd argument = section label)
  test("pipeline configuration (anonymization)", async function () {
    if (!shouldTake("anonymization-config")) {
      this.skip();
    }
    // Two zoom levels out, so the three levels, the local runs toggle and the
    // four channels all fit in one capture
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(800);
    try {
      await shootPanel(panelManager, {
        name: "anonymization-config",
        command: "vscode-sfdx-hardis.showPipelineConfig",
        commandArgs: [null, "Security & Privacy"],
        lwcId: "s-pipeline-config",
        settleMs: 3500,
        force: true,
      });
      // Same editor in edit mode: the published screenshot must show the
      // controls the user operates, not the read-only summary
      await click(1869, 72); // "Edit" button of the panel header
      await sleep(1800);
      await cleanChrome();
      await captureStable("anonymization-config-edit");
    } finally {
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await vscode.commands.executeCommand("workbench.action.zoomIn");
      await sleep(800);
    }
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

  // The Metadata Retriever doing the job it exists for: "what did I just change
  // in my org, and which of it belongs to my User Story". The training walks a
  // beginner through it before every publish, so it needs the results list and
  // the selection, not just the empty search form.
  test("metadata retriever: recent changes and selection", async function () {
    if (!shouldTake("metadata-retriever-recent-changes")) {
      this.skip();
    }
    await shootPanel(panelManager, {
      name: "metadata-retriever-recent-changes",
      command: "vscode-sfdx-hardis.showMetadataRetriever",
      lwcId: "s-metadata-retriever",
      settleMs: 5000,
      force: true,
      // "Search Metadata": the panel opens on an empty state
      clicks: [{ x: 571, y: 301 }],
    });
    // A universe can sort the list first, the way its readers are told to:
    // "x,y" points separated by ";", clicked in order (a column header twice
    // sorts it descending)
    for (const point of (universeSetting("retrieverSortClicks") || "")
      .split(";")
      .map((part) => part.split(",").map((v) => Number(v.trim())))
      .filter((xy) => xy.length === 2 && xy.every((v) => Number.isFinite(v)))) {
      await click(point[0], point[1]);
      await sleep(900);
    }
    // The rows of US-014, in the order the panel shows them. Where they sit
    // depends on what else the fixture lists, so a universe names its own rows
    const rows = (universeSetting("retrieverRows") || "561,712,763")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((y) => Number.isFinite(y));
    for (const y of rows) {
      await click(496, y);
      await sleep(600);
    }
    await sleep(1200);
    await cleanChrome();
    await captureStable("metadata-retriever-selected");
  });

  // The Source Control view with retrieved metadata waiting in it. Committing
  // is plain VS Code rather than the extension, and it is the step a beginner
  // has never done, so the training shows it like any other click.
  test("source control: retrieved metadata waiting to be committed", async function () {
    if (!shouldTake("source-control-retrieved")) {
      this.skip();
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.skip();
    }
    // What a retrieve of the US-014 components leaves behind. A universe names
    // its own files, comma separated, when its story retrieves something else
    const written = (
      universeSetting("retrievedFiles") ||
      [
        "force-app/main/default/objects/Installation__c/fields/Panels_Required__c.field-meta.xml",
        "force-app/main/default/layouts/Installation__c-Installation Layout.layout-meta.xml",
        "force-app/main/default/permissionsets/Helios_Delivery_Crew.permissionset-meta.xml",
      ].join(",")
    )
      .split(",")
      .map((relative) => relative.trim())
      .filter(Boolean);
    for (const relative of written) {
      const file = path.join(workspaceRoot!, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Metadata xmlns="http://soap.sforce.com/2006/04/metadata"/>',
          "",
        ].join("\n"),
      );
    }
    // The harness writes .vscode/settings.json after the initial commit, so it
    // shows up as a change of its own. Hide it: it is harness plumbing, and a
    // reader counting the files would count one more than the story retrieved.
    const excludeFile = path.join(workspaceRoot!, ".git", "info", "exclude");
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    // The prompt file an earlier backpromote capture leaves is plumbing too
    fs.appendFileSync(excludeFile, ".vscode/\nbackpromote-*\n");
    try {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("workbench.view.scm");
      await sleep(3000);
      await cleanChrome();
      await captureStable("source-control-retrieved");
    } finally {
      for (const relative of written) {
        fs.rmSync(path.join(workspaceRoot!, relative), { force: true });
      }
      await vscode.commands.executeCommand(
        "workbench.view.extension.sfdx-hardis-explorer",
      );
      await sleep(800);
    }
  });

  // A merge of integration into a story branch that conflicts on a permission
  // set, as the training's Lab 2.7 has it: the Source Control menu, the branch
  // picker, the conflicting file under Merge Changes, and the merge editor. The
  // branches are built for the shot in the test workspace, then removed.
  test("git: merge a branch and resolve the conflict", async function () {
    if (!shouldTake("git-merge")) {
      this.skip();
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.skip();
    }
    const git = (args: string) =>
      execSync(`git ${args}`, { cwd: workspaceRoot, stdio: "pipe" })
        .toString()
        .trim();
    const relative =
      "force-app/main/default/permissionsets/Helios_Delivery_Manager.permissionset-meta.xml";
    const file = path.join(workspaceRoot!, relative);
    const permissionSet = (field: string) =>
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">',
        "    <fieldPermissions>",
        "        <editable>true</editable>",
        `        <field>${field}</field>`,
        "        <readable>true</readable>",
        "    </fieldPermissions>",
        "    <hasActivationRequired>false</hasActivationRequired>",
        "    <label>Helios Delivery Manager</label>",
        "</PermissionSet>",
        "",
      ].join("\n");
    const startBranch = git("rev-parse --abbrev-ref HEAD");
    const otherBranches = git(
      "for-each-ref --format=%(refname:short)=%(objectname) refs/heads",
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split("="))
      .filter(([name]) => name !== "features/US-034-crew-override");
    const story = "features/US-034-crew-override";
    // The fixture may already carry the story branch, for the pipeline diagram:
    // it is put back where it was afterwards
    let storyWas: string;
    try {
      storyWas = git(`rev-parse --verify --quiet refs/heads/${story}`);
    } catch {
      storyWas = "";
    }
    const excludeFile = path.join(workspaceRoot!, ".git", "info", "exclude");
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    fs.appendFileSync(excludeFile, ".vscode/\n");
    git("stash push --include-untracked --message screenshot-git-merge");
    // Nothing open behind the pickers: an editor left by an earlier test is noise
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    // The "..." of a view only shows while the mouse is over it: keep it visible
    const workbench = vscode.workspace.getConfiguration("workbench");
    await workbench.update(
      "view.alwaysShowHeaderActions",
      true,
      vscode.ConfigurationTarget.Global,
    );
    try {
      // Detached, so that no helper branch shows in the branch picker
      git("checkout -q --detach");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, permissionSet("Installation__c.Crew_Size__c"));
      git(`add "${relative}"`);
      git('commit -q -m "base"');
      // What Mariia merged into integration
      fs.writeFileSync(
        file,
        permissionSet("Installation__c.Crew_Capacity_Cap__c"),
      );
      git(
        `commit -q -a -m "US-018 Cap the crew size" --author "Mariia Pyvovarchuk <mariia@helios-training.invalid>"`,
      );
      git("update-ref refs/remotes/origin/integration HEAD");
      // Your story, branched before she merged
      git(`checkout -q -B ${story} HEAD~1`);
      fs.writeFileSync(file, permissionSet("Installation__c.Crew_Notes__c"));
      git('commit -q -a -m "US-034 Crew override"');
      await vscode.commands.executeCommand("git.refresh");
      await vscode.commands.executeCommand("workbench.view.scm");
      await sleep(3000);
      await cleanChrome();
      // The Command Palette, filtered on the git commands a reader runs. The
      // "..." menu of the view cannot be taken: activating the window for the
      // capture closes any workbench menu
      void vscode.commands.executeCommand(
        "workbench.action.quickOpen",
        ">Git: Fetch",
      );
      await sleep(2000);
      await captureStable("git-palette-fetch");
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      void vscode.commands.executeCommand(
        "workbench.action.quickOpen",
        ">Git: Merge",
      );
      await sleep(2000);
      await captureStable("git-palette-merge");
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      await sleep(600);
      // Only the story branch stays local while the picker is open, so that
      // origin/integration is in view: the others are put back afterwards
      for (const [name] of otherBranches) {
        git(`branch -D "${name}"`);
      }
      await vscode.commands.executeCommand("git.refresh");
      await sleep(1500);
      // The branch picker of Merge..., not awaited: it waits for a choice
      void vscode.commands.executeCommand("git.merge");
      await sleep(2500);
      await captureStable("git-merge-pick");
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      await sleep(600);
      // The merge itself, as the picker would have run it
      try {
        git("merge origin/integration");
      } catch {
        // A conflict exits with 1: that is the point of the shot
      }
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("git.refresh");
      await sleep(3000);
      await captureStable("git-merge-conflicts");
      await vscode.commands.executeCommand(
        "git.openMergeEditor",
        vscode.Uri.file(file),
      );
      await sleep(4000);
      await captureStable("git-merge-editor");
      // Both sides accepted: the result holds the two lines
      await click(556, 187); // "Accept Incoming" above the conflict of Incoming
      await sleep(1200);
      await click(1297, 187); // "Accept Current" above the conflict of Current
      await sleep(1500);
      await captureStable("git-merge-editor-accepted");
    } finally {
      await vscode.commands.executeCommand(
        "workbench.action.revertAndCloseActiveEditor",
      );
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await workbench.update(
        "view.alwaysShowHeaderActions",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      try {
        git("merge --abort");
      } catch {
        // Nothing to abort when the merge did not start
      }
      for (const [name, sha] of otherBranches) {
        try {
          git(`branch -f "${name}" ${sha}`);
        } catch {
          // Still there: it was never deleted
        }
      }
      git(`checkout -q -f ${startBranch}`);
      git(storyWas ? `branch -f ${story} ${storyWas}` : `branch -D ${story}`);
      git("update-ref -d refs/remotes/origin/integration");
      try {
        git("stash pop");
      } catch {
        // Nothing was stashed
      }
      await vscode.commands.executeCommand("git.refresh");
      await vscode.commands.executeCommand(
        "workbench.view.extension.sfdx-hardis-explorer",
      );
      await sleep(800);
    }
  });

  /* jscpd:ignore-start */
  // Deliberately the same shape as the git-merge test above: both build a tiny
  // history in the workspace, capture one picker, and put it all back.
  // The branch picker of Git: Merge..., on a retrofit branch, where the answer is
  // origin/main and not the local main: Lab 3.7 of the training turns on that
  // click, so it gets its own shot rather than reusing the origin/integration one.
  test("git: pick origin/main on a retrofit branch", async function () {
    if (!shouldTake("git-retrofit")) {
      this.skip();
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.skip();
    }
    const git = (args: string) =>
      execSync(`git ${args}`, { cwd: workspaceRoot, stdio: "pipe" })
        .toString()
        .trim();
    const relative =
      "force-app/main/default/objects/Installation__c/validationRules/Installation_Date_Not_Past.validationRule-meta.xml";
    const file = path.join(workspaceRoot!, relative);
    const rule = (cancelled: boolean) =>
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">',
        "    <fullName>Installation_Date_Not_Past</fullName>",
        "    <active>true</active>",
        "    <errorConditionFormula>AND(",
        "  ISCHANGED(Install_Date__c),",
        "  Install_Date__c &lt; TODAY(),",
        "  NOT(ISPICKVAL(Status__c, &quot;Completed&quot;))" +
          (cancelled ? "," : ""),
        ...(cancelled
          ? ["  NOT(ISPICKVAL(Status__c, &quot;Cancelled&quot;))"]
          : []),
        ")</errorConditionFormula>",
        "    <errorDisplayField>Install_Date__c</errorDisplayField>",
        "    <errorMessage>The install date cannot be moved into the past.</errorMessage>",
        "</ValidationRule>",
        "",
      ].join("\n");
    const startBranch = git("rev-parse --abbrev-ref HEAD");
    const retrofit = "retrofit/US-045-retrofit";
    const otherBranches = git(
      "for-each-ref --format=%(refname:short)=%(objectname) refs/heads",
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split("="))
      .filter(([name]) => name !== retrofit);
    const excludeFile = path.join(workspaceRoot!, ".git", "info", "exclude");
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    fs.appendFileSync(excludeFile, ".vscode/\n");
    git("stash push --include-untracked --message screenshot-git-retrofit");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const workbench = vscode.workspace.getConfiguration("workbench");
    await workbench.update(
      "view.alwaysShowHeaderActions",
      true,
      vscode.ConfigurationTarget.Global,
    );
    try {
      git("checkout -q --detach");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, rule(false));
      git(`add "${relative}"`);
      git('commit -q -m "base"');
      // What the hotfix put into production
      fs.writeFileSync(file, rule(true));
      git(
        'commit -q -a -m "US-045 Hotfix: cancelled installations can be back-dated again" --author "Romain Deloux <romain@helios-training.invalid>"',
      );
      git("update-ref refs/remotes/origin/main HEAD");
      // The retrofit branch, cut from integration before the hotfix
      git(`checkout -q -B ${retrofit} HEAD~1`);
      await vscode.commands.executeCommand("git.refresh");
      await vscode.commands.executeCommand("workbench.view.scm");
      await sleep(3000);
      await cleanChrome();
      // Only the retrofit branch stays local while the picker is open, so that
      // origin/main is what the list shows: the others are put back afterwards
      for (const [name] of otherBranches) {
        git(`branch -D "${name}"`);
      }
      await vscode.commands.executeCommand("git.refresh");
      await sleep(1500);
      void vscode.commands.executeCommand("git.merge");
      await sleep(2500);
      await captureStable("git-retrofit-pick");
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      await sleep(600);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await workbench.update(
        "view.alwaysShowHeaderActions",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      for (const [name, sha] of otherBranches) {
        try {
          git(`branch -f "${name}" ${sha}`);
        } catch {
          // Still there: it was never deleted
        }
      }
      git(`checkout -q -f ${startBranch}`);
      try {
        git(`branch -D ${retrofit}`);
      } catch {
        // Already gone
      }
      git("update-ref -d refs/remotes/origin/main");
      try {
        git("stash pop");
      } catch {
        // Nothing was stashed
      }
      await vscode.commands.executeCommand("git.refresh");
      await vscode.commands.executeCommand(
        "workbench.view.extension.sfdx-hardis-explorer",
      );
      await sleep(800);
    }
  });
  /* jscpd:ignore-end */

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

  // CI authentication of a major branch (DevOps Pipeline gear menu >
  // Add/Configure Org), from the mocked sf hardis:project:configure:auth: the
  // branch question, the stop where it prints the two secrets and waits for
  // them to be stored, and the finished run.
  test("command runner (configure auth)", async function () {
    if (!shouldTake("configure-auth")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const asked = trackAskedPrompts();
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:project:configure:auth",
    );
    const panel = panelManager.getPanel(panelId);
    const answer = async (name: string, value: any) => {
      await waitFor(() => asked(name), 30000, `${name} prompt`);
      await sleep(900);
      panel.simulateWebviewMessage({ type: "submit", data: { [name]: value } });
    };
    await answer("org", "configuredOrg");
    await waitFor(() => asked("branchName"), 30000, "branch prompt");
    await sleep(1500);
    await cleanChrome();
    capture("configure-auth-branch");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { branchName: "integration" },
    });
    await answer("instanceUrl", "https://test.salesforce.com");
    await answer("mergeTargets", ["uat"]);
    await answer("username", "ci");
    await answer("certSource", "selfSigned");
    await answer("createApp", true);
    await answer("certStorage", "file");

    await waitFor(() => asked("variablesSet"), 30000, "variables prompt");
    await sleep(1800);
    await cleanChrome();
    capture("configure-auth-variables");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { variablesSet: true },
    });
    await answer("appName", "sfdxhardisintegration");
    await answer("contactEmail", "ci");
    await answer("profile", "System Administrator");

    await waitFor(
      () => panelManager.getPanel(panelId)?.commandStatus === "completed",
      60000,
      "configure auth to complete",
    );
    await sleep(1500);
    await cleanChrome();
    capture("configure-auth-completed");
  });

  // The two commands a contributor runs every day, captured at the question
  // they ask. The training walks a beginner through both click by click, so
  // each prompt needs a picture of the panel that asks it. The scenarios come
  // from the mocked CLI (DOCS_SCENARIOS in test/fixtures/sf-shim/sf-mock.js)
  // and name the story of the current fixture universe.
  test("command runner (new user story)", async function () {
    if (!shouldTake("work-new")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const asked = trackAskedPrompts();
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:work:new",
    );
    const panel = panelManager.getPanel(panelId);

    // 1. Which branch this story will be merged into. A project that allows a
    //    single target branch is not asked: the command names it and goes on
    await waitFor(
      () => asked("targetBranch") || asked("storyType"),
      30000,
      "target branch or story type prompt",
    );
    if (asked("targetBranch")) {
      await sleep(1500);
      await cleanChrome();
      capture("work-new-target-branch");
      panel.simulateWebviewMessage({
        type: "submit",
        data: { targetBranch: "integration" },
      });
    }

    // 2. Feature or fix, which decides the branch prefix
    await waitFor(() => asked("storyType"), 30000, "story type prompt");
    await sleep(1500);
    await cleanChrome();
    capture("work-new-story-type");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { storyType: "feature" },
    });

    // 2. The name, which becomes the branch name
    await waitFor(() => asked("storyName"), 30000, "story name prompt");
    await sleep(1500);
    await cleanChrome();
    capture("work-new-story-name");
    panel.simulateWebviewMessage({
      type: "submit",
      // The name has to be one the project's branch pattern accepts, because
      // the completed screen shows it next to the branch it produced
      data: { storyName: "US-014-panels-required" },
    });

    // 4. Which kind of org the work happens in
    await waitFor(() => asked("orgType"), 30000, "org type prompt");
    await sleep(1500);
    await cleanChrome();
    capture("work-new-org-type");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { orgType: "sandbox" },
    });

    // 3. The org the work happens in: a sandbox in the product universe, one of
    //    the scratch orgs in the training one, which asks nothing more after it
    await waitFor(
      () => asked("sandboxOrg") || asked("scratchOrg"),
      30000,
      "org prompt",
    );
    await sleep(1500);
    await cleanChrome();
    capture("work-new-org");
    if (asked("scratchOrg")) {
      panel.simulateWebviewMessage({
        type: "submit",
        data: { scratchOrg: "helios-dev" },
      });
    } else {
      panel.simulateWebviewMessage({
        type: "submit",
        data: { sandboxOrg: "helios-dev" },
      });

      await waitFor(() => asked("openOrg"), 30000, "open org prompt");
      await sleep(1000);
      panel.simulateWebviewMessage({ type: "submit", data: { openOrg: "no" } });
    }

    await waitFor(
      () => panelManager.getPanel(panelId)?.commandStatus === "completed",
      60000,
      "new user story to complete",
    );
    await sleep(1500);
    await cleanChrome();
    capture("work-new-completed");
  });

  test("command runner (save and publish)", async function () {
    if (!shouldTake("work-save")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const asked = trackAskedPrompts();
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:work:save",
    );
    const panel = panelManager.getPanel(panelId);

    // 1. The question that trips up every beginner: commit first
    await waitFor(() => asked("commitReady"), 30000, "commit ready prompt");
    await sleep(1500);
    await cleanChrome();
    capture("work-save-commit-ready");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { commitReady: "commitReady" },
    });

    // 2. After the delta package.xml and the cleanings, the push question,
    //    with the generated manifest in the report bar
    await waitFor(() => asked("pushCommits"), 60000, "push prompt");
    await sleep(1800);
    await cleanChrome();
    capture("work-save-package-xml");
    panel.simulateWebviewMessage({
      type: "submit",
      data: { pushCommits: "yes" },
    });

    await waitFor(
      () => panelManager.getPanel(panelId)?.commandStatus === "completed",
      60000,
      "save to complete",
    );
    await sleep(1500);
    await cleanChrome();
    capture("work-save-completed");
  });

  // The contribution cards of the DevOps Pipeline: New User Story, Save /
  // Publish, Commit changes, Backpromote. They sit under the diagram, so a
  // fixture with several feature branches pushes them below the fold and the
  // panel capture shows only the diagram. This one scrolls to them first.
  test("pipeline contribution cards", async function () {
    if (!shouldTake("pipeline-cards")) {
      this.skip();
    }
    checkoutWorkspaceBranch(FEATURE_BRANCH);
    await shootPanel(panelManager, {
      name: "pipeline-cards-before",
      command: "vscode-sfdx-hardis.showPipeline",
      lwcId: "s-pipeline",
      ready: pipelineFullyLoaded,
      settleMs: 9000,
      force: true,
    });
    // The cards sit under the diagram, and neither zooming the window nor a
    // wheel event brings them up: the window zoom scales the diagram with the
    // page, and a posted wheel never reaches the webview's scroller. Hiding the
    // feature branches is what actually shrinks the diagram, and it is a real
    // control a reader can find, right in the header.
    await click(1655, 111); // "Show feature branches" toggle
    await sleep(2500);
    // Two levels out on top of that, so the whole row of cards fits rather than
    // being cut off at the bottom edge
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await vscode.commands.executeCommand("workbench.action.zoomOut");
    await sleep(1500);
    // The pipeline panel fills the editor area here, so the usual parking spot
    // is the diagram: a click there can open a branch window over the cards.
    // The header strip of the panel activates nothing.
    await parkPointer(1200, 60);
    await cleanChrome();
    await captureStable("pipeline-cards");
    await vscode.commands.executeCommand("workbench.action.zoomIn");
    await vscode.commands.executeCommand("workbench.action.zoomIn");
    await sleep(1200);
    await click(1655, 111); // put the toggle back for the captures that follow
    await sleep(1500);
  });

  // Pipeline settings scoped to a major branch: the screen where a contributor
  // declares which org the branch deploys to (targetUsername, instanceUrl).
  // The command takes the branch as its first argument, so no click is needed.
  test("pipeline configuration (branch)", async function () {
    await shootPanel(panelManager, {
      name: "pipeline-config-branch",
      command: "vscode-sfdx-hardis.showPipelineConfig",
      lwcId: "s-pipeline-config",
      settleMs: 3500,
      commandArgs: "integration",
    });
  });

  // The same panel with its fields unlocked. Lab 1 of the training has the
  // reader type the org username and the instance URL, and the read-only card
  // shows the values without showing where they are typed.
  test("pipeline configuration (branch, editing)", async function () {
    if (!shouldTake("pipeline-config-branch-edit")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand(
      "vscode-sfdx-hardis.showPipelineConfig",
      "integration",
    );
    await sleep(4500);
    // Edit, at the top right of the panel next to the scope selector.
    // Coordinates are relative to the captured PNG, which already drops the
    // title bar, so this is the button's position in the image.
    // capture() is what maximizes the window, and click() coordinates are
    // relative to the captured image: clicking before the first capture of a
    // filtered run aims at a window that is still its default size.
    capture("pipeline-config-branch-edit");
    await sleep(600);
    await click(1848, 104);
    await sleep(3000);
    await cleanChrome();
    await captureStable("pipeline-config-branch-edit");
  });

  // The User Stories tab, unlocked and scrolled to the two lists a contributor
  // picks a target branch from. Lab 3.1 of the training adds a line to each of
  // them, and the pairing is by position, which only a picture makes obvious.
  test("pipeline configuration (User Stories, editing)", async function () {
    if (!shouldTake("pipeline-config-user-stories")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand(
      "vscode-sfdx-hardis.showPipelineConfig",
      null,
      "User Stories",
    );
    await sleep(4500);
    capture("pipeline-config-user-stories");
    await sleep(600);
    // Edit, same place as on the branch panel above
    await click(1848, 104);
    await sleep(3000);
    await cleanChrome();
    // The two target branch fields sit below the fold once the tab is unlocked
    await captureStable("pipeline-config-user-stories-top");
    await click(1100, 500, { scroll: -6 });
    await sleep(1200);
    await captureStable("pipeline-config-user-stories-mid");
    await click(1100, 500, { scroll: -6 });
    await sleep(1200);
    await captureStable("pipeline-config-user-stories");
  });

  // Connecting an org, stopped on the question that names it. The training's
  // first lab connects two orgs and has to show that the suggested name, taken
  // from the org address, is not the one to keep.
  test("command runner (name the org you connect)", async function () {
    if (!shouldTake("org-select-alias")) {
      this.skip();
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(400);
    const asked = trackAskedPrompts();
    const panelId = await runCommandAndWaitForPanel(
      panelManager,
      "sf hardis:org:select",
    );
    const panel = panelManager.getPanel(panelId);

    await waitFor(() => asked("orgSelect"), 30000, "org list prompt");
    await sleep(1000);
    panel.simulateWebviewMessage({
      type: "submit",
      data: { orgSelect: "connectOrg" },
    });

    await waitFor(() => asked("alias"), 30000, "alias prompt");
    await sleep(1500);
    await cleanChrome();
    await captureStable("org-select-alias");
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
    // 10 fps: the running edges of the diagram move their dashes 45px/s over
    // a 14px dash period; sampled at 5 fps the dashes would appear to flow
    // backward in the GIF
    await record(
      "devops-pipeline",
      16,
      async () => {
        await sleep(2000);
        await click(910, 733); // "Open Pull Requests" tab
        await sleep(3000);
        await click(618, 733); // "Project Contribution Workflow" tab
        await sleep(2500);
        for (let i = 0; i < 3; i++) {
          await click(1170, 600, { scroll: -2 });
        }
        await sleep(1500);
      },
      10,
    );
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
    await parkPointer();
    await cleanChrome();
    capture("sidebar-commands-collapsed");

    // Expand, capture and collapse again each section holding a documented menu
    // entry. The section is found by its id and expanded through the tree view,
    // not by clicking a row at a fixed height: a project that declares its own
    // menus adds rows above these, and clicking a hardcoded y then expanded
    // nothing and produced seven identical captures.
    const sections: Array<{ name: string; id: string }> = [
      // The custom menus a project declares in customCommands. Absent from the
      // product fixture; the training one declares one per level, and they are
      // the entry point of every lab of the course.
      { name: "custom-menu", id: "training-level-1" },
      { name: "custom-menu-2", id: "training-level-2" },
      { name: "custom-menu-3", id: "training-level-3" },
      { name: "advanced", id: "cicd-advanced" },
      { name: "misc", id: "cicd-misc" },
      { name: "org-operations", id: "org-operations" },
      { name: "setup", id: "setup-config" },
      { name: "packaging", id: "packaging" },
    ];
    const topics = await commandsProvider.getChildren();
    for (const section of sections) {
      const node = topics.find((topic: any) => topic.id === section.id);
      if (!node) {
        console.log(
          `      [shot] sidebar section ${section.id} not in the tree`,
        );
        continue;
      }
      await commandsTreeView.reveal(node, { expand: true, select: false });
      await sleep(900);
      await parkPointer();
      await cleanChrome();
      capture(`sidebar-commands-${section.name}`);
      // Collapsing is not exposed, so the tree is rebuilt instead: refreshing
      // the provider returns every section to its declared collapsed state.
      await vscode.commands.executeCommand(
        "vscode-sfdx-hardis.refreshCommandsView",
      );
      await sleep(900);
    }
    // Restore the default side bar layout for the next screenshots
    await click(130, 362); // STATUS: expand
    await click(130, 664); // DEPENDENCIES: expand
  });
});
