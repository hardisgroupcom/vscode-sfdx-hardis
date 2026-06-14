import * as vscode from "vscode";
import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";
import { SecretsManager } from "../secretsManager";
import { Version2Client, Version3Client } from "jira.js";
import { t } from "../../i18n/i18n";
import {
  promptForToken,
  showAuthFailureGuidance,
} from "../providerCredentials";

export class JiraProvider extends TicketProvider {
  static readonly providerName: TicketProviderName = "JIRA";

  private jiraClient: Version2Client | Version3Client | null = null;
  private jiraHost: string = "";
  private hostKey: string = "";

  constructor() {
    super();
    this.providerName = "JIRA";
  }

  completeJiraHostUrl(hostUrl: string): string {
    if (!hostUrl || hostUrl === "") {
      return hostUrl;
    }
    let completedUrl = hostUrl.trim();
    if (
      !completedUrl.startsWith("http://") &&
      !completedUrl.startsWith("https://")
    ) {
      completedUrl = "https://" + completedUrl;
    }
    return completedUrl;
  }

  async disconnect(): Promise<void> {
    if (this.hostKey) {
      // Remove all JIRA credentials for this host
      const secretKeys = [
        `${this.hostKey}_JIRA_PAT`,
        `${this.hostKey}_JIRA_EMAIL`,
        `${this.hostKey}_JIRA_TOKEN`,
      ];

      for (const key of secretKeys) {
        try {
          await SecretsManager.deleteSecret(key);
        } catch {
          // Ignore errors for non-existent keys
        }
      }

      Logger.log(`Disconnected from JIRA host: ${this.jiraHost}`);
    }

    await this.markDisconnected();
    this.isAuthenticated = false;
    this.jiraClient = null;
  }

  async getTicketingWebUrl(): Promise<string | null> {
    if (!this.jiraHost) {
      const config = await getConfig("project");
      this.jiraHost = this.completeJiraHostUrl(config.jiraHost || "");
    }
    return this.jiraHost || null;
  }

  async initializeConnection(): Promise<boolean | null> {
    const config = await getConfig("project");
    this.jiraHost = this.completeJiraHostUrl(config.jiraHost || "");
    if (!this.jiraHost) {
      Logger.log("JIRA host not configured.");
      return false;
    }
    this.hostKey = this.jiraHost.replace(/\./g, "_").toUpperCase();
    let jiraPAT =
      (await SecretsManager.getSecret(this.hostKey + "_JIRA_PAT")) || "";
    let jiraEmail =
      (await SecretsManager.getSecret(this.hostKey + "_JIRA_EMAIL")) || "";
    let jiraToken =
      (await SecretsManager.getSecret(this.hostKey + "_JIRA_TOKEN")) || "";
    let connected: boolean | null = null;
    if (jiraPAT) {
      connected = await this.initializeClient(jiraPAT, "", "");
    }
    if (!connected && jiraEmail && jiraToken) {
      connected = await this.initializeClient("", jiraEmail, jiraToken);
    }
    return connected;
  }

  async authenticate(): Promise<boolean | null> {
    const config = await getConfig("project");
    this.jiraHost = this.completeJiraHostUrl(config.jiraHost || "");
    if (!this.jiraHost) {
      Logger.log(
        "JIRA host not configured. Please set jiraHost in .sfdx-hardis.yml",
      );
      const pipelineSettingsLabel = t("pipelineConfig");
      vscode.window
        .showErrorMessage(t("jiraHostNotConfigured"), pipelineSettingsLabel)
        .then((action) => {
          if (action === pipelineSettingsLabel) {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showPipelineConfig",
              null,
              "Ticketing",
            );
          }
        });
      return false;
    }
    this.hostKey = this.jiraHost.replace(/\./g, "_").toUpperCase();

    // Prompt user for authentication method using a MODAL dialog (consistent with the
    // git provider sign-in flow), so the prompt is not missed when clicking the icon.
    const isCloud = this.isJiraCloud();
    const basicLabel = isCloud
      ? t("useEmailAndApiToken")
      : t("useUsernameAndPassword");
    const patLabel = isCloud
      ? t("usePersonalAccessToken")
      : t("usePersonalAccessTokenRecommended");
    // Offer the recommended method first.
    const buttons = isCloud ? [basicLabel, patLabel] : [patLabel, basicLabel];
    const choice = await vscode.window.showInformationMessage(
      t("jiraAuthMethodPlaceholder"),
      { modal: true },
      ...buttons,
    );
    if (!choice) {
      return null;
    }

    if (choice === patLabel) {
      return await this.authenticateWithPAT();
    }
    return await this.authenticateWithBasicAuth();
  }

  private async authenticateWithPAT(): Promise<boolean | null> {
    const patUrl = `${this.jiraHost}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`;

    const token = await promptForToken({
      providerLabel: "Jira",
      inputPrompt: t("enterJiraPat"),
      createTokenOptions: [
        {
          id: "pat",
          label: t("createJiraPat"),
          url: patUrl,
        },
      ],
    });

    if (!token) {
      return null;
    }

    await SecretsManager.setSecret(this.hostKey + "_JIRA_PAT", token);
    await SecretsManager.deleteSecret(this.hostKey + "_JIRA_EMAIL").catch(
      () => {},
    );
    await SecretsManager.deleteSecret(this.hostKey + "_JIRA_TOKEN").catch(
      () => {},
    );
    return await this.initializeClient(token, "", "");
  }

  private async authenticateWithBasicAuth(): Promise<boolean | null> {
    const isCloud = this.isJiraCloud();

    let email: string | undefined;
    let token: string | null | undefined;

    if (isCloud) {
      // Jira Cloud: ask the questions first (create-token modal + clickable button,
      // then paste the token), and only then prompt for the email — so the guided
      // messages come first and the plain value inputs come together at the end.
      token = await promptForToken({
        providerLabel: "Jira",
        inputPrompt: t("enterJiraApiToken"),
        createTokenOptions: [
          {
            id: "apiToken",
            label: t("createJiraApiToken"),
            url: "https://id.atlassian.com/manage-profile/security/api-tokens",
            creationHint: t("atlassianApiTokenWithScopesHint"),
            scopesHint: "read:jira-work, read:jira-user",
          },
        ],
      });
      if (!token) {
        return null;
      }
      email = await vscode.window.showInputBox({
        prompt: t("enterJiraEmail"),
        ignoreFocusOut: true,
        placeHolder: t("emailPlaceholder"),
      });
    } else {
      // Jira Server/Data Center basic auth uses the account username and password
      // (no token creation page).
      email = await vscode.window.showInputBox({
        prompt: t("enterJiraUsername"),
        ignoreFocusOut: true,
        placeHolder: t("usernamePlaceholder"),
      });
      if (!email) {
        return null;
      }
      token = await vscode.window.showInputBox({
        prompt: t("enterJiraPassword"),
        ignoreFocusOut: true,
        password: true,
      });
    }

    if (!email || !token) {
      return null;
    }

    await SecretsManager.setSecret(this.hostKey + "_JIRA_EMAIL", email);
    await SecretsManager.setSecret(this.hostKey + "_JIRA_TOKEN", token);
    await SecretsManager.deleteSecret(this.hostKey + "_JIRA_PAT").catch(
      () => {},
    );
    return await this.initializeClient("", email, token);
  }

  private isJiraCloud(): boolean {
    return (
      this.jiraHost.includes("atlassian.net") ||
      this.jiraHost.includes(".jira.com")
    );
  }

  private createJiraClient(
    authConfig:
      | { oauth2: { accessToken: string } }
      | { basic: { email: string; apiToken: string } },
  ): Version2Client | Version3Client {
    const host = this.jiraHost.replace(/\/$/, "");
    if (this.isJiraCloud()) {
      return new Version3Client({ host, authentication: authConfig });
    }
    // Jira Server/Data Center only supports REST API v2
    return new Version2Client({ host, authentication: authConfig });
  }

  private async initializeClient(
    pat: string,
    email: string,
    token: string,
  ): Promise<boolean> {
    try {
      if (!email && !token && !pat) {
        Logger.log("No valid JIRA credentials provided");
        return false;
      }
      // Check with Personal Access Token (Bearer auth)
      if (pat) {
        this.jiraClient = this.createJiraClient({
          oauth2: { accessToken: pat },
        });
        await this.checkActiveUser("PersonalAccessToken");
      }
      // Check with Email/Username and API Token/Password (Basic auth)
      if (email && token && !this.isAuthenticated) {
        this.jiraClient = this.createJiraClient({
          basic: { email, apiToken: token },
        });
        await this.checkActiveUser("EmailAndToken");
      }

      if (this.isAuthenticated) {
        return true;
      }
      const isCloud = this.isJiraCloud();
      const tokenUrl = isCloud
        ? "https://id.atlassian.com/manage-profile/security/api-tokens"
        : `${this.jiraHost}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`;
      showAuthFailureGuidance({
        providerName: "Jira",
        guidance: isCloud ? t("jiraCloudAuthInfo") : t("jiraServerAuthInfo"),
        createTokenUrl: tokenUrl,
        docUrl:
          "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
      });
      this.jiraClient = null;
      return false;
    } catch (error: any) {
      Logger.log(
        `JIRA authentication failed: ${error?.message || String(error)}`,
      );
      this.jiraClient = null;
      this.isAuthenticated = false;
      return false;
    }
  }

  async checkActiveUser(mode: "PersonalAccessToken" | "EmailAndToken") {
    // Cast needed: Version2Client and Version3Client share the same method signature,
    // but TypeScript cannot resolve the union of their overloaded signatures.
    const user = await (
      this.jiraClient as Version2Client
    ).myself.getCurrentUser();
    if (user.active) {
      this.isAuthenticated = true;
      Logger.log("JIRA authentication successful with mode: " + mode);
    } else {
      Logger.log(
        `JIRA authentication failed with mode ${mode}: Active user check failed. ${user ? JSON.stringify(user) : user}`,
      );
    }
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    const config = await getConfig("project");
    const customRegex = config.jiraTicketRegex;

    const regexes: RegExp[] = [];

    // Add URL-based regex to extract JIRA tickets from full URLs
    regexes.push(
      /(https:\/\/.*(?:jira|atlassian\.net|\.jira\.com).*\/[A-Z0-9]+-\d+\b)/gi,
    );

    // Add identifier-based regex (customizable via .sfdx-hardis.yml)
    if (customRegex) {
      regexes.push(new RegExp(customRegex, "gm"));
    } else {
      // Default regex for JIRA ticket identifiers
      regexes.push(
        /(?<=[^a-zA-Z0-9_-]|^)([A-Za-z0-9]{2,10}-\d{1,6})(?=[^a-zA-Z0-9_-]|$)/g,
      );
    }

    return regexes;
  }

  async buildTicketUrl(ticketId: string): Promise<string> {
    const config = await getConfig("project");
    const jiraHost =
      this.jiraHost ||
      this.completeJiraHostUrl(config.jiraHost) ||
      "https://define.jiraHost.in.your.sfdx-hardis.yml";
    const baseUrl = jiraHost.replace(/\/$/, "");
    return `${baseUrl}/browse/${ticketId}`;
  }

  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    if (!this.isAuthenticated || !this.jiraClient) {
      Logger.log("JIRA client not authenticated. Call authenticate() first.");
      return ticket;
    }

    try {
      // Cast needed: same reason as checkActiveUser — union of overloaded signatures
      const issue = await (this.jiraClient as Version2Client).issues.getIssue({
        issueIdOrKey: ticket.id,
        fields: ["summary", "status", "description", "reporter", "assignee"],
      });

      if (issue) {
        ticket.subject = issue.fields?.summary || "";
        ticket.status = issue.fields?.status?.id || "";
        ticket.statusLabel = issue.fields?.status?.name || "";

        // Get author (prefer assignee, fallback to reporter)
        const assignee = issue.fields?.assignee as any;
        const reporter = issue.fields?.reporter as any;
        if (assignee?.displayName) {
          ticket.author = assignee.accountId || assignee.name || "";
          ticket.authorLabel = assignee.displayName;
        } else if (reporter?.displayName) {
          ticket.author = reporter.accountId || reporter.name || "";
          ticket.authorLabel = reporter.displayName;
        }

        // Extract body from description
        const description = issue.fields?.description as any;
        if (typeof description === "string") {
          // Jira Server (API v2): description is a plain string
          ticket.body = description;
        } else if (description?.content && Array.isArray(description.content)) {
          // Jira Cloud (API v3): description is ADF format
          const extractText = (node: any): string => {
            if (node.type === "text") {
              return node.text || "";
            }
            if (node.content && Array.isArray(node.content)) {
              return node.content.map(extractText).join("");
            }
            return "";
          };
          ticket.body = description.content.map(extractText).join("\n");
        }

        ticket.foundOnServer = true;
        Logger.log(`Collected data for JIRA ticket ${ticket.id}`);
      }
    } catch (error: any) {
      Logger.log(
        `Error fetching JIRA issue ${ticket.id}: ${error?.message || String(error)}`,
      );
      ticket.foundOnServer = false;
    }

    return ticket;
  }
}
