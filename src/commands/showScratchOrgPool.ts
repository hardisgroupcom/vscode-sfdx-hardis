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
import {
  collectProviderCredentialEnvVars,
  storePoolEncryptionKey,
} from "../utils/providerCredentials";
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
}

let session: ScratchOrgPoolSession | null = null;

export function registerShowScratchOrgPool(commands: Commands) {
  // A git provider connected or an encryption key stored elsewhere while the panel waits
  // for one: the pool is read at once
  SecretsManager.onSecretChanged(() => {
    const current = session;
    if (
      current &&
      !current.panel.isDisposed() &&
      !current.state.loading &&
      isWaitingForSecret(current.state)
    ) {
      void loadScratchOrgPool(current);
    }
  });

  // A command that changes the pool ended in the command runner: the pool is read again
  commands.disposables.push(
    onCommandCompleted((command) => {
      const current = session;
      if (
        current &&
        !current.panel.isDisposed() &&
        isScratchOrgPoolCommand(command)
      ) {
        void loadScratchOrgPool(current);
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
      const current: ScratchOrgPoolSession = { panel, state, loadCounter: 0 };
      session = current;

      panel.onMessage(async (type: string) => {
        if (type === "loadScratchOrgPool") {
          await loadScratchOrgPool(current);
        } else if (type === "connectToGit") {
          // Heavy module: loaded when the button is clicked, not with the panel
          const { connectGitProvider } =
            await import("../utils/gitProviders/connectGitProvider");
          if (await connectGitProvider()) {
            await loadScratchOrgPool(current);
          }
        } else if (type === "setPoolEncryptionKey") {
          await setPoolEncryptionKey(current);
        }
      });

      void loadScratchOrgPool(current);
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
  try {
    await storePoolEncryptionKey(key);
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Scratch org pool: encryption key not stored: ${e?.message || e}`,
    );
    vscode.window.showErrorMessage(t("scratchOrgPoolKeyNotStored"));
    return;
  }
  vscode.window.showInformationMessage(t("scratchOrgPoolKeyStored"));
  // A panel that was waiting for the key is already reading the pool again
  if (
    session === current &&
    !current.panel.isDisposed() &&
    !current.state.loading
  ) {
    await loadScratchOrgPool(current);
  }
}

/**
 * Reads the pool with sf hardis:scratch:pool:view and pushes it to the panel. The last result
 * is shown while the command runs.
 */
async function loadScratchOrgPool(
  current: ScratchOrgPoolSession,
): Promise<void> {
  const loadId = ++current.loadCounter;
  pushState(current, { loading: true, error: null });

  const env = await collectCredentialEnv();
  let result: any;
  try {
    result = await execSfdxJson(buildScratchOrgPoolViewCommand(), {
      cwd: getWorkspaceRoot(),
      fail: false,
      output: false,
      debug: false,
      reuseRecentResult: false,
      env,
    });
  } catch (e: any) {
    result = { status: 1, message: String(e?.message || e) };
  }
  // The pool was asked again meanwhile, or the panel was opened again or closed
  if (
    loadId !== current.loadCounter ||
    session !== current ||
    current.panel.isDisposed()
  ) {
    return;
  }
  // Only the outcome is used from here on: the raw answer of an older sfdx-hardis holds the
  // credentials of the pool, and is neither logged nor kept
  const outcome = readScratchOrgPoolOutcome(result);
  if ("error" in outcome) {
    Logger.log(
      `[vscode-sfdx-hardis] Scratch org pool not read (${outcome.error.kind}): ${outcome.error.message}`,
    );
    // A project without a pool, or a pool that cannot be described, has nothing left to show
    const keepsLastPool =
      outcome.error.kind === "noGitProvider" || outcome.error.kind === "other";
    pushState(current, {
      loading: false,
      error: outcome.error,
      ...(keepsLastPool ? {} : { pool: null, readAt: null }),
    });
    return;
  }
  const readAt = new Date().toISOString();
  void CacheManager.set<LastScratchOrgPoolResult>(
    "project",
    scratchOrgPoolCacheKey(getWorkspaceRoot()),
    { pool: outcome.pool, readAt },
    LAST_RESULT_TTL_MS,
  );
  pushState(current, {
    loading: false,
    error: null,
    pool: outcome.pool,
    readAt,
  });
}

function pushState(
  current: ScratchOrgPoolSession,
  changes: Partial<ScratchOrgPoolPanelState>,
): void {
  Object.assign(current.state, changes);
  current.panel.sendStateUpdate({ ...current.state });
}

async function collectCredentialEnv(): Promise<Record<string, string>> {
  try {
    return await collectProviderCredentialEnvVars();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Scratch org pool: provider credentials not collected: ${e?.message || e}`,
    );
    return {};
  }
}
