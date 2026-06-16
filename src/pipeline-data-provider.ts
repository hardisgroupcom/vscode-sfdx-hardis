import * as vscode from "vscode";
import { BranchStrategyMermaidBuilder } from "./utils/pipeline/branchStrategyMermaidBuilder";
import { listMajorOrgs, MajorOrg } from "./utils/orgConfigUtils";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";
import { PullRequest } from "./utils/gitProviders/types";
import { GitProvider } from "./utils/gitProviders/gitProvider";
import { t } from "./i18n/i18n";

export interface OrgNode {
  name: string;
  type: string; // e.g., "prod", "preprod", "uat", "integration", "other"
  alias?: string;
  instanceUrl?: string;
  nodeName?: string;
  level: number;
  // True when the branch has no merge target of its own (top branch, e.g.
  // main/prod). Such branches show go-lives instead of pending-promotion PRs.
  isTopBranch?: boolean;
}

export interface OrgLink {
  source: string;
  target: string;
  type: string; // e.g., "gitMerge", "sfDeploy", "sfPushPull"
  label?: string;
}

export interface PipelineData {
  orgs: OrgNode[];
  links: OrgLink[];
  mermaidDiagram: string;
  mermaidDiagramMajor: string;
  warnings: string[];
}

export class PipelineDataProvider {
  constructor() {}

  warnings: string[] = [];

  public async getPipelineData(
    isAuthenticated: boolean,
    options: {
      browseGitProvider?: boolean;
      openPullRequests?: PullRequest[];
      colorTheme?: string;
    } = {},
  ): Promise<PipelineData> {
    try {
      let majorOrgs: MajorOrg[] = await listMajorOrgs({
        browseGitProvider: options.browseGitProvider || false,
      });
      // Get the git provider instance to pass to mermaid builder for create PR URLs.
      // Skip it entirely when not browsing the git provider (step 2 / no-PR
      // render) so the cold provider init (~10s) does not block the first paint.
      const gitProvider = options.browseGitProvider
        ? await GitProvider.getInstance()
        : null;
      // majorOrgs = await completeOrgsWithPullRequests(majorOrgs);
      const mermaidBuilder = new BranchStrategyMermaidBuilder(
        majorOrgs,
        isAuthenticated,
        options.openPullRequests || [],
        gitProvider,
        options.colorTheme || "light",
      );
      const mermaidDiagram = mermaidBuilder.build({
        format: "string",
        withMermaidTag: true,
      }) as string;
      const mermaidDiagramMajor = mermaidBuilder.build({
        format: "string",
        withMermaidTag: true,
        onlyMajorBranches: true,
      }) as string;

      // Build orgs and links for UI (not just for diagram)
      const orgs: OrgNode[] = majorOrgs.map((org) => ({
        name: org.branchName,
        type: org.orgType,
        alias: org.alias,
        instanceUrl: org.instanceUrl,
        nodeName: `${this.sanitizeNodeName(org.branchName)}Org`,
        level: org.level,
        isTopBranch: (org.mergeTargets || []).length === 0,
        pullRequestsInBranchSinceLastMerge:
          org.pullRequestsInBranchSinceLastMerge || [],
      }));
      const links: OrgLink[] = [];
      for (const org of majorOrgs) {
        for (const target of org.mergeTargets) {
          links.push({
            source: org.branchName,
            target,
            type: "gitMerge",
            label: t("mergeLabel"),
          });
        }
      }

      this.warnings = majorOrgs.flatMap((org) => org.warnings || []);

      // Additional warnings
      const projectConfig = await getConfig("project");
      this.checkManualActionsFile(projectConfig);
      this.checkDevelopmentBranchExists(projectConfig, majorOrgs);
      this.checkAvailableTargetBranchesExist(projectConfig, majorOrgs);

      return {
        orgs,
        links,
        mermaidDiagram,
        mermaidDiagramMajor,
        warnings: this.warnings,
      };
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to get pipeline data: ${error.message}`,
      );
      return {
        orgs: [],
        links: [],
        mermaidDiagram: "Error generating pipeline diagram.",
        mermaidDiagramMajor: "Error generating pipeline diagram.",
        warnings: [error.message],
      };
    }
  }

  checkManualActionsFile(projectConfig: any): void {
    if (projectConfig.manualActionsMode === "sfdxHardis") {
      return;
    }
    if (!projectConfig.manualActionsFileUrl) {
      this.warnings.push(
        "The Pipeline should have Manual Actions tracking file (for pre-deployment and post-deployment manual actions). It is recommended to define one in Pipeline Settings.",
      );
    }
  }

  checkDevelopmentBranchExists(projectConfig: any, orgs: MajorOrg[]): void {
    if (projectConfig.developmentBranch) {
      const devBranchExists = orgs.some(
        (org) => org.branchName === projectConfig.developmentBranch,
      );
      if (!devBranchExists) {
        this.warnings.push(
          `The configured development branch '${projectConfig.developmentBranch}' does not exist in the list of major branches. Either create it or update the configuration "developmentBranch".`,
        );
      }
    }
  }

  checkAvailableTargetBranchesExist(
    projectConfig: any,
    orgs: MajorOrg[],
  ): void {
    if (
      projectConfig.availableTargetBranches &&
      Array.isArray(projectConfig.availableTargetBranches)
    ) {
      const orgBranchNames = orgs.map((org) => org.branchName);
      const availableTargetBranchesWithoutLabels =
        projectConfig.availableTargetBranches.map((branch: string) =>
          branch.includes(",") ? branch.split(",")[0] : branch,
        );
      const invalidBranches = availableTargetBranchesWithoutLabels.filter(
        (branch: string) => !orgBranchNames.includes(branch),
      );
      if (invalidBranches.length > 0) {
        this.warnings.push(
          `The following branches listed in availableTargetBranches do not exist in the list of major branches: ${invalidBranches.join(", ")}. Either create them or update the configuration "availableTargetBranches".`,
        );
      }
    }
  }

  private sanitizeNodeName(branchName: string | undefined): string {
    if (!branchName) {
      return "unknown";
    }
    return branchName
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/-+/g, "-");
  }
}
