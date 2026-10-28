import { execSfdxJson, getWorkspaceRoot } from "../../utils";
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
 * workspace, keyed by the tips of origin/<source> and origin/<target>: a refresh of an unchanged
 * pipeline runs no CLI process at all, and a new commit on either side asks again.
 */

// A safety net only: a moved tip already invalidates the key
export const MANUAL_CHERRY_PICK_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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
}

// Branch names end up on a command line: anything else is not asked about
const SAFE_BRANCH_NAME = /^[\w./-]+$/;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * The answers of the CLI for every promotion step of the pipeline. Asks nothing, not even git,
 * unless the project enables both enablePromotionBranches and detectManualCherryPicks.
 */
export async function loadManualCherryPicks(
  majorOrgs: Array<{
    branchName: string;
    mergeTargets: string[];
    pullRequestsInBranchSinceLastMerge?: PullRequest[];
  }>,
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
        return await loadStep(step, stepDeps);
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
): string {
  return `manualCherryPicks:${workspaceRoot}|${step.source}>${step.target}|${tips.source}|${tips.target}`;
}

/**
 * The moves whose story is still waiting in the target branch, so it is listed in its window. A
 * cherry-pick held by a squashed release Pull Request is there while that Pull Request is in the
 * window; a cherry-pick found by its trailer is there until the next branch holds its commit. A
 * top branch has no next branch: what reached it stays there. When git cannot tell, the story is
 * listed in the target window, where the CLI says it is.
 */
export async function listMovesStillInTargetWindow(
  results: ManualCherryPickStepResult[],
  majorOrgs: Array<{
    branchName: string;
    mergeTargets: string[];
    pullRequestsInBranchSinceLastMerge?: PullRequest[];
  }>,
  isInRemoteBranch?: ManualCherryPickDeps["isInRemoteBranch"],
): Promise<Set<ManualCherryPickMove>> {
  const listed = new Set<ManualCherryPickMove>();
  const inRemoteBranch =
    isInRemoteBranch || defaultManualCherryPickDeps().isInRemoteBranch;
  const checks: Array<Promise<void>> = [];
  for (const result of results) {
    const target = majorOrgs.find(
      (org) =>
        (org.branchName || "").toLowerCase() ===
        result.targetBranch.toLowerCase(),
    );
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
          listed.add(move);
        }
        continue;
      }
      const nextBranch = (target.mergeTargets || [])[0];
      if (
        !nextBranch ||
        !COMMIT_SHA.test(move.targetCommit) ||
        !SAFE_BRANCH_NAME.test(nextBranch)
      ) {
        listed.add(move);
        continue;
      }
      checks.push(
        inRemoteBranch(move.targetCommit, nextBranch).then((inNext) => {
          if (inNext !== true) {
            listed.add(move);
          }
        }),
      );
    }
  }
  await Promise.all(checks);
  return listed;
}

export function defaultManualCherryPickDeps(): ManualCherryPickDeps {
  const workspaceRoot = getWorkspaceRoot();
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
    isInRemoteBranch: async (commit, branch) => {
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
    },
  };
}

async function loadStep(
  step: PromotionStep,
  deps: ManualCherryPickDeps,
): Promise<ManualCherryPickStepResult | null> {
  const tips = await deps.readTips(step.source, step.target);
  if (tips) {
    const cached = deps.getCached(
      manualCherryPickCacheKey(deps.workspaceRoot, step, tips),
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
      manualCherryPickCacheKey(deps.workspaceRoot, step, tipsAfter),
      parsed,
    );
  }
  return parsed;
}

async function runListCandidates(
  sourceBranch: string,
  targetBranch: string,
): Promise<any | null> {
  // Agent mode never prompts for the git provider connection: the token goes in the environment
  let env: Record<string, string> = {};
  try {
    const { collectProviderCredentialEnvVars } =
      await import("../providerCredentials");
    env = await collectProviderCredentialEnvVars();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Manual cherry-picks: provider credentials not collected: ${e?.message || e}`,
    );
  }
  const result = await execSfdxJson(
    `sf hardis:project:promotion:list-candidates --agent --source-branch ${sourceBranch} --target-branch ${targetBranch}`,
    {
      fail: false,
      output: false,
      debug: false,
      reuseRecentResult: false,
      env,
    },
  );
  if (result?.status === 0 && result?.result) {
    return result.result;
  }
  Logger.log(
    `[vscode-sfdx-hardis] Manual cherry-picks ${sourceBranch} -> ${targetBranch} not available: ${String(result?.errorMessage || result?.message || "unknown error")}`,
  );
  return null;
}
