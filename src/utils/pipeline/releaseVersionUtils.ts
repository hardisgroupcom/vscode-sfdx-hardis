import { Logger } from "../../logger";

/**
 * Release versioning (sfdx-hardis `releaseVersioning`, set in the config of a major branch): each
 * successful deployment on a versioned branch creates a semver tag, a release candidate
 * (v1.5.0-rc.3) below the highest versioned branch and a plain version (v1.5.0) on it.
 *
 * The CLI is the engine: the extension never computes a version. It runs
 * `sf hardis:project:version:list --json` (which fetches the tags first) in the background, only
 * when a branch config declares the feature and somebody asks for the versions: the Versions toggle
 * of the DevOps Pipeline is on, or its Releases tab or the Release version tab of a branch is open.
 * The load of the pipeline never starts it and never waits for it.
 * A failure (a CLI too old to know the command, a git error) is logged and the panel says so.
 *
 * Each answer costs a sfdx-hardis start and a `git fetch --tags`, while the panel reloads itself
 * every minute: the answer, or the failure, is kept for the panel session and reused by every
 * reload. Opening the panel forgets it, and its Refresh button asks again when the versions were
 * requested (invalidateReleaseVersionsCache).
 * The command runs without --with-links, which would call the git provider API: the tag and
 * Release links are built here from the repository URL the extension already knows
 * (withReleaseVersionLinks).
 */

export type ReleaseVersionRole = "first" | "middle" | "final";

/** One version tag, as the CLI describes it */
export interface ReleaseVersionEntry {
  // Name of the tag, in the tag format of its branch (v1.6.0-pi2-it4-uat-rc1): the only identifier
  tag: string;
  // Semver form (1.6.0-rc.1): with tag formats, two release candidates of two branches can share it
  version: string;
  // Values of the custom variables of the tag format ({PI}, {IT}), empty for an older CLI
  variables: Record<string, string>;
  prerelease: boolean;
  // Git branch name (release/uat, not release__uat), null for a tag sfdx-hardis did not write
  branchName: string | null;
  commit: string;
  deployedAt: string | null;
  org: string | null;
  pullRequest: number | null;
  jobUrl: string | null;
  tagUrl: string | null;
  releaseUrl: string | null;
}

/** A version that the promotion of sourceBranch into a versioned branch would create */
export interface ReleaseVersionNext {
  sourceBranch: string;
  tag: string;
}

export interface ReleaseVersionBranch {
  branchName: string;
  role: ReleaseVersionRole;
  current: ReleaseVersionEntry | null;
  nextOnPromotion: ReleaseVersionNext[];
}

/** The `result` of sf hardis:project:version:list --json */
export interface ReleaseVersionList {
  enabled: boolean;
  initialVersion: string | null;
  minimumVersion: string | null;
  branches: ReleaseVersionBranch[];
  history: ReleaseVersionEntry[];
}

/** What a versioned major branch of the diagram carries */
export interface ReleaseVersionView {
  current: ReleaseVersionEntry | null;
  nextOnPromotion: ReleaseVersionNext[];
}

export interface ReleaseVersionDeps {
  workspaceRoot: string;
  // True when a branch config declares releaseVersioning: true
  isDeclared: () => Promise<boolean>;
  // The `result` of the command, null when the CLI failed (already logged)
  runVersionList: () => Promise<any | null>;
}

/** The repository as the git provider of the extension describes it (RepoInfo) */
export interface ReleaseVersionRepo {
  providerName: string;
  webUrl: string;
}

/** Where the versions of the panel session stand */
export type ReleaseVersionsStatus =
  "notLoaded" | "loading" | "loaded" | "failed";

type CacheEntry = {
  workspaceRoot: string;
  value: ReleaseVersionList | null;
};

let cache: CacheEntry | null = null;
let inFlight: {
  workspaceRoot: string;
  generation: number;
  promise: Promise<ReleaseVersionList | null>;
} | null = null;
// Raised by each invalidation: a CLI call started before it may have missed a new tag, so its
// answer is neither shared with a later load nor kept
let cacheGeneration = 0;

// Characters a tag may hold to be passed to a command line
const SAFE_TAG = /^[\w.+-]+$/;

/** True when at least one major branch of the pipeline declares releaseVersioning: true. */
export function isReleaseVersioningDeclared(
  majorOrgs: Array<{ releaseVersioning?: boolean }>,
): boolean {
  return (majorOrgs || []).some((org) => org?.releaseVersioning === true);
}

/**
 * The versions of the pipeline, read from the CLI. Nothing runs unless a branch config declares
 * the feature. The answer of the panel session is reused unless `force` is set; two loads at the
 * same time share one CLI process. Never throws: null when the feature is off or the CLI failed.
 */
export async function loadReleaseVersions(
  options: { force?: boolean } = {},
  deps?: ReleaseVersionDeps,
): Promise<ReleaseVersionList | null> {
  // Read before any wait: a load asked before an invalidation must not fill the cache after it
  const generation = cacheGeneration;
  const loadDeps = deps || (await defaultReleaseVersionDeps());
  let declared = false;
  try {
    declared = await loadDeps.isDeclared();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Release versioning config not read: ${e?.message || e}`,
    );
  }
  if (!declared) {
    cache = null;
    return null;
  }
  if (
    !options.force &&
    cache &&
    cache.workspaceRoot === loadDeps.workspaceRoot
  ) {
    return cache.value;
  }
  if (
    inFlight &&
    inFlight.workspaceRoot === loadDeps.workspaceRoot &&
    inFlight.generation === cacheGeneration
  ) {
    return await inFlight.promise;
  }
  const promise = (async () => {
    let value: ReleaseVersionList | null = null;
    try {
      value = parseReleaseVersionList(await loadDeps.runVersionList());
    } catch (e: any) {
      Logger.log(
        `[vscode-sfdx-hardis] Release versions not available: ${e?.message || e}`,
      );
    }
    // A failure is kept too: a CLI without the command would otherwise be started at every reload
    if (generation === cacheGeneration) {
      cache = { workspaceRoot: loadDeps.workspaceRoot, value };
    }
    return value;
  })();
  inFlight = { workspaceRoot: loadDeps.workspaceRoot, generation, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) {
      inFlight = null;
    }
  }
}

/**
 * The last answer of the CLI, without running anything: what a load of the pipeline draws, since
 * it never asks the CLI itself.
 */
export function getCachedReleaseVersions(
  workspaceRoot?: string,
): ReleaseVersionList | null {
  if (!cache) {
    return null;
  }
  if (workspaceRoot !== undefined && cache.workspaceRoot !== workspaceRoot) {
    return null;
  }
  return cache.value;
}

/**
 * Where the versions stand, without running anything. A CLI that answered without the feature
 * counts as a failure: a branch declares it, so the panel has versions to show and none came.
 */
export function getReleaseVersionsStatus(
  workspaceRoot?: string,
): ReleaseVersionsStatus {
  const sameWorkspace = (root: string) =>
    workspaceRoot === undefined || root === workspaceRoot;
  if (
    inFlight &&
    inFlight.generation === cacheGeneration &&
    sameWorkspace(inFlight.workspaceRoot)
  ) {
    return "loading";
  }
  if (!cache || !sameWorkspace(cache.workspaceRoot)) {
    return "notLoaded";
  }
  return cache.value?.enabled === true ? "loaded" : "failed";
}

/**
 * The next load asks the CLI again (manual refresh of the panel), even when a call started earlier
 * is still running: that one may have listed the tags before the new one was created. With
 * keepAnswer, the last answer stays readable until the new one replaces it, so the chips of the
 * diagram do not disappear during a refresh.
 */
export function invalidateReleaseVersionsCache(
  options: { keepAnswer?: boolean } = {},
): void {
  if (!options.keepAnswer) {
    cache = null;
  }
  cacheGeneration++;
}

/**
 * The `result` of sf hardis:project:version:list --json, checked field by field: null when it is
 * not one. A malformed entry is dropped rather than failing the whole answer.
 */
export function parseReleaseVersionList(raw: any): ReleaseVersionList | null {
  if (!raw || typeof raw !== "object" || typeof raw.enabled !== "boolean") {
    return null;
  }
  const branches: ReleaseVersionBranch[] = [];
  for (const branch of Array.isArray(raw.branches) ? raw.branches : []) {
    if (
      !branch ||
      typeof branch.branchName !== "string" ||
      !branch.branchName
    ) {
      continue;
    }
    const role: ReleaseVersionRole = ["first", "middle", "final"].includes(
      branch.role,
    )
      ? branch.role
      : "middle";
    branches.push({
      branchName: branch.branchName,
      role,
      current: parseReleaseVersionEntry(branch.current),
      nextOnPromotion: (Array.isArray(branch.nextOnPromotion)
        ? branch.nextOnPromotion
        : []
      )
        .filter(
          (next: any) =>
            next &&
            typeof next.sourceBranch === "string" &&
            next.sourceBranch &&
            typeof next.tag === "string" &&
            next.tag,
        )
        .map((next: any) => ({
          sourceBranch: next.sourceBranch,
          tag: next.tag,
        })),
    });
  }
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .map((entry: any) => parseReleaseVersionEntry(entry))
    .filter(
      (entry: ReleaseVersionEntry | null): entry is ReleaseVersionEntry =>
        entry !== null,
    );
  return {
    enabled: raw.enabled,
    initialVersion: stringOrNull(raw.initialVersion),
    minimumVersion: stringOrNull(raw.minimumVersion),
    branches,
    history,
  };
}

/**
 * A copy of the list whose versions hold their tag and Release links, built from the web URL of
 * the repository: the CLI leaves them null unless it is asked to call the git provider API. A link
 * the CLI gave is kept. Without a known repository, the list is returned as it is.
 */
export function withReleaseVersionLinks(
  list: ReleaseVersionList | null,
  repo: ReleaseVersionRepo | null | undefined,
): ReleaseVersionList | null {
  if (!list || !repo || !repo.webUrl || !repo.providerName) {
    return list;
  }
  const complete = (
    entry: ReleaseVersionEntry | null,
  ): ReleaseVersionEntry | null => {
    if (!entry) {
      return entry;
    }
    const links = buildReleaseVersionLinks(entry.tag, entry.prerelease, repo);
    return {
      ...entry,
      tagUrl: entry.tagUrl || links.tagUrl,
      releaseUrl: entry.releaseUrl || links.releaseUrl,
    };
  };
  return {
    ...list,
    branches: list.branches.map((branch) => ({
      ...branch,
      current: complete(branch.current),
    })),
    history: list.history.map(
      (entry) => complete(entry) as ReleaseVersionEntry,
    ),
  };
}

/**
 * Web links of a version tag on the git provider of the repository. sfdx-hardis creates a Release
 * for a plain version only, and only on GitHub and GitLab: elsewhere, and for a release candidate,
 * there is no Release link.
 */
export function buildReleaseVersionLinks(
  tag: string,
  prerelease: boolean,
  repo: ReleaseVersionRepo,
): { tagUrl: string | null; releaseUrl: string | null } {
  const base = (repo?.webUrl || "").replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base) || !isSafeReleaseTag(tag)) {
    return { tagUrl: null, releaseUrl: null };
  }
  const encoded = encodeURIComponent(tag);
  switch (repo.providerName) {
    case "github":
      return {
        tagUrl: `${base}/tree/${encoded}`,
        releaseUrl: prerelease ? null : `${base}/releases/tag/${encoded}`,
      };
    case "gitlab":
      return {
        tagUrl: `${base}/-/tags/${encoded}`,
        releaseUrl: prerelease ? null : `${base}/-/releases/${encoded}`,
      };
    case "azure":
      return { tagUrl: `${base}?version=GT${encoded}`, releaseUrl: null };
    case "bitbucket":
      return { tagUrl: `${base}/src/${encoded}`, releaseUrl: null };
    case "gitea":
      return { tagUrl: `${base}/src/tag/${encoded}`, releaseUrl: null };
    default:
      return { tagUrl: null, releaseUrl: null };
  }
}

/**
 * The version of each versioned branch, keyed by its name in the pipeline. The pipeline names a
 * branch after its config file, where each / is written __ (.sfdx-hardis.release__uat.yml is
 * release/uat), while the CLI answers with git names: both are matched.
 */
export function buildReleaseVersionViews(
  list: ReleaseVersionList | null,
  pipelineBranchNames: string[],
): Record<string, ReleaseVersionView> {
  const views: Record<string, ReleaseVersionView> = {};
  if (!list || !list.enabled) {
    return views;
  }
  for (const branchName of pipelineBranchNames || []) {
    const branch = list.branches.find((candidate) =>
      isSameBranch(candidate.branchName, branchName),
    );
    if (branch) {
      views[branchName] = {
        current: branch.current,
        nextOnPromotion: branch.nextOnPromotion,
      };
    }
  }
  return views;
}

/** The version that promoting sourceBranch into the branch of this view would create, else null. */
export function findNextVersionFrom(
  view: ReleaseVersionView | null | undefined,
  sourceBranch: string,
): ReleaseVersionNext | null {
  if (!view) {
    return null;
  }
  return (
    view.nextOnPromotion.find((next) =>
      isSameBranch(next.sourceBranch, sourceBranch),
    ) || null
  );
}

/** Git name of a branch named after its config file (release__uat is release/uat). */
export function toGitBranchName(branchName: string): string {
  return (branchName || "").replace(/__/g, "/");
}

/** True when two branch names, in git or config file form, are the same branch. */
export function isSameBranch(a: string, b: string): boolean {
  return (
    !!a &&
    !!b &&
    toGitBranchName(a).toLowerCase() === toGitBranchName(b).toLowerCase()
  );
}

/** True when a tag can be passed to a command line as it is. */
export function isSafeReleaseTag(tag: string): boolean {
  return typeof tag === "string" && SAFE_TAG.test(tag);
}

/** Short local date of a deployment, the same whatever the locale: 2026-11-17 14:02. */
export function formatReleaseVersionDate(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function defaultReleaseVersionDeps(): Promise<ReleaseVersionDeps> {
  // Loaded on use: orgConfigUtils pulls in the git providers, and providerCredentials reaches the
  // VS Code secrets
  const { getWorkspaceRoot } = await import("../../utils");
  const { listMajorOrgs } = await import("../orgConfigUtils");
  return {
    workspaceRoot: getWorkspaceRoot(),
    // Reads the branch config files only, no call to the git provider
    isDeclared: async () =>
      isReleaseVersioningDeclared(
        await listMajorOrgs({ browseGitProvider: false }),
      ),
    runVersionList: async () => {
      // Without --with-links the CLI never calls the git provider API (withReleaseVersionLinks
      // builds the links): it gets the credentials the extension is connected with, like the
      // other background CLI calls of the panel
      const { execSfdxJsonWithProviderCredentials } =
        await import("../providerCredentials");
      return await execSfdxJsonWithProviderCredentials(
        "sf hardis:project:version:list --json",
        "Release versions",
      );
    },
  };
}

function parseReleaseVersionEntry(raw: any): ReleaseVersionEntry | null {
  if (!raw || typeof raw !== "object" || typeof raw.tag !== "string") {
    return null;
  }
  if (!raw.tag) {
    return null;
  }
  const pullRequest = Number(raw.pullRequest);
  return {
    tag: raw.tag,
    version:
      typeof raw.version === "string" && raw.version
        ? raw.version
        : raw.tag.replace(/^v/, ""),
    variables: parseTagVariables(raw.variables),
    prerelease: raw.prerelease === true,
    branchName: stringOrNull(raw.branchName),
    commit: typeof raw.commit === "string" ? raw.commit : "",
    deployedAt: stringOrNull(raw.deployedAt),
    org: stringOrNull(raw.org),
    pullRequest:
      raw.pullRequest !== null &&
      raw.pullRequest !== undefined &&
      Number.isInteger(pullRequest) &&
      pullRequest > 0
        ? pullRequest
        : null,
    jobUrl: stringOrNull(raw.jobUrl),
    tagUrl: stringOrNull(raw.tagUrl),
    releaseUrl: stringOrNull(raw.releaseUrl),
  };
}

// Only string or number values: anything else the CLI could send is dropped
function parseTagVariables(raw: any): Record<string, string> {
  const variables: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return variables;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number") {
      variables[name] = String(value);
    }
  }
  return variables;
}

function stringOrNull(value: any): string | null {
  return typeof value === "string" && value ? value : null;
}
