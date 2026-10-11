/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Geometry of the charts of the DORA metrics panel (s/doraMetrics).
 *
 * The extension has no chart library: the panel draws inline SVG from the
 * coordinates computed here. Pure functions, no DOM, no color: the template
 * binds the numbers and the stylesheet paints them with theme tokens.
 *
 * Nothing here is a metric: the functions only place on a drawing the weekly
 * counts sfdx-hardis already computed.
 */

// Drawing area of the weekly bar chart, in SVG user units (viewBox)
const BAR_CHART = {
  width: 720,
  height: 180,
  left: 34,
  right: 8,
  top: 10,
  bottom: 26,
};

// Most week labels a chart shows: beyond it, one label out of N is kept
const MAX_WEEK_LABELS = 13;

/**
 * Short form of an ISO week, without its year: "2026-W41" becomes "W41".
 * @param {string} week ISO week as sfdx-hardis writes it
 * @returns {string} short label
 */
export function shortWeekLabel(week) {
  const text = String(week || "");
  const match = /W(\d{1,2})$/.exec(text);
  return match ? `W${match[1].padStart(2, "0")}` : text;
}

/**
 * Integer graduations of an axis starting at 0, at most maxTicks + 1 of them.
 * The last one is the first step multiple at or above the highest value, so no
 * bar goes above the axis. An empty chart still gets a 0 to 1 axis.
 * @param {number} maxValue highest value to place
 * @param {number} maxTicks most intervals wanted (default 4)
 * @returns {number[]} graduations, from 0 up
 */
export function integerTicks(maxValue, maxTicks = 4) {
  const max = Math.max(1, Math.ceil(Number(maxValue) || 0));
  const intervals = Math.max(1, Math.floor(maxTicks));
  const step = niceIntegerStep(max / intervals);
  const ticks = [];
  for (let value = 0; value < max + step; value += step) {
    ticks.push(value);
    if (value >= max) {
      break;
    }
  }
  return ticks;
}

/**
 * Indexes of the labels to show when there are too many to fit: one out of N,
 * N being the smallest step that keeps at most maxLabels of them. The last
 * label (the current week) is always kept, so the steps are counted from it.
 * @param {number} count number of labels
 * @param {number} maxLabels most labels to show
 * @returns {Set<number>} indexes to show
 */
export function labelIndexes(count, maxLabels = MAX_WEEK_LABELS) {
  const shown = new Set();
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (total === 0) {
    return shown;
  }
  const step = Math.max(1, Math.ceil(total / Math.max(1, maxLabels)));
  for (let index = total - 1; index >= 0; index -= step) {
    shown.add(index);
  }
  return shown;
}

/**
 * Stacked bars of the deployments of each week: succeeded at the bottom, failed
 * on top, with the axis and the week labels around them.
 * @param {Array<{week: string, succeeded: number, failed: number}>} weeks weekly counts
 * @returns {object} viewBox, bars, y axis ticks, week labels, baseline and isEmpty
 */
export function buildWeeklyBarChart(weeks) {
  const rows = Array.isArray(weeks) ? weeks : [];
  const { width, height, left, right, top, bottom } = BAR_CHART;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const baseline = top + plotHeight;
  const totals = rows.map((row) => count(row.succeeded) + count(row.failed));
  const ticks = integerTicks(Math.max(0, ...totals));
  const axisMax = ticks[ticks.length - 1];
  const scale = (value) => round((value / axisMax) * plotHeight);
  const slot = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const barWidth = round(Math.max(2, Math.min(34, slot * 0.62)));
  const shownLabels = labelIndexes(rows.length);

  const bars = [];
  const labels = [];
  rows.forEach((row, index) => {
    const center = left + slot * index + slot / 2;
    const x = round(center - barWidth / 2);
    const succeeded = count(row.succeeded);
    const failed = count(row.failed);
    const succeededHeight = scale(succeeded);
    const failedHeight = scale(failed);
    const week = String(row.week || "");
    bars.push({
      key: week || `week-${index}`,
      week,
      label: shortWeekLabel(week),
      x,
      width: barWidth,
      succeeded,
      failed,
      succeededY: round(baseline - succeededHeight),
      succeededHeight,
      failedY: round(baseline - succeededHeight - failedHeight),
      failedHeight,
      hasSucceeded: succeeded > 0,
      hasFailed: failed > 0,
    });
    if (shownLabels.has(index)) {
      labels.push({
        key: week || `week-${index}`,
        text: shortWeekLabel(week),
        x: round(center),
        y: baseline + 16,
      });
    }
  });

  return {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    baseline,
    plotLeft: left,
    plotRight: width - right,
    bars,
    labels,
    yTicks: ticks.map((value) => ({
      key: `tick-${value}`,
      value,
      label: String(value),
      y: round(baseline - scale(value)),
      labelX: left - 6,
      labelY: round(baseline - scale(value)) + 3,
    })),
    isEmpty: totals.every((total) => total === 0),
  };
}

/**
 * Points of a sparkline: one value per week, the highest at the top of the box.
 * A flat series is drawn as a line at mid height, an empty one has no point.
 * @param {number[]} values one value per point
 * @param {{width?: number, height?: number, padding?: number}} size drawing box
 * @returns {object} viewBox, points (polyline attribute), last point and isEmpty
 */
export function buildSparkline(values, size = {}) {
  const width = size.width || 104;
  const height = size.height || 24;
  const padding = size.padding === undefined ? 3 : size.padding;
  const series = (Array.isArray(values) ? values : []).map(count);
  const viewBox = `0 0 ${width} ${height}`;
  if (series.length === 0) {
    return { viewBox, width, height, points: "", last: null, isEmpty: true };
  }
  const max = Math.max(...series);
  const min = Math.min(...series);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const stepX = series.length > 1 ? innerWidth / (series.length - 1) : 0;
  const coordinates = series.map((value, index) => {
    const x = series.length > 1 ? padding + stepX * index : width / 2;
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    return { x: round(x), y: round(padding + innerHeight * (1 - ratio)) };
  });
  // A polyline needs two points to draw anything
  const drawn =
    coordinates.length === 1
      ? [
          { x: padding, y: coordinates[0].y },
          { x: width - padding, y: coordinates[0].y },
        ]
      : coordinates;
  return {
    viewBox,
    width,
    height,
    points: drawn.map((point) => `${point.x},${point.y}`).join(" "),
    last: coordinates[coordinates.length - 1],
    isEmpty: max === 0,
  };
}

/**
 * Order the pipeline flow is drawn in: each branch, followed by the step to the
 * branch drawn next when sfdx-hardis measured one. A step between two branches
 * that are not neighbors (a branch merged into two others) cannot sit between
 * them: it is returned apart.
 * @param {{stages?: object[], steps?: object[]}} pipeline pipeline of the report
 * @returns {{items: object[], otherSteps: object[]}} items: { kind: "stage", stage } or { kind: "step", step }
 */
export function buildPipelineStrip(pipeline) {
  const stages = Array.isArray(pipeline && pipeline.stages)
    ? pipeline.stages
    : [];
  const steps = Array.isArray(pipeline && pipeline.steps) ? pipeline.steps : [];
  const drawn = new Set();
  const items = [];
  stages.forEach((stage, index) => {
    items.push({ kind: "stage", stage });
    const next = stages[index + 1];
    const step = next
      ? steps.find(
          (candidate) =>
            candidate.from === stage.branch && candidate.to === next.branch,
        )
      : undefined;
    if (step) {
      drawn.add(step);
      items.push({ kind: "step", step });
    }
  });
  return { items, otherSteps: steps.filter((step) => !drawn.has(step)) };
}

// 1, 2 or 5 times a power of ten, never below 1: the graduations stay integers
function niceIntegerStep(rawStep) {
  if (rawStep <= 1) {
    return 1;
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) {
    return magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
}

// A count as a positive number: anything else is 0
function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
