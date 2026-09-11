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
import { collectProviderCredentialEnvVars } from "../utils/providerCredentials";
import {
  BACKPROMOTE_COMMAND,
  BackpromotePlan,
  BackpromotePlanProgress,
  BackpromoteSelection,
  buildDefaultSelection,
  buildPlanCommand,
  buildPlanProgress,
  buildSelectionPayload,
  getBackpromoteErrorMessage,
  getTargetOrgDisplayName,
  isAllowedBackpromoteCommand,
  isCliTooOldForBackpromotePanel,
  isSafeCommandValue,
  normalizeBackpromotePlan,
  normalizeSelection,
  parseProgressEvents,
  recoverJsonCommandResult,
} from "../utils/backpromote/backpromotePanelUtils";

const BACKPROMOTE_LWC_ID = "s-backpromote";
// After "Select another org", the plan reloads when the default org changes
// during this delay
const ORG_SELECTION_WATCH_MS = 10 * 60 * 1000;

interface BackpromotePanelState {
  plan: BackpromotePlan | null;
  /** Parent branch picked in the panel, null for the one sfdx-hardis resolves */
  parentBranch: string | null;
  selection: BackpromoteSelection | null;
  /** Revision of the last selection received from the webview */
  revision: number;
  orgSelectionWatcher: vscode.Disposable | null;
  loadCounter: number;
}

function createState(): BackpromotePanelState {
  return {
    plan: null,
    parentBranch: null,
    selection: null,
    revision: 0,
    orgSelectionWatcher: null,
    loadCounter: 0,
  };
}

// The panel is a singleton: its state lives as long as the panel
let state: BackpromotePanelState = createState();

function disposeState(panelState: BackpromotePanelState): void {
  panelState.orgSelectionWatcher?.dispose();
  panelState.orgSelectionWatcher = null;
}

/**
 * sfdx-hardis names the Pull Requests it brings in from the git log, and completes their
 * titles from the git provider when it can reach it: pass the credentials of the extension,
 * like the command runner does.
 */
async function collectCredentialEnv(): Promise<Record<string, string>> {
  try {
    return await collectProviderCredentialEnvVars();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Backpromote: provider credentials not collected: ${e?.message || e}`,
    );
    return {};
  }
}

type PlanFetchResult =
  | { plan: BackpromotePlan }
  | { planError: { message: string; cliTooOld: boolean } };

async function fetchPlan(
  parentBranch: string | null,
  onProgress?: (progress: BackpromotePlanProgress) => void,
): Promise<PlanFetchResult> {
  // sfdx-hardis appends each step of the plan to this file (SFDX_HARDIS_PROGRESS_FILE):
  // the loading state shows it while the JSON result is not there yet
  const progressFile = path.join(
    os.tmpdir(),
    `sfdx-hardis-backpromote-plan-${process.pid}-${Date.now()}.jsonl`,
  );
  let lastProgressLength = -1;
  const readProgress = () => {
    try {
      if (!onProgress || !fs.existsSync(progressFile)) {
        return;
      }
      const content = fs.readFileSync(progressFile, "utf8");
      if (content.length === lastProgressLength) {
        return;
      }
      lastProgressLength = content.length;
      const progress = buildPlanProgress(parseProgressEvents(content));
      if (progress) {
        onProgress(progress);
      }
    } catch {
      // Read again at the next tick
    }
  };
  const progressTimer = setInterval(readProgress, 500);
  try {
    const result = recoverJsonCommandResult(
      await execSfdxJson(buildPlanCommand(parentBranch), {
        fail: false,
        output: false,
        reuseRecentResult: false,
        env: {
          ...(await collectCredentialEnv()),
          SFDX_HARDIS_PROGRESS_FILE: progressFile,
        },
      }),
    );
    const plan =
      result?.status === 0 ? normalizeBackpromotePlan(result.result) : null;
    if (plan) {
      return { plan };
    }
    const cliTooOld = isCliTooOldForBackpromotePanel(result);
    const message = getBackpromoteErrorMessage(result);
    Logger.log(
      `[vscode-sfdx-hardis] Backpromote plan not available (sfdx-hardis too old: ${cliTooOld}): ${message}`,
    );
    return {
      planError: {
        cliTooOld,
        message: message || t("backpromotePlanUnreadable"),
      },
    };
  } catch (e: any) {
    return {
      planError: { cliTooOld: false, message: String(e?.message || e) },
    };
  } finally {
    clearInterval(progressTimer);
    fs.promises.unlink(progressFile).catch(() => undefined);
  }
}

function buildPanelData(panelState: BackpromotePanelState): any {
  const plan = panelState.plan as BackpromotePlan;
  const selection = panelState.selection as BackpromoteSelection;
  return {
    loading: false,
    planError: null,
    plan,
    selection,
    revision: panelState.revision,
    ...buildSelectionPayload(plan, selection),
    targetOrgLabel: getTargetOrgDisplayName(plan.targetOrg),
    workspaceRoot: getWorkspaceRoot(),
  };
}

function sendSelectionSummary(
  panel: LwcUiPanel,
  panelState: BackpromotePanelState,
): void {
  if (!panelState.plan || !panelState.selection || panel.isDisposed()) {
    return;
  }
  panel.sendMessage({
    type: "selectionSummary",
    data: {
      revision: panelState.revision,
      selection: panelState.selection,
      ...buildSelectionPayload(panelState.plan, panelState.selection),
    },
  });
}

function acceptSelection(panelState: BackpromotePanelState, data: any): void {
  if (!panelState.plan) {
    return;
  }
  panelState.selection = normalizeSelection(panelState.plan, data?.selection);
  if (typeof data?.revision === "number") {
    panelState.revision = data.revision;
  }
}

export function registerShowBackpromote(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showBackpromote",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();
      if (!lwcManager.getPanel(BACKPROMOTE_LWC_ID)) {
        disposeState(state);
        state = createState();
      }

      // Open the panel at once: computing the plan previews the org and takes a
      // few seconds
      const panel = lwcManager.getOrCreatePanel(BACKPROMOTE_LWC_ID, {
        loading: true,
      });
      panel.updateTitle(t("backpromote"));
      lwcManager.setDisposalCallback(BACKPROMOTE_LWC_ID, () => {
        disposeState(state);
        state = createState();
      });

      const loadAndPush = async () => {
        const current = state;
        const loadId = ++current.loadCounter;
        panel.sendInitializationData({ loading: true });
        const fetched = await fetchPlan(current.parentBranch, (progress) => {
          if (
            state === current &&
            loadId === current.loadCounter &&
            !panel.isDisposed()
          ) {
            panel.sendMessage({ type: "planProgress", data: progress });
          }
        });
        // A newer load started meanwhile, or the panel was closed
        if (
          state !== current ||
          loadId !== current.loadCounter ||
          panel.isDisposed()
        ) {
          return;
        }
        if ("planError" in fetched) {
          panel.sendInitializationData({
            loading: false,
            planError: fetched.planError,
          });
          return;
        }
        const plan = fetched.plan;
        // The decisions taken on items, deletions, actions and conflicts are kept
        // across a refresh of the same plan
        const previous =
          current.plan && current.selection
            ? normalizeSelection(plan, current.selection)
            : null;
        current.plan = plan;
        current.selection = previous || buildDefaultSelection(plan);
        panel.sendInitializationData(buildPanelData(current));
      };

      panel.onMessage(async (type: string, data: any) => {
        const current = state;
        switch (type) {
          case "retryInit":
          case "refresh": {
            await loadAndPush();
            break;
          }
          case "changeParentBranch": {
            const parentBranch = data?.parentBranch;
            if (
              current.plan &&
              typeof parentBranch === "string" &&
              current.plan.parentBranchChoices.includes(parentBranch) &&
              isSafeCommandValue(parentBranch)
            ) {
              current.parentBranch = parentBranch;
              // The decisions were about another merge
              current.selection = null;
              current.plan = null;
              await loadAndPush();
            }
            break;
          }
          case "selectionChanged": {
            acceptSelection(current, data);
            sendSelectionSummary(panel, current);
            break;
          }
          case "runBackpromote": {
            runBackpromote(panel, current, data);
            break;
          }
          case "runInTerminal": {
            commands.commandRunner.executeCommandTerminal(
              BACKPROMOTE_COMMAND,
              await collectCredentialEnv(),
            );
            break;
          }
          case "selectOrg": {
            selectOrg(current, loadAndPush);
            break;
          }
          default:
            break;
        }
      });

      void loadAndPush();
    },
  );
  commands.disposables.push(disposable);
}

/**
 * Rebuilds the command from the plan held by the extension and the selection of the
 * webview: the webview never sends a command line.
 */
function runBackpromote(
  panel: LwcUiPanel,
  current: BackpromotePanelState,
  data: any,
): void {
  if (!current.plan) {
    return;
  }
  acceptSelection(current, data);
  const payload = buildSelectionPayload(
    current.plan,
    current.selection as BackpromoteSelection,
  );
  if (
    !payload.summary.canRun ||
    !payload.command ||
    !isAllowedBackpromoteCommand(payload.command)
  ) {
    vscode.window.showWarningMessage(t("backpromoteCannotRunSelection"));
    sendSelectionSummary(panel, current);
    return;
  }
  vscode.commands.executeCommand(
    "vscode-sfdx-hardis.execute-command",
    payload.command,
  );
  // The plan describes the branch and the org as they were before this run: it must be
  // computed again before running another one
  panel.sendMessage({ type: "runStarted", data: { command: payload.command } });
}

/**
 * Runs the org selection, then reloads the plan once the default org changed.
 */
function selectOrg(
  current: BackpromotePanelState,
  reload: () => Promise<void>,
): void {
  current.orgSelectionWatcher?.dispose();
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(getWorkspaceRoot(), ".sf/config.json"),
  );
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const subscription = vscode.Disposable.from(
    watcher,
    watcher.onDidChange(() => onConfigChange()),
    watcher.onDidCreate(() => onConfigChange()),
    new vscode.Disposable(() => clearTimeout(timer)),
  );
  const stop = () => {
    subscription.dispose();
    if (current.orgSelectionWatcher === subscription) {
      current.orgSelectionWatcher = null;
    }
  };
  function onConfigChange() {
    stop();
    if (state === current) {
      // Another org: the decisions were about this one
      current.selection = null;
      current.plan = null;
      void reload();
    }
  }
  timer = setTimeout(stop, ORG_SELECTION_WATCH_MS);
  current.orgSelectionWatcher = subscription;
  vscode.commands.executeCommand(
    "vscode-sfdx-hardis.execute-command",
    "sf hardis:org:select --set-default",
  );
}
