import * as vscode from "vscode";
import { GitProvider } from "./gitProviders/gitProvider";
import { TicketProvider } from "./ticketProviders/ticketProvider";
import { SecretsManager } from "./secretsManager";
import { getConfig } from "./pipeline/sfdxHardisConfig";
import { Logger } from "../logger";

/**
 * Environment variable keys that contain secrets and must NEVER be displayed
 * in terminal commands, logs, or UI elements.
 */
export const SECRET_ENV_KEYS = new Set([
  "GITHUB_TOKEN",
  "CI_SFDX_HARDIS_GITLAB_TOKEN",
  "CI_SFDX_HARDIS_AZURE_TOKEN",
  "SYSTEM_ACCESSTOKEN",
  "CI_SFDX_HARDIS_BITBUCKET_TOKEN",
  "JIRA_PAT",
  "JIRA_EMAIL",
  "JIRA_TOKEN",
]);

/**
 * Collects available provider credentials (git + ticketing) and returns them
 * as a Record mapping sfdx-hardis environment variable names to their values.
 *
 * These are intended to be passed as environment variables to `sf hardis:*`
 * CLI commands so that the CLI can authenticate with the same providers
 * the extension is connected to.
 *
 * SECURITY: The returned values are secrets. They must:
 *   - Be passed via spawnOptions.env (background mode) — never on the command line
 *   - Never be logged, displayed in the terminal, or stored outside secure storage
 */
export async function collectProviderCredentialEnvVars(): Promise<
  Record<string, string>
> {
  const env: Record<string, string> = {};

  // --- Git provider credentials ---
  try {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider?.isActive && gitProvider.repoInfo) {
      const providerName = gitProvider.repoInfo.providerName;
      const hostKey = gitProvider.hostKey;

      switch (providerName) {
        case "github": {
          const session = await vscode.authentication.getSession(
            "github",
            ["repo"],
            { createIfNone: false, silent: true },
          );
          if (session?.accessToken) {
            env.GITHUB_TOKEN = session.accessToken;
          }
          break;
        }
        case "gitlab": {
          const token = await SecretsManager.getSecret(hostKey + "_TOKEN");
          if (token) {
            env.CI_SFDX_HARDIS_GITLAB_TOKEN = token;
          }
          break;
        }
        case "azure": {
          const token = await SecretsManager.getSecret(hostKey + "_TOKEN");
          if (token) {
            env.CI_SFDX_HARDIS_AZURE_TOKEN = token;
            env.SYSTEM_ACCESSTOKEN = token;
          }
          break;
        }
        case "bitbucket": {
          const token = await SecretsManager.getSecret(hostKey + "_TOKEN");
          if (token) {
            env.CI_SFDX_HARDIS_BITBUCKET_TOKEN = token;
          }
          break;
        }
      }
    }
  } catch (e) {
    Logger.log(
      `Could not collect git provider credentials: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // --- Ticketing provider credentials (JIRA) ---
  try {
    const ticketProvider = await TicketProvider.getInstance({
      reset: false,
      authenticate: false,
    });
    if (ticketProvider?.isAuthenticated && ticketProvider.providerName === "JIRA") {
      const config = await getConfig("project");
      let jiraHost = (config.jiraHost || "").trim();
      if (
        jiraHost &&
        !jiraHost.startsWith("http://") &&
        !jiraHost.startsWith("https://")
      ) {
        jiraHost = "https://" + jiraHost;
      }
      if (jiraHost) {
        const hostKey = jiraHost.replace(/\./g, "_").toUpperCase();
        const pat = await SecretsManager.getSecret(hostKey + "_JIRA_PAT");
        if (pat) {
          env.JIRA_PAT = pat;
        }
        const email = await SecretsManager.getSecret(hostKey + "_JIRA_EMAIL");
        if (email) {
          env.JIRA_EMAIL = email;
        }
        const token = await SecretsManager.getSecret(hostKey + "_JIRA_TOKEN");
        if (token) {
          env.JIRA_TOKEN = token;
        }
      }
    }
  } catch (e) {
    Logger.log(
      `Could not collect ticketing provider credentials: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return env;
}
