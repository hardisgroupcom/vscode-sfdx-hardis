import { TicketProvider } from "./ticketProvider";
import { Ticket, TicketProviderName } from "./types";
import { Logger } from "../../logger";
import { GitProvider } from "../gitProviders/gitProvider";
import { GitProviderAzure } from "../gitProviders/gitProviderAzure";
import * as azdev from "azure-devops-node-api";
import { WorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";

export class AzureBoardsProvider extends TicketProvider {
  static readonly providerName: TicketProviderName = "AZURE";

  private azureApi: azdev.WebApi | null = null;
  private workItemApi: WorkItemTrackingApi | null = null;
  private serverUrl: string = "";
  private teamProject: string = "";
  private token: string = "";

  constructor() {
    super();
    this.providerName = "AZURE";
  }

  async initializeConnection(): Promise<boolean | null> {
    return await this.authenticate();
  }

  async authenticate(): Promise<boolean | null> {
    // Get Azure DevOps connection info from GitProvider
    const gitProvider = await GitProvider.getInstance();

    if (!gitProvider || !gitProvider.isActive) {
      Logger.log(
        "Git provider is not active. Azure Boards requires an authenticated Azure DevOps git connection.",
      );
      return false;
    }

    if (gitProvider.repoInfo?.providerName !== "azure") {
      Logger.log(
        "Current git repository is not Azure DevOps. Azure Boards provider requires Azure DevOps repository.",
      );
      return false;
    }

    const azureGitProvider = gitProvider as GitProviderAzure;

    if (!azureGitProvider.connection || !azureGitProvider.repoInfo) {
      Logger.log("Azure DevOps git provider is not properly initialized.");
      return false;
    }

    // Extract server URL and team project from git provider
    // repoInfo.owner contains the project name for Azure DevOps
    this.teamProject = azureGitProvider.repoInfo.owner;

    // Build organization URL from repoInfo
    // webUrl format: https://dev.azure.com/org/project/_git/repo
    const urlMatch = azureGitProvider.repoInfo.webUrl?.match(
      /^(https?:\/\/[^/]+\/[^/]+)/,
    );
    if (!urlMatch) {
      Logger.log(
        "Could not extract Azure DevOps organization URL from repository info.",
      );
      return false;
    }
    this.serverUrl = urlMatch[1];

    // Reuse the same connection and authentication from GitProvider
    this.azureApi = azureGitProvider.connection;

    try {
      this.workItemApi = await this.azureApi.getWorkItemTrackingApi();

      this.isAuthenticated = true;
      Logger.log(
        `Azure Boards authentication successful (Project: ${this.teamProject})`,
      );
      return true;
    } catch (error: any) {
      Logger.log(
        `Azure Boards authentication failed: ${error?.message || String(error)}`,
      );
      this.azureApi = null;
      this.workItemApi = null;
      this.isAuthenticated = false;
      return false;
    }
  }

  async getTicketIdentifierRegexes(): Promise<RegExp[]> {
    const regexes: RegExp[] = [];

    // Azure Boards Work Items URL pattern
    regexes.push(/(https:\/\/.*\/_workitems\/edit\/[0-9]+)/gi);

    return regexes;
  }

  async buildTicketUrl(ticketId: string): Promise<string> {
    if (!this.serverUrl || !this.teamProject) {
      Logger.log("Azure Boards not authenticated. Call authenticate() first.");
      return "";
    }

    const baseUrl = this.serverUrl.replace(/\/$/, "");
    return `${baseUrl}/${encodeURIComponent(this.teamProject)}/_workitems/edit/${ticketId}`;
  }

  async completeTicketDetails(ticket: Ticket): Promise<Ticket> {
    if (!this.isAuthenticated || !this.workItemApi) {
      Logger.log(
        "Azure Boards client not authenticated. Call authenticate() first.",
      );
      return ticket;
    }

    try {
      const workItemId = Number(ticket.id);
      if (isNaN(workItemId)) {
        Logger.log(`Invalid Azure Boards Work Item ID: ${ticket.id}`);
        return ticket;
      }

      const workItem = await this.workItemApi.getWorkItem(
        workItemId,
        undefined,
        undefined,
        undefined,
        this.teamProject,
      );

      if (workItem && workItem.fields) {
        ticket.subject = workItem.fields["System.Title"] || "";
        ticket.status = workItem.fields["System.State"] || "";
        ticket.statusLabel = workItem.fields["System.State"] || "";

        // Get author (prefer assigned to, fallback to created by)
        const assignedTo = workItem.fields["System.AssignedTo"];
        const createdBy = workItem.fields["System.CreatedBy"];
        if (assignedTo?.displayName) {
          ticket.author = assignedTo.uniqueName || assignedTo.id || "";
          ticket.authorLabel = assignedTo.displayName;
        } else if (createdBy?.displayName) {
          ticket.author = createdBy.uniqueName || createdBy.id || "";
          ticket.authorLabel = createdBy.displayName;
        }

        // Get the web URL from _links if available
        if (
          workItem._links &&
          workItem._links["html"] &&
          workItem._links["html"]["href"]
        ) {
          ticket.url = workItem._links["html"]["href"];
        }

        ticket.foundOnServer = true;
        Logger.log(`Collected data for Azure Boards Work Item ${ticket.id}`);
      }
    } catch (error: any) {
      Logger.log(
        `Error fetching Azure Boards Work Item ${ticket.id}: ${error?.message || String(error)}`,
      );
      ticket.foundOnServer = false;
    }

    return ticket;
  }
}
