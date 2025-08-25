import * as vscode from "vscode";
import { BranchStrategyMermaidBuilder } from "./utils/pipeline/branchStrategyMermaidBuilder";
import { listMajorOrgs, MajorOrg } from "./utils/orgConfigUtils";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";

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

  public async getPipelineData(): Promise<PipelineData> {
    try {
      const majorOrgs: MajorOrg[] = await listMajorOrgs();
      const mermaidBuilder = new BranchStrategyMermaidBuilder(majorOrgs);
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
