import * as fs from "fs";
import path from "path";
import { glob } from "glob";
import * as yaml from "js-yaml";
import sortArray from "sort-array";
import simpleGit, { SimpleGit } from "simple-git";
import { execCommand, getWorkspaceRoot } from "../utils";

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author_name?: string;
  author_email?: string;
  [key: string]: any;
}

export interface MajorOrg {
  branchName: string;
  orgType: "prod" | "preprod" | "uat" | "uatrun" | "integration" | "other";
  alias?: string;
  mergeTargets: string[];
  level: number;
  instanceUrl: string;
  warnings: string[];
  commitsPendingMergeToTarget?: GitCommit[];
  commitsGroupsPendingMergeToTarget?: { name: string; commits: GitCommit[] }[];
}

export async function listMajorOrgs(): Promise<MajorOrg[]> {
  const workspaceRoot = getWorkspaceRoot();
  const branchConfigPattern = "**/config/branches/.sfdx-hardis.*.yml";
  const configFiles = await glob(branchConfigPattern, { cwd: workspaceRoot });
  const majorOrgs: MajorOrg[] = [];

  for (const configFile of configFiles) {
    const props = (yaml.load(fs.readFileSync(configFile, "utf-8")) ||
      {}) as any;
    const branchNameRegex = /\.sfdx-hardis\.(.*)\.yml/gi;
    const m = branchNameRegex.exec(configFile);
    if (!m) {
      continue;
    }
    const branchName = m[1];
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
    } else if (isUat(branchName)) {
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
      orgType !== "prod"
    ) {
      const exampleMergeTarget =
        mergeTargets.length > 0 ? mergeTargets[0] : "preprod";
      warnings.push(
        `No merge target defined for branch '${branchName}'. Consider adding 'mergeTargets' in ${configFile} config file. (Ex: mergeTargets: ["${exampleMergeTarget}"])`,
      );
    }

    // Check if there is an encrypted certificate key file for the branch
    const certKeyFile = `config/branches/.jwt/${branchName}.key`;
    if (!fs.existsSync(path.join(workspaceRoot, certKeyFile))) {
      warnings.push(
        `No encrypted certificate key file found for branch '${branchName}' (expected: ${certKeyFile}). You should configure the org authentication again.`,
      );
    }

    majorOrgs.push({
      branchName,
      orgType,
      alias: props.alias,
      mergeTargets,
      level,
      instanceUrl: props.instanceUrl,
      warnings: warnings,
    });
  }

  const git = simpleGit({ trimmed: true, baseDir: workspaceRoot });
  await completeOrgsWithCommitsInfo(git, majorOrgs);

  // Sort by level (desc), then branchName (asc)
  return sortArray(majorOrgs, {
    by: ["level", "branchName"],
    order: ["desc", "asc"],
  });
}

async function completeOrgsWithCommitsInfo(git: SimpleGit, majorOrgs: MajorOrg[]) {
  for (const majorOrg of majorOrgs) {
    // Get latest merge commit between major org current branch and each of its merge targets
    const commits: any[] = [];
    for (const targetBranch of majorOrg.mergeTargets) {
      const deltaScope = await getGitDeltaScope(git, majorOrg.branchName, targetBranch);
      // Use simpleGit to list all commits between deltaScope.fromCommit and deltaScope.toCommit
      const logResult = await git.log([`${deltaScope.fromCommit}..${deltaScope.toCommit?.hash ?? ""}`]);
      commits.push(...logResult.all);
    }
    // Remove duplicates (in case of multiple merge targets with same commits)
    const uniqueCommitsMap: { [hash: string]: any } = {};
    for (const commit of commits) {
      uniqueCommitsMap[commit.hash] = commit;
    }
    majorOrg.commitsPendingMergeToTarget = Object.values(uniqueCommitsMap).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    // Group commits by the subsequent merge commit's message.
    // Collect commits until we encounter a merge commit; when we encounter a merge commit
    // we create a group named with the merge commit's message and containing the collected commits
    // (these are the commits that were merged by that merge commit). Remaining commits at the end
    // are grouped under 'misc'.

    const groups: { name: string; commits: any[] }[] = [];
    const sortedCommits = majorOrg.commitsPendingMergeToTarget.slice().sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    let buffer: any[] = [];
    for (const commit of sortedCommits) {
      const msg: string = commit.message || "";
      // Determine if this commit is a merge by checking its parents
      try {
        const revLine = (await git.raw(["rev-list", "--parents", "-n", "1", commit.hash]) || "").toString().trim();
        const parts = revLine.split(/\s+/);
        if (parts.length >= 3) {
          // it's a merge commit (has at least two parents)
          const parent1 = parts[1];
          const parent2 = parts[2];
          // commits that were merged are those reachable from parent2 but not from parent1
          try {
            const mergedLog = await git.log({ from: parent1, to: parent2 });
            const mergedCommits = (mergedLog && Array.isArray(mergedLog.all) ? mergedLog.all : []).map((c: any) => c);
            groups.push({ name: msg, commits: mergedCommits });
            buffer = [];
            continue;
          } catch {
            // fallback to buffer behavior below
          }
        }
      } catch {
        // if rev-list fails, treat it as a non-merge for now
      }

      buffer.push(commit);
    }

    if (buffer.length > 0) {
      groups.push({ name: "misc", commits: buffer });
    }

    majorOrg.commitsGroupsPendingMergeToTarget = groups;
  }
}

export async function getGitDeltaScope(git: SimpleGit, currentBranch: string, targetBranch: string) {
  try {
    await git.fetch(['origin', `${targetBranch}:${targetBranch}`]);
  } catch (e) {
    console.warn(`Could not fetch branch ${targetBranch} from origin: ${e}`);
  }
  try {
    await git.fetch(['origin', `${currentBranch}:${currentBranch}`]);
  } catch (e) {
    console.warn(`Could not fetch branch ${currentBranch} from origin: ${e}`);
  }
  const logResult = await git.log([`${targetBranch}..${currentBranch}`]);
  const toCommit = logResult.latest;
  const mergeBaseCommand = `git merge-base ${targetBranch} ${currentBranch}`;
  const mergeBaseCommandResult = await execCommand(mergeBaseCommand, {
    fail: true,
  });
  const masterBranchLatestCommit = mergeBaseCommandResult.stdout.replace('\n', '').replace('\r', '');
  return { fromCommit: masterBranchLatestCommit, toCommit: toCommit, logResult: logResult };
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
