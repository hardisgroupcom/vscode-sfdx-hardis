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

export interface PromotionBranchConfig {
  enabled: boolean;
}

export interface PromotionBranchNameParts {
  sourceBranch: string;
  targetBranch: string;
  date: string;
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
  return { enabled };
}

/**
 * Splits a promotion branch name into its parts. The convention is not configurable:
 * promotion/<source major branch>/<target major branch>/<YYYY-MM-DD>-<counter>.
 * Returns null for anything else, including a bare "promotion/xxx".
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
  const suffixMatch = suffix.match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (!sourceBranch || !targetBranch || !suffixMatch) {
    return null;
  }
  return {
    sourceBranch,
    targetBranch,
    date: suffixMatch[1],
    counter: parseInt(suffixMatch[2], 10),
  };
}

/**
 * True for a branch following the promotion/<source>/<target>/<YYYY-MM-DD>-<counter>
 * convention: a hand-named promotion/xxx branch is not a promotion branch.
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
 * The Pull Requests a window shows: the ones a promotion took out of the branch are listed in
 * the branch they reached instead, so a Pull Request number appears once in the whole pipeline.
 * `showAlreadyPromoted` brings them back.
 */
export function visiblePullRequests(
  pullRequests: PullRequest[],
  showAlreadyPromoted = false,
): PullRequest[] {
  if (showAlreadyPromoted) {
    return pullRequests;
  }
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
 * A retrofit Pull Request (retrofit/<name> -> development branch) brings the RUN stream back into
 * the BUILD stream: plumbing as well, the same convention sfdx-hardis uses for the scope of jobs.
 */
export function isRetrofitPullRequest(
  pr: Pick<PullRequest, "sourceBranch">,
): boolean {
  const source = (pr.sourceBranch || "").toLowerCase();
  return source === "retrofit" || source.startsWith("retrofit/");
}

/**
 * What a user reads as "the work in this branch": the User Story Pull Requests. Promotion,
 * major-to-major and retrofit Pull Requests are the vehicles that move them, so they are left out
 * of the lists and counters unless asked for with `showPromotions`. A promotion Pull Request is
 * recognized whatever the feature switch says, by its naming convention and declaration.
 */
export function userStoryPullRequests(
  pullRequests: PullRequest[],
  majorBranchNames: string[],
  config: PromotionBranchConfig,
  showPromotions = false,
): PullRequest[] {
  // Splitting the vehicles out of the User Stories is part of the promotion branches feature: a
  // project that did not opt in must keep the lists and the counters it had before.
  if (!config.enabled || showPromotions) {
    return pullRequests;
  }
  return pullRequests.filter(
    (pr) => !isVehiclePullRequest(pr, majorBranchNames, config),
  );
}

/**
 * A Pull Request that moves other Pull Requests rather than carrying work of its own: a promotion,
 * a merge between two major branches, or a retrofit. Same rule as userStoryPullRequests, exposed
 * for the webview, which classifies one row at a time.
 */
export function isVehiclePullRequest(
  pr: PullRequest,
  majorBranchNames: string[],
  config: PromotionBranchConfig,
): boolean {
  if (!config.enabled) {
    return false;
  }
  return (
    isPromotionPullRequest(pr, config) ||
    isMajorToMajorPullRequest(pr, majorBranchNames) ||
    isRetrofitPullRequest(pr)
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
