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
import { GitProvider } from "../utils/gitProviders/gitProvider";
import {
  collectProviderCredentialEnvVars,
  invalidateProviderCredentialEnvCache,
} from "../utils/providerCredentials";
import {
  BACKPROMOTE_COMMAND,
  BackpromotePlan,
  BackpromoteSelection,
  buildDefaultSelection,
  buildPlanCommand,
  buildPrepareMergeCommand,
  buildSelectionPayload,
  countConflictBlocks,
  getBackpromoteErrorMessage,
  getTargetOrgDisplayName,
  BackpromotePlanProgress,
  buildPlanProgress,
  isAllowedBackpromoteCommand,
  isCliTooOldForBackpromotePanel,
  isSafeCommandValue,
  parseProgressEvents,
  normalizeBackpromotePlan,
  normalizePrepareMergeResult,
  normalizeSelection,
  recoverJsonCommandResult,
} from "../utils/backpromote/backpromotePanelUtils";

const BACKPROMOTE_LWC_ID = "s-backpromote";
// After "Select another org", the plan reloads when the default org changes
// during this delay
const ORG_SELECTION_WATCH_MS = 10 * 60 * 1000;

interface PreparedMerge {
  prompt: string;
  promptFile: string;
  nextCommand: string;
  localPath: string;
}

interface BackpromotePanelState {
  plan: BackpromotePlan | null;
  /** Parent branch picked in the panel, null for the one sfdx-hardis resolves */
  parentBranch: string | null;
  selection: BackpromoteSelection | null;
  /** Revision of the last selection received from the webview */
  revision: number;
  conflictBlocksByKey: Record<string, number>;
  preparedMerges: Record<string, PreparedMerge>;
  mergeWatchers: Map<string, vscode.Disposable>;
  orgSelectionWatcher: vscode.Disposable | null;
  loadCounter: number;
}

function createState(): BackpromotePanelState {
  return {
    plan: null,
    parentBranch: null,
    selection: null,
    revision: 0,
    conflictBlocksByKey: {},
    preparedMerges: {},
    mergeWatchers: new Map(),
    orgSelectionWatcher: null,
    loadCounter: 0,
  };
}

// The panel is a singleton: its state lives as long as the panel
let state: BackpromotePanelState = createState();

function disposeStateWatchers(panelState: BackpromotePanelState): void {
  for (const watcher of panelState.mergeWatchers.values()) {
    watcher.dispose();
  }
  panelState.mergeWatchers.clear();
  panelState.orgSelectionWatcher?.dispose();
  panelState.orgSelectionWatcher = null;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

async function readConflictBlocks(filePath: string): Promise<number | null> {
  try {
    return countConflictBlocks(await fs.promises.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * sfdx-hardis reads and writes the backpromote history in Pull Request comments and
 * only finds the git provider credentials in environment variables: pass the ones of
 * the extension, like the command runner does.
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
    ...buildSelectionPayload(plan, selection, panelState.conflictBlocksByKey),
    targetOrgLabel: getTargetOrgDisplayName(plan.targetOrg),
    conflictBlocksByKey: panelState.conflictBlocksByKey,
    preparedMerges: panelState.preparedMerges,
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
      ...buildSelectionPayload(
        panelState.plan,
        panelState.selection,
        panelState.conflictBlocksByKey,
      ),
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
        disposeStateWatchers(state);
        state = createState();
      }

      // Open the panel at once: computing the plan retrieves metadata from the
      // org and takes a while
      const panel = lwcManager.getOrCreatePanel(BACKPROMOTE_LWC_ID, {
        loading: true,
      });
      panel.updateTitle(t("backpromote"));
      lwcManager.setDisposalCallback(BACKPROMOTE_LWC_ID, () => {
        disposeStateWatchers(state);
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
        // Groups and actions start again from the plan defaults (a run may have
        // backpromoted some groups), the decisions taken on items are kept
        const previous =
          current.plan && current.selection
            ? normalizeSelection(plan, current.selection)
            : null;
        current.plan = plan;
        current.selection = {
          ...buildDefaultSelection(plan),
          ...(previous
            ? {
                excludedItems: previous.excludedItems,
                mergedItems: previous.mergedItems,
                excludedDeletions: previous.excludedDeletions,
              }
            : {}),
        };
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
              await loadAndPush();
            }
            break;
          }
          case "selectionChanged": {
            acceptSelection(current, data);
            sendSelectionSummary(panel, current);
            break;
          }
          case "prepareMerge": {
            await prepareMerge(panel, current, data);
            break;
          }
          case "runBackpromote": {
            runBackpromote(panel, current, data);
            break;
          }
          case "runInTerminal": {
            commands.commandRunner.executeCommandTerminal(BACKPROMOTE_COMMAND);
            break;
          }
          case "selectOrg": {
            selectOrg(current, loadAndPush);
            break;
          }
          case "connectGitProvider": {
            await connectGitProvider(loadAndPush);
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
 * Asks sfdx-hardis to write the 3-way merge of some items into their local files,
 * opens them, then follows their conflict markers to tell the panel when they are
 * solved.
 */
async function prepareMerge(
  panel: LwcUiPanel,
  current: BackpromotePanelState,
  data: any,
): Promise<void> {
  const keys: string[] = Array.isArray(data?.keys)
    ? data.keys.filter((key: unknown) => typeof key === "string")
    : [];
  const fail = (message: string, cliTooOld = false) => {
    panel.sendMessage({
      type: "mergePrepareFailed",
      data: { keys, message, cliTooOld },
    });
  };
  if (!current.plan) {
    fail(t("backpromotePlanUnreadable"));
    return;
  }
  acceptSelection(current, data);
  let command: string;
  try {
    command = buildPrepareMergeCommand(
      current.plan,
      current.selection as BackpromoteSelection,
      keys,
    );
  } catch (e: any) {
    fail(String(e?.message || e));
    return;
  }
  const credentialEnv = await collectCredentialEnv();
  const result = recoverJsonCommandResult(
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("backpromotePreparingMerge"),
        cancellable: false,
      },
      () =>
        execSfdxJson(command, {
          fail: false,
          output: false,
          reuseRecentResult: false,
          env: credentialEnv,
        }),
    ),
  );
  if (state !== current || panel.isDisposed()) {
    return;
  }
  const mergeResult =
    result?.status === 0 ? normalizePrepareMergeResult(result.result) : null;
  if (!mergeResult) {
    const cliTooOld = isCliTooOldForBackpromotePanel(result);
    fail(
      getBackpromoteErrorMessage(result) || t("backpromoteMergeFailed"),
      cliTooOld,
    );
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  const absolutePaths: string[] = [];
  for (const file of mergeResult.files) {
    const absolutePath = path.isAbsolute(file.localPath)
      ? file.localPath
      : path.join(workspaceRoot, file.localPath);
    absolutePaths.push(absolutePath);
    current.preparedMerges[file.key] = {
      prompt: mergeResult.prompt,
      promptFile: mergeResult.promptFile,
      nextCommand: mergeResult.nextCommand,
      localPath: file.localPath,
    };
    const blocks = await readConflictBlocks(absolutePath);
    current.conflictBlocksByKey[file.key] = blocks ?? file.conflictBlocks;
    watchMergedFile(panel, current, file.key, absolutePath);
  }
  panel.sendMessage({
    type: "mergePrepared",
    data: {
      requestedKeys: keys,
      keys: mergeResult.files.map((file) => file.key),
      result: mergeResult,
      conflictBlocksByKey: current.conflictBlocksByKey,
    },
  });
  sendSelectionSummary(panel, current);

  // sfdx-hardis opens the files itself when it is connected to VS Code, which a
  // --json call run by the extension is not
  for (const [index, absolutePath] of absolutePaths.entries()) {
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(absolutePath),
      );
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: index > 0,
      });
    } catch (e: any) {
      Logger.log(
        `[vscode-sfdx-hardis] Unable to open merged file ${absolutePath}: ${e?.message || e}`,
      );
    }
  }
}

function watchMergedFile(
  panel: LwcUiPanel,
  current: BackpromotePanelState,
  key: string,
  absolutePath: string,
): void {
  current.mergeWatchers.get(key)?.dispose();
  const refreshCount = async () => {
    const blocks = await readConflictBlocks(absolutePath);
    if (
      blocks === null ||
      state !== current ||
      panel.isDisposed() ||
      current.conflictBlocksByKey[key] === blocks
    ) {
      return;
    }
    current.conflictBlocksByKey[key] = blocks;
    panel.sendMessage({
      type: "mergeMarkers",
      data: { key, conflictBlocks: blocks },
    });
    sendSelectionSummary(panel, current);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(absolutePath)),
      path.basename(absolutePath),
    ),
  );
  current.mergeWatchers.set(
    key,
    vscode.Disposable.from(
      watcher,
      watcher.onDidChange(refreshCount),
      watcher.onDidCreate(refreshCount),
      // Saves from the editor are caught even where file watching is limited
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (samePath(document.uri.fsPath, absolutePath)) {
          void refreshCount();
        }
      }),
    ),
  );
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
    current.conflictBlocksByKey,
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
}

function showErrorWithLogs(message: string): void {
  const viewLogsLabel = t("viewLogs");
  vscode.window.showErrorMessage(message, viewLogsLabel).then((action) => {
    if (action === viewLogsLabel) {
      Logger.showOutputChannel();
    }
  });
}

/**
 * Connects to the git provider of the repository with the flow of the DevOps Pipeline,
 * then reloads the plan with the new credentials.
 */
async function connectGitProvider(reload: () => Promise<void>): Promise<void> {
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    vscode.window.showErrorMessage(t("noGitProviderDetected"));
    return;
  }
  let authenticated: boolean | null;
  try {
    authenticated = await gitProvider.authenticate();
  } catch (e) {
    Logger.log(
      `[vscode-sfdx-hardis] Backpromote: git provider authentication failed: ${String(e)}`,
    );
    showErrorWithLogs(t("gitProviderAuthError"));
    return;
  }
  if (authenticated === true) {
    // The credentials collected before the connection are cached: drop them so the
    // plan is computed with the new ones
    invalidateProviderCredentialEnvCache();
    vscode.window.showInformationMessage(
      t("successfullyConnectedToGitProvider"),
    );
    await reload();
  } else if (authenticated === false) {
    showErrorWithLogs(t("failedConnectGitProvider"));
  }
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
