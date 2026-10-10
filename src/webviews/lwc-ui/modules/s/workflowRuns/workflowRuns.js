import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import {
  buildArtifactEntries,
  jobDurationKey,
  formatDuration,
  formatFileSize,
  journeyPillClass,
  safeWebUrl,
} from "s/pullRequestUtils";

/**
 * Validation, Deployment and MegaLinter tabs of the Pull Request view: the comments posted on
 * the Pull Request by sfdx-hardis and by MegaLinter, shown as they are, each one under a line
 * giving its outcome, its date and the links to the job, to the comment itself and to the files
 * the job published as artifacts.
 *
 * A job that is not over has posted no comment yet: `runningJobs`, read from the git provider,
 * are listed first, each one with the link to the job, above the result of the previous run.
 * It says for how long it has been going on, counted every second.
 *
 * `durations` are the seconds each finished job took, by kind and job URL (jobDurationKey),
 * read from the git provider.
 *
 * `runs` are the runs of one kind, from the `workflows` list returned by
 * `sf hardis:project:action:list --with-workflows`. `artifacts` are the answers of
 * `sf hardis:git:artifacts:download`, by job URL: the files are downloaded when the user asks for
 * them, and opened from the workspace.
 */
export default class WorkflowRuns extends SharedMixin(LightningElement) {
  @api loading = false;
  // Text shown when the Pull Request has no comment of this kind
  @api emptyLabel = "";
  // False when the installed sfdx-hardis or the git provider cannot download the files of a job
  @api artifactsSupported = false;
  _runs = [];
  _runningJobs = [];
  _artifacts = {};
  _durations = {};
  // Clock of the jobs going on, moved every second while one of them is shown
  _now = Date.now();
  _clock = null;
  _connected = false;
  // Holder changed in place, so that filling it while rendering renders nothing again
  _rowsMemo = {};
  // Job URLs whose list of files is unfolded
  _openJobs = [];
  // Job URLs whose files were asked and not answered yet
  _pendingJobs = [];
  // Folder shown for each job URL, when its files are browsed by folder
  _folders = {};
  // When each job was last asked, to tell the answer of this request from an older one
  _requestTimes = {};

  @api
  get runs() {
    return this._runs;
  }
  set runs(value) {
    this._runs = Array.isArray(value) ? value : [];
  }

  // Jobs of this kind still running or queued ({ kind, status, name, webUrl, startedAt,
  // targetBranch, carriedBy })
  @api
  get runningJobs() {
    return this._runningJobs;
  }
  set runningJobs(value) {
    this._runningJobs = Array.isArray(value) ? value : [];
    this._syncClock();
  }

  @api
  get durations() {
    return this._durations;
  }
  set durations(value) {
    this._durations = value && typeof value === "object" ? value : {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._connected = true;
    this._boundSyncClock = () => this._syncClock();
    document.addEventListener("visibilitychange", this._boundSyncClock);
    this._syncClock();
  }

  disconnectedCallback() {
    if (super.disconnectedCallback) {
      super.disconnectedCallback();
    }
    this._connected = false;
    document.removeEventListener("visibilitychange", this._boundSyncClock);
    this._syncClock();
  }

  @api
  get artifacts() {
    return this._artifacts;
  }
  set artifacts(value) {
    this._artifacts = value && typeof value === "object" ? value : {};
    // An answer ends the wait of its job
    this._pendingJobs = this._pendingJobs.filter(
      (jobUrl) => !this._isAnswered(jobUrl),
    );
  }

  get hasRuns() {
    return this._runs.length > 0;
  }

  get hasRunningJobs() {
    return this._runningJobs.length > 0;
  }

  get showEmpty() {
    return !this.loading && !this.hasRuns && !this.hasRunningJobs;
  }

  // Nothing to wait for behind a spinner when a job is already there to show
  get showLoading() {
    return this.loading && !this.hasRunningJobs;
  }

  get runningRows() {
    return this._runningJobs.map((job, index) => {
      const label = this._label(job.kind, job.targetBranch || "");
      const context = [];
      // The name of the job, when it says more than the title of the row ("Mega-Linter" under
      // "MegaLinter" does not)
      const bare = (text) =>
        String(text || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      if (job.name && bare(job.name) !== bare(label)) {
        context.push(job.name);
      }
      const running = job.status === "running";
      const started = job.startedAt ? this._formatDate(job.startedAt) : "";
      if (started) {
        // A job waiting for a runner has no start yet: its date is the one it was queued at,
        // and the count starts again from its real start
        context.push(
          this.t(running ? "workflowStartedAt" : "workflowQueuedAt", {
            date: started,
          }),
        );
        // Never negative: the clock of the workstation can be a little behind the provider
        const elapsed = formatDuration(
          Math.max(0, this._now - new Date(job.startedAt).getTime()) / 1000,
        );
        if (elapsed) {
          context.push(this.t("workflowElapsed", { duration: elapsed }));
        }
      }
      if (job.carriedBy > 0) {
        context.push(this.t("journeyCarriedBy", { number: job.carriedBy }));
      }
      return {
        key: `running-${index}`,
        label,
        context: context.join(" · "),
        statusLabel: running
          ? this.i18n.jobStatusRunning
          : this.i18n.jobStatusPending,
        pillClass: journeyPillClass(running ? "running" : "pending"),
        running,
        jobUrl: safeWebUrl(job.webUrl),
      };
    });
  }

  // Not rebuilt by the clock of the running jobs: only when what the rows show changes. Every
  // input is replaced, never changed in place.
  get rows() {
    const inputs = [
      this._runs,
      this._durations,
      this._artifacts,
      this._openJobs,
      this._pendingJobs,
      this._folders,
      this._requestTimes,
      this.artifactsSupported,
    ];
    const memo = this._rowsMemo;
    if (
      !memo.inputs ||
      inputs.some((input, index) => input !== memo.inputs[index])
    ) {
      memo.inputs = inputs;
      memo.rows = this._buildRows();
    }
    return memo.rows;
  }

  handleOpenUrl(event) {
    const url = safeWebUrl(event.currentTarget.dataset.url);
    if (url) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }

  // Shows or hides the files of a job. Showing them always asks sfdx-hardis again, which only
  // downloads when the job published other artifacts since: the files already known stay
  // displayed meanwhile.
  handleFilesClick(event) {
    const jobUrl = safeWebUrl(event.currentTarget.dataset.job);
    if (!jobUrl) {
      return;
    }
    if (this._openJobs.includes(jobUrl)) {
      this._openJobs = this._openJobs.filter((url) => url !== jobUrl);
      return;
    }
    this._openJobs = [...this._openJobs, jobUrl];
    if (!this._pendingJobs.includes(jobUrl)) {
      this._requestTimes = { ...this._requestTimes, [jobUrl]: Date.now() };
      this._pendingJobs = [...this._pendingJobs, jobUrl];
      window.sendMessageToVSCode({
        type: "loadJobArtifacts",
        data: { jobUrl, requestedAt: this._requestTimes[jobUrl] },
      });
    }
  }

  // A folder of the list or of the breadcrumb
  handleFolderClick(event) {
    const { job, path } = event.currentTarget.dataset;
    this._folders = { ...this._folders, [job]: path || "" };
  }

  handleFileClick(event) {
    const { job, path } = event.currentTarget.dataset;
    const folder = this._artifacts[job]?.folder;
    if (folder && path) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: `${folder}/${path}` },
      });
    }
  }

  _buildRows() {
    return this._runs.map((run, index) => {
      const branch = run.targetBranch || "";
      const context = [];
      const jobUrl = safeWebUrl(run.jobUrl);
      if (run.date) {
        context.push(this._formatDate(run.date));
      }
      const duration = formatDuration(
        this._durations[jobDurationKey(run.kind, jobUrl)],
      );
      if (jobUrl && duration) {
        context.push(this.t("workflowDuration", { duration }));
      }
      if (run.errorCount > 0) {
        context.push(this.t("workflowErrors", { count: run.errorCount }));
      }
      if (run.failedTestsCount > 0) {
        context.push(
          this.t("workflowFailedTests", { count: run.failedTestsCount }),
        );
      }
      if (run.quickDeploy === true) {
        context.push(this.i18n.workflowQuickDeploy);
      }
      return {
        key: `run-${index}`,
        label: this._label(run.kind, branch),
        context: context.join(" · "),
        statusLabel: this._statusLabel(run.status),
        pillClass: journeyPillClass(run.status),
        jobUrl,
        commentUrl: safeWebUrl(run.commentUrl),
        hasBody: !!run.body,
        body: run.body || "",
        ...this._filesState(jobUrl),
      };
    });
  }

  // The clock only runs while a job that says when it started is on screen
  _syncClock() {
    // Not for a panel nobody looks at
    const needed =
      this._connected &&
      !document.hidden &&
      this._runningJobs.some((job) => job.startedAt);
    if (needed && !this._clock) {
      this._now = Date.now();
      this._clock = setInterval(() => {
        this._now = Date.now();
      }, 1000);
    } else if (!needed && this._clock) {
      clearInterval(this._clock);
      this._clock = null;
    }
  }

  // What the Files button of a run and the list under it show
  _filesState(jobUrl) {
    const showFiles = this.artifactsSupported === true && !!jobUrl;
    const answer = showFiles ? this._artifacts[jobUrl] : null;
    const files = answer?.status === "success" ? answer.files || [] : null;
    const open = showFiles && this._openJobs.includes(jobUrl);
    const pending = this._pendingJobs.includes(jobUrl);
    const listing = buildArtifactEntries(files || [], this._folders[jobUrl]);
    let message = "";
    if (open && !pending && answer && !files) {
      message =
        answer.status === "expired"
          ? this.i18n.workflowFilesExpired
          : answer.status === "none"
            ? this.i18n.workflowFilesNone
            : answer.message || this.i18n.workflowFilesError;
    } else if (open && !pending && files && files.length === 0) {
      message = this.i18n.workflowFilesNone;
    }
    return {
      showFiles,
      filesLabel: files
        ? this.t("workflowFilesCount", { count: files.length })
        : this.i18n.workflowFiles,
      filesOpen: open,
      // Files already known stay displayed while sfdx-hardis checks them again
      filesLoading: open && pending && !files,
      filesMessage: message,
      hasFiles: open && !!files && files.length > 0,
      showCrumbs: listing.byFolder,
      crumbs: listing.crumbs.map((crumb, index) => ({
        key: `crumb-${index}`,
        path: crumb.path,
        label: crumb.path === "" ? this.i18n.workflowFilesRoot : crumb.label,
        isLast: index === listing.crumbs.length - 1,
      })),
      folderEntries: listing.entries
        .filter((entry) => entry.isFolder)
        .map((entry) => ({
          ...entry,
          meta: this.t("workflowFilesFolderCount", { count: entry.fileCount }),
        })),
      fileEntries: listing.entries
        .filter((entry) => !entry.isFolder)
        .map((entry) => ({ ...entry, meta: formatFileSize(entry.sizeBytes) })),
    };
  }

  // True when the answer held for a job is the one of its last request
  _isAnswered(jobUrl) {
    const answer = this._artifacts[jobUrl];
    return !!answer && (answer.requestedAt || 0) >= this._requestTimes[jobUrl];
  }

  _label(kind, branch) {
    if (kind === "megalinter") {
      return "MegaLinter";
    }
    if (kind === "validation") {
      return branch
        ? this.t("workflowValidation", { branch })
        : this.i18n.workflowValidationNoBranch;
    }
    return branch
      ? this.t("workflowDeployment", { branch })
      : this.i18n.workflowDeploymentNoBranch;
  }

  _statusLabel(status) {
    if (status === "valid") {
      return this.i18n.jobStatusSuccess;
    }
    if (status === "invalid") {
      return this.i18n.jobStatusFailed;
    }
    return this.i18n.jobStatusPending;
  }

  _formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
