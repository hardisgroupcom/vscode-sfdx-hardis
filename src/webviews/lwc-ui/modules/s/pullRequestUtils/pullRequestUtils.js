/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Pure helpers of the Pull Request view of the DevOps Pipeline (s/pipeline): the lookup of the
 * Pull Requests explorer, the journey of a Pull Request through the major branches, and the list
 * of modal fields saved when a Pull Request is opened from a branch window.
 *
 * No LWC import and no DOM: every function here is run for real by the unit tests
 * (src/test/suite/pullRequestView.test.ts).
 */

/**
 * State of the Pull Request modal of s/pipeline. Captured when a Pull Request is opened from
 * another window, restored on the way back, and reset on close: one list for the three, so a new
 * modal field cannot be forgotten in one of them. The value is what close resets the field to.
 *
 * The flags that say something is being loaded are not in the list: an answer on its way when
 * the window was left is dropped, so a restored window never waits for it. They are reset by
 * resetModalLoadingFlags, and the component asks again for what is missing.
 */
export const MODAL_STATE_DEFAULTS = {
  modalMode: "branch",
  modalBranchName: "",
  showJobStatusColumn: false,
  isFeaturePrModal: false,
  modalPullRequests: [],
  modalSourcePullRequests: [],
  modalSelectedPrIds: [],
  modalSelectedPrNumbers: [],
  modalShowPromotionPrs: false,
  modalTickets: [],
  modalActions: [],
  modalActiveTabValue: "prs",
  modalActionStatuses: null,
  expandedActionRowIds: [],
  hiddenActionStatusKeys: [],
  hiddenActionForecastKeys: [],
  promotionMode: false,
  actionForecast: null,
  modalIsMajorPr: false,
  modalIsPromotionPr: false,
  modalPromotionUnresolved: [],
  modalIsTopBranch: false,
  modalGoLives: [],
  selectedGoLiveId: "",
  deploymentApexTestClasses: [],
  _deploymentApexTestClassesOriginal: [],
  apexTestsMode: "view",
  apexTestsByLineRows: [],
  modalWorkflows: null,
  modalRunningJobs: null,
  modalCheckout: null,
  workflowsUnavailable: false,
};

export const MODAL_LOADING_FLAGS = [
  "actionStatusesLoading",
  "actionForecastLoading",
  "modalGoLivesLoading",
  "modalGoLivePrsLoading",
  "isLoadingReleaseDetails",
  "ticketDetailsLoading",
];

export function resetModalLoadingFlags(component) {
  for (const flag of MODAL_LOADING_FLAGS) {
    component[flag] = false;
  }
}

/**
 * A copy of the modal state of a component, for the navigation stack. Arrays are copied so a
 * later change of the live list (a row ticked, a filter switched) does not rewrite the snapshot.
 */
export function captureModalState(component) {
  const snapshot = {};
  for (const field of Object.keys(MODAL_STATE_DEFAULTS)) {
    const value = component[field];
    snapshot[field] = Array.isArray(value) ? [...value] : value;
  }
  return snapshot;
}

/**
 * Put a captured state, or the defaults when there is none, back on a component.
 */
export function applyModalState(component, snapshot) {
  for (const field of Object.keys(MODAL_STATE_DEFAULTS)) {
    const source =
      snapshot && Object.prototype.hasOwnProperty.call(snapshot, field)
        ? snapshot[field]
        : MODAL_STATE_DEFAULTS[field];
    component[field] = Array.isArray(source) ? [...source] : source;
  }
}

/**
 * A Pull Request state reduced to the three the lookup shows.
 */
export function lookupState(pr) {
  const state = String(pr?.state || "").toLowerCase();
  if (state === "merged") {
    return "merged";
  }
  if (state === "open" || state === "opened" || state === "") {
    return "open";
  }
  return "closed";
}

/**
 * The Pull Requests of a list that match every word typed, in the order they came: number, title,
 * author, source branch, the id of a related ticket, or the Pull Request that carried the story
 * (its number or its branch), so that typing "#125" lists what #125 brought.
 */
export function filterPullRequestList(pullRequests, query) {
  const list = Array.isArray(pullRequests) ? pullRequests : [];
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return list;
  }
  return list.filter((pr) => {
    if (!pr) {
      return false;
    }
    const carrier = pr.carriedByPullRequest;
    const haystack = [
      pr.number > 0 ? `#${pr.number}` : "",
      pr.title,
      pr.authorLabel,
      pr.sourceBranch,
      ...(pr.relatedTickets || []).map((ticket) => ticket?.id),
      carrier ? `#${carrier.number}` : "",
      carrier ? carrier.sourceBranch : "",
    ]
      .map((value) => String(value || "").toLowerCase())
      .join("\n");
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The Pull Requests already in memory that match what was typed: number, title, branches, author
 * or the id of a related ticket. A Pull Request listed in several windows comes out once, open
 * ones first, then the most recent numbers.
 */
export function filterLoadedPullRequests(pullRequests, query, limit = 20) {
  const text = String(query || "")
    .trim()
    .toLowerCase();
  const numberText = text.replace(/^#/, "");
  const byNumber = new Map();
  for (const pr of Array.isArray(pullRequests) ? pullRequests : []) {
    if (!pr || !(pr.number > 0) || pr.promotedAway === true) {
      continue;
    }
    if (byNumber.has(pr.number)) {
      continue;
    }
    if (text !== "") {
      const tickets = (pr.relatedTickets || [])
        .map((ticket) => String(ticket?.id || ""))
        .join(" ");
      const haystack = [
        pr.title,
        pr.sourceBranch,
        pr.targetBranch,
        pr.authorLabel,
        tickets,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join("\n");
      const numberMatch =
        /^\d+$/.test(numberText) && String(pr.number).startsWith(numberText);
      if (!numberMatch && !haystack.includes(text)) {
        continue;
      }
    }
    byNumber.set(pr.number, pr);
  }
  const rank = { open: 0, merged: 1, closed: 2 };
  return [...byNumber.values()]
    .sort(
      (a, b) =>
        rank[lookupState(a)] - rank[lookupState(b)] || b.number - a.number,
    )
    .slice(0, limit);
}

/**
 * What the git provider found, without the Pull Requests the panel already listed.
 */
export function excludeKnownPullRequests(remote, known) {
  const knownNumbers = new Set(
    (Array.isArray(known) ? known : []).map((pr) => pr.number),
  );
  return (Array.isArray(remote) ? remote : []).filter(
    (pr) => pr && pr.number > 0 && !knownNumbers.has(pr.number),
  );
}

/**
 * The number typed in the lookup when it is one ("128" or "#128"), else null.
 */
export function typedPullRequestNumber(query) {
  const match = String(query || "")
    .trim()
    .match(/^#?(\d{1,9})$/);
  if (!match) {
    return null;
  }
  const number = parseInt(match[1], 10);
  return number > 0 ? number : null;
}

/**
 * The major branches a Pull Request goes through once merged: its target branch, then the first
 * merge target of each branch, up to the top. Stops on a loop or on a branch that is not major.
 */
export function journeyBranchPath(orgs, targetBranch) {
  const byName = new Map(
    (Array.isArray(orgs) ? orgs : []).map((org) => [org?.name, org]),
  );
  const path = [];
  let current = targetBranch;
  while (current && byName.has(current) && !path.includes(current)) {
    path.push(current);
    const targets = byName.get(current)?.mergeTargets;
    current = Array.isArray(targets) ? targets[0] : "";
  }
  return path;
}

/**
 * Where a Pull Request stands in the pipeline: the validation of the Pull Request, then one step
 * per major branch on its way to the top. A vehicle Pull Request stops at its target branch.
 *
 * It only states what the data says. A merged Pull Request found in no loaded window may be live
 * for months or may belong to another pipeline: its later steps are "unknown", never a guess.
 *
 * - windows: { <branch>: [numbers of the Pull Requests in the branch since its last promotion] }
 * - statuses: the deployment action status entries of the Pull Request ({ orgBranch, status })
 * - workflows: the runs read from the validation and deployment comments ({ kind, status,
 *   targetBranch, jobUrl })
 * - runningJobs: the jobs the git provider says are not over, { pullRequest: [job], branches:
 *   { <branch>: [job] } }, each job with its kind. Null while they are not known.
 * - vehicles: the promotions and the merges between two major branches the panel knows, open or
 *   merged ({ number, sourceBranch, targetBranch, state, mergeDate, promotionPullRequests })
 * - arrivals: { <branch>: [dates of the merges made into the branch since its last promotion] }
 *
 * Step states: waiting, running, pending, success, merged, deployed, failed, unknown.
 *
 * Each step past the target branch names the Pull Request that carried the story there
 * (carriedBy), or the open one that will (carriedBy with carrierOpen). A step also holds the
 * jobs that are running for it (runningJobs): the checks of the Pull Request on the validation
 * step, the deployment of the branch on a branch step.
 */
export function buildPullRequestJourney({
  pr,
  orgs,
  windows,
  statuses,
  workflows,
  runningJobs,
  vehicles,
  arrivals,
}) {
  const steps = [];
  if (!pr) {
    return steps;
  }
  const runs = Array.isArray(workflows) ? workflows : [];
  const entries = Array.isArray(statuses) ? statuses : [];
  const merged = lookupState(pr) === "merged";

  // Validation: the jobs of the last commit while the Pull Request is open, then what its
  // validation comment recorded
  const validationRun = [...runs]
    .reverse()
    .find(
      (run) =>
        run.kind === "validation" &&
        (run.prNumber === undefined || run.prNumber === pr.number),
    );
  let validationState = "unknown";
  if (!merged && lookupState(pr) === "open") {
    validationState =
      {
        success: "success",
        failed: "failed",
        running: "running",
        pending: "pending",
      }[String(pr.jobsStatus || "")] || "unknown";
  }
  // What the git provider just said wins over the status read with the list of Pull Requests,
  // which can be a minute old: a job that ended must not keep the step moving
  const checks =
    !merged && lookupState(pr) === "open" && runningJobs
      ? (runningJobs.pullRequest || []).filter(
          (job) => job.kind === "validation" || job.kind === "codeQuality",
        )
      : [];
  if (runningJobs && ["running", "pending"].includes(validationState)) {
    validationState = "unknown";
  }
  if (checks.length > 0) {
    validationState = unfinishedState(checks);
  }
  if (validationState === "unknown" && validationRun) {
    validationState =
      { valid: "success", invalid: "failed", pending: "pending" }[
        validationRun.status
      ] || "unknown";
  }
  steps.push({
    key: "validation",
    kind: "validation",
    branch: pr.targetBranch || "",
    state: validationState,
    carriedBy: null,
    carrierOpen: false,
    runningJobs: checks,
  });

  // A Pull Request closed without being merged will never reach a branch
  if (lookupState(pr) === "closed") {
    return steps;
  }
  // A vehicle (a promotion, a merge between two major branches) ends in the branch it is
  // merged into. The stories it carries go further, in another vehicle: it never does.
  const vehicle = pr.isPromotion === true || pr.isMajorToMajor === true;
  const path = journeyBranchPath(orgs, pr.targetBranch).slice(
    0,
    vehicle ? 1 : undefined,
  );
  if (path.length === 0) {
    return steps;
  }
  const windowOf = (branch) =>
    Array.isArray(windows?.[branch]) ? windows[branch] : [];
  const deployedVia = Array.isArray(pr.alreadyDeployedVia)
    ? pr.alreadyDeployedVia
    : [];
  // The furthest branch the Pull Request is known to have reached
  let reached = merged ? 0 : -1;
  let known = !merged;
  path.forEach((branch, index) => {
    if (
      windowOf(branch).includes(pr.number) ||
      deployedVia.some((via) => via.targetBranch === branch)
    ) {
      reached = Math.max(reached, index);
      known = true;
    }
  });

  const knownVehicles = (Array.isArray(vehicles) ? vehicles : []).filter(
    (vehicle) => vehicle && vehicle.number > 0 && vehicle.number !== pr.number,
  );
  // When the story reached the branch of the previous step, when that is known
  let reachedPreviousAt = NaN;
  path.forEach((branch, index) => {
    const isReached = merged && index <= reached;
    let carrier = null;
    let carrierOpen = false;
    let reachedAt = NaN;
    if (isReached && index === 0) {
      reachedAt = timeOf(pr.mergeDate);
    } else if (isReached) {
      carrier = mergedCarrier({
        pr,
        branch,
        previousBranch: path[index - 1],
        deployedVia,
        isFurthest: index === reached,
        vehicles: knownVehicles,
        reachedPreviousAt,
      });
      reachedAt = timeOf(carrier?.mergeDate);
    } else if (merged && known && index === reached + 1) {
      // The next branch: an open promotion declaring the story, or an open merge from the branch
      // the story waits in, will take it there
      carrier = openCarrier(pr, branch, path[index - 1], knownVehicles);
      carrierOpen = !!carrier;
    }

    let state = "waiting";
    let deployments = [];
    if (isReached) {
      state = "merged";
      const run = [...runs]
        .reverse()
        .find((r) => r.kind === "deployment" && r.targetBranch === branch);
      if (run) {
        state =
          { valid: "deployed", invalid: "failed", pending: "pending" }[
            run.status
          ] || "merged";
      }
      if (
        entries.some(
          (entry) => entry.orgBranch === branch && entry.status === "failed",
        )
      ) {
        state = "failed";
      }
      deployments = runningDeployments({
        jobs: runningJobs?.branches?.[branch],
        reachedAt,
        runs,
        branch,
        arrivals: arrivals?.[branch],
      });
      if (deployments.length > 0) {
        state = unfinishedState(deployments);
      }
    } else if (merged && !known) {
      state = "unknown";
    }
    steps.push({
      key: `branch-${branch}`,
      kind: "branch",
      branch,
      state,
      carriedBy: carrier?.number > 0 ? carrier.number : null,
      carrierOpen,
      runningJobs: deployments,
    });
    reachedPreviousAt = reachedAt;
  });
  return steps;
}

function timeOf(date) {
  const time = date ? new Date(date).getTime() : NaN;
  return Number.isFinite(time) ? time : NaN;
}

// Running as soon as one job runs, pending when they are all queued
function unfinishedState(jobs) {
  return jobs.some((job) => job.status === "running") ? "running" : "pending";
}

function sameBranch(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase() && !!a;
}

function declaresStory(vehicle, pr) {
  return (
    Array.isArray(vehicle.promotionPullRequests) &&
    vehicle.promotionPullRequests.includes(pr.number)
  );
}

/**
 * The merged Pull Request that brought a story into a branch past its target: the promotion that
 * declared it, else the first merge from the previous branch made after the story got there.
 * Null when nothing says which one it was: a carrier is never guessed.
 */
function mergedCarrier({
  pr,
  branch,
  previousBranch,
  deployedVia,
  isFurthest,
  vehicles,
  reachedPreviousAt,
}) {
  const merged = vehicles.filter(
    (vehicle) =>
      lookupState(vehicle) === "merged" &&
      sameBranch(vehicle.targetBranch, branch),
  );
  const via = deployedVia.find((item) => sameBranch(item.targetBranch, branch));
  if (via?.number > 0) {
    return via;
  }
  const declaring = merged.find((vehicle) => declaresStory(vehicle, pr));
  if (declaring) {
    return declaring;
  }
  if (isFurthest && pr.carriedByPullRequest?.number > 0) {
    const known = merged.find(
      (vehicle) => vehicle.number === pr.carriedByPullRequest.number,
    );
    return known || pr.carriedByPullRequest;
  }
  if (!Number.isFinite(reachedPreviousAt)) {
    return null;
  }
  return (
    merged
      .filter(
        (vehicle) =>
          sameBranch(vehicle.sourceBranch, previousBranch) &&
          timeOf(vehicle.mergeDate) >= reachedPreviousAt,
      )
      .sort((a, b) => timeOf(a.mergeDate) - timeOf(b.mergeDate))[0] || null
  );
}

// The open Pull Request that will take the story to the next branch, the oldest when several do
function openCarrier(pr, branch, previousBranch, vehicles) {
  const open = vehicles
    .filter(
      (vehicle) =>
        lookupState(vehicle) === "open" &&
        sameBranch(vehicle.targetBranch, branch),
    )
    .sort((a, b) => a.number - b.number);
  return (
    open.find((vehicle) => declaresStory(vehicle, pr)) ||
    open.find(
      (vehicle) =>
        sameBranch(vehicle.sourceBranch, previousBranch) &&
        !Array.isArray(vehicle.promotionPullRequests),
    ) ||
    null
  );
}

/**
 * The deployment jobs of a branch that are deploying this Pull Request: the ones started once
 * the story was in the branch. A job that started before is the business of another Pull Request.
 *
 * Once the Pull Request has its deployment result, what runs next on the branch deploys a later
 * merge, unless nothing was merged into the branch since: then the same deployment is being run
 * again, and it is still the one of this Pull Request.
 */
function runningDeployments({ jobs, reachedAt, runs, branch, arrivals }) {
  if (!Array.isArray(jobs) || !Number.isFinite(reachedAt)) {
    return [];
  }
  // A provider that does not say when a job started still says when it last moved
  const startOf = (job) => timeOf(job.startedAt || job.updatedAt);
  const unfinished = jobs.filter(
    (job) =>
      job.kind === "deployment" &&
      ["running", "pending"].includes(job.status) &&
      startOf(job) >= reachedAt,
  );
  const results = runs
    .filter(
      (run) =>
        run.kind === "deployment" &&
        run.targetBranch === branch &&
        ["valid", "invalid"].includes(run.status) &&
        timeOf(run.date) >= reachedAt,
    )
    .map((run) => timeOf(run.date));
  if (results.length === 0) {
    return unfinished;
  }
  const settledAt = Math.max(...results);
  const mergedSince = (Array.isArray(arrivals) ? arrivals : []).some(
    (date) => timeOf(date) > reachedAt,
  );
  return mergedSince
    ? []
    : unfinished.filter((job) => startOf(job) > settledAt);
}

/**
 * The rows the Validation, Code Quality and Deployment tabs show above the comments, out of the
 * running jobs the journey attributed to its steps: { validation, megalinter, deployment }, each
 * row a job with the branch of its step and the Pull Request that carried the story there.
 */
export function runningJobRows(steps) {
  const rows = { validation: [], megalinter: [], deployment: [] };
  for (const step of Array.isArray(steps) ? steps : []) {
    for (const job of step.runningJobs || []) {
      const tab =
        step.kind === "branch"
          ? "deployment"
          : job.kind === "codeQuality"
            ? "megalinter"
            : "validation";
      rows[tab].push({
        ...job,
        kind: tab,
        targetBranch: step.branch,
        carriedBy: step.kind === "branch" ? step.carriedBy : null,
      });
    }
  }
  return rows;
}

/**
 * True for the images a rendered comment may load: the banners sfdx-hardis and MegaLinter put in
 * their own comments, served by GitHub from their two repositories.
 *
 * Any other image stays replaced by its alternative text. A comment can be written by anyone
 * allowed to comment, and an image at an address they chose would tell them who opened the tab,
 * and when. Nobody commenting on a Pull Request chooses what these two repositories serve.
 */
export function isTrustedCommentImage(url) {
  const address = String(url || "").trim();
  if (address.includes("..") || /[?#\\\s]/.test(address)) {
    return false;
  }
  return (
    /^https:\/\/raw\.githubusercontent\.com\/(?:hardisgroupcom\/sfdx-hardis|oxsecurity\/megalinter)\/[\w.-]+(?:\/[\w.-]+)*\/docs\/assets\/images\/[\w.-]+(?:\/[\w.-]+)*\.(?:png|gif|jpe?g|webp)$/i.test(
      address,
    ) ||
    /^https:\/\/github\.com\/(?:hardisgroupcom\/sfdx-hardis|oxsecurity\/megalinter)\/raw\/[\w.-]+(?:\/[\w.-]+)*\/docs\/assets\/images\/[\w.-]+(?:\/[\w.-]+)*\.(?:png|gif|jpe?g|webp)$/i.test(
      address,
    )
  );
}

/**
 * The pill class of a journey step state or of a run status, from the fixed status palette.
 */
export function journeyPillClass(state) {
  const hue =
    {
      success: "success",
      deployed: "success",
      valid: "success",
      failed: "failed",
      invalid: "failed",
      running: "running",
      pending: "pending",
      merged: "info",
    }[state] || "unknown";
  return `hardis-pill hardis-status-${hue}`;
}

/**
 * How a step of the journey is drawn in the path: reached (filled green), failed (filled red),
 * running (filled blue), pending, or still ahead. `mark` is the sign shown before its name.
 */
export function journeyPathStep(state, loading = false) {
  // A step whose result is still being read is not known yet: grey, like what is ahead, with
  // the dot of something going on
  const look = loading
    ? "ahead"
    : {
        success: "done",
        deployed: "done",
        merged: "done",
        failed: "failed",
        running: "running",
        pending: "pending",
      }[state] || "ahead";
  // What is going on moves: a band sweeps across the step, whether the job runs or waits
  const moving = !loading && (look === "running" || look === "pending");
  return {
    look,
    stepClass: `hardis-path-step hardis-path-${look}${moving ? " hardis-path-moving" : ""}`,
    mark: { done: "\u2713", failed: "\u2715" }[look] || "",
    // A dot for what is going on, nothing for what has not started
    dot: loading || look === "running" || look === "pending",
    dotClass: loading
      ? "hardis-path-dot hardis-path-dot-loading"
      : "hardis-path-dot",
  };
}

/**
 * A link is only followed when it is a plain web address: the URLs of a run come from a Pull
 * Request comment, which anyone allowed to comment can write. http is accepted next to https
 * because a self-hosted git provider or ticketing tool is not always served over https.
 */
export function safeWebUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(text) ? text : "";
}

// Above this number of files, the files of a job are browsed folder by folder
export const ARTIFACT_FLAT_LIST_MAX = 10;

/**
 * What the Files list of a run shows. Up to ARTIFACT_FLAT_LIST_MAX files, all of them with their
 * path. Above, the content of one folder: its sub-folders first, each with the number of files
 * under it, then its own files, and the breadcrumb leading to it.
 * `files` are the { path, sizeBytes } returned by sf hardis:git:artifacts:download, with paths
 * relative to the folder of the job and forward slashes.
 */
export function buildArtifactEntries(
  files,
  currentFolder = "",
  flatMax = ARTIFACT_FLAT_LIST_MAX,
) {
  const list = (Array.isArray(files) ? files : []).filter(
    (file) => file && typeof file.path === "string" && file.path !== "",
  );
  const fileEntry = (file, label) => ({
    key: `file:${file.path}`,
    isFolder: false,
    label,
    path: file.path,
    sizeBytes: Number(file.sizeBytes) || 0,
  });
  if (list.length <= flatMax) {
    return {
      byFolder: false,
      crumbs: [],
      entries: list.map((file) => fileEntry(file, file.path)),
    };
  }
  const folder = String(currentFolder || "").replace(/^\/+|\/+$/g, "");
  const prefix = folder ? `${folder}/` : "";
  const folderCounts = new Map();
  const ownFiles = [];
  for (const file of list) {
    if (!file.path.startsWith(prefix)) {
      continue;
    }
    const rest = file.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      ownFiles.push(fileEntry(file, rest));
    } else {
      const name = rest.slice(0, slash);
      folderCounts.set(name, (folderCounts.get(name) || 0) + 1);
    }
  }
  const folders = [...folderCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, fileCount]) => ({
      key: `folder:${prefix}${name}`,
      isFolder: true,
      label: name,
      path: `${prefix}${name}`,
      fileCount,
    }));
  const crumbs = [{ label: "", path: "" }];
  folder
    .split("/")
    .filter(Boolean)
    .forEach((segment, index, segments) => {
      crumbs.push({
        label: segment,
        path: segments.slice(0, index + 1).join("/"),
      });
    });
  return { byFolder: true, crumbs, entries: [...folders, ...ownFiles] };
}

/** Size of a file as a reader expects it: 512 B, 48 KB, 1.2 MB */
export function formatFileSize(sizeBytes) {
  const bytes = Number(sizeBytes) || 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
