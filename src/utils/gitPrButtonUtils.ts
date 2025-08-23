import simpleGit from "simple-git";

export interface PullRequestButtonInfo {
  url: string;
  label: string;
  icon: string;
}

interface ProviderConfig {
  keyword: string;
  pathSuffix: string;
  icon: string;
  label: string;
  matchRegex: RegExp;
}

function buildUrlFromMatch(remoteUrl: string, regex: RegExp, suffix: string) {
  const match = remoteUrl.match(regex);
  if (match) {
    const host = match[1]?.replace(/\/$/, "");
    const path = match[2]?.replace(/\/$/, "");
    if (host && path && /^[^/]+\/.+/.test(path)) {
      return `https://${host}/${path}${suffix}`;
    }
  }
  return remoteUrl;
}

export async function getPullRequestButtonInfo(
  repoPath: string,
): Promise<PullRequestButtonInfo | null> {
  const git = simpleGit(repoPath);
  const remotes = await git.getRemotes(true);

  let remoteUrl: string | null = null;
  const origin = remotes.find((r) => r.name === "origin");
  if (origin?.refs?.fetch || origin?.refs?.push) {
    remoteUrl = origin.refs.fetch || origin.refs.push;
  } else if (remotes[0]?.refs) {
    remoteUrl = remotes[0].refs.fetch || remotes[0].refs.push;
  }
  if (!remoteUrl) {
    return null;
  }

  // Normalize remote URL
  remoteUrl = remoteUrl.replace(/^git@/, "https://").replace(/\.git$/, "");

  // Provider configs
  const providers: ProviderConfig[] = [
    {
      keyword: "gitlab",
      pathSuffix: "/-/merge_requests",
      icon: "gitlab",
      label: "View Merge Requests on Gitlab",
      matchRegex: /https?:\/\/(.+?gitlab\.[^/]+)\/(.+)/,
    },
    {
      keyword: "github",
      pathSuffix: "/pulls",
      icon: "github",
      label: "View Pull Requests on GitHub",
      matchRegex: /https?:\/\/(.+?github\.[^/]+)\/(.+)/,
    },
    {
      keyword: "gitea",
      pathSuffix: "/pulls",
      icon: "gitea",
      label: "View Pull Requests on Gitea",
      matchRegex: /https?:\/\/(.+?gitea\.[^/]+)\/(.+)/,
    },
    {
      keyword: "bitbucket.org",
      pathSuffix: "/pull-requests",
      icon: "bitbucket",
      label: "View Pull Requests on Bitbucket",
      matchRegex: /https?:\/\/(.+?bitbucket\.org)\/(.+)/,
    },
  ];

  for (const provider of providers) {
    if (remoteUrl.includes(provider.keyword)) {
      return {
        url: buildUrlFromMatch(
          remoteUrl,
          provider.matchRegex,
          provider.pathSuffix,
        ),
        label: provider.label,
        icon: provider.icon,
      };
    }
  }

  // Azure DevOps special case
  if (remoteUrl.includes("dev.azure.com")) {
    const match = remoteUrl.match(
      /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/,
    );
    return {
      url: match
        ? `https://dev.azure.com/${match[1]}/${match[2]}/_git/${match[3]}/pullrequests`
        : remoteUrl,
      label: "View Pull Requests on Azure DevOps",
      icon: "azuredevops",
    };
  }

  // Bitbucket Server/DC special case
  if (remoteUrl.includes("/scm/")) {
    const match = remoteUrl.match(/\/scm\/([^/]+)\/([^/]+)/);
    if (match) {
      const project = match[1];
      const repo = match[2];
      return {
        url: remoteUrl.replace(
          /\/scm\/[^/]+\/[^/]+$/,
          `/projects/${project.toUpperCase()}/repos/${repo}/pull-requests`,
        ),
        label: "View Pull Requests on Bitbucket",
        icon: "bitbucket",
      };
    }
    return {
      url: remoteUrl,
      label: "View Pull Requests on Bitbucket",
      icon: "bitbucket",
    };
  }

  // Default fallback
  return {
    url: remoteUrl,
    label: "View Pull Requests",
    icon: "utility:git",
  };
}
