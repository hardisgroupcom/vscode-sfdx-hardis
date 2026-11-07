import * as vscode from "vscode";
import {
  BranchStrategyMermaidBuilder,
  DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD,
  FeatureBranchGroup,
} from "./utils/pipeline/branchStrategyMermaidBuilder";
import {
  getPipelinePromotionBranchConfig,
  listMajorOrgs,
  MajorOrg,
} from "./utils/orgConfigUtils";
import { PromotionBranchConfig } from "./utils/pipeline/promotionBranchUtils";
import {
  buildMajorBranchCheckView,
  getMajorBranchCheckValidityHours,
  isMajorBranchCheckEnabled,
  MajorBranchCheckView,
} from "./utils/pipeline/majorBranchCheckUtils";
import { getConfig } from "./utils/pipeline/sfdxHardisConfig";
import { isScratchOrgPoolConfigured } from "./utils/scratchOrgPoolUtils";
import {
  DevOrgsView,
  DevOrgView,
  filterDevOrgsForDisplay,
  isDevOrgsRegistryEnabled,
} from "./utils/pipeline/devOrgsUtils";
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
  // Branches this one is promoted to, first one first (the "Next promotion" of the
  // Deployment Actions tab)
  mergeTargets?: string[];
  // Last major branch deployment check of the branch, only when the project enables
  // enableMajorBranchDeploymentCheck: null when none was found (see majorBranchCheckUtils.ts)
  majorBranchCheck?: MajorBranchCheckView | null;
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
  // Folded "+N more" feature-branch groups shown in the full diagram, so the
  // webview can open a PR modal when a group node or its link is clicked.
  featureBranchGroups: FeatureBranchGroup[];
  // Promotion branches switch of the project (sfdx-hardis enablePromotionBranches)
  promotionBranches?: PromotionBranchConfig;
  // The project has a scratch org pool (poolConfig.storageService): the menu shows its panel
  scratchOrgPoolEnabled?: boolean;
  // Major branch deployment check of the project (enableMajorBranchDeploymentCheck), and the
  // age in hours after which a check is stale (majorBranchDeploymentCheckValidityHours)
  majorBranchDeploymentCheckEnabled?: boolean;
  majorBranchDeploymentCheckValidityHours?: number;
  // Development orgs registry of the project (enableDevOrgsRegistry, on unless set to false)
  devOrgsEnabled?: boolean;
  // The list of development orgs was read for this payload (from sfdx-hardis or its last result)
  devOrgsLoaded?: boolean;
  // Every registered development org, whatever the display mode: the webview filters and opens them
  devOrgs?: DevOrgView[];
  devOrgsDashboardUrl?: string | null;
  devOrgsStaleDays?: number;
  // Full diagram with the development orgs of the git user, or all of them: only when it draws
  // at least one, else the webview keeps mermaidDiagram
  mermaidDiagramDevOrgsMine?: string;
  mermaidDiagramDevOrgsAll?: string;
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
      featureBranchGroupThreshold?: number;
      // The list of development orgs to draw, null when it was not read
      devOrgs?: DevOrgsView | null;
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
      const projectConfig = await getConfig("project");
      const promotionBranchConfig = getPipelinePromotionBranchConfig(
        projectConfig,
        majorOrgs,
      );
      const majorBranchCheckEnabled = isMajorBranchCheckEnabled(projectConfig);
      const devOrgsEnabled = isDevOrgsRegistryEnabled(projectConfig);
      const devOrgsList: DevOrgView[] =
        devOrgsEnabled && options.devOrgs?.enabled !== false
          ? options.devOrgs?.orgs || []
          : [];
      const majorBranchCheckValidityHours =
        getMajorBranchCheckValidityHours(projectConfig);
      // Computed once, so the diagram and the branch modal tell the same thing
      const now = new Date();
      const majorBranchChecks: Record<string, MajorBranchCheckView | null> = {};
      if (majorBranchCheckEnabled) {
        for (const org of majorOrgs) {
          majorBranchChecks[org.branchName] = buildMajorBranchCheckView(
            org.majorBranchCheck,
            (org.jobs || [])[0],
            majorBranchCheckValidityHours,
            now,
          );
        }
      }
      const mermaidBuilder = new BranchStrategyMermaidBuilder(
        majorOrgs,
        isAuthenticated,
        options.openPullRequests || [],
        gitProvider,
        options.colorTheme || "light",
        options.featureBranchGroupThreshold ??
          DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD,
        promotionBranchConfig,
        majorBranchChecks,
        devOrgsList,
      );
      const mermaidDiagram = mermaidBuilder.build({
        format: "string",
        withMermaidTag: true,
      }) as string;
      // Capture groups from the full build (feature branches shown) before the
      // major-only build recomputes state without them.
      const featureBranchGroups = mermaidBuilder.getFeatureBranchGroups();
      const mermaidDiagramMajor = mermaidBuilder.build({
        format: "string",
        withMermaidTag: true,
        onlyMajorBranches: true,
      }) as string;
      // The full diagram with development orgs, one per display mode that draws any (the
      // "none" mode is mermaidDiagram itself)
      const devOrgDiagrams: Record<string, string> = {};
      for (const mode of ["mine", "all"] as const) {
        if (filterDevOrgsForDisplay(devOrgsList, mode).length > 0) {
          devOrgDiagrams[mode] = mermaidBuilder.build({
            format: "string",
            withMermaidTag: true,
            devOrgs: mode,
          }) as string;
        }
      }

      // Build orgs and links for UI (not just for diagram)
      const orgs: OrgNode[] = majorOrgs.map((org) => ({
        name: org.branchName,
        type: org.orgType,
        alias: org.alias,
        instanceUrl: org.instanceUrl,
        nodeName: `${this.sanitizeNodeName(org.branchName)}Org`,
        level: org.level,
        isTopBranch: (org.mergeTargets || []).length === 0,
        mergeTargets: org.mergeTargets || [],
        pullRequestsInBranchSinceLastMerge:
          org.pullRequestsInBranchSinceLastMerge || [],
        ...(majorBranchCheckEnabled
          ? { majorBranchCheck: majorBranchChecks[org.branchName] ?? null }
          : {}),
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
      this.checkDevelopmentBranchExists(projectConfig, majorOrgs);
      this.checkAvailableTargetBranchesExist(projectConfig, majorOrgs);

      return {
        orgs,
        links,
        mermaidDiagram,
        mermaidDiagramMajor,
        warnings: this.warnings,
        featureBranchGroups,
        promotionBranches: promotionBranchConfig,
        scratchOrgPoolEnabled: isScratchOrgPoolConfigured(projectConfig),
        majorBranchDeploymentCheckEnabled: majorBranchCheckEnabled,
        majorBranchDeploymentCheckValidityHours: majorBranchCheckValidityHours,
        devOrgsEnabled,
        devOrgsLoaded: !!options.devOrgs,
        devOrgs: devOrgsList,
        devOrgsDashboardUrl: options.devOrgs?.dashboardUrl || null,
        devOrgsStaleDays: options.devOrgs?.staleDays || 0,
        mermaidDiagramDevOrgsMine: devOrgDiagrams.mine,
        mermaidDiagramDevOrgsAll: devOrgDiagrams.all,
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
        featureBranchGroups: [],
      };
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
