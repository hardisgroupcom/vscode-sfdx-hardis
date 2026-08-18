/**
 * Registry of command-execution panels opened at click time, before the
 * sfdx-hardis CLI process has booted and connected to the WebSocket server.
 *
 * Opening the panel immediately gives the user instant feedback instead of
 * waiting the full Salesforce CLI boot time (which can exceed 10 seconds).
 * When the CLI finally connects (initClient event), the pending panel is
 * "adopted":
 *  - New CLI versions reuse the provisional context id passed through the
 *    SFDX_HARDIS_COMMAND_CONTEXT_ID environment variable, so the panel id
 *    matches directly.
 *  - Older CLI versions generate their own context id (process pid); in that
 *    case the oldest pending panel with the same command id is matched and
 *    re-keyed.
 */

export interface PendingCommandPanel {
  /** Panel id in LwcPanelManager, i.e. `s-command-execution-<contextId>` */
  lwcId: string;
  /** Provisional context id passed to the CLI via SFDX_HARDIS_COMMAND_CONTEXT_ID */
  contextId: string;
  /** oclif command id, e.g. "hardis:org:diagnose:audittrail" (fallback matching) */
  commandId: string | null;
  /**
   * Full command line as requested by the user, e.g.
   * "sf hardis:org:diagnose:audittrail --outputfile ./x.csv".
   * The CLI only reports its oclif command id, so this is what lets the panel
   * replay the command with its original arguments ("Run again" button).
   */
  commandLine?: string;
  createdAt: number;
  /** Called when the CLI adopts the panel, so click-time wiring can detach */
  onAdopted?: () => void;
}

let pendingPanels: PendingCommandPanel[] = [];
let contextIdCounter = 0;

/** Generates a unique provisional context id for a spawned command */
export function generateProvisionalContextId(): string {
  contextIdCounter++;
  return `vscode-${Date.now().toString(36)}-${contextIdCounter}`;
}

/** Extracts the oclif command id ("hardis:xxx:yyy") from a full command line */
export function extractCommandId(commandLine: string): string | null {
  const parts = commandLine.trim().split(/\s+/);
  if (parts[0] === "sf" && parts[1] && parts[1].startsWith("hardis")) {
    return parts[1];
  }
  return null;
}

/**
 * Flags forcing the target org of a Salesforce CLI command, in the modern
 * (`--target-org` / `-o`) and legacy (`--targetusername` / `-u`) notations.
 */
const TARGET_ORG_FLAGS = ["-o", "-u", "--target-org", "--targetusername"];

/** Removes the surrounding quotes a shell argument may carry */
function unquoteArg(value: string): string {
  return value.replace(/^["']/, "").replace(/["']$/, "");
}

/**
 * Extracts the org username (or alias) explicitly forced on a command line,
 * e.g. `sf hardis:org:diagnose:audittrail --target-org my.user@org.com`.
 * Handles both the space (`-u USER`) and the equal (`--target-org=USER`)
 * notations, with or without quotes.
 * Returns null when the command relies on the project default org.
 */
export function extractTargetOrgUsername(
  commandLine: string | undefined | null,
): string | null {
  if (!commandLine) {
    return null;
  }
  // Keep quoted values in a single token, so `--target-org "my org"` works
  const tokens = commandLine.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const equalPos = token.indexOf("=");
    if (equalPos > 0 && TARGET_ORG_FLAGS.includes(token.slice(0, equalPos))) {
      const value = unquoteArg(token.slice(equalPos + 1));
      return value || null;
    }
    if (TARGET_ORG_FLAGS.includes(token)) {
      const value = unquoteArg(tokens[i + 1] || "");
      if (value && !value.startsWith("-")) {
        return value;
      }
    }
  }
  return null;
}

export function registerPendingCommandPanel(entry: PendingCommandPanel): void {
  pendingPanels.push(entry);
}

/**
 * Finds and removes the pending panel matching a CLI initClient message.
 * Exact provisional-context-id match wins; otherwise the oldest entry with the
 * same command id is used (older CLIs that ignore SFDX_HARDIS_COMMAND_CONTEXT_ID).
 */
export function takePendingCommandPanel(
  contextId: string,
  commandId: string | null,
): PendingCommandPanel | null {
  let index = pendingPanels.findIndex(
    (entry) => entry.contextId === String(contextId),
  );
  if (index === -1 && commandId) {
    index = pendingPanels.findIndex((entry) => entry.commandId === commandId);
  }
  if (index === -1) {
    return null;
  }
  const [entry] = pendingPanels.splice(index, 1);
  return entry;
}

/** Removes a pending entry without adopting it (panel closed or process ended) */
export function removePendingCommandPanel(lwcId: string): void {
  pendingPanels = pendingPanels.filter((entry) => entry.lwcId !== lwcId);
}
