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
import { listAllOrgs } from "../utils/orgUtils";
import { listMajorOrgs } from "../utils/orgConfigUtils";
import {
  getConfig,
  getCurrentGitBranch,
} from "../utils/pipeline/sfdxHardisConfig";
import {
  BackpromotePlan,
  BackpromotePlanProgress,
  BackpromoteSelection,
  BackpromoteSetup,
  buildDefaultSelection,
  buildOrgChoices,
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
// After "Connect another org", the org list reloads when the default org changes
// during this delay
const ORG_SELECTION_WATCH_MS = 10 * 60 * 1000;

interface BackpromotePanelState {
  /** What the panel offers to choose from before a plan */
  setup: BackpromoteSetup | null;
  /** Org picked in the panel, null for the default org */
  targetOrg: string | null;
  /** Parent branch picked in the panel, null for the one sfdx-hardis guesses */
  parentBranch: string | null;
  /** The user asked for a plan: the panel shows it (or its loading state) instead of the setup */
  planRequested: boolean;
  plan: BackpromotePlan | null;
  selection: BackpromoteSelection | null;
  /** Revision of the last selection received from the webview */
  revision: number;
  orgSelectionWatcher: vscode.Disposable | null;
  loadCounter: number;
}

function createState(): BackpromotePanelState {
  return {
    setup: null,
    targetOrg: null,
    parentBranch: null,
    planRequested: false,
    plan: null,
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

/**
 * The org and the parent branch are chosen before anything is computed: the authenticated
 * orgs (cached list, no connection probe) and the major branches of config/branches.
 */
async function loadSetup(): Promise<BackpromoteSetup> {
  const [orgs, majorOrgs, projectConfig, currentBranch] = await Promise.all([
    listAllOrgs(false, true, true).catch(() => []),
    listMajorOrgs().catch(() => []),
    getConfig("project").catch(() => ({})),
    getCurrentGitBranch().catch(() => ""),
  ]);
  const developmentBranch: string | null =
    typeof projectConfig?.developmentBranch === "string"
      ? projectConfig.developmentBranch
      : null;
  const parentBranchChoices = [
    ...new Set(
      [developmentBranch, ...majorOrgs.map((org) => org.branchName)].filter(
        (branch): branch is string => !!branch && isSafeCommandValue(branch),
      ),
    ),
  ];
  return {
    currentBranch: String(currentBranch || ""),
    orgs: buildOrgChoices(orgs),
    parentBranchChoices,
    defaultParentBranch: developmentBranch || parentBranchChoices[0] || null,
  };
}

type PlanFetchResult =
  | { plan: BackpromotePlan }
  | { planError: { message: string; cliTooOld: boolean } };

async function fetchPlan(
  parentBranch: string | null,
  targetOrg: string | null,
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
      await execSfdxJson(buildPlanCommand(parentBranch, { targetOrg }), {
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
    setup: panelState.setup,
    targetOrg: panelState.targetOrg,
    parentBranch: panelState.parentBranch,
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

/** The org and the parent branch the webview asks for, only when the setup offers them */
function acceptChoices(panelState: BackpromotePanelState, data: any): void {
  const setup = panelState.setup;
  const targetOrg = data?.targetOrg;
  if (typeof targetOrg === "string" && targetOrg && setup?.orgs.some((org) => org.username === targetOrg)) {
    panelState.targetOrg = targetOrg;
  } else if (targetOrg === null || targetOrg === "") {
    panelState.targetOrg = null;
  }
  const parentBranch = data?.parentBranch;
  const branchChoices = new Set([
    ...(setup?.parentBranchChoices || []),
    ...(panelState.plan?.parentBranchChoices || []),
  ]);
  if (typeof parentBranch === "string" && parentBranch && branchChoices.has(parentBranch) && isSafeCommandValue(parentBranch)) {
    panelState.parentBranch = parentBranch;
  } else if (parentBranch === null || parentBranch === "") {
    panelState.parentBranch = null;
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

      // Open the panel at once: the setup lists load in the background
      const panel = lwcManager.getOrCreatePanel(BACKPROMOTE_LWC_ID, {
        loading: true,
      });
      panel.updateTitle(t("backpromote"));
      lwcManager.setDisposalCallback(BACKPROMOTE_LWC_ID, () => {
        disposeState(state);
        state = createState();
      });

      const showSetup = async () => {
        const current = state;
        const loadId = ++current.loadCounter;
        panel.sendInitializationData({ loading: true });
        const setup = await loadSetup();
        if (state !== current || loadId !== current.loadCounter || panel.isDisposed()) {
          return;
        }
        current.setup = setup;
        if (current.parentBranch === null) {
          current.parentBranch = setup.defaultParentBranch;
        }
        if (current.targetOrg === null) {
          current.targetOrg = setup.orgs.find((org) => org.isDefault)?.username || null;
        }
        panel.sendInitializationData({
          loading: false,
          planError: null,
          setup,
          targetOrg: current.targetOrg,
          parentBranch: current.parentBranch,
          plan: null,
        });
      };

      const loadAndPush = async () => {
        const current = state;
        const loadId = ++current.loadCounter;
        current.planRequested = true;
        panel.sendInitializationData({ loading: true, setup: current.setup });
        const fetched = await fetchPlan(
          current.parentBranch,
          current.targetOrg,
          (progress) => {
            if (
              state === current &&
              loadId === current.loadCounter &&
              !panel.isDisposed()
            ) {
              panel.sendMessage({ type: "planProgress", data: progress });
            }
          },
        );
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
            setup: current.setup,
            targetOrg: current.targetOrg,
            parentBranch: current.parentBranch,
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
            if (current.planRequested) {
              await loadAndPush();
            } else {
              await showSetup();
            }
            break;
          }
          case "computePlan":
          case "changeParentBranch":
          case "changeTargetOrg": {
            acceptChoices(current, data);
            // Another org or another parent branch: the decisions were about another merge
            current.plan = null;
            current.selection = null;
            await loadAndPush();
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
          case "selectOrg": {
            connectAnotherOrg(current, showSetup, loadAndPush);
            break;
          }
          default:
            break;
        }
      });

      void showSetup();
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
 * Authenticates another org with the org selection command, then offers it: the org list
 * reloads once the default org changed, and the plan is computed again when one was shown.
 */
function connectAnotherOrg(
  current: BackpromotePanelState,
  showSetup: () => Promise<void>,
  reloadPlan: () => Promise<void>,
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
      // The new default org becomes the target
      current.targetOrg = null;
      current.plan = null;
      current.selection = null;
      void showSetup().then(() => (current.planRequested ? reloadPlan() : undefined));
    }
  }
  timer = setTimeout(stop, ORG_SELECTION_WATCH_MS);
  current.orgSelectionWatcher = subscription;
  vscode.commands.executeCommand(
    "vscode-sfdx-hardis.execute-command",
    "sf hardis:org:select --set-default",
  );
}
