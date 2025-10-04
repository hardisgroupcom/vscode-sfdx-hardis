import * as vscode from "vscode";
import { BranchStrategyMermaidBuilder } from "./utils/pipeline/branchStrategyMermaidBuilder";
import { listMajorOrgs, MajorOrg } from "./utils/orgConfigUtils";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";
import { PullRequest } from "./utils/gitProviders/types";
// import { GitProvider } from "./utils/gitProviders/gitProvider";
// import { Logger } from "./logger";

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

  public async getPipelineData(options: {browseGitProvider?: boolean, openPullRequests?: PullRequest[]} = {}): Promise<PipelineData> {
    try {
      let majorOrgs: MajorOrg[] = await listMajorOrgs({browseGitProvider: options.browseGitProvider || false});
      // majorOrgs = await completeOrgsWithPullRequests(majorOrgs);
      const mermaidBuilder = new BranchStrategyMermaidBuilder(majorOrgs, options.openPullRequests || []);
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

      const warnings = majorOrgs.flatMap((org) => org.warnings || []);
      const projectConfig = await getConfig("project");
      if (!projectConfig.manualActionsFileUrl) {
        warnings.push(
          "The Pipeline should have Manual Actions tracking file (for pre-deployment and post-deployment manual actions). It is recommended to define one in Pipeline Settings.",
        );
      }

      return {
        orgs,
        links,
        mermaidDiagram,
        mermaidDiagramMajor,
        warnings: warnings,
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
}

// async function completeOrgsWithPullRequests(orgs: MajorOrg[]): Promise<MajorOrg[]> {
//   const gitProvider = await GitProvider.getInstance();
//   if (!gitProvider || !gitProvider.isActive) {
//     return orgs;
//   }
//   const config = vscode.workspace.getConfiguration('sfdxHardis');
//   const fetchPrs = config.get<boolean>('pipeline.fetchPullRequests', true);
//   if (!fetchPrs) {
//     return orgs;
//   }
//   for (const org of orgs) {
//     try {
//       const prs = await gitProvider.listPullRequestsForBranch(org.branchName);
//       org.openPullRequestsAsTarget = prs.filter(pr => pr.state === 'open');
//       org.mergedPullRequestsAsTarget = prs.filter(pr => pr.state === 'merged');
//     } catch (error) {
//       Logger.log(`Error fetching PRs for branch ${org.branchName}: ${String(error)}`);
//     }
//   }
//   return orgs;
// }
