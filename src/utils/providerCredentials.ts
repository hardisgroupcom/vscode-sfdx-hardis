import * as vscode from "vscode";
import { GitProvider } from "./gitProviders/gitProvider";
import { CreateTokenOption } from "./gitProviders/types";
import { TicketProvider } from "./ticketProviders/ticketProvider";
import { SecretsManager } from "./secretsManager";
import { getConfig } from "./pipeline/sfdxHardisConfig";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";

/**
 * Prompts the user for a git provider access token.
 *
 * First shows a MODAL choice (so users actually notice it) asking whether they already
 * have a token or want help creating one. When the provider exposes one or more token
 * creation pages (`createTokenOptions`), each is offered as a button that opens the page
 * in the browser, then returns to the choice so the user can paste the freshly created
 * token. The actual token entry uses a password InputBox.
 *
 * @returns the entered token, or null if the user cancelled at any step.
 */
export async function promptForToken(options: {
  providerLabel: string; // brand name, e.g. "GitLab" (not translated)
  inputPrompt: string; // translated InputBox prompt
  createTokenOptions: CreateTokenOption[];
  password?: boolean; // default true
}): Promise<string | null> {
  const { providerLabel, inputPrompt, createTokenOptions } = options;
  const password = options.password !== false;

  // When the provider knows where tokens are created, drive a modal choice that can
  // route the user to the right creation page before they paste the token.
  if (createTokenOptions.length > 0) {
    const alreadyHaveLabel = t("iAlreadyHaveToken");
    // Show any token-creation guidance (e.g. which repositories to grant access to,
    // or which token type/scopes to pick) and which scopes/permissions to select.
    const creationHints = createTokenOptions
      .map((option) => option.creationHint)
      .filter((hint): hint is string => !!hint);
    const scopeHints = createTokenOptions
      .map((option) => option.scopesHint)
      .filter((hint): hint is string => !!hint);
    const detailParts: string[] = [];
    if (creationHints.length > 0) {
      detailParts.push(creationHints.join("\n"));
    }
    if (scopeHints.length > 0) {
      detailParts.push(t("tokenScopesHint", { scopes: scopeHints.join("; ") }));
    }
    const detail =
      detailParts.length > 0 ? detailParts.join("\n\n") : undefined;
    // Loop so that after opening a creation page the user comes back to the choice.
    for (;;) {
      const buttons = [
        alreadyHaveLabel,
        ...createTokenOptions.map((option) => option.label),
      ];
      const choice = await vscode.window.showInformationMessage(
        t("gitTokenIntro", { provider: providerLabel }),
        { modal: true, detail },
        ...buttons,
      );
      if (!choice) {
        // Modal dismissed / cancelled
        return null;
      }
      if (choice === alreadyHaveLabel) {
        break;
      }
      const selectedOption = createTokenOptions.find(
        (option) => option.label === choice,
      );
      if (selectedOption) {
        await vscode.env.openExternal(vscode.Uri.parse(selectedOption.url));
        // Loop back to the modal so the user can paste the token once created
      }
    }
  }

  const token = await vscode.window.showInputBox({
    prompt: inputPrompt,
    ignoreFocusOut: true,
    password,
  });
  return token ?? null;
}

/**
 * Shows a non-blocking VS Code information message when provider authentication fails.
 *
 * When a `retry` callback is provided (git providers), the message offers a "Sign in
 * again" button that re-runs the exact same authentication flow as clicking the git
 * provider icon (token-type choice, token creation page with the right scopes, token
 * entry) — unifying the failure path with the proactive one. Otherwise (e.g. ticketing
 * providers) it falls back to a "Create Token" button opening `createTokenUrl`.
 */
export function showAuthFailureGuidance(options: {
  providerName: string;
  guidance: string;
  createTokenUrl?: string;
  docUrl: string;
  retry?: () => Promise<void> | void;
}): void {
  const buttons: string[] = [];
  const urlMap: Record<string, string> = {};

  const retryLabel = t("signInAgain");
  if (options.retry) {
    buttons.push(retryLabel);
  } else if (options.createTokenUrl) {
    const createLabel = t("createToken");
    buttons.push(createLabel);
    urlMap[createLabel] = options.createTokenUrl;
  }

  const docLabel = t("viewDocumentation");
  buttons.push(docLabel);
  urlMap[docLabel] = options.docUrl;

  const message =
    t("authenticationFailed", { provider: options.providerName }) +
    " " +
    options.guidance;

  vscode.window.showInformationMessage(message, ...buttons).then((action) => {
    if (action === retryLabel && options.retry) {
      options.retry();
    } else if (action && urlMap[action]) {
      vscode.env.openExternal(vscode.Uri.parse(urlMap[action]));
    }
  });
}

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
          // Prefer a stored personal access token; otherwise use the native session
          const storedToken = await SecretsManager.getSecret(
            hostKey + "_TOKEN",
          );
          if (storedToken) {
            env.GITHUB_TOKEN = storedToken;
          } else {
            const session = await vscode.authentication.getSession(
              "github",
              ["repo"],
              { createIfNone: false, silent: true },
            );
            if (session?.accessToken) {
              env.GITHUB_TOKEN = session.accessToken;
            }
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
          const token = await SecretsManager.getSecret(
            hostKey + "_BITBUCKET_TOKEN",
          );
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
    if (
      ticketProvider?.isAuthenticated &&
      ticketProvider.providerName === "JIRA"
    ) {
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
