import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { journeyPillClass, safeWebUrl } from "s/pullRequestUtils";

/**
 * Validation, Deployment and MegaLinter tabs of the Pull Request view: the comments posted on
 * the Pull Request by sfdx-hardis and by MegaLinter, shown as they are, each one under a line
 * giving its outcome, its date and the links to the job and to the comment itself.
 *
 * `runs` are the runs of one kind, from the `workflows` list returned by
 * `sf hardis:project:action:list --with-workflows`.
 */
export default class WorkflowRuns extends SharedMixin(LightningElement) {
  @api loading = false;
  // Text shown when the Pull Request has no comment of this kind
  @api emptyLabel = "";
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
      return {
        key: `run-${index}`,
        label: this._label(run.kind, branch),
        context: context.join(" · "),
        statusLabel: this._statusLabel(run.status),
        pillClass: journeyPillClass(run.status),
        jobUrl: safeWebUrl(run.jobUrl),
        commentUrl: safeWebUrl(run.commentUrl),
        hasBody: !!run.body,
        body: run.body || "",
      };
    });
  }

  handleOpenUrl(event) {
    const url = safeWebUrl(event.currentTarget.dataset.url);
    if (url) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
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
