import { PullRequest } from "../../utils/gitProviders/types";

/**
 * A merged Pull Request into uat, with only the number required. Tests override what they care about.
 */
export function pr(
  overrides: Partial<PullRequest> & { number: number },
): PullRequest {
  return {
    id: overrides.number,
    title: `PR ${overrides.number}`,
    description: "",
    sourceBranch: "feature/story",
    targetBranch: "uat",
    authorLabel: "someone",
    state: "merged",
    webUrl: `https://git.example.com/pr/${overrides.number}`,
    jobsStatus: "unknown",
    ...overrides,
  };
}
