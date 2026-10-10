import { Job, JobKind } from "../gitProviders/types";

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
 * Not when another run of the same commit has a name that says what it does: the run nobody can
 * name is then another CI of the project (a security scan, unit tests), and none of the tabs is
 * its place.
 */
export function pickUnfinishedJobsByKind(
  runs: Job[],
  jobsOfRun: (run: Job) => Job[],
  fallbackKind: JobKind,
): Job[] {
  const picked: Job[] = [];
  const someRunIsKnown = (runs || []).some(
    (run) => classifyJobKind(run.name) !== "other",
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
        })),
      );
      continue;
    }
    // No job of the run can be told apart (renamed jobs, or a run that is one job already)
    const runKind = classifyJobKind(run.name);
    if (runKind === "other" && someRunIsKnown) {
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
  }));
}
