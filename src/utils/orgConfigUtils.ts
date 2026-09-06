import * as fs from "fs";
import path from "path";
import { glob } from "glob";
import * as yaml from "js-yaml";
import { sortArray } from "./sortUtils";
import { getWorkspaceRoot } from "../utils";
import { Job, JobStatus, PullRequest } from "./gitProviders/types";
import { GitProvider } from "./gitProviders/gitProvider";
import { getConfig } from "./pipeline/sfdxHardisConfig";
import {
  annotateAlreadyPromoted,
  buildPromotionIndex,
  enforceSinglePlacePerPullRequest,
  expandPullRequestsWithPromotions,
  getPromotionBranchConfig,
  isMergedPullRequest,
  isPromotionPullRequest,
  PromotionBranchConfig,
} from "./pipeline/promotionBranchUtils";
import { Logger } from "../logger";

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
  // Promotion branches switch, when set at branch level (see promotionBranchUtils.ts)
  enablePromotionBranches?: boolean;
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
          let prs =
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
          prs = sortPullRequestsByMergeDateDesc(prs);
          org.pullRequestsInBranchSinceLastMerge = prs;
          // Complete with tickets
          await gitProvider.completePullRequestsWithTickets(prs, {
            fetchDetails: true,
          });
          await gitProvider.completePullRequestsWithPrePostCommands(prs);
        }),
      );
      try {
        await completeMajorOrgsWithPromotionBranches(
          majorOrgsSorted,
          gitProvider,
          projectConfig,
        );
      } catch (e) {
        Logger.log(
          `Error completing pipeline with promotion branches: ${String(e)}`,
        );
      }
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
    enablePromotionBranches: props.enablePromotionBranches,
  };
}

/**
 * Promotion branches switch of the pipeline: the project config, or any branch config
 * (the CLI reads the merged config of the target branch, so enabling it in
 * .sfdx-hardis.preprod.yml only is a supported layout).
 */
export function getPipelinePromotionBranchConfig(
  projectConfig: any,
  majorOrgs: MajorOrg[],
): PromotionBranchConfig {
  // Deliberately the project config only. sfdx-hardis reads getConfig("branch"), which merges the
  // project config with the config of the branch a job runs on, so a switch set in a single branch
  // file is invisible to hardis:project:promotion:create (run from another branch) and to the jobs
  // of every other branch. Enabling the pipeline from one branch file would promise a behavior the
  // CLI does not deliver.
  void majorOrgs;
  return getPromotionBranchConfig([projectConfig]);
}

/**
 * Once every window is loaded: expand the promotion Pull Requests found in them with
 * the stories they declare (looked up in the other windows first, then fetched), and
 * flag the stories that a merged promotion Pull Request already shipped.
 * Nothing happens unless enablePromotionBranches is set.
 */
async function completeMajorOrgsWithPromotionBranches(
  majorOrgs: MajorOrg[],
  gitProvider: GitProvider,
  projectConfig: any,
): Promise<void> {
  const config = getPipelinePromotionBranchConfig(projectConfig, majorOrgs);
  if (!config.enabled) {
    return;
  }
  const known = new Map<number, PullRequest>();
  for (const org of majorOrgs) {
    for (const pr of org.pullRequestsInBranchSinceLastMerge || []) {
      if (typeof pr.number === "number" && !known.has(pr.number)) {
        known.set(pr.number, pr);
      }
    }
  }
  const fetchByNumber = async (number: number) =>
    await gitProvider.getPullRequestByNumber(number);
  for (const org of majorOrgs) {
    const window = org.pullRequestsInBranchSinceLastMerge || [];
    if (window.length === 0) {
      continue;
    }
    const { all, added } = await expandPullRequestsWithPromotions(
      window,
      config,
      known,
      fetchByNumber,
    );
    if (added.length > 0) {
      await gitProvider.completePullRequestsWithTickets(added, {
        fetchDetails: true,
      });
      await gitProvider.completePullRequestsWithPrePostCommands(added);
      for (const story of added) {
        if (typeof story.number === "number" && !known.has(story.number)) {
          known.set(story.number, story);
        }
      }
    }
    // expandPullRequestsWithPromotions appends the carried stories, and listMajorOrgs had sorted
    // each window by merge date: without this the newest promoted stories sink to the bottom of
    // the table, under the row cutoff of the VS Code datatable
    org.pullRequestsInBranchSinceLastMerge = sortPullRequestsByMergeDateDesc(all);
  }
  // A story is "already deployed" when a merged promotion Pull Request, wherever it was
  // merged, declares it. The descriptions are parsed once into an index: a pipeline with a
  // thousand Pull Requests would otherwise re-parse the same YAML blocks for every story.
  const promotions: PullRequest[] = [];
  for (const org of majorOrgs) {
    for (const pr of org.pullRequestsInBranchSinceLastMerge || []) {
      if (isPromotionPullRequest(pr, config) && isMergedPullRequest(pr)) {
        promotions.push(pr);
      }
    }
  }
  if (promotions.length === 0) {
    return;
  }
  const index = buildPromotionIndex(promotions, config);
  for (const org of majorOrgs) {
    annotateAlreadyPromoted(
      org.pullRequestsInBranchSinceLastMerge || [],
      org.branchName,
      index,
      config,
    );
  }
  enforceInvariant(majorOrgs, config);
}

/**
 * The index only knows the promotions still inside a loaded window, so it cannot be the only thing
 * deciding where a story is listed: once a go-live resets a window, the promotion that carried a
 * story out of uat drops out of it and the story would show up in two branches. The windows
 * themselves always know, so the invariant is enforced on them directly.
 */
function enforceInvariant(
  majorOrgs: MajorOrg[],
  config: PromotionBranchConfig,
): void {
  enforceSinglePlacePerPullRequest(
    majorOrgs.map((org) => ({
      branchName: org.branchName,
      pullRequests: org.pullRequestsInBranchSinceLastMerge || [],
    })),
    config,
  );
}

function sortPullRequestsByMergeDateDesc(
  pullRequests: PullRequest[],
): PullRequest[] {
  return [...pullRequests].sort((a, b) => {
    const dateA = a.mergeDate ? new Date(a.mergeDate).getTime() : 0;
    const dateB = b.mergeDate ? new Date(b.mergeDate).getTime() : 0;
    return dateB - dateA;
  });
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
