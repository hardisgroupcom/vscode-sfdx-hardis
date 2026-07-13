import * as fs from "fs";
import path from "path";
import { glob } from "glob";
import * as yaml from "js-yaml";
import sortArray from "sort-array";
import { getWorkspaceRoot } from "../utils";
import { Job, JobStatus, PullRequest } from "./gitProviders/types";
import { GitProvider } from "./gitProviders/gitProvider";
import { getConfig } from "./pipeline/sfdxHardisConfig";

export interface MajorOrg {
  branchName: string;
  orgType: "prod" | "preprod" | "uat" | "uatrun" | "integration" | "other";
  alias?: string;
  mergeTargets: string[];
  level: number;
  instanceUrl: string;
  warnings: string[];
  jobs: Job[];
  jobsStatus: JobStatus;
  pullRequestsInBranchSinceLastMerge?: PullRequest[];
}

export async function listMajorOrgs(
  options: { browseGitProvider: boolean } = { browseGitProvider: false },
): Promise<MajorOrg[]> {
  const workspaceRoot = getWorkspaceRoot();
  // Branch config files live only in <workspaceRoot>/config/branches/. Anchor the
  // pattern there (no leading "**/") so glob reads a single directory instead of
  // walking the entire working tree (node_modules, .git, force-app…), which on a
  // large repo took 25s+ cold and was the dominant pipeline-load cost.
  const branchConfigPattern = "config/branches/.sfdx-hardis.*.yml";
  const configFiles = await glob(branchConfigPattern, { cwd: workspaceRoot });
  const majorOrgs: MajorOrg[] = [];
  const gitProvider = options.browseGitProvider
    ? await GitProvider.getInstance()
    : null;

  const projectConfig = await getConfig("project");
  const orgAuthenticationMode: string =
    projectConfig?.orgAuthenticationMode || "encryptedCert";

  // Process all config files in parallel
  const configFileResults = await Promise.allSettled(
    configFiles.map((configFile) =>
      processOrgSfdxHardisConfigFile(
        configFile,
        configFiles,
        workspaceRoot,
        gitProvider,
        options,
        orgAuthenticationMode,
      ),
    ),
  );
  for (const result of configFileResults) {
    if (result.status === "fulfilled" && result.value !== null) {
      majorOrgs.push(result.value);
    }
  }

  // Sort by level (desc), then branchName (asc)
  const majorOrgsSorted = sortArray(majorOrgs, {
    by: ["level", "branchName"],
    order: ["desc", "asc"],
  });

  if (options.browseGitProvider) {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider?.isActive) {
      // Complete with list of Pull Requests merged in each branch, using listPullRequestsInBranchSinceLastMerge
      // Parallelize calls for better performance
      await Promise.allSettled(
        majorOrgsSorted.map(async (org) => {
          // Get child branches names, then recursively child branches names of child branches
          const childBranchesNames = recursiveGetChildBranches(
            org.branchName,
            majorOrgsSorted,
          );
          const prs =
            org.mergeTargets.length === 0
              ? // Top branch (e.g. main/prod): no merge target of its own, so
                // show the PRs carried by the latest "go live" merge into it
                await gitProvider.listPullRequestsInLatestMerge(
                  org.branchName,
                  [...childBranchesNames],
                )
              : await gitProvider.listPullRequestsInBranchSinceLastMerge(
                  org.branchName,
                  org.mergeTargets[0], // use first merge target as target branch
                  [...childBranchesNames],
                );
          // Sort PRs by mergeDate date desc
          prs.sort((a, b) => {
            const dateA = a.mergeDate ? new Date(a.mergeDate).getTime() : 0;
            const dateB = b.mergeDate ? new Date(b.mergeDate).getTime() : 0;
            return dateB - dateA;
          });
          org.pullRequestsInBranchSinceLastMerge = prs;
          // Complete with tickets
          await gitProvider.completePullRequestsWithTickets(prs, {
            fetchDetails: true,
          });
          await gitProvider.completePullRequestsWithPrePostCommands(prs);
        }),
      );
    }
  }

  return majorOrgsSorted;
}

async function processOrgSfdxHardisConfigFile(
  configFile: string,
  configFiles: string[],
  workspaceRoot: string,
  gitProvider: GitProvider | null,
  options: { browseGitProvider: boolean },
  orgAuthenticationMode: string = "encryptedCert",
): Promise<MajorOrg | null> {
  // `configFile` is workspace-relative (glob ran with cwd: workspaceRoot), so it
  // must be resolved against workspaceRoot rather than process.cwd() — the two
  // differ when the workspace was not opened from its own directory (e.g. the
  // Extension Development Host), which otherwise makes every read fail and the
  // pipeline wrongly appear as "not configured".
  const props = (yaml.load(
    fs.readFileSync(path.join(workspaceRoot, configFile), "utf-8"),
  ) || {}) as any;
  const branchNameRegex = /\.sfdx-hardis\.(.*)\.yml/gi;
  const m = branchNameRegex.exec(configFile);
  if (!m) {
    return null;
  }
  const branchName = m[1];

  // The canonical uat branch is named exactly "uat" or "recette"
  const isCanonicalUatBranch =
    branchName.toLowerCase() === "uat" ||
    branchName.toLowerCase() === "recette";
  // If a canonical "uat" or "recette" branch exists, other non-uatRun branches are demoted to "other"
  const hasCanonicalUatBranch = configFiles.some((f) => {
    const regex = /\.sfdx-hardis\.(.*)\.yml/gi;
    const match = regex.exec(f);
    const b = match ? match[1] : null;
    return (
      b !== null &&
      b !== branchName &&
      (b.toLowerCase() === "uat" || b.toLowerCase() === "recette")
    );
  });

  let orgType: MajorOrg["orgType"] = "other";
  let level = 40;
  if (isProduction(branchName)) {
    orgType = "prod";
    level = 100;
  } else if (isPreprod(branchName)) {
    orgType = "preprod";
    level = 90;
  } else if (isUatRun(branchName)) {
    orgType = "uatrun";
    level = 80;
  } else if (
    isUat(branchName) &&
    (isCanonicalUatBranch || !hasCanonicalUatBranch)
  ) {
    orgType = "uat";
    level = 70;
  } else if (isIntegration(branchName)) {
    orgType = "integration";
    level = 50;
  }
  const mergeTargets = Array.isArray(props.mergeTargets)
    ? props.mergeTargets
    : guessMatchingMergeTargets(
        branchName,
        orgType,
        configFiles.map((f) => f.replace(/^.*\.sfdx-hardis\.|\.yml$/g, "")),
      );

  const warnings: string[] = [];
  if (
    !(Array.isArray(props.mergeTargets) && props.mergeTargets.length > 0) &&
    orgType !== "prod" &&
    !branchName.includes("training")
  ) {
    const exampleMergeTarget =
      mergeTargets.length > 0 ? mergeTargets[0] : "preprod";
    warnings.push(
      `No merge target defined for branch ${branchName}. Consider adding one in Pipeline Settings -> select ${branchName} and set merge target in 'Deployment' tab. (Ex: ${exampleMergeTarget})`,
    );
  }

  // Check if there is an encrypted certificate key file for the branch
  // Skip check when orgAuthenticationMode is 'secretsOnly' (uses CI/CD env secrets instead)
  if (orgAuthenticationMode !== "secretsOnly") {
    const certKeyFile = `config/branches/.jwt/${branchName}.key`;
    if (!fs.existsSync(path.join(workspaceRoot, certKeyFile))) {
      warnings.push(
        `No encrypted certificate key file found for branch '${branchName}' (expected: ${certKeyFile}). You should configure the org authentication again (use "Add new org")`,
      );
    }
  }

  let jobs: Job[] = [];
  let jobsStatus: JobStatus = "unknown";
  if (options.browseGitProvider && gitProvider?.isActive) {
    const jobsRes = await gitProvider.getJobsForBranchLatestCommit(branchName);
    if (jobsRes) {
      jobsStatus = jobsRes.jobsStatus;
      jobs = jobsRes.jobs || [];
    }
  }

  return {
    branchName,
    orgType,
    alias: props.alias,
    mergeTargets,
    level,
    instanceUrl: props.instanceUrl,
    warnings: warnings,
    jobs: jobs,
    jobsStatus: jobsStatus,
  };
}

/**
 * Returns the recursive list of child branch names for a given branch (branches
 * that merge into it, then their children, etc.). Reads only branch config files
 * (no git provider call), so it is cheap enough to call from message handlers
 * that need the child branches of a branch (e.g. go-lives lazy loading).
 */
export async function getChildBranchNames(
  branchName: string,
): Promise<string[]> {
  const majorOrgs = await listMajorOrgs({ browseGitProvider: false });
  return [...recursiveGetChildBranches(branchName, majorOrgs)];
}

function recursiveGetChildBranches(
  branchName: string,
  majorOrgs: MajorOrg[],
  collected: Set<string> = new Set(),
): Set<string> {
  const directChildren = majorOrgs
    .filter((o) => o.mergeTargets.includes(branchName))
    .map((o) => o.branchName);
  for (const child of directChildren) {
    if (!collected.has(child)) {
      collected.add(child);
      recursiveGetChildBranches(child, majorOrgs, collected);
    }
  }
  return collected;
}

function guessMatchingMergeTargets(
  branchName: string,
  orgType: string,
  allBranchNames: string[],
): string[] {
  if (orgType === "prod") {
    return [];
  } else if (orgType === "preprod") {
    return allBranchNames.filter(isProduction);
  } else if (orgType === "uat" || orgType === "uatrun") {
    return allBranchNames.filter(isPreprod);
  } else if (orgType === "integration") {
    return allBranchNames.filter(isUat);
  }
  // fallback: no guess
  return [];
}

export function isProduction(branchName: string) {
  return (
    branchName.toLowerCase().startsWith("prod") ||
    branchName.toLowerCase().startsWith("main")
  );
}

export function isPreprod(branchName: string) {
  return (
    branchName.toLowerCase().startsWith("preprod") ||
    branchName.toLowerCase().startsWith("staging")
  );
}

export function isUat(branchName: string) {
  return (
    (branchName.toLowerCase().startsWith("uat") ||
      branchName.toLowerCase().startsWith("recette")) &&
    !branchName.toLowerCase().includes("run")
  );
}

export function isIntegration(branchName: string) {
  return branchName.toLowerCase().startsWith("integ");
}

export function isUatRun(branchName: string) {
  return (
    (branchName.toLowerCase().startsWith("uat") ||
      branchName.toLowerCase().startsWith("recette")) &&
    branchName.toLowerCase().includes("run")
  );
}

export function isMajorBranch(branchName: string, allBranches: any[]): boolean {
  const branchesWithBranchNameAsTarget = allBranches.filter((b) =>
    Array.isArray(b.mergeTargets) ? b.mergeTargets.includes(branchName) : false,
  );
  if (branchesWithBranchNameAsTarget.length > 0) {
    return true;
  }
  return (
    isProduction(branchName) ||
    isPreprod(branchName) ||
    isUat(branchName) ||
    isUatRun(branchName) ||
    isIntegration(branchName)
  );
}
