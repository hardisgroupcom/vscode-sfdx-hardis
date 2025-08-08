import sortArray from "sort-array";
import { prettifyFieldName } from "../stringUtils";
import { isIntegration, isPreprod, isProduction } from "../orgConfigUtils";

export class BranchStrategyMermaidBuilder {
  private branchesAndOrgs: any[];
  private gitBranches: any[] = [];
  private salesforceOrgs: any[] = [];
  private salesforceDevOrgsGroup: string[] = [];
  private gitLinks: any[] = [];
  private deployLinks: any[] = [];
  private sbDevLinks: any[] = [];
  private retrofitLinks: any[] = [];
  private mermaidLines: string[] = [];
  private featureBranchNb: number = 0;

  constructor(branchesAndOrgs: any[]) {
    this.branchesAndOrgs = branchesAndOrgs;
  }

  /**
   * Build the mermaid diagram.
   * @param options.format 'list' or 'string'
   * @param options.withMermaidTag wrap in code block
   * @param options.onlyMajorBranches if true, only major branches (prod, preprod, uat, uatrun, integration) and their links are included (no dev/feature/hotfix branches or dev orgs)
   */
  public build(options: { format: "list" | "string", withMermaidTag: boolean, onlyMajorBranches?: boolean }): string | string[] {
    // Reset all arrays for each build
    this.gitBranches = [];
    this.salesforceOrgs = [];
    this.salesforceDevOrgsGroup = [];
    this.gitLinks = [];
    this.deployLinks = [];
    this.sbDevLinks = [];
    this.retrofitLinks = [];
    this.mermaidLines = [];
    this.featureBranchNb = 0;

    this.listGitBranchesAndLinks();
    this.listSalesforceOrgsAndLinks();

    if (options.onlyMajorBranches) {
      // Filter out feature/hotfix/dev orgs and related links, and remove ALL orgs (even major ones) and deploy links
      this.gitBranches = this.gitBranches.filter(b => b.class === "gitMain" || b.class === "gitMajor");
      this.gitLinks = this.gitLinks.filter(l => {
        // Only keep links between major branches
        const src = this.gitBranches.find(b => b.nodeName === l.source);
        const tgt = this.gitBranches.find(b => b.nodeName === l.target);
        return src && tgt;
      });
      // Remove all orgs and org links
      this.salesforceOrgs = [];
      this.deployLinks = [];
      this.salesforceDevOrgsGroup = [];
      this.sbDevLinks = [];
    }

  this.generateMermaidLines(options);

    if (options.withMermaidTag) {
      this.mermaidLines.unshift("```mermaid");
      this.mermaidLines.push("```");
    }

    return options.format === "list" ? this.mermaidLines : this.mermaidLines.join("\n");
  }

  private listGitBranchesAndLinks(): void {
    const branchesWhoAreMergeTargets: string[] = [];
    const branchesMergingInPreprod: string[] = [];

    this.gitBranches = this.branchesAndOrgs.map((branchAndOrg) => {
      const nodeName = branchAndOrg.branchName + "Branch"
      for (const mergeTarget of branchAndOrg.mergeTargets || []) {
        if (!branchesWhoAreMergeTargets.includes(mergeTarget)) {
          branchesWhoAreMergeTargets.push(mergeTarget);
        }
        if (isPreprod(mergeTarget)) {
          branchesMergingInPreprod.push(branchAndOrg.branchName);
        }
        this.gitLinks.push({ source: nodeName, target: mergeTarget + "Branch", type: "gitMerge", label: "Merge" });
      }
      return { 
        name: branchAndOrg.branchName,
        nodeName: nodeName,
        label: branchAndOrg.branchName,
        class: isProduction(branchAndOrg.branchName) ? "gitMain" : "gitMajor", 
        level: branchAndOrg.level, 
        instanceUrl: branchAndOrg.instanceUrl
      };
    });

    // Create feature branches for branches that are not merge targets
    const noMergeTargetBranchAndOrg = this.branchesAndOrgs.filter((branchAndOrg) => !branchesWhoAreMergeTargets.includes(branchAndOrg.branchName));

    if (branchesMergingInPreprod.length < 2 && !noMergeTargetBranchAndOrg.find((branchAndOrg) => isPreprod(branchAndOrg.branchName))) {
      // We must check if a 'preprod' branch exists before adding it to the array.
      // The .find() method returns undefined if no matching element is found.
      // Without this check, an 'undefined' value could be pushed to the array,
      // causing a null pointer exception later when the code tries to access the 'branchName' property.
      const preprodBranch = this.branchesAndOrgs.find((branchAndOrg) => isPreprod(branchAndOrg.branchName)
      );
      if (preprodBranch) {
        noMergeTargetBranchAndOrg.push(preprodBranch);
      }
    }

    // Disable for now
    // for (const branchAndOrg of noMergeTargetBranchAndOrg) {
    //   const nameBase = isPreprod(branchAndOrg.branchName) ? "hotfix" : "feature";
    //   const level = branchAndOrg.level - 1
    //   this.salesforceDevOrgsGroup.push(branchAndOrg.branchName);
    //   this.addFeatureBranch(nameBase, level, branchAndOrg);
    //   this.addFeatureBranch(nameBase, level, branchAndOrg);
    // }

    // Add retrofit link only if it does not mess with the diagram display :/
    if (branchesMergingInPreprod.length < 2) {
      const mainBranch = this.branchesAndOrgs.find((branchAndOrg) => isProduction(branchAndOrg.branchName));
      const preprodBranch = this.branchesAndOrgs.find((branchAndOrg) => isPreprod(branchAndOrg.branchName));
      const integrationBranch = this.branchesAndOrgs.find((branchAndOrg) => isIntegration(branchAndOrg.branchName));

      if (mainBranch && preprodBranch && integrationBranch) {
        this.retrofitLinks.push({ source: mainBranch.branchName + "Branch", target: integrationBranch.branchName + "Branch", type: "gitMerge", label: "Retrofit from RUN to BUILD" });
      }
    }

    // Sort branches & links
    this.gitBranches = sortArray(this.gitBranches, { by: ['level', 'name'], order: ['asc', 'asc'] });
    this.gitLinks = sortArray(this.gitLinks, { by: ['level', 'source'], order: ['asc', 'asc'] });
  }

  // private addFeatureBranch(nameBase: string, level: number, branchAndOrg: any) {
  //   this.featureBranchNb++;
  //   const nameBase1 = nameBase + this.featureBranchNb;
  //   const nodeName1 = nameBase + "Branch" + this.featureBranchNb;
  //   this.gitBranches.push({ name: nameBase1, nodeName: nodeName1, label: nameBase1, class: "gitFeature", level: level, group: branchAndOrg.branchName });
  //   this.gitLinks.push({ source: nodeName1, target: this.gitBranches.find((gitBranch) => gitBranch.name === branchAndOrg.branchName)?.nodeName || "ERROR", type: "gitMerge", label: "Merge" });
  // }

  private listSalesforceOrgsAndLinks(): any {
    for (const gitBranch of this.gitBranches) {
      const branchAndOrg = this.branchesAndOrgs.find((branchAndOrg) => branchAndOrg.branchName === gitBranch.name);
      if (branchAndOrg) {
        const nodeName = branchAndOrg.branchName + "Org";
        let orgLabel = branchAndOrg.alias || (isProduction(branchAndOrg.branchName) ? "Production Org" : prettifyFieldName(branchAndOrg.branchName) + " Org");
        if (branchAndOrg.instanceUrl && !branchAndOrg.instanceUrl.includes("login.salesforce.com") && !branchAndOrg.instanceUrl.includes("test.salesforce.com")) {
          // Remove the http, sandbox and salesforce part from instance url
          // ex: https://atlantem4--recetteatl.sandbox.my.salesforce.com becomes atlantem4--recetteatl
          orgLabel = branchAndOrg.instanceUrl;
          orgLabel = orgLabel.replace(/https?:\/\/|\.sandbox\.my\.salesforce\.com|\.my\.salesforce\.com/g, '').replace(/\/$/, ''); // Remove http(s) and trailing slash
          orgLabel = orgLabel.replace(/\.sandbox$/, ''); // Remove .sandbox if present
          orgLabel = orgLabel.replace(/\.my$/, ''); // Remove .my if present
          orgLabel = orgLabel.replace(/\.salesforce$/, ''); // Remove .salesforce if present
          orgLabel += " Org"; // Append Org to the label
        }
        let orgClass = "salesforceDev"; // Default to dev

        if (branchAndOrg.orgType === "prod") {
            orgClass = "salesforceProd";
        } else { // if (branchAndOrg.orgType === "preprod" || branchAndOrg.orgType === "integration") {
            orgClass = "salesforceMajor";
        }

        this.salesforceOrgs.push({
            name: branchAndOrg.branchName,
            nodeName: nodeName,
            label: orgLabel,
            class: orgClass,
            level: branchAndOrg.level,
            group: branchAndOrg.branchName, // Keep group for dev orgs
            instanceUrl: branchAndOrg.instanceUrl
        });
        this.deployLinks.push({ source: gitBranch.nodeName, target: nodeName, type: "sfDeploy", label: "Deploy to Org", level: branchAndOrg.level });
      } else {
        // This else block should ideally not be hit if PipelineDataProvider correctly populates all branches.
        // However, keeping it for robustness or if there are branches without direct org mappings.
        const nodeName = gitBranch.name + "Org";
        this.salesforceOrgs.push({ name: gitBranch.name, nodeName: nodeName, label: "Dev " + prettifyFieldName(gitBranch.name), class: "salesforceDev", level: gitBranch.level, group: gitBranch.group });
        this.sbDevLinks.push({ source: nodeName, target: gitBranch.nodeName, type: "sfPushPull", label: "Push / Pull", level: gitBranch.level, });
      }
    }

    // Sort orgs & links
    this.salesforceOrgs = sortArray(this.salesforceOrgs, { by: ['level', 'name'], order: ['desc', 'asc'] });
    this.deployLinks = sortArray(this.deployLinks, { by: ['level', 'source'], order: ['desc', 'asc'] });
    this.sbDevLinks = sortArray(this.sbDevLinks, { by: ['level', 'source'], order: ['asc', 'asc'] });
  }

  private generateMermaidLines(options?: { onlyMajorBranches?: boolean }) {
    /* jscpd:ignore-start */
  this.mermaidLines.push("flowchart LR");
  this.mermaidLines.push("");

    // Git branches
    this.mermaidLines.push(this.indent("subgraph GitBranches [Major Git Branches]", 1));
    this.mermaidLines.push(this.indent("direction TB", 2));
    for (const gitBranch of this.gitBranches) {
      this.mermaidLines.push(this.indent(`${gitBranch.nodeName}["${gitBranch.label}"]:::${gitBranch.class}`, 2));
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Salesforce orgs (only if there are any major orgs and not in onlyMajorBranches mode)
    const majorOrgs = this.salesforceOrgs.filter((salesforceOrg) => ["salesforceProd", "salesforceMajor"].includes(salesforceOrg.class));
    if (majorOrgs.length > 0 && !(options && options.onlyMajorBranches)) {
      this.mermaidLines.push(this.indent("subgraph SalesforceOrgs [Major Salesforce Orgs]", 1));
      this.mermaidLines.push(this.indent("direction TB", 2));
      for (const salesforceOrg of majorOrgs) {
        // Make node clickable if instanceUrl is present and not login.salesforce.com or test.salesforce.com
        let nodeLine = `${salesforceOrg.nodeName}(["${salesforceOrg.label}"]):::${salesforceOrg.class}`;
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
      if (renderedDevGroups.has(devOrgsGroup)) { continue; }
      renderedDevGroups.add(devOrgsGroup);
      const devOrgs = this.salesforceOrgs.filter((salesforceOrg) => salesforceOrg.group === devOrgsGroup && (salesforceOrg.name.startsWith("feature") || salesforceOrg.name.startsWith("hotfix")));
      if (devOrgs.length > 0  && !(options && options.onlyMajorBranches)) {
        this.mermaidLines.push(this.indent(`subgraph SalesforceDevOrgs${devOrgsGroup} [Salesforce Dev Orgs]`, 1));
        this.mermaidLines.push(this.indent("direction TB", 2));
        for (const salesforceOrg of devOrgs) {
          this.mermaidLines.push(this.indent(`${salesforceOrg.nodeName}(["${salesforceOrg.label}"]):::${salesforceOrg.class}`, 2));
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
      if (classMatch) { usedClasses.add(classMatch[1]); }
      // Find style usage: style SubgraphName ...
      const styleMatch = line.match(/^\s*style\s+([a-zA-Z0-9_-]+)/);
      if (styleMatch) { usedStyles.add(styleMatch[1]); }
    }

    // Add dynamic SalesforceDevOrgs styles if used
    for (const salesforceDevOrgsGroup of this.salesforceDevOrgsGroup) {
      if (this.mermaidLines.some(l => l.includes(`subgraph SalesforceDevOrgs${salesforceDevOrgsGroup} `))) {
        this.mermaidLines.push(`style SalesforceDevOrgs${salesforceDevOrgsGroup} fill:#EBF6FF,color:#000000,stroke:#0077B5,stroke-width:1px;`);
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

    const allLinks = [...this.gitLinks, ...this.deployLinks, ...this.sbDevLinks, ...this.retrofitLinks];
    let pos = 0;
    const positions: any = {}
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
      this.mermaidLines.push(`linkStyle ${positions[key].join(",")} ${styleDef}`);
    }
  }

  private addLinks(links: any[]) {
    for (const link of links) {
      if (link.type === "gitMerge") {
        this.mermaidLines.push(this.indent(`${link.source} ==>|"${link.label}"| ${link.target}`, 1));
      } else if (link.type === "sfDeploy") {
        this.mermaidLines.push(this.indent(`${link.source} -. ${link.label} .-> ${link.target}`, 1));
      } else if (link.type === "sfPushPull") {
        this.mermaidLines.push(this.indent(`${link.source} <-. ${link.label} .-> ${link.target}`, 1));
      }
    }
    this.mermaidLines.push("");
  }

  listClassesAndStyles(): string[] {
  // Enhanced SLDS: backgrounds for orgs/branches/subgraphs, soft shadow, rounded corners, SLDS font
  // Use Salesforce-like light blue for subgraph backgrounds
  const classesAndStyles = `
classDef salesforceDev fill:#F4F6F9,stroke:#E5E5E5,stroke-width:1.5px,color:#3E3E3C,font-weight:400,border-radius:14px;
classDef salesforceMajor fill:#E3FCEF,stroke:#E5E5E5,stroke-width:1.5px,color:#032D60,font-weight:600,border-radius:14px;
classDef salesforceProd fill:#FFF6E3,stroke:#E5E5E5,stroke-width:1.5px,color:#032D60,font-weight:700,border-radius:14px;
classDef gitMajor fill:#EAF5FE,stroke:#0176D3,stroke-width:2.5px,color:#032D60,font-weight:700,border-radius:14px;
classDef gitMain fill:#0176D3,stroke:#032D60,stroke-width:3px,color:#fff,font-weight:900,border-radius:14px;
classDef gitFeature fill:#fff,stroke:#E5E5E5,stroke-width:1.5px,color:#3E3E3C,font-weight:400,border-radius:14px;
style GitBranches fill:#F0F6FB,color:#3E3E3C,stroke:#E5E5E5,stroke-width:1.5px;
style SalesforceOrgs fill:#F0F6FB,color:#3E3E3C,stroke:#E5E5E5,stroke-width:1.5px;
style SalesforceDevOrgs fill:#F0F6FB,color:#3E3E3C,stroke:#0176D3,stroke-width:1.5px;
`
  return classesAndStyles.split("\n");
  }

  private listLinksDef(): any {
    // SLDS blue/green for connectors, thin lines, and more discrete (lighter) link labels
    // Use a lighter color for label text (e.g., #B0B7BD), fully opaque for readability, and no background
    return {
      "gitMerge": "stroke:#0176D3,stroke-width:1.5px,color:#B0B7BD,opacity:1;",
      "sfDeploy": "stroke:#04844B,stroke-width:1.5px,color:#B0B7BD,opacity:1;",
      "sfPushPull": "stroke:#0176D3,stroke-width:1.5px,color:#B0B7BD,opacity:1;"
    }
  }

  private indent(str: string, number: number): string {
    return ' '.repeat(number) + str;
  }
}
