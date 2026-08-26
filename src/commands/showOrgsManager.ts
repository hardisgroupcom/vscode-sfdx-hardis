import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { execSfdxJson } from "../utils";
import { Logger } from "../logger";
import { listAllOrgs, SalesforceOrg } from "../utils/orgUtils";
import { t } from "../i18n/i18n";

type LoadOrgsRequest = {
  all: boolean;
  skipConnectionStatus: boolean;
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

let loadOrgsInProgressPromise: Thenable<any> | null = null;
let loadOrgsQueue: LoadOrgsRequest[] = [];
// Increments on every new load sequence so a stale two-phase load (for example
// a refresh started while the previous one was still probing the orgs) never
// overwrites fresher rows.
let loadSequence = 0;

export function registerShowOrgsManager(commandThis: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.openOrgsManager",
    async () => {
      const lwcManager = LwcPanelManager.getInstance();
      let orgs: SalesforceOrg[] = [];
      try {
        // Open the panel immediately with a loading flag so the LWC can render
        // a spinner while orgs are fetched asynchronously.
        const panel = lwcManager.getOrCreatePanel("s-org-manager", {
          orgs: [],
          loading: true,
        });
        panel.updateTitle(t("orgsManager"));

        // Track the last requested 'all' flag so it persists between operations
        let currentAllFlag = false;

        // Two-phase load: the rows appear as soon as the local auth files are
        // read (connection badge = "Checking..."), then the connection status
        // of every org is probed and the rows are refreshed in place.
        const loadAndPushOrgs = async (
          all: boolean,
          forceReload: boolean,
        ): Promise<void> => {
          const sequence = ++loadSequence;
          panel.sendInitializationData({ loading: true });
          try {
            const pendingOrgs = await loadOrgsWithProgress(
              all,
              forceReload,
              true,
            );
            if (sequence !== loadSequence) {
              return;
            }
            panel.sendInitializationData({
              orgs: [...pendingOrgs],
              loading: false,
            });
            const completeOrgs = await loadOrgsWithProgress(all, forceReload);
            if (sequence !== loadSequence) {
              return;
            }
            orgs = completeOrgs;
            panel.sendInitializationData({
              orgs: [...orgs],
              loading: false,
            });
          } catch (error) {
            if (sequence === loadSequence) {
              panel.sendInitializationData({ loading: false });
            }
            throw error;
          }
        };

        // Kick off the initial load in the background; the spinner stays up
        // until the first rows are sent to the panel.
        loadAndPushOrgs(false, false).catch((error: any) => {
          panel.sendInitializationData({ orgs: [], loading: false });
          vscode.window.showErrorMessage(
            t("failedToOpenOrgManager", { error: error?.message || error }),
          );
        });

        // Reload after an operation that changed the auth files (forget, alias)
        const reloadAfterChange = () => {
          setTimeout(() => {
            loadAndPushOrgs(currentAllFlag, true).catch((error: any) => {
              Logger.log(
                `Error reloading orgs: ${error?.message || JSON.stringify(error)}`,
              );
            });
          }, 1000);
        };

        panel.onMessage(async (type: string, data: any) => {
          if (type === "refreshOrgsFromUi") {
            const allFlag = !!(data && data.all === true);
            currentAllFlag = allFlag;
            await loadAndPushOrgs(allFlag, false);
          } else if (type === "connectOrg") {
            // run hardis:org:select to reconnect a disconnected org
            const username = data.username;
            const instanceUrl = data.instanceUrl;
            let command = `sf hardis:org:select --username "${username || ""}" --reconnect --no-set-default`;
            if (instanceUrl) {
              command += ` --instance-url "${instanceUrl}"`;
            }
            commandThis.commandRunner.executeCommand(command);
          } else if (type === "forgetOrgs") {
            try {
              const usernames = data?.usernames || [];
              if (usernames.length === 0) {
                vscode.window.showInformationMessage(
                  t("noOrgsSelectedToForget"),
                );
                return;
              }

              const result = await forgetOrgsWithProgress(
                usernames,
                t("forgettingNOrgs", { count: usernames.length }),
              );
              reloadAfterChange();
              vscode.window.showInformationMessage(
                t("forgotNOrgs", { count: result.successUsernames.length }),
              );
            } catch (error: any) {
              vscode.window.showErrorMessage(
                t("errorForgettingOrgs", { error: error?.message || error }),
              );
            }
          } else if (type === "removeRecommended") {
            // If LWC sent usernames, use them; otherwise fallback to detection
            let usernames: string[] = [];
            if (
              data &&
              Array.isArray(data.usernames) &&
              data.usernames.length > 0
            ) {
              usernames = data.usernames.filter(Boolean);
            }
            if (usernames.length === 0) {
              vscode.window.showInformationMessage(t("noRecommendedOrgsFound"));
              return;
            }
            try {
              const confirm = await vscode.window.showWarningMessage(
                t("confirmForgetNOrgs", { count: usernames.length }),
                {},
                t("yesLabel"),
                t("noLabel"),
              );
              if (confirm !== t("yesLabel")) {
                return;
              }
              const result = await forgetOrgsWithProgress(
                usernames,
                t("forgettingNOrgs", { count: usernames.length }),
              );
              vscode.window.showInformationMessage(
                t("forgotNRecommendedOrgs", {
                  count: result.successUsernames.length,
                }),
              );
              reloadAfterChange();
            } catch (error: any) {
              vscode.window.showErrorMessage(
                t("errorRemovingRecommendedOrgs", {
                  error: error?.message || error,
                }),
              );
            }
          } else if (type === "saveAliases") {
            try {
              const { aliasChanges } = data;
              if (!aliasChanges || aliasChanges.length === 0) {
                vscode.window.showInformationMessage(t("noAliasChangesToSave"));
                return;
              }
              // Execute all sf alias set commands in parallel with progress
              await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: t("settingNAliases", { count: aliasChanges.length }),
                  cancellable: false,
                },
                async () => {
                  const prevOrgs = [...orgs];
                  for (const change of aliasChanges) {
                    const alias = change.alias.trim();
                    const existingOrg = prevOrgs.find(
                      (o) => o.username === change.username,
                    );
                    if (alias) {
                      // If username found in prevOrgs, unset its alias first to avoid duplicates
                      if (existingOrg && existingOrg.alias) {
                        await execSfdxJson(
                          `sf alias unset ${existingOrg.alias}`,
                        );
                      }
                      await execSfdxJson(
                        `sf alias set ${alias}=${change.username}`,
                      );
                    } else {
                      // If alias is empty, unset it
                      if (existingOrg && existingOrg.alias) {
                        await execSfdxJson(
                          `sf alias unset ${existingOrg.alias}`,
                        );
                      }
                    }
                  }
                },
              );
              vscode.window.showInformationMessage(
                t("successfullyUpdatedNAliases", {
                  count: aliasChanges.length,
                }),
              );
              // Refresh the orgs list to show the updated aliases
              reloadAfterChange();
            } catch (error: any) {
              vscode.window.showErrorMessage(
                t("errorSettingAliases", { error: error?.message || error }),
              );
            }
          }
        });
      } catch (error: any) {
        Logger.log("Error opening orgs manager:\n" + JSON.stringify(error));
        vscode.window.showErrorMessage(
          t("failedToOpenOrgManager", { error: error?.message || error }),
        );
      }
    },
  );
  commandThis.disposables.push(disposable);
}

// Helper: forget given org usernames with a VS Code progress notification and per-org steps
async function forgetOrgsWithProgress(usernames: string[], title: string) {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: title,
      cancellable: true,
    },
    async (progress, token) => {
      const successUsernames: string[] = [];
      const errorUsernames: string[] = [];
      const total = usernames.length;
      let cancelled = false;
      // When the user cancels, set a flag so we stop after the current iteration
      token.onCancellationRequested(() => {
        cancelled = true;
      });
      for (let i = 0; i < total; i++) {
        if (cancelled) {
          // Stop processing further orgs when cancelled by the user
          break;
        }
        const u = usernames[i];
        const increment = Math.round(100 / total);
        progress.report({
          message: t("forgettingOrgProgress", {
            username: u,
            current: i + 1,
            total,
          }),
          increment,
        });
        try {
          await execSfdxJson(`sf org logout --target-org ${u} --noprompt`);
          successUsernames.push(u);
        } catch (err) {
          void err;
          errorUsernames.push(u);
        }
      }
      return { successUsernames, errorUsernames, cancelled };
    },
  );
}

// Helper: load orgs without a VS Code progress notification (the org manager
// LWC renders its own spinner). Deduplicates concurrent requests via a queue.
async function loadOrgsWithProgress(
  all: boolean = false,
  forceReload: boolean = false,
  skipConnectionStatus: boolean = false,
): Promise<SalesforceOrg[]> {
  return new Promise((resolve, reject) => {
    // Add this request to the queue
    loadOrgsQueue.push({ all, skipConnectionStatus, resolve, reject });
    // If forceReload is true, cancel any in-progress operation and force a new load
    if (forceReload && loadOrgsInProgressPromise) {
      // Mark the current promise as cancelled by setting it to null
      // The new processLoadOrgsQueue will pick up all queued requests
      loadOrgsInProgressPromise = null;
    }
    // If there's already a load in progress and we're not forcing reload, just wait for it
    if (loadOrgsInProgressPromise && !forceReload) {
      return;
    }
    // Start processing the queue
    processLoadOrgsQueue();
  });
}

async function processLoadOrgsQueue(): Promise<void> {
  if (loadOrgsQueue.length === 0 || loadOrgsInProgressPromise) {
    return;
  }
  // Get the latest request from the queue (use the most recent parameters).
  // A complete list satisfies a pending "local only" request too, but not the
  // other way around: as soon as one queued request needs the connection
  // status, the whole batch is loaded with it.
  const latestRequest = loadOrgsQueue[loadOrgsQueue.length - 1];
  const allQueuedRequests = [...loadOrgsQueue];
  loadOrgsQueue = []; // Clear the queue
  const skipConnectionStatus = allQueuedRequests.every(
    (request) => request.skipConnectionStatus,
  );
  loadOrgsInProgressPromise = listAllOrgs(
    latestRequest.all,
    false,
    skipConnectionStatus,
  );

  try {
    // Wait for the actual loading to complete
    const result = await loadOrgsInProgressPromise;
    // Resolve all queued requests with the same result
    allQueuedRequests.forEach((request) => {
      request.resolve(result);
    });
  } catch (error) {
    // Reject all queued requests with the same error
    allQueuedRequests.forEach((request) => {
      request.reject(error);
    });
  } finally {
    // Clear the progress promise
    loadOrgsInProgressPromise = null;
    // Process any new requests that may have been queued while we were loading
    if (loadOrgsQueue.length > 0) {
      // Use setTimeout to avoid potential stack overflow with recursive calls
      setTimeout(() => processLoadOrgsQueue(), 0);
    }
  }
}
