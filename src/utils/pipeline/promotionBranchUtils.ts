import * as yaml from "js-yaml";
import { PullRequest } from "../gitProviders/types";

/**
 * Promotion branches (sfdx-hardis `enablePromotionBranches`): a branch assembled by
 * cherry-picking approved User Stories from a major branch (ex: uat), so they reach the
 * next major branch (ex: preprod) before the rest of the promotion window. The
 * cherry-picked commits carry new SHAs, so the Pull Request windows (matched by merge
 * commit SHA) cannot see the stories: the promotion Pull Request declares them in a
 * YAML block of its description instead:
 *
 * ```yaml
 * promotionPullRequests: [482, 487, 491]
 * ```
 *
 * Same rules as sfdx-hardis promotionBranchUtils.ts: pure logic over config and Pull
 * Request data, nothing applies while the flag is off.
 */

export const PROMOTION_PULL_REQUESTS_KEY = "promotionPullRequests";
export const PROMOTION_BRANCH_PREFIX = "promotion";
export const BACKPROMOTE_BRANCH_PREFIX = "backpromote/";

/**
 * backpromote/<parent branch>/<sandbox name>: the technical branch sfdx-hardis creates for the
 * backpromote of one sandbox (hardis:work:backpromote). The parent branch may hold slashes, the
 * sandbox name never: it is the last segment. Mirror of the sfdx-hardis rule.
 */
export function parseBackpromoteBranchName(
  branch: string | null | undefined,
): { parentBranch: string; sandboxName: string } | null {
  const value = branch || "";
  if (!value.startsWith(BACKPROMOTE_BRANCH_PREFIX)) {
    return null;
  }
  const rest = value.substring(BACKPROMOTE_BRANCH_PREFIX.length);
  const separator = rest.lastIndexOf("/");
  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }
  return {
    parentBranch: rest.substring(0, separator),
    sandboxName: rest.substring(separator + 1),
  };
}

/** True for a backpromote branch: ignored by the DevOps Pipeline like promotion and retrofit branches */
export function isBackpromoteBranchName(
  branch: string | null | undefined,
): boolean {
  return parseBackpromoteBranchName(branch) !== null;
}

export interface PromotionBranchConfig {
  enabled: boolean;
  /**
   * Steps a promotion may be assembled on (sfdx-hardis `allowedPromotionSteps`). Empty
   * means every step is allowed, which is what a project gets until it declares the list.
   */
  allowedSteps: PromotionStep[];
}

/**
 * One authorized promotion step. An empty target means "any target of that source branch".
 */
export interface PromotionStep {
  source: string;
  target: string;
}

export interface PromotionBranchNameParts {
  sourceBranch: string;
  targetBranch: string;
  date: string;
  /**
   * UTC hour and minutes the promotion was assembled at (HHMM). Null for a name of the
   * first releases of the feature, which carried a counter after the date instead.
   */
  time: string | null;
  /** 1 unless the name ends with -2, -3... because the same name was already taken */
  counter: number;
}

/**
 * Reads the feature switch from the project config and the branch configs: the CLI
 * reads the merged branch config of the target branch, so a project may enable the
 * feature in a single branch file (ex: .sfdx-hardis.preprod.yml).
 */
export function getPromotionBranchConfig(
  configs: Array<any | null | undefined>,
): PromotionBranchConfig {
  const enabled = configs.some(
    (config) => config && config.enablePromotionBranches === true,
  );
  // The first config that declares the list wins: the steps are a project level rule, and
  // merging the lists of several files would widen a restriction instead of applying it.
  const declaring = configs.find(
    (config) => config && Array.isArray(config.allowedPromotionSteps),
  );
  return {
    enabled,
    allowedSteps: parsePromotionSteps(declaring?.allowedPromotionSteps),
  };
}

/**
 * Read sfdx-hardis `allowedPromotionSteps`: the source and target branches a release
 * manager may assemble a promotion between. Entries are objects ({ source: uat, target:
 * preprod }); a "uat > preprod" string is accepted too, since the config file is often
 * edited by hand. An entry without a target allows every target of that source branch.
 */
export function parsePromotionSteps(raw: any): PromotionStep[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const steps: PromotionStep[] = [];
  for (const entry of raw) {
    let source = "";
    let target = "";
    if (typeof entry === "string") {
      const parts = entry.split(/\s*(?:->|→|>)\s*/).map((part) => part.trim());
      source = parts[0] || "";
      target = parts.length > 1 ? parts[1] || "" : "";
    } else if (entry && typeof entry === "object") {
      source = typeof entry.source === "string" ? entry.source.trim() : "";
      target = typeof entry.target === "string" ? entry.target.trim() : "";
    }
    if (!source) {
      continue;
    }
    const alreadyThere = steps.some(
      (step) =>
        step.source.toLowerCase() === source.toLowerCase() &&
        step.target.toLowerCase() === target.toLowerCase(),
    );
    if (!alreadyThere) {
      steps.push({ source, target });
    }
  }
  return steps;
}

/**
 * True when a promotion from source to target is authorized. An empty list authorizes
 * everything: the restriction is opt-in, so a pipeline that never declared it is unchanged.
 */
export function isPromotionStepAllowed(
  steps: PromotionStep[] | undefined | null,
  sourceBranch: string | undefined | null,
  targetBranch: string | undefined | null,
): boolean {
  if (!steps || steps.length === 0) {
    return true;
  }
  const source = (sourceBranch || "").toLowerCase();
  const target = (targetBranch || "").toLowerCase();
  return steps.some(
    (step) =>
      step.source.toLowerCase() === source &&
      (step.target === "" || step.target.toLowerCase() === target),
  );
}

/**
 * True when a promotion may start from this branch, whatever its target.
 */
export function isPromotionSourceAllowed(
  steps: PromotionStep[] | undefined | null,
  sourceBranch: string | undefined | null,
): boolean {
  if (!steps || steps.length === 0) {
    return true;
  }
  const source = (sourceBranch || "").toLowerCase();
  return steps.some((step) => step.source.toLowerCase() === source);
}

/**
 * The branches of `targetBranches` a promotion from `sourceBranch` may go to.
 */
export function allowedPromotionTargetBranches(
  steps: PromotionStep[] | undefined | null,
  sourceBranch: string | undefined | null,
  targetBranches: string[],
): string[] {
  if (!steps || steps.length === 0) {
    return [...targetBranches];
  }
  return targetBranches.filter((branch) =>
    isPromotionStepAllowed(steps, sourceBranch, branch),
  );
}

// HHMM of a valid time of day: 0000 to 2359
const PROMOTION_BRANCH_TIME_REGEX = /^([01]\d|2[0-3])[0-5]\d$/;

/**
 * Splits a promotion branch name into its parts. The convention is not configurable:
 * promotion/<source major branch>/<target major branch>/<YYYY-MM-DD>-<HHMM> (UTC), with
 * -2, -3... added by sfdx-hardis only when that name is already taken.
 * Returns null for anything else, including a bare "promotion/xxx".
 *
 * Same rules as parsePromotionBranchName in sfdx-hardis: the <YYYY-MM-DD>-<counter> names
 * of the first releases are still recognized, since those promotions can still be open or
 * waiting in a branch, and a group of four digits that is a valid time of day is the time.
 */
export function parsePromotionBranchName(
  branchName: string | undefined | null,
): PromotionBranchNameParts | null {
  const segments = (branchName || "").trim().split("/");
  if (
    segments.length !== 4 ||
    segments[0].toLowerCase() !== PROMOTION_BRANCH_PREFIX
  ) {
    return null;
  }
  const [, sourceBranch, targetBranch, suffix] = segments;
  const suffixMatch = suffix.match(/^(\d{4}-\d{2}-\d{2})-(\d+)(?:-(\d+))?$/);
  if (!sourceBranch || !targetBranch || !suffixMatch) {
    return null;
  }
  const [, date, first, second] = suffixMatch;
  if (second !== undefined) {
    // <HHMM>-<n>: the part before the counter must really be a time
    return PROMOTION_BRANCH_TIME_REGEX.test(first)
      ? {
          sourceBranch,
          targetBranch,
          date,
          time: first,
          counter: parseInt(second, 10),
        }
      : null;
  }
  if (PROMOTION_BRANCH_TIME_REGEX.test(first)) {
    return { sourceBranch, targetBranch, date, time: first, counter: 1 };
  }
  return {
    sourceBranch,
    targetBranch,
    date,
    time: null,
    counter: parseInt(first, 10),
  };
}

/**
 * True for a branch following the promotion/<source>/<target>/<YYYY-MM-DD>-<HHMM>
 * convention (or the <YYYY-MM-DD>-<counter> one of the first releases): a hand-named
 * promotion/xxx branch is not a promotion branch.
 */
export function isPromotionBranchName(
  branchName: string | undefined | null,
): boolean {
  return parsePromotionBranchName(branchName) !== null;
}

/**
 * Pull Request numbers declared in the YAML blocks of a description. Accepts numbers
 * and strings ("482", "#482", "!482"), returns null when the key is absent.
 */
export function parsePromotionPullRequestIds(
  description: string | null | undefined,
): number[] | null {
  const blocks = extractYamlBlocks(description || "");
  let found = false;
  const ids: number[] = [];
  for (const block of blocks) {
    let parsed: any;
    try {
      parsed = yaml.load(block);
    } catch {
      continue;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Object.prototype.hasOwnProperty.call(parsed, PROMOTION_PULL_REQUESTS_KEY)
    ) {
      continue;
    }
    found = true;
    const raw = parsed[PROMOTION_PULL_REQUESTS_KEY];
    const items = Array.isArray(raw)
      ? raw
      : raw === null || raw === undefined
        ? []
        : [raw];
    for (const item of items) {
      const id = normalizePullRequestId(item);
      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return found ? ids : null;
}

function normalizePullRequestId(item: any): number | null {
  if (typeof item === "number") {
    return Number.isInteger(item) && item > 0 ? item : null;
  }
  if (typeof item === "string") {
    const match = item.trim().match(/(\d+)\s*$/);
    if (match) {
      const id = parseInt(match[1], 10);
      return id > 0 ? id : null;
    }
  }
  return null;
}

function extractYamlBlocks(description: string): string[] {
  const blocks: string[] = [];
  const regex = /```ya?ml\s*\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(description)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * A promotion Pull Request needs the flag, the naming convention and the declared list.
 */
export function isPromotionPullRequest(
  pr: Pick<PullRequest, "sourceBranch" | "description"> | null | undefined,
  config: PromotionBranchConfig,
): boolean {
  if (!config.enabled || !pr) {
    return false;
  }
  return (
    isPromotionBranchName(pr.sourceBranch) &&
    parsePromotionPullRequestIds(pr.description) !== null
  );
}

/**
 * A Pull Request is merged when the aggregated state says so, or when it carries a merge date:
 * some providers only expose the date (GitHub closes a merged Pull Request).
 */
export function isMergedPullRequest(pr: PullRequest): boolean {
  return pr.state === "merged" || !!pr.mergeDate;
}

function prNumber(pr: PullRequest): number {
  const value =
    typeof pr.number === "number" ? pr.number : parseInt(String(pr.id), 10);
  return Number.isFinite(value) ? value : 0;
}

export function markCarriedBy(
  story: PullRequest,
  promotion: PullRequest,
): void {
  story.carriedByPullRequest = {
    number: prNumber(promotion),
    sourceBranch: promotion.sourceBranch || "",
    webUrl: promotion.webUrl || "",
  };
}

/**
 * One-level expansion of a window: every promotion Pull Request in it brings the
 * stories it declares, resolved first among the Pull Requests already loaded, then
 * through `fetch` (a provider call). Returns the added stories apart, so the caller
 * can enrich only those with tickets and deployment actions.
 */
export async function expandPullRequestsWithPromotions(
  pullRequests: PullRequest[],
  config: PromotionBranchConfig,
  known: Map<number, PullRequest>,
  fetch: (number: number) => Promise<PullRequest | null>,
): Promise<{ all: PullRequest[]; added: PullRequest[] }> {
  if (!config.enabled) {
    return { all: pullRequests, added: [] };
  }
  const all = [...pullRequests];
  const added: PullRequest[] = [];
  const present = new Set(pullRequests.map(prNumber));
  // Iterate over `all`, which grows as stories are added: a promotion may carry another promotion
  // (preprod -> main carrying the uat -> preprod one, which the command itself produces), and the
  // User Stories are one level further down. `present` makes this terminate.
  for (let index = 0; index < all.length; index++) {
    const pr = all[index];
    if (!isPromotionPullRequest(pr, config)) {
      continue;
    }
    pr.isPromotion = true;
    pr.promotionPullRequests =
      parsePromotionPullRequestIds(pr.description) || [];
    for (const number of pr.promotionPullRequests) {
      if (present.has(number)) {
        continue;
      }
      let story = known.get(number) || null;
      if (!story) {
        try {
          story = await fetch(number);
        } catch {
          story = null;
        }
      }
      // Missing or not merged: its content cannot be in the branch
      if (!story || !isMergedPullRequest(story)) {
        continue;
      }
      const copy: PullRequest = { ...story };
      markCarriedBy(copy, pr);
      present.add(number);
      all.push(copy);
      added.push(copy);
    }
  }
  return { all, added };
}

/**
 * One pass over the merged promotion Pull Requests of a pipeline, so the per-story lookups
 * below cost a Map read instead of parsing every description again. A project with a thousand
 * Pull Requests would otherwise parse the same YAML blocks thousands of times.
 */
export interface PromotionIndex {
  // story number -> the merged promotions that declare it
  byStory: Map<number, PromotionReference[]>;
  // lowercased source branch -> the story numbers a promotion took out of that branch
  promotedOutOf: Map<string, Set<number>>;
}

export interface PromotionReference {
  number: number;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  mergeDate: string;
}

export const EMPTY_PROMOTION_INDEX: PromotionIndex = {
  byStory: new Map(),
  promotedOutOf: new Map(),
};

export function buildPromotionIndex(
  promotionPullRequests: PullRequest[],
  config: PromotionBranchConfig,
): PromotionIndex {
  const index: PromotionIndex = {
    byStory: new Map(),
    promotedOutOf: new Map(),
  };
  if (!config.enabled) {
    return index;
  }
  for (const promotion of promotionPullRequests) {
    if (
      !isPromotionPullRequest(promotion, config) ||
      !isMergedPullRequest(promotion)
    ) {
      continue;
    }
    const parts = parsePromotionBranchName(promotion.sourceBranch);
    const reference: PromotionReference = {
      number: prNumber(promotion),
      sourceBranch: promotion.sourceBranch || "",
      targetBranch: promotion.targetBranch || "",
      webUrl: promotion.webUrl || "",
      mergeDate: promotion.mergeDate || "",
    };
    const fromBranch = (parts?.sourceBranch || "").toLowerCase();
    for (const storyNumber of parsePromotionPullRequestIds(
      promotion.description,
    ) || []) {
      if (storyNumber === reference.number) {
        continue; // a promotion never carries itself
      }
      const carriers = index.byStory.get(storyNumber) || [];
      if (!carriers.some((carrier) => carrier.number === reference.number)) {
        carriers.push(reference);
      }
      index.byStory.set(storyNumber, carriers);
      if (fromBranch) {
        const promotedOut =
          index.promotedOutOf.get(fromBranch) || new Set<number>();
        promotedOut.add(storyNumber);
        index.promotedOutOf.set(fromBranch, promotedOut);
      }
    }
  }
  return index;
}

/**
 * Merged promotion Pull Requests declaring a story: the story has already been shipped
 * through them. Informational only, the story stays in its window.
 */
export function findPromotionsCarrying(
  storyNumber: number,
  index: PromotionIndex,
): PromotionReference[] {
  if (!storyNumber) {
    return [];
  }
  return index.byStory.get(storyNumber) || [];
}

/**
 * Annotates the Pull Requests of one branch window.
 *
 * `alreadyDeployedVia` says which merged promotions already shipped the story, wherever they
 * were merged. `promotedAway` is stricter and is what removes the duplicate from the pipeline
 * diagram: it is set when a promotion assembled **from this very branch** carried the story,
 * so the story now belongs to the next branch window and must be listed there only.
 */
export function annotateAlreadyPromoted(
  pullRequests: PullRequest[],
  branchName: string,
  index: PromotionIndex,
  config: PromotionBranchConfig,
): void {
  if (!config.enabled) {
    return;
  }
  const promotedOut = index.promotedOutOf.get((branchName || "").toLowerCase());
  for (const pr of pullRequests) {
    const number = prNumber(pr);
    const promotions = findPromotionsCarrying(number, index).filter(
      (promotion) => promotion.number !== number,
    );
    // "Already deployed via" belongs to the branch the story is still waiting in, not to the one
    // the promotion brought it into: there it is simply carried by that promotion, which is what
    // the pending "Carried by" pill says.
    const carriedIntoThisBranch = promotions.some(
      (promotion) =>
        (promotion.targetBranch || "").toLowerCase() ===
        (branchName || "").toLowerCase(),
    );
    if (promotions.length > 0 && !carriedIntoThisBranch) {
      pr.alreadyDeployedVia = promotions;
    }
    pr.promotedAway = promotedOut ? promotedOut.has(number) : false;
  }
}

/**
 * The Pull Requests a window shows: a story a promotion took out of the branch is listed in the
 * branch it reached only, so a Pull Request number appears once in the whole pipeline.
 */
export function visiblePullRequests(
  pullRequests: PullRequest[],
): PullRequest[] {
  return pullRequests.filter((pr) => pr.promotedAway !== true);
}

/**
 * A Pull Request between two major branches (ex: uat -> preprod): plumbing of the pipeline,
 * not a User Story. The stories it moves are listed on their own.
 */
export function isMajorToMajorPullRequest(
  pr: Pick<PullRequest, "sourceBranch" | "targetBranch">,
  majorBranchNames: string[],
): boolean {
  const majors = new Set(
    majorBranchNames.map((name) => (name || "").toLowerCase()),
  );
  return (
    majors.has((pr.sourceBranch || "").toLowerCase()) &&
    majors.has((pr.targetBranch || "").toLowerCase())
  );
}

/**
 * What a user reads as "the work in this branch": everything that carries its own change, whatever
 * the branch is named (feature, fix, retrofit, hotfix...). Only the Pull Requests that move OTHER
 * Pull Requests are left out, and `showPromotions` brings them back.
 */
export function userStoryPullRequests(
  pullRequests: PullRequest[],
  majorBranchNames: string[],
  config: PromotionBranchConfig,
  showPromotions = false,
): PullRequest[] {
  if (showPromotions) {
    return pullRequests;
  }
  return pullRequests.filter(
    (pr) => !isVehiclePullRequest(pr, majorBranchNames, config),
  );
}

/**
 * A Pull Request that moves other Pull Requests rather than carrying work of its own: a merge
 * between two major branches, or a promotion. Nothing else: a retrofit brings the RUN stream back
 * into the BUILD stream, which is work the reader wants to see, like any feature or fix branch.
 *
 * A merge between two major branches is plumbing in every pipeline, so it is left out whether or
 * not the project enabled promotion branches. A promotion Pull Request only exists as such when
 * the feature is on: without it, a promotion/ branch is an ordinary branch, exactly as the
 * deployment jobs treat it.
 */
export function isVehiclePullRequest(
  pr: PullRequest,
  majorBranchNames: string[],
  config: PromotionBranchConfig,
): boolean {
  return (
    isMajorToMajorPullRequest(pr, majorBranchNames) ||
    isBackpromoteBranchName(pr.sourceBranch) ||
    (config.enabled && isPromotionPullRequest(pr, config)) ||
    // Only set when detectManualCherryPicks found the stories it carried
    (config.enabled && pr.carriesManualCherryPicks === true)
  );
}

/**
 * The documented invariant of the pipeline: a Pull Request number is listed in one branch only,
 * the one it has reached. Derived from the windows themselves rather than from the promotion
 * index, so it still holds once a promotion has left the window it was merged into.
 *
 * `orderedBranchNames` goes upstream first (integration, uat, preprod, main): of two windows
 * holding the same number, the downstream one wins, and the upstream copies are marked
 * `promotedAway` so `visiblePullRequests` leaves them out.
 */
export function enforceSinglePlacePerPullRequest(
  windowsByBranch: Array<{ branchName: string; pullRequests: PullRequest[] }>,
  config: PromotionBranchConfig,
): void {
  if (!config.enabled) {
    return;
  }
  const lastIndexByNumber = new Map<number, number>();
  windowsByBranch.forEach((entry, index) => {
    for (const pr of entry.pullRequests) {
      const number = prNumber(pr);
      if (number > 0) {
        lastIndexByNumber.set(number, index);
      }
    }
  });
  windowsByBranch.forEach((entry, index) => {
    for (const pr of entry.pullRequests) {
      const number = prNumber(pr);
      if (number <= 0) {
        continue;
      }
      // Only a story a promotion moved on is hidden upstream. A vehicle stays where it was merged.
      const promotedFurther = lastIndexByNumber.get(number) !== index;
      if (promotedFurther && !isPromotionPullRequest(pr, config)) {
        pr.promotedAway = true;
      }
    }
  });
}

/**
 * Manual cherry-picks (sfdx-hardis `detectManualCherryPicks`, Beta): User Stories that reached the
 * next major branch through a cherry-pick made by hand rather than a promotion branch. The CLI is
 * the only engine (hardis:project:promotion:list-candidates); the extension only places what it
 * answers, one result per promotion step.
 */
export interface ManualCherryPickStepResult {
  sourceBranch: string;
  targetBranch: string;
  // Stories the CLI found in the target branch: they leave the source window for the target one
  moved: ManualCherryPickMove[];
  // Stories some of whose commits were found: they stay in the source window, flagged
  partial: Array<{
    pullRequests: number[];
    foundCommits: number;
    totalCommits: number;
    targetCommit: string;
  }>;
  // Stories only matched by a commit title: they stay in the source window, flagged
  probable: Array<{
    pullRequests: number[];
    targetCommit: string;
    subject: string;
  }>;
}

export interface ManualCherryPickMove {
  // Empty for a row of the source branch with no number (a squashed merge between major branches,
  // whose number the CLI drops as a vehicle): nothing to place, but a carrier the previous step
  // may point to
  pullRequests: number[];
  // The first-parent commit of the source branch this row stands for
  rowCommit: string;
  // What carries the story into the target branch, as the next step lists it (CLI carrier)
  carrierPullRequest: number | null;
  carrierCommits: string[];
  // The carrier is a story of its own (a hotfix branched from the source branch, with a fix of
  // its own), not a mere vehicle: it is not hidden like a promotion then. False with a CLI that
  // does not say it
  carrierIsOwnStory: boolean;
  signal: string;
  targetCommit: string;
  // The squashed Pull Request of the target branch that held the cherry-pick, when the CLI found
  // it through the commits the git provider lists for it (signal pull-request-commits)
  releasePullRequest: string;
  releaseBranch: string;
  releaseUrl: string;
}

/**
 * The detection only runs when the project enables both settings: it costs one CLI process per
 * promotion step. Project level only, like enablePromotionBranches.
 */
export function isManualCherryPickDetectionEnabled(
  projectConfig: any,
): boolean {
  return (
    !!projectConfig &&
    projectConfig.enablePromotionBranches === true &&
    projectConfig.detectManualCherryPicks === true
  );
}

/**
 * The promotion steps to ask the CLI about: the allowed steps that are a real edge of the
 * pipeline (the target is a merge target of the source branch), and whose source window holds
 * something to place. An empty list of allowed steps asks nothing: the CLI refuses to list
 * candidates while the project has not declared them.
 */
export function listManualCherryPickSteps(
  majorOrgs: Array<{
    branchName: string;
    mergeTargets: string[];
    pullRequestsInBranchSinceLastMerge?: PullRequest[];
  }>,
  allowedSteps: PromotionStep[] | null | undefined,
): PromotionStep[] {
  const steps: PromotionStep[] = [];
  for (const step of allowedSteps || []) {
    const org = majorOrgs.find(
      (entry) =>
        (entry.branchName || "").toLowerCase() === step.source.toLowerCase(),
    );
    if (!org || (org.pullRequestsInBranchSinceLastMerge || []).length === 0) {
      continue;
    }
    for (const target of org.mergeTargets || []) {
      if (
        step.target !== "" &&
        target.toLowerCase() !== step.target.toLowerCase()
      ) {
        continue;
      }
      const alreadyThere = steps.some(
        (entry) =>
          entry.source.toLowerCase() === org.branchName.toLowerCase() &&
          entry.target.toLowerCase() === target.toLowerCase(),
      );
      if (!alreadyThere) {
        steps.push({ source: org.branchName, target });
      }
    }
  }
  return steps;
}

/**
 * Reads the `result` of `sf hardis:project:promotion:list-candidates --json`: the candidate
 * summaries of `alreadyPromoted` carrying `alreadyPromotedBy.manualCherryPick` moved, the
 * `candidates` flagged `partiallyCherryPicked` or `probablyCherryPicked` stay. Anything else
 * (a story a promotion carries, a malformed entry) is left out.
 */
export function parseManualCherryPickResult(
  sourceBranch: string,
  targetBranch: string,
  result: any,
): ManualCherryPickStepResult {
  const parsed: ManualCherryPickStepResult = {
    sourceBranch,
    targetBranch,
    moved: [],
    partial: [],
    probable: [],
  };
  const alreadyPromoted = Array.isArray(result?.alreadyPromoted)
    ? result.alreadyPromoted
    : [];
  for (const entry of alreadyPromoted) {
    const by = entry?.alreadyPromotedBy;
    const manual = by?.manualCherryPick;
    if (!manual) {
      continue;
    }
    // A row with no number is kept: the previous step may name it as the carrier of its stories
    const numbers = pullRequestNumbersOf(entry);
    const signal = String(manual.signal || "");
    // With the trailer signal, pullRequest is only the short target commit and branch the
    // target branch itself: there is no release Pull Request to name
    const fromPullRequest = signal === "pull-request-commits";
    const carrierNumber = normalizePullRequestId(manual.carrier?.pullRequest);
    const carrierIsOwnStory =
      manual.carrier?.heldSourceBranchCommits === true &&
      Number(manual.carrier?.ownCommits) > 0;
    parsed.moved.push({
      pullRequests: numbers,
      rowCommit: String(entry?.commit || ""),
      carrierPullRequest: carrierNumber,
      carrierCommits: Array.isArray(manual.carrier?.commits)
        ? manual.carrier.commits
            .map((sha: any) => String(sha || ""))
            .filter((sha: string) => sha)
        : [],
      carrierIsOwnStory,
      signal,
      targetCommit: String(manual.targetCommit || ""),
      releasePullRequest: fromPullRequest ? String(by.pullRequest || "") : "",
      releaseBranch: fromPullRequest ? String(by.branch || "") : "",
      releaseUrl: fromPullRequest ? String(by.url || "") : "",
    });
  }
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  for (const entry of candidates) {
    const numbers = pullRequestNumbersOf(entry);
    if (numbers.length === 0) {
      continue;
    }
    const partial = entry?.partiallyCherryPicked;
    const probable = entry?.probablyCherryPicked;
    if (partial) {
      parsed.partial.push({
        pullRequests: numbers,
        foundCommits: Array.isArray(partial.foundCommits)
          ? partial.foundCommits.length
          : Number(partial.foundCommits) || 0,
        totalCommits: Number(partial.totalCommits) || 0,
        targetCommit: String(partial.targetCommit || ""),
      });
    } else if (probable) {
      parsed.probable.push({
        pullRequests: numbers,
        targetCommit: String(probable.targetCommit || ""),
        subject: String(probable.subject || ""),
      });
    }
  }
  return parsed;
}

/**
 * How far a story cherry-picked by hand went. Each step result only says it reached the next
 * branch, held by a carrier (a squashed release Pull Request, a squashed merge between major
 * branches): when the next step finds that very carrier in its own target branch, the story went
 * there with it. Followed step after step, by number or by commit, so a story is placed where its
 * carrier ended up, not one branch short.
 *
 * Returns every hop, the first being the given one: the last is where the story is.
 */
export function resolveManualCherryPickChain(
  results: ManualCherryPickStepResult[],
  result: ManualCherryPickStepResult,
  move: ManualCherryPickMove,
): Array<{ result: ManualCherryPickStepResult; move: ManualCherryPickMove }> {
  const hops = [{ result, move }];
  const visited = new Set<string>([result.sourceBranch.toLowerCase()]);
  let current = hops[0];
  while (!visited.has(current.result.targetBranch.toLowerCase())) {
    visited.add(current.result.targetBranch.toLowerCase());
    const next = results.find(
      (entry) =>
        entry.sourceBranch.toLowerCase() ===
        current.result.targetBranch.toLowerCase(),
    );
    if (!next) {
      break;
    }
    const carrierNumber = current.move.carrierPullRequest;
    const carrierCommits = current.move.carrierCommits;
    const carried = next.moved.find(
      (entry) =>
        (carrierNumber !== null &&
          entry.pullRequests.includes(carrierNumber)) ||
        carrierCommits.some((sha) => sameCommit(sha, entry.rowCommit)),
    );
    if (!carried) {
      break;
    }
    current = { result: next, move: carried };
    hops.push(current);
  }
  return hops;
}

/**
 * Places the answers of the CLI in the windows, the way a promotion places its stories: a story
 * cherry-picked by hand is `promotedAway` from the source window and listed in the target window,
 * so its number still appears once in the pipeline. A story a promotion of the step already
 * carried keeps that placement: the declaration of a promotion always wins.
 *
 * `isStillInTargetWindow` says where the cherry-pick is waiting: true for the target branch, the
 * name of a branch further down when the target branch was merged on (the story went with it, so
 * it is listed there, as a merged story would be), false when nothing can say. A story is never
 * listed in a branch it only went through.
 *
 * Partial and probable matches stay where they are, flagged.
 */
export function applyManualCherryPicks(
  windows: Array<{ branchName: string; pullRequests: PullRequest[] }>,
  results: ManualCherryPickStepResult[],
  index: PromotionIndex,
  config: PromotionBranchConfig,
  isStillInTargetWindow: (
    result: ManualCherryPickStepResult,
    move: ManualCherryPickMove,
  ) => boolean | string = () => true,
): void {
  if (!config.enabled) {
    return;
  }
  const findWindow = (branchName: string) =>
    windows.find(
      (entry) =>
        (entry.branchName || "").toLowerCase() ===
        (branchName || "").toLowerCase(),
    );
  const findStory = (pullRequests: PullRequest[], number: number) =>
    pullRequests.find((pr) => prNumber(pr) === number);
  for (const result of results) {
    const source = findWindow(result.sourceBranch);
    if (!source) {
      continue;
    }
    const promotedOut =
      index.promotedOutOf.get((result.sourceBranch || "").toLowerCase()) ||
      new Set<number>();
    for (const move of result.moved) {
      // The story goes as far as its carrier went: the last hop says where, and how
      const hops = resolveManualCherryPickChain(results, result, move);
      const last = hops[hops.length - 1];
      const target = findWindow(last.result.targetBranch);
      const reference = {
        targetBranch: last.result.targetBranch,
        signal: last.move.signal,
        targetCommit: last.move.targetCommit,
        ...(last.move.releasePullRequest
          ? {
              releasePullRequest: last.move.releasePullRequest,
              releaseBranch: last.move.releaseBranch,
              releaseUrl: last.move.releaseUrl,
            }
          : {}),
      };
      const waitingIn = isStillInTargetWindow(last.result, last.move);
      const listedBranch =
        waitingIn === true
          ? last.result.targetBranch
          : typeof waitingIn === "string" && waitingIn
            ? waitingIn
            : "";
      const listedWindow = listedBranch ? findWindow(listedBranch) : undefined;
      // Every carrier on the way moves other stories: a vehicle, like a promotion. Unless it is a
      // story of its own that also brought some (a hotfix branched from the source branch)
      for (const hop of hops) {
        const carrierNumber = hop.move.carrierPullRequest;
        if (carrierNumber === null || hop.move.carrierIsOwnStory) {
          continue;
        }
        for (const window of windows) {
          const carrier = findStory(window.pullRequests, carrierNumber);
          if (carrier) {
            carrier.carriesManualCherryPicks = true;
          }
        }
      }
      for (const number of move.pullRequests) {
        if (promotedOut.has(number)) {
          continue;
        }
        const story = findStory(source.pullRequests, number);
        if (!story || isPromotionPullRequest(story, config)) {
          continue;
        }
        story.manualCherryPick = { ...reference };
        story.promotedAway = true;
        // Nor is it waiting in a branch it only went through
        const passedThroughBranches = hops
          .slice(0, -1)
          .map((hop) => hop.result.targetBranch);
        if (
          listedWindow &&
          listedWindow !== target &&
          last.result.targetBranch
        ) {
          passedThroughBranches.push(last.result.targetBranch);
        }
        for (const branchName of passedThroughBranches) {
          const passedThrough = findWindow(branchName);
          const copy = passedThrough
            ? findStory(passedThrough.pullRequests, number)
            : undefined;
          if (copy && !copy.carriedByPullRequest) {
            copy.manualCherryPick = { ...reference };
            copy.promotedAway = true;
          }
        }
        if (!listedWindow) {
          continue;
        }
        const existing = findStory(listedWindow.pullRequests, number);
        if (existing) {
          // Already listed there (a promotion carried it in, or the window holds it): only say how
          // it came, unless a promotion did
          if (!existing.carriedByPullRequest) {
            existing.manualCherryPick = { ...reference };
          }
          continue;
        }
        const copy: PullRequest = {
          ...story,
          promotedAway: false,
          manualCherryPick: { ...reference },
          // Not a row of that branch: the next promotion carries it through its carrier
          manualCherryPickCopy: true,
        };
        // What brought it into the source window does not apply to the target one
        delete copy.alreadyDeployedVia;
        delete copy.carriedByPullRequest;
        delete copy.partiallyCherryPicked;
        delete copy.probablyCherryPicked;
        listedWindow.pullRequests.push(copy);
      }
    }
    for (const partial of result.partial) {
      for (const number of partial.pullRequests) {
        const story = findStory(source.pullRequests, number);
        if (!story || story.promotedAway === true) {
          continue;
        }
        story.partiallyCherryPicked = {
          targetBranch: result.targetBranch,
          foundCommits: partial.foundCommits,
          totalCommits: partial.totalCommits,
          targetCommit: partial.targetCommit,
        };
      }
    }
    for (const probable of result.probable) {
      for (const number of probable.pullRequests) {
        const story = findStory(source.pullRequests, number);
        if (
          !story ||
          story.promotedAway === true ||
          story.partiallyCherryPicked
        ) {
          continue;
        }
        story.probablyCherryPicked = {
          targetBranch: result.targetBranch,
          targetCommit: probable.targetCommit,
          subject: probable.subject,
        };
      }
    }
  }
}

function sameCommit(a: string, b: string): boolean {
  return !!a && !!b && (a.startsWith(b) || b.startsWith(a));
}

function pullRequestNumbersOf(entry: any): number[] {
  const raw = Array.isArray(entry?.pullRequests) ? entry.pullRequests : [];
  const numbers: number[] = [];
  for (const item of raw) {
    const number = normalizePullRequestId(item);
    if (number !== null && !numbers.includes(number)) {
      numbers.push(number);
    }
  }
  return numbers;
}
