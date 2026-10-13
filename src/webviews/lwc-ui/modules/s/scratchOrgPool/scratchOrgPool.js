/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getAvatarClass, getInitials } from "s/avatarUtils";

/**
 * Scratch Org Pool panel.
 *
 * It draws the `pool` answered by `sf hardis:scratch:pool:view --json` as the extension
 * sends it, and launches the pool commands in the command runner. Nothing is read from
 * the pool storage here, and the encryption key never comes to this component: only its
 * status does.
 */

// The only commands the panel launches
const TAKE_COMMAND = "sf hardis:scratch:create";
const REFILL_COMMAND = "sf hardis:scratch:pool:refresh --agent";
const RESET_COMMAND = "sf hardis:scratch:pool:reset --agent";
const CREATE_POOL_COMMAND = "sf hardis:scratch:pool:create";

// The only storage that records who took a scratch org, the failures and the refills
const STORAGE_WITH_HISTORY = "gitProvider";

const STORAGE_LABEL_KEYS = {
  gitProvider: "scratchOrgPoolStorageGitProvider",
  salesforce: "scratchOrgPoolStorageSalesforce",
};

// Status of the encryption key given by sfdx-hardis, and how its card shows it
const KEY_STATES = {
  ok: { state: "ok", hue: "green", descKey: "scratchOrgPoolKeyOk" },
  missing: {
    state: "error",
    hue: "red",
    descKey: "scratchOrgPoolKeyMissing",
  },
  mismatch: {
    state: "error",
    hue: "red",
    descKey: "scratchOrgPoolKeyMismatch",
  },
};

export default class ScratchOrgPool extends SharedMixin(LightningElement) {
  loading = true;
  pool = null;
  readAt = null;
  minimalCliVersion = "";
  error = null;
  showResetModal = false;
  // Everything the template iterates on, rebuilt when the pool changes
  @track view = {
    statusCards: [],
    orgRows: [],
    historyRows: [],
    failures: [],
    actionCards: [],
  };

  @api
  initialize(data) {
    this.applyState(data || {});
  }

  @api
  handleMessage(type, data) {
    if (type === "state") {
      this.applyState(data || {});
    }
  }

  // --- Header ---

  get subtitle() {
    if (!this.pool) {
      return this.i18n.scratchOrgPoolSubtitleEmpty;
    }
    return this.t("scratchOrgPoolSubtitle", {
      available: this.pool.available,
      max: this.pool.max,
      storage: this.storageLabel,
    });
  }

  get storageLabel() {
    const storage = (this.pool && this.pool.storageService) || "";
    const labelKey = STORAGE_LABEL_KEYS[storage];
    return labelKey ? this.i18n[labelKey] : storage;
  }

  get hasDashboard() {
    return !!(this.pool && this.pool.dashboardUrl);
  }

  get refreshDisabled() {
    return this.loading;
  }

  // --- States ---

  get hasPool() {
    return !!this.pool;
  }

  // First reading: nothing to show yet
  get showLoading() {
    return this.loading && !this.hasPool;
  }

  // The last result is on screen while sfdx-hardis reads the pool again
  get isRefreshing() {
    return this.loading && this.hasPool;
  }

  get refreshingText() {
    const date = this.formatDateTime(this.readAt);
    return date
      ? this.t("scratchOrgPoolRefreshing", { date })
      : this.i18n.scratchOrgPoolLoading;
  }

  get hasPanelError() {
    return !this.loading && !!this.error;
  }

  get showNoGitProvider() {
    return this.hasPanelError && this.error.kind === "noGitProvider";
  }

  get showNoPool() {
    return this.hasPanelError && this.error.kind === "noPool";
  }

  get showCliTooOld() {
    return this.hasPanelError && this.error.kind === "cliTooOld";
  }

  get showOtherError() {
    return this.hasPanelError && this.error.kind === "other";
  }

  get errorMessage() {
    return (this.error && this.error.message) || "";
  }

  get hasErrorMessage() {
    return this.errorMessage !== "";
  }

  get cliTooOldDescription() {
    return this.t("scratchOrgPoolOldCliDesc", {
      version: this.minimalCliVersion,
    });
  }

  // --- Content ---

  // History, failures and refills are only recorded by a pool stored in the git provider
  get recordsHistory() {
    return !!this.pool && this.pool.storageService === STORAGE_WITH_HISTORY;
  }

  get hasOrgs() {
    return this.view.orgRows.length > 0;
  }

  get hasHistory() {
    return this.view.historyRows.length > 0;
  }

  get hasFailures() {
    return this.view.failures.length > 0;
  }

  get orgColumns() {
    return [
      {
        label: this.i18n.scratchOrgPoolAliasColumn,
        fieldName: "alias",
        type: "branchChip",
      },
      {
        label: this.i18n.usernameLabel,
        fieldName: "username",
        type: "text",
      },
      {
        label: this.i18n.scratchOrgPoolCreatedColumn,
        fieldName: "createdLabel",
        type: "text",
        initialWidth: 140,
        cellAttributes: { class: "hardis-date-cell" },
      },
      {
        label: this.i18n.scratchOrgPoolExpiresColumn,
        fieldName: "expiresLabel",
        type: "text",
        initialWidth: 140,
        cellAttributes: { class: "hardis-date-cell" },
      },
      {
        label: this.i18n.scratchOrgPoolDaysLeftColumn,
        fieldName: "daysLeft",
        type: "number",
        initialWidth: 120,
        cellAttributes: { alignment: "left" },
      },
    ];
  }

  get historyColumns() {
    return [
      {
        label: this.i18n.scratchOrgPoolDateColumn,
        fieldName: "dateLabel",
        type: "text",
        initialWidth: 160,
        cellAttributes: { class: "hardis-date-cell" },
      },
      {
        label: this.i18n.scratchOrgPoolScratchOrgColumn,
        fieldName: "alias",
        type: "branchChip",
        initialWidth: 240,
      },
      {
        label: this.i18n.scratchOrgPoolTakenByColumn,
        fieldName: "by",
        type: "avatarText",
        initialWidth: 160,
        typeAttributes: {
          initials: { fieldName: "byInitials" },
          avatarClass: { fieldName: "byAvatarClass" },
        },
      },
      {
        label: this.i18n.scratchOrgPoolBranchColumn,
        fieldName: "branch",
        type: "branchChip",
      },
      {
        label: this.i18n.scratchOrgPoolPullRequestColumn,
        fieldName: "pullRequest",
        type: "text",
        initialWidth: 140,
      },
      {
        label: this.i18n.scratchOrgPoolJobColumn,
        fieldName: "jobLabel",
        type: "button",
        initialWidth: 110,
        typeAttributes: {
          label: { fieldName: "jobLabel" },
          name: "openJob",
          variant: "base",
          disabled: { fieldName: "jobDisabled" },
        },
      },
    ];
  }

  // --- Handlers ---

  handleRefresh() {
    this.requestLoad();
  }

  handleRetry() {
    this.requestLoad();
  }

  handleOpenDashboard() {
    this.openExternal(this.pool && this.pool.dashboardUrl);
  }

  handleConnectToGit() {
    window.sendMessageToVSCode({ type: "connectToGit", data: {} });
  }

  handleOpenSetup() {
    window.sendMessageToVSCode({
      type: "runVsCodeCommand",
      data: { command: "vscode-sfdx-hardis.showSetup" },
    });
  }

  // A status card either opens a CI job or asks the extension for the encryption key
  handleStatusAction(event) {
    const dataset = event.currentTarget.dataset;
    if (dataset.action === "setKey") {
      this.requestEncryptionKey();
    } else if (dataset.action === "openJob") {
      this.openExternal(dataset.url);
    }
  }

  handleAction(event) {
    const action = event.currentTarget.dataset.action;
    if (action === "take") {
      this.runCommand(TAKE_COMMAND);
    } else if (action === "refill") {
      this.runCommand(REFILL_COMMAND);
    } else if (action === "reset") {
      // Never on a pool read earlier: it may be another pool by now, or no pool at all
      this.showResetModal = !this.loading;
    } else if (action === "setKey") {
      this.requestEncryptionKey();
    } else if (action === "createPool") {
      this.runCommand(CREATE_POOL_COMMAND);
    }
  }

  handleCardKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  handleResetCancel() {
    this.showResetModal = false;
  }

  handleResetConfirm() {
    this.showResetModal = false;
    if (!this.loading) {
      this.runCommand(RESET_COMMAND);
    }
  }

  handleHistoryRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    if (action && row && action.name === "openJob") {
      this.openExternal(row.jobUrl);
    }
  }

  handleOpenFailureJob(event) {
    this.openExternal(event.currentTarget.dataset.url);
  }

  // --- State ---

  // jscpd:ignore-start
  applyState(data) {
    if (Object.prototype.hasOwnProperty.call(data, "loading")) {
      this.loading = data.loading === true;
    }
    if (Object.prototype.hasOwnProperty.call(data, "minimalCliVersion")) {
      this.minimalCliVersion = data.minimalCliVersion || "";
    }
    if (Object.prototype.hasOwnProperty.call(data, "error")) {
      this.error = data.error || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "readAt")) {
      this.readAt = data.readAt || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "pool")) {
      this.pool = data.pool || null;
    }
    // jscpd:ignore-end
    // The cards depend on the loading state too: Reset waits for the fresh answer
    if (
      Object.prototype.hasOwnProperty.call(data, "pool") ||
      Object.prototype.hasOwnProperty.call(data, "loading")
    ) {
      if (this.loading) {
        this.showResetModal = false;
      }
      this.rebuildView();
    }
  }

  requestLoad() {
    this.loading = true;
    this.error = null;
    window.sendMessageToVSCode({ type: "loadScratchOrgPool", data: {} });
  }

  // The extension asks the key in a VS Code password box: it never comes through here
  requestEncryptionKey() {
    window.sendMessageToVSCode({ type: "setPoolEncryptionKey", data: {} });
  }

  runCommand(command) {
    window.sendMessageToVSCode({ type: "runCommand", data: { command } });
  }

  rebuildView() {
    const pool = this.pool;
    if (!pool) {
      this.view = {
        statusCards: [],
        orgRows: [],
        historyRows: [],
        failures: [],
        actionCards: [],
      };
      return;
    }
    this.view = {
      statusCards: this.buildStatusCards(pool),
      orgRows: (pool.orgs || []).map((org, index) => ({
        key: `${org.username}-${index}`,
        alias: org.alias,
        username: org.username,
        createdLabel: this.formatDate(org.createdDate),
        expiresLabel: this.formatDate(org.expirationDate),
        daysLeft: org.daysLeft,
      })),
      historyRows: (pool.history || []).map((taken, index) => {
        const by = String(taken.by || "");
        return {
          key: `${taken.date}-${index}`,
          dateLabel: this.formatDateTime(taken.date),
          alias: taken.alias,
          by,
          byInitials: getInitials(by) || "?",
          byAvatarClass: getAvatarClass(by),
          branch: taken.branch,
          pullRequest: taken.pullRequest,
          jobUrl: taken.jobUrl,
          jobLabel: taken.jobUrl ? this.i18n.scratchOrgPoolOpenJob : "",
          jobDisabled: !taken.jobUrl,
        };
      }),
      failures: (pool.failures || []).map((failure, index) => ({
        key: `${failure.date}-${index}`,
        dateLabel: this.formatDateTime(failure.date),
        error: failure.error,
        jobUrl: failure.jobUrl,
        hasJob: !!failure.jobUrl,
      })),
      actionCards: this.buildActionCards(pool),
    };
  }

  buildStatusCards(pool) {
    const cards = [this.buildHealthCard(pool), this.buildLastRefreshCard(pool)];
    const keyState = KEY_STATES[pool.keyStatus];
    if (keyState) {
      cards.push({
        key: "encryptionKey",
        cardClass: `hardis-status-card ${keyState.state}`,
        tileClass: `hardis-tile ${keyState.hue}`,
        icon: "utility:key",
        title: this.i18n.scratchOrgPoolKeyTitle,
        lines: [{ key: "status", text: this.i18n[keyState.descKey] }],
        hasAction: pool.keyStatus !== "ok",
        action: "setKey",
        actionLabel: this.i18n.scratchOrgPoolSetKey,
        actionClass: "hardis-btn-tinted-amber",
      });
    }
    cards.push(this.buildDevHubLimitsCard(pool));
    return cards;
  }

  // Enough scratch orgs when at least half of the maximum is available, none is an error
  buildHealthCard(pool) {
    const counts = { available: pool.available, max: pool.max };
    let state = "ok";
    let hue = "green";
    let icon = "utility:success";
    let text = this.t("scratchOrgPoolHealthOk", counts);
    if (pool.available <= 0) {
      state = "error";
      hue = "red";
      icon = "utility:error";
      text = this.i18n.scratchOrgPoolHealthEmpty;
    } else if (pool.available * 2 < pool.max) {
      state = "warning";
      hue = "amber";
      icon = "utility:warning";
      text = this.t("scratchOrgPoolHealthLow", counts);
    }
    return {
      key: "health",
      cardClass: `hardis-status-card ${state}`,
      tileClass: `hardis-tile ${hue}`,
      icon,
      title: this.i18n.scratchOrgPoolHealthTitle,
      lines: [{ key: "health", text }],
      hasAction: false,
    };
  }

  buildLastRefreshCard(pool) {
    const lastRefresh = pool.lastRefresh;
    let text = this.i18n.scratchOrgPoolNotRecorded;
    if (this.recordsHistory) {
      text =
        this.formatDateTime(lastRefresh && lastRefresh.date) ||
        this.i18n.scratchOrgPoolLastRefreshNever;
    }
    const jobUrl =
      (this.recordsHistory && lastRefresh && lastRefresh.jobUrl) || "";
    return {
      key: "lastRefresh",
      cardClass: "hardis-status-card info",
      tileClass: "hardis-tile cyan",
      icon: "utility:sync",
      title: this.i18n.scratchOrgPoolLastRefreshTitle,
      lines: [{ key: "date", text }],
      hasAction: !!jobUrl,
      action: "openJob",
      actionUrl: jobUrl,
      actionLabel: this.i18n.scratchOrgPoolOpenJob,
      actionClass: "",
    };
  }

  buildDevHubLimitsCard(pool) {
    const limits = pool.devHubLimits;
    return {
      key: "devHubLimits",
      cardClass: "hardis-status-card info",
      tileClass: "hardis-tile indigo",
      icon: "utility:salesforce1",
      title: this.i18n.scratchOrgPoolDevHubLimitsTitle,
      lines: limits
        ? [
            {
              key: "active",
              text: this.t(
                "scratchOrgPoolDevHubActive",
                limits.activeScratchOrgs,
              ),
            },
            {
              key: "daily",
              text: this.t(
                "scratchOrgPoolDevHubDaily",
                limits.dailyScratchOrgs,
              ),
            },
          ]
        : [{ key: "unknown", text: this.i18n.scratchOrgPoolDevHubUnknown }],
      hasAction: false,
    };
  }

  buildActionCards(pool) {
    // While the pool on screen is the last one kept, the card that deletes it is off
    const resetDisabled = this.loading;
    const cards = [
      {
        key: "take",
        tileClass: "hardis-tile small green",
        icon: "utility:download",
        title: this.i18n.scratchOrgPoolTake,
        description: pool.canTake
          ? this.i18n.scratchOrgPoolTakeDesc
          : this.i18n.scratchOrgPoolTakeDescNew,
      },
      {
        key: "refill",
        tileClass: "hardis-tile small cyan",
        icon: "utility:add",
        title: this.i18n.scratchOrgPoolRefill,
        description: this.i18n.scratchOrgPoolRefillDesc,
      },
      {
        key: "reset",
        tileClass: "hardis-tile small red",
        icon: "utility:delete",
        title: this.i18n.scratchOrgPoolReset,
        description: this.i18n.scratchOrgPoolResetDesc,
        disabled: resetDisabled,
      },
    ];
    if (KEY_STATES[pool.keyStatus]) {
      cards.push({
        key: "setKey",
        tileClass: "hardis-tile small amber",
        icon: "utility:key",
        title: this.i18n.scratchOrgPoolSetKey,
        description: this.i18n.scratchOrgPoolSetKeyDesc,
      });
    }
    return cards.map((card) => ({
      ...card,
      cardClass: card.disabled
        ? "hardis-card disabled"
        : "hardis-card clickable",
      tabIndex: card.disabled ? "-1" : "0",
      ariaDisabled: card.disabled ? "true" : "false",
    }));
  }

  // --- Opening links: only http(s) addresses leave the panel ---

  openExternal(url) {
    const safeUrl = httpUrl(url);
    if (safeUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: { url: safeUrl },
      });
    }
  }

  // --- Formatting ---

  formatDate(value) {
    return formatPoolDate(value, this.locale, false);
  }

  formatDateTime(value) {
    return formatPoolDate(value, this.locale, true);
  }
}

// A date of the pool in the language of the panel. A day without a time ("2026-10-24", the
// expiration of a scratch org) is that day everywhere: it is written as it is, where reading
// it as a moment would show the day before west of UTC. A moment is written in the time zone
// of the user, with its time when withTime is true.
function formatPoolDate(value, locale, withTime) {
  const text = typeof value === "string" ? value.trim() : "";
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const time = day
    ? Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : Date.parse(text);
  if (!Number.isFinite(time)) {
    return "";
  }
  const options = { dateStyle: "medium" };
  if (day) {
    options.timeZone = "UTC";
  } else if (withTime) {
    options.timeStyle = "short";
  }
  try {
    return new Intl.DateTimeFormat(locale, options).format(new Date(time));
  } catch (e) {
    return new Date(time).toISOString().slice(0, 10);
  }
}

// The address when it is an http(s) one, else an empty string
function httpUrl(value) {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\/\S+$/i.test(url) ? url : "";
}
