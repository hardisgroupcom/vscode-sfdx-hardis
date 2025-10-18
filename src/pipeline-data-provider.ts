import * as vscode from "vscode";
import { BranchStrategyMermaidBuilder } from "./utils/pipeline/branchStrategyMermaidBuilder";
import { listMajorOrgs, MajorOrg } from "./utils/orgConfigUtils";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";
import { PullRequest } from "./utils/gitProviders/types";
import { GitProvider } from "./utils/gitProviders/gitProvider";

export interface OrgNode {
  name: string;
  type: string; // e.g., "prod", "preprod", "uat", "integration", "other"
  alias?: string;
  level: number;
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
    } = {},
  ): Promise<PipelineData> {
    try {
      let majorOrgs: MajorOrg[] = await listMajorOrgs({
        browseGitProvider: options.browseGitProvider || false,
      });
      // Get the git provider instance to pass to mermaid builder for create PR URLs
      const gitProvider = await GitProvider.getInstance();
      // majorOrgs = await completeOrgsWithPullRequests(majorOrgs);
      const mermaidBuilder = new BranchStrategyMermaidBuilder(
        majorOrgs,
        isAuthenticated,
        options.openPullRequests || [],
        gitProvider,
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
        level: org.level,
      }));
      const links: OrgLink[] = [];
      for (const org of majorOrgs) {
        for (const target of org.mergeTargets) {
          links.push({
            source: org.branchName,
            target,
            type: "gitMerge",
            label: "Merge",
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
      const invalidBranches = projectConfig.availableTargetBranches.filter(
        (branch: string) => !orgBranchNames.includes(branch),
      );
      if (invalidBranches.length > 0) {
        this.warnings.push(
          `The following branches listed in availableTargetBranches do not exist in the list of major branches: ${invalidBranches.join(", ")}. Either create them or update the configuration "availableTargetBranches".`,
        );
      }
    }
  }
}
