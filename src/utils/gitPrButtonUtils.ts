import simpleGit from "simple-git";

export interface PullRequestButtonInfo {
  url: string;
  label: string;
  icon: string;
}

export async function getPullRequestButtonInfo(repoPath: string): Promise<PullRequestButtonInfo | null> {
  const git = simpleGit(repoPath);
  const remotes = await git.getRemotes(true);
  let remoteUrl = null;
  const origin = remotes.find(r => r.name === 'origin');
  if (origin && origin.refs && (origin.refs.fetch || origin.refs.push)) {
    remoteUrl = origin.refs.fetch || origin.refs.push;
  } else if (remotes.length > 0 && remotes[0].refs) {
    remoteUrl = remotes[0].refs.fetch || remotes[0].refs.push;
  }
  if (!remoteUrl) { return null; }

  // Normalize remote URL
  remoteUrl = remoteUrl.replace(/^git@/, 'https://');
  // Remove .git suffix
  remoteUrl = remoteUrl.replace(/\.git$/, '');

  // Provider detection inspired by string patterns
  if (remoteUrl.includes("gitlab")) {
    // Try to build MR home URL: https://gitlab.com/group/project/-/merge_requests
    const match = remoteUrl.match(/https?:\/\/(.+?gitlab\.[^/]+)\/(.+)/);
    if (match) {
      const host = match[1].replace(/\/$/, '');
      const path = match[2].replace(/\/$/, '');
      if (/^[^/]+\/.+/.test(path)) {
        return {
          url: `https://${host}/${path}/-/merge_requests`,
          label: 'View Merge Requests on GitLab',
          icon: 'gitlab',
        };
      }
    }
    return {
      url: remoteUrl,
      label: 'View Merge Requests on GitLab',
      icon: 'gitlab',
    };
  }
  if (remoteUrl.includes("github")) {
    // Try to build PR home URL: https://github.com/org/repo/pulls
    const match = remoteUrl.match(/https?:\/\/(.+?github\.[^/]+)\/(.+)/);
    if (match) {
      const host = match[1].replace(/\/$/, '');
      const path = match[2].replace(/\/$/, '');
      if (/^[^/]+\/.+/.test(path)) {
        return {
          url: `https://${host}/${path}/pulls`,
          label: 'View Pull Requests on GitHub',
          icon: 'github',
        };
      }
    }
    return {
      url: remoteUrl,
      label: 'View Pull Requests on GitHub',
      icon: 'github',
    };
  }
  if (remoteUrl.includes("gitea")) {
    // Try to build PR home URL: https://gitea.example.com/org/repo/pulls
    const match = remoteUrl.match(/https?:\/\/(.+?gitea\.[^/]+)\/(.+)/);
    if (match) {
      const host = match[1].replace(/\/$/, '');
      const path = match[2].replace(/\/$/, '');
      if (/^[^/]+\/.+/.test(path)) {
        return {
          url: `https://${host}/${path}/pulls`,
          label: 'View Pull Requests on Gitea',
          icon: 'gitea',
        };
      }
    }
    return {
      url: remoteUrl,
      label: 'View Pull Requests on Gitea',
      icon: 'gitea',
    };
  }
  if (remoteUrl.includes("dev.azure.com")) {
    // Try to build PR home URL: https://dev.azure.com/org/project/_git/repo/pullrequests
    const match = remoteUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/);
    if (match) {
      return {
        url: `https://dev.azure.com/${match[1]}/${match[2]}/_git/${match[3]}/pullrequests`,
        label: 'View Pull Requests on Azure DevOps',
        icon: 'azuredevops',
      };
    }
    return {
      url: remoteUrl,
      label: 'View Pull Requests on Azure DevOps',
      icon: 'azuredevops',
    };
  }
  if (remoteUrl.includes("bitbucket.org")) {
    // Try to build PR home URL: https://bitbucket.org/org/repo/pull-requests
    const match = remoteUrl.match(/https?:\/\/(.+?bitbucket\.org)\/(.+)/);
    if (match) {
      const host = match[1].replace(/\/$/, '');
      const path = match[2].replace(/\/$/, '');
      if (/^[^/]+\/.+/.test(path)) {
        return {
          url: `https://${host}/${path}/pull-requests`,
          label: 'View Pull Requests on Bitbucket',
          icon: 'bitbucket',
        };
      }
    }
    return {
      url: remoteUrl,
      label: 'View Pull Requests on Bitbucket',
      icon: 'bitbucket',
    };
  }
  if (remoteUrl.includes("/scm/")) {
    // Try to build PR home URL for Bitbucket Server/DC: https://bitbucket.example.com/projects/PROJECT/repos/REPO/pull-requests
    const match = remoteUrl.match(/\/scm\/([^/]+)\/([^/]+)/);
    if (match) {
      const project = match[1];
      const repo = match[2];
      return {
        url: remoteUrl.replace(/\/scm\/[^/]+\/[^/]+$/, `/projects/${project.toUpperCase()}/repos/${repo}/pull-requests`),
        label: 'View Pull Requests on Bitbucket',
        icon: 'bitbucket',
      };
    }
    return {
      url: remoteUrl,
      label: 'View Pull Requests on Bitbucket',
      icon: 'bitbucket',
    };
  }

  // Default case if no known provider matches
  return  {
    url: remoteUrl,
    label: 'View Pull Requests',
    icon: 'utility:git', // Fallback icon
  }
}
