/**
 * Aggregated PR/MR statuses used by the extension. Keep this small so callers
 * can switch on a predictable set of values. The provider mapping below
 * explains how common provider statuses map to these aggregated values.
 *
 * Aggregated values:
 * - 'open'    : active/open PRs
 * - 'closed'  : closed PRs (not merged)
 * - 'merged'  : merged PRs
 * - 'declined': explicitly declined/abandoned PRs
 * - string    : fallback for unknown/provider-specific values
 *
 * Provider correspondence examples:
 * - GitHub:      'open' -> 'open', 'closed' -> 'closed' (use 'merged' if merged flag true)
 * - GitLab:      'opened' -> 'open', 'closed' -> 'closed', 'merged' -> 'merged', 'locked' -> 'closed'
 * - Azure DevOps:'active' -> 'open', 'completed' -> 'merged' (or 'closed' if not merged), 'abandoned' -> 'declined'
 * - Bitbucket:   'OPEN' -> 'open', 'MERGED' -> 'merged', 'DECLINED' -> 'declined'
 */
export type PullRequestStatus = 'open' | 'closed' | 'merged' | 'declined' | string;

/**
 * Unified PullRequest / MergeRequest shape used across git providers
 * (GitLab, GitHub, Azure DevOps, Bitbucket).
 *
 * Field mapping notes (provider-specific correspondence):
 * - gitlab MergeRequest: id, iid, title, description, state, web_url, references.short (or web_url), author.username, source_branch, target_branch, created_at, updated_at
 * - github PullRequest: id (node_id or number), number, title, body (description), state, html_url (web_url), user.login (author), head.ref (source_branch), base.ref (target_branch), created_at, updated_at
 * - azure DevOps PR: pullRequestId (id), title, description, status (state), url (web_url), createdBy.displayName or uniqueName (author), sourceRefName (refs/heads/...), targetRefName, creationDate, closedDate
 * - bitbucket PR: id, title, description, state, links.html.href (web_url), author.username, source.branch.name, destination.branch.name, created_on, updated_on
 *
 * Notes:
 * - Use `id` as a canonical unique identifier (provider numeric id or string). `number` is the provider-native numeric PR id when available (GitHub PR number, GitLab iid).
 * - `webUrl` is the canonical URL to view the PR/MR in the remote provider UI.
 * - `author` is a small shape with `name` and optional `username` and `email` when available.
 * - `state` normalised values: 'open' | 'closed' | 'merged' | 'declined' | provider-specific strings may appear; callers should treat unknown values as-is.
 */
export type PullRequest = {
    // canonical identifiers
    id: string | number; // provider-global id (string for node_id or numeric id)
    number?: number; // provider-native numeric id (GitHub PR number, GitLab iid)

    // Title and textual fields
    title: string;
    // Provider payloads sometimes use `null` for missing descriptions (GitLab). Accept string | null.
    description?: string | null; // body / description

    // Branches
    sourceBranch?: string; // head / source
    targetBranch?: string; // base / target

    // Author information (may be partial depending on provider)
    author?: {
        name?: string; // display name (Azure, GitLab, GitHub)
        username?: string; // login or username
        email?: string; // when available
    };

    // Status & timestamps
    // `PullRequestStatus` lists known provider-specific state values.
    state?: PullRequestStatus;
    createdAt?: string; // ISO date string
    updatedAt?: string; // ISO date string

    // URLs
    webUrl?: string; // canonical UI url

    // Optional provider metadata bag to keep raw provider payload when needed
    provider?: {
        name?: 'gitlab' | 'github' | 'azure' | 'bitbucket' | string;
        raw?: any; // raw provider response object
    };
};
