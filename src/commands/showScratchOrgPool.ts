// jscpd:ignore-start
import * as vscode from "vscode";
import { Commands } from "../commands";
import { LwcPanelManager } from "../lwc-panel-manager";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { execSfdxJson, getWorkspaceRoot } from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";
import { RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION } from "../constants";
import { CacheManager } from "../utils/cache-manager";
import { SecretsManager } from "../utils/secretsManager";
import { onCommandCompleted } from "../utils/commandCompletionEvents";
// jscpd:ignore-end
import {
  collectProviderCredentialEnvVarsWithStatus,
  storePoolEncryptionKey,
} from "../utils/providerCredentials";
import { updateScratchPoolStatus } from "../hardis-status-provider";
import {
  ScratchOrgPoolPanelError,
  ScratchOrgPoolView,
  buildScratchOrgPoolViewCommand,
  isScratchOrgPoolCommand,
  readScratchOrgPoolOutcome,
  sanitizeScratchOrgPool,
  scratchOrgPoolCacheKey,
} from "../utils/scratchOrgPoolUtils";

const SCRATCH_ORG_POOL_LWC_ID = "s-scratch-org-pool";
// The last result is only what the panel shows while sfdx-hardis reads the pool again
const LAST_RESULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

// Everything the webview draws. The whole state is sent at every change.
interface ScratchOrgPoolPanelState {
  // sfdx-hardis is reading the pool. With a pool, the pool is the last one kept
  loading: boolean;
  pool: ScratchOrgPoolView | null;
  // When the pool shown was read
  readAt: string | null;
  // sfdx-hardis version the panel asks for when the installed one is too old
  minimalCliVersion: string;
  error: ScratchOrgPoolPanelError | null;
}

interface LastScratchOrgPoolResult {
  pool: ScratchOrgPoolView;
  readAt: string;
}

interface ScratchOrgPoolSession {
  panel: LwcUiPanel;
  state: ScratchOrgPoolPanelState;
  loadCounter: number;
  // A reading of the pool is in progress
  reading: boolean;
  // The pool must be read again once the reading in progress ends: what it reads, or the
  // credentials it reads with, changed after it started
  reloadWanted: boolean;
  // The panel itself is changing a secret (git connection, encryption key) and reads the pool
  // when it is done: the change must not start a reading of its own
  changingSecret: boolean;
}

let session: ScratchOrgPoolSession | null = null;

export function registerShowScratchOrgPool(commands: Commands) {
  // A git provider connected or an encryption key stored elsewhere while the panel waits
  // for one: the pool is read again
  SecretsManager.onSecretChanged(() => {
    const current = session;
    if (
      current &&
      !current.panel.isDisposed() &&
      !current.changingSecret &&
      // A reading in progress does not know yet whether it waits for a secret
      (current.reading || isWaitingForSecret(current.state))
    ) {
      requestLoad(current);
    }
  });

  // A command that changes the pool ended: the panel reads the pool again, which updates the
  // pool line of the status view too. Without the panel, that line is read again by itself.
  commands.disposables.push(
    onCommandCompleted((command) => {
      if (!isScratchOrgPoolCommand(command)) {
        return;
      }
      const current = session;
      if (current && !current.panel.isDisposed()) {
        requestLoad(current);
      } else {
        void updateScratchPoolStatus(null);
      }
    }),
  );

  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showScratchOrgPool",
    async () => {
      // The panel opens at once, on the last result when there is one
      const state = initialState();
      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        SCRATCH_ORG_POOL_LWC_ID,
        state,
      );
      panel.updateTitle(t("scratchOrgPoolTitle"));
      const current: ScratchOrgPoolSession = {
        panel,
        state,
        loadCounter: 0,
        reading: false,
        reloadWanted: false,
        changingSecret: false,
      };
      session = current;

      panel.onMessage(async (type: string) => {
        if (type === "loadScratchOrgPool") {
          requestLoad(current);
        } else if (type === "connectToGit") {
          await connectToGit(current);
        } else if (type === "setPoolEncryptionKey") {
          await setPoolEncryptionKey(current);
        }
      });

      requestLoad(current);
    },
  );
  commands.disposables.push(disposable);
}

function isWaitingForSecret(state: ScratchOrgPoolPanelState): boolean {
  return (
    state.error?.kind === "noGitProvider" ||
    state.pool?.keyStatus === "missing" ||
    state.pool?.keyStatus === "mismatch"
  );
}

function initialState(): ScratchOrgPoolPanelState {
  const last = readLastResult();
  return {
    loading: true,
    pool: last?.pool || null,
    readAt: last?.readAt || null,
    minimalCliVersion: RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
    error: null,
  };
}

function readLastResult(): LastScratchOrgPoolResult | null {
  const last = CacheManager.get<LastScratchOrgPoolResult>(
    "project",
    scratchOrgPoolCacheKey(getWorkspaceRoot()),
  );
  if (!last || !last.pool || typeof last.pool !== "object") {
    return null;
  }
  return { pool: sanitizeScratchOrgPool(last.pool), readAt: last.readAt };
}

/**
 * Connects to the git provider, then reads the pool once: the secret the connection stores
 * does not start a reading of its own.
 */
async function connectToGit(current: ScratchOrgPoolSession): Promise<void> {
  // Heavy module: loaded when the button is clicked, not with the panel
  const { connectGitProvider } =
    await import("../utils/gitProviders/connectGitProvider");
  let connected: boolean;
  current.changingSecret = true;
  try {
    connected = await connectGitProvider();
  } finally {
    current.changingSecret = false;
  }
  if (connected && session === current && !current.panel.isDisposed()) {
    requestLoad(current);
  }
}

/**
 * Asks the encryption key of the pool in a VS Code password box and stores it as a secret.
 * The key never goes through the webview: the panel only learns its status from sfdx-hardis.
 */
async function setPoolEncryptionKey(
  current: ScratchOrgPoolSession,
): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: t("scratchOrgPoolKeyInputTitle"),
    prompt: t("scratchOrgPoolKeyInputPrompt"),
    password: true,
    ignoreFocusOut: true,
  });
  const key = (value || "").trim();
  if (key === "") {
    return;
  }
  current.changingSecret = true;
  try {
    await storePoolEncryptionKey(key);
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Scratch org pool: encryption key not stored: ${e?.message || e}`,
    );
    vscode.window.showErrorMessage(t("scratchOrgPoolKeyNotStored"));
    return;
  } finally {
    current.changingSecret = false;
  }
  vscode.window.showInformationMessage(t("scratchOrgPoolKeyStored"));
  // Read with the new key, after the reading in progress when there is one
  if (session === current && !current.panel.isDisposed()) {
    requestLoad(current);
  }
}

/**
 * Reads the pool now, or right after the reading in progress: an answer asked before a change
 * of credentials or of the pool is never the one drawn. One reading at most waits.
 */
function requestLoad(current: ScratchOrgPoolSession): void {
  if (current.reading) {
    current.reloadWanted = true;
    return;
  }
  void loadScratchOrgPool(current);
}

/**
 * Reads the pool with sf hardis:scratch:pool:view and pushes it to the panel. The last result
 * is shown while the command runs.
 */
async function loadScratchOrgPool(
  current: ScratchOrgPoolSession,
): Promise<void> {
  const loadId = ++current.loadCounter;
  current.reading = true;
  current.reloadWanted = false;
  pushState(current, { loading: true, error: null });

  let changes: Partial<ScratchOrgPoolPanelState>;
  try {
    changes = await readScratchOrgPool();
  } finally {
    current.reading = false;
  }
  // The panel was opened again or closed meanwhile: only the latest reading is drawn
  if (
    loadId !== current.loadCounter ||
    session !== current ||
    current.panel.isDisposed()
  ) {
    return;
  }
  // Something changed while the pool was read: this answer is not drawn, the pool is read again
  if (current.reloadWanted) {
    void loadScratchOrgPool(current);
    return;
  }
  pushState(current, changes);
}

/**
 * One reading of the pool, as the changes it makes to the state of the panel. It also keeps
 * the last result, or forgets it, and updates the pool line of the status view.
 */
async function readScratchOrgPool(): Promise<
  Partial<ScratchOrgPoolPanelState>
> {
  // Credentials not read in time are not "no credentials": sfdx-hardis would answer that the
  // git provider is not connected, or that the key is missing, and the panel would show it
  let credentials = await collectCredentials();
  if (credentials.timedOut) {
    credentials = await collectCredentials();
  }
  if (credentials.timedOut) {
    Logger.log(
      "[vscode-sfdx-hardis] Scratch org pool not read: provider credentials not collected in time",
    );
    return {
      loading: false,
      error: { kind: "other", message: t("scratchOrgPoolCredentialsTimeout") },
    };
  }
  let result: any;
  try {
    result = await execSfdxJson(buildScratchOrgPoolViewCommand(), {
      cwd: getWorkspaceRoot(),
      fail: false,
      output: false,
      debug: false,
      reuseRecentResult: false,
      // Never the answer of a run started before a change of credentials or of the pool
      shareInFlightRun: false,
      env: credentials.env,
    });
  } catch (e: any) {
    result = { status: 1, message: String(e?.message || e) };
  }
  // Only the outcome is used from here on: the raw answer of an older sfdx-hardis holds the
  // credentials of the pool, and is neither logged nor kept
  const outcome = readScratchOrgPoolOutcome(result);
  const cacheKey = scratchOrgPoolCacheKey(getWorkspaceRoot());
  if ("error" in outcome) {
    Logger.log(
      `[vscode-sfdx-hardis] Scratch org pool not read (${outcome.error.kind}): ${outcome.error.message}`,
    );
    if (
      outcome.error.kind === "noGitProvider" ||
      outcome.error.kind === "other"
    ) {
      // The last result stays on screen under the error
      return { loading: false, error: outcome.error };
    }
    // A project without a pool, or a pool that cannot be described, has nothing left to
    // show, now and the next time the panel opens. The status view reads its line again.
    await CacheManager.delete("project", cacheKey);
    void updateScratchPoolStatus(null);
    return { loading: false, error: outcome.error, pool: null, readAt: null };
  }
  const readAt = new Date().toISOString();
  void CacheManager.set<LastScratchOrgPoolResult>(
    "project",
    cacheKey,
    { pool: outcome.pool, readAt },
    LAST_RESULT_TTL_MS,
  );
  void updateScratchPoolStatus({
    available: outcome.pool.available,
    max: outcome.pool.max,
  });
  return { loading: false, error: null, pool: outcome.pool, readAt };
}

function pushState(
  current: ScratchOrgPoolSession,
  changes: Partial<ScratchOrgPoolPanelState>,
): void {
  Object.assign(current.state, changes);
  current.panel.sendStateUpdate({ ...current.state });
}

async function collectCredentials(): Promise<{
  env: Record<string, string>;
  timedOut: boolean;
}> {
  try {
    return await collectProviderCredentialEnvVarsWithStatus();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Scratch org pool: provider credentials not collected: ${e?.message || e}`,
    );
    return { env: {}, timedOut: false };
  }
}
