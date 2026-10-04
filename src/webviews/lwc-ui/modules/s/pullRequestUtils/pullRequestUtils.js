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
  actionStatusesLoading: false,
  expandedActionRowIds: [],
  hiddenActionStatusKeys: [],
  hiddenActionForecastKeys: [],
  promotionMode: false,
  actionForecast: null,
  actionForecastLoading: false,
  modalIsMajorPr: false,
  modalIsPromotionPr: false,
  modalPromotionUnresolved: [],
  modalIsTopBranch: false,
  modalGoLives: [],
  modalGoLivesLoading: false,
  modalGoLivePrsLoading: false,
  isLoadingReleaseDetails: false,
  selectedGoLiveId: "",
  deploymentApexTestClasses: [],
  _deploymentApexTestClassesOriginal: [],
  apexTestsMode: "view",
  apexTestsByLineRows: [],
  modalWorkflows: null,
  modalCheckout: null,
  workflowsUnavailable: false,
  ticketDetailsLoading: false,
};

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
 * per major branch on its way to the top.
 *
 * It only states what the data says. A merged Pull Request found in no loaded window may be live
 * for months or may belong to another pipeline: its later steps are "unknown", never a guess.
 *
 * - windows: { <branch>: [numbers of the Pull Requests in the branch since its last promotion] }
 * - statuses: the deployment action status entries of the Pull Request ({ orgBranch, status })
 * - workflows: the runs read from the validation and deployment comments ({ kind, status,
 *   targetBranch, jobUrl })
 *
 * Step states: waiting, running, pending, success, merged, deployed, failed, unknown.
 */
export function buildPullRequestJourney({
  pr,
  orgs,
  windows,
  statuses,
  workflows,
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
      { success: "success", failed: "failed", running: "running", pending: "pending" }[
        String(pr.jobsStatus || "")
      ] || "unknown";
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
    jobUrl: validationRun?.jobUrl || "",
    carriedBy: null,
  });

  const path = journeyBranchPath(orgs, pr.targetBranch);
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

  path.forEach((branch, index) => {
    let state = "waiting";
    if (merged && index <= reached) {
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
    } else if (merged && !known) {
      state = "unknown";
    }
    const via = deployedVia.find((item) => item.targetBranch === branch);
    const carrier =
      !via && pr.carriedByPullRequest && index === reached && index > 0
        ? pr.carriedByPullRequest
        : via;
    const stepRun = [...runs]
      .reverse()
      .find((r) => r.kind === "deployment" && r.targetBranch === branch);
    steps.push({
      key: `branch-${branch}`,
      kind: "branch",
      branch,
      state,
      jobUrl: stepRun?.jobUrl || "",
      carriedBy: carrier?.number > 0 ? carrier.number : null,
    });
  });
  return steps;
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
 * A link is only followed when it is a plain web address: the URLs of a run come from a Pull
 * Request comment, which anyone allowed to comment can write. http is accepted next to https
 * because a self-hosted git provider or ticketing tool is not always served over https.
 */
export function safeWebUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(text) ? text : "";
}
