import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import simpleGit from "simple-git";
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
  BACKPROMOTE_DOC_URL,
  BACKPROMOTE_SCAN_PAGE,
  GIT_PROVIDER_TOKEN_VARIABLES,
  BackpromoteCommandTarget,
  BackpromoteDirtyTreeChoice,
  BackpromotePlan,
  BackpromotePlanProgress,
  BackpromoteProgressEvent,
  BackpromoteSelection,
  BackpromoteSetup,
  buildBackpromoteCommand,
  buildConfirmActionCommand,
  buildDefaultSelection,
  buildOrgChoices,
  buildPlanCommand,
  buildPlanProgress,
  buildPrepareCommand,
  buildResetCommand,
  buildSelectionPayload,
  countConflictMarkerBlocks,
  differingComparisons,
  extractPlanDocument,
  getBackpromoteErrorMessage,
  getTargetOrgDisplayName,
  hasGitProviderToken,
  isAllowedBackpromoteCommand,
  isCliTooOldForBackpromotePanel,
  isGitProviderMissing,
  isSafeCommandValue,
  listAllowedParentBranches,
  normalizeSelection,
  parseProgressEvents,
  recoverJsonCommandResult,
} from "../utils/backpromote/backpromotePanelUtils";

const BACKPROMOTE_LWC_ID = "s-backpromote";
// After "Connect another org", the org list reloads when the default org changes
// during this delay
const ORG_SELECTION_WATCH_MS = 10 * 60 * 1000;

interface BackpromotePanelState {
  setup: BackpromoteSetup | null;
  /** No git provider token in the environment: nothing else is shown */
  tokenMissing: boolean;
  targetOrg: string | null;
  parentBranch: string | null;
  /** Start Pull Request picked in the panel, null for the default of sfdx-hardis */
  fromPullRequest: number | null;
  scanLimit: number;
  /** Run id of the current plan, passed back so sfdx-hardis reuses its cache */
  runId: string | null;
  plan: BackpromotePlan | null;
  selection: BackpromoteSelection | null;
  revision: number;
  /** Marker counts read after each save of a prepared file */
  markers: Record<string, number>;
  fileWatchers: vscode.Disposable[];
  running: boolean;
  runLog: BackpromoteProgressEvent[];
  runResult: BackpromotePlan | null;
  runError: { message: string; status: string | null } | null;
  orgSelectionWatcher: vscode.Disposable | null;
  loadCounter: number;
}

function createState(): BackpromotePanelState {
  return {
    setup: null,
    tokenMissing: false,
    targetOrg: null,
    parentBranch: null,
    fromPullRequest: null,
    scanLimit: BACKPROMOTE_SCAN_PAGE,
    runId: null,
    plan: null,
    selection: null,
    revision: 0,
    markers: {},
    fileWatchers: [],
    running: false,
    runLog: [],
    runResult: null,
    runError: null,
    orgSelectionWatcher: null,
    loadCounter: 0,
  };
}

// The panel is a singleton: its state lives as long as the panel
let state: BackpromotePanelState = createState();

function disposeState(panelState: BackpromotePanelState): void {
  panelState.orgSelectionWatcher?.dispose();
  panelState.orgSelectionWatcher = null;
  for (const watcher of panelState.fileWatchers) {
    watcher.dispose();
  }
  panelState.fileWatchers = [];
}

/**
 * sfdx-hardis reads and writes the "Backpromotes" Pull Request comments: it needs the git
 * provider token, passed like the command runner does.
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
 * orgs (cached list, no connection probe), with the major orgs disabled, and the parent
 * branches the project allows.
 */
async function loadSetup(): Promise<BackpromoteSetup> {
  const [orgs, majorOrgs, projectConfig, currentBranch] = await Promise.all([
    listAllOrgs(false, true, true).catch(() => []),
    listMajorOrgs().catch(() => []),
    getConfig("project").catch(() => ({})),
    getCurrentGitBranch().catch(() => ""),
  ]);
  const allowedParentBranches = listAllowedParentBranches(projectConfig);
  return {
    currentBranch: String(currentBranch || ""),
    orgs: buildOrgChoices(orgs, majorOrgs),
    allowedParentBranches,
    defaultParentBranch: allowedParentBranches[0] || null,
  };
}

/**
 * The org, the parent branch, the start Pull Request and the run id a command is built with.
 * The plan command only carries the start the user picked (sfdx-hardis chooses the default
 * one otherwise); the prepare, run and confirm commands carry the start of the current plan.
 */
function commandTarget(
  panelState: BackpromotePanelState,
  options: { forPlan?: boolean } = {},
): BackpromoteCommandTarget | null {
  if (!panelState.targetOrg || !panelState.parentBranch) {
    return null;
  }
  return {
    targetOrg: panelState.targetOrg,
    parentBranch: panelState.parentBranch,
    fromPullRequest: options.forPlan
      ? panelState.fromPullRequest
      : (panelState.plan?.window?.startPullRequest ?? panelState.fromPullRequest),
    runId: panelState.runId,
  };
}

type CommandOutcome =
  | { plan: BackpromotePlan; status: number }
  | { error: { message: string; cliTooOld: boolean; status: string | null; plan: BackpromotePlan | null } };

/**
 * Runs one backpromote command in the background, with the progress file sfdx-hardis
 * appends its steps to, and returns the plan document it answers (the successful result, or
 * the plan attached to the error).
 */
async function runBackpromoteJson(
  command: string,
  onProgress?: (events: BackpromoteProgressEvent[]) => void,
): Promise<CommandOutcome> {
  if (!isAllowedBackpromoteCommand(command)) {
    return { error: { message: t("backpromoteCannotRunSelection"), cliTooOld: false, status: null, plan: null } };
  }
  const progressFile = path.join(
    os.tmpdir(),
    `sfdx-hardis-backpromote-${process.pid}-${Date.now()}.jsonl`,
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
      onProgress(parseProgressEvents(content));
    } catch {
      // Read again at the next tick
    }
  };
  const progressTimer = setInterval(readProgress, 500);
  try {
    const result = recoverJsonCommandResult(
      await execSfdxJson(command, {
        fail: false,
        output: false,
        reuseRecentResult: false,
        env: {
          ...(await collectCredentialEnv()),
          SFDX_HARDIS_PROGRESS_FILE: progressFile,
        },
      }),
    );
    readProgress();
    const plan = extractPlanDocument(result);
    if (result?.status === 0 && plan) {
      return { plan, status: 0 };
    }
    const cliTooOld = isCliTooOldForBackpromotePanel(result);
    const message =
      getBackpromoteErrorMessage(result) ||
      plan?.message ||
      t("backpromotePlanUnreadable");
    Logger.log(
      `[vscode-sfdx-hardis] Backpromote command failed (sfdx-hardis too old: ${cliTooOld}): ${message}`,
    );
    return { error: { message, cliTooOld, status: plan?.status || null, plan } };
  } catch (e: any) {
    return { error: { message: String(e?.message || e), cliTooOld: false, status: null, plan: null } };
  } finally {
    clearInterval(progressTimer);
    fs.promises.unlink(progressFile).catch(() => undefined);
  }
}

function buildPanelData(panelState: BackpromotePanelState): any {
  const plan = panelState.plan;
  const selection = panelState.selection;
  const target = commandTarget(panelState);
  const payload =
    plan && selection && target
      ? buildSelectionPayload(plan, selection, target, panelState.markers)
      : null;
  return {
    loading: false,
    planError: null,
    tokenMissing: panelState.tokenMissing,
    tokenVariables: GIT_PROVIDER_TOKEN_VARIABLES,
    docUrl: BACKPROMOTE_DOC_URL,
    setup: panelState.setup,
    targetOrg: panelState.targetOrg,
    parentBranch: panelState.parentBranch,
    fromPullRequest: panelState.fromPullRequest,
    plan,
    selection,
    revision: panelState.revision,
    markers: panelState.markers,
    summary: payload?.summary || null,
    command: payload?.command || null,
    commandError: payload?.commandError || null,
    targetOrgLabel: plan ? getTargetOrgDisplayName(plan.targetOrg) : "",
    workspaceRoot: getWorkspaceRoot(),
    running: panelState.running,
    runLog: panelState.runLog,
    runResult: panelState.runResult,
    runError: panelState.runError,
  };
}

function sendSelectionSummary(
  panel: LwcUiPanel,
  panelState: BackpromotePanelState,
): void {
  const target = commandTarget(panelState);
  if (!panelState.plan || !panelState.selection || !target || panel.isDisposed()) {
    return;
  }
  panel.sendMessage({
    type: "selectionSummary",
    data: {
      revision: panelState.revision,
      selection: panelState.selection,
      markers: panelState.markers,
      ...buildSelectionPayload(panelState.plan, panelState.selection, target, panelState.markers),
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
function acceptChoices(panelState: BackpromotePanelState, data: any): boolean {
  const setup = panelState.setup;
  let changed = false;
  const targetOrg = data?.targetOrg;
  if (
    typeof targetOrg === "string" &&
    targetOrg &&
    setup?.orgs.some((org) => org.username === targetOrg && !org.disabledReason)
  ) {
    changed = changed || panelState.targetOrg !== targetOrg;
    panelState.targetOrg = targetOrg;
  }
  const parentBranch = data?.parentBranch;
  const branchChoices = new Set([
    ...(setup?.allowedParentBranches || []),
    ...(panelState.plan?.allowedParentBranches || []),
  ]);
  if (
    typeof parentBranch === "string" &&
    parentBranch &&
    branchChoices.has(parentBranch) &&
    isSafeCommandValue(parentBranch)
  ) {
    changed = changed || panelState.parentBranch !== parentBranch;
    panelState.parentBranch = parentBranch;
  }
  return changed;
}

function readDirtyTree(data: any): BackpromoteDirtyTreeChoice | null {
  const raw = data?.dirtyTree;
  if (!raw || (raw.action !== "commit" && raw.action !== "stash")) {
    return null;
  }
  const message =
    raw.action === "commit" && typeof raw.message === "string" && raw.message.trim()
      ? raw.message.trim()
      : null;
  return { action: raw.action, message };
}

/** Counts the markers of a prepared file of the checkout, null when the file cannot be read */
function readMarkers(file: string): number | null {
  try {
    const absolute = path.join(getWorkspaceRoot(), file);
    return countConflictMarkerBlocks(fs.readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
}

/** Keeps the count of the plan when the file cannot be read */
function rememberMarkers(panelState: BackpromotePanelState, file: string): void {
  const count = readMarkers(file);
  if (count === null) {
    return;
  }
  panelState.markers = { ...panelState.markers, [file]: count };
}

/**
 * Watches the prepared files: after every save, the marker count of the file is read again
 * and sent to the panel, which enables the Backpromote button once none is left.
 */
function watchPreparedFiles(panel: LwcUiPanel, panelState: BackpromotePanelState): void {
  for (const watcher of panelState.fileWatchers) {
    watcher.dispose();
  }
  panelState.fileWatchers = [];
  const prepared = (panelState.plan?.comparison || []).filter((comparison) => comparison.prepared);
  if (prepared.length === 0) {
    return;
  }
  const root = getWorkspaceRoot();
  const refresh = (file: string) => {
    if (state !== panelState || panel.isDisposed()) {
      return;
    }
    rememberMarkers(panelState, file);
    sendSelectionSummary(panel, panelState);
  };
  for (const comparison of prepared) {
    rememberMarkers(panelState, comparison.file);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, comparison.file),
    );
    panelState.fileWatchers.push(
      watcher,
      watcher.onDidChange(() => refresh(comparison.file)),
      watcher.onDidCreate(() => refresh(comparison.file)),
    );
  }
  panelState.fileWatchers.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const relative = path
        .relative(root, document.uri.fsPath)
        .replace(/\\/g, "/");
      if (prepared.some((comparison) => comparison.file === relative)) {
        refresh(relative);
      }
    }),
  );
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

      const pushData = (current: BackpromotePanelState) => {
        if (state === current && !panel.isDisposed()) {
          panel.sendInitializationData(buildPanelData(current));
        }
      };

      const showSetup = async (): Promise<boolean> => {
        const current = state;
        const loadId = ++current.loadCounter;
        panel.sendInitializationData({ loading: true });
        const [setup, credentials] = await Promise.all([loadSetup(), collectCredentialEnv()]);
        if (state !== current || loadId !== current.loadCounter || panel.isDisposed()) {
          return false;
        }
        current.setup = setup;
        current.tokenMissing = !hasGitProviderToken({ ...process.env, ...credentials });
        if (current.parentBranch === null || !setup.allowedParentBranches.includes(current.parentBranch)) {
          current.parentBranch = setup.defaultParentBranch;
        }
        if (current.targetOrg === null || !setup.orgs.some((org) => org.username === current.targetOrg && !org.disabledReason)) {
          current.targetOrg = setup.orgs.find((org) => org.isDefault && !org.disabledReason)?.username || null;
        }
        return !current.tokenMissing;
      };

      const loadPlan = async () => {
        const current = state;
        // A new plan is about another window or another moment: the previous run is over
        current.runResult = null;
        current.runError = null;
        current.runLog = [];
        const target = commandTarget(current, { forPlan: true });
        if (!target || current.tokenMissing) {
          pushData(current);
          return;
        }
        const loadId = ++current.loadCounter;
        panel.sendInitializationData({ loading: true, setup: current.setup, targetOrg: current.targetOrg, parentBranch: current.parentBranch });
        let command: string;
        try {
          command = buildPlanCommand(target, { scanLimit: current.scanLimit });
        } catch (e: any) {
          panel.sendInitializationData({
            loading: false,
            planError: { cliTooOld: false, message: String(e?.message || e) },
            tokenMissing: current.tokenMissing,
            setup: current.setup,
            targetOrg: current.targetOrg,
            parentBranch: current.parentBranch,
          });
          return;
        }
        const outcome = await runBackpromoteJson(
          command,
          (events) => {
            if (state === current && loadId === current.loadCounter && !panel.isDisposed()) {
              const progress: BackpromotePlanProgress | null = buildPlanProgress(events);
              if (progress) {
                panel.sendMessage({ type: "planProgress", data: progress });
              }
            }
          },
        );
        // A newer load started meanwhile, or the panel was closed
        if (state !== current || loadId !== current.loadCounter || panel.isDisposed()) {
          return;
        }
        if ("error" in outcome) {
          if (outcome.error.plan && isGitProviderMissing(outcome.error.plan)) {
            current.tokenMissing = true;
            pushData(current);
            return;
          }
          panel.sendInitializationData({
            loading: false,
            planError: { cliTooOld: outcome.error.cliTooOld, message: outcome.error.message },
            tokenMissing: current.tokenMissing,
            setup: current.setup,
            targetOrg: current.targetOrg,
            parentBranch: current.parentBranch,
          });
          return;
        }
        const plan = outcome.plan;
        if (isGitProviderMissing(plan)) {
          current.tokenMissing = true;
          pushData(current);
          return;
        }
        // The decisions taken on items, deletions and actions are kept across a refresh of the same plan
        const previous = current.plan && current.selection ? normalizeSelection(plan, current.selection) : null;
        current.plan = plan;
        current.runId = plan.runId || current.runId;
        current.selection = previous || buildDefaultSelection(plan);
        current.markers = {};
        watchPreparedFiles(panel, current);
        pushData(current);
      };

      const startOver = async () => {
        const current = state;
        current.plan = null;
        current.selection = null;
        current.runId = null;
        current.fromPullRequest = null;
        current.scanLimit = BACKPROMOTE_SCAN_PAGE;
        current.markers = {};
        current.runResult = null;
        current.runError = null;
        current.runLog = [];
        await loadPlan();
      };

      panel.onMessage(async (type: string, data: any) => {
        const current = state;
        switch (type) {
          case "retryInit":
          case "refresh": {
            const ready = await showSetup();
            if (ready) {
              await loadPlan();
            } else {
              pushData(current);
            }
            break;
          }
          case "changeTargetOrg":
          case "changeParentBranch": {
            // Another org or another parent branch: the plan is about another backpromote
            if (acceptChoices(current, data) || !current.plan) {
              await startOver();
            }
            break;
          }
          case "changeStartPullRequest": {
            const number = Number(data?.number);
            if (Number.isInteger(number) && number > 0) {
              current.fromPullRequest = number;
              current.markers = {};
              await loadPlan();
            }
            break;
          }
          case "showEarlier": {
            // One more page than the scan sfdx-hardis made (its limit may come from the project config)
            current.scanLimit = (current.plan?.scan.limit || current.scanLimit) + BACKPROMOTE_SCAN_PAGE;
            await loadPlan();
            break;
          }
          case "selectionChanged": {
            acceptSelection(current, data);
            sendSelectionSummary(panel, current);
            break;
          }
          case "mergeItem": {
            await prepareMerge(panel, current, data, pushData);
            break;
          }
          case "openMergeEditor": {
            await openMergeEditor(current, String(data?.itemKey || ""));
            break;
          }
          case "compareItem": {
            await compareItem(current, String(data?.itemKey || ""));
            break;
          }
          case "copyAgentPrompt": {
            await copyAgentPrompt(current);
            break;
          }
          case "runBackpromote": {
            await runBackpromote(panel, current, data, pushData);
            break;
          }
          case "confirmAction": {
            await confirmAction(panel, current, String(data?.actionId || ""), pushData);
            break;
          }
          case "backToBranch": {
            await backToBranch(current);
            break;
          }
          case "resetBranch": {
            await resetBranch(current, loadPlan);
            break;
          }
          case "selectOrg": {
            connectAnotherOrg(current, showSetup, loadPlan);
            break;
          }
          case "openSettings": {
            // The git provider tokens can be set in the extension settings
            await vscode.commands.executeCommand("workbench.action.openSettings", "vsCodeSfdxHardis");
            break;
          }
          default:
            break;
        }
      });

      const ready = await showSetup();
      if (ready) {
        await loadPlan();
      } else {
        pushData(state);
      }
    },
  );
  commands.disposables.push(disposable);
}

/** Absolute path of a file of the checkout */
function absoluteFile(file: string): string {
  return path.isAbsolute(file) ? file : path.join(getWorkspaceRoot(), file);
}

async function openFileInEditor(file: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absoluteFile(file)));
  await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * Opens the VS Code merge editor on a prepared file: base, sandbox version and parent branch
 * version from the cache, output = the file in the checkout. Without a base (two-way merge), or
 * when the merge editor is not available, the file itself opens: VS Code decorates its markers.
 */
async function openMergeEditor(current: BackpromotePanelState, itemKey: string): Promise<void> {
  const plan = current.plan;
  if (!plan) {
    return;
  }
  const files = differingComparisons(plan, itemKey).filter((comparison) => comparison.prepared);
  for (const comparison of files) {
    const output = vscode.Uri.file(absoluteFile(comparison.file));
    const { base, sandbox, parentHead } = comparison.versions;
    if (base && sandbox && parentHead) {
      try {
        await vscode.commands.executeCommand("_open.mergeEditor", {
          base: vscode.Uri.file(base),
          input1: { uri: vscode.Uri.file(sandbox), title: `${getTargetOrgDisplayName(plan.targetOrg)} (org)` },
          input2: { uri: vscode.Uri.file(parentHead), title: `${plan.parentBranch} (git)` },
          output,
        });
        continue;
      } catch (e: any) {
        Logger.log(`[vscode-sfdx-hardis] Merge editor not available, opening the file: ${e?.message || e}`);
      }
    }
    try {
      await openFileInEditor(comparison.file);
    } catch (e: any) {
      vscode.window.showErrorMessage(t("backpromoteOpenFileFailed", { file: comparison.file, message: String(e?.message || e) }));
    }
  }
}

/** The VS Code diff editor between the sandbox version and the parent branch version of the item files */
async function compareItem(current: BackpromotePanelState, itemKey: string): Promise<void> {
  const plan = current.plan;
  if (!plan) {
    return;
  }
  for (const comparison of differingComparisons(plan, itemKey)) {
    const { sandbox, parentHead } = comparison.versions;
    if (!sandbox || !parentHead) {
      continue;
    }
    try {
      await vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.file(sandbox),
        vscode.Uri.file(parentHead),
        `${path.basename(comparison.file)}: ${getTargetOrgDisplayName(plan.targetOrg)} (org) <-> ${plan.parentBranch} (git)`,
      );
    } catch (e: any) {
      vscode.window.showWarningMessage(t("vscodeDiffOpenFailed", { title: comparison.file }));
      Logger.log(`[vscode-sfdx-hardis] vscode.diff failed: ${e?.message || e}`);
    }
  }
}

async function copyAgentPrompt(current: BackpromotePanelState): Promise<void> {
  const promptFile = current.plan?.promptFile;
  if (!promptFile) {
    vscode.window.showInformationMessage(t("backpromoteNoPromptYet"));
    return;
  }
  try {
    await vscode.env.clipboard.writeText(fs.readFileSync(promptFile, "utf8"));
    vscode.window.showInformationMessage(t("backpromotePromptCopied"));
  } catch (e: any) {
    vscode.window.showErrorMessage(t("backpromoteOpenFileFailed", { file: promptFile, message: String(e?.message || e) }));
  }
}

/**
 * Merge on an item line: sfdx-hardis switches the checkout to the backpromote branch, writes the
 * merged files with markers and keeps the three versions in the cache; then the merge editor opens.
 */
async function prepareMerge(
  panel: LwcUiPanel,
  current: BackpromotePanelState,
  data: any,
  pushData: (current: BackpromotePanelState) => void,
): Promise<void> {
  const plan = current.plan;
  const target = commandTarget(current);
  const itemKey = String(data?.itemKey || "");
  // The webview marked the item as being prepared: every exit without a new plan releases it
  const failed = (message: string | null) => {
    if (!panel.isDisposed()) {
      panel.sendMessage({ type: "prepareFailed", data: { itemKey, message } });
    }
  };
  if (!plan || !target || !plan.items.some((item) => item.key === itemKey)) {
    failed(null);
    return;
  }
  acceptSelection(current, { selection: { ...(current.selection || {}), diffDecisions: { ...(current.selection?.diffDecisions || {}), [itemKey]: "merge" } }, revision: data?.revision });
  if (differingComparisons(plan, itemKey).every((comparison) => comparison.prepared)) {
    sendSelectionSummary(panel, current);
    await openMergeEditor(current, itemKey);
    return;
  }
  const dirtyTree = readDirtyTree(data);
  let command: string;
  try {
    command = buildPrepareCommand(plan, target, [itemKey], dirtyTree);
  } catch (e: any) {
    failed(String(e?.message || e));
    vscode.window.showWarningMessage(String(e?.message || e));
    return;
  }
  const loadId = current.loadCounter;
  panel.sendMessage({ type: "prepareStarted", data: { itemKey } });
  const outcome = await runBackpromoteJson(command);
  // The panel was closed, or another plan (other org, branch or start) replaced this one meanwhile
  if (state !== current || loadId !== current.loadCounter || panel.isDisposed()) {
    failed(null);
    return;
  }
  if ("error" in outcome) {
    failed(outcome.error.message);
    vscode.window.showErrorMessage(t("backpromotePrepareFailed", { message: outcome.error.message }));
    return;
  }
  noticeStash(plan, outcome.plan, dirtyTree);
  current.plan = outcome.plan;
  current.runId = outcome.plan.runId || current.runId;
  current.selection = normalizeSelection(outcome.plan, current.selection);
  watchPreparedFiles(panel, current);
  pushData(current);
  await openMergeEditor(current, itemKey);
}

/**
 * The dirty tree modal decides on the checkout state of the last plan: when sfdx-hardis
 * stashed changes the panel did not know about, the developer is told where they went.
 */
function noticeStash(
  before: BackpromotePlan,
  after: BackpromotePlan,
  dirtyTree: BackpromoteDirtyTreeChoice | null,
): void {
  if (!dirtyTree && after.checkout.stashed && !before.checkout.stashed) {
    vscode.window.showInformationMessage(
      t("backpromoteChangesStashed", { stash: after.checkout.stashMessage || "" }),
    );
  }
}

/**
 * The run: the command is rebuilt from the plan held by the extension and the selection of the
 * webview (the webview never sends a command line), and run in the background with its progress.
 */
async function runBackpromote(
  panel: LwcUiPanel,
  current: BackpromotePanelState,
  data: any,
  pushData: (current: BackpromotePanelState) => void,
): Promise<void> {
  const plan = current.plan;
  const target = commandTarget(current);
  if (!plan || !target || current.running) {
    return;
  }
  acceptSelection(current, data);
  const payload = buildSelectionPayload(plan, current.selection as BackpromoteSelection, target, current.markers);
  if (!payload.summary.canRun || !payload.command) {
    vscode.window.showWarningMessage(t("backpromoteCannotRunSelection"));
    sendSelectionSummary(panel, current);
    return;
  }
  const dirtyTree = readDirtyTree(data);
  let command: string;
  try {
    command = buildBackpromoteCommand(plan, current.selection as BackpromoteSelection, target, dirtyTree);
  } catch (e: any) {
    vscode.window.showWarningMessage(String(e?.message || e));
    return;
  }
  current.running = true;
  current.runLog = [];
  current.runResult = null;
  current.runError = null;
  panel.sendMessage({ type: "runStarted", data: { command } });
  const outcome = await runBackpromoteJson(command, (events) => {
    if (state === current && !panel.isDisposed()) {
      current.runLog = events;
      panel.sendMessage({ type: "runProgress", data: { events } });
    }
  });
  if (state !== current || panel.isDisposed()) {
    return;
  }
  current.running = false;
  if ("error" in outcome) {
    current.runError = { message: outcome.error.message, status: outcome.error.status };
    if (outcome.error.plan) {
      current.plan = outcome.error.plan;
      current.selection = normalizeSelection(outcome.error.plan, current.selection);
      watchPreparedFiles(panel, current);
    }
  } else {
    noticeStash(plan, outcome.plan, dirtyTree);
    current.runResult = outcome.plan;
    current.plan = outcome.plan;
    current.selection = normalizeSelection(outcome.plan, current.selection);
    current.markers = {};
    // The window is done: the next plan starts from the default sfdx-hardis computes
    current.fromPullRequest = null;
  }
  pushData(current);
  panel.sendMessage({ type: "runFinished", data: { ok: !("error" in outcome) } });
}

/** "Done in the sandbox" on a manual action: sfdx-hardis records it in the Pull Request comment */
async function confirmAction(
  panel: LwcUiPanel,
  current: BackpromotePanelState,
  actionId: string,
  pushData: (current: BackpromotePanelState) => void,
): Promise<void> {
  const plan = current.plan;
  const target = commandTarget(current);
  // The webview disabled the button: every exit gives it back
  const finished = () => {
    if (!panel.isDisposed()) {
      panel.sendMessage({ type: "confirmActionFinished", data: { actionId } });
    }
  };
  if (!plan || !target || !plan.actions.some((action) => action.id === actionId)) {
    finished();
    return;
  }
  let command: string;
  try {
    command = buildConfirmActionCommand(target, [actionId]);
  } catch (e: any) {
    finished();
    vscode.window.showErrorMessage(t("backpromoteConfirmActionFailed", { message: String(e?.message || e) }));
    return;
  }
  const loadId = current.loadCounter;
  const outcome = await runBackpromoteJson(command);
  if (state !== current || loadId !== current.loadCounter || panel.isDisposed()) {
    finished();
    return;
  }
  if ("error" in outcome) {
    finished();
    vscode.window.showErrorMessage(t("backpromoteConfirmActionFailed", { message: outcome.error.message }));
    return;
  }
  // Only the action lines change: the result of the run stays on screen
  const confirmed = outcome.plan.actions;
  current.plan = {
    ...plan,
    actions: plan.actions.map((action) => confirmed.find((entry) => entry.id === action.id) || action),
  };
  if (current.runResult) {
    current.runResult = { ...current.runResult, actions: current.plan.actions };
  }
  pushData(current);
  finished();
}

/**
 * Back to my branch: plain git, no backpromote. The original branch is checked out, the stash
 * the run made is popped, then a merge of the parent branch is proposed so the next save does
 * not commit the backpromoted metadata as the story's own work.
 */
async function backToBranch(current: BackpromotePanelState): Promise<void> {
  const plan = current.runResult || current.plan;
  const checkout = plan?.checkout;
  if (!plan || !checkout?.originalBranch || !isSafeCommandValue(checkout.originalBranch)) {
    vscode.window.showInformationMessage(t("backpromoteNoOriginalBranch"));
    return;
  }
  const git = simpleGit(getWorkspaceRoot());
  try {
    const status = await git.status();
    if (status.current !== checkout.originalBranch) {
      // A merged file not committed yet would be refused by the checkout, or carried onto the story branch
      if (!status.isClean()) {
        vscode.window.showWarningMessage(
          t("backpromoteBackToBranchDirty", { count: status.files.length, branch: status.current || "" }),
          { modal: true },
        );
        return;
      }
      await git.checkout(checkout.originalBranch);
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(t("backpromoteBackToBranchFailed", { branch: checkout.originalBranch, message: String(e?.message || e) }));
    return;
  }
  if (checkout.stashed && checkout.stashMessage) {
    try {
      const stashes = await git.stashList();
      const index = stashes.all.findIndex((entry) => (entry.message || "").includes(checkout.stashMessage as string));
      if (index >= 0) {
        await git.stash(["pop", `stash@{${index}}`]);
      }
    } catch (e: any) {
      // The stash stays in the list: nothing is lost, the developer pops it by hand
      vscode.window.showWarningMessage(t("backpromoteStashPopFailed", { message: String(e?.message || e) }));
    }
  }
  const mergeLabel = t("backpromoteMergeParentButton", { parentBranch: plan.parentBranch });
  const answer = await vscode.window.showInformationMessage(
    t("backpromoteBackOnBranch", { branch: checkout.originalBranch, parentBranch: plan.parentBranch }),
    mergeLabel,
  );
  if (answer === mergeLabel && isSafeCommandValue(plan.parentBranch)) {
    try {
      await git.merge([`origin/${plan.parentBranch}`]);
      vscode.window.showInformationMessage(t("backpromoteParentMerged", { parentBranch: plan.parentBranch, branch: checkout.originalBranch }));
    } catch (e: any) {
      vscode.window.showErrorMessage(t("backpromoteParentMergeFailed", { parentBranch: plan.parentBranch, message: String(e?.message || e) }));
    }
  }
}

/** Abandons the pending manual merges: the backpromote branch is deleted on origin and locally */
async function resetBranch(current: BackpromotePanelState, reloadPlan: () => Promise<void>): Promise<void> {
  const plan = current.plan;
  const target = commandTarget(current);
  if (!plan || !target) {
    return;
  }
  const confirmLabel = t("backpromoteResetConfirmButton");
  const answer = await vscode.window.showWarningMessage(
    t("backpromoteResetConfirm", { branch: plan.backpromoteBranch.name, count: plan.backpromoteBranch.pendingMerges.length }),
    { modal: true },
    confirmLabel,
  );
  if (answer !== confirmLabel) {
    return;
  }
  let command: string;
  try {
    command = buildResetCommand(target);
  } catch (e: any) {
    vscode.window.showErrorMessage(t("backpromoteResetFailed", { message: String(e?.message || e) }));
    return;
  }
  const loadId = current.loadCounter;
  const outcome = await runBackpromoteJson(command);
  if (state !== current || loadId !== current.loadCounter) {
    return;
  }
  if ("error" in outcome) {
    vscode.window.showErrorMessage(t("backpromoteResetFailed", { message: outcome.error.message }));
    return;
  }
  // The branch is gone: the next plan starts from scratch, with the default start
  current.runId = null;
  current.fromPullRequest = null;
  current.markers = {};
  await reloadPlan();
}

/**
 * Authenticates another org with the org selection command, then offers it: the org list
 * reloads once the default org changed, and the plan is computed again.
 */
function connectAnotherOrg(
  current: BackpromotePanelState,
  showSetup: () => Promise<boolean>,
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
      current.runId = null;
      void showSetup().then((ready) => (ready ? reloadPlan() : undefined));
    }
  }
  timer = setTimeout(stop, ORG_SELECTION_WATCH_MS);
  current.orgSelectionWatcher = subscription;
  vscode.commands.executeCommand(
    "vscode-sfdx-hardis.execute-command",
    "sf hardis:org:select --set-default",
  );
}
