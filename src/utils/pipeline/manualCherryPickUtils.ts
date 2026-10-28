import { createHash } from "crypto";
import { getWorkspaceRoot } from "../../utils";
import { Logger } from "../../logger";
import { CacheManager } from "../cache-manager";
import { createSimpleGit } from "../simpleGitInstance";
import { PullRequest } from "../gitProviders/types";
import {
  isManualCherryPickDetectionEnabled,
  listManualCherryPickSteps,
  ManualCherryPickMove,
  ManualCherryPickStepResult,
  parseManualCherryPickResult,
  PromotionBranchConfig,
  PromotionStep,
} from "./promotionBranchUtils";

/**
 * Manual cherry-picks (sfdx-hardis `detectManualCherryPicks`, Beta): what the DevOps Pipeline asks
 * the CLI. The detection itself lives in sfdx-hardis only: the extension runs
 * `sf hardis:project:promotion:list-candidates --json` once per promotion step, in parallel, and
 * places the answer (applyManualCherryPicks in promotionBranchUtils.ts).
 *
 * The answer of a step only changes when one of its two branches moves, so it is cached per
 * workspace, keyed by the tips of origin/<source> and origin/<target> AND by the Pull Requests the
 * git provider lists in both windows: the local tips are only as fresh as the last fetch, while
 * the windows are read from the provider at every refresh. A refresh of an unchanged pipeline runs
 * no CLI process at all, and a new commit or a new merged Pull Request on either side asks again.
 */

// A safety net only: a moved tip or a new merged Pull Request already invalidates the key
export const MANUAL_CHERRY_PICK_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

// Git processes started at once when commits are checked one by one
const GIT_CHECKS_AT_ONCE = 8;
// SHAs passed to one git command: the Windows command line stops at 32,767 characters
const COMMITS_PER_GIT_COMMAND = 200;

export interface BranchTips {
  source: string;
  target: string;
}

export interface ManualCherryPickDeps {
  workspaceRoot: string;
  // The SHAs of origin/<source> and origin/<target>, null when either cannot be read
  readTips: (
    sourceBranch: string,
    targetBranch: string,
  ) => Promise<BranchTips | null>;
  // The `result` of list-candidates --json, null when the CLI failed
  runListCandidates: (
    sourceBranch: string,
    targetBranch: string,
  ) => Promise<any | null>;
  getCached: (key: string) => ManualCherryPickStepResult | undefined;
  setCached: (key: string, value: ManualCherryPickStepResult) => Promise<void>;
  // True when the commit is in origin/<branch>, null when git cannot say
  isInRemoteBranch: (commit: string, branch: string) => Promise<boolean | null>;
  // The same for many commits with one git process, keyed by the commits asked
  listInRemoteBranch?: ListInRemoteBranch;
}

export type ListInRemoteBranch = (
  commits: string[],
  branch: string,
) => Promise<Map<string, boolean | null>>;

type MajorOrgWindow = {
  branchName: string;
  mergeTargets: string[];
  pullRequestsInBranchSinceLastMerge?: PullRequest[];
};

// Branch names end up on a command line: anything else is not asked about
const SAFE_BRANCH_NAME = /^[\w./-]+$/;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * The answers of the CLI for every promotion step of the pipeline. Asks nothing, not even git,
 * unless the project enables both enablePromotionBranches and detectManualCherryPicks.
 */
export async function loadManualCherryPicks(
  majorOrgs: MajorOrgWindow[],
  projectConfig: any,
  config: PromotionBranchConfig,
  deps?: ManualCherryPickDeps,
): Promise<ManualCherryPickStepResult[]> {
  if (!config.enabled || !isManualCherryPickDetectionEnabled(projectConfig)) {
    return [];
  }
  const steps = listManualCherryPickSteps(
    majorOrgs,
    config.allowedSteps,
  ).filter(
    (step) =>
      SAFE_BRANCH_NAME.test(step.source) && SAFE_BRANCH_NAME.test(step.target),
  );
  if (steps.length === 0) {
    return [];
  }
  const stepDeps = deps || defaultManualCherryPickDeps();
  const results = await Promise.all(
    steps.map(async (step) => {
      try {
        return await loadStep(
          step,
          windowsFingerprint(majorOrgs, step),
          stepDeps,
        );
      } catch (e: any) {
        Logger.log(
          `[vscode-sfdx-hardis] Manual cherry-picks ${step.source} -> ${step.target} not available: ${e?.message || e}`,
        );
        return null;
      }
    }),
  );
  return results.filter(
    (result): result is ManualCherryPickStepResult => result !== null,
  );
}

export function manualCherryPickCacheKey(
  workspaceRoot: string,
  step: PromotionStep,
  tips: BranchTips,
  fingerprint = "",
): string {
  return `manualCherryPicks:${workspaceRoot}|${step.source}>${step.target}|${tips.source}|${tips.target}${fingerprint ? `|${fingerprint}` : ""}`;
}

/**
 * The Pull Requests the git provider lists in the windows of both branches of a step, as a short
 * hash: a release Pull Request squash-merged into the target branch since the last fetch changes
 * it, while the local tips do not move until something fetches.
 */
export function windowsFingerprint(
  majorOrgs: MajorOrgWindow[],
  step: PromotionStep,
): string {
  const rowsOf = (branchName: string) =>
    (
      majorOrgs.find(
        (org) =>
          (org.branchName || "").toLowerCase() === branchName.toLowerCase(),
      )?.pullRequestsInBranchSinceLastMerge || []
    )
      .filter((pr) => !pr.manualCherryPickCopy)
      .map((pr) => `${pr.number ?? pr.id}:${pr.mergeDate || ""}`)
      .sort();
  return createHash("sha1")
    .update(JSON.stringify([rowsOf(step.source), rowsOf(step.target)]))
    .digest("hex")
    .substring(0, 16);
}

/**
 * Where each moved story is waiting, by branch name. A cherry-pick held by a squashed release Pull
 * Request is in the target branch while that Pull Request is in its window; a cherry-pick found by
 * its trailer is there until the next branch holds its commit. Once the next branch holds it, the
 * story went on with it: it is waiting in the furthest branch holding it, as a merged story would
 * be (a top branch has no next branch: what reached it stays there). When git cannot tell, the
 * story is listed in the last branch known to hold it. A release Pull Request out of the window
 * whose commit no next branch holds is listed nowhere, as before.
 *
 * The commits are checked with one git process per branch and per level of the pipeline, never
 * one per story.
 */
export async function listMovesStillInTargetWindow(
  results: ManualCherryPickStepResult[],
  majorOrgs: MajorOrgWindow[],
  isInRemoteBranch?: ManualCherryPickDeps["isInRemoteBranch"],
  listInRemoteBranch?: ListInRemoteBranch,
): Promise<Map<ManualCherryPickMove, string>> {
  const listed = new Map<ManualCherryPickMove, string>();
  const findOrg = (branchName: string) =>
    majorOrgs.find(
      (org) =>
        (org.branchName || "").toLowerCase() ===
        (branchName || "").toLowerCase(),
    );
  const nextOf = (branchName: string): string | null => {
    const next = (findOrg(branchName)?.mergeTargets || [])[0];
    return next && SAFE_BRANCH_NAME.test(next) ? next : null;
  };
  const checkBranch: ListInRemoteBranch = isInRemoteBranch
    ? listInRemoteBranch || oneByOne(isInRemoteBranch)
    : listInRemoteBranch || defaultManualCherryPickDeps().listInRemoteBranch!;

  type Pending = {
    move: ManualCherryPickMove;
    commit: string;
    branch: string;
    visited: Set<string>;
    // A release Pull Request out of the target window: listed only once a next branch holds it
    needsNextBranch: boolean;
  };
  let pending: Pending[] = [];
  for (const result of results) {
    const target = findOrg(result.targetBranch);
    if (!target) {
      continue;
    }
    const windowNumbers = new Set(
      (target.pullRequestsInBranchSinceLastMerge || []).map((pr) =>
        typeof pr.number === "number" ? pr.number : Number(pr.id),
      ),
    );
    for (const move of result.moved) {
      if (move.releasePullRequest) {
        if (windowNumbers.has(parseInt(move.releasePullRequest, 10))) {
          listed.set(move, target.branchName);
          continue;
        }
        const commit = move.carrierCommits.find((sha) => COMMIT_SHA.test(sha));
        if (commit) {
          pending.push({
            move,
            commit,
            branch: target.branchName,
            visited: new Set([target.branchName.toLowerCase()]),
            needsNextBranch: true,
          });
        }
        continue;
      }
      if (!nextOf(target.branchName) || !COMMIT_SHA.test(move.targetCommit)) {
        listed.set(move, target.branchName);
        continue;
      }
      pending.push({
        move,
        commit: move.targetCommit,
        branch: target.branchName,
        visited: new Set([target.branchName.toLowerCase()]),
        needsNextBranch: false,
      });
    }
  }

  const settle = (item: Pending) => {
    if (!item.needsNextBranch) {
      listed.set(item.move, item.branch);
    }
  };
  while (pending.length > 0) {
    const byNext = new Map<string, Pending[]>();
    for (const item of pending) {
      const next = nextOf(item.branch);
      if (!next || item.visited.has(next.toLowerCase())) {
        settle(item);
        continue;
      }
      byNext.set(next, [...(byNext.get(next) || []), item]);
    }
    const stillMoving: Pending[] = [];
    for (const [next, items] of byNext) {
      let answers: Map<string, boolean | null>;
      try {
        answers = await checkBranch(
          [...new Set(items.map((item) => item.commit))],
          next,
        );
      } catch {
        answers = new Map();
      }
      for (const item of items) {
        if (answers.get(item.commit) === true) {
          item.branch = next;
          item.visited.add(next.toLowerCase());
          item.needsNextBranch = false;
          stillMoving.push(item);
        } else {
          settle(item);
        }
      }
    }
    pending = stillMoving;
  }
  return listed;
}

export function defaultManualCherryPickDeps(): ManualCherryPickDeps {
  const workspaceRoot = getWorkspaceRoot();
  const isInRemoteBranch = async (commit: string, branch: string) => {
    try {
      const git = createSimpleGit(workspaceRoot);
      // Prints the commit when origin/<branch> does not hold it, nothing when it does
      const out = await git.raw([
        "rev-list",
        "-n",
        "1",
        commit,
        "--not",
        `origin/${branch}`,
      ]);
      return out.trim() === "";
    } catch {
      return null;
    }
  };
  return {
    workspaceRoot,
    readTips: async (sourceBranch, targetBranch) => {
      try {
        const git = createSimpleGit(workspaceRoot);
        const shas: string[] = (
          await git.raw([
            "rev-parse",
            `origin/${sourceBranch}`,
            `origin/${targetBranch}`,
          ])
        )
          .trim()
          .split(/\s+/);
        return shas.length === 2 && shas.every((sha) => COMMIT_SHA.test(sha))
          ? { source: shas[0], target: shas[1] }
          : null;
      } catch {
        return null;
      }
    },
    runListCandidates: async (sourceBranch, targetBranch) =>
      await runListCandidates(sourceBranch, targetBranch),
    getCached: (key) =>
      CacheManager.get<ManualCherryPickStepResult>("project", key),
    setCached: async (key, value) =>
      await CacheManager.set(
        "project",
        key,
        value,
        MANUAL_CHERRY_PICK_CACHE_TTL_MS,
      ),
    isInRemoteBranch,
    listInRemoteBranch: async (commits, branch) => {
      const answers = new Map<string, boolean | null>();
      const git = createSimpleGit(workspaceRoot);
      for (
        let start = 0;
        start < commits.length;
        start += COMMITS_PER_GIT_COMMAND
      ) {
        const chunk = commits.slice(start, start + COMMITS_PER_GIT_COMMAND);
        try {
          // Prints what the commits hold that origin/<branch> does not: a commit asked about is
          // in the branch when it is not printed
          const notInBranch = (
            await git.raw(["rev-list", ...chunk, "--not", `origin/${branch}`])
          )
            .split(/\s+/)
            .filter((sha) => sha)
            .map((sha) => sha.toLowerCase());
          for (const commit of chunk) {
            const asked = commit.toLowerCase();
            answers.set(
              commit,
              !notInBranch.some((sha) => sha.startsWith(asked)),
            );
          }
        } catch {
          // One unknown commit fails the whole command: ask them one by one instead
          const single = await oneByOne(isInRemoteBranch)(chunk, branch);
          for (const [commit, answer] of single) {
            answers.set(commit, answer);
          }
        }
      }
      return answers;
    },
  };
}

async function loadStep(
  step: PromotionStep,
  fingerprint: string,
  deps: ManualCherryPickDeps,
): Promise<ManualCherryPickStepResult | null> {
  const tips = await deps.readTips(step.source, step.target);
  if (tips) {
    const cached = deps.getCached(
      manualCherryPickCacheKey(deps.workspaceRoot, step, tips, fingerprint),
    );
    if (cached) {
      return cached;
    }
  }
  const raw = await deps.runListCandidates(step.source, step.target);
  if (!raw) {
    return null;
  }
  const parsed = parseManualCherryPickResult(step.source, step.target, raw);
  // The CLI fetches both branches before listing: its answer is about the tips as they are now,
  // which may be newer than the ones read above
  const tipsAfter = await deps.readTips(step.source, step.target);
  if (tipsAfter) {
    await deps.setCached(
      manualCherryPickCacheKey(
        deps.workspaceRoot,
        step,
        tipsAfter,
        fingerprint,
      ),
      parsed,
    );
  }
  return parsed;
}

async function runListCandidates(
  sourceBranch: string,
  targetBranch: string,
): Promise<any | null> {
  // Loaded on use, like before: providerCredentials reaches the VS Code secrets
  const { execSfdxJsonWithProviderCredentials } =
    await import("../providerCredentials");
  return await execSfdxJsonWithProviderCredentials(
    `sf hardis:project:promotion:list-candidates --agent --source-branch ${sourceBranch} --target-branch ${targetBranch}`,
    `Manual cherry-picks ${sourceBranch} -> ${targetBranch}`,
  );
}

// A ListInRemoteBranch from the one-commit check, a few git processes at a time
function oneByOne(
  isInRemoteBranch: ManualCherryPickDeps["isInRemoteBranch"],
): ListInRemoteBranch {
  return async (commits, branch) => {
    const answers = new Map<string, boolean | null>();
    for (let start = 0; start < commits.length; start += GIT_CHECKS_AT_ONCE) {
      const chunk = commits.slice(start, start + GIT_CHECKS_AT_ONCE);
      const results = await Promise.all(
        chunk.map((commit) => isInRemoteBranch(commit, branch)),
      );
      chunk.forEach((commit, index) => answers.set(commit, results[index]));
    }
    return answers;
  };
}
