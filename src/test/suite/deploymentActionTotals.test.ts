import * as assert from "assert";
import {
  LOCALES,
  assertKeysTranslated,
  extractMember,
  loadLocale,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * Tests of the totals of the Deployment Actions tab (s/pipeline): the pills of
 * every Pull Request of a window added up, next to the Status / Next promotion
 * switch (sfdx-hardis#2274).
 *
 * The DevOps Pipeline component cannot be instantiated in this test host, so
 * the members that add up the pills are lifted out of its source and run for
 * real, on groups built the way modalActionGroups builds them. The totals:
 *  - add up the header pills of every Pull Request, in their order
 *  - leave out, in Next promotion mode, a Pull Request the promotion does not carry
 *  - show only when at least two Pull Requests have pills
 *  - wait for the statuses, or the forecast, like the header pills do
 */

const NOT_IN_PROMOTION = "Not in this promotion";

suite("Deployment action totals", () => {
  const html = readModuleFile("pipeline", "pipeline.html");
  const js = readModuleFile("pipeline", "pipeline.js");
  const css = readModuleFile("pipeline", "pipeline.css");

  // A window of the pipeline, reduced to what the totals read
  function totalsView(state: Record<string, any> = {}): any {
    const view = new Function(
      `return {
        ${extractMember(js, "get showActionsHead()")},
        ${extractMember(js, "get modalActionTotals()")},
        ${extractMember(js, "_forecastGroupSummary(rows)")},
        ${extractMember(js, "_actionGroupSummary(rows)")},
        ${extractMember(js, "_summaryPills(rows, categories, labelVars)")}
      };`,
    )();
    return Object.assign(
      view,
      {
        modalActionsAggregated: true,
        isPromotionModeShown: false,
        showPromotionToggle: true,
        modalActionStatuses: {},
        actionForecast: { actions: {} },
        promotionTargetBranch: "preprod",
        modalActionGroups: [],
        i18n: { forecastNotInPromotion: NOT_IN_PROMOTION },
        t: (key: string, vars: Record<string, any>) => `${key}:${vars.count}`,
      },
      state,
    );
  }

  // One group per Pull Request, with its header pills computed the way
  // modalActionGroups computes them
  function withGroups(view: any, groups: Record<number, string[]>): any {
    view.modalActionGroups = Object.entries(groups).map(([prNumber, codes]) => {
      const rows = codes.map((statusCode, index) => ({
        id: `${prNumber}-${index}`,
        statusCode,
      }));
      return {
        key: `pr-${prNumber}`,
        prNumber: Number(prNumber),
        rows,
        summary: view.isPromotionModeShown
          ? view._forecastGroupSummary(rows)
          : view._actionGroupSummary(rows),
      };
    });
    return view;
  }

  function totalLabels(view: any): string[] {
    return view.modalActionTotals.map((pill: any) => pill.label);
  }

  test("the totals add up the status pills of every Pull Request, in their order", () => {
    const view = withGroups(totalsView(), {
      12: ["failed", "not-run", "success"],
      15: ["manual", "warning", "success", "none", "skipped"],
    });
    // "Not run yet" and "Skipped" have no pill in the headers, so none here either
    assert.deepStrictEqual(totalLabels(view), [
      "actionSummaryFailed:1",
      "actionSummaryFailedAllowed:1",
      "actionSummaryStopped:1",
      "actionSummaryWaiting:1",
      "actionSummaryDone:2",
    ]);
    assert.strictEqual(
      view.modalActionTotals[0].pillClass,
      "hardis-pill hardis-status-failed",
    );
  });

  test("a single Pull Request with pills gets no totals: its header says the same", () => {
    assert.deepStrictEqual(
      totalLabels(withGroups(totalsView(), { 12: ["failed", "success"] })),
      [],
    );
    // A second Pull Request without any pill changes nothing
    assert.deepStrictEqual(
      totalLabels(
        withGroups(totalsView(), {
          12: ["failed", "success"],
          15: ["none", "skipped"],
        }),
      ),
      [],
    );
  });

  test("in Next promotion mode, a Pull Request the promotion leaves out is not counted", () => {
    const view = withGroups(totalsView({ isPromotionModeShown: true }), {
      12: ["waiting", "runs-at-validation"],
      15: ["not-in-promotion", "not-in-promotion"],
      18: ["done", "identical", "moved"],
    });
    assert.deepStrictEqual(totalLabels(view), [
      "forecastSummaryToDo:1",
      "forecastSummaryValidation:1",
      "forecastSummaryIdentical:1",
      "forecastSummaryDone:1",
      "forecastSummaryNotForBranch:1",
    ]);
    // The header of the left-out Pull Request says so, the totals do not
    assert.ok(!totalLabels(view).includes(NOT_IN_PROMOTION));
  });

  test("a promotion that carries a single Pull Request gets no totals", () => {
    const view = withGroups(totalsView({ isPromotionModeShown: true }), {
      12: ["waiting", "done"],
      15: ["not-in-promotion"],
      18: ["not-in-promotion"],
    });
    assert.deepStrictEqual(totalLabels(view), []);
  });

  test("no totals before the statuses or the forecast are known", () => {
    const groups = { 12: ["failed"], 15: ["success"] };
    assert.deepStrictEqual(
      totalLabels(
        withGroups(totalsView({ modalActionStatuses: null }), groups),
      ),
      [],
    );
    assert.deepStrictEqual(
      totalLabels(
        withGroups(
          totalsView({ isPromotionModeShown: true, actionForecast: null }),
          { 12: ["waiting"], 15: ["done"] },
        ),
      ),
      [],
    );
  });

  test("no totals in the window of a Pull Request of your own", () => {
    const view = withGroups(totalsView({ modalActionsAggregated: false }), {
      12: ["failed"],
      15: ["success"],
    });
    assert.deepStrictEqual(totalLabels(view), []);
  });

  test("the head of the actions shows for the switch or for the totals", () => {
    const twoPullRequests = { 12: ["failed"], 15: ["success"] };
    // The production window has no switch: the totals stand alone
    assert.strictEqual(
      withGroups(totalsView({ showPromotionToggle: false }), twoPullRequests)
        .showActionsHead,
      true,
    );
    assert.strictEqual(
      withGroups(totalsView({ showPromotionToggle: true }), { 12: ["failed"] })
        .showActionsHead,
      true,
    );
    assert.strictEqual(
      withGroups(totalsView({ showPromotionToggle: false }), { 12: ["failed"] })
        .showActionsHead,
      false,
    );
  });

  test("the header pills come from the same summaries as the totals", () => {
    // modalActionTotals picks the groups to add up from their summary: both
    // must come from the same function in each mode
    assert.match(
      extractMember(js, "get modalActionGroups()"),
      /summary: this\.isPromotionModeShown\s*\?\s*this\._forecastGroupSummary\(rows\)\s*:\s*this\._actionGroupSummary\(rows\)/,
    );
  });

  test("the totals sit at the end of the switch line, and the promotion bar lost its counter", () => {
    assert.match(html, /<template if:true=\{showActionsHead\}>/);
    const line = html.slice(
      html.indexOf('class="da-head-line"'),
      html.indexOf('class="da-promo-bar"'),
    );
    const switchAt = line.indexOf('class="da-seg"');
    const totalsAt = line.indexOf('class="da-totals"');
    assert.ok(
      switchAt > -1 && totalsAt > switchAt,
      "the totals must follow the switch on the head line",
    );
    assert.match(line, /\{i18n\.actionSummaryTotal\}/);
    assert.match(line, /for:each=\{modalActionTotals\}/);
    assert.match(css, /\.da-totals \{[^}]*margin-left: auto;/);
    // The "N to do" counter of the promotion bar: the totals carry it now
    assert.doesNotMatch(html, /promotionToDoLabel|da-promo-todo/);
    assert.doesNotMatch(js, /promotionToDoLabel|forecastToDoCount/);
    assert.doesNotMatch(css, /\.da-promo-todo/);
  });

  test("the Total label is translated, and the key of the counter is gone", () => {
    assertKeysTranslated(["actionSummaryTotal"]);
    for (const locale of LOCALES) {
      assert.strictEqual(
        loadLocale(locale).forecastToDoCount,
        undefined,
        `forecastToDoCount is still in ${locale}.json`,
      );
    }
  });
});
