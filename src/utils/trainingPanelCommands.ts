import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * The sfdx-hardis training course drives its lessons through custom menu
 * entries that run `node scripts/training.mjs <verb>`. A custom command is a
 * plain shell line, so the command runner sends it to a terminal, and the
 * course promises a learner never needs one.
 *
 * These helpers open one narrow door: that exact command shape, in a workspace
 * that really is a clone of the course, may run in the Command Runner panel
 * instead of a terminal. The door is deliberately not configurable. A project
 * cannot open it for itself by declaring a key in its `.sfdx-hardis.yml`,
 * because that file comes from whatever repository was cloned, and a quieter
 * execution path is exactly what an untrusted repository would ask for.
 */

/**
 * `node scripts/training.mjs <verb> [--flag[=value]] [value]`, and nothing
 * else. The pattern is anchored, node's own flags cannot appear (they would
 * have to precede the script path), and the character set holds no shell
 * metacharacter, so a command that matches carries no `&&`, `|`, `;`, `$(`,
 * backtick, quote, newline or redirect.
 */
const ARGUMENT = "[A-Za-z0-9][A-Za-z0-9._:@/-]*";
const FLAG = `--?[A-Za-z][A-Za-z0-9-]*(?:=${ARGUMENT})?`;
// Spaces and tabs between the words, never a line break: `\s` would match one,
// and a second line is a second command as far as a shell is concerned.
const SPACE = "[^\\S\\n\\r]+";
const TRAINING_COMMAND = new RegExp(
  `^node${SPACE}scripts/training\\.mjs(?:${SPACE}(?:${FLAG}|${ARGUMENT}))+$`,
);

/** Files only a clone of the course has, both written by the course itself. */
const TRAINING_MARKERS = ["scripts/training.mjs", "training-universe.json"];

/** Any remote of the course repository or of a learner's fork of it. */
const TRAINING_REMOTE = /[/:][^/:\s]+\/sfdx-hardis-training(?:\.git)?\s*$/i;

function workspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

/** The folder the gate reads, for callers that pass it back in. */
export function trainingWorkspaceRoot(): string | null {
  return workspaceRoot();
}

/** True when the folder is a clone of the training course, fork included. */
export function isTrainingWorkspace(root: string): boolean {
  for (const marker of TRAINING_MARKERS) {
    if (!fs.existsSync(path.join(root, marker))) {
      return false;
    }
  }
  let gitConfig: string;
  try {
    gitConfig = fs.readFileSync(path.join(root, ".git", "config"), "utf8");
  } catch {
    // No .git/config (or unreadable): not a clone of anything
    return false;
  }
  return gitConfig
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("url"))
    .some((line) => TRAINING_REMOTE.test(line.split("=").slice(1).join("=")));
}

/**
 * Whether this command may run in the Command Runner panel although it is not
 * an `sf` command. Every condition has to hold: the command shape, the marker
 * files and the remote. Anything else keeps the terminal it has always had.
 */
export function isTrainingPanelCommandIn(
  command: string,
  root: string | null,
): boolean {
  const trimmed = (command || "").trim();
  if (!TRAINING_COMMAND.test(trimmed)) {
    return false;
  }
  return root !== null && isTrainingWorkspace(root);
}

export function isTrainingPanelCommand(command: string): boolean {
  return isTrainingPanelCommandIn(command, workspaceRoot());
}

/** `training.mjs check` reads better in the panel title than the whole line. */
export function trainingCommandLabel(command: string): string {
  const verb = command.trim().split(/\s+/)[2] || "";
  return `training.mjs ${verb}`.trim();
}

/**
 * The single entry `autorunCommands` holds once a learner has answered "Always
 * allow" on a Training menu command. It authorizes the Training menu of a clone
 * of the course and nothing else: every use of it re-runs
 * isTrainingPanelCommand(), so the command shape and the git remote are checked
 * again each time, and it is never treated as a plain string prefix.
 *
 * It reads like the script it stands for, so a person opening their settings
 * can see what they approved.
 */
export const TRAINING_AUTORUN_ENTRY = "node scripts/training.mjs";

/**
 * Whether `autorunCommands` already authorizes this command, so the learner is
 * not asked again.
 *
 * Two kinds of entry, and they are not matched the same way:
 *
 *   - TRAINING_AUTORUN_ENTRY authorizes the Training menu of a clone of the
 *     course. It is NOT a string prefix: the command is checked again for its
 *     shape and the folder for its git remote, so the same entry in the global
 *     settings gives nothing to another project shipping a script of that name
 *   - anything else is the exact command line the learner approved, matched as
 *     a prefix so that the same command with more arguments still counts
 *
 * An empty entry authorizes nothing. Left to `startsWith` it would authorize
 * every custom command there is, which is not something anybody can have meant.
 */
export function isAutorunAuthorized(
  command: string,
  autorunCommands: string[],
  root: string | null,
): boolean {
  const trimmed = (command || "").trim();
  if (trimmed === "") {
    return false;
  }
  return (autorunCommands || []).some((cmd) => {
    const entry = (cmd || "").trim();
    if (entry === "") {
      return false;
    }
    if (entry === TRAINING_AUTORUN_ENTRY) {
      return isTrainingPanelCommandIn(trimmed, root);
    }
    return trimmed.startsWith(entry);
  });
}

/** The entry to store when the learner answers "Always allow" on `command`. */
export function autorunEntryFor(command: string, root: string | null): string {
  const trimmed = (command || "").trim();
  return isTrainingPanelCommandIn(trimmed, root)
    ? TRAINING_AUTORUN_ENTRY
    : trimmed;
}
