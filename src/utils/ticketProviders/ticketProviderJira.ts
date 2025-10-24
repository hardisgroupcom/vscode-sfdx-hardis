import * as vscode from "vscode";
import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";
import { SecretsManager } from "../secretsManager";
import { Version3Client } from "jira.js";

export class JiraProvider extends TicketProvider {
  static readonly providerName: TicketProviderName = "JIRA";

  private jiraClient: Version3Client | null = null;
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
      vscode.window
        .showErrorMessage(
          "JIRA host not configured. Please set jiraHost in .sfdx-hardis.yml (use Pipeline Settings)",
          "View Pipeline Settings",
        )
        .then((action) => {
          if (action === "View Pipeline Settings") {
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

    // Prompt user for authentication method
    const choice = await vscode.window.showQuickPick(
      [
        { label: "Use Email + API Token", value: "basic" },
        {
          label: "Use Personal Access Token (PAT)",
          value: "pat",
        },
      ],
      {
        placeHolder: "How would you like to authenticate to JIRA?",
        ignoreFocusOut: true,
      },
    );
    if (!choice) {
      return null;
    }

    if (choice.value === "pat") {
      return await this.authenticateWithPAT();
    } else {
      return await this.authenticateWithBasicAuth();
    }
  }

  private async authenticateWithPAT(): Promise<boolean | null> {
    const patUrl = `${this.jiraHost}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`;

    const token = await vscode.window.showInputBox({
      prompt: "Enter your JIRA Personal Access Token",
      ignoreFocusOut: true,
      password: true,
      placeHolder: `Create a PAT at: ${patUrl}`,
    });

    if (!token) {
      return null;
    }

    await SecretsManager.setSecret(this.hostKey + "_JIRA_PAT", token);
    return await this.initializeClient(token, "", "");
  }

  private async authenticateWithBasicAuth(): Promise<boolean | null> {
    const email = await vscode.window.showInputBox({
      prompt: "Enter your JIRA email address",
      ignoreFocusOut: true,
      placeHolder: "user@company.com",
    });

    if (!email) {
      return null;
    }

    const tokenUrl = `${this.jiraHost}/secure/ViewProfile.jspa?selectedTab=com.atlassian.jira.jira-profile-plugin:apitokens-applink-apitokens`;
    const token = await vscode.window.showInputBox({
      prompt: "Enter your JIRA API Token",
      ignoreFocusOut: true,
      password: true,
      placeHolder: `Create an API token at: ${tokenUrl}`,
    });

    if (!token) {
      return null;
    }

    await SecretsManager.setSecret(this.hostKey + "_JIRA_EMAIL", email);
    await SecretsManager.setSecret(this.hostKey + "_JIRA_TOKEN", token);
    return await this.initializeClient("", email, token);
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
      const host = this.jiraHost.replace(/\/$/, "");
      // Check with Personal Access Token
      if (pat) {
        this.jiraClient = new Version3Client({
          host,
          authentication: {
            oauth2: {
              accessToken: pat,
            },
          },
        });
        await this.checkActiveUser("PersonalAccessToken");
      }
      // Check with Email and API Token
      if (email && token && !this.isAuthenticated) {
        this.jiraClient = new Version3Client({
          host,
          authentication: {
            basic: {
              email,
              apiToken: token,
            },
          },
        });
        await this.checkActiveUser("EmailAndToken");
      }

      if (this.isAuthenticated) {
        return true;
      }
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
    const user = await this.jiraClient!.myself.getCurrentUser();
    if (user.active) {
      this.isAuthenticated = true;
      Logger.log("JIRA authentication successful with mode: " + mode);
    }
    Logger.log(
      `JIRA authentication failed with mode ${mode}: Active user check failed. ${user ? JSON.stringify(user) : user}`,
    );
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    const config = await getConfig("project");
    const customRegex = config.jiraTicketRegex;

    const regexes: RegExp[] = [];

    // Add URL-based regex to extract JIRA tickets from full URLs
    regexes.push(/(https:\/\/.*(?:jira|atlassian\.net).*\/[A-Z0-9]+-\d+\b)/gi);

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
    const jiraHost = this.jiraHost || this.completeJiraHostUrl(config.jiraHost);
    const baseUrl = jiraHost.replace(/\/$/, "");
    return `${baseUrl}/browse/${ticketId}`;
  }

  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    if (!this.isAuthenticated || !this.jiraClient) {
      Logger.log("JIRA client not authenticated. Call authenticate() first.");
      return ticket;
    }

    try {
      const issue = await this.jiraClient.issues.getIssue({
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

        // Extract body from description (ADF format)
        const description = issue.fields?.description as any;
        if (description?.content && Array.isArray(description.content)) {
          // Flatten ADF content tree to extract text
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
