import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { execSfdxJson, getWorkspaceRoot } from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION } from "../constants";
import { collectProviderCredentialEnvVarsWithStatus } from "../utils/providerCredentials";
import {
  ReplacementPreviewView,
  ReplacementRuleLayer,
  ReplacementRulesPanelError,
  ReplacementRulesView,
  ReplacementWriteOperation,
  buildReplacementListCommand,
  buildReplacementPreviewCommand,
  buildReplacementWriteCommand,
  checkReplacementWriteOperation,
  isReplacementCommandUnknown,
  isSafeReplacementBranch,
  isValidReplacementRuleId,
  normalizeReplacementRuleDraft,
  readReplacementListOutcome,
  readReplacementPreviewOutcome,
  replacementErrorMessage,
} from "../utils/replacementRulesUtils";

const REPLACEMENT_RULES_LWC_ID = "s-replacement-rules";

// Everything the webview draws. The whole state is sent at every change.
interface ReplacementRulesPanelState {
  // sfdx-hardis is reading the rules. With data, the data is the last one read
  loading: boolean;
  data: ReplacementRulesView | null;
  // When the data shown was read
  readAt: string | null;
  // sfdx-hardis version the panel asks for when the installed one is too old
  minimalCliVersion: string;
  error: ReplacementRulesPanelError | null;
  // A change of a rule runs: the panel waits for its end before the next one
  busy: boolean;
  preview: {
    running: boolean;
    targetBranch: string;
    result: ReplacementPreviewView | null;
    error: ReplacementRulesPanelError | null;
  };
}

interface ReplacementRulesSession {
  panel: LwcUiPanel;
  state: ReplacementRulesPanelState;
  loadCounter: number;
  // A reading of the rules is in progress
  reading: boolean;
  // The rules must be read again once the reading in progress ends
  reloadWanted: boolean;
}

// A change asked by the webview: one or two operations, run in this order
interface ReplacementWriteRequest {
  requestId: string;
  operations: Array<ReplacementWriteOperation & { rule?: any }>;
}

let session: ReplacementRulesSession | null = null;

export function registerShowReplacementRules(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showReplacementRules",
    async () => {
      // The panel opens at once, on its loading state
      const state = initialState();
      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        REPLACEMENT_RULES_LWC_ID,
        state,
      );
      panel.updateTitle(t("replacementRulesTitle"));
      const current: ReplacementRulesSession = {
        panel,
        state,
        loadCounter: 0,
        reading: false,
        reloadWanted: false,
      };
      session = current;

      panel.onMessage(async (type: string, data: any) => {
        if (type === "loadReplacementRules") {
          requestLoad(current);
        } else if (type === "saveReplacementRule") {
          await runWriteRequest(current, buildSaveRequest(data));
        } else if (type === "setReplacementRuleEnabled") {
          await runWriteRequest(current, {
            requestId: String(data?.requestId || ""),
            operations: [
              {
                action: "update",
                layer: data?.layer,
                branch: data?.branch,
                id: data?.id,
                enabled: data?.enabled === true,
              },
            ],
          });
        } else if (type === "deleteReplacementRule") {
          await runWriteRequest(current, {
            requestId: String(data?.requestId || ""),
            operations: [
              {
                action: "delete",
                layer: data?.layer,
                branch: data?.branch,
                id: data?.id,
              },
            ],
          });
        } else if (type === "previewReplacementRules") {
          await runPreview(current, String(data?.targetBranch || "default"));
        } else if (type === "connectToGit") {
          await connectToGit(current);
        }
      });

      requestLoad(current);
    },
  );
  commands.disposables.push(disposable);
}

function initialState(): ReplacementRulesPanelState {
  return {
    loading: true,
    data: null,
    readAt: null,
    minimalCliVersion: RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
    error: null,
    busy: false,
    preview: { running: false, targetBranch: "", result: null, error: null },
  };
}

/**
 * The operations of a save: a create or an update replacing what the layer stores, or, when
 * the rule moves to another layer, a create in the new one then a delete in the old one.
 */
function buildSaveRequest(data: any): ReplacementWriteRequest {
  const rule = normalizeReplacementRuleDraft(data?.rule);
  const layer = data?.layer as ReplacementRuleLayer;
  const branch = layer === "branch" ? String(data?.branch || "") : "";
  const requestId = String(data?.requestId || "");
  if (data?.mode !== "update") {
    return {
      requestId,
      operations: [{ action: "create", layer, branch, rule }],
    };
  }
  const originalLayer = (data?.originalLayer || layer) as ReplacementRuleLayer;
  const originalBranch =
    originalLayer === "branch" ? String(data?.originalBranch || "") : "";
  if (originalLayer === layer && originalBranch === branch) {
    return {
      requestId,
      operations: [{ action: "update", layer, branch, id: rule.id, rule }],
    };
  }
  return {
    requestId,
    operations: [
      { action: "create", layer, branch, rule },
      {
        action: "delete",
        layer: originalLayer,
        branch: originalBranch,
        id: rule.id,
      },
    ],
  };
}

/**
 * Runs the operations of one change with sfdx-hardis, one after the other, then tells the
 * webview how it ended and reads the rules again. An operation that fails stops the next ones.
 */
async function runWriteRequest(
  current: ReplacementRulesSession,
  request: ReplacementWriteRequest,
): Promise<void> {
  const refusal = checkWriteRequest(request);
  if (refusal) {
    replyWriteDone(current, request.requestId, false, refusal);
    return;
  }
  if (current.state.busy) {
    replyWriteDone(
      current,
      request.requestId,
      false,
      t("replacementRulesBusy"),
    );
    return;
  }
  pushState(current, { busy: true });
  let outcome: { ok: boolean; message: string };
  try {
    const env = await collectCredentials();
    outcome = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("replacementRulesSaving"),
        cancellable: false,
      },
      () => runOperations(request.operations, env),
    );
  } catch (e: any) {
    outcome = { ok: false, message: String(e?.message || e) };
  } finally {
    pushState(current, { busy: false });
  }
  replyWriteDone(current, request.requestId, outcome.ok, outcome.message);
  if (outcome.ok) {
    vscode.window.showInformationMessage(
      outcome.message || t("replacementRulesSaved"),
    );
  } else {
    vscode.window.showErrorMessage(
      t("replacementRulesSaveError", { message: outcome.message }),
    );
  }
  // Even a failure can have changed a layer (the create of a move that worked)
  requestLoad(current);
}

// Why the request cannot run, already translated, or null
function checkWriteRequest(request: ReplacementWriteRequest): string | null {
  if (request.operations.length === 0) {
    return t("replacementRulesInvalidId");
  }
  for (const operation of request.operations) {
    const refusalKey = checkReplacementWriteOperation(operation);
    if (refusalKey) {
      return t(refusalKey);
    }
    if (operation.rule && !isValidReplacementRuleId(operation.rule.id)) {
      return t("replacementRulesInvalidId");
    }
  }
  return null;
}

async function runOperations(
  operations: Array<ReplacementWriteOperation & { rule?: any }>,
  env: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
  let message = "";
  for (const operation of operations) {
    const result = await runOperation(operation, env);
    if (result?.status !== 0) {
      const errorMessage = isReplacementCommandUnknown(result)
        ? t("replacementRulesOldCliDesc", {
            version: RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
          })
        : replacementErrorMessage(result) || t("replacementRulesUnknownError");
      return { ok: false, message: errorMessage };
    }
    message =
      typeof result?.result?.outputString === "string"
        ? result.result.outputString
        : "";
  }
  return { ok: true, message };
}

/**
 * One operation. A rule goes to sfdx-hardis in a temporary JSON file, removed right after:
 * its values never appear on a command line.
 */
async function runOperation(
  operation: ReplacementWriteOperation & { rule?: any },
  env: Record<string, string>,
): Promise<any> {
  let tmpDir = "";
  try {
    const { rule, ...write } = operation;
    if (rule) {
      tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "sfdx-hardis-replacement-rule-"),
      );
      write.ruleFile = path.join(tmpDir, `${rule.id}.json`);
      await fs.promises.writeFile(
        write.ruleFile,
        JSON.stringify(rule, null, 2),
        "utf8",
      );
    }
    return await execSfdxJson(buildReplacementWriteCommand(write), {
      cwd: getWorkspaceRoot(),
      fail: false,
      output: true,
      debug: false,
      reuseRecentResult: false,
      shareInFlightRun: false,
      env,
    });
  } catch (e: any) {
    return { status: 1, message: String(e?.message || e) };
  } finally {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }
}

function replyWriteDone(
  current: ReplacementRulesSession,
  requestId: string,
  ok: boolean,
  message: string,
): void {
  current.panel.sendMessage({
    type: "replacementWriteDone",
    data: { requestId, ok, message },
  });
}

/** Computes on the local files what the rules would change for a target. Nothing is written. */
async function runPreview(
  current: ReplacementRulesSession,
  targetBranch: string,
): Promise<void> {
  if (targetBranch !== "default" && !isSafeReplacementBranch(targetBranch)) {
    return;
  }
  pushState(current, {
    preview: { running: true, targetBranch, result: null, error: null },
  });
  let result: any;
  try {
    result = await execSfdxJson(buildReplacementPreviewCommand(targetBranch), {
      cwd: getWorkspaceRoot(),
      fail: false,
      output: false,
      debug: false,
      reuseRecentResult: false,
      // A preview asked after a change of a rule never takes the answer of an older run
      shareInFlightRun: false,
      env: await collectCredentials(),
    });
  } catch (e: any) {
    result = { status: 1, message: String(e?.message || e) };
  }
  if (session !== current || current.panel.isDisposed()) {
    return;
  }
  const outcome = readReplacementPreviewOutcome(result);
  if ("error" in outcome) {
    Logger.log(
      `[vscode-sfdx-hardis] Replacement rules preview failed (${outcome.error.kind}): ${outcome.error.message}`,
    );
  }
  pushState(current, {
    preview: {
      running: false,
      targetBranch,
      result: "preview" in outcome ? outcome.preview : null,
      error: "error" in outcome ? outcome.error : null,
    },
  });
}

/** Connects to the git provider, so that sfdx-hardis can read the issue, then reads again */
async function connectToGit(current: ReplacementRulesSession): Promise<void> {
  // Heavy module: loaded when the button is clicked, not with the panel
  const { connectGitProvider } = await import(
    "../utils/gitProviders/connectGitProvider"
  );
  if (
    (await connectGitProvider()) &&
    session === current &&
    !current.panel.isDisposed()
  ) {
    requestLoad(current);
  }
}

/**
 * Reads the rules now, or right after the reading in progress: an answer asked before a change
 * is never the one drawn. One reading at most waits.
 */
function requestLoad(current: ReplacementRulesSession): void {
  if (current.reading) {
    current.reloadWanted = true;
    return;
  }
  void loadReplacementRules(current);
}

async function loadReplacementRules(
  current: ReplacementRulesSession,
): Promise<void> {
  const loadId = ++current.loadCounter;
  current.reading = true;
  current.reloadWanted = false;
  pushState(current, { loading: true, error: null });

  let changes: Partial<ReplacementRulesPanelState>;
  try {
    changes = await readReplacementRules();
  } finally {
    current.reading = false;
  }
  if (
    loadId !== current.loadCounter ||
    session !== current ||
    current.panel.isDisposed()
  ) {
    return;
  }
  if (current.reloadWanted) {
    void loadReplacementRules(current);
    return;
  }
  pushState(current, changes);
}

async function readReplacementRules(): Promise<
  Partial<ReplacementRulesPanelState>
> {
  let result: any;
  try {
    result = await execSfdxJson(buildReplacementListCommand(), {
      cwd: getWorkspaceRoot(),
      fail: false,
      output: false,
      debug: false,
      // Not a result of the last 20 seconds: the reading after a save must see the change
      reuseRecentResult: false,
      shareInFlightRun: false,
      env: await collectCredentials(),
    });
  } catch (e: any) {
    result = { status: 1, message: String(e?.message || e) };
  }
  const outcome = readReplacementListOutcome(result);
  if ("error" in outcome) {
    Logger.log(
      `[vscode-sfdx-hardis] Replacement rules not read (${outcome.error.kind}): ${outcome.error.message}`,
    );
    // The last rules read stay on screen under the error
    return { loading: false, error: outcome.error };
  }
  return {
    loading: false,
    error: null,
    data: outcome.view,
    readAt: new Date().toISOString(),
  };
}

function pushState(
  current: ReplacementRulesSession,
  changes: Partial<ReplacementRulesPanelState>,
): void {
  Object.assign(current.state, changes);
  current.panel.sendStateUpdate({ ...current.state });
}

/**
 * Git provider credentials, so that sfdx-hardis can read and write the issue. Credentials not
 * read in time are tried once more: without them, the issue would show as unreadable.
 */
async function collectCredentials(): Promise<Record<string, string>> {
  try {
    let credentials = await collectProviderCredentialEnvVarsWithStatus();
    if (credentials.timedOut) {
      credentials = await collectProviderCredentialEnvVarsWithStatus();
    }
    return credentials.env;
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Replacement rules: provider credentials not collected: ${e?.message || e}`,
    );
    return {};
  }
}
