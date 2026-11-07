/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { formatShortDate } from "s/dateUtils";
import { SharedMixin } from "s/sharedMixin";

/**
 * Details window of a development org of the DevOps Pipeline (a developer sandbox or a scratch
 * org registered by sfdx-hardis). Driven by its props, it only raises events: the pipeline sends
 * the matching messages to the extension, which runs sfdx-hardis.
 *
 * Events: close, refresh, backpromote, save ({ orgId, targetBranch, owner, users }),
 * remove ({ orgId }).
 */
export default class DevOrgDetails extends SharedMixin(LightningElement) {
  // The org, as sf hardis:project:dev-org:list describes it (sanitized by the extension)
  @api devOrg = null;
  // Major branches of the pipeline: the target branches the Edit form offers
  @api majorBranches = [];
  // Username of the org among the orgs authenticated on this computer, null when it is not one
  @api connectedUsername = null;
  // The authenticated orgs were looked through (the Backpromote button waits for it)
  @api connectionChecked = false;
  // sfdx-hardis lists again the merged Pull Requests
  @api refreshing = false;
  // Days without activity after which an org is stale (devOrgsStaleDays)
  @api staleDays = 0;

  // "view", "edit" or "confirmRemove"
  @track mode = "view";
  @track editTargetBranch = "";
  @track editOwner = "";
  @track editUsers = "";

  // ---- Header ----

  get title() {
    return this.devOrg?.name || "";
  }

  get subtitle() {
    return this.t("devOrgDetailsSubtitle", {
      type: this.typeLabel,
      branch: this.devOrg?.targetBranch || "",
    });
  }

  get typeLabel() {
    const type = this.devOrg?.orgType;
    if (type === "scratch") {
      return this.i18n.devOrgTypeScratch;
    }
    if (type === "developer") {
      return this.i18n.devOrgTypeDeveloper;
    }
    return this.i18n.devOrgTypeSandbox;
  }

  get isViewMode() {
    return this.mode === "view";
  }

  get isEditMode() {
    return this.mode === "edit";
  }

  get isConfirmRemoveMode() {
    return this.mode === "confirmRemove";
  }

  get isStale() {
    return this.devOrg?.stale === true;
  }

  get staleBadgeLabel() {
    return this.staleDays > 0
      ? this.t("devOrgStaleBadge", { days: this.staleDays })
      : this.i18n.devOrgStaleBadgeShort;
  }

  get isMine() {
    return this.devOrg?.isMine === true;
  }

  // ---- Properties ----

  get targetBranch() {
    return this.devOrg?.targetBranch || "";
  }

  get instanceUrl() {
    return this.devOrg?.instanceUrl || "";
  }

  get hasInstanceUrl() {
    return !!this.instanceUrl;
  }

  get ownerLabel() {
    return this._formatPerson(this.devOrg?.owner) || this.i18n.devOrgNotSet;
  }

  get users() {
    return (this.devOrg?.users || []).map((person) => ({
      key: person.email,
      label: this._formatPerson(person),
    }));
  }

  get hasUsers() {
    return this.users.length > 0;
  }

  get featureBranches() {
    return (this.devOrg?.featureBranches || []).map((branch) => ({
      key: branch.name,
      name: branch.name,
      title: this.t("devOrgFeatureBranchSeen", {
        date: this._formatDate(branch.lastSeen),
      }),
    }));
  }

  get hasFeatureBranches() {
    return this.featureBranches.length > 0;
  }

  get registeredAtLabel() {
    return (
      this._formatDate(this.devOrg?.registeredAt) || this.i18n.devOrgNotSet
    );
  }

  get lastActivityLabel() {
    return (
      this._formatDate(this.devOrg?.lastActivityAt) || this.i18n.devOrgNotSet
    );
  }

  get lastBackpromoteLabel() {
    const last = this.devOrg?.lastBackpromote;
    if (!last || !last.date) {
      return this.i18n.devOrgNever;
    }
    return this.t("devOrgLastBackpromoteValue", {
      date: this._formatDate(last.date),
      branch: last.parentBranch || "",
    });
  }

  get hasExpiration() {
    return !!this.devOrg?.expirationDate;
  }

  get expirationLabel() {
    return this._formatDate(this.devOrg?.expirationDate);
  }

  // ---- Missing Pull Requests ----

  get behindNotComputed() {
    return !this.devOrg?.behind;
  }

  get isUpToDate() {
    const behind = this.devOrg?.behind;
    return !!behind && behind.count === 0 && !behind.cutOff;
  }

  get upToDateLabel() {
    return this.t("devOrgUpToDate", {
      branch: this.devOrg?.targetBranch || "",
    });
  }

  get missingDescription() {
    return this.t("devOrgMissingPullRequestsDesc", {
      branch: this.devOrg?.targetBranch || "",
    });
  }

  get missingCountLabel() {
    const behind = this.devOrg?.behind;
    if (!behind) {
      return "";
    }
    return `${behind.count}${behind.cutOff ? "+" : ""}`;
  }

  get missingPullRequests() {
    const pullRequests = this.devOrg?.behind?.pullRequests || [];
    return pullRequests.map((pullRequest, index) => ({
      key: `${pullRequest.number}-${index}`,
      label: `#${pullRequest.number} ${pullRequest.title || ""}`.trim(),
      url: pullRequest.url,
      mergedLabel: this.t("devOrgMergedOn", {
        date: this._formatDate(pullRequest.mergedAt),
      }),
      sourceBranch: pullRequest.sourceBranch,
      vehicle: pullRequest.vehicle === true,
      hasCarried:
        pullRequest.vehicle === true &&
        Array.isArray(pullRequest.carried) &&
        pullRequest.carried.length > 0,
      carriedNotComputed:
        pullRequest.vehicle === true && !Array.isArray(pullRequest.carried),
      carried: (pullRequest.carried || []).map((carried, carriedIndex) => ({
        key: `${carried.number}-${carriedIndex}`,
        label: `#${carried.number} ${carried.title || ""}`.trim(),
        url: carried.url,
      })),
    }));
  }

  get hasMissingPullRequests() {
    return this.missingPullRequests.length > 0;
  }

  get showCutOff() {
    return this.devOrg?.behind?.cutOff === true;
  }

  get computedAtLabel() {
    const computedAt = this.devOrg?.behind?.computedAt;
    return computedAt
      ? this.t("devOrgBehindComputedAt", { date: this._formatDate(computedAt) })
      : "";
  }

  // ---- Buttons ----

  get backpromoteDisabled() {
    return !this.connectedUsername;
  }

  get backpromoteTitle() {
    if (this.connectedUsername) {
      return this.t("devOrgBackpromoteTitle", {
        branch: this.devOrg?.targetBranch || "",
      });
    }
    return this.connectionChecked
      ? this.i18n.devOrgBackpromoteNotConnected
      : this.i18n.devOrgBackpromoteChecking;
  }

  get refreshLabel() {
    return this.refreshing
      ? this.i18n.devOrgRefreshing
      : this.i18n.devOrgRefresh;
  }

  get removeConfirmLabel() {
    return this.t("devOrgRemoveConfirm", { name: this.title });
  }

  get branchOptions() {
    const branches = [...(this.majorBranches || [])];
    return branches.map((branch) => ({ label: branch, value: branch }));
  }

  get saveDisabled() {
    return !this.editTargetBranch;
  }

  // ---- Handlers ----

  handleClose() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  handleRefresh() {
    if (this.refreshing) {
      return;
    }
    this.dispatchEvent(new CustomEvent("refresh"));
  }

  handleBackpromote() {
    if (!this.connectedUsername) {
      return;
    }
    this.dispatchEvent(new CustomEvent("backpromote"));
  }

  handleEdit() {
    const devOrg = this.devOrg || {};
    this.editTargetBranch = (this.majorBranches || []).includes(
      devOrg.targetBranch,
    )
      ? devOrg.targetBranch
      : "";
    this.editOwner = this._formatPerson(devOrg.owner);
    this.editUsers = (devOrg.users || [])
      .map((person) => this._formatPerson(person))
      .join(", ");
    this.mode = "edit";
  }

  handleTargetBranchChange(event) {
    this.editTargetBranch = event.detail.value;
  }

  handleOwnerChange(event) {
    this.editOwner = event.detail.value;
  }

  handleUsersChange(event) {
    this.editUsers = event.detail.value;
  }

  handleCancel() {
    this.mode = "view";
  }

  handleSave() {
    if (!this.editTargetBranch || !this.devOrg) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("save", {
        detail: {
          orgId: this.devOrg.orgId,
          targetBranch: this.editTargetBranch,
          owner: this.editOwner || "",
          users: this.editUsers || "",
        },
      }),
    );
  }

  handleRemove() {
    this.mode = "confirmRemove";
  }

  handleConfirmRemove() {
    if (!this.devOrg) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("remove", { detail: { orgId: this.devOrg.orgId } }),
    );
  }

  handleOpenUrl(event) {
    event.preventDefault();
    const url = event.currentTarget?.dataset?.url;
    if (url && typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }

  // ---- Private ----

  _formatPerson(person) {
    if (!person || !person.email) {
      return "";
    }
    return person.name && person.name !== person.email
      ? `${person.name} <${person.email}>`
      : person.email;
  }

  _formatDate(value) {
    return formatShortDate(value, this.locale || "en");
  }
}
