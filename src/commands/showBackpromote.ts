import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import simpleGit from "simple-git";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { execSfdxJson, getDefaultTargetOrgUsername, getWorkspaceRoot } from "../utils";
import { onOrgsChanged } from "../utils/orgChangeEvents";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { collectProviderCredentialEnvVars } from "../utils/providerCredentials";
import { forgetCachedOrgList, listAllOrgs } from "../utils/orgUtils";
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
  BackpromoteProgressEvent,
  BackpromoteRunResult,
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
// A save in the editor and the file watcher report the same write: one read per file
const MARKER_READ_DEBOUNCE_MS = 200;
const PROGRESS_POLL_MS = 500;

/** What the panel shows of the last successful run: the plan itself is in `plan` */
interface BackpromoteRunOutcome {
  result: BackpromoteRunResult | null;
  message: string | null;
}

interface BackpromotePanelState {
  panel: LwcUiPanel;
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
  /** Merges being written by sfdx-hardis: no new plan while one is */
  preparing: number;
  running: boolean;
  runLog: BackpromoteProgressEvent[];
  runResult: BackpromoteRunOutcome | null;
  runError: { message: string; status: string | null } | null;
  /** "Connect another org" was picked: the next change of the orgs reloads the org list */
  awaitingOrgSelection: boolean;
  /** The default org when "Connect another org" was picked, to tell a new default from a new org */
  defaultOrgAtConnect: string | null;
  /** A change of the orgs arrived while a run or a prepare worked on the checkout */
  pendingOrgChange: boolean;
  orgChangeSubscription: { dispose: () => void } | null;
  applyOrgChange: (() => Promise<void>) | null;
  loadCounter: number;
}

function createState(panel: LwcUiPanel): BackpromotePanelState {
  return {
    panel,
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
    preparing: 0,
    running: false,
    runLog: [],
    runResult: null,
    runError: null,
    awaitingOrgSelection: false,
    defaultOrgAtConnect: null,
    pendingOrgChange: false,
    orgChangeSubscription: null,
    applyOrgChange: null,
    loadCounter: 0,
  };
}

// The panel is a singleton: its state lives as long as the panel
let state: BackpromotePanelState | null = null;

function disposeState(panelState: BackpromotePanelState): void {
  panelState.orgChangeSubscription?.dispose();
  panelState.orgChangeSubscription = null;
  panelState.applyOrgChange = null;
  for (const watcher of panelState.fileWatchers) {
    watcher.dispose();
  }
  panelState.fileWatchers = [];
}

/**
 * True when the answer of a command is about a state the panel left: the panel was closed
 * or replaced, or (when a load id is given) a newer plan replaced the one it was asked on.
 */
function isStale(current: BackpromotePanelState, loadId?: number): boolean {
  return (
    state !== current ||
    current.panel.isDisposed() ||
    (loadId !== undefined && loadId !== current.loadCounter)
  );
}

/** A run or a prepare is working on the checkout: nothing that starts a new plan is accepted */
function isBusy(current: BackpromotePanelState): boolean {
  return current.running || current.preparing > 0;
}

/** The root the relative paths of a plan are relative to */
function planRoot(plan: BackpromotePlan | null): string {
  return plan?.gitRoot || getWorkspaceRoot();
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
  | { plan: BackpromotePlan }
  | { error: { message: string; cliTooOld: boolean; status: string | null; plan: BackpromotePlan | null } };

/**
 * Reads the lines sfdx-hardis appended to its progress file since the last read: only the
 * new bytes are read, and a line still being written waits for the next read. The reads
 * are serialized, so the last read made once the command ended sees every line.
 */
class ProgressFileReader {
  readonly events: BackpromoteProgressEvent[] = [];
  private offset = 0;
  private pending: Buffer = Buffer.alloc(0);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  read(): Promise<BackpromoteProgressEvent[]> {
    const next = this.queue.then(() => this.readAppended());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async readAppended(): Promise<BackpromoteProgressEvent[]> {
    let chunk: Buffer;
    try {
      const size = (await fs.promises.stat(this.file)).size;
      if (size <= this.offset) {
        return [];
      }
      const handle = await fs.promises.open(this.file, "r");
      try {
        const buffer = Buffer.alloc(size - this.offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        chunk = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      // Not written yet: read again at the next tick
      return [];
    }
    this.offset += chunk.length;
    const buffered = Buffer.concat([this.pending, chunk]);
    const lastNewline = buffered.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      this.pending = buffered;
      return [];
    }
    this.pending = buffered.subarray(lastNewline + 1);
    const appended = parseProgressEvents(
      buffered.subarray(0, lastNewline + 1).toString("utf8"),
    );
    this.events.push(...appended);
    return appended;
  }
}

/**
 * Runs one backpromote command in the background, with the progress file sfdx-hardis
 * appends its steps to, and returns the plan document it answers (the successful result, or
 * the plan attached to the error). `onProgress` gets the steps appended since the last call,
 * and the whole list.
 */
async function runBackpromoteJson(
  command: string,
  onProgress?: (appended: BackpromoteProgressEvent[], all: BackpromoteProgressEvent[]) => void,
): Promise<CommandOutcome> {
  if (!isAllowedBackpromoteCommand(command)) {
    return { error: { message: t("backpromoteCannotRunSelection"), cliTooOld: false, status: null, plan: null } };
  }
  const progressFile = path.join(
    os.tmpdir(),
    `sfdx-hardis-backpromote-${process.pid}-${Date.now()}.jsonl`,
  );
  const reader = new ProgressFileReader(progressFile);
  const report = async () => {
    const appended = await reader.read();
    if (appended.length > 0 && onProgress) {
      onProgress(appended, reader.events);
    }
  };
  const progressTimer = onProgress ? setInterval(() => void report(), PROGRESS_POLL_MS) : null;
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
    if (progressTimer) {
      clearInterval(progressTimer);
      await report();
    }
    const plan = extractPlanDocument(result);
    if (result?.status === 0 && plan) {
      return { plan };
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
    if (progressTimer) {
      clearInterval(progressTimer);
    }
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

/** The whole state of the panel, as a state message (the translations are not sent again) */
function pushData(current: BackpromotePanelState): void {
  if (!isStale(current)) {
    current.panel.sendStateUpdate(buildPanelData(current));
  }
}

/** The plan could not be computed: the pickers stay usable, the message and the cause are shown */
function showPlanError(
  current: BackpromotePanelState,
  error: { message: string; cliTooOld: boolean },
): void {
  current.panel.sendStateUpdate({
    loading: false,
    planError: { cliTooOld: error.cliTooOld, message: error.message },
    tokenMissing: current.tokenMissing,
    setup: current.setup,
    targetOrg: current.targetOrg,
    parentBranch: current.parentBranch,
  });
}

function sendSelectionSummary(panelState: BackpromotePanelState): void {
  const target = commandTarget(panelState);
  if (!panelState.plan || !panelState.selection || !target || isStale(panelState)) {
    return;
  }
  panelState.panel.sendMessage({
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

/** Absolute path of a file of the plan, relative to the git root */
function absoluteFile(root: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

/** Counts the markers of a prepared file of the checkout, null when the file cannot be read */
function readMarkers(root: string, file: string): number | null {
  try {
    return countConflictMarkerBlocks(fs.readFileSync(absoluteFile(root, file), "utf8"));
  } catch {
    return null;
  }
}

/** Keeps the count of the plan when the file cannot be read */
function rememberMarkers(panelState: BackpromotePanelState, root: string, file: string): void {
  const count = readMarkers(root, file);
  if (count === null) {
    return;
  }
  panelState.markers = { ...panelState.markers, [file]: count };
}

/**
 * Watches the prepared files: after every save (or an external write, by a coding agent for
 * instance), the marker count of the file is read again and sent to the panel, which enables
 * the Backpromote button once none is left. One watcher covers every prepared file, and a
 * file is read once per burst of events.
 */
function watchPreparedFiles(current: BackpromotePanelState): void {
  for (const watcher of current.fileWatchers) {
    watcher.dispose();
  }
  current.fileWatchers = [];
  const plan = current.plan;
  const files = new Set(
    (plan?.comparison || [])
      .filter((comparison) => comparison.prepared)
      .map((comparison) => comparison.file),
  );
  if (!plan || files.size === 0) {
    return;
  }
  const root = planRoot(plan);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const refresh = (file: string) => {
    clearTimeout(timers.get(file));
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file);
        if (isStale(current)) {
          return;
        }
        rememberMarkers(current, root, file);
        sendSelectionSummary(current);
      }, MARKER_READ_DEBOUNCE_MS),
    );
  };
  const onFile = (uri: vscode.Uri) => {
    const relative = path.relative(root, uri.fsPath).replace(/\\/g, "/");
    if (files.has(relative)) {
      refresh(relative);
    }
  };
  for (const file of files) {
    rememberMarkers(current, root, file);
  }
  const names = [...files];
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, names.length === 1 ? names[0] : `{${names.join(",")}}`),
  );
  current.fileWatchers.push(
    watcher,
    watcher.onDidChange(onFile),
    watcher.onDidCreate(onFile),
    vscode.workspace.onDidSaveTextDocument((document) => onFile(document.uri)),
    new vscode.Disposable(() => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    }),
  );
}

export function registerShowBackpromote(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showBackpromote",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();
      const existing = lwcManager.getPanel(BACKPROMOTE_LWC_ID);
      if (existing && !existing.isDisposed() && state?.panel === existing) {
        // A plan may be computing, a merge being prepared or a run in progress: the
        // panel is only brought back
        existing.reveal();
        return;
      }
      if (state) {
        disposeState(state);
      }

      // Open the panel at once: the setup lists load in the background
      const panel = lwcManager.getOrCreatePanel(BACKPROMOTE_LWC_ID, {
        loading: true,
      });
      panel.updateTitle(t("backpromote"));
      const current = createState(panel);
      state = current;
      lwcManager.setDisposalCallback(BACKPROMOTE_LWC_ID, () => {
        disposeState(current);
        if (state === current) {
          state = null;
        }
      });

      const showSetup = async (): Promise<boolean> => {
        const loadId = ++current.loadCounter;
        panel.sendStateUpdate({ loading: true });
        const [setup, credentials] = await Promise.all([loadSetup(), collectCredentialEnv()]);
        if (isStale(current, loadId)) {
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
        panel.sendStateUpdate({ loading: true, setup: current.setup, targetOrg: current.targetOrg, parentBranch: current.parentBranch });
        let command: string;
        try {
          command = buildPlanCommand(target, { scanLimit: current.scanLimit });
        } catch (e: any) {
          showPlanError(current, { cliTooOld: false, message: String(e?.message || e) });
          return;
        }
        const outcome = await runBackpromoteJson(command, (_appended, all) => {
          if (!isStale(current, loadId)) {
            const progress = buildPlanProgress(all);
            if (progress) {
              panel.sendMessage({ type: "planProgress", data: progress });
            }
          }
        });
        // A newer load started meanwhile, or the panel was closed
        if (isStale(current, loadId)) {
          return;
        }
        if ("error" in outcome) {
          if (outcome.error.plan && isGitProviderMissing(outcome.error.plan)) {
            current.tokenMissing = true;
            pushData(current);
            return;
          }
          showPlanError(current, outcome.error);
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
        watchPreparedFiles(current);
        pushData(current);
      };

      const refreshPlan = async () => {
        const ready = await showSetup();
        if (ready) {
          await loadPlan();
        } else {
          pushData(current);
        }
      };

      // Another org, another branch or another start: nothing of the previous window is kept
      const clearWindow = () => {
        current.plan = null;
        current.selection = null;
        current.runId = null;
        current.fromPullRequest = null;
        current.scanLimit = BACKPROMOTE_SCAN_PAGE;
        current.markers = {};
        current.runResult = null;
        current.runError = null;
        current.runLog = [];
      };

      const startOver = async () => {
        clearWindow();
        await loadPlan();
      };

      // The orgs changed after "Connect another org": the org list is read again without its
      // cache. A new default org becomes the target and gets its own plan; an org authenticated
      // without becoming the default is only added to the list, the plan on screen stays.
      const applyOrgChange = async () => {
        if (!current.awaitingOrgSelection || isStale(current)) {
          return;
        }
        if (isBusy(current)) {
          current.pendingOrgChange = true;
          return;
        }
        current.pendingOrgChange = false;
        await forgetCachedOrgList();
        const newDefault = await getDefaultTargetOrgUsername().catch(() => null);
        if (newDefault !== current.defaultOrgAtConnect) {
          current.awaitingOrgSelection = false;
          current.defaultOrgAtConnect = newDefault;
          current.targetOrg = null;
          clearWindow();
          await refreshPlan();
          return;
        }
        const targetBefore = current.targetOrg;
        const ready = await showSetup();
        if (isStale(current)) {
          return;
        }
        if (ready && current.targetOrg !== targetBefore) {
          // The target left the list (an org removed in the Orgs Manager)
          await startOver();
        } else {
          pushData(current);
        }
      };
      current.applyOrgChange = applyOrgChange;

      // A new plan while --auto or --prepare works on the same checkout and run id would
      // answer about a state the checkout is leaving: the message is ignored, the panel gets
      // its current state back
      const unlessBusy = async (work: () => Promise<void>) => {
        if (isBusy(current)) {
          pushData(current);
          return;
        }
        await work();
      };

      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "refresh": {
            await unlessBusy(refreshPlan);
            break;
          }
          case "changeTargetOrg":
          case "changeParentBranch": {
            // Another org or another parent branch: the plan is about another backpromote
            await unlessBusy(async () => {
              if (acceptChoices(current, data) || !current.plan) {
                await startOver();
              } else {
                pushData(current);
              }
            });
            break;
          }
          case "changeStartPullRequest": {
            await unlessBusy(async () => {
              const number = Number(data?.number);
              if (Number.isInteger(number) && number > 0) {
                current.fromPullRequest = number;
                current.markers = {};
                await loadPlan();
              } else {
                pushData(current);
              }
            });
            break;
          }
          case "showEarlier": {
            await unlessBusy(async () => {
              // One more page than the scan sfdx-hardis made (its limit may come from the project config)
              current.scanLimit = (current.plan?.scan.limit || current.scanLimit) + BACKPROMOTE_SCAN_PAGE;
              await loadPlan();
            });
            break;
          }
          case "selectionChanged": {
            acceptSelection(current, data);
            sendSelectionSummary(current);
            break;
          }
          case "mergeItem": {
            await prepareMerge(current, data);
            break;
          }
          case "copyAgentPrompt": {
            await copyAgentPrompt(current);
            break;
          }
          case "runBackpromote": {
            await runBackpromote(current, data);
            break;
          }
          case "confirmAction": {
            await confirmAction(current, String(data?.actionId || ""));
            break;
          }
          case "backToBranch": {
            await backToBranch(current);
            break;
          }
          case "resetBranch": {
            await unlessBusy(() => resetBranch(current, loadPlan));
            break;
          }
          case "selectOrg": {
            await connectAnotherOrg(current);
            break;
          }
          default:
            break;
        }
      });

      await refreshPlan();
    },
  );
  commands.disposables.push(disposable);
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
  const root = planRoot(plan);
  const files = differingComparisons(plan, itemKey).filter((comparison) => comparison.prepared);
  for (const comparison of files) {
    const output = vscode.Uri.file(absoluteFile(root, comparison.file));
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
      await vscode.commands.executeCommand("vscode.open", output);
    } catch (e: any) {
      vscode.window.showErrorMessage(t("backpromoteOpenFileFailed", { file: comparison.file, message: String(e?.message || e) }));
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
    await vscode.env.clipboard.writeText(
      fs.readFileSync(absoluteFile(planRoot(current.plan), promptFile), "utf8"),
    );
    vscode.window.showInformationMessage(t("backpromotePromptCopied"));
  } catch (e: any) {
    vscode.window.showErrorMessage(t("backpromoteOpenFileFailed", { file: promptFile, message: String(e?.message || e) }));
  }
}

/**
 * Merge on an item line: sfdx-hardis switches the checkout to the backpromote branch, writes the
 * merged files with markers and keeps the three versions in the cache; then the merge editor opens.
 */
async function prepareMerge(current: BackpromotePanelState, data: any): Promise<void> {
  const plan = current.plan;
  const target = commandTarget(current);
  const itemKey = String(data?.itemKey || "");
  // The webview marked the item as being prepared: every exit without a new plan releases it
  const failed = (message: string | null) => {
    if (!current.panel.isDisposed()) {
      current.panel.sendMessage({ type: "prepareFailed", data: { itemKey, message } });
    }
  };
  if (!plan || !target || current.running || !plan.items.some((item) => item.key === itemKey)) {
    failed(null);
    return;
  }
  acceptSelection(current, { selection: { ...(current.selection || {}), diffDecisions: { ...(current.selection?.diffDecisions || {}), [itemKey]: "merge" } }, revision: data?.revision });
  if (differingComparisons(plan, itemKey).every((comparison) => comparison.prepared)) {
    sendSelectionSummary(current);
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
  current.preparing += 1;
  current.panel.sendMessage({ type: "prepareStarted", data: { itemKey } });
  let outcome: CommandOutcome;
  try {
    outcome = await runBackpromoteJson(command);
  } finally {
    current.preparing -= 1;
    applyPendingOrgChange(current);
  }
  // The panel was closed, or another plan (other org, branch or start) replaced this one meanwhile
  if (isStale(current, loadId)) {
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
  watchPreparedFiles(current);
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
async function runBackpromote(current: BackpromotePanelState, data: any): Promise<void> {
  const plan = current.plan;
  const target = commandTarget(current);
  if (!plan || !target || isBusy(current)) {
    return;
  }
  acceptSelection(current, data);
  const payload = buildSelectionPayload(plan, current.selection as BackpromoteSelection, target, current.markers);
  if (!payload.summary.canRun || !payload.command) {
    vscode.window.showWarningMessage(t("backpromoteCannotRunSelection"));
    sendSelectionSummary(current);
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
  current.panel.sendMessage({ type: "runStarted", data: { command } });
  const outcome = await runBackpromoteJson(command, (appended, all) => {
    if (!isStale(current)) {
      current.runLog = all.slice();
      current.panel.sendMessage({ type: "runProgress", data: { appended } });
    }
  });
  if (isStale(current)) {
    return;
  }
  current.running = false;
  if ("error" in outcome) {
    current.runError = { message: outcome.error.message, status: outcome.error.status };
    if (outcome.error.plan) {
      current.plan = outcome.error.plan;
      current.selection = normalizeSelection(outcome.error.plan, current.selection);
      watchPreparedFiles(current);
    }
  } else {
    noticeStash(plan, outcome.plan, dirtyTree);
    current.runResult = { result: outcome.plan.result, message: outcome.plan.message };
    current.plan = outcome.plan;
    current.selection = normalizeSelection(outcome.plan, current.selection);
    current.markers = {};
    // The window is done: the next plan starts from the default sfdx-hardis computes
    current.fromPullRequest = null;
  }
  pushData(current);
  current.panel.sendMessage({ type: "runFinished" });
  applyPendingOrgChange(current);
}

function applyPendingOrgChange(current: BackpromotePanelState): void {
  if (current.pendingOrgChange && !isBusy(current)) {
    void current.applyOrgChange?.();
  }
}

/**
 * "Done in the sandbox" on a manual action: sfdx-hardis records it in the Pull Request comment.
 * The recorded action lines are merged into the plan as it is when the answer arrives: a prepare
 * or a run may have replaced the plan the button was clicked on.
 */
async function confirmAction(current: BackpromotePanelState, actionId: string): Promise<void> {
  const plan = current.plan;
  const target = commandTarget(current);
  // The webview disabled the button: every exit gives it back
  const finished = () => {
    if (!current.panel.isDisposed()) {
      current.panel.sendMessage({ type: "confirmActionFinished", data: { actionId } });
    }
  };
  const action = plan?.actions.find((entry) => entry.id === actionId);
  // A run writes the same Pull Request comment, and its answer would replace the plan
  // holding the recorded action: not while it works on the checkout
  if (!plan || !target || !action || isBusy(current)) {
    finished();
    return;
  }
  let command: string;
  try {
    command = buildConfirmActionCommand(target, [actionId], { scanLimit: current.scanLimit });
  } catch (e: any) {
    finished();
    vscode.window.showErrorMessage(t("backpromoteConfirmActionFailed", { message: String(e?.message || e) }));
    return;
  }
  const loadId = current.loadCounter;
  const outcome = await runBackpromoteJson(command);
  if (isStale(current, loadId)) {
    finished();
    return;
  }
  if ("error" in outcome) {
    finished();
    vscode.window.showErrorMessage(t("backpromoteConfirmActionFailed", { message: outcome.error.message }));
    return;
  }
  // sfdx-hardis answers ok with a warning when the Pull Request of the action is outside its scan
  const recorded = outcome.plan.actions.find((entry) => entry.id === actionId);
  if (!recorded || recorded.alreadyRunOn === null) {
    finished();
    vscode.window.showErrorMessage(t("backpromoteConfirmActionNotRecorded", { label: action.label }));
    return;
  }
  // Only the action lines change: the result of the run stays on screen
  const confirmed = new Map(outcome.plan.actions.map((entry) => [entry.id, entry]));
  if (current.plan) {
    current.plan = {
      ...current.plan,
      actions: current.plan.actions.map((entry) => confirmed.get(entry.id) || entry),
    };
    current.selection = normalizeSelection(current.plan, current.selection);
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
  const plan = current.plan;
  const checkout = plan?.checkout;
  if (!plan || !checkout?.originalBranch || !isSafeCommandValue(checkout.originalBranch)) {
    vscode.window.showInformationMessage(t("backpromoteNoOriginalBranch"));
    return;
  }
  const git = simpleGit(planRoot(plan));
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
  if (isStale(current, loadId)) {
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
 * Opens the Orgs Manager to authenticate another org. The panel then listens to the changes of the
 * orgs (see applyOrgChange in the panel handler): no file watcher and no time limit, the listener
 * lives as long as the panel.
 */
async function connectAnotherOrg(current: BackpromotePanelState): Promise<void> {
  if (!current.awaitingOrgSelection) {
    current.defaultOrgAtConnect = await getDefaultTargetOrgUsername().catch(() => null);
  }
  current.awaitingOrgSelection = true;
  if (!current.orgChangeSubscription) {
    current.orgChangeSubscription = onOrgsChanged(() => {
      void current.applyOrgChange?.();
    });
  }
  await vscode.commands.executeCommand("vscode-sfdx-hardis.openOrgsManager");
}
