import type { Job, JobStatus, MajorBranchCheck } from "../gitProviders/types";
import { jobDurationSeconds } from "./jobKindUtils";

/**
 * The major branch deployment check (sfdx-hardis enableMajorBranchDeploymentCheck): a scheduled CI
 * job simulates the deployment of each major branch into its own org, and the DevOps Pipeline
 * shows the result of the last one on the node of the branch.
 *
 * No VS Code import: everything here is run for real by the unit tests.
 */

// Hours after which a check is stale when the project does not say (majorBranchDeploymentCheckValidityHours)
export const DEFAULT_MAJOR_BRANCH_CHECK_VALIDITY_HOURS = 24;

export type MajorBranchCheckStaleReason = "age" | "deployedAfter" | null;

export type MajorBranchCheckState = {
  status: JobStatus;
  stale: boolean;
  staleReason: MajorBranchCheckStaleReason;
  durationSeconds: number | null;
};

// What a node of the pipeline carries: the check and what the panel tells about it
export type MajorBranchCheckView = MajorBranchCheck & MajorBranchCheckState;

/** The switch of the feature in the project config: only an explicit true turns it on. */
export function isMajorBranchCheckEnabled(projectConfig: any): boolean {
  return projectConfig?.enableMajorBranchDeploymentCheck === true;
}

/**
 * majorBranchDeploymentCheckValidityHours of the project config, 24 when it is missing, not a
 * number or below 1.
 */
export function getMajorBranchCheckValidityHours(projectConfig: any): number {
  const hours = Number(projectConfig?.majorBranchDeploymentCheckValidityHours);
  return Number.isFinite(hours) && hours >= 1
    ? hours
    : DEFAULT_MAJOR_BRANCH_CHECK_VALIDITY_HOURS;
}

/**
 * The check of a branch as the panel receives it, null when no check was found. The fields are
 * read by name by the webview and by an end to end script: keep them.
 */
export function buildMajorBranchCheckView(
  check: MajorBranchCheck | null | undefined,
  deploymentJob: Job | null | undefined,
  validityHours: number,
  now: Date = new Date(),
): MajorBranchCheckView | null {
  if (!check) {
    return null;
  }
  const state = computeMajorBranchCheckState(
    check,
    deploymentJob,
    validityHours,
    now,
  );
  return {
    status: state.status,
    name: check.name || "",
    webUrl: check.webUrl || "",
    startedAt: check.startedAt,
    finishedAt: check.finishedAt,
    durationSeconds: state.durationSeconds,
    stale: state.stale,
    staleReason: state.staleReason,
  };
}

/**
 * What the panel says about the last check of a branch.
 *
 * A check still running or queued is never stale. A finished one is stale when a deployment of the
 * branch finished after it started ("deployedAfter": the org it was checked against changed), or
 * when it is older than `validityHours` ("age").
 *
 * `deploymentJob` is the job the deployment arrow of the branch shows (MajorOrg.jobs[0]).
 */
export function computeMajorBranchCheckState(
  check: MajorBranchCheck,
  deploymentJob: Job | null | undefined,
  validityHours: number,
  now: Date = new Date(),
): MajorBranchCheckState {
  const status = check.status;
  const durationSeconds = jobDurationSeconds({
    startedAt: check.startedAt,
    finishedAt: check.finishedAt,
  });
  if (status === "running" || status === "pending") {
    return { status, stale: false, staleReason: null, durationSeconds };
  }
  const checkStart = Date.parse(check.startedAt || "");
  const deploymentEnd = Date.parse(deploymentJob?.updatedAt || "");
  if (
    (deploymentJob?.status === "success" ||
      deploymentJob?.status === "failed") &&
    Number.isFinite(checkStart) &&
    Number.isFinite(deploymentEnd) &&
    deploymentEnd > checkStart
  ) {
    return {
      status,
      stale: true,
      staleReason: "deployedAfter",
      durationSeconds,
    };
  }
  const checkTime = Date.parse(check.finishedAt || check.startedAt || "");
  const hours =
    Number.isFinite(validityHours) && validityHours >= 1
      ? validityHours
      : DEFAULT_MAJOR_BRANCH_CHECK_VALIDITY_HOURS;
  if (
    Number.isFinite(checkTime) &&
    now.getTime() - checkTime > hours * 60 * 60 * 1000
  ) {
    return { status, stale: true, staleReason: "age", durationSeconds };
  }
  return { status, stale: false, staleReason: null, durationSeconds };
}
