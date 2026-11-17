import * as assert from "assert";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  CdpWindow,
  inWebview,
  webviewBoxInWindow,
} from "./cdpWindow";
import { MaskRule, maskWindow } from "./domMask";
import { LabAnswer, ShownPrompt, runLabStep } from "./labDriver";
import { activateExtension } from "./uiTestUtils";

/**
 * Command screenshots of sfdx-hardis: every command of the documentation, run from VS Code.
 *
 * Started by scripts/command-screenshots/run.mjs of sfdx-hardis, which prepares the orgs, the
 * project opened as the workspace and the list of commands, then reads what this suite writes.
 * Each command runs through the real command runner panel, with the real CLI behind the sf shim
 * (or a transcript replayed by it), and its questions are answered from the rules of its spec,
 * like the lab driver answers the labs. Before each capture, the real usernames, org ids, hosts
 * and paths are rewritten (domMask.ts), and a capture where one is still visible is not saved.
 *
 *   SFDX_HARDIS_COMMAND_SHOTS=true
 *   SFDX_HARDIS_LAB_WORKSPACE         the project opened as the workspace
 *   SFDX_HARDIS_COMMAND_SHOTS_SPECS   JSON file: { specs: CommandShotSpec[], mask: MaskRule[] }
 *   SFDX_HARDIS_COMMAND_SHOTS_OUT     folder of the captures: <out>/<slug>/<slug>[-n].png and
 *                                     <out>/<slug>/result.json
 *
 *   yarn dev && yarn compile && node ./out/test/runUiTest.js
 */

const ENABLED = process.env.SFDX_HARDIS_COMMAND_SHOTS === "true";
const OUT_DIR = process.env.SFDX_HARDIS_COMMAND_SHOTS_OUT || "";
// Height of the title bar of the window, cut out of every capture (same as the doc screenshots)
const TITLE_BAR_HEIGHT = 38;

/** A pill to draw on a capture, on the element showing `text`. */
interface PillSpec {
  text: string;
  legend: string;
}

/** One command, as the sfdx-hardis runner resolved its spec. */
interface CommandShotSpec {
  command: string;
  /** File-safe name of the command, e.g. org-diagnose-unusedusers */
  slug: string;
  /** The command line the panel runs */
  run: string;
  /** Alias of the org set as the default org of the workspace before the run */
  targetOrg?: string;
  answers?: LabAnswer[];
  /** Caption and pills of the capture of the finished run */
  caption?: string;
  pills?: PillSpec[];
  timeoutMs?: number;
  /** Statuses the run may end on (default: completed) */
  allowedStatuses?: string[];
  /** false: no default pill on the button of the main report */
  reportPill?: boolean;
  /**
   * Discovery of a new spec: a question no rule covers gets its initial value, or its first
   * choice, and is written to result.json ("discovered") for the runner to turn into rules
   */
  discover?: boolean;
}

interface ShotsFile {
  specs: CommandShotSpec[];
  mask: MaskRule[];
}

/** A pill placed on a capture, in percent of the image, as annotations.json stores them. */
interface PlacedPill {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
  legend: string;
}

interface ShotResult {
  file: string;
  caption: string;
  pills: PlacedPill[];
  /** Pills whose text was not found in the panel */
  missingPills: string[];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The answer discovery gives a question: what the panel pre-fills, else its first choice. */
function discoveryRule(prompt: ShownPrompt): LabAnswer {
  // The CLI starts every question with a llama: the rule matches the text after it
  const text = prompt.message.replace(/^\u{1F999}\s*/u, "").trim();
  const q = escapeRegex(text.slice(0, 60));
  const hasInitial =
    prompt.initial !== undefined &&
    prompt.initial !== null &&
    prompt.initial !== "";
  if (prompt.choices.length > 0) {
    // The initial of a choice list is a value, or the index of a choice (a yes/no question is
    // a list whose initial is 0 for Yes): the rule names the choices it points to by their title
    const initials = hasInitial
      ? Array.isArray(prompt.initial)
        ? prompt.initial
        : [prompt.initial]
      : [];
    const titles = initials
      .map((initial) => {
        const byValue = prompt.choices.find(
          (choice) => choice.value === initial,
        );
        if (byValue) {
          return byValue.title;
        }
        return typeof initial === "number" && prompt.choices[initial]
          ? prompt.choices[initial].title
          : null;
      })
      .filter((title): title is string => Boolean(title));
    const chosen = titles.length > 0 ? titles : [prompt.choices[0].title];
    return {
      q,
      choice: chosen.map((title) => "^" + escapeRegex(title) + "$").join("|"),
    };
  }
  if (hasInitial) {
    return { q, value: "__INITIAL__" };
  }
  if (prompt.type === "confirm") {
    return { q, value: true };
  }
  if (prompt.type === "number") {
    return { q, value: 1 };
  }
  return { q, value: "helios" };
}

function readShotsFile(): ShotsFile {
  const file = process.env.SFDX_HARDIS_COMMAND_SHOTS_SPECS || "";
  assert.ok(
    file && fs.existsSync(file),
    `SFDX_HARDIS_COMMAND_SHOTS_SPECS must name the specs file (got "${file}")`,
  );
  return JSON.parse(fs.readFileSync(file, "utf8")) as ShotsFile;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

let driver: CdpWindow | null = null;
function windowDriver(): CdpWindow {
  if (!driver) {
    const port = CdpWindow.portFromEnv();
    assert.ok(port, "the window was not started with a debugging port");
    driver = new CdpWindow(port);
  }
  return driver;
}

async function cleanChrome(): Promise<void> {
  await vscode.commands.executeCommand("notifications.clearAll");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await sleep(600);
}

// Scrolls every scrollable box of the panel to its end: the end of a run is where its result is
async function scrollPanelToEnd(): Promise<void> {
  await inWebview(`
    let count = 0;
    for (const element of deepAll(panelDocument, "*")) {
      const style = getComputedStyle(element);
      if (
        element.scrollHeight > element.clientHeight + 10 &&
        ["auto", "scroll"].includes(style.overflowY)
      ) {
        element.scrollTop = element.scrollHeight;
        count++;
      }
    }
    panelDocument.scrollingElement && (panelDocument.scrollingElement.scrollTop = panelDocument.scrollingElement.scrollHeight);
    return count;
  `);
}

/**
 * Where the element showing `text` is, in percent of a capture: the smallest visible element of
 * the panel whose text holds it, padded a little.
 */
async function locatePill(
  text: string,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const box = await webviewBoxInWindow();
  if (!box) {
    return null;
  }
  const rect = await inWebview(`
    const wanted = ${JSON.stringify(text.toLowerCase())};
    const frame = document.querySelector("iframe");
    const offset = frame && frame.contentDocument ? frame.getBoundingClientRect() : { left: 0, top: 0 };
    const view = panelDocument.defaultView || window;
    let best = null;
    for (const element of deepAll(panelDocument, "*")) {
      const own = (element.textContent || "") + " " + (element.getAttribute("title") || "") + " " + (element.getAttribute("aria-label") || "");
      if (!own.toLowerCase().includes(wanted)) {
        continue;
      }
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.top > view.innerHeight) {
        continue;
      }
      const area = r.width * r.height;
      if (!best || area < best.area) {
        best = { area, x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    return best ? { x: best.x + offset.left, y: best.y + offset.top, w: best.w, h: best.h } : null;
  `);
  if (!rect) {
    return null;
  }
  const pad = 4;
  const scale = CAPTURE_WIDTH / box.windowWidth;
  const imageHeight = CAPTURE_HEIGHT - TITLE_BAR_HEIGHT;
  const toX = (css: number) => ((css * scale) / CAPTURE_WIDTH) * 100;
  const toY = (css: number) =>
    ((css * scale - TITLE_BAR_HEIGHT) / imageHeight) * 100;
  const round = (value: number) => Math.round(value * 10) / 10;
  const left = box.x + rect.x - pad;
  const top = box.y + rect.y - pad;
  return {
    x: round(Math.max(0, toX(left))),
    y: round(Math.max(0, toY(top))),
    w: round(toX(rect.w + 2 * pad)),
    h: round(toY(rect.h + 2 * pad) - toY(0)),
  };
}

/** Masks, then captures the window as <out>/<slug>/<name>.png, and places its pills. */
async function shoot(
  spec: CommandShotSpec,
  rules: MaskRule[],
  name: string,
  caption: string,
  pills: PillSpec[],
): Promise<ShotResult> {
  await cleanChrome();
  const leaks = await maskWindow(rules);
  assert.strictEqual(
    leaks.length,
    0,
    `${spec.command}: a real value is still visible, the capture "${name}" is not saved: ` +
      leaks.map((leak) => `${leak.find} in "${leak.sample}"`).join(" | "),
  );
  const placed: PlacedPill[] = [];
  const missing: string[] = [];
  for (const pill of pills) {
    const where = await locatePill(pill.text);
    if (where) {
      placed.push({ n: placed.length + 1, ...where, legend: pill.legend });
    } else {
      missing.push(pill.text);
    }
  }
  const file = path.join(OUT_DIR, spec.slug, `${name}.png`);
  // Masking again right before the capture: a panel that re-rendered in between shows the
  // real values again
  await maskWindow(rules);
  await windowDriver().capture(file, { top: TITLE_BAR_HEIGHT });
  console.log(`      [shot] ${file}`);
  return { file, caption, pills: placed, missingPills: missing };
}

function writeResult(spec: CommandShotSpec, result: Record<string, any>): void {
  const dir = path.join(OUT_DIR, spec.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "result.json"),
    JSON.stringify({ command: spec.command, ...result }, null, 2),
  );
}

suite("Command screenshots", function () {
  const shotsFile = ENABLED ? readShotsFile() : { specs: [], mask: [] };
  let panelManager: any;

  suiteSetup(async function () {
    if (!ENABLED) {
      this.skip();
    }
    this.timeout(180000);
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
    assert.ok(panelManager, "the test API must expose the panel manager");
    await cleanChrome();
  });

  for (const spec of shotsFile.specs) {
    test(spec.command, async function () {
      this.timeout((spec.timeoutMs || 900000) + 180000);
      const workspace = process.env.SFDX_HARDIS_LAB_WORKSPACE || "";
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      if (spec.targetOrg) {
        // Asynchronous: a synchronous call would block the extension host for the seconds the CLI
        // takes to start
        await promisify(exec)(`sf config set target-org=${spec.targetOrg}`, {
          cwd: workspace,
        });
      }
      const shots: ShotResult[] = [];
      const reports: { file: string; title: string; type: string }[] = [];
      let promptIndex = 0;
      let asked: ShownPrompt[] = [];
      const discovered: Record<string, unknown>[] = [];
      try {
        asked = await runLabStep(
          panelManager,
          {
            label: spec.command,
            command: spec.run,
            answers: spec.answers || [],
            timeoutMs: spec.timeoutMs || 900000,
          },
          {
            authorize: false,
            allowedStatuses: spec.allowedStatuses,
            defaultRule: spec.discover
              ? (prompt) => {
                  const rule = discoveryRule(prompt);
                  discovered.push({
                    ...rule,
                    message: prompt.message,
                    type: prompt.type,
                    choices: prompt.choices
                      .slice(0, 20)
                      .map((choice) => choice.title),
                  });
                  return rule;
                }
              : undefined,
            onMessage: (message) => {
              if (message?.type === "reportFile" && message.data?.file) {
                reports.push({
                  file: String(message.data.file),
                  title: String(message.data.title || ""),
                  type: String(message.data.type || ""),
                });
              }
            },
            beforeAnswer: async (prompt, rule) => {
              if (!rule.shot) {
                return;
              }
              promptIndex++;
              await sleep(2000);
              shots.push(
                await shoot(
                  spec,
                  shotsFile.mask,
                  `${spec.slug}-${promptIndex}`,
                  rule.caption || prompt.message,
                  rule.pills || [],
                ),
              );
            },
          },
        );
        await sleep(3000);
        await scrollPanelToEnd();
        await sleep(1500);
        // A run that wrote reports gets a pill on the button of its main report, unless the spec
        // places its own: the button shows the title of the report, without "(XLSX)"
        const pills = [...(spec.pills || [])];
        const mainReport = reports.find((report) => report.type === "report");
        if (spec.reportPill !== false && mainReport && pills.length === 0) {
          pills.push({
            text: mainReport.title.replace(/\s*\((XLSX|CSV)\)\s*$/i, ""),
            legend:
              "The report of the run: the button opens it in Excel, the arrow lists its other files",
          });
        }
        shots.push(
          await shoot(
            spec,
            shotsFile.mask,
            spec.slug,
            spec.caption || "",
            pills,
          ),
        );
        writeResult(spec, {
          status: "success",
          shots,
          reports,
          asked,
          discovered,
        });
      } catch (error: any) {
        writeResult(spec, {
          status: "error",
          error: error?.message || String(error),
          shots,
          reports,
          asked,
          discovered,
        });
        throw error;
      }
    });
  }
});
