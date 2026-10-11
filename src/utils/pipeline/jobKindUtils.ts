import { Job, JobKind, JobTiming } from "../gitProviders/types";

/**
 * What a CI job does, told from its name. The names are the ones of the CI files sfdx-hardis
 * installs, and what a project usually renames them to:
 *
 * - GitHub:    Simulate Deployment (sfdx-hardis), Mega-Linter, Process Deployment (sfdx-hardis)
 * - GitLab:    check_deploy_to_target_branch_org, check_quality, deploy_to_org
 * - Azure:     DeploymentCheck, MegaLinter, Deployment
 * - Bitbucket: Simulate SFDX deployment, Run MegaLinter, Deploy to major org
 *
 * Code quality is tested first: "check_quality" must not be read as a deployment check. A
 * validation is a deployment that is only simulated, so it is tested before "deploy".
 */
export function classifyJobKind(name: string | undefined | null): JobKind {
  const text = String(name || "").toLowerCase();
  if (/mega[\s_-]?linter|quality|\blint/.test(text)) {
    return "codeQuality";
  }
  if (
    /simulat|check[\s_-]?deploy|deploy(ment)?[\s_-]?check|validat/.test(text)
  ) {
    return "validation";
  }
  if (/deploy/.test(text)) {
    return "deployment";
  }
  return "other";
}

/**
 * When the job of a Pull Request comment ran, out of the jobs of the run its link names. The link
 * names a whole run (a workflow run, a build, a pipeline) that can hold other jobs: the ones of
 * the kind asked for are kept, and all of them when none can be told apart. A job that never
 * started (skipped) does not count. No end date while one of the jobs kept is not over, a job
 * still queued included.
 */
export function pickJobTiming(
  jobs: (JobTiming & { name?: string })[],
  kind?: JobKind,
): JobTiming | null {
  const all = jobs || [];
  const ofKind = kind
    ? all.filter((job) => classifyJobKind(job.name) === kind)
    : [];
  const kept = ofKind.length > 0 ? ofKind : all;
  const started = kept.filter((job) =>
    Number.isFinite(Date.parse(job.startedAt || "")),
  );
  if (started.length === 0) {
    return null;
  }
  const ends = started.map((job) => Date.parse(job.finishedAt || ""));
  const over =
    !kept.some((job) => job.waiting === true) &&
    ends.every((end) => Number.isFinite(end));
  return {
    startedAt: new Date(
      Math.min(...started.map((job) => Date.parse(job.startedAt || ""))),
    ).toISOString(),
    finishedAt: over ? new Date(Math.max(...ends)).toISOString() : undefined,
  };
}

/** Seconds a finished job took, null while it is not over or when its dates are not known. */
export function jobDurationSeconds(
  timing: JobTiming | null | undefined,
): number | null {
  const start = Date.parse(timing?.startedAt || "");
  const end = Date.parse(timing?.finishedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.round((end - start) / 1000)
    : null;
}

export function isUnfinishedJob(job: Job | undefined | null): boolean {
  return job?.status === "running" || job?.status === "pending";
}

/**
 * The unfinished jobs the Pull Request view shows, each one with its kind.
 *
 * `runs` are what the provider lists for a commit (workflow runs, pipelines, builds), `jobsOfRun`
 * gives the jobs inside one of them. A job that is neither a validation, a code quality check nor
 * a deployment (a cleanup, a scratch org creation) is left out. When nothing of an unfinished run
 * can be told apart, the run itself is shown, as `fallbackKind`: the tab then links to the whole
 * pipeline rather than saying nothing is running.
 *
 * Not when another run of the same commit is named as the kind the tab waits for: the run nobody
 * can name is then another CI of the project (a security scan, unit tests), and none of the tabs
 * is its place. A project that renamed its deployment and kept MegaLinter still has it shown.
 *
 * `queuedAt` of a job is when its run was created: a job can wait for a runner long after that.
 */
export function pickUnfinishedJobsByKind(
  runs: Job[],
  jobsOfRun: (run: Job) => Job[],
  fallbackKind: JobKind,
): Job[] {
  const picked: Job[] = [];
  const fallbackIsNamed = (runs || []).some(
    (run) => classifyJobKind(run.name) === fallbackKind,
  );
  for (const run of runs || []) {
    if (!isUnfinishedJob(run)) {
      continue;
    }
    const known = (jobsOfRun(run) || [])
      .filter((job) => job !== run)
      .map((job) => ({ ...job, kind: classifyJobKind(job.name) }))
      .filter((job) => job.kind !== "other");
    if (known.length > 0) {
      // Possibly none: what is still going on is a cleanup, and the tabs have nothing to add
      picked.push(
        ...known.filter(isUnfinishedJob).map((job) => ({
          ...job,
          parentName: run.name,
          startedAt: job.startedAt || run.startedAt,
          queuedAt: run.startedAt,
        })),
      );
      continue;
    }
    // No job of the run can be told apart (renamed jobs, or a run that is one job already)
    const runKind = classifyJobKind(run.name);
    if (runKind === "other" && fallbackIsNamed) {
      continue;
    }
    picked.push({ ...run, kind: runKind === "other" ? fallbackKind : runKind });
  }
  // The payload of the provider is not sent to the panel
  return picked.map((job) => ({
    name: job.name,
    status: job.status,
    webUrl: job.webUrl,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    kind: job.kind,
    parentName: job.parentName,
    ...(job.queuedAt ? { queuedAt: job.queuedAt } : {}),
  }));
}
