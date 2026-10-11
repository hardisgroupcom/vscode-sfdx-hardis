/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { getAvatarClass, getInitials } from "s/avatarUtils";
import { getPillClass } from "s/pillUtils";
import {
  buildPipelineStrip,
  buildSparkline,
  buildWeeklyBarChart,
} from "s/doraChartUtils";

/**
 * DORA metrics panel.
 *
 * It draws the result of `sf hardis:doc:dora-report --data-only --compare --json`
 * as the extension sends it. No metric is computed here: no rating threshold, no
 * average, and no date math beyond formatting. The ratings, the previous values
 * and the "needs attention" messages all come from sfdx-hardis.
 */

const OVERVIEW_TAB = "overview";
const CONTRIBUTORS_TAB = "contributors";
const BRANCH_TAB_PREFIX = "branch:";
// A branch says when its data starts once the git provider kept this many days less than asked
const DATA_START_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000;

// Rating given by sfdx-hardis, and the pill that shows it: the colors are the ones of the
// report (green, blue, yellow, red, white)
const LEVEL_PILLS = {
  elite: { status: "hardis-status-success", labelKey: "doraLevelElite" },
  high: { status: "hardis-status-info", labelKey: "doraLevelHigh" },
  medium: { status: "hardis-status-pending", labelKey: "doraLevelMedium" },
  low: { status: "hardis-status-failed", labelKey: "doraLevelLow" },
  none: { status: "hardis-status-unknown", labelKey: "doraNoData" },
};

const SEVERITY_PILLS = {
  error: { status: "hardis-status-failed", labelKey: "doraSeverityError" },
  warning: { status: "hardis-status-pending", labelKey: "doraSeverityWarning" },
  info: { status: "hardis-status-info", labelKey: "doraSeverityInfo" },
};

// The five metrics, in the order of the report: where sfdx-hardis put the value and the
// previous one, and the unit it is written with
const METRICS = [
  {
    key: "deploymentFrequency",
    labelKey: "doraDeployments",
    value: "perWeek",
    previous: "previousPerWeek",
    unitKey: "doraValuePerWeek",
  },
  {
    key: "leadTime",
    labelKey: "doraLeadTimeMedian",
    value: "medianDays",
    previous: "previousMedianDays",
    unitKey: "doraValueDays",
  },
  {
    key: "changeFailureRate",
    labelKey: "doraFailureRate",
    value: "percent",
    previous: "previousPercent",
    unitKey: "doraValuePercent",
  },
  {
    key: "mttr",
    labelKey: "doraRecoveryMedian",
    value: "medianHours",
    previous: "previousMedianHours",
    unitKey: "doraValueHours",
  },
  {
    key: "reworkRate",
    labelKey: "doraRework",
    value: "percent",
    previous: "previousPercent",
    unitKey: "doraValuePercent",
  },
];

// Time to production is rated and compared like the lead time of a branch
const TIME_TO_PRODUCTION = {
  key: "timeToProduction",
  labelKey: "doraTimeToProduction",
  value: "medianDays",
  previous: "previousMedianDays",
  unitKey: "doraValueDays",
};

export default class DoraMetrics extends SharedMixin(LightningElement) {
  period = 90;
  periods = [30, 90, 180, 365];
  loading = true;
  report = null;
  readAt = null;
  providerLabel = "";
  minimalCliVersion = "";
  error = null;
  activeTab = OVERVIEW_TAB;
  // Collapsible lists the user opened, by "<branch>:<list>"
  openLists = {};
  // Branch of the pipeline flow whose waiting changes are listed
  selectedStage = null;
  // Tab the command that opened the panel asked for, and the one still waiting for its report
  deepLinkTab = null;
  wantedTab = null;
  // Everything the template iterates on, rebuilt when the report changes
  @track view = {
    branches: [],
    contributors: [],
    attention: [],
    pipeline: null,
  };

  @api
  initialize(data) {
    // The panel was opened (again): the tab asked for by the command applies, even the same one
    this.deepLinkTab = null;
    // And so does the branch whose waiting changes it asked to list, or none
    this.selectedStage = (data && data.waiting) || null;
    this.applyState(data || {});
  }

  @api
  handleMessage(type, data) {
    if (type === "state") {
      this.applyState(data || {});
    }
  }

  // --- Header ---

  get periodOptions() {
    return this.periods.map((days) => ({
      label: this.t("doraPeriodDays", { days }),
      value: String(days),
    }));
  }

  get periodValue() {
    return String(this.period);
  }

  // Repository, dates of the period, and the branches whose data starts later than the period
  get metaItems() {
    if (!this.report) {
      return [];
    }
    const items = [];
    const repository = String(this.report.source?.repository || "").replace(
      /\.git$/i,
      "",
    );
    if (repository) {
      items.push({ key: "repository", text: repository });
    }
    const from = this.formatDate(this.report.period?.from);
    const to = this.formatDate(this.report.period?.to);
    if (from && to) {
      items.push({
        key: "period",
        text: this.t("doraPeriodDates", { from, to }),
      });
    }
    const periodStart = Date.parse(this.report.period?.from || "");
    for (const branch of this.report.branches || []) {
      const oldestRun = Date.parse(branch.oldestRunDate || "");
      if (
        Number.isFinite(periodStart) &&
        Number.isFinite(oldestRun) &&
        oldestRun - periodStart > DATA_START_TOLERANCE_MS
      ) {
        items.push({
          key: `start-${branch.name}`,
          text: this.t("doraDataStartsOn", {
            branch: branch.name,
            date: this.formatDate(branch.oldestRunDate),
          }),
        });
      }
    }
    return items;
  }

  get hasMetaItems() {
    return this.metaItems.length > 0;
  }

  // --- States ---

  get hasReport() {
    return !!this.report;
  }

  get hasBranches() {
    return this.view.branches.length > 0;
  }

  // First reading: nothing to show yet
  get showLoading() {
    return this.loading && !this.hasReport;
  }

  // The last result is on screen while sfdx-hardis reads the git provider again
  get isRefreshing() {
    return this.loading && this.hasReport;
  }

  get loadingText() {
    return this.providerLabel
      ? this.t("doraLoadingFrom", { provider: this.providerLabel })
      : this.i18n.doraLoadingGeneric;
  }

  get refreshingText() {
    const date = this.formatDateTime(this.readAt);
    return date
      ? this.t("doraRefreshing", { date })
      : this.i18n.doraLoadingGeneric;
  }

  get refreshDisabled() {
    return this.loading;
  }

  get exportDisabled() {
    return this.showNoGitProvider || this.showOldCli;
  }

  get hasPanelError() {
    return !this.loading && !!this.error;
  }

  get showNoGitProvider() {
    return this.hasPanelError && this.error.kind === "noGitProvider";
  }

  get showOldCli() {
    return this.hasPanelError && this.error.kind === "oldCli";
  }

  get showCliError() {
    return this.hasPanelError && this.error.kind === "cli";
  }

  get errorMessage() {
    return (this.error && this.error.message) || "";
  }

  get oldCliDescription() {
    return this.t("doraOldCliDesc", { version: this.minimalCliVersion });
  }

  get showEmpty() {
    return !this.loading && !this.error && this.hasReport && !this.hasBranches;
  }

  get showContent() {
    return this.hasReport && this.hasBranches;
  }

  // --- Overview ---

  get hasAttention() {
    return this.view.attention.length > 0;
  }

  get attentionTitle() {
    return this.t("doraNeedsAttention", { count: this.view.attention.length });
  }

  get trendColumnLabel() {
    const weeks = this.report?.branches?.[0]?.weeks;
    return this.t("doraWeeksCount", {
      count: Array.isArray(weeks) ? weeks.length : 0,
    });
  }

  // --- Pipeline flow ---

  get hasPipeline() {
    return !!this.view.pipeline;
  }

  get waitingColumns() {
    return [
      this.pullRequestColumn(),
      this.authorColumn(),
      {
        label: this.i18n.doraWaitingSinceColumn,
        fieldName: "sinceLabel",
        type: "text",
        initialWidth: 200,
        cellAttributes: { class: "hardis-date-cell" },
      },
      {
        label: this.i18n.doraWaitingForColumn,
        fieldName: "daysLabel",
        type: "text",
        initialWidth: 130,
      },
    ];
  }

  get slowestColumns() {
    return [
      this.pullRequestColumn(),
      this.authorColumn(),
      {
        label: this.i18n.doraMergedIntoColumn,
        fieldName: "enteredAt",
        type: "branchChip",
        initialWidth: 150,
      },
      {
        label: this.i18n.doraTimeToProduction,
        fieldName: "totalLabel",
        type: "text",
        initialWidth: 160,
      },
      {
        label: this.i18n.doraPathColumn,
        fieldName: "pathLabel",
        type: "text",
        wrapText: true,
      },
    ];
  }

  // --- Contributors ---

  get hasContributors() {
    return this.view.contributors.length > 0;
  }

  get contributorColumns() {
    return [
      {
        label: this.i18n.nameColumn,
        fieldName: "name",
        type: "avatarText",
        typeAttributes: {
          initials: { fieldName: "initials" },
          avatarClass: { fieldName: "avatarClass" },
        },
      },
      {
        label: this.i18n.pullRequests,
        fieldName: "pullRequests",
        type: "number",
        cellAttributes: { alignment: "left" },
      },
      {
        label: this.i18n.doraAvgCycleTimeColumn,
        fieldName: "avgCycleLabel",
        type: "text",
      },
      {
        label: this.i18n.doraDeploymentsTriggeredColumn,
        fieldName: "deploymentsTriggered",
        type: "number",
        cellAttributes: { alignment: "left" },
      },
      {
        label: this.i18n.doraFailedDeploymentsColumn,
        fieldName: "failedDeployments",
        type: "number",
        cellAttributes: { alignment: "left" },
      },
    ];
  }

  // --- Branch tab tables ---

  get failedColumns() {
    return [
      {
        label: this.i18n.doraDateColumn,
        fieldName: "dateLabel",
        type: "text",
        initialWidth: 130,
        cellAttributes: { class: "hardis-date-cell" },
      },
      {
        label: this.i18n.doraJobColumn,
        fieldName: "runName",
        type: "button",
        typeAttributes: {
          label: { fieldName: "runName" },
          name: "openJob",
          variant: "base",
          disabled: { fieldName: "jobDisabled" },
        },
        wrapText: true,
      },
      {
        label: this.i18n.doraTriggeredByColumn,
        fieldName: "triggeredBy",
        type: "avatarText",
        typeAttributes: {
          initials: { fieldName: "triggeredByInitials" },
          avatarClass: { fieldName: "triggeredByAvatarClass" },
        },
      },
      this.pullRequestColumn(),
      {
        label: this.i18n.doraRecoveredInColumn,
        fieldName: "recoveryLabel",
        type: "statusPill",
        initialWidth: 150,
        typeAttributes: {
          label: { fieldName: "recoveryLabel" },
          pillClass: { fieldName: "recoveryPillClass" },
        },
      },
    ];
  }

  get slowColumns() {
    return [
      this.pullRequestColumn(),
      this.authorColumn(),
      {
        label: this.i18n.doraCycleTimeColumn,
        fieldName: "cycleLabel",
        type: "text",
        initialWidth: 140,
      },
    ];
  }

  get hotfixColumns() {
    return [
      this.pullRequestColumn(),
      this.authorColumn(),
      {
        label: this.i18n.doraSourceBranchColumn,
        fieldName: "sourceBranch",
        type: "branchChip",
      },
      {
        label: this.i18n.doraMergedOnColumn,
        fieldName: "mergedLabel",
        type: "text",
        initialWidth: 130,
        cellAttributes: { class: "hardis-date-cell" },
      },
    ];
  }

  // --- Handlers ---

  handlePeriodChange(event) {
    const period = Number(event.detail.value);
    if (!this.periods.includes(period) || period === this.period) {
      return;
    }
    this.period = period;
    this.loading = true;
    window.sendMessageToVSCode({
      type: "loadDoraMetrics",
      data: { period, refresh: false },
    });
  }

  // Reads everything again from the git provider, without the cache of sfdx-hardis
  handleRefresh() {
    this.requestLoad(true);
  }

  handleRetry() {
    this.requestLoad(false);
  }

  handleExportMarkdown() {
    window.sendMessageToVSCode({
      type: "exportDoraReport",
      data: { format: "markdown" },
    });
  }

  handleExportPdf() {
    window.sendMessageToVSCode({
      type: "exportDoraReport",
      data: { format: "pdf" },
    });
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

  handleTabActive(event) {
    const value = event.target && event.target.value;
    if (value) {
      this.activeTab = value;
    }
  }

  // A row of the overview opens the tab of its branch
  handleOpenBranch(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab) {
      this.activeTab = tab;
    }
  }

  handleBranchRowKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.handleOpenBranch(event);
    }
  }

  // A branch of the pipeline flow lists what is waiting in it, a second click closes the list
  handleSelectStage(event) {
    const branch = event.currentTarget.dataset.branch;
    if (!branch) {
      return;
    }
    this.selectedStage = this.selectedStage === branch ? null : branch;
    this.rebuildView();
  }

  handleOpenAttention(event) {
    this.openExternal(event.currentTarget.dataset.url);
  }

  handleFailedRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    if (!action || !row) {
      return;
    }
    if (action.name === "openJob") {
      this.openExternal(row.runUrl);
    } else if (action.name === "openPullRequest") {
      this.openPullRequest(row.pullRequestUrl);
    }
  }

  handlePullRequestRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    if (action && row && action.name === "openPullRequest") {
      this.openPullRequest(row.pullRequestUrl);
    }
  }

  handleToggleList(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this.openLists = { ...this.openLists, [key]: !this.openLists[key] };
    this.rebuildView();
  }

  // --- State ---

  applyState(data) {
    if (Object.prototype.hasOwnProperty.call(data, "period")) {
      this.period = Number(data.period) || this.period;
    }
    if (Array.isArray(data.periods) && data.periods.length > 0) {
      this.periods = data.periods.map(Number);
    }
    if (Object.prototype.hasOwnProperty.call(data, "loading")) {
      this.loading = data.loading === true;
    }
    if (Object.prototype.hasOwnProperty.call(data, "providerLabel")) {
      this.providerLabel = data.providerLabel || "";
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
    if (data.tab && data.tab !== this.deepLinkTab) {
      this.deepLinkTab = data.tab;
      this.wantedTab =
        data.tab === OVERVIEW_TAB || data.tab === CONTRIBUTORS_TAB
          ? data.tab
          : BRANCH_TAB_PREFIX + data.tab;
    }
    if (Object.prototype.hasOwnProperty.call(data, "report")) {
      this.report = data.report || null;
      this.rebuildView();
    } else {
      this.applyWantedTab(this.view.branches);
    }
  }

  requestLoad(refresh) {
    this.loading = true;
    this.error = null;
    window.sendMessageToVSCode({
      type: "loadDoraMetrics",
      data: { period: this.period, refresh },
    });
  }

  rebuildView() {
    const branches = (this.report?.branches || []).map((branch) =>
      this.buildBranchView(branch),
    );
    this.applyWantedTab(branches);
    this.view = {
      branches,
      pipeline: this.buildPipelineView(this.report?.pipeline),
      // Every item of every branch, each one named by its branch
      attention: branches.flatMap((branch) =>
        branch.attention.map((item) => ({
          ...item,
          key: `${branch.name}-${item.key}`,
          pillLabel: branch.name,
        })),
      ),
      contributors: (this.report?.contributors || []).map(
        (contributor, index) => {
          const name = String(contributor.name || "");
          return {
            key: `${name}-${index}`,
            name,
            initials: getInitials(name) || "?",
            avatarClass: getAvatarClass(name),
            pullRequests: contributor.pullRequests,
            avgCycleLabel: this.formatUnit(
              "doraValueDays",
              contributor.avgCycleDays,
            ),
            deploymentsTriggered: contributor.deploymentsTriggered,
            failedDeployments: contributor.failedDeployments,
          };
        },
      ),
    };
  }

  // Opens the tab the command asked for once the report holds it, and leaves a tab of a
  // branch the new report does not hold any more
  applyWantedTab(branches) {
    const tabs = [
      OVERVIEW_TAB,
      CONTRIBUTORS_TAB,
      ...branches.map((branch) => branch.tabValue),
    ];
    if (this.wantedTab && tabs.includes(this.wantedTab)) {
      this.activeTab = this.wantedTab;
      this.wantedTab = null;
    }
    if (!tabs.includes(this.activeTab)) {
      this.activeTab = OVERVIEW_TAB;
    }
  }

  buildBranchView(branch) {
    const name = String(branch.name || "");
    const weeks = Array.isArray(branch.weeks) ? branch.weeks : [];
    // The lead time of the changes that reached the branch, when sfdx-hardis followed them
    // through the pipeline: the one of the Pull Requests of the branch is then a detail line
    const changeLeadTime = isNumber(branch.metrics?.changeLeadTime?.medianDays)
      ? branch.metrics.changeLeadTime
      : null;
    const metrics = METRICS.map((metric) => {
      if (metric.key !== "leadTime" || !changeLeadTime) {
        return this.buildMetricView(metric, branch.metrics?.[metric.key] || {});
      }
      const pullRequestDays = branch.metrics?.leadTime?.medianDays;
      return {
        ...this.buildMetricView(metric, changeLeadTime),
        hasDetail: isNumber(pullRequestDays),
        detailText: this.t("doraPullRequestLeadTime", {
          value: this.formatUnit(metric.unitKey, pullRequestDays),
        }),
      };
    });
    const chart = buildWeeklyBarChart(weeks);
    const sparkline = buildSparkline(weeks.map((week) => week.succeeded));
    const failedRows = (branch.failedDeployments || []).map((failed, index) =>
      this.buildFailedRow(failed, index),
    );
    const slowRows = (branch.slowPullRequests || []).map((pr, index) => ({
      ...this.pullRequestFields(pr),
      key: `slow-${index}`,
      cycleLabel: this.formatUnit("doraValueDays", pr.cycleDays),
    }));
    const hotfixRows = (branch.hotfixPullRequests || []).map((pr, index) => ({
      ...this.pullRequestFields(pr),
      key: `hotfix-${index}`,
      sourceBranch: pr.sourceBranch || "",
      mergedLabel: this.formatDate(pr.mergedDate),
    }));
    const attention = (branch.attention || []).map((item, index) => {
      const severity = SEVERITY_PILLS[item.severity] || SEVERITY_PILLS.info;
      const url = httpUrl(item.url);
      return {
        key: `${item.code || "item"}-${index}`,
        pillClass: `hardis-pill ${severity.status}`,
        pillLabel: this.i18n[severity.labelKey],
        // Translated by sfdx-hardis: bound as text, never as HTML
        message: String(item.message || ""),
        url,
        hasUrl: url !== "",
      };
    });
    const slowKey = `${name}:slow`;
    const hotfixKey = `${name}:hotfix`;
    const slowOpen = slowRows.length > 0 && this.openLists[slowKey] === true;
    const hotfixOpen =
      hotfixRows.length > 0 && this.openLists[hotfixKey] === true;
    return {
      key: name,
      name,
      tabValue: BRANCH_TAB_PREFIX + name,
      tabLabel: branch.isProduction
        ? this.t("doraBranchProduction", { branch: name })
        : name,
      isProduction: branch.isProduction === true,
      productionPillClass: getPillClass("violet"),
      rowLabel: this.t("doraOpenBranchTab", { branch: name }),
      metrics,
      frequency: metrics[0],
      otherMetrics: metrics.slice(1),
      sparkline: {
        ...sparkline,
        lineClass: sparkline.isEmpty
          ? "dora-sparkline-line dora-sparkline-empty"
          : "dora-sparkline-line",
        hasLastPoint: !!sparkline.last && !sparkline.isEmpty,
        lastX: sparkline.last ? sparkline.last.x : 0,
        lastY: sparkline.last ? sparkline.last.y : 0,
        title: weeks.map((week) => Number(week.succeeded) || 0).join(" "),
      },
      attention,
      hasAttention: attention.length > 0,
      attentionTitle: this.t("doraNeedsAttention", {
        count: attention.length,
      }),
      chart: {
        ...chart,
        bars: chart.bars.map((bar) => ({
          ...bar,
          title: this.t("doraWeekBarTitle", {
            week: bar.week,
            succeeded: bar.succeeded,
            failed: bar.failed,
          }),
        })),
        gridLines: chart.yTicks.map((tick) => ({ key: tick.key, y: tick.y })),
        label: this.i18n.doraDeploymentsPerWeek,
      },
      failedRows,
      hasFailed: failedRows.length > 0,
      failedTitle: this.t("doraFailedDeployments", {
        count: failedRows.length,
      }),
      supplementary: this.buildSupplementary(branch),
      slowRows,
      slowTitle: this.t("doraSlowPullRequests", { count: slowRows.length }),
      slowKey,
      slowDisabled: slowRows.length === 0,
      slowOpen: slowOpen,
      slowIcon: toggleIcon(slowOpen),
      hotfixRows,
      hotfixTitle: this.t("doraHotfixPullRequests", {
        count: hotfixRows.length,
      }),
      hotfixKey,
      hotfixDisabled: hotfixRows.length === 0,
      hotfixOpen: hotfixOpen,
      hotfixIcon: toggleIcon(hotfixOpen),
    };
  }

  // The pipeline flow of the overview: each branch with what is waiting in it, the wait
  // between two branches, the time to production and the changes that took the longest
  buildPipelineView(pipeline) {
    const strip = buildPipelineStrip(pipeline);
    if (strip.items.length === 0) {
      return null;
    }
    const bottleneck = pipeline.bottleneck || {};
    const stepView = (step, index) => {
      const route = this.t("doraStepRoute", { from: step.from, to: step.to });
      const viaPromotion = Number(step.viaPromotion) || 0;
      return {
        key: `step-${index}-${step.from}-${step.to}`,
        isStep: true,
        route,
        hasWait: isNumber(step.waitDays?.median),
        waitText: this.formatUnit("doraValueDays", step.waitDays?.median),
        changesText: this.t("doraStepChanges", {
          count: this.formatNumber(step.changes),
        }),
        hasPromotion: viaPromotion > 0,
        promotionText: this.t("doraStepViaPromotion", {
          count: this.formatNumber(viaPromotion),
        }),
        isBottleneck:
          step.from === bottleneck.from && step.to === bottleneck.to,
        title: isNumber(step.previousMedianDays)
          ? `${route} - ${this.t("doraPreviousPeriod", {
              value: this.formatUnit("doraValueDays", step.previousMedianDays),
            })}`
          : route,
      };
    };
    let selected = null;
    const items = strip.items.map((item, index) => {
      if (item.kind === "step") {
        return stepView(item.step, index);
      }
      const stage = item.stage;
      const branch = String(stage.branch || "");
      const waiting = stage.waiting || {};
      const count = Number(waiting.count) || 0;
      const isSelected = count > 0 && this.selectedStage === branch;
      if (isSelected) {
        selected = stage;
      }
      return {
        key: `stage-${branch}`,
        isStage: true,
        branch,
        isProduction: stage.isProduction === true,
        hasWaiting: count > 0,
        waitingText:
          count > 0
            ? this.t("doraWaitingCount", { count: this.formatNumber(count) })
            : this.i18n.doraNothingWaiting,
        oldestText: this.t("doraOldestWaiting", {
          value: this.formatUnit("doraValueDays", waiting.oldestDays),
        }),
        disabled: count === 0,
        selected: isSelected,
        className: isSelected ? "dora-stage dora-stage-selected" : "dora-stage",
        title:
          count > 0
            ? this.t("doraShowWaiting", { branch })
            : this.i18n.doraNothingWaiting,
      };
    });

    const waitingRows = selected
      ? (selected.waiting.changes || []).map((change, index) => ({
          ...this.pullRequestFields(change),
          key: `waiting-${index}`,
          sinceLabel: this.formatDate(change.since),
          daysLabel: this.formatUnit("doraValueDays", change.days),
        }))
      : [];
    const slowestRows = (pipeline.slowestChanges || []).map(
      (change, index) => ({
        ...this.pullRequestFields(change),
        key: `slowest-${index}`,
        enteredAt: change.enteredAt || "",
        totalLabel: this.formatUnit("doraValueDays", change.totalDays),
        pathLabel: (change.stages || [])
          .map(
            (stage) =>
              `${stage.branch} ${this.formatDate(stage.deployedAt || stage.arrivedAt)}`,
          )
          .join(" → "),
      }),
    );
    const slowestKey = "pipeline:slowest";
    const slowestOpen =
      slowestRows.length > 0 && this.openLists[slowestKey] === true;
    const toProduction = pipeline.timeToProduction;
    const untraced = Number(pipeline.untraced) || 0;
    return {
      items,
      otherSteps: strip.otherSteps.map((step, index) =>
        stepView(step, `other-${index}`),
      ),
      hasOtherSteps: strip.otherSteps.length > 0,
      hasTotal: !!toProduction,
      total: toProduction
        ? {
            ...this.buildMetricView(TIME_TO_PRODUCTION, toProduction),
            changesText: this.t("doraChangesDelivered", {
              count: this.formatNumber(toProduction.changes),
            }),
          }
        : null,
      hasSelected: !!selected,
      selectedTitle: selected
        ? this.t("doraWaitingIn", {
            branch: selected.branch,
            count: this.formatNumber(selected.waiting.count),
          })
        : "",
      // sfdx-hardis lists the oldest ones only
      selectedLimited: selected
        ? selected.waiting.count > waitingRows.length
        : false,
      selectedLimitedText: this.t("doraWaitingListLimited", {
        count: this.formatNumber(waitingRows.length),
      }),
      waitingRows,
      slowestRows,
      slowestTitle: this.t("doraSlowestChanges", { count: slowestRows.length }),
      slowestKey,
      slowestDisabled: slowestRows.length === 0,
      slowestOpen,
      slowestIcon: toggleIcon(slowestOpen),
      hasUntraced: untraced > 0,
      untracedText: this.t("doraUntracedChanges", {
        count: this.formatNumber(untraced),
      }),
    };
  }

  // One metric of a branch: its value with its unit, the rating sfdx-hardis gave it, and the
  // value of the previous period when sfdx-hardis compared
  buildMetricView(metric, data) {
    const level = LEVEL_PILLS[data.level] ? data.level : "none";
    const pill = LEVEL_PILLS[level];
    const value = data[metric.value];
    const previous = data[metric.previous];
    const hasValue = level !== "none" && isNumber(value);
    const hasPrevious = isNumber(previous);
    const previousText = hasPrevious
      ? this.t("doraPreviousPeriod", {
          value: this.formatUnit(metric.unitKey, previous),
        })
      : "";
    // Up, down or unchanged since the previous period: a direction, not a judgement
    let trendIcon = "";
    if (hasValue && hasPrevious) {
      trendIcon = "utility:dash";
      if (value !== previous) {
        trendIcon = value > previous ? "utility:arrowup" : "utility:arrowdown";
      }
    }
    return {
      key: metric.key,
      label: this.i18n[metric.labelKey],
      hasValue,
      valueText: hasValue ? this.formatUnit(metric.unitKey, value) : "",
      pillClass: `hardis-pill ${pill.status}`,
      levelLabel: this.i18n[pill.labelKey],
      hasPrevious,
      previousText,
      hasTrend: trendIcon !== "",
      trendIcon,
    };
  }

  buildFailedRow(failed, index) {
    const triggeredBy = String(failed.triggeredBy || "");
    const runUrl = httpUrl(failed.runUrl);
    const recovered = isNumber(failed.recoveryHours);
    return {
      ...this.pullRequestFields(failed.pullRequest),
      key: `failed-${index}`,
      dateLabel: this.formatDate(failed.date),
      runName: String(failed.runName || ""),
      runUrl,
      jobDisabled: runUrl === "",
      triggeredBy,
      triggeredByInitials: getInitials(triggeredBy) || "?",
      triggeredByAvatarClass: getAvatarClass(triggeredBy),
      recoveryLabel: recovered
        ? this.formatUnit("doraValueHours", failed.recoveryHours)
        : this.i18n.doraNotRecovered,
      recoveryPillClass: recovered
        ? "hardis-pill hardis-status-unknown"
        : "hardis-pill hardis-status-failed",
    };
  }

  // Fields of the Pull Request and author columns: "#12 Title", opened from its address
  pullRequestFields(pullRequest) {
    if (!pullRequest) {
      return {
        pullRequestLabel: "",
        pullRequestUrl: "",
        pullRequestDisabled: true,
        author: "",
        authorInitials: "",
        authorAvatarClass: "",
      };
    }
    const url = httpUrl(pullRequest.url);
    const author = String(pullRequest.author || "");
    return {
      pullRequestLabel: `#${pullRequest.id} ${pullRequest.title || ""}`.trim(),
      pullRequestUrl: url,
      pullRequestDisabled: url === "",
      author,
      authorInitials: getInitials(author) || "?",
      authorAvatarClass: getAvatarClass(author),
    };
  }

  buildSupplementary(branch) {
    const supplementary = branch.supplementary || {};
    const validationRate = supplementary.validationSuccessRate;
    return [
      {
        key: "deploymentDuration",
        label: this.i18n.doraDeploymentDuration,
        value: this.formatDistribution(
          supplementary.deploymentDuration,
          "doraValueMinutes",
        ),
      },
      {
        key: "queueTime",
        label: this.i18n.doraQueueTime,
        value: this.formatDistribution(
          supplementary.queueTime,
          "doraValueMinutes",
        ),
      },
      {
        key: "prCycleTime",
        label: this.i18n.doraPrCycleTime,
        value: this.formatDistribution(
          supplementary.prCycleTime,
          "doraValueDays",
        ),
      },
      {
        key: "changeVolume",
        label: this.i18n.doraChangeVolume,
        value: this.t("doraChangeVolumeValue", {
          pullRequests: this.formatNumber(
            supplementary.changeVolume?.prsPerWeek,
          ),
          deployments: this.formatNumber(
            supplementary.changeVolume?.deploymentsPerWeek,
          ),
        }),
      },
      {
        key: "validationSuccessRate",
        label: this.i18n.doraValidationSuccessRate,
        value: isNumber(validationRate)
          ? this.t("doraValidationSuccessValue", {
              rate: this.formatNumber(validationRate),
              count: this.formatNumber(branch.counts?.validations),
            })
          : this.i18n.doraNoData,
      },
    ];
  }

  pullRequestColumn() {
    return {
      label: this.i18n.pullRequestLabel,
      fieldName: "pullRequestLabel",
      type: "button",
      typeAttributes: {
        label: { fieldName: "pullRequestLabel" },
        name: "openPullRequest",
        variant: "base",
        disabled: { fieldName: "pullRequestDisabled" },
      },
      wrapText: true,
    };
  }

  authorColumn() {
    return {
      label: this.i18n.authorLabel,
      fieldName: "author",
      type: "avatarText",
      typeAttributes: {
        initials: { fieldName: "authorInitials" },
        avatarClass: { fieldName: "authorAvatarClass" },
      },
    };
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

  // The extension opens the Pull Request window of the DevOps Pipeline when the address is a
  // Pull Request of this repository and the git provider is connected, the browser otherwise
  openPullRequest(url) {
    const safeUrl = httpUrl(url);
    if (safeUrl) {
      window.sendMessageToVSCode({
        type: "openPullRequest",
        data: { url: safeUrl },
      });
    }
  }

  // --- Formatting ---

  formatDistribution(distribution, unitKey) {
    if (!distribution || !isNumber(distribution.median)) {
      return this.i18n.doraNoData;
    }
    return this.t("doraDistribution", {
      median: this.formatUnit(unitKey, distribution.median),
      p90: this.formatUnit(unitKey, distribution.p90),
      avg: this.formatUnit(unitKey, distribution.avg),
    });
  }

  formatUnit(unitKey, value) {
    if (!isNumber(value)) {
      return this.i18n.doraNoData;
    }
    return this.t(unitKey, { value: this.formatNumber(value) });
  }

  formatNumber(value) {
    if (!isNumber(value)) {
      return "0";
    }
    try {
      return new Intl.NumberFormat(this.locale, {
        maximumFractionDigits: 1,
      }).format(value);
    } catch (e) {
      return String(value);
    }
  }

  formatDate(value) {
    return this.formatWith(value, { dateStyle: "medium" });
  }

  formatDateTime(value) {
    return this.formatWith(value, { dateStyle: "medium", timeStyle: "short" });
  }

  formatWith(value, options) {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) {
      return "";
    }
    try {
      return new Intl.DateTimeFormat(this.locale, options).format(
        new Date(time),
      );
    } catch (e) {
      return new Date(time).toISOString().slice(0, 10);
    }
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// The address when it is an http(s) one, else an empty string
function httpUrl(value) {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\/\S+$/i.test(url) ? url : "";
}

function toggleIcon(open) {
  return open ? "utility:chevrondown" : "utility:chevronright";
}
