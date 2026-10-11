import * as assert from "assert";
import { readModuleFile } from "./lwcSourceUtils";

/**
 * Tests of the chart geometry of the DORA metrics panel (s/doraChartUtils).
 *
 * The LWC webview bundle cannot be executed in this test host, but the module is
 * made of pure functions without any import: its source is evaluated here and
 * the functions are run for real.
 */

interface ChartUtils {
  shortWeekLabel(week: any): string;
  integerTicks(maxValue: any, maxTicks?: number): number[];
  labelIndexes(count: any, maxLabels?: number): Set<number>;
  buildWeeklyBarChart(weeks: any): any;
  buildSparkline(values: any, size?: any): any;
}

function loadChartUtils(): ChartUtils {
  const source = readModuleFile("doraChartUtils", "doraChartUtils.js");
  assert.ok(!/^import /m.test(source), "the module must stay free of imports");
  const body =
    source.replace(/^export /gm, "") +
    "\nreturn { shortWeekLabel, integerTicks, labelIndexes, buildWeeklyBarChart, buildSparkline };";
  return new Function(body)() as ChartUtils;
}

function weeks(counts: Array<[number, number]>, firstWeek = 1): any[] {
  return counts.map(([succeeded, failed], index) => ({
    week: `2026-W${String(firstWeek + index).padStart(2, "0")}`,
    succeeded,
    failed,
  }));
}

suite("DORA chart utils", () => {
  const chartUtils = loadChartUtils();

  test("a week label is the ISO week without its year", () => {
    assert.strictEqual(chartUtils.shortWeekLabel("2026-W41"), "W41");
    assert.strictEqual(chartUtils.shortWeekLabel("2026-W05"), "W05");
    assert.strictEqual(chartUtils.shortWeekLabel("2026-W5"), "W05");
    // Anything else is shown as it came
    assert.strictEqual(chartUtils.shortWeekLabel("October"), "October");
    assert.strictEqual(chartUtils.shortWeekLabel(undefined), "");
  });

  test("the y axis only has integers, and its top is at or above the highest value", () => {
    assert.deepStrictEqual(chartUtils.integerTicks(0), [0, 1]);
    assert.deepStrictEqual(chartUtils.integerTicks(1), [0, 1]);
    assert.deepStrictEqual(chartUtils.integerTicks(3), [0, 1, 2, 3]);
    assert.deepStrictEqual(chartUtils.integerTicks(4), [0, 1, 2, 3, 4]);
    assert.deepStrictEqual(chartUtils.integerTicks(7), [0, 2, 4, 6, 8]);
    assert.deepStrictEqual(chartUtils.integerTicks(12), [0, 5, 10, 15]);
    assert.deepStrictEqual(chartUtils.integerTicks(23), [0, 10, 20, 30]);
    assert.deepStrictEqual(chartUtils.integerTicks(130), [0, 50, 100, 150]);
    for (let max = 0; max <= 400; max++) {
      const ticks = chartUtils.integerTicks(max);
      assert.ok(
        ticks.every((tick) => Number.isInteger(tick)),
        `integer ticks for ${max}`,
      );
      assert.ok(ticks[ticks.length - 1] >= max, `top of the axis for ${max}`);
      assert.ok(ticks.length <= 6, `no more than 6 graduations for ${max}`);
      assert.strictEqual(ticks[0], 0);
    }
  });

  test("a value that is not a number gives the axis of an empty chart", () => {
    assert.deepStrictEqual(chartUtils.integerTicks(undefined), [0, 1]);
    assert.deepStrictEqual(chartUtils.integerTicks(-4), [0, 1]);
    assert.deepStrictEqual(chartUtils.integerTicks("abc"), [0, 1]);
  });

  test("every week is labelled while there are few of them", () => {
    assert.deepStrictEqual(
      [...chartUtils.labelIndexes(5)].sort((a, b) => a - b),
      [0, 1, 2, 3, 4],
    );
    assert.strictEqual(chartUtils.labelIndexes(13).size, 13);
    assert.strictEqual(chartUtils.labelIndexes(0).size, 0);
  });

  test("one week label out of N is kept when there are many, the last week always", () => {
    // 26 weeks (180 days): one out of 2
    const halfYear = [...chartUtils.labelIndexes(26)].sort((a, b) => a - b);
    assert.strictEqual(halfYear.length, 13);
    assert.deepStrictEqual(halfYear.slice(-3), [21, 23, 25]);
    // 53 weeks (365 days): one out of 5
    const year = [...chartUtils.labelIndexes(53)].sort((a, b) => a - b);
    assert.deepStrictEqual(year, [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52]);
    for (let count = 1; count <= 120; count++) {
      const shown = chartUtils.labelIndexes(count);
      assert.ok(shown.size <= 13, `at most 13 labels for ${count} weeks`);
      assert.ok(shown.has(count - 1), `last week labelled for ${count} weeks`);
    }
  });

  test("the bars stack the failed deployments on top of the succeeded ones", () => {
    const chart = chartUtils.buildWeeklyBarChart(
      weeks([
        [3, 1],
        [0, 0],
        [8, 0],
        [0, 2],
      ]),
    );
    assert.strictEqual(chart.isEmpty, false);
    assert.strictEqual(chart.bars.length, 4);
    assert.deepStrictEqual(
      chart.yTicks.map((tick: any) => tick.value),
      [0, 2, 4, 6, 8],
    );
    const [mixed, empty, full, failedOnly] = chart.bars;
    // Succeeded sits on the baseline, failed ends where succeeded starts
    assert.strictEqual(
      mixed.succeededY + mixed.succeededHeight,
      chart.baseline,
    );
    assert.strictEqual(mixed.failedY + mixed.failedHeight, mixed.succeededY);
    assert.strictEqual(mixed.succeededHeight, mixed.failedHeight * 3);
    assert.strictEqual(mixed.hasSucceeded, true);
    assert.strictEqual(mixed.hasFailed, true);
    assert.strictEqual(empty.hasSucceeded, false);
    assert.strictEqual(empty.hasFailed, false);
    assert.strictEqual(empty.succeededHeight, 0);
    // The highest bar reaches the top graduation
    assert.strictEqual(full.succeededY, chart.yTicks[4].y);
    assert.strictEqual(
      failedOnly.failedY + failedOnly.failedHeight,
      chart.baseline,
    );
    assert.strictEqual(failedOnly.label, "W04");
  });

  test("the bars stay inside the drawing, whatever the number of weeks", () => {
    for (const count of [1, 5, 13, 26, 53]) {
      const chart = chartUtils.buildWeeklyBarChart(
        weeks(
          Array.from({ length: count }, (_, index) => [index % 7, index % 3]),
        ),
      );
      assert.strictEqual(chart.bars.length, count);
      let previousEnd = chart.plotLeft;
      for (const bar of chart.bars) {
        assert.ok(bar.x >= previousEnd - 0.2, `bars do not overlap (${count})`);
        assert.ok(
          bar.failedY >= 0,
          `bar under the top of the drawing (${count})`,
        );
        previousEnd = bar.x + bar.width;
      }
      assert.ok(
        previousEnd <= chart.plotRight + 0.2,
        `last bar inside (${count})`,
      );
      assert.ok(chart.labels.length <= 13);
      assert.strictEqual(
        chart.labels[chart.labels.length - 1].text,
        chart.bars[count - 1].label,
      );
      for (const label of chart.labels) {
        assert.ok(label.x > chart.plotLeft && label.x < chart.plotRight);
      }
    }
  });

  test("no week, or weeks without any deployment, give an empty chart with its axis", () => {
    for (const input of [
      [],
      undefined,
      null,
      weeks([
        [0, 0],
        [0, 0],
      ]),
    ]) {
      const chart = chartUtils.buildWeeklyBarChart(input);
      assert.strictEqual(chart.isEmpty, true);
      assert.deepStrictEqual(
        chart.yTicks.map((tick: any) => tick.value),
        [0, 1],
      );
      assert.ok(chart.viewBox.startsWith("0 0 "));
    }
    assert.deepStrictEqual(chartUtils.buildWeeklyBarChart([]).bars, []);
    assert.deepStrictEqual(chartUtils.buildWeeklyBarChart([]).labels, []);
  });

  test("counts that are not positive numbers are drawn as zero", () => {
    const chart = chartUtils.buildWeeklyBarChart([
      { week: "2026-W10", succeeded: "x", failed: -3 },
      { week: "2026-W11", succeeded: 2, failed: null },
    ]);
    assert.strictEqual(chart.bars[0].succeeded, 0);
    assert.strictEqual(chart.bars[0].failed, 0);
    assert.strictEqual(chart.bars[1].succeeded, 2);
    assert.ok(
      chart.bars.every((bar: any) =>
        [bar.x, bar.succeededY, bar.failedY, bar.width].every(Number.isFinite),
      ),
    );
  });

  test("a sparkline puts its highest value at the top and its lowest at the bottom", () => {
    const sparkline = chartUtils.buildSparkline([0, 5, 10], {
      width: 100,
      height: 20,
      padding: 2,
    });
    assert.strictEqual(sparkline.points, "2,18 50,10 98,2");
    assert.deepStrictEqual(sparkline.last, { x: 98, y: 2 });
    assert.strictEqual(sparkline.isEmpty, false);
    assert.strictEqual(sparkline.viewBox, "0 0 100 20");
  });

  test("a sparkline has one point per week", () => {
    const sparkline = chartUtils.buildSparkline([
      8, 9, 7, 10, 9, 8, 11, 9, 10, 8, 9, 10, 9,
    ]);
    assert.strictEqual(sparkline.points.split(" ").length, 13);
    for (const point of sparkline.points.split(" ")) {
      const [x, y] = point.split(",").map(Number);
      assert.ok(x >= 0 && x <= sparkline.width);
      assert.ok(y >= 0 && y <= sparkline.height);
    }
  });

  test("a flat, a single-value and an empty sparkline are all drawable", () => {
    const flat = chartUtils.buildSparkline([4, 4, 4], {
      width: 100,
      height: 20,
    });
    assert.strictEqual(flat.isEmpty, false);
    assert.ok(flat.points.split(" ").every((p: string) => p.endsWith(",10")));
    const zeros = chartUtils.buildSparkline([0, 0, 0]);
    assert.strictEqual(zeros.isEmpty, true);
    assert.strictEqual(zeros.points.split(" ").length, 3);
    // One value: a line across the box, a polyline needs two points
    const single = chartUtils.buildSparkline([3], { width: 100, height: 20 });
    assert.strictEqual(single.points.split(" ").length, 2);
    const none = chartUtils.buildSparkline([]);
    assert.strictEqual(none.points, "");
    assert.strictEqual(none.last, null);
    assert.strictEqual(none.isEmpty, true);
    assert.strictEqual(chartUtils.buildSparkline(undefined).isEmpty, true);
  });
});
