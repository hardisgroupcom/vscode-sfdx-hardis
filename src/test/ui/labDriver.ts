import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runCommandAndWaitForPanel, waitFor } from "./uiTestUtils";
import { stripAnsiCodes } from "../../utils/ansiColors";

/**
 * The engine behind the lab driver run (yarn test:ui:labs).
 *
 * It walks a lab of the sfdx-hardis training course the way a learner does:
 * through the real panels of a real Extension Development Host, against the
 * REAL Salesforce CLI and the learner's REAL clone and orgs. No mocked CLI, no
 * fixture project.
 *
 * Run it in the foreground, in a terminal of its own: the VS Code instance it
 * launches is a child of the run, so a background job that gets torn down takes
 * that window with it, and a teardown that kills the process tree can reach the
 * editor you are working in.
 *
 * Two things still differ from a learner's machine, and a run reports them:
 * the host starts with --disable-extensions, so the Salesforce Extension Pack
 * is not loaded, and the workspace settings come from the throwaway user data
 * directory rather than from the learner's own VS Code.
 *
 * What it adds over the other UI suites is the missing half of the coverage.
 * The other suites click real webviews against the mock, so they prove what the
 * panel renders and the command line it builds. The training repository's own
 * headless harness runs the real command but no webview at all. A defect that
 * lives only in the webview, over a correct command, passes both of them. This
 * closes that: real webview, real command.
 *
 * An answer rule is the same shape the headless harness uses, so one lab's
 * answers are written once and can be replayed at either fidelity:
 *
 *   { "q": "regex on the question", "choice": "regex on a choice title" }
 *   { "q": "...", "value": "typed text or exact value" }
 *   { "q": "...", "value": "__INITIAL__" }   accepts what the panel pre-fills
 *   { "q": "...", "choice": "...", "optional": true }   may not be asked
 *
 * Each rule fires once, in order of appearance. A question no rule matches
 * FAILS the lab, and that is the point: a learner reading the lab would be
 * stuck on exactly that question, so the run must stop there and name it.
 */

/** One answer rule of a lab step. */
export interface LabAnswer {
  q: string;
  choice?: string;
  value?: unknown;
  optional?: boolean;
}

/** One command a lab runs, with the answers its prompts get. */
export interface LabStep {
  /** Human label, used in the test name and the failure messages */
  label: string;
  /** The command the lab's button runs, e.g. "sf hardis:work:new" */
  command: string;
  answers?: LabAnswer[];
  /** Panels the step must have opened by the time it completes */
  expectPanels?: string[];
  /** Milliseconds the whole step may take (default 600000) */
  timeoutMs?: number;
}

/** One lab of the course, as declared by the spec file. */
export interface LabSpec {
  id: string;
  title: string;
  /** Panels the lab opens without running a command, e.g. "s-pipeline" */
  openPanels?: string[];
  steps?: LabStep[];
  /** Why this lab is not driven here (browser step, install step...) */
  skip?: string;
}

export interface LabSpecFile {
  labs: LabSpec[];
}

const strip = (text: unknown): string => stripAnsiCodes(String(text ?? ""));

/**
 * Where the lab specs live: the training repository owns them, because a lab's
 * answers and its text have to move together. SFDX_HARDIS_LAB_SPECS overrides
 * the path; otherwise the fixed sibling layout is used, the same one the
 * training skills assume.
 */
export function labSpecFile(): string {
  if (process.env.SFDX_HARDIS_LAB_SPECS) {
    return process.env.SFDX_HARDIS_LAB_SPECS;
  }
  const extensionRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(
    extensionRoot,
    "..",
    "sfdx-hardis-training",
    "labs",
    "_assets",
    "lab-drivers.json",
  );
}

/** Reads the lab specs, or returns null when the training repository is absent. */
export function readLabSpecs(): LabSpecFile | null {
  const file = labSpecFile();
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as LabSpecFile;
}

/** A question the panel showed, as the webview received it. */
interface ShownPrompt {
  name: string;
  message: string;
  type: string;
  choices: { title: string; value: unknown }[];
  initial?: unknown;
}

/**
 * Reads a showPrompt message the extension posted to the webview into the
 * shape the rules are matched against. The payload has moved before, so every
 * field is read defensively and a shape that carries no question at all is
 * ignored rather than guessed at.
 */
function readPrompt(message: any): ShownPrompt | null {
  const prompt = message?.data?.prompt ?? message?.data ?? message?.prompt;
  if (!prompt) {
    return null;
  }
  const text = strip(prompt.message ?? prompt.title ?? prompt.description);
  if (!text) {
    return null;
  }
  return {
    name: prompt.name || "value",
    message: text,
    type: String(prompt.type || "select"),
    choices: (prompt.choices || []).map((choice: any) => ({
      title: strip(choice.title ?? choice.name ?? choice.label),
      value: choice.value,
    })),
    initial: prompt.initial,
  };
}

/** Resolves the rule's answer against the choices the panel really rendered. */
function answerFor(prompt: ShownPrompt, rule: LabAnswer): unknown {
  if (rule.choice === undefined) {
    return rule.value === "__INITIAL__" ? prompt.initial : rule.value;
  }
  const pattern = new RegExp(rule.choice, "i");
  const matches = prompt.choices.filter((choice) =>
    pattern.test(choice.title),
  );
  if (prompt.type === "multiselect") {
    assert.ok(
      matches.length > 0,
      `No choice matching /${rule.choice}/ in "${prompt.message}". ` +
        `The panel offered: ${prompt.choices.map((c) => c.title).join(" | ")}`,
    );
    return matches.map((choice) => choice.value);
  }
  assert.ok(
    matches.length > 0,
    `No choice matching /${rule.choice}/ in "${prompt.message}". ` +
      `The panel offered: ${prompt.choices.map((c) => c.title).join(" | ")}`,
  );
  return matches[0].value;
}

/**
 * Runs one step of a lab: launches the command the lab's button launches, then
 * answers every question the panel shows, from the rules, until the command
 * completes.
 *
 * Returns the questions that were asked, in order, so a lab can assert that the
 * flow it describes is the flow the learner gets.
 */
export async function runLabStep(
  panelManager: any,
  step: LabStep,
): Promise<ShownPrompt[]> {
  const rules: (LabAnswer & { used?: boolean })[] = (step.answers || []).map(
    (rule) => ({ ...rule }),
  );
  const timeoutMs = step.timeoutMs ?? 600000;
  const asked: ShownPrompt[] = [];

  const panelId = await runCommandAndWaitForPanel(
    panelManager,
    step.command,
    120000,
  );
  const panel = panelManager.getPanel(panelId);
  assert.ok(panel, `${step.label}: the command panel must exist`);

  // Every question the panel receives is answered as it arrives. The webview
  // DOM is not reachable from the extension host, so this is the closest to a
  // click there is: the same message in, the same message out.
  const originalSendMessage = panel.sendMessage.bind(panel);
  let failure: string | null = null;
  const answered = new Set<string>();
  panel.sendMessage = (message: any) => {
    const result = originalSendMessage(message);
    if (message?.type !== "showPrompt" || failure) {
      return result;
    }
    // Anything thrown here would land in the extension host, as an unhandled
    // rejection of the WebSocket message handler, and the step would hang until
    // its timeout with the real reason lost. Every failure becomes `failure`.
    try {
      const prompt = readPrompt(message);
      if (!prompt) {
        return result;
      }
      const key = `${prompt.name}::${prompt.message}`;
      const rule = rules.find(
        (candidate) =>
          !candidate.used && new RegExp(candidate.q, "i").test(prompt.message),
      );
      if (!rule && answered.has(key)) {
        // The panel re-sends a prompt when it is revealed. No rule is left for
        // this question, so it is that echo and not a new question: ignore it.
        // A question the command really asks twice (a name that failed the
        // project's pattern, say) has a second rule, and lands above.
        return result;
      }
      asked.push(prompt);
      if (!rule) {
        failure =
          `${step.label}: the panel asked a question no answer covers:\n` +
          `  "${prompt.message}"\n` +
          (prompt.choices.length
            ? `  choices: ${prompt.choices.map((c) => c.title).join(" | ")}\n`
            : "") +
          "  A learner reading this lab would be stuck on it: either the lab " +
          "does not mention this question, or the command should not be asking it.";
        return result;
      }
      rule.used = true;
      answered.add(key);
      console.log(`[lab] ${prompt.message}`);
      const value = answerFor(prompt, rule);
      console.log(`[lab]   -> ${JSON.stringify(value)}`);
      // The extension subscribes to the answer only AFTER this send returns:
      // hardis-websocket-server sends showPrompt, then registers the handler
      // that turns a submit into the CLI's response. Answering synchronously
      // would answer into the void and the command would wait for its own
      // timeout. Defer to the next tick, once the handler is in place.
      setTimeout(() => {
        try {
          panel.simulateWebviewMessage({
            type: "submit",
            data: { [prompt.name]: value },
          });
        } catch (error: any) {
          failure = `${step.label}: submitting the answer to "${prompt.message}" failed: ${error?.message || String(error)}`;
        }
      }, 0);
    } catch (error: any) {
      failure = `${step.label}: ${error?.message || String(error)}`;
    }
    return result;
  };

  // A disposed panel is no longer served by the manager, but the object still
  // carries the status it ended on: read it from the reference, not by id.
  const currentStatus = () => String(panel.commandStatus || "");
  let finished = false;
  try {
    await waitFor(
      () =>
        failure !== null ||
        ["completed", "error", "aborted"].includes(currentStatus()),
      timeoutMs,
      `${step.label} (${step.command}) to finish`,
    );
    finished = true;
  } finally {
    panel.sendMessage = originalSendMessage;
    if (!finished || failure) {
      // Leaving the CLI running would keep it waiting on an unanswered prompt,
      // against the learner's real repository and org, while the next lab
      // starts in the same workspace. Disposing the panel cancels the command.
      try {
        panelManager.disposePanel(panelId);
      } catch {
        // Already gone: the command errored or closed itself
      }
    }
  }

  assert.ok(!failure, failure || "");
  const status = currentStatus();
  assert.strictEqual(
    status,
    "completed",
    `${step.label}: "${step.command}" ended as "${status}". ` +
      "A learner following this lab would see the same failure.",
  );

  const unused = rules.filter((rule) => !rule.used && !rule.optional);
  assert.strictEqual(
    unused.length,
    0,
    `${step.label}: the lab expects questions the command never asked: ` +
      unused.map((rule) => rule.q).join(" | ") +
      ". Either the command stopped asking, or the lab describes a step that no longer exists.",
  );

  for (const expected of step.expectPanels || []) {
    assert.ok(
      panelManager.getActivePanelIds().includes(expected),
      `${step.label}: the panel "${expected}" the lab shows was never opened`,
    );
  }

  return asked;
}

/** Opens a panel by its VS Code command and waits for it to expose its data. */
export async function openPanel(
  panelManager: any,
  panelId: string,
  vscodeCommand: string,
): Promise<any> {
  await vscode.commands.executeCommand(vscodeCommand);
  const panel = await waitFor(
    () => panelManager.getPanel(panelId),
    60000,
    `${panelId} to open`,
  );
  await waitFor(
    () => panel.getInitializationData(),
    60000,
    `${panelId} to expose its initialization data`,
  );
  return panel;
}
