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
import { collectProviderCredentialEnvVars } from "../utils/providerCredentials";
import { hasGitProviderToken } from "../utils/backpromote/backpromotePanelUtils";
// jscpd:ignore-end
import {
  DORA_DEFAULT_PERIOD,
  DORA_PERIODS,
  DoraPanelError,
  buildDoraExportCommand,
  buildDoraReportCommand,
  doraCacheKey,
  normalizeDoraPeriod,
  readDoraOutcome,
  sanitizeDoraReport,
} from "../utils/doraReportUtils";

const DORA_LWC_ID = "s-dora-metrics";
// The last result is only what the panel shows while sfdx-hardis reads the git provider again
const LAST_RESULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  azure: "Azure DevOps",
  bitbucket: "Bitbucket",
  gitea: "Gitea",
};

// Everything the webview draws. The whole state is sent at every change.
interface DoraPanelState {
  period: number;
  periods: number[];
  // sfdx-hardis is reading the git provider. With a report, the report is the last one kept
  loading: boolean;
  report: any | null;
  // When the report shown was read
  readAt: string | null;
  providerLabel: string;
  // Tab to open: "overview", "contributors" or the name of a major branch
  tab: string | null;
  // Branch of the pipeline flow whose waiting changes are listed when the panel opens
  waiting: string | null;
  // sfdx-hardis version the panel asks for when the installed one is too old
  minimalCliVersion: string;
  error: DoraPanelError | null;
}

interface LastDoraResult {
  report: any;
  readAt: string;
}

interface DoraPanelSession {
  panel: LwcUiPanel;
  state: DoraPanelState;
  loadCounter: number;
}

// Period chosen in the panel, remembered until VS Code is closed
let sessionPeriod = DORA_DEFAULT_PERIOD;
let session: DoraPanelSession | null = null;

export function registerShowDoraMetrics(commands: Commands) {
  // A git provider connected elsewhere (DevOps Pipeline) while the panel waits for a token:
  // the metrics are read at once
  SecretsManager.onSecretChanged(() => {
    const current = session;
    if (
      current &&
      !current.panel.isDisposed() &&
      !current.state.loading &&
      current.state.error?.kind === "noGitProvider"
    ) {
      void loadDoraMetrics(current, false);
    }
  });

  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showDoraMetrics",
    async (args?: { period?: number; tab?: string; waiting?: string }) => {
      if (args?.period !== undefined) {
        sessionPeriod = normalizeDoraPeriod(args.period);
      }
      // The panel opens at once, on the last result when there is one
      const state = initialState(sessionPeriod);
      state.tab = typeof args?.tab === "string" ? args.tab.slice(0, 250) : null;
      state.waiting =
        typeof args?.waiting === "string" ? args.waiting.slice(0, 250) : null;
      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        DORA_LWC_ID,
        state,
      );
      panel.updateTitle(t("doraMetrics"));
      const current: DoraPanelSession = { panel, state, loadCounter: 0 };
      session = current;

      panel.onMessage(async (type: string, data: any) => {
        if (type === "loadDoraMetrics") {
          sessionPeriod = normalizeDoraPeriod(data?.period ?? sessionPeriod);
          await loadDoraMetrics(current, data?.refresh === true);
        } else if (type === "connectToGit") {
          // Heavy module: loaded when the button is clicked, not with the panel
          const { connectGitProvider } =
            await import("../utils/gitProviders/connectGitProvider");
          if (await connectGitProvider()) {
            await loadDoraMetrics(current, false);
          }
        } else if (type === "exportDoraReport") {
          // The real report command, with its files and its notification, in the command runner
          vscode.commands.executeCommand(
            "vscode-sfdx-hardis.execute-command",
            buildDoraExportCommand(
              current.state.period,
              data?.format === "pdf",
            ),
          );
        }
      });

      void resolveProviderLabel().then((providerLabel) => {
        if (providerLabel && session === current) {
          pushState(current, { providerLabel });
        }
      });
      void loadDoraMetrics(current, false);
    },
  );
  commands.disposables.push(disposable);
}

function initialState(period: number): DoraPanelState {
  const last = readLastResult(period);
  return {
    period,
    periods: [...DORA_PERIODS],
    loading: true,
    report: last?.report || null,
    readAt: last?.readAt || null,
    providerLabel: "",
    tab: null,
    waiting: null,
    minimalCliVersion: RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
    error: null,
  };
}

/**
 * Reads the metrics of the period chosen with sf hardis:doc:dora-report and pushes them to the
 * panel. The last result of that period is shown while the command runs.
 */
async function loadDoraMetrics(
  current: DoraPanelSession,
  refresh: boolean,
): Promise<void> {
  const loadId = ++current.loadCounter;
  const period = sessionPeriod;
  const last = period === current.state.period ? null : readLastResult(period);
  pushState(current, {
    period,
    loading: true,
    error: null,
    ...(period === current.state.period
      ? {}
      : { report: last?.report || null, readAt: last?.readAt || null }),
  });

  const env = await collectCredentialEnv();
  let result: any;
  try {
    result = await execSfdxJson(buildDoraReportCommand(period, { refresh }), {
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
  // The period changed meanwhile, or the panel was opened again or closed
  if (
    loadId !== current.loadCounter ||
    session !== current ||
    current.panel.isDisposed()
  ) {
    return;
  }
  const outcome = readDoraOutcome(
    result,
    hasGitProviderToken({ ...process.env, ...env }),
  );
  if ("error" in outcome) {
    Logger.log(
      `[vscode-sfdx-hardis] DORA metrics not read (${outcome.error.kind}): ${outcome.error.message}`,
    );
    // The last result, when there is one, stays on screen under the error
    pushState(current, { loading: false, error: outcome.error });
    return;
  }
  const readAt = new Date().toISOString();
  void CacheManager.set<LastDoraResult>(
    "project",
    doraCacheKey(getWorkspaceRoot(), period),
    { report: outcome.report, readAt },
    LAST_RESULT_TTL_MS,
  );
  pushState(current, {
    loading: false,
    error: null,
    report: outcome.report,
    readAt,
  });
}

function pushState(
  current: DoraPanelSession,
  changes: Partial<DoraPanelState>,
): void {
  Object.assign(current.state, changes);
  current.panel.sendStateUpdate({ ...current.state });
}

function readLastResult(period: number): LastDoraResult | null {
  const last = CacheManager.get<LastDoraResult>(
    "project",
    doraCacheKey(getWorkspaceRoot(), period),
  );
  if (!last || !Array.isArray(last.report?.branches)) {
    return null;
  }
  return { report: sanitizeDoraReport(last.report), readAt: last.readAt };
}

async function collectCredentialEnv(): Promise<Record<string, string>> {
  try {
    return await collectProviderCredentialEnvVars();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] DORA metrics: provider credentials not collected: ${e?.message || e}`,
    );
    return {};
  }
}

/** Name of the git provider of the repository, for the loading message: read from the git remote */
async function resolveProviderLabel(): Promise<string> {
  try {
    const gitProviderModule = await import("../utils/gitProviders/gitProvider");
    const repoInfo = await gitProviderModule.GitProvider.detectRepoInfo();
    return PROVIDER_LABELS[repoInfo?.providerName || ""] || "";
  } catch {
    return "";
  }
}
