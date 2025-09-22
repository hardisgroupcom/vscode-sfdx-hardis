import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { execSfdxJson } from "../utils";
import { Logger } from "../logger";
import { listAllOrgs } from "../utils/orgUtils";

let loadOrgsInProgressPromise: Thenable<any> | null = null;
let loadOrgsQueue: Array<{
all: boolean;
title?: string;
resolve: (value: any) => void;
reject: (error: any) => void;
}> = [];

export function registerShowOrgsManager(commandThis: Commands) {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.openOrgsManager",
      async () => {
        const lwcManager = LwcPanelManager.getInstance();
        // Load orgs using orgUtils
        try {
          const orgs = await loadOrgsWithProgress(
            false,
            "Loading Salesforce orgs...\n(it can be long, make some cleaning to make it faster 🙃)",
          );

          const panel = lwcManager.getOrCreatePanel("s-org-manager", {
            orgs: orgs,
          });
          panel.updateTitle("Orgs Manager");

          // Track the last requested 'all' flag so it persists between operations
          let currentAllFlag = false;

          panel.onMessage(async (type: string, data: any) => {
            if (type === "refreshOrgsFromUi") {
              const allFlag = !!(data && data.all === true);
              currentAllFlag = allFlag;
              const newOrgs = await loadOrgsWithProgress(allFlag);
              panel.sendInitializationData({ orgs: newOrgs });
            } else if (type === "connectOrg") {
              // run hardis:org:select
              const username = data.username;
              const command = `sf hardis:org:select --username "${username || ""}"`;
              commandThis.commandRunner.executeCommand(command);
            } else if (type === "forgetOrgs") {
              try {
                const usernames = data?.usernames || [];
                if (usernames.length === 0) {
                  vscode.window.showInformationMessage(
                    "No orgs selected to forget.",
                  );
                  return;
                }

                const result = await forgetOrgsWithProgress(
                  usernames,
                  `Forgetting ${usernames.length} org(s)...`,
                );

                // send back result and refresh list
                const newOrgs = await loadOrgsWithProgress(currentAllFlag);
                panel.sendInitializationData({ orgs: newOrgs });
                vscode.window.showInformationMessage(
                  `Forgot ${result.successUsernames.length} org(s).`,
                );
              } catch (error: any) {
                vscode.window.showErrorMessage(
                  `Error forgetting orgs: ${error?.message || error}`,
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
                vscode.window.showInformationMessage(
                  "No recommended orgs found to remove.",
                );
                return;
              }

              try {
                const confirm = await vscode.window.showWarningMessage(
                  `This will forget ${usernames.length} orgs (disconnected, deleted or expired). Are you sure?`,
                  {},
                  "Yes",
                  "No",
                );
                if (confirm !== "Yes") {
                  return;
                }

                const result = await forgetOrgsWithProgress(
                  usernames,
                  `Forgetting ${usernames.length} recommended org(s)...`,
                );
                vscode.window.showInformationMessage(
                  `Forgot ${result.successUsernames.length} recommended org(s).`,
                );
                const newOrgs = await loadOrgsWithProgress(currentAllFlag);
                panel.sendInitializationData({ orgs: newOrgs });
              } catch (error: any) {
                vscode.window.showErrorMessage(
                  `Error removing recommended orgs: ${error?.message || error}`,
                );
              }
            } else if (type === "saveAliases") {
              try {
                const { aliasChanges } = data;

                if (!aliasChanges || aliasChanges.length === 0) {
                  vscode.window.showInformationMessage(
                    "No alias changes to save.",
                  );
                  return;
                }

                // Execute all sf alias set commands in parallel with progress
                await vscode.window.withProgress(
                  {
                    location: vscode.ProgressLocation.Notification,
                    title: `Setting ${aliasChanges.length} alias(es)...`,
                    cancellable: false,
                  },
                  async () => {
                    const aliasCommands = aliasChanges.map(
                      (change: { username: string; alias: string }) => {
                        const alias = change.alias.trim();
                        if (alias) {
                          return execSfdxJson(
                            `sf alias set ${alias}=${change.username}`,
                          );
                        } else {
                          // If alias is empty, unset it
                          return execSfdxJson(
                            `sf alias unset ${change.username}`,
                          );
                        }
                      },
                    );

                    await Promise.all(aliasCommands);
                  },
                );

                vscode.window.showInformationMessage(
                  `Successfully updated ${aliasChanges.length} alias(es)`,
                );

                // Refresh the orgs list to show the updated aliases
                const newOrgs = await loadOrgsWithProgress(currentAllFlag);
                panel.sendInitializationData({ orgs: newOrgs });
              } catch (error: any) {
                vscode.window.showErrorMessage(
                  `Error setting aliases: ${error?.message || error}`,
                );
              }
            }
          });
        } catch (error: any) {
          Logger.log("Error opening orgs manager:\n" + JSON.stringify(error));
          vscode.window.showErrorMessage(
            "Failed to open Org Manager: " + (error?.message || error),
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
            message: `Forgetting ${u} (${i + 1}/${total})`,
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

  // Helper: load orgs with a progress notification; preserves return value from listAllOrgs(all)
  // Prevents multiple simultaneous progress notifications by queuing requests
  async function loadOrgsWithProgress(
    all: boolean = false,
    title?: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // Add this request to the queue
      loadOrgsQueue.push({ all, title, resolve, reject });

      // If there's already a load in progress, just wait for it
      if (loadOrgsInProgressPromise) {
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

    // Get the latest request from the queue (use the most recent parameters)
    const latestRequest = loadOrgsQueue[loadOrgsQueue.length - 1];
    const allQueuedRequests = [...loadOrgsQueue];
    loadOrgsQueue = []; // Clear the queue

    const title =
      latestRequest.title ||
      (latestRequest.all
        ? "Loading all Salesforce orgs..."
        : "Loading Salesforce orgs...");

    // Create the progress notification with the latest request's parameters
    loadOrgsInProgressPromise = vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: title,
        cancellable: false,
      },
      async () => {
        return await listAllOrgs(latestRequest.all);
      },
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