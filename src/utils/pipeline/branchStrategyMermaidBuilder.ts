import sortArray from "sort-array";
import { prettifyFieldName } from "../stringUtils";
import { isMajorBranch, isPreprod, isProduction } from "../orgConfigUtils";
import { PullRequest, JobStatus } from "../gitProviders/types";
import { GitProvider } from "../gitProviders/gitProvider";

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

  constructor(
    branchesAndOrgs: any[],
    isAuthenticated: boolean,
    openPullRequests: PullRequest[] = [],
    gitProvider: GitProvider | null = null,
  ) {
    this.branchesAndOrgs = branchesAndOrgs;
    this.openPullRequests = openPullRequests;
    this.isAuthenticated = isAuthenticated;
    this.gitProvider = gitProvider;
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
          linkLabel = `#${activePR.number || activePR.id} ${this.getPrStatusEmoji(activePR.jobsStatus)}`;
        } else if (this.isAuthenticated && this.gitProvider) {
          // Generate "Create PR" link when authenticated and no PR exists
          const createPrUrl = this.gitProvider.getCreatePullRequestUrl(
            branchAndOrg.branchName,
            mergeTarget,
          );
          if (createPrUrl) {
            linkLabel = `<a href='${createPrUrl}' target='_blank' style='color:#0176D3;font-weight:bold;text-decoration:underline;'>Create PR</a>`;
          } else {
            linkLabel = "No PR";
          }
        } else {
          linkLabel = this.isAuthenticated ? "No PR" : "Merge";
        }

        this.gitLinks.push({
          source: nodeName,
          target: this.sanitizeNodeName(mergeTarget) + "Branch",
          type: isMajorLink ? "gitMerge" : "gitFeatureMerge",
          label: linkLabel,
          activePR: activePR,
        });
      }
      const branchLabel = branchAndOrg?.pullRequestsInBranchSinceLastMerge?.length > 1 ? `${branchAndOrg.branchName}<br/>(${branchAndOrg?.pullRequestsInBranchSinceLastMerge?.length})` : branchAndOrg.branchName;
      return {
        name: branchAndOrg.branchName,
        nodeName: nodeName,
        label: branchLabel,
        class: isProduction(branchAndOrg.branchName) ? "gitMain" : "gitMajor",
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

    // Add feature branches and links for PRs whose source branch does not exist in the branchesAndOrgs list
    for (const pullRequest of this.openPullRequests) {
      if (
        !this.branchesAndOrgs.find(
          (b) => b.branchName === pullRequest.sourceBranch,
        )
      ) {
        const level =
          noMergeTargetBranchAndOrg.length > 0
            ? Math.min(...noMergeTargetBranchAndOrg.map((b) => b.level)) + 1
            : 50;
        const nodeName =
          this.sanitizeNodeName(pullRequest.sourceBranch) + "Branch"; // + "Branch" + (this.featureBranchNb + 1);
        this.gitBranches.push({
          name: pullRequest.sourceBranch,
          nodeName: nodeName,
          label: pullRequest.sourceBranch,
          class: "gitFeature",
          level: level,
          group: pullRequest.sourceBranch,
        });
        const prLinkLabel =
          pullRequest.number || pullRequest.id
            ? `#${pullRequest.number || pullRequest.id} ${this.getPrStatusEmoji(pullRequest.jobsStatus)}`
            : this.isAuthenticated
              ? "No PR"
              : "Merge";
        this.gitLinks.push({
          source: nodeName,
          target: this.sanitizeNodeName(pullRequest.targetBranch) + "Branch",
          type: "gitFeatureMerge",
          label: prLinkLabel,
          activePR: pullRequest,
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
    this.gitBranches = sortArray(this.gitBranches, {
      by: ["level", "name"],
      order: ["asc", "asc"],
    });
    this.gitLinks = sortArray(this.gitLinks, {
      by: ["level", "source"],
      order: ["asc", "asc"],
    });
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
        let orgClass = "salesforceDev"; // Default to dev

        if (branchAndOrg.orgType === "prod") {
          orgClass = "salesforceProd";
        } else {
          // if (branchAndOrg.orgType === "preprod" || branchAndOrg.orgType === "integration") {
          orgClass = "salesforceMajor";
        }

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
        const jobStatusEmoji = this.getPrStatusEmoji(jobsStatus);
        const hasJobs = branchAndOrg.jobs && branchAndOrg.jobs.length > 0;
        const jobUrl = hasJobs ? branchAndOrg.jobs[0].webUrl : null;

        // Determine deploy link type based on job status
        let deployLinkType = "sfDeploy";
        if (
          hasJobs &&
          jobUrl &&
          (jobsStatus === "running" || jobsStatus === "pending")
        ) {
          deployLinkType = "sfDeployAnimated";
        }

        // Build deploy label with job status (simpler format for dashed arrows)
        let deployLabel = "Deploy to Org";
        if (hasJobs) {
          deployLabel = `Deploy ${jobStatusEmoji}`;
        }

        this.deployLinks.push({
          source: gitBranch.nodeName,
          target: nodeName,
          type: deployLinkType,
          label: deployLabel,
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
    this.mermaidLines.push(
      this.indent("subgraph GitBranches [Git Branches]", 1),
    );
    this.mermaidLines.push(this.indent("direction TB", 2));
    for (const gitBranch of this.gitBranches) {
      this.mermaidLines.push(
        this.indent(
          `${gitBranch.nodeName}["🌿${gitBranch.label}"]:::${gitBranch.class}`,
          2,
        ),
      );
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Salesforce orgs (only if there are any major orgs)
    const majorOrgs = this.salesforceOrgs.filter((salesforceOrg) =>
      ["salesforceProd", "salesforceMajor"].includes(salesforceOrg.class),
    );
    if (majorOrgs.length > 0) {
      this.mermaidLines.push(
        this.indent("subgraph SalesforceOrgs [Salesforce Orgs]", 1),
      );
      this.mermaidLines.push(this.indent("direction TB", 2));
      for (const salesforceOrg of majorOrgs) {
        // Make node clickable if instanceUrl is present and not login.salesforce.com or test.salesforce.com
        let nodeLine = `${salesforceOrg.nodeName}(["☁️${salesforceOrg.label}"]):::${salesforceOrg.class}`;
        if (
          salesforceOrg.instanceUrl &&
          !salesforceOrg.instanceUrl.includes("login.salesforce.com") &&
          !salesforceOrg.instanceUrl.includes("test.salesforce.com")
        ) {
          nodeLine += `\nclick ${salesforceOrg.nodeName} "${salesforceOrg.instanceUrl}" _blank`;
        }
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
              `${salesforceOrg.nodeName}(["☁️${salesforceOrg.label}"]):::${salesforceOrg.class}`,
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
      // Find style usage: style SubgraphName ...
      const styleMatch = line.match(/^\s*style\s+([a-zA-Z0-9_-]+)/);
      if (styleMatch) {
        usedStyles.add(styleMatch[1]);
      }
    }

    // Add dynamic SalesforceDevOrgs styles if used
    for (const salesforceDevOrgsGroup of this.salesforceDevOrgsGroup) {
      if (
        this.mermaidLines.some((l) =>
          l.includes(`subgraph SalesforceDevOrgs${salesforceDevOrgsGroup} `),
        )
      ) {
        this.mermaidLines.push(
          `style SalesforceDevOrgs${salesforceDevOrgsGroup} fill:#EBF6FF,color:#000000,stroke:#0077B5,stroke-width:1px;`,
        );
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
      if (!positions[link.type]) {
        positions[link.type] = [];
      }
      positions[link.type].push(pos);
      pos++;
    }

    const linksDef = this.listLinksDef();
    for (const key of Object.keys(positions)) {
      const styleDef = linksDef[key];
      this.mermaidLines.push(
        `linkStyle ${positions[key].join(",")} ${styleDef}`,
      );
    }
  }

  private addLinks(links: any[]) {
    for (const link of links) {
      if (link.type === "gitMerge") {
        let label = link.label;
        // If PR exists, make label clickable with markdown link syntax
        if (link.activePR && link.activePR.webUrl) {
          label = `<a href='${link.activePR.webUrl}' target='_blank' style='color:#0176D3;font-weight:bold;text-decoration:underline;'>${link.label}</a>`;
          // Only use special link type for running/pending jobs
          const jobStatus = link.activePR.jobsStatus || "unknown";
          if (jobStatus === "running" || jobStatus === "pending") {
            link.type = "gitMergeWithPRAnimated";
          }
          // For completed PRs (success/failed/unknown), keep gitMerge type (plain style)
        }
        this.mermaidLines.push(
          this.indent(`${link.source} ==>|"${label}"| ${link.target}`, 1),
        );
      } else if (link.type === "gitFeatureMerge") {
        let label = link.label;
        /* jscpd:ignore-start */
        // If PR exists, make label clickable with markdown link syntax
        if (link.activePR && link.activePR.webUrl) {
          label = `<a href='${link.activePR.webUrl}' target='_blank' style='color:#0176D3;font-weight:bold;text-decoration:underline;'>${link.label}</a>`;
          // Only use special link type for running/pending jobs
          const jobStatus = link.activePR.jobsStatus || "unknown";
          if (jobStatus === "running" || jobStatus === "pending") {
            link.type = "gitFeatureMergeWithPRAnimated";
          }
          // For completed PRs (success/failed/unknown), keep gitFeatureMerge type (plain style)
        }
        /* jscpd:ignore-end */
        this.mermaidLines.push(
          this.indent(`${link.source} -->|"${label}"| ${link.target}`, 1),
        );
      } else if (link.type === "sfDeploy" || link.type === "sfDeployAnimated") {
        // Make deployment links clickable if job URL exists
        let label = link.label;
        if (link.jobUrl) {
          // Extract just the emoji from the label (e.g., "Deploy ✅" -> "✅")
          const emoji = label.replace(/^Deploy\s+/, "");
          label = `<a href='${link.jobUrl}' target='_blank' style='color:#0176D3;font-weight:bold;text-decoration:underline;'>Deploy ${emoji}</a>`;
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

  listClassesAndStyles(): string[] {
    // Enhanced SLDS: backgrounds for orgs/branches/subgraphs, bolder borders, rounded corners, SLDS font, and improved contrast
    // Only use properties supported by Mermaid classDef/style syntax
    const classesAndStyles = `
  classDef salesforceDev fill:#F4F6F9,stroke:#0176D3,stroke-width:2.5px,color:#032D60,font-weight:500,border-radius:16px;
  classDef salesforceMajor fill:#FFF6E3,stroke:#FFB75D,stroke-width:2.5px,color:#032D60,font-weight:900,border-radius:16px;
  classDef salesforceProd fill:#E3FCEF,stroke:#04844B,stroke-width:2.5px,color:#032D60,font-weight:700,border-radius:16px;
  classDef gitMajor fill:#4A9FD8,stroke:#032D60,stroke-width:3px,color:#fff,font-weight:900,border-radius:16px;
  classDef gitMain fill:#0176D3,stroke:#032D60,stroke-width:3px,color:#fff,font-weight:900,border-radius:16px;
  classDef gitFeature fill:#fff,stroke:#E5E5E5,stroke-width:1.5px,color:#3E3E3C,font-weight:500,border-radius:16px;
  style GitBranches fill:#F0F6FB,color:#032D60,stroke:#0176D3,stroke-width:2px;
  style SalesforceOrgs fill:#F0F6FB,color:#032D60,stroke:#04844B,stroke-width:2px;
  style SalesforceDevOrgs fill:#F0F6FB,color:#032D60,stroke:#0176D3,stroke-width:2px;
  `;
    return classesAndStyles.split("\n");
  }

  private listLinksDef(): any {
    // SLDS blue/green for connectors, thin lines, and more discrete (lighter) link labels
    // Use a lighter color for label text (e.g., #B0B7BD), fully opaque for readability, and no background
    // gitFeatureMerge uses dashed line and lighter color to distinguish from major branch merges
    // gitMerge (major branch arrows) are always plain and thicker (3px)
    // Animated variants: Set base stroke in red that CSS will animate
    return {
      gitMerge: "stroke:#0176D3,stroke-width:3px,color:#032D60,opacity:1;",
      gitMergeWithPRAnimated:
        "stroke:#e74c3c,stroke-width:3px,color:#032D60,font-weight:bold,opacity:1;",
      gitFeatureMerge:
        "stroke:#B0B7BD,stroke-width:1.5px,stroke-dasharray:5 5,color:#B0B7BD,opacity:1;",
      gitFeatureMergeWithPRAnimated:
        "stroke:#e74c3c,stroke-width:2.5px,stroke-dasharray:5 5,color:#032D60,font-weight:bold,opacity:1;",
      sfDeploy: "stroke:#04844B,stroke-width:1.5px,color:#B0B7BD,opacity:1;",
      sfDeployAnimated:
        "stroke:#e74c3c,stroke-width:2px,color:#032D60,font-weight:bold,opacity:1;",
      sfPushPull: "stroke:#0176D3,stroke-width:1.5px,color:#B0B7BD,opacity:1;",
    };
  }

  private indent(str: string, number: number): string {
    return " ".repeat(number) + str;
  }

  private getPrStatusEmoji(status: JobStatus): string {
    const emojiMap: Record<JobStatus, string> = {
      running: "🔄",
      pending: "⏳",
      success: "✅",
      failed: "❌",
      unknown: "❔",
    };
    if (status in emojiMap) {
      return emojiMap[status];
    }
    return "❔";
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
      .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
  }
}
