import { sortArray } from "../sortUtils";
import { prettifyFieldName } from "../stringUtils";
import { isMajorBranch, isPreprod, isProduction } from "../orgConfigUtils";
import { PullRequest, JobStatus } from "../gitProviders/types";
import { GitProvider } from "../gitProviders/gitProvider";
import { t } from "../../i18n/i18n";

/**
 * Describes a "+N more" node that folds the older feature branches targeting a
 * given major branch when they exceed the configured threshold. Exposed to the
 * pipeline webview so a click on the group node or its link can open a modal
 * listing the related pull requests.
 */
export interface FeatureBranchGroup {
  nodeName: string;
  targetBranch: string;
  foldedCount: number;
  hasPendingJob: boolean;
  // All pull requests targeting this major branch (folded + still visible)
  pullRequests: PullRequest[];
  // Index of the aggregated link among the rendered edges (declaration order),
  // used by the webview to bind a click handler on the corresponding SVG path.
  edgeIndex: number;
}

// Default number of feature branches per target branch above which the older
// ones are folded into a single "+N more" group node.
export const DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD = 3;

// Inline SVG icons used inside mermaid HTML labels. Attributes are
// single-quoted because labels are emitted inside double-quoted mermaid
// strings; fill='currentColor' makes the icons follow each node's text color
// in both light and dark themes (replacing OS-dependent emoji glyphs).
const BRANCH_ICON_SVG =
  "<svg class='hardis-node-icon' viewBox='0 0 16 16' width='12' height='12' fill='currentColor' aria-hidden='true'><path d='M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z'/></svg>";
const CLOUD_ICON_SVG =
  "<svg class='hardis-node-icon' viewBox='0 0 24 24' width='14' height='14' fill='currentColor' aria-hidden='true'><path d='M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z'/></svg>";

export class BranchStrategyMermaidBuilder {
  private isAuthenticated: boolean = false;
  private gitProvider: GitProvider | null = null;
  private branchesAndOrgs: any[];
  private openPullRequests: PullRequest[] = [];
  private gitBranches: any[] = [];
  private salesforceOrgs: any[] = [];
  private salesforceDevOrgsGroup: string[] = [];
  private gitLinks: any[] = [];
  private deployLinks: any[] = [];
  private sbDevLinks: any[] = [];
  private retrofitLinks: any[] = [];
  private mermaidLines: string[] = [];
  private colorTheme: string = "light";
  private featureBranchGroupThreshold: number =
    DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD;
  private featureBranchGroups: FeatureBranchGroup[] = [];

  constructor(
    branchesAndOrgs: any[],
    isAuthenticated: boolean,
    openPullRequests: PullRequest[] = [],
    gitProvider: GitProvider | null = null,
    colorTheme: string = "light",
    featureBranchGroupThreshold: number = DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD,
  ) {
    this.branchesAndOrgs = branchesAndOrgs;
    this.openPullRequests = openPullRequests;
    this.isAuthenticated = isAuthenticated;
    this.gitProvider = gitProvider;
    this.colorTheme = colorTheme;
    this.featureBranchGroupThreshold =
      typeof featureBranchGroupThreshold === "number" &&
      featureBranchGroupThreshold >= 0
        ? featureBranchGroupThreshold
        : DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD;
  }

  /**
   * Returns the feature-branch groups computed during the last build() call.
   * Only meaningful for the full diagram (feature branches shown).
   */
  public getFeatureBranchGroups(): FeatureBranchGroup[] {
    return this.featureBranchGroups;
  }

  /**
   * Build the mermaid diagram.
   * @param options.format 'list' or 'string'
   * @param options.withMermaidTag wrap in code block
   * @param options.onlyMajorBranches if true, only major branches (prod, preprod, uat, uatrun, integration) and their links are included (no dev/feature/hotfix branches or dev orgs)
   */
  public build(options: {
    format: "list" | "string";
    withMermaidTag: boolean;
    onlyMajorBranches?: boolean;
  }): string | string[] {
    // Reset all arrays for each build
    this.gitBranches = [];
    this.salesforceOrgs = [];
    this.salesforceDevOrgsGroup = [];
    this.gitLinks = [];
    this.deployLinks = [];
    this.sbDevLinks = [];
    this.retrofitLinks = [];
    this.mermaidLines = [];
    this.featureBranchGroups = [];

    this.listGitBranchesAndLinks();
    this.listSalesforceOrgsAndLinks();

    if (options.onlyMajorBranches) {
      // Filter out feature/hotfix/dev branches
      this.gitBranches = this.gitBranches.filter(
        (b) => b.class === "gitMain" || b.class === "gitMajor",
      );
      this.gitLinks = this.gitLinks.filter((l) => {
        // Only keep links between major branches
        const src = this.gitBranches.find((b) => b.nodeName === l.source);
        const tgt = this.gitBranches.find((b) => b.nodeName === l.target);
        return src && tgt;
      });
      // Keep only major orgs (prod and major), remove dev orgs
      this.salesforceOrgs = this.salesforceOrgs.filter((org) =>
        ["salesforceProd", "salesforceMajor"].includes(org.class),
      );
      // Keep only deploy links to major orgs
      const majorOrgNodeNames = this.salesforceOrgs.map((org) => org.nodeName);
      this.deployLinks = this.deployLinks.filter((link) =>
        majorOrgNodeNames.includes(link.target),
      );
      // Remove dev org groups and dev-specific links
      this.salesforceDevOrgsGroup = [];
      this.sbDevLinks = [];
    }

    this.generateMermaidLines(options);

    if (options.withMermaidTag) {
      this.mermaidLines.unshift("```mermaid");
      this.mermaidLines.push("```");
    }

    return options.format === "list"
      ? this.mermaidLines
      : this.mermaidLines.join("\n");
  }

  private listGitBranchesAndLinks(): void {
    const branchesWhoAreMergeTargets: string[] = [];
    const branchesMergingInPreprod: string[] = [];

    this.gitBranches = this.branchesAndOrgs.map((branchAndOrg) => {
      const nodeName =
        this.sanitizeNodeName(branchAndOrg.branchName) + "Branch";
      for (const mergeTarget of branchAndOrg.mergeTargets || []) {
        if (!branchesWhoAreMergeTargets.includes(mergeTarget)) {
          branchesWhoAreMergeTargets.push(mergeTarget);
        }
        if (isPreprod(mergeTarget)) {
          branchesMergingInPreprod.push(branchAndOrg.branchName);
        }
        // Find PRs that match BOTH source and target branches
        const openPullRequestsForThisLink = this.openPullRequests.filter(
          (pr) =>
            pr.sourceBranch === branchAndOrg.branchName &&
            pr.targetBranch === mergeTarget,
        );
        // Select only the first PR if multiple exist
        const activePR =
          openPullRequestsForThisLink.length > 0
            ? openPullRequestsForThisLink[0]
            : null;

        // Determine if source is a major branch
        const isSourceMajorBranch = isMajorBranch(
          branchAndOrg.branchName,
          this.branchesAndOrgs,
        );
        // Also check if target is a major branch
        const isTargetMajorBranch = isMajorBranch(
          mergeTarget,
          this.branchesAndOrgs,
        );
        // Use gitMerge (thick blue) if either source OR target is a major branch
        const isMajorLink = isSourceMajorBranch || isTargetMajorBranch;

        // Determine link label based on PR status
        let linkLabel: string;
        if (activePR) {
          linkLabel = this.buildPrChip(activePR);
        } else if (this.isAuthenticated && this.gitProvider) {
          // Generate "Create PR" link when authenticated and no PR exists
          const createPrUrl = this.gitProvider.getCreatePullRequestUrl(
            branchAndOrg.branchName,
            mergeTarget,
          );
          if (createPrUrl) {
            linkLabel = `<a href='${createPrUrl}' target='_blank' class='hardis-pill hardis-chip hardis-chip-create' title='${t("createPr")}'>+ PR</a>`;
          } else {
            linkLabel = t("noPr");
          }
        } else {
          linkLabel = this.isAuthenticated ? t("noPr") : t("mergeLabel");
        }

        this.gitLinks.push({
          source: nodeName,
          target: this.sanitizeNodeName(mergeTarget) + "Branch",
          type: isMajorLink ? "gitMerge" : "gitFeatureMerge",
          label: linkLabel,
          activePR: activePR,
        });
      }
      const prCount =
        branchAndOrg?.pullRequestsInBranchSinceLastMerge?.length || 0;
      const branchLabel =
        BRANCH_ICON_SVG +
        " " +
        this.escapeHtmlLabel(branchAndOrg.branchName) +
        (prCount > 0
          ? ` <span class='hardis-count-badge'>${prCount}</span>`
          : "");
      return {
        name: branchAndOrg.branchName,
        nodeName: nodeName,
        label: branchLabel,
        class: isProduction(branchAndOrg.branchName) ? "gitMain" : "gitMajor",
        level: branchAndOrg.level,
        instanceUrl: branchAndOrg.instanceUrl,
        hasPullRequests:
          branchAndOrg?.pullRequestsInBranchSinceLastMerge &&
          branchAndOrg.pullRequestsInBranchSinceLastMerge.length > 0,
      };
    });

    // Create feature branches for branches that are not merge targets
    const noMergeTargetBranchAndOrg = this.branchesAndOrgs.filter(
      (branchAndOrg) =>
        !branchesWhoAreMergeTargets.includes(branchAndOrg.branchName),
    );

    if (
      branchesMergingInPreprod.length < 2 &&
      !noMergeTargetBranchAndOrg.find((branchAndOrg) =>
        isPreprod(branchAndOrg.branchName),
      )
    ) {
      // We must check if a 'preprod' branch exists before adding it to the array.
      // The .find() method returns undefined if no matching element is found.
      // Without this check, an 'undefined' value could be pushed to the array,
      // causing a null pointer exception later when the code tries to access the 'branchName' property.
      const preprodBranch = this.branchesAndOrgs.find((branchAndOrg) =>
        isPreprod(branchAndOrg.branchName),
      );
      if (preprodBranch) {
        noMergeTargetBranchAndOrg.push(preprodBranch);
      }
    }

    // Feature branches are the open PRs whose source branch is not a major
    // branch. Use the same level as the lowest leaf branch so they are grouped
    // with (and, thanks to branchTypeOrder, displayed before) any major "leaf"
    // branch sitting at the same level (e.g. UatPermSet).
    const featureBranchLevel =
      noMergeTargetBranchAndOrg.length > 0
        ? Math.min(...noMergeTargetBranchAndOrg.map((b) => b.level))
        : 50;
    const featurePullRequests = this.openPullRequests.filter(
      (pullRequest) =>
        !this.branchesAndOrgs.find(
          (b) => b.branchName === pullRequest.sourceBranch,
        ),
    );
    // Group feature PRs by their target (major) branch. When a target has more
    // than the threshold, only the newest ones stay as individual nodes and the
    // older ones are folded into a single "+N more" group node + aggregated link.
    const featurePrsByTarget = new Map<string, PullRequest[]>();
    for (const pullRequest of featurePullRequests) {
      const target = pullRequest.targetBranch || "";
      if (!featurePrsByTarget.has(target)) {
        featurePrsByTarget.set(target, []);
      }
      featurePrsByTarget.get(target)!.push(pullRequest);
    }
    for (const [targetBranch, prs] of featurePrsByTarget) {
      // Oldest first (ascending PR creation date; missing dates sort first)
      const prsOldestFirst = [...prs].sort((a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || ""),
      );
      const threshold = this.featureBranchGroupThreshold;
      const mustGroup = prsOldestFirst.length > threshold;
      // Keep the newest `threshold` PRs visible; fold the older remainder.
      const foldedPrs = mustGroup
        ? prsOldestFirst.slice(0, prsOldestFirst.length - threshold)
        : [];
      const visiblePrs = mustGroup
        ? prsOldestFirst.slice(prsOldestFirst.length - threshold)
        : prsOldestFirst;
      for (const pullRequest of visiblePrs) {
        this.addFeatureBranchAndLink(pullRequest, featureBranchLevel);
      }
      if (foldedPrs.length > 0) {
        this.addFeatureBranchGroup(
          targetBranch,
          foldedPrs,
          prsOldestFirst,
          featureBranchLevel,
        );
      }
    }

    // Add retrofit link only if it does not mess with the diagram display :/
    // if (branchesMergingInPreprod.length < 2) {
    //   const mainBranch = this.branchesAndOrgs.find((branchAndOrg) =>
    //     isProduction(branchAndOrg.branchName),
    //   );
    //   const preprodBranch = this.branchesAndOrgs.find((branchAndOrg) =>
    //     isPreprod(branchAndOrg.branchName),
    //   );
    //   const integrationBranch = this.branchesAndOrgs.find((branchAndOrg) =>
    //     isIntegration(branchAndOrg.branchName),
    //   );

    // if (mainBranch && preprodBranch && integrationBranch) {
    //   this.retrofitLinks.push({
    //     source: mainBranch.branchName + "Branch",
    //     target: integrationBranch.branchName + "Branch",
    //     type: "gitMerge",
    //     label: "Retrofit from RUN to BUILD",
    //   });
    // }
    // }

    // Sort branches & links
    // Within the same level, display feature branches before major/main branches.
    // Feature branches are then ordered by PR creation date (ascending); other
    // branches fall through to an alphabetical order by name.
    // Feature branches and "+N more" group nodes are both feature-type: they
    // sort before major branches within a level. Individual feature branches are
    // ordered by PR creation date; "+N more" group nodes always come last (after
    // the individual feature branches), thanks to featureGroupOrder.
    const isFeatureClass = (cls: string) =>
      cls === "gitFeature" || cls === "gitFeatureGroup";
    this.gitBranches = sortArray(this.gitBranches, {
      by: [
        "level",
        "branchTypeOrder",
        "featureGroupOrder",
        "featureCreatedAt",
        "name",
      ],
      order: ["asc", "asc", "asc", "asc", "asc"],
      computed: {
        branchTypeOrder: (branch: any) =>
          isFeatureClass(branch.class) ? 0 : 1,
        // Individual feature branches (0) before "+N more" group nodes (1)
        featureGroupOrder: (branch: any) =>
          branch.class === "gitFeatureGroup" ? 1 : 0,
        featureCreatedAt: (branch: any) =>
          isFeatureClass(branch.class) ? branch.createdAt || "" : "",
      },
    });
    this.gitLinks = sortArray(this.gitLinks, {
      by: ["level", "source"],
      order: ["asc", "asc"],
    });

    // Record each group's aggregated-link index among the rendered edges. Edges
    // are emitted in gitLinks order first (see generateMermaidLines), so the
    // index within the sorted gitLinks equals the global edge index used by the
    // webview to bind a click handler on the SVG path.
    for (const group of this.featureBranchGroups) {
      group.edgeIndex = this.gitLinks.findIndex(
        (link) => link.isFeatureGroup && link.groupNodeName === group.nodeName,
      );
    }
  }

  /**
   * Create an individual feature branch node and its merge link to the target
   * major branch (one open pull request = one feature branch).
   */
  private addFeatureBranchAndLink(
    pullRequest: PullRequest,
    level: number,
  ): void {
    const nodeName = this.sanitizeNodeName(pullRequest.sourceBranch) + "Branch";
    // Long feature branch names dictate the diagram layout: shorten them for
    // display (the click tooltip still carries the full branch name) and show
    // the PR job status as a small colored dot instead of an emoji.
    const status = this.normalizeJobStatus(pullRequest.jobsStatus);
    const featureLabel =
      `<span class='hardis-pill-dot hardis-node-dot hardis-status-${status}'></span> ` +
      this.escapeHtmlLabel(this.shortenBranchName(pullRequest.sourceBranch));
    this.gitBranches.push({
      name: pullRequest.sourceBranch,
      nodeName: nodeName,
      label: featureLabel,
      class: "gitFeature",
      level: level,
      group: pullRequest.sourceBranch,
      createdAt: pullRequest.createdAt,
    });
    const prLinkLabel =
      pullRequest.number || pullRequest.id
        ? this.buildPrChip(pullRequest)
        : this.isAuthenticated
          ? t("noPr")
          : t("mergeLabel");
    this.gitLinks.push({
      source: nodeName,
      target: this.sanitizeNodeName(pullRequest.targetBranch) + "Branch",
      type: "gitFeatureMerge",
      label: prLinkLabel,
      activePR: pullRequest,
    });
  }

  /**
   * Create a single "+N more" group node folding the older feature branches of
   * a target, plus a single aggregated link. The link turns red with animated
   * dashes when any folded pull request has a running/pending job.
   */
  private addFeatureBranchGroup(
    targetBranch: string,
    foldedPrs: PullRequest[],
    allTargetPrs: PullRequest[],
    level: number,
  ): void {
    const groupNodeName = this.sanitizeNodeName(targetBranch) + "FeaturesGroup";
    const aggregateStatus = this.aggregateJobsStatus(foldedPrs);
    const hasPendingJob =
      aggregateStatus === "running" || aggregateStatus === "pending";
    // Sort key: oldest folded PR date so the group node sorts above the newer
    // individual feature branches kept for this target.
    const oldestCreatedAt =
      foldedPrs
        .map((pr) => pr.createdAt || "")
        .sort((a, b) => a.localeCompare(b))[0] || "";
    this.gitBranches.push({
      name: groupNodeName,
      nodeName: groupNodeName,
      label: t("featureBranchesGroupNode", { count: foldedPrs.length }),
      class: "gitFeatureGroup",
      level: level,
      createdAt: oldestCreatedAt,
      isFeatureGroup: true,
    });
    this.gitLinks.push({
      // Base type so addLinks() renders the edge; jobsStatus drives the
      // semantic (colored/animated) variant when a folded PR has an active job.
      source: groupNodeName,
      target: this.sanitizeNodeName(targetBranch) + "Branch",
      type: "gitFeatureMerge",
      label: this.buildStatusChip(aggregateStatus),
      isFeatureGroup: true,
      jobsStatus: aggregateStatus,
      groupNodeName: groupNodeName,
    });
    this.featureBranchGroups.push({
      nodeName: groupNodeName,
      targetBranch: targetBranch,
      foldedCount: foldedPrs.length,
      hasPendingJob: hasPendingJob,
      pullRequests: allTargetPrs,
      edgeIndex: -1,
    });
  }

  /**
   * Aggregate the job status of a set of pull requests, worst-first: a single
   * running/pending/failed job dominates; success only when all succeeded.
   */
  private aggregateJobsStatus(prs: PullRequest[]): JobStatus {
    if (prs.some((pr) => pr.jobsStatus === "running")) {
      return "running";
    }
    if (prs.some((pr) => pr.jobsStatus === "pending")) {
      return "pending";
    }
    if (prs.some((pr) => pr.jobsStatus === "failed")) {
      return "failed";
    }
    if (prs.length > 0 && prs.every((pr) => pr.jobsStatus === "success")) {
      return "success";
    }
    return "unknown";
  }

  private listSalesforceOrgsAndLinks(): any {
    for (const gitBranch of this.gitBranches) {
      const branchAndOrg = this.branchesAndOrgs.find(
        (branchAndOrg) => branchAndOrg.branchName === gitBranch.name,
      );
      if (branchAndOrg) {
        const nodeName = this.sanitizeNodeName(branchAndOrg.branchName) + "Org";
        let orgLabel =
          branchAndOrg.alias ||
          (isProduction(branchAndOrg.branchName)
            ? "Production Org"
            : prettifyFieldName(branchAndOrg.branchName));
        if (
          branchAndOrg.instanceUrl &&
          !branchAndOrg.instanceUrl.includes("login.salesforce.com") &&
          !branchAndOrg.instanceUrl.includes("test.salesforce.com")
        ) {
          // Remove the http, sandbox and salesforce part from instance url
          orgLabel = branchAndOrg.instanceUrl;
          orgLabel = orgLabel
            .replace(
              /https?:\/\/|\.sandbox\.my\.salesforce\.com|\.my\.salesforce\.com/g,
              "",
            )
            .replace(/\/$/, ""); // Remove http(s) and trailing slash
          orgLabel = orgLabel.replace(/\.sandbox$/, ""); // Remove .sandbox if present
          orgLabel = orgLabel.replace(/\.my$/, ""); // Remove .my if present
          orgLabel = orgLabel.replace(/\.salesforce$/, ""); // Remove .salesforce if present
        }
        const orgClass =
          branchAndOrg.orgType === "prod"
            ? "salesforceProd"
            : "salesforceMajor";

        this.salesforceOrgs.push({
          name: branchAndOrg.branchName,
          nodeName: nodeName,
          label: orgLabel,
          class: orgClass,
          level: branchAndOrg.level,
          group: branchAndOrg.branchName, // Keep group for dev orgs
          instanceUrl: branchAndOrg.instanceUrl,
        });

        // Get job status info for this org
        const jobsStatus = branchAndOrg.jobsStatus || "unknown";
        const hasJobs = branchAndOrg.jobs && branchAndOrg.jobs.length > 0;
        const jobUrl = hasJobs ? branchAndOrg.jobs[0].webUrl : null;

        // The label is built in addLinks(): a compact status chip when job
        // info exists, the plain "Deployment" label otherwise.
        this.deployLinks.push({
          source: gitBranch.nodeName,
          target: nodeName,
          type: "sfDeploy",
          label: t("deployment"),
          level: branchAndOrg.level,
          hasJobs: hasJobs,
          jobUrl: jobUrl,
          jobsStatus: jobsStatus,
        });
      }
    }

    // Sort orgs & links
    this.salesforceOrgs = sortArray(this.salesforceOrgs, {
      by: ["level", "name"],
      order: ["desc", "asc"],
    });
    this.deployLinks = sortArray(this.deployLinks, {
      by: ["level", "source"],
      order: ["desc", "asc"],
    });
    this.sbDevLinks = sortArray(this.sbDevLinks, {
      by: ["level", "source"],
      order: ["asc", "asc"],
    });
  }

  private generateMermaidLines(options?: { onlyMajorBranches?: boolean }) {
    /* jscpd:ignore-start */
    this.mermaidLines.push("%%{init: {");
    this.mermaidLines.push('  "flowchart": {');
    this.mermaidLines.push('    "curve": "monotoneX"');
    this.mermaidLines.push("  }");
    this.mermaidLines.push("}}%%");
    this.mermaidLines.push("flowchart LR");
    this.mermaidLines.push("");

    // Git branches
    const gitBranchesLabel = t("gitBranches");
    this.mermaidLines.push(
      this.indent(`subgraph GitBranches [${gitBranchesLabel}]`, 1),
    );
    // No "direction" here on purpose: the branch promotion chain must flow left to
    // right like the parent "flowchart LR". Declaring "direction TB" turned the chain
    // vertical from mermaid 11.16 on, which started honoring it (11.15 ignored it).
    for (const gitBranch of this.gitBranches) {
      if (gitBranch.class === "gitFeatureGroup") {
        // "+N more" group nodes use the stacked-rectangle shape (mermaid
        // >= 11.3) so they read as an aggregate of several folded branches.
        // The @{} node syntax has no ::: shorthand, so the class is assigned
        // with a separate "class" statement.
        this.mermaidLines.push(
          this.indent(
            `${gitBranch.nodeName}@{ shape: st-rect, label: "${gitBranch.label}" }`,
            2,
          ),
        );
        this.mermaidLines.push(
          this.indent(`class ${gitBranch.nodeName} gitFeatureGroup`, 2),
        );
      } else {
        // Rounded rectangle: SVG rects ignore border-radius from classDef, so
        // rounding must come from the node shape itself.
        this.mermaidLines.push(
          this.indent(
            `${gitBranch.nodeName}("${gitBranch.label}"):::${gitBranch.class}`,
            2,
          ),
        );
      }
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Salesforce orgs (only if there are any major orgs)
    const majorOrgs = this.salesforceOrgs.filter((salesforceOrg) =>
      ["salesforceProd", "salesforceMajor"].includes(salesforceOrg.class),
    );
    if (majorOrgs.length > 0) {
      const salesforceOrgsLabel = t("salesforceOrgs");
      this.mermaidLines.push(
        this.indent(`subgraph SalesforceOrgs [${salesforceOrgsLabel}]`, 1),
      );
      this.mermaidLines.push(this.indent("direction TB", 2));
      for (const salesforceOrg of majorOrgs) {
        // Node click is handled in the pipeline webview to run sf org open with proper targeting.
        const nodeLine = `${salesforceOrg.nodeName}(["${CLOUD_ICON_SVG} ${this.escapeHtmlLabel(salesforceOrg.label)}"]):::${salesforceOrg.class}`;
        this.mermaidLines.push(this.indent(nodeLine, 2));
      }
      this.mermaidLines.push(this.indent("end", 1));
      this.mermaidLines.push("");
    }

    // Salesforce dev orgs (only if there are any dev orgs in the group, and only render each group once)
    const renderedDevGroups = new Set();
    for (const devOrgsGroup of this.salesforceDevOrgsGroup) {
      if (renderedDevGroups.has(devOrgsGroup)) {
        continue;
      }
      renderedDevGroups.add(devOrgsGroup);
      const devOrgs = this.salesforceOrgs.filter(
        (salesforceOrg) =>
          salesforceOrg.group === devOrgsGroup &&
          (salesforceOrg.name.startsWith("feature") ||
            salesforceOrg.name.startsWith("hotfix")),
      );
      if (devOrgs.length > 0 && !(options && options.onlyMajorBranches)) {
        this.mermaidLines.push(
          this.indent(
            `subgraph SalesforceDevOrgs${devOrgsGroup} [Salesforce Dev Orgs]`,
            1,
          ),
        );
        this.mermaidLines.push(this.indent("direction TB", 2));
        for (const salesforceOrg of devOrgs) {
          this.mermaidLines.push(
            this.indent(
              `${salesforceOrg.nodeName}(["${CLOUD_ICON_SVG} ${this.escapeHtmlLabel(salesforceOrg.label)}"]):::${salesforceOrg.class}`,
              2,
            ),
          );
        }
        this.mermaidLines.push(this.indent("end", 1));
        this.mermaidLines.push("");
      }
    }

    // Links
    this.addLinks(this.gitLinks);
    this.addLinks(this.deployLinks);
    this.addLinks(this.sbDevLinks);
    this.addLinks(this.retrofitLinks);

    // Classes and styles (only include those that are actually used)
    const usedClasses = new Set<string>();
    const usedStyles = new Set<string>();
    for (const line of this.mermaidLines) {
      // Find class usage: ...:::className]
      const classMatch = line.match(/:::([a-zA-Z0-9_-]+)/);
      if (classMatch) {
        usedClasses.add(classMatch[1]);
      }
      // Find class-statement usage: class NodeName className
      // (used for @{}-shaped nodes, which have no ::: shorthand)
      const classStmtMatch = line.match(
        /^\s*class\s+[a-zA-Z0-9_-]+\s+([a-zA-Z0-9_-]+)\s*$/,
      );
      if (classStmtMatch) {
        usedClasses.add(classStmtMatch[1]);
      }
      // Find style usage: style SubgraphName ...
      const styleMatch = line.match(/^\s*style\s+([a-zA-Z0-9_-]+)/);
      if (styleMatch) {
        usedStyles.add(styleMatch[1]);
      }
    }

    // Add dynamic SalesforceDevOrgs styles if used
    const isDark = this.colorTheme === "dark";
    for (const salesforceDevOrgsGroup of this.salesforceDevOrgsGroup) {
      if (
        this.mermaidLines.some((l) =>
          l.includes(`subgraph SalesforceDevOrgs${salesforceDevOrgsGroup} `),
        )
      ) {
        const devOrgStyle = isDark
          ? `style SalesforceDevOrgs${salesforceDevOrgsGroup} fill:#1a1a1a,color:#d8e6fe,stroke:#0176d3,stroke-width:1px;`
          : `style SalesforceDevOrgs${salesforceDevOrgsGroup} fill:#EBF6FF,color:#000000,stroke:#0077B5,stroke-width:1px;`;
        this.mermaidLines.push(devOrgStyle);
        usedStyles.add(`SalesforceDevOrgs${salesforceDevOrgsGroup}`);
      }
    }

    // Filter classDef/style lines to only those that are used
    const allClassAndStyleLines = this.listClassesAndStyles();
    for (const line of allClassAndStyleLines) {
      const classDefMatch = line.match(/classDef\s+([a-zA-Z0-9_-]+)/);
      if (classDefMatch && usedClasses.has(classDefMatch[1])) {
        this.mermaidLines.push(line);
      }
      const styleMatch = line.match(/style\s+([a-zA-Z0-9_-]+)/);
      if (styleMatch && usedStyles.has(styleMatch[1])) {
        this.mermaidLines.push(line);
      }
    }
    /* jscpd:ignore-end */

    const allLinks = [
      ...this.gitLinks,
      ...this.deployLinks,
      ...this.sbDevLinks,
      ...this.retrofitLinks,
    ];
    let pos = 0;
    const positions: any = {};
    for (const link of allLinks) {
      // renderType carries the status-specific variant (running/pending/failed)
      // computed in addLinks(); fall back to the base type.
      const styleType = link.renderType || link.type;
      if (!positions[styleType]) {
        positions[styleType] = [];
      }
      positions[styleType].push(pos);
      pos++;
    }

    const linksDef = this.listLinksDef();
    for (const key of Object.keys(positions)) {
      const styleDef = linksDef[key];
      if (!styleDef) {
        continue;
      }
      this.mermaidLines.push(
        `linkStyle ${positions[key].join(",")} ${styleDef}`,
      );
    }

    // Add click callbacks for all branches (must be at the end)
    for (const gitBranch of this.gitBranches) {
      this.mermaidLines.push(
        `click ${gitBranch.nodeName} call handleMermaidClick() "Show ${gitBranch.name}"`,
      );
    }
  }

  private addLinks(links: any[]) {
    for (const link of links) {
      if (link.type === "gitMerge" || link.type === "gitFeatureMerge") {
        const label = link.label;
        // PR job status drives the semantic edge variant: blue animated for
        // running, amber for pending, red for failed (see listLinksDef).
        const jobStatus = this.normalizeJobStatus(
          link.activePR ? link.activePR.jobsStatus : link.jobsStatus,
        );
        link.renderType = this.statusRenderType(link.type, jobStatus);
        const arrow = link.type === "gitMerge" ? "==>" : "-->";
        this.mermaidLines.push(
          this.indent(`${link.source} ${arrow}|"${label}"| ${link.target}`, 1),
        );
      } else if (link.type === "sfDeploy") {
        // Compact status chip, clickable to the CI job when a URL exists
        let label = link.label;
        if (link.hasJobs) {
          const status = this.normalizeJobStatus(link.jobsStatus);
          label = this.buildStatusChip(
            status,
            link.jobUrl,
            `${t("deployment")} - ${status}`,
          );
          link.renderType = this.statusRenderType("sfDeploy", status);
        }
        this.mermaidLines.push(
          this.indent(`${link.source} -.->|"${label}"| ${link.target}`, 1),
        );
      } else if (link.type === "sfPushPull") {
        this.mermaidLines.push(
          this.indent(`${link.source} <-. ${link.label} .-> ${link.target}`, 1),
        );
      }
    }
    this.mermaidLines.push("");
  }

  /**
   * Build the clickable chip shown on a PR merge edge: the PR number in a
   * pill whose colored dot carries the job status (replaces emoji + inline
   * styled underlined links; styling lives in pipeline.css, theme-aware).
   */
  private buildPrChip(pullRequest: PullRequest): string {
    const status = this.normalizeJobStatus(pullRequest.jobsStatus);
    const text = `#${pullRequest.number || pullRequest.id}`;
    const title = this.escapeHtmlLabel(pullRequest.title || text);
    if (pullRequest.webUrl) {
      return `<a href='${pullRequest.webUrl}' target='_blank' class='hardis-pill hardis-chip hardis-status-${status}' title='${title}'>${text}</a>`;
    }
    return `<span class='hardis-pill hardis-chip hardis-status-${status}'>${text}</span>`;
  }

  /**
   * Build a compact status chip (dot + glyph) for deploy links and aggregated
   * "+N more" links, clickable when a job URL is available.
   */
  private buildStatusChip(
    status: JobStatus,
    url: string | null = null,
    title: string = "",
  ): string {
    const normalized = this.normalizeJobStatus(status);
    const glyphMap: Record<JobStatus, string> = {
      running: "⟳",
      pending: "…",
      success: "✓",
      failed: "✕",
      unknown: "?",
    };
    const glyph = glyphMap[normalized];
    const titleAttr = title ? ` title='${title}'` : "";
    if (url) {
      return `<a href='${url}' target='_blank' class='hardis-pill hardis-chip hardis-status-${normalized}'${titleAttr}>${glyph}</a>`;
    }
    return `<span class='hardis-pill hardis-chip hardis-status-${normalized}'${titleAttr}>${glyph}</span>`;
  }

  private normalizeJobStatus(status: any): JobStatus {
    return ["running", "pending", "success", "failed"].includes(status)
      ? status
      : "unknown";
  }

  /**
   * Map a base link type + job status to the linkStyle variant name emitted by
   * listLinksDef (e.g. gitFeatureMerge + running -> gitFeatureMergeRunning).
   * Success and unknown keep the base style.
   */
  private statusRenderType(baseType: string, status: JobStatus): string {
    if (["running", "pending", "failed"].includes(status)) {
      return baseType + status.charAt(0).toUpperCase() + status.slice(1);
    }
    return baseType;
  }

  /**
   * Shorten long feature branch names for node labels: drop the common
   * "feature/" prefix noise and middle-truncate. The full name stays available
   * in the node click tooltip.
   */
  private shortenBranchName(branchName: string | undefined): string {
    let short = (branchName || "").replace(/^feature\//, "");
    if (short.length > 32) {
      short = short.slice(0, 24) + "…" + short.slice(-6);
    }
    return short;
  }

  /** Minimal HTML escaping for text injected into mermaid HTML labels. */
  private escapeHtmlLabel(text: string): string {
    return (text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  listClassesAndStyles(): string[] {
    // SLDS palette pairs (light / dark): branches in the blue family (navy for
    // prod, cloud blue for majors, quiet cards for features), orgs as tinted
    // pills (blue for sandboxes, green for production), subgraphs as hairline
    // frames that step back behind the content.
    // Only use properties supported by Mermaid classDef/style syntax; node
    // rounding comes from the node shapes, not classDef (SVG ignores
    // border-radius).
    const isDark = this.colorTheme === "dark";

    const classesAndStyles = isDark
      ? `
  classDef salesforceDev fill:#1b232d,stroke:#3c7cb8,stroke-width:1.5px,color:#a9cff7,font-weight:500;
  classDef salesforceMajor fill:#152b3f,stroke:#3c7cb8,stroke-width:1.5px,color:#a9cff7,font-weight:500;
  classDef salesforceProd fill:#12301d,stroke:#3e9b58,stroke-width:2px,color:#a5e2b6,font-weight:600;
  classDef gitMajor fill:#0b5cab,stroke:#3489db,stroke-width:1.5px,color:#eaf3ff,font-weight:600;
  classDef gitMain fill:#1b96ff,stroke:#57a3fd,stroke-width:1.5px,color:#032d60,font-weight:700;
  classDef gitFeature fill:#1b232d,stroke:#33414e,stroke-width:1.25px,color:#c4d2de,font-weight:400;
  classDef gitFeatureGroup fill:#152b3f,stroke:#3489db,stroke-width:1.5px,stroke-dasharray:3 3,color:#a9cff7,font-weight:600;
  style GitBranches fill:#161d25,color:#7a8b9c,stroke:#2b3642,stroke-width:1px;
  style SalesforceOrgs fill:#161d25,color:#7a8b9c,stroke:#2b3642,stroke-width:1px;
  style SalesforceDevOrgs fill:#161d25,color:#7a8b9c,stroke:#2b3642,stroke-width:1px;
  `
      : `
  classDef salesforceDev fill:#f4f8fb,stroke:#67afe4,stroke-width:1.5px,color:#014486,font-weight:500;
  classDef salesforceMajor fill:#eaf5fe,stroke:#67afe4,stroke-width:1.5px,color:#014486,font-weight:500;
  classDef salesforceProd fill:#ebf7ee,stroke:#2e844a,stroke-width:2px,color:#1e5e37,font-weight:600;
  classDef gitMajor fill:#0176d3,stroke:#0b5cab,stroke-width:1.5px,color:#ffffff,font-weight:600;
  classDef gitMain fill:#032d60,stroke:#032d60,stroke-width:1.5px,color:#ffffff,font-weight:700;
  classDef gitFeature fill:#ffffff,stroke:#d5dfe9,stroke-width:1.25px,color:#24435f,font-weight:400;
  classDef gitFeatureGroup fill:#eaf5fe,stroke:#0176d3,stroke-width:1.5px,stroke-dasharray:3 3,color:#014486,font-weight:600;
  style GitBranches fill:#f8fbfd,color:#5b6c7e,stroke:#dce5ee,stroke-width:1px;
  style SalesforceOrgs fill:#f8fbfd,color:#5b6c7e,stroke:#dce5ee,stroke-width:1px;
  style SalesforceDevOrgs fill:#f8fbfd,color:#5b6c7e,stroke:#dce5ee,stroke-width:1px;
  `;
    return classesAndStyles.split("\n");
  }

  private listLinksDef(): any {
    // Edge styles per link kind, plus semantic status variants generated for
    // active CI jobs: blue = running (animated by pipeline.css), amber =
    // pending, red = failed. Green stays reserved for successful deployments.
    const isDark = this.colorTheme === "dark";

    const baseDefs: Record<string, string> = isDark
      ? {
          gitMerge:
            "stroke:#57a3fd,stroke-width:2.5px,color:#a9cff7,opacity:1;",
          gitFeatureMerge:
            "stroke:#4a5a6b,stroke-width:1.25px,stroke-dasharray:6 4,color:#8fa1b3,opacity:1;",
          sfDeploy:
            "stroke:#3e9b58,stroke-width:1.5px,color:#52c36e,opacity:1;",
          sfPushPull:
            "stroke:#57a3fd,stroke-width:1.5px,color:#8fa1b3,opacity:1;",
        }
      : {
          gitMerge:
            "stroke:#0176d3,stroke-width:2.5px,color:#032d60,opacity:1;",
          gitFeatureMerge:
            "stroke:#aebfce,stroke-width:1.25px,stroke-dasharray:6 4,color:#66788a,opacity:1;",
          sfDeploy:
            "stroke:#2e844a,stroke-width:1.5px,color:#2e844a,opacity:1;",
          sfPushPull:
            "stroke:#0176d3,stroke-width:1.5px,color:#66788a,opacity:1;",
        };

    const statusColors: Record<string, string> = isDark
      ? { Running: "#1b96ff", Pending: "#e2a336", Failed: "#f27065" }
      : { Running: "#1b96ff", Pending: "#dd7a01", Failed: "#ba0517" };
    const statusWidths: Record<string, string> = {
      gitMerge: "2.5px",
      gitFeatureMerge: "2px",
      sfDeploy: "2px",
    };

    const defs: Record<string, string> = { ...baseDefs };
    for (const baseType of Object.keys(statusWidths)) {
      const dash =
        baseType === "gitFeatureMerge" ? ",stroke-dasharray:6 4" : "";
      for (const [statusSuffix, color] of Object.entries(statusColors)) {
        defs[`${baseType}${statusSuffix}`] =
          `stroke:${color},stroke-width:${statusWidths[baseType]}${dash},color:${color},opacity:1;`;
      }
    }
    return defs;
  }

  private indent(str: string, number: number): string {
    return " ".repeat(number) + str;
  }

  /**
   * Sanitize branch names for use as Mermaid node names.
   * Removes or replaces characters that can cause Mermaid parsing issues.
   */
  private sanitizeNodeName(branchName: string | undefined): string {
    if (!branchName) {
      return "unknown";
    }
    return branchName
      .replace(/[^a-zA-Z0-9_-]/g, "_") // Replace special chars with underscore
      .replace(/_{2,}/g, "_") // Replace multiple underscores with single
      .replace(/^_+|_+$/g, "") // Remove leading/trailing underscores
      .replace(/-+/g, "-"); // Replace multiple hyphens with single
  }
}
