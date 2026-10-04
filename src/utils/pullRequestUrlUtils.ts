/*
Recognise the web address of a Pull Request of the repository of the workspace.

A link to a Pull Request shown in a panel (Backpromote, a command result) opens the Pull Request
view of the DevOps Pipeline rather than the git provider, but only when the address is, for sure,
a Pull Request of this very repository: anything else keeps opening in the browser.
*/

// Path of a Pull Request under the web address of its repository, per git provider:
// GitHub /pull/12, Gitea /pulls/12, GitLab /-/merge_requests/12 (or /merge_requests/12),
// Azure DevOps /pullrequest/12, Bitbucket /pull-requests/12
const PULL_REQUEST_PATH =
  /^\/(?:-\/)?(?:pull|pulls|merge_requests|pullrequest|pull-requests)\/(\d{1,9})(?:[/?#].*)?$/;

function normalizeRepositoryUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * The number of the Pull Request a web address points to, or null when the address is not a Pull
 * Request of the repository whose web address is given.
 */
export function parsePullRequestNumberFromUrl(
  url: unknown,
  repositoryWebUrl: unknown,
): number | null {
  if (typeof url !== "string" || typeof repositoryWebUrl !== "string") {
    return null;
  }
  const repository = normalizeRepositoryUrl(repositoryWebUrl);
  if (!/^https:\/\/[^/]+\/.+/.test(repository)) {
    return null;
  }
  const candidate = url.trim();
  if (!candidate.toLowerCase().startsWith(repository)) {
    return null;
  }
  const match = candidate.slice(repository.length).match(PULL_REQUEST_PATH);
  if (!match) {
    return null;
  }
  const prNumber = parseInt(match[1], 10);
  return prNumber > 0 ? prNumber : null;
}
