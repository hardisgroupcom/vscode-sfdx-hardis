import {
  PromotionBranchConfig,
  userStoryPullRequests,
  visiblePullRequests,
} from "./promotionBranchUtils";
import { sortArray } from "../sortUtils";
import { prettifyFieldName } from "../stringUtils";
import { isMajorBranch, isPreprod, isProduction } from "../orgConfigUtils";
import { PullRequest, JobStatus } from "../gitProviders/types";
import {
  anyMergeConflict,
  hasMergeConflicts,
} from "../gitProviders/mergeStatus";
import { GitProvider } from "../gitProviders/gitProvider";
import {
  isBackpromoteBranchName,
  parsePromotionBranchName,
} from "./promotionBranchUtils";
import { t } from "../../i18n/i18n";
import { MajorBranchCheckView } from "./majorBranchCheckUtils";
import { DevOrgView } from "./devOrgsUtils";

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
  // One subgraph per target branch of the development orgs drawn: its id and its branch
  private salesforceDevOrgsGroup: Array<{ id: string; branch: string }> = [];
  private devOrgNodes: any[] = [];
  // "+" node of a target branch that no development org targets: its node and its branch
  private devOrgAddNodes: Array<{ nodeName: string; branch: string }> = [];
  private gitLinks: any[] = [];
  private deployLinks: any[] = [];
  private sbDevLinks: any[] = [];
  private retrofitLinks: any[] = [];
  private mermaidLines: string[] = [];
  private colorTheme: string = "light";
  private featureBranchGroupThreshold: number =
    DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD;
  private featureBranchGroups: FeatureBranchGroup[] = [];
  // Promotion branches switch: without it the node counters would leave the vehicles out for every
  // project, including those that never enabled the feature
  private promotionBranchConfig: PromotionBranchConfig = {
    enabled: false,
    allowedSteps: [],
  };
  // Last major branch deployment check of each major branch, by branch name: empty unless the
  // project enables enableMajorBranchDeploymentCheck (see majorBranchCheckUtils.ts)
  private majorBranchChecks: Record<string, MajorBranchCheckView | null> = {};
  // Development orgs registered by sfdx-hardis (sf hardis:project:dev-org:list), all of them: the
  // display mode of each build picks the ones drawn
  private devOrgs: DevOrgView[] = [];

  constructor(
    branchesAndOrgs: any[],
    isAuthenticated: boolean,
    openPullRequests: PullRequest[] = [],
    gitProvider: GitProvider | null = null,
    colorTheme: string = "light",
    featureBranchGroupThreshold: number = DEFAULT_FEATURE_BRANCH_GROUP_THRESHOLD,
    promotionBranchConfig: PromotionBranchConfig = {
      enabled: false,
      allowedSteps: [],
    },
    majorBranchChecks: Record<string, MajorBranchCheckView | null> = {},
    devOrgs: DevOrgView[] = [],
  ) {
    this.promotionBranchConfig = promotionBranchConfig;
    this.devOrgs = Array.isArray(devOrgs) ? devOrgs : [];
    this.majorBranchChecks = majorBranchChecks || {};
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

  /** The "+" nodes of the last build, to register a development org on their branch */
  public getDevOrgAddNodes(): Array<{ nodeName: string; branch: string }> {
    return this.devOrgAddNodes;
  }

  /**
   * Build the mermaid diagram.
   * @param options.format 'list' or 'string'
   * @param options.withMermaidTag wrap in code block
   * @param options.onlyMajorBranches if true, only major branches (prod, preprod, uat, uatrun, integration) and their links are included (no dev/feature/hotfix branches or dev orgs)
   * @param options.devOrgs true draws every development org next to the branch it targets (with onlyMajorBranches, the "Dev orgs" view of the pipeline)
   * @param options.devOrgAddBranches with devOrgs, the target branches that get a "+" node when no development org targets them
   */
  public build(options: {
    format: "list" | "string";
    withMermaidTag: boolean;
    onlyMajorBranches?: boolean;
    devOrgs?: boolean;
    devOrgAddBranches?: string[];
  }): string | string[] {
    // Reset all arrays for each build
    this.gitBranches = [];
    this.salesforceOrgs = [];
    this.salesforceDevOrgsGroup = [];
    this.devOrgNodes = [];
    this.devOrgAddNodes = [];
    this.gitLinks = [];
    this.deployLinks = [];
    this.sbDevLinks = [];
    this.retrofitLinks = [];
    this.mermaidLines = [];
    this.featureBranchGroups = [];

    this.listGitBranchesAndLinks();
    this.listSalesforceOrgsAndLinks();
    if (options.devOrgs) {
      this.listDevOrgsAndLinks(options.devOrgAddBranches || []);
    }

    if (options.onlyMajorBranches) {
      // Filter out feature/hotfix/dev branches (a major branch node can carry the class of its
      // deployment check instead of gitMain / gitMajor)
      this.gitBranches = this.gitBranches.filter((b) => b.isMajorNode === true);
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
      // Development orgs stay only when asked for
      if (!options.devOrgs) {
        this.salesforceDevOrgsGroup = [];
        this.devOrgNodes = [];
        this.devOrgAddNodes = [];
        this.sbDevLinks = [];
      }
    }

    this.generateMermaidLines();

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
        // Find PRs that match BOTH source and target branches. A promotion Pull Request is the
        // promotion of this very step, so it belongs on this edge rather than on a feature node of
        // its own: sfdx-hardis keeps a single one open between two branches.
        const openPullRequestsForThisLink = this.openPullRequests.filter(
          (pr) =>
            (pr.sourceBranch === branchAndOrg.branchName &&
              pr.targetBranch === mergeTarget) ||
            this.isPromotionOfStep(pr, branchAndOrg.branchName, mergeTarget),
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
      const branchPrs = branchAndOrg?.pullRequestsInBranchSinceLastMerge || [];
      // The counter says how many User Stories the branch holds: a Pull Request a promotion took
      // out of this branch belongs to the branch it reached (counting it here too would show the
      // same number twice), and promotion or major-to-major Pull Requests are vehicles, not
      // stories
      const prCount = userStoryPullRequests(
        visiblePullRequests(branchPrs),
        this.branchesAndOrgs.map((entry) => entry.branchName),
        this.promotionBranchConfig,
      ).length;
      // The PR count is embedded as a hidden marker: the webview draws it as
      // a notification-style bubble on the node's top-right corner (see
      // _decorateMermaidNodes in pipeline.js). It cannot be rendered inside
      // the label because foreignObject clips HTML label overflow.
      // The last deployment check of the branch against its org: its status is a dot in the label
      // (it does not rely on the node color alone) and the node class
      const check = this.majorBranchCheckOf(branchAndOrg.branchName);
      const checkDot = check
        ? `<span class='hardis-pill-dot hardis-node-dot hardis-node-check-dot hardis-status-${check.status}'></span> `
        : "";
      const branchLabel =
        checkDot +
        BRANCH_ICON_SVG +
        " " +
        this.escapeHtmlLabel(branchAndOrg.branchName) +
        (prCount > 0
          ? `<span class='hardis-node-count' data-count='${prCount}' style='display:none;'></span>`
          : "");
      const defaultClass = isProduction(branchAndOrg.branchName)
        ? "gitMain"
        : "gitMajor";
      return {
        name: branchAndOrg.branchName,
        nodeName: nodeName,
        label: branchLabel,
        class: check ? this.majorBranchCheckClass(check) : defaultClass,
        isMajorNode: true,
        majorBranchCheck: check,
        level: branchAndOrg.level,
        instanceUrl: branchAndOrg.instanceUrl,
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
        ) &&
        // A promotion already drawn on the edge between its two branches must not also get a
        // feature node: the same Pull Request number would appear twice in the diagram
        !this.isPromotionDrawnOnAnEdge(pullRequest) &&
        // A backpromote branch never carries work of its own: nothing to draw
        !isBackpromoteBranchName(pullRequest.sourceBranch),
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
      // A Pull Request into a branch the pipeline configuration of this checkout does not declare
      // (a stale local branch, a typo in a target): without a node of its own, mermaid draws the
      // raw node id ("preprodBranch") outside of the Git Branches box
      const targetNodeName = this.sanitizeNodeName(targetBranch) + "Branch";
      // Not when the target is itself the branch of an open Pull Request (stacked Pull
      // Requests): it gets its feature node from its own group, whatever the order of the groups
      if (
        targetBranch &&
        !this.gitBranches.find((b) => b.nodeName === targetNodeName) &&
        !featurePullRequests.find((pr) => pr.sourceBranch === targetBranch)
      ) {
        this.gitBranches.push({
          name: targetBranch,
          nodeName: targetNodeName,
          label: BRANCH_ICON_SVG + " " + this.escapeHtmlLabel(targetBranch),
          class: "gitFeature",
          level: featureBranchLevel + 1,
        });
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
   * True when this open Pull Request is the promotion of the given pipeline step: its branch is
   * named promotion/<source>/<target>/... for exactly these two branches, and it really targets
   * that branch (a promotion retargeted by hand belongs to no step). Only when the project enabled
   * promotion branches: otherwise such a branch is an ordinary feature branch, which is also how
   * the deployment jobs treat it.
   */
  private isPromotionOfStep(
    pullRequest: PullRequest,
    sourceBranch: string,
    targetBranch: string,
  ): boolean {
    if (!this.promotionBranchConfig.enabled) {
      return false;
    }
    const parts = parsePromotionBranchName(pullRequest.sourceBranch || "");
    return (
      parts !== null &&
      parts.sourceBranch.toLowerCase() === (sourceBranch || "").toLowerCase() &&
      parts.targetBranch.toLowerCase() === (targetBranch || "").toLowerCase() &&
      (pullRequest.targetBranch || "").toLowerCase() ===
        (targetBranch || "").toLowerCase()
    );
  }

  /** True when a merge edge of the diagram already carries this promotion Pull Request. */
  private isPromotionDrawnOnAnEdge(pullRequest: PullRequest): boolean {
    if (!this.promotionBranchConfig.enabled) {
      return false;
    }
    return this.branchesAndOrgs.some((branchAndOrg) =>
      (branchAndOrg.mergeTargets || []).some((mergeTarget: string) =>
        this.isPromotionOfStep(
          pullRequest,
          branchAndOrg.branchName,
          mergeTarget,
        ),
      ),
    );
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
      label: this.buildStatusChip(
        aggregateStatus,
        null,
        "",
        anyMergeConflict(foldedPrs),
      ),
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

  /**
   * One node per development org drawn, in a subgraph of its target branch, linked to the node of
   * that branch. An org whose target branch is not a branch of the diagram is not drawn. The
   * number of Pull Requests it misses is a hidden count marker, drawn as a bubble by the webview.
   */
  private listDevOrgsAndLinks(addBranches: string[]): void {
    for (const devOrg of this.devOrgs) {
      const branchNodeName =
        this.sanitizeNodeName(devOrg.targetBranch) + "Branch";
      if (
        !devOrg.targetBranch ||
        !this.gitBranches.some((branch) => branch.nodeName === branchNodeName)
      ) {
        continue;
      }
      const groupId = this.sanitizeNodeName(devOrg.targetBranch);
      if (!this.salesforceDevOrgsGroup.some((group) => group.id === groupId)) {
        this.salesforceDevOrgsGroup.push({
          id: groupId,
          branch: devOrg.targetBranch,
        });
      }
      this.devOrgNodes.push({
        name: devOrg.name,
        nodeName: devOrg.nodeName,
        label: this.devOrgLabel(devOrg),
        class: this.devOrgClass(devOrg),
        group: groupId,
      });
      // A plain dotted line, no arrowhead: an org never deploys to a branch, and the org as the
      // source of the line puts it in the column left of its branch. The Pull Requests to
      // backpromote are a chip on that line.
      this.sbDevLinks.push({
        source: devOrg.nodeName,
        target: branchNodeName,
        type: "sfPushPull",
        label: this.devOrgBehindChip(devOrg),
        group: groupId,
        name: devOrg.name,
      });
    }
    // A target branch no org targets yet: a "+" node that registers one
    for (const branch of addBranches) {
      const branchNodeName = this.sanitizeNodeName(branch) + "Branch";
      if (
        !this.gitBranches.some(
          (gitBranch) => gitBranch.nodeName === branchNodeName,
        ) ||
        this.devOrgNodes.some(
          (node) => node.group === this.sanitizeNodeName(branch),
        )
      ) {
        continue;
      }
      const groupId = this.sanitizeNodeName(branch);
      this.salesforceDevOrgsGroup.push({ id: groupId, branch });
      const nodeName = `${groupId}DevOrgAdd`;
      const title = String(t("devOrgAddNodeTitle", { branch })).replace(
        /['"]/g,
        "",
      );
      this.devOrgNodes.push({
        name: "",
        nodeName,
        label: `<span class='hardis-dev-org-add' title='${title}'>+</span>`,
        class: "salesforceDevAdd",
        group: groupId,
      });
      this.devOrgAddNodes.push({ nodeName, branch });
      this.sbDevLinks.push({
        source: nodeName,
        target: branchNodeName,
        type: "sfPushPull",
        label: "",
        group: groupId,
        name: "",
      });
    }
    this.devOrgNodes = sortArray(this.devOrgNodes, {
      by: ["group", "name"],
      order: ["asc", "asc"],
    });
    this.sbDevLinks = sortArray(this.sbDevLinks, {
      by: ["group", "name"],
      order: ["asc", "asc"],
    });
  }

  // Name of the org only. The owner and the users are in the details window and on the
  // dashboard; what it misses is on the arrow that reaches it.
  private devOrgLabel(devOrg: DevOrgView): string {
    return `${CLOUD_ICON_SVG} ${this.escapeHtmlLabel(devOrg.name)}`;
  }

  // Orange chip "↓ 3 PRs" of the Pull Requests to backpromote, nothing when the org has them all
  // or when they are not known yet. Not the bubble of a branch node, which counts the Pull
  // Requests waiting to be promoted: a different meaning, so a different shape and place.
  private devOrgBehindChip(devOrg: DevOrgView): string {
    const behindCount = devOrg.behind?.count || 0;
    if (behindCount === 0) {
      return "";
    }
    const countText = `${behindCount}${devOrg.behind?.cutOff ? "+" : ""}`;
    const text =
      countText === "1"
        ? t("devOrgBehindChipOne")
        : t("devOrgBehindChip", { count: countText });
    const title = String(
      t("devOrgBehindChipTitle", {
        count: countText,
        branch: devOrg.targetBranch,
      }),
    ).replace(/['"]/g, "");
    return `<span class='hardis-pill hardis-chip hardis-status-pending hardis-chip-backpromote' data-behind='${countText}' data-dev-org='${devOrg.nodeName}' title='${title}'>${this.escapeHtmlLabel(String(text))}</span>`;
  }

  // A stale org stands out first; an org whose missing Pull Requests are not known yet is muted
  private devOrgClass(devOrg: DevOrgView): string {
    if (devOrg.stale) {
      return "salesforceDevStale";
    }
    if (devOrg.behind === null) {
      return "salesforceDevUnknown";
    }
    return "salesforceDev";
  }

  private generateMermaidLines() {
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

    // Development orgs: one subgraph per target branch, each org linked to that branch
    // (none unless the build asked for them)
    for (const devOrgsGroup of this.salesforceDevOrgsGroup) {
      const devOrgNodes = this.devOrgNodes.filter(
        (devOrgNode) => devOrgNode.group === devOrgsGroup.id,
      );
      if (devOrgNodes.length === 0) {
        continue;
      }
      // A quoted subgraph title: only a double quote or a bracket could end it
      const groupLabel = String(
        t("devOrgsGroupLabel", { branch: devOrgsGroup.branch }),
      ).replace(/["[\]]/g, "");
      this.mermaidLines.push(
        this.indent(
          `subgraph SalesforceDevOrgs${devOrgsGroup.id} ["${groupLabel}"]`,
          1,
        ),
      );
      this.mermaidLines.push(this.indent("direction TB", 2));
      for (const devOrgNode of devOrgNodes) {
        this.mermaidLines.push(
          this.indent(
            `${devOrgNode.nodeName}(["${devOrgNode.label}"]):::${devOrgNode.class}`,
            2,
          ),
        );
      }
      this.mermaidLines.push(this.indent("end", 1));
      this.mermaidLines.push("");
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

    // Development org subgraphs: the hairline frame of the other subgraphs, dashed
    const isDark = this.colorTheme === "dark";
    for (const salesforceDevOrgsGroup of this.salesforceDevOrgsGroup) {
      const groupName = `SalesforceDevOrgs${salesforceDevOrgsGroup.id}`;
      if (this.mermaidLines.some((l) => l.includes(`subgraph ${groupName} `))) {
        const devOrgStyle = isDark
          ? `style ${groupName} fill:#161d25,color:#7a8b9c,stroke:#2b3642,stroke-width:1px,stroke-dasharray:4 3;`
          : `style ${groupName} fill:#f8fbfd,color:#5b6c7e,stroke:#dce5ee,stroke-width:1px,stroke-dasharray:4 3;`;
        this.mermaidLines.push(devOrgStyle);
        usedStyles.add(groupName);
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
      const tooltip = gitBranch.majorBranchCheck
        ? this.majorBranchCheckTooltip(
            gitBranch.name,
            gitBranch.majorBranchCheck,
          )
        : `Show ${gitBranch.name}`;
      this.mermaidLines.push(
        `click ${gitBranch.nodeName} call handleMermaidClick() "${tooltip}"`,
      );
    }
  }

  /**
   * The check of a major branch the diagram shows: only a status it can draw. Unknown (a check
   * that never ran its job) leaves the node as it is without the feature.
   */
  private majorBranchCheckOf(branchName: string): MajorBranchCheckView | null {
    const check = this.majorBranchChecks[branchName];
    return check &&
      ["success", "failed", "running", "pending"].includes(check.status)
      ? check
      : null;
  }

  /**
   * Node class of a major branch with a deployment check: green when the branch deploys, red when
   * it does not, a lighter dashed version of both when the result is stale, and the usual blue
   * while a check runs or waits for a runner (the webview makes it pulse).
   */
  private majorBranchCheckClass(check: MajorBranchCheckView): string {
    if (check.status === "running" || check.status === "pending") {
      return "gitBranchCheckRunning";
    }
    const base =
      check.status === "success"
        ? "gitBranchCheckSuccess"
        : "gitBranchCheckFailed";
    return check.stale ? `${base}Stale` : base;
  }

  // Tooltip of the node of a major branch with a deployment check. Mermaid ends it at a double quote
  private majorBranchCheckTooltip(
    branchName: string,
    check: MajorBranchCheckView,
  ): string {
    const statusLabels: Record<string, string> = {
      success: t("jobStatusSuccess"),
      failed: t("jobStatusFailed"),
      running: t("jobStatusRunning"),
      pending: t("jobStatusPending"),
    };
    const params = {
      branch: branchName,
      status: statusLabels[check.status] || t("jobStatusUnknown"),
    };
    const tooltip = check.stale
      ? t("majorBranchCheckStaleTooltip", params)
      : t("majorBranchCheckTooltip", params);
    return String(tooltip).replace(/"/g, "'");
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
        // Mermaid refuses an empty label: no label, no pipes
        const arrow = link.label ? `-.-|"${link.label}"|` : "-.-";
        this.mermaidLines.push(
          this.indent(`${link.source} ${arrow} ${link.target}`, 1),
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
    // The colored dot already carries the CI job status, so a merge conflict is shown on a
    // second axis: a warning glyph and an outline, keeping both readable on the same chip
    const conflict = hasMergeConflicts(pullRequest);
    const conflictClass = conflict ? " hardis-chip-conflict" : "";
    const label = conflict ? `${this.conflictGlyph()}${text}` : text;
    const title = this.escapeHtmlLabel(
      conflict
        ? `${pullRequest.title || text} - ${t("mergeConflictsTooltip")}`
        : pullRequest.title || text,
    );
    if (pullRequest.webUrl) {
      return `<a href='${pullRequest.webUrl}' target='_blank' class='hardis-pill hardis-chip hardis-status-${status}${conflictClass}' title='${title}'>${label}</a>`;
    }
    return `<span class='hardis-pill hardis-chip hardis-status-${status}${conflictClass}' title='${title}'>${label}</span>`;
  }

  /**
   * Warning glyph prefixed to a chip whose Pull Request(s) no longer merge cleanly.
   *
   * The entity is written the MERMAID way, `#9888;` with no ampersand, because mermaid decodes
   * `#NNN;` in a node label itself before the label ever reaches the browser. Writing the HTML
   * form `&#9888;` here printed a stray `&` in front of the glyph, since mermaid consumed
   * `#9888;` and left the ampersand behind as ordinary text.
   *
   * The legend in pipeline.html is plain HTML, not a mermaid label, so it keeps `&#9888;`.
   */
  private conflictGlyph(): string {
    return "<span class='hardis-conflict-glyph'>#9888;</span> ";
  }

  /**
   * Build a compact status chip (dot + glyph) for deploy links and aggregated
   * "+N more" links, clickable when a job URL is available.
   */
  private buildStatusChip(
    status: JobStatus,
    url: string | null = null,
    title: string = "",
    conflict: boolean = false,
  ): string {
    const normalized = this.normalizeJobStatus(status);
    const glyphMap: Record<JobStatus, string> = {
      running: "⟳",
      pending: "…",
      success: "✓",
      failed: "✕",
      unknown: "?",
    };
    const glyph = conflict
      ? this.conflictGlyph() + glyphMap[normalized]
      : glyphMap[normalized];
    const conflictClass = conflict ? " hardis-chip-conflict" : "";
    const chipTitle = conflict
      ? [title, t("mergeConflictsTooltip")].filter((part) => part).join(" - ")
      : title;
    const titleAttr = chipTitle
      ? ` title='${this.escapeHtmlLabel(chipTitle)}'`
      : "";
    if (url) {
      return `<a href='${url}' target='_blank' class='hardis-pill hardis-chip hardis-status-${normalized}${conflictClass}'${titleAttr}>${glyph}</a>`;
    }
    return `<span class='hardis-pill hardis-chip hardis-status-${normalized}${conflictClass}'${titleAttr}>${glyph}</span>`;
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
  classDef salesforceDevAdd fill:#161d25,stroke:#3c7cb8,stroke-width:1.25px,stroke-dasharray:4 3,color:#a9cff7,font-weight:700,font-size:16px,cursor:pointer;
  classDef salesforceDevStale fill:#2a2116,stroke:#e2a336,stroke-width:1.5px,stroke-dasharray:4 3,color:#f9c97a,font-weight:500;
  classDef salesforceDevUnknown fill:#1b232d,stroke:#5c6e80,stroke-width:1.25px,stroke-dasharray:2 3,color:#c4d2de,font-weight:400;
  classDef salesforceMajor fill:#152b3f,stroke:#3c7cb8,stroke-width:1.5px,color:#a9cff7,font-weight:500;
  classDef salesforceProd fill:#12301d,stroke:#3e9b58,stroke-width:2px,color:#a5e2b6,font-weight:600;
  classDef gitMajor fill:#0b5cab,stroke:#3489db,stroke-width:1.5px,color:#eaf3ff,font-weight:600;
  classDef gitMain fill:#1b96ff,stroke:#57a3fd,stroke-width:1.5px,color:#032d60,font-weight:700;
  classDef gitFeature fill:#1b232d,stroke:#33414e,stroke-width:1.25px,color:#c4d2de,font-weight:400;
  classDef gitFeatureGroup fill:#152b3f,stroke:#3489db,stroke-width:1.5px,stroke-dasharray:3 3,color:#a9cff7,font-weight:600;
  classDef gitBranchCheckSuccess fill:#3e9b58,stroke:#a5e2b6,stroke-width:1.5px,color:#071f0f,font-weight:600;
  classDef gitBranchCheckFailed fill:#f27065,stroke:#fcc0b9,stroke-width:1.5px,color:#3e0105,font-weight:600;
  classDef gitBranchCheckRunning fill:#0b5cab,stroke:#3489db,stroke-width:1.5px,color:#eaf3ff,font-weight:600;
  classDef gitBranchCheckSuccessStale fill:#12301d,stroke:#3e9b58,stroke-width:1.5px,stroke-dasharray:4 3,color:#a5e2b6,font-weight:600;
  classDef gitBranchCheckFailedStale fill:#3e1215,stroke:#f27065,stroke-width:1.5px,stroke-dasharray:4 3,color:#fcc0b9,font-weight:600;
  style GitBranches fill:#161d25,color:#7a8b9c,stroke:#2b3642,stroke-width:1px;
  style SalesforceOrgs fill:#161d25,color:#7a8b9c,stroke:#2b3642,stroke-width:1px;
  style SalesforceDevOrgs fill:#161d25,color:#7a8b9c,stroke:#2b3642,stroke-width:1px;
  `
      : `
  classDef salesforceDev fill:#f4f8fb,stroke:#67afe4,stroke-width:1.5px,color:#014486,font-weight:500;
  classDef salesforceDevAdd fill:#ffffff,stroke:#67afe4,stroke-width:1.25px,stroke-dasharray:4 3,color:#0176d3,font-weight:700,font-size:16px,cursor:pointer;
  classDef salesforceDevStale fill:#fef6e8,stroke:#dd7a01,stroke-width:1.5px,stroke-dasharray:4 3,color:#8c4b02,font-weight:500;
  classDef salesforceDevUnknown fill:#ffffff,stroke:#aebfce,stroke-width:1.25px,stroke-dasharray:2 3,color:#5b6c7e,font-weight:400;
  classDef salesforceMajor fill:#eaf5fe,stroke:#67afe4,stroke-width:1.5px,color:#014486,font-weight:500;
  classDef salesforceProd fill:#ebf7ee,stroke:#2e844a,stroke-width:2px,color:#1e5e37,font-weight:600;
  classDef gitMajor fill:#0176d3,stroke:#0b5cab,stroke-width:1.5px,color:#ffffff,font-weight:600;
  classDef gitMain fill:#032d60,stroke:#032d60,stroke-width:1.5px,color:#ffffff,font-weight:700;
  classDef gitFeature fill:#ffffff,stroke:#d5dfe9,stroke-width:1.25px,color:#24435f,font-weight:400;
  classDef gitFeatureGroup fill:#eaf5fe,stroke:#0176d3,stroke-width:1.5px,stroke-dasharray:3 3,color:#014486,font-weight:600;
  classDef gitBranchCheckSuccess fill:#2e844a,stroke:#1e5e37,stroke-width:1.5px,color:#ffffff,font-weight:600;
  classDef gitBranchCheckFailed fill:#ba0517,stroke:#8e030f,stroke-width:1.5px,color:#ffffff,font-weight:600;
  classDef gitBranchCheckRunning fill:#0176d3,stroke:#0b5cab,stroke-width:1.5px,color:#ffffff,font-weight:600;
  classDef gitBranchCheckSuccessStale fill:#ebf7ee,stroke:#2e844a,stroke-width:1.5px,stroke-dasharray:4 3,color:#1e5e37,font-weight:600;
  classDef gitBranchCheckFailedStale fill:#fef1ee,stroke:#ba0517,stroke-width:1.5px,stroke-dasharray:4 3,color:#8e030f,font-weight:600;
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
            "stroke:#57a3fd,stroke-width:1.5px,color:#8fa1b3,stroke-dasharray:2 3,opacity:1;",
        }
      : {
          gitMerge:
            "stroke:#0176d3,stroke-width:2.5px,color:#032d60,opacity:1;",
          gitFeatureMerge:
            "stroke:#aebfce,stroke-width:1.25px,stroke-dasharray:6 4,color:#66788a,opacity:1;",
          sfDeploy:
            "stroke:#2e844a,stroke-width:1.5px,color:#2e844a,opacity:1;",
          sfPushPull:
            "stroke:#0176d3,stroke-width:1.5px,color:#66788a,stroke-dasharray:2 3,opacity:1;",
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
