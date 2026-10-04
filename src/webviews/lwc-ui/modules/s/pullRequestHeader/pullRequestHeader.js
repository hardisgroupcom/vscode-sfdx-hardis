import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { journeyPillClass, lookupState, safeWebUrl } from "s/pullRequestUtils";

/**
 * Header of the Pull Request view: what the Pull Request is (state, author, branches), then its
 * journey through the pipeline, one step for the validation and one per major branch.
 *
 * `journey` is the list built by buildPullRequestJourney (s/pullRequestUtils).
 *
 * Event: openpullrequest { prNumber }, when a step names the Pull Request that carried the story.
 */
export default class PullRequestHeader extends SharedMixin(LightningElement) {
  @api pullRequest;
  @api platformLabel = "";
  // The validation and deployment results are still being read: a step whose state depends on
  // them says so, where it would otherwise claim it does not know
  @api loading = false;
  _journey = [];

  @api
  get journey() {
    return this._journey;
  }
  set journey(value) {
    this._journey = Array.isArray(value) ? value : [];
  }

  get pr() {
    return this.pullRequest || {};
  }

  get hasPullRequest() {
    return !!this.pullRequest;
  }

  get stateLabel() {
    const labels = {
      open: this.i18n.prStateOpen,
      merged: this.i18n.prStateMerged,
      closed: this.i18n.prStateClosed,
    };
    return labels[lookupState(this.pr)];
  }

  get statePillClass() {
    const hues = { open: "info", merged: "success", closed: "unknown" };
    return `hardis-pill hardis-status-${hues[lookupState(this.pr)]}`;
  }

  get hasMergeConflicts() {
    return (
      lookupState(this.pr) === "open" && this.pr.mergeStatus === "conflicts"
    );
  }

  get authorLabel() {
    return this.pr.authorLabel || "";
  }

  get authorAvatarClass() {
    return this.pr.authorAvatarClass || "hardis-avatar hardis-avatar-c0";
  }

  get authorInitials() {
    return this.pr.authorInitials || "?";
  }

  get dateLabel() {
    const merged = lookupState(this.pr) === "merged";
    const value = merged
      ? this.pr.mergeDate
      : this.pr.updatedAt || this.pr.createdAt;
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return "";
    }
    const text = date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    return merged
      ? this.t("prViewMergedOn", { date: text })
      : this.t("prViewUpdatedOn", { date: text });
  }

  get webUrl() {
    return safeWebUrl(this.pr.webUrl);
  }

  get openOnPlatformLabel() {
    return this.t("prViewOpenOnPlatform", {
      platform: this.platformLabel || "Git",
    });
  }

  get hasJourney() {
    // A journey reduced to the validation step says nothing the status pill does not
    return this._journey.length > 1;
  }

  get steps() {
    return this._journey.map((step) => {
      const isValidation = step.kind === "validation";
      const waitingForResults = this.loading && step.state === "unknown";
      let stateLabel = this._stateLabel(step.state);
      if (waitingForResults) {
        stateLabel = this.i18n.loadingLabel;
      } else if (isValidation && step.state === "unknown") {
        // "Not in the pipeline windows" is about a branch, not about a validation
        stateLabel = this.i18n.jobStatusUnknown;
      }
      return {
        key: step.key,
        label: isValidation ? this.i18n.journeyValidation : step.branch,
        isBranch: step.kind === "branch",
        stateLabel,
        pillClass: journeyPillClass(step.state),
        carriedBy: step.carriedBy,
        carriedByLabel: step.carriedBy
          ? this.t("journeyCarriedBy", { number: step.carriedBy })
          : "",
      };
    });
  }

  handleOpenExternal() {
    if (this.webUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: { url: this.webUrl },
      });
    }
  }

  handleOpenCarrier(event) {
    const prNumber = parseInt(event.currentTarget.dataset.prNumber, 10);
    if (prNumber > 0) {
      this.dispatchEvent(
        new CustomEvent("openpullrequest", { detail: { prNumber } }),
      );
    }
  }

  _stateLabel(state) {
    const labels = {
      waiting: this.i18n.journeyWaiting,
      running: this.i18n.jobStatusRunning,
      pending: this.i18n.jobStatusPending,
      success: this.i18n.jobStatusSuccess,
      merged: this.i18n.journeyMerged,
      deployed: this.i18n.journeyDeployed,
      failed: this.i18n.jobStatusFailed,
      unknown: this.i18n.journeyUnknown,
    };
    return labels[state] || labels.unknown;
  }
}
