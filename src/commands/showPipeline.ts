import * as vscode from "vscode";
import { PipelineDataProvider } from "../pipeline-data-provider";
import { getPullRequestButtonInfo } from "../utils/gitPrButtonUtils";
import { Logger } from "../logger";
import { SecretsManager } from "../utils/secretsManager";
import { GitProvider } from "../utils/gitProviders/gitProvider";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";
import { getWorkspaceRoot } from "../utils";

export function registerShowPipeline(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showPipeline",
    async () => {
      // Show progress while loading config editor input
      const pipelineData = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading pipeline information...",
          cancellable: false,
        },
        async () => {
          const pipelineDataProvider = new PipelineDataProvider();
          return await pipelineDataProvider.getPipelineData();
        },
      );

      // Calculate PR button info using utility
      const repoPath = getWorkspaceRoot();
      let prButtonInfo = null;
      try {
        prButtonInfo = await getPullRequestButtonInfo(repoPath);
      } catch (e) {
        Logger.log("Error getting PR button info:\n" + JSON.stringify(e));
      }

      // Try to detect repository host and a sensible default provider to prefill the modal
      let guessedHost: string | undefined = undefined;
      try {
        guessedHost = await GitProvider.detectRepoHost(repoPath);
      } catch (err) {
        // Non-fatal — keep guessing disabled if detection fails
        Logger.log("Could not detect repo host: " + String(err));
      }

      // Guess provider by host (simple heuristic)
      let guessedProvider = "gitlab";
      if (guessedHost) {
        const hostLower = guessedHost.toLowerCase();
        if (hostLower.includes("github")) {
          guessedProvider = "github";
        } else if (hostLower.includes("bitbucket")) {
          guessedProvider = "bitbucket";
        } else if (hostLower.includes("azure")) {
          guessedProvider = "azure";
        } else if (hostLower.includes("gitlab")) {
          guessedProvider = "gitlab";
        }
      }

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline",
        { pipelineData: pipelineData, prButtonInfo, defaultGitProvider: guessedProvider, defaultGitHost: guessedHost },
      );
      panel.updateTitle("DevOps Pipeline");

      // Register message handler for refreshpipeline, runCommand and saveGitCredentials
      panel.onMessage(async (type, data) => {
        if (type === "requestNativeAuth") {
          const { provider } = data || {};
          try {
            if (!provider) {
              throw new Error("Missing provider for native auth request");
            }

            if (provider === "github") {
              // Ask VS Code for GitHub session (requires GitHub Authentication extension or built-in support)
              const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
              if (!session) {
                throw new Error("GitHub authentication cancelled or unavailable");
              }
              // Persist token securely
              const sanitizedHost = "github_com";
              const secretPrefix = `git.${sanitizedHost}.github`;
              await SecretsManager.setSecret(`${secretPrefix}.token`, session.accessToken);
              await SecretsManager.setSecret(`${secretPrefix}.host`, "github.com");
              // Notify webview
              vscode.window.showInformationMessage(`Git credentials for ${provider} saved successfully.`);
              panel.sendMessage({ type: "gitCredentialsSaved", data: { provider: "github", host: "github.com" } });
            } else if (provider === "azure") {
              // Try Microsoft account provider (may be 'microsoft')
              const session = await vscode.authentication.getSession("microsoft", [], { createIfNone: true });
              if (!session) {
                throw new Error("Microsoft authentication cancelled or unavailable");
              }
              const sanitizedHost = "microsoft";
              const secretPrefix = `git.${sanitizedHost}.azure`;
              await SecretsManager.setSecret(`${secretPrefix}.token`, session.accessToken);
              await SecretsManager.setSecret(`${secretPrefix}.host`, "microsoft");
              vscode.window.showInformationMessage(`Git credentials for ${provider} saved successfully.`);
              panel.sendMessage({ type: "gitCredentialsSaved", data: { provider: "azure", host: "microsoft" } });
            } else {
              vscode.window.showErrorMessage(`Native authentication not supported for provider: ${provider}`);
              panel.sendMessage({ type: "gitCredentialsSaveError", data: { error: "Native auth not supported for provider" } });
            }
          } catch (err) {
            Logger.log("Native auth error: " + String(err));
            vscode.window.showErrorMessage(`Error during native authentication: ${String(err)}`);
            panel.sendMessage({ type: "gitCredentialsSaveError", data: { error: String(err) } });
          }
          return;
        }
        if (type === "refreshpipeline") {
          const provider = new PipelineDataProvider();
          const newData = await provider.getPipelineData();
          panel.sendInitializationData({
            pipelineData: newData,
            prButtonInfo,
            defaultGitProvider: guessedProvider,
            defaultGitHost: guessedHost,
          });
        } else if (type === "showPackageXml") {
          // Handle package XML display requests from pipeline
          await showPackageXmlPanel(data);
        } else if (type === "saveGitCredentials") {
          try {
            // Store credentials securely via SecretsManager
            const { provider, host, username, token, validateHost } = data || {};
            if (!provider) {
              throw new Error("Missing provider in saveGitCredentials payload");
            }
            // If requested, validate host reachability before saving
            if (validateHost && host) {
              const isReachable = await (async function checkHost(urlStr: string) {
                return new Promise<boolean>((resolve) => {
                  try {
                    let urlToTest = urlStr;
                    if (!/^https?:\/\//i.test(urlToTest)) {
                      urlToTest = `https://${urlToTest}`;
                    }
                    const url = new URL(urlToTest);
                    const lib = url.protocol === "http:" ? require("http") : require("https");
                    const req = lib.request(
                      {
                        method: "HEAD",
                        host: url.hostname,
                        port: url.port || (url.protocol === "https:" ? 443 : 80),
                        path: url.pathname || "/",
                        timeout: 4000,
                      },
                      (res: any) => {
                        const ok = res.statusCode && res.statusCode < 400;
                        resolve(!!ok);
                      },
                    );
                    req.on("error", () => resolve(false));
                    req.on("timeout", () => {
                      try {
                        req.destroy();
                      } catch (e) {
                        // ignore
                      }
                      resolve(false);
                    });
                    req.end();
                  } catch (e) {
                    resolve(false);
                  }
                });
              })(host);

              if (!isReachable) {
                throw new Error("The provided host is unreachable or did not respond. Please check the URL and try again.");
              }
            }
            // Determine repository path and try to detect host if not provided
            const repoPath =
              vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
                ? vscode.workspace.workspaceFolders[0].uri.fsPath
                : process.cwd();

            let hostToUse = host || (await GitProvider.detectRepoHost(repoPath));
            // Sanitize the host for use in secret key (replace non-alphanum with _)
            const sanitizedHost = hostToUse ? hostToUse.replace(/[^a-zA-Z0-9]/g, "_") : "default";
            const secretPrefix = `git.${sanitizedHost}.${provider}`;

            if (host) {
              await SecretsManager.setSecret(`${secretPrefix}.host`, host);
            }
            if (username) {
              await SecretsManager.setSecret(`${secretPrefix}.username`, username);
            }
            if (token) {
              await SecretsManager.setSecret(`${secretPrefix}.token`, token);
            }
            // Notify the webview that credentials were saved
            vscode.window.showInformationMessage(`Git credentials for ${provider} saved successfully.`);
            panel.sendMessage({ type: "gitCredentialsSaved", data: { provider, host: hostToUse } });
          } catch (err) {
            Logger.log("Error saving Git credentials: " + String(err));
            vscode.window.showErrorMessage(`Error saving Git credentials: ${String(err)}`);
            panel.sendMessage({ type: "gitCredentialsSaveError", data: { error: String(err) } });
          }
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
