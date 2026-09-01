import * as vscode from "vscode";
import { Commands } from "../commands";
import { getPythonCommand, getWorkspaceRoot } from "../utils";
import { ping } from "../utils/httpUtils";
import { checkMkDocsConfig } from "../utils/mkdocsUtils";
import { t } from "../i18n/i18n";

const DOC_SERVER_URL = "http://localhost:8000";
const POLL_INTERVAL_MS = 3000;
// Installing Zensical and building a large site takes a while, so the wait is
// generous. What matters is that it ENDS, with a hint, instead of spinning for
// ever on a server that already died in the terminal.
const SLOW_HINT_AFTER_MS = 45000;
// Zensical reports nothing between "Build started" and "Build finished", so
// there is no progress to read and no way to tell a slow build from a dead one.
// A large project (7000+ markdown pages is realistic for a monitoring
// repository) can build for a long time, so the wait is never ended for the
// user: after this delay they are ASKED, and can keep waiting.
const ASK_AGAIN_AFTER_MS = 300000;

const REGENERATE_DOC_COMMAND = "sf hardis:doc:project2markdown";

/**
 * Report a blocking mkdocs.yml before starting the server, with the command that
 * repairs it, rather than letting Zensical fail in the terminal while the
 * notification keeps saying "Starting...".
 */
function reportConfigProblem(
  message: string,
  buttons: { regenerate?: boolean } = {},
): void {
  const actions: string[] = [];
  if (buttons.regenerate) {
    actions.push(t("regenerateDocumentation"));
  }
  actions.push(t("openOnlineHelp"));
  vscode.window.showErrorMessage(message, ...actions).then((selection) => {
    if (selection === t("regenerateDocumentation")) {
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.execute-command",
        REGENERATE_DOC_COMMAND,
      );
    } else if (selection === t("openOnlineHelp")) {
      vscode.env.openExternal(
        vscode.Uri.parse(
          "https://sfdx-hardis.cloudity.com/salesforce-project-doc-generate/",
        ),
      );
    }
  });
}

export async function registerRunLocalHtmlDocPages(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.runLocalHtmlDocPages",
    async () => {
      // The checks below are not instant: getPythonCommand() spawns probe
      // processes on the low priority shell queue, so it can wait behind
      // background work. Say what is going on instead of leaving the click
      // without feedback.
      //
      // The configuration is checked FIRST, on purpose: it needs no process at
      // all, so the common answer (menus Zensical cannot read) comes back
      // immediately instead of after the Python probe.
      const preflight = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("checkingDocPrerequisites"),
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: t("checkingDocumentationConfig") });
          const configCheck = await checkMkDocsConfig(getWorkspaceRoot());
          if (configCheck.status !== "ok") {
            // Nothing to run: no need to look for Python
            return { configCheck, pythonCommand: null };
          }
          progress.report({ message: t("checkingPythonInstallation") });
          const pythonCommand = await getPythonCommand();
          return { configCheck, pythonCommand };
        },
      );

      const { configCheck } = preflight;
      if (configCheck.status === "missing") {
        reportConfigProblem(`🦙 ${t("mkdocsYmlNotFound")}`, {
          regenerate: true,
        });
        return;
      }
      if (configCheck.status === "unreadable") {
        reportConfigProblem(
          `🦙 ${t("mkdocsYmlUnreadable", { message: configCheck.message })}`,
        );
        return;
      }
      if (configCheck.status === "legacyNav") {
        // A generated site has a dozen or more affected menus: name a few so the
        // message stays readable, and say how many others there are
        const shownMenus = configCheck.menus.slice(0, 5);
        const remaining = configCheck.menus.length - shownMenus.length;
        const menus =
          remaining > 0
            ? `${shownMenus.join(", ")} (+${remaining})`
            : shownMenus.join(", ");
        reportConfigProblem(
          `🦙 ${t("mkdocsYmlLegacyNav", {
            menus,
            command: REGENERATE_DOC_COMMAND,
          })}`,
          { regenerate: true },
        );
        return;
      }

      const pythonCommand = preflight.pythonCommand;
      if (!pythonCommand) {
        const downloadLabel = t("downloadAndInstallPython");
        vscode.window
          .showErrorMessage(`🦙 ${t("pythonNotInstalled")}`, downloadLabel)
          .then((selection) => {
            if (selection === downloadLabel) {
              vscode.env.openExternal(
                vscode.Uri.parse("https://www.python.org/downloads/"),
              );
            }
          });
        return;
      }

      // Zensical is the successor of mkdocs-material, and reads the same mkdocs.yml file
      const command = `${pythonCommand} -m pip install zensical mdx_truly_sane_lists && ${pythonCommand} -m zensical serve`;
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.execute-command",
        command,
      );
      // Display a progress vscode UI message while the server starts (check that the server is started by pinging localhost:8000)
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("startingLocalDocServer"),
          cancellable: true,
        },
        async (progress, token) => {
          return new Promise<void>((resolve) => {
            const startedAt = Date.now();
            let isResolved = false;
            let slowHintShown = false;
            let waitUntil = ASK_AGAIN_AFTER_MS;
            let interval: ReturnType<typeof setInterval>;

            const stop = () => {
              isResolved = true;
              clearInterval(interval);
            };

            const askWhetherToKeepWaiting = () => {
              const keepWaitingLabel = t("keepWaiting");
              vscode.window
                .showWarningMessage(
                  `🦙 ${t("docServerNotStartedYet")}`,
                  keepWaitingLabel,
                  t("showTerminal"),
                )
                .then((selection) => {
                  if (selection === keepWaitingLabel) {
                    // Another window, counted from now
                    waitUntil = Date.now() - startedAt + ASK_AGAIN_AFTER_MS;
                    isResolved = false;
                    interval = setInterval(poll, POLL_INTERVAL_MS);
                  }
                  else if (selection === t("showTerminal")) {
                    vscode.commands.executeCommand(
                      "workbench.action.terminal.focus",
                    );
                  }
                });
            };

            const poll = () => {
              const elapsed = Date.now() - startedAt;
              if (!slowHintShown && elapsed > SLOW_HINT_AFTER_MS) {
                slowHintShown = true;
                progress.report({ message: t("docServerStillStarting") });
              }
              if (elapsed > waitUntil) {
                // Zensical prints nothing while it builds, so a silent server
                // is not proof of a failure. Ask rather than declare one.
                if (!isResolved) {
                  stop();
                  askWhetherToKeepWaiting();
                  resolve();
                }
                return;
              }
              ping(DOC_SERVER_URL, { timeoutMs: 2000 })
                .then(() => {
                  if (!isResolved) {
                    stop();
                    progress.report({ message: t("localDocServerRunning") });
                    vscode.env.openExternal(vscode.Uri.parse(DOC_SERVER_URL));
                    resolve();
                  }
                })
                .catch(() => {
                  // Server not started yet or not reachable
                });
            };

            interval = setInterval(poll, POLL_INTERVAL_MS);
            token.onCancellationRequested(() => {
              if (!isResolved) {
                stop();
                resolve();
              }
            });
          });
        },
      );
    },
  );
  commands.disposables.push(disposable);
}
