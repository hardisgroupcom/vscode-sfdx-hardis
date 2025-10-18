import * as vscode from "vscode";
import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { getConfig } from "../pipeline/sfdxHardisConfig";
import { SecretsManager } from "../secretsManager";
import axios, { AxiosInstance } from "axios";

export class JiraProvider extends TicketProvider {
    static readonly providerName: TicketProviderName = "JIRA";

    private jiraClient: AxiosInstance | null = null;
    private jiraHost: string = "";

    constructor() {
        super();
        this.providerName = "JIRA";
    }

    async initializeConnection(): Promise<boolean | null> {
        const config = await getConfig("project");
        this.jiraHost = config.jiraHost || "";
        if (!this.jiraHost) {
            Logger.log("JIRA host not configured.");
            return false;
        }
        let jiraPAT = await SecretsManager.getSecret("JIRA_PAT") || "";
        let jiraEmail = await SecretsManager.getSecret("JIRA_EMAIL") || "";
        let jiraToken = await SecretsManager.getSecret("JIRA_TOKEN") || "";
        if (jiraPAT) {
            return await this.initializeClient(jiraPAT, "", "");
        }
        if (jiraEmail && jiraToken) {
            return await this.initializeClient("", jiraEmail, jiraToken);
        }
        return null;
    }

    async authenticate(): Promise<boolean | null> {
        const config = await getConfig("project");
        this.jiraHost = config.jiraHost || "";
        
        if (!this.jiraHost) {
            // Prompt user for JIRA host
            const hostInput = await vscode.window.showInputBox({
                prompt: "Enter your JIRA host URL (e.g., https://company.atlassian.net)",
                ignoreFocusOut: true,
                placeHolder: "https://company.atlassian.net",
                validateInput: (value) => {
                    if (!value) {
                        return "JIRA host URL is required";
                    }
                    if (!value.startsWith("http://") && !value.startsWith("https://")) {
                        return "JIRA host URL must start with http:// or https://";
                    }
                    return null;
                }
            });
            
            if (!hostInput) {
                return null;
            }
            
            this.jiraHost = hostInput;
        }

        // Try to get credentials from VS Code secrets
        // PAT is preferred, but we also support email+token for backward compatibility
        let jiraPAT = await SecretsManager.getSecret("JIRA_PAT") || "";
        let jiraEmail = await SecretsManager.getSecret("JIRA_EMAIL") || "";
        let jiraToken = await SecretsManager.getSecret("JIRA_TOKEN") || "";

        let hasPAT = !!jiraPAT;
        let hasBasicAuth = jiraEmail && jiraToken;

        if (!hasPAT && !hasBasicAuth) {
            // Prompt user for authentication method
            const choice = await vscode.window.showQuickPick(
                [
                    { label: "Use Personal Access Token (PAT) - Recommended", value: "pat" },
                    { label: "Use Email + API Token", value: "basic" },
                ],
                {
                    placeHolder: "How would you like to authenticate to JIRA?",
                    ignoreFocusOut: true,
                }
            );

            if (!choice) {
                return null;
            }

            if (choice.value === "pat") {
                return await this.authenticateWithPAT();
            }
            else {
                return await this.authenticateWithBasicAuth();
            }
        }

        // Initialize with existing credentials
        return await this.initializeClient(hasPAT ? jiraPAT : "", jiraEmail, jiraToken);
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

        await SecretsManager.setSecret("JIRA_PAT", token);
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

        await SecretsManager.setSecret("JIRA_EMAIL", email);
        await SecretsManager.setSecret("JIRA_TOKEN", token);
        return await this.initializeClient("", email, token);
    }

    private async initializeClient(pat: string, email: string, token: string): Promise<boolean> {
        try {
            const baseURL = this.jiraHost.replace(/\/$/, "") + "/rest/api/3";
            
            if (pat) {
                this.jiraClient = axios.create({
                    baseURL,
                    headers: {
                        'Authorization': `Bearer ${pat}`,
                        'Content-Type': 'application/json',
                    },
                });
            } 
            else if (email && token) {
                this.jiraClient = axios.create({
                    baseURL,
                    auth: {
                        username: email,
                        password: token,
                    },
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }
            else {
                Logger.log("No valid JIRA credentials provided");
                return false;
            }

            // Validate credentials by making a test request
            await this.jiraClient.get('/myself');
            this.isAuthenticated = true;
            Logger.log("JIRA authentication successful");
            return true;
        } 
        catch (error: any) {
            Logger.log(`JIRA authentication failed: ${error?.message || String(error)}`);
            this.jiraClient = null;
            this.isAuthenticated = false;
            return false;
        }
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
        } 
        else {
            // Default regex for JIRA ticket identifiers
            regexes.push(/(?<=[^a-zA-Z0-9_-]|^)([A-Za-z0-9]{2,10}-\d{1,6})(?=[^a-zA-Z0-9_-]|$)/g);
        }
        
        return regexes;
    }

    async buildTicketurl(ticketId: string): Promise<string> {
        const config = await getConfig("project");
        const jiraHost = config.jiraHost || this.jiraHost;
        const baseUrl = jiraHost.replace(/\/$/, "");
        return `${baseUrl}/browse/${ticketId}`;
    }

    async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
        if (!this.isAuthenticated || !this.jiraClient) {
            Logger.log("JIRA client not authenticated. Call authenticate() first.");
            return ticket;
        }

        try {
            const response = await this.jiraClient.get(`/issue/${ticket.id}`);
            const issueData = response.data;

            if (issueData) {
                ticket.subject = issueData.fields?.summary || "";
                ticket.status = issueData.fields?.status?.id || "";
                ticket.statusLabel = issueData.fields?.status?.name || "";
                
                // Extract body from description
                const description = issueData.fields?.description;
                if (description?.content && description.content.length > 0) {
                    ticket.body = description.content.map((content: any) => content.text || "").join("\n");
                }
                
                ticket.foundOnServer = true;
                Logger.log(`Collected data for JIRA ticket ${ticket.id}`);
            }
        } 
        catch (error: any) {
            Logger.log(`Error fetching JIRA issue ${ticket.id}: ${error?.message || String(error)}`);
            ticket.foundOnServer = false;
        }

        return ticket;
    }
}
