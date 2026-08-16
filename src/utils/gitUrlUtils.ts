// Tiny local replacement for the "git-url-parse" dependency.
// Converts any common git remote URL form into a browsable https URL,
// always stripping embedded credentials (userinfo) before it is displayed or logged.

const SCP_LIKE_URL_REGEX = /^(?:[\w.-]+@)?([\w.-]+):(.+)$/;
// Local filesystem paths (not real remote URLs) that would otherwise be mistaken for an
// SCP-like remote (a Windows drive letter such as "C:" looks like a host:path pair) or
// simply have no host part at all (a UNC path or a POSIX absolute path).
const WINDOWS_DRIVE_PATH_REGEX = /^[a-zA-Z]:[\\/]/;
const UNC_PATH_REGEX = /^\\\\[^\\]+\\/;
const POSIX_ABSOLUTE_PATH_REGEX = /^\//;

function isLocalPathRemote(value: string): boolean {
  return (
    WINDOWS_DRIVE_PATH_REGEX.test(value) ||
    UNC_PATH_REGEX.test(value) ||
    POSIX_ABSOLUTE_PATH_REGEX.test(value)
  );
}

function stripTrailingGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

export function gitRemoteToHttps(remoteUrl: string): string {
  const trimmedUrl = (remoteUrl || "").trim();
  if (!trimmedUrl) {
    return "";
  }
  if (isLocalPathRemote(trimmedUrl)) {
    return "";
  }

  try {
    // http(s):// or ssh:// URLs can be parsed directly with the URL API
    if (/^[a-zA-Z][\w+.-]*:\/\//.test(trimmedUrl)) {
      const parsedUrl = new URL(trimmedUrl);
      const pathName = stripTrailingGitSuffix(parsedUrl.pathname);
      if (!parsedUrl.hostname || !pathName || pathName === "/") {
        return "";
      }
      const port = parsedUrl.port ? `:${parsedUrl.port}` : "";
      return `https://${parsedUrl.hostname}${port}${pathName}`;
    }

    // SCP-like syntax: git@host:org/repo.git
    const scpMatch = SCP_LIKE_URL_REGEX.exec(trimmedUrl);
    if (scpMatch) {
      const [, host, rawPath] = scpMatch;
      const pathName = stripTrailingGitSuffix(rawPath.replace(/^\/+/, ""));
      if (!host || !pathName) {
        return "";
      }
      return `https://${host}/${pathName}`;
    }
  } catch {
    return "";
  }

  return "";
}
