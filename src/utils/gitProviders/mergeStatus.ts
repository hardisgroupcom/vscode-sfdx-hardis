import { PullRequest, PullRequestMergeStatus } from "./types";

/**
 * Merge conflict detection for open Pull Requests, shown on the DevOps Pipeline diagram.
 *
 * The rule that keeps this cheap: only read what the provider already computed and already
 * sent. GitLab, Azure DevOps and Gitea carry the answer in the Pull Request list response,
 * so it costs nothing. GitHub keeps it out of the REST list, so the GitHub provider asks
 * for it once in GraphQL for the whole list, next to the calls it already makes per Pull
 * Request. Bitbucket does not expose it at all and stays "unknown".
 *
 * "unknown" always means "no answer", never "no conflict": providers compute the merge in
 * the background, so a Pull Request opened seconds ago legitimately has no verdict yet.
 */

/** GitHub GraphQL mergeable (MERGEABLE / CONFLICTING / UNKNOWN) and Gitea mergeable boolean. */
export function mapGitHubMergeable(mergeable: any): PullRequestMergeStatus {
  if (mergeable === true) {
    return "mergeable";
  }
  if (mergeable === false) {
    return "conflicts";
  }
  if (typeof mergeable === "string") {
    const value = mergeable.toUpperCase();
    if (value === "CONFLICTING") {
      return "conflicts";
    }
    if (value === "MERGEABLE") {
      return "mergeable";
    }
  }
  return "unknown";
}

/**
 * GitLab. detailed_merge_status lists every reason a Merge Request is blocked, most of them
 * unrelated to conflicts (draft, discussions, approvals, CI): only the two conflict values are
 * read. merge_status is the older field and is conflict-specific, so it serves as the fallback.
 */
export function mapGitLabMergeStatus(
  mergeRequest: any,
): PullRequestMergeStatus {
  const detailed = mergeRequest?.detailed_merge_status;
  if (typeof detailed === "string") {
    if (detailed === "conflict" || detailed === "broken_status") {
      return "conflicts";
    }
    if (detailed === "mergeable") {
      return "mergeable";
    }
  }
  const merge = mergeRequest?.merge_status;
  if (merge === "cannot_be_merged") {
    return "conflicts";
  }
  if (merge === "can_be_merged") {
    return "mergeable";
  }
  return "unknown";
}

/**
 * Azure DevOps PullRequestAsyncStatus: 0 notSet, 1 queued, 2 conflicts, 3 succeeded,
 * 4 rejectedByPolicy, 5 failure. The REST payload sends the number, some SDK shapes send the
 * name, so both are accepted. A policy rejection or an internal failure is not a conflict.
 */
export function mapAzureMergeStatus(pullRequest: any): PullRequestMergeStatus {
  const status = pullRequest?.mergeStatus;
  if (status === 2 || status === "conflicts") {
    return "conflicts";
  }
  if (status === 3 || status === "succeeded") {
    return "mergeable";
  }
  return "unknown";
}

/** True when the provider says this Pull Request cannot be merged as it stands. */
export function hasMergeConflicts(
  pullRequest: PullRequest | null | undefined,
): boolean {
  return pullRequest?.mergeStatus === "conflicts";
}

/** True when at least one of these Pull Requests has merge conflicts. */
export function anyMergeConflict(pullRequests: PullRequest[]): boolean {
  return (pullRequests || []).some((pullRequest) =>
    hasMergeConflicts(pullRequest),
  );
}
