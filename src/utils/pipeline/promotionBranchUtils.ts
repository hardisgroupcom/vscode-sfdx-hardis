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
export const DEFAULT_PROMOTION_BRANCH_PREFIX = "promotion";

export interface PromotionBranchConfig {
  enabled: boolean;
  prefix: string;
}

/**
 * Reads the feature switch from the project config and the branch configs: the CLI
 * reads the merged branch config of the target branch, so a project may enable the
 * feature in a single branch file (ex: .sfdx-hardis.preprod.yml).
 */
export function getPromotionBranchConfig(
  configs: Array<any | null | undefined>,
): PromotionBranchConfig {
  let enabled = false;
  let prefix = DEFAULT_PROMOTION_BRANCH_PREFIX;
  for (const config of configs) {
    if (!config) {
      continue;
    }
    if (config.enablePromotionBranches === true) {
      enabled = true;
    }
    if (typeof config.promotionBranchPrefix === "string") {
      const candidate = config.promotionBranchPrefix.trim().replace(/\/+$/, "");
      if (candidate) {
        prefix = candidate;
      }
    }
  }
  return { enabled, prefix };
}

/**
 * Matches the <prefix>/<name> convention only: promotion-notes is not a promotion branch.
 */
export function isPromotionBranchName(
  branchName: string | undefined | null,
  prefix: string = DEFAULT_PROMOTION_BRANCH_PREFIX,
): boolean {
  const name = (branchName || "").toLowerCase();
  const normalizedPrefix = (
    prefix || DEFAULT_PROMOTION_BRANCH_PREFIX
  ).toLowerCase();
  return (
    name.startsWith(normalizedPrefix + "/") &&
    name.length > normalizedPrefix.length + 1
  );
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
 * A promotion Pull Request needs the flag, the branch prefix and the declared list.
 */
export function isPromotionPullRequest(
  pr: Pick<PullRequest, "sourceBranch" | "description"> | null | undefined,
  config: PromotionBranchConfig,
): boolean {
  if (!config.enabled || !pr) {
    return false;
  }
  return (
    isPromotionBranchName(pr.sourceBranch, config.prefix) &&
    parsePromotionPullRequestIds(pr.description) !== null
  );
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
  for (const pr of pullRequests) {
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
      if (!story || (story.state && story.state !== "merged")) {
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
 * Merged promotion Pull Requests declaring a story: the story has already been
 * shipped through them. Informational only, the story stays in its window.
 */
export function findPromotionsCarrying(
  storyNumber: number,
  promotionPullRequests: PullRequest[],
  config: PromotionBranchConfig,
): PullRequest[] {
  if (!config.enabled || !storyNumber) {
    return [];
  }
  return promotionPullRequests.filter((pr) => {
    if (!isPromotionPullRequest(pr, config)) {
      return false;
    }
    if (pr.state && pr.state !== "merged") {
      return false;
    }
    return (parsePromotionPullRequestIds(pr.description) || []).includes(
      storyNumber,
    );
  });
}

/**
 * Sets `alreadyDeployedVia` on the stories of a window that a merged promotion Pull
 * Request carried. A promotion Pull Request never annotates itself.
 */
export function annotateAlreadyPromoted(
  pullRequests: PullRequest[],
  promotionPullRequests: PullRequest[],
  config: PromotionBranchConfig,
): void {
  if (!config.enabled) {
    return;
  }
  for (const pr of pullRequests) {
    if (pr.isPromotion) {
      continue;
    }
    const promotions = findPromotionsCarrying(
      prNumber(pr),
      promotionPullRequests,
      config,
    ).filter((promotion) => prNumber(promotion) !== prNumber(pr));
    if (promotions.length > 0) {
      pr.alreadyDeployedVia = promotions.map((promotion) => ({
        number: prNumber(promotion),
        sourceBranch: promotion.sourceBranch || "",
        targetBranch: promotion.targetBranch || "",
        webUrl: promotion.webUrl || "",
        mergeDate: promotion.mergeDate || "",
      }));
    }
  }
}
