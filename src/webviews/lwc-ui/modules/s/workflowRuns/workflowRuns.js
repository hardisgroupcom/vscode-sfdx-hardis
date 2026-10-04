import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { journeyPillClass, safeHttpsUrl } from "s/pullRequestUtils";

/**
 * Workflows tab of the Pull Request view: the validation and deployment runs sfdx-hardis reported
 * in the comments of the Pull Request, one row per run, with the comment itself on demand.
 *
 * `runs` is the `workflows` list returned by `sf hardis:project:action:list --with-workflows`,
 * each run completed by the caller with `prNumber` (the Pull Request whose comment reported it).
 */
export default class WorkflowRuns extends SharedMixin(LightningElement) {
  @api loading = false;
  // Number of the Pull Request shown: a run reported on another one names it
  @api pullRequestNumber;
  @track expandedKeys = [];
  _runs = [];

  @api
  get runs() {
    return this._runs;
  }
  set runs(value) {
    this._runs = Array.isArray(value) ? value : [];
  }

  get hasRuns() {
    return this._runs.length > 0;
  }

  get showEmpty() {
    return !this.loading && !this.hasRuns;
  }

  get rows() {
    return this._runs.map((run, index) => {
      const key = `run-${index}`;
      const expanded = this.expandedKeys.includes(key);
      const branch = run.targetBranch || "";
      const context = [];
      if (run.date) {
        context.push(this._formatDate(run.date));
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
      if (run.coverageText) {
        context.push(run.coverageText);
      }
      const carried =
        run.prNumber > 0 && run.prNumber !== this.pullRequestNumber;
      return {
        key,
        label: this._label(run.kind, branch),
        context: context.join(" · "),
        statusLabel: this._statusLabel(run.status),
        pillClass: journeyPillClass(run.status),
        jobUrl: safeHttpsUrl(run.jobUrl),
        commentUrl: safeHttpsUrl(run.commentUrl),
        hasBody: !!run.body,
        body: run.body || "",
        expanded,
        toggleLabel: expanded
          ? this.i18n.workflowHideComment
          : this.i18n.workflowShowComment,
        carried,
        carriedLabel: carried ? `#${run.prNumber}` : "",
        prNumber: run.prNumber,
      };
    });
  }

  handleToggle(event) {
    const key = event.currentTarget.dataset.key;
    this.expandedKeys = this.expandedKeys.includes(key)
      ? this.expandedKeys.filter((k) => k !== key)
      : [...this.expandedKeys, key];
  }

  handleOpenUrl(event) {
    const url = safeHttpsUrl(event.currentTarget.dataset.url);
    if (url) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }

  handleOpenPullRequest(event) {
    const prNumber = parseInt(event.currentTarget.dataset.prNumber, 10);
    if (prNumber > 0) {
      this.dispatchEvent(
        new CustomEvent("openpullrequest", { detail: { prNumber } }),
      );
    }
  }

  _label(kind, branch) {
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
