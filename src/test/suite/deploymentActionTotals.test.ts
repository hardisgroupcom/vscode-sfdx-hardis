import * as assert from "assert";
import {
  LOCALES,
  assertKeysTranslated,
  extractMember,
  loadLocale,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * Tests of the Total row of the Deployment Actions tab (s/pipeline): the pills
 * of every Pull Request of a window added up next to the Status / Next
 * promotion switch, each one a switch hiding or showing the actions it counts
 * (sfdx-hardis#2274).
 *
 * The DevOps Pipeline component cannot be instantiated in this test host, so
 * the members behind the Total row are lifted out of its source and run for
 * real, on groups built the way _actionGroups builds them. The Total row:
 *  - adds up every Pull Request in the order of the header pills, and in Status
 *    mode also counts the actions no header pill counts
 *  - leaves out, in Next promotion mode, a Pull Request the promotion does not carry
 *  - shows only when at least two Pull Requests have pills in it
 *  - waits for the statuses, or the forecast, like the header pills do
 *  - hides the actions of a pill switched off, and a Pull Request left empty,
 *    with one list of pills per mode, emptied whenever a window opens
 */

const NOT_IN_PROMOTION = "Not in this promotion";

suite("Deployment action totals", () => {
  const html = readModuleFile("pipeline", "pipeline.html");
  const js = readModuleFile("pipeline", "pipeline.js");
  const css = readModuleFile("pipeline", "pipeline.css");

  // A window of the pipeline, reduced to what the Total row reads
  function totalsView(state: Record<string, any> = {}): any {
    const view = new Function(
      `return {
        ${extractMember(js, "get showActionsHead()")},
        ${extractMember(js, "get modalActionTotals()")},
        ${extractMember(js, "get everyActionHidden()")},
        ${extractMember(js, "get modalActionGroups()")},
        ${extractMember(js, "handleActionTotalToggle(event)")},
        ${extractMember(js, "_totalCategories()")},
        ${extractMember(js, "get _hiddenActionKeys()")},
        ${extractMember(js, "_hiddenActionCodes()")},
        ${extractMember(js, "_resetActionFilters()")},
        ${extractMember(js, "_forecastGroupSummary(rows)")},
        ${extractMember(js, "_forecastCategories()")},
        ${extractMember(js, "_actionGroupSummary(rows)")},
        ${extractMember(js, "_statusCategories(total)")},
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
        hiddenActionStatusKeys: [],
        hiddenActionForecastKeys: [],
        modalActions: [],
        i18n: {
          forecastNotInPromotion: NOT_IN_PROMOTION,
          clickToHideTheseActions: "HIDE",
          clickToShowTheseActions: "SHOW",
        },
        t: (key: string, vars: Record<string, any>) => `${key}:${vars.count}`,
      },
      state,
    );
  }

  // One group per Pull Request, numbered and with its header pills computed
  // the way _actionGroups does it
  function withGroups(view: any, groups: Record<number, string[]>): any {
    const built = Object.entries(groups).map(([prNumber, codes]) => {
      const rows = codes.map((statusCode, index) => ({
        id: `${prNumber}-${index}`,
        order: index + 1,
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
    view._actionGroups = () => built;
    view.modalActions = built.flatMap((group) => group.rows);
    return view;
  }

  function totalLabels(view: any): string[] {
    return view.modalActionTotals.map((pill: any) => pill.label);
  }

  function totalPill(view: any, key: string): any {
    return view.modalActionTotals.find((pill: any) => pill.key === key);
  }

  function listedRows(view: any): string[] {
    return view.modalActionGroups.flatMap((group: any) =>
      group.rows.map((row: any) => `${row.id}#${row.order}`),
    );
  }

  function click(view: any, key: string): void {
    view.handleActionTotalToggle({ currentTarget: { dataset: { key } } });
  }

  test("the totals add up every Pull Request, the actions without a header pill included", () => {
    const view = withGroups(totalsView(), {
      12: ["failed", "not-run", "success"],
      15: ["manual", "warning", "success", "none", "skipped", "pending"],
    });
    // No status yet and a pending one both read "Not run yet"
    assert.deepStrictEqual(totalLabels(view), [
      "actionSummaryFailed:1",
      "actionSummaryFailedAllowed:1",
      "actionSummaryStopped:1",
      "actionSummaryWaiting:1",
      "actionSummaryDone:2",
      "actionSummaryNotRunYet:2",
      "actionSummarySkipped:1",
    ]);
    const failed = view.modalActionTotals[0];
    assert.strictEqual(failed.pillClass, "hardis-pill hardis-status-failed");
    assert.strictEqual(failed.pressed, "true");
    assert.strictEqual(failed.toggleTitle, "HIDE");
  });

  test("a single Pull Request gets no totals: its header says the same", () => {
    assert.deepStrictEqual(
      totalLabels(withGroups(totalsView(), { 12: ["failed", "success"] })),
      [],
    );
    // A second Pull Request with only actions not run yet or skipped has pills
    // in the Total row, so the row shows
    assert.deepStrictEqual(
      totalLabels(
        withGroups(totalsView(), {
          12: ["failed", "success"],
          15: ["none", "skipped"],
        }),
      ),
      [
        "actionSummaryFailed:1",
        "actionSummaryDone:1",
        "actionSummaryNotRunYet:1",
        "actionSummarySkipped:1",
      ],
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

  test("a Total pill switched off hides its actions and the Pull Requests left empty", () => {
    const view = withGroups(totalsView(), {
      12: ["failed", "success", "manual"],
      15: ["success", "success"],
      18: ["none"],
    });
    const before = totalLabels(view);
    click(view, "done");
    // The rows keep their numbers, the order they run in
    assert.deepStrictEqual(listedRows(view), ["12-0#1", "12-2#3", "18-0#1"]);
    // The counts, and the header of a Pull Request, still count every action
    assert.deepStrictEqual(totalLabels(view), before);
    assert.ok(
      view.modalActionGroups[0].summary.some(
        (pill: any) => pill.label === "actionSummaryDone:1",
      ),
    );
    const done = totalPill(view, "done");
    assert.strictEqual(
      done.pillClass,
      "hardis-pill hardis-status-unknown da-pill-off",
    );
    assert.strictEqual(done.pressed, "false");
    assert.strictEqual(done.toggleTitle, "SHOW");
    // A second click shows them again
    click(view, "done");
    assert.strictEqual(listedRows(view).length, 6);
    assert.strictEqual(totalPill(view, "done").pressed, "true");
  });

  test("every action hidden: the tab says so", () => {
    const view = withGroups(totalsView(), {
      12: ["success"],
      15: ["success", "skipped"],
    });
    assert.strictEqual(view.everyActionHidden, false);
    click(view, "done");
    click(view, "skipped");
    assert.deepStrictEqual(listedRows(view), []);
    assert.strictEqual(view.everyActionHidden, true);
  });

  test("each mode keeps its own pills switched off", () => {
    const view = withGroups(totalsView(), {
      12: ["success", "done"],
      15: ["manual", "waiting"],
    });
    click(view, "done");
    view.isPromotionModeShown = true;
    assert.deepStrictEqual(view._hiddenActionKeys, []);
    click(view, "waiting");
    assert.deepStrictEqual(view.hiddenActionForecastKeys, ["waiting"]);
    view.isPromotionModeShown = false;
    assert.deepStrictEqual(view._hiddenActionKeys, ["done"]);
  });

  test("a window without the Total row lists every action, whatever was switched off", () => {
    const view = withGroups(totalsView({ hiddenActionStatusKeys: ["done"] }), {
      12: ["success", "failed"],
    });
    assert.deepStrictEqual(totalLabels(view), []);
    assert.deepStrictEqual(listedRows(view), ["12-0#1", "12-1#2"]);
  });

  test("a key that is not a pill of the mode changes nothing", () => {
    const view = withGroups(totalsView(), { 12: ["success"], 15: ["failed"] });
    click(view, "not-in-promotion");
    click(view, "constructor");
    assert.deepStrictEqual(view.hiddenActionStatusKeys, []);
    assert.deepStrictEqual(view.hiddenActionForecastKeys, []);
  });

  test("a window opens with every pill on", () => {
    const view = totalsView({
      hiddenActionStatusKeys: ["done"],
      hiddenActionForecastKeys: ["waiting"],
    });
    view._resetActionFilters();
    assert.deepStrictEqual(view.hiddenActionStatusKeys, []);
    assert.deepStrictEqual(view.hiddenActionForecastKeys, []);
    // Both places that load the actions of a window empty the lists
    for (const loader of [
      "_populateModalFromPrs(prs)",
      "handleReturnGetPrInfoForModal(pr)",
    ]) {
      assert.match(
        extractMember(js, loader),
        /this\.modalActions = [\s\S]*?this\._resetActionFilters\(\);/,
        `${loader} must reset the Total pills after loading the actions`,
      );
    }
  });

  test("the header pills and the Total row read the same categories", () => {
    assert.match(
      extractMember(js, "_actionGroups()"),
      /summary: this\.isPromotionModeShown\s*\?\s*this\._forecastGroupSummary\(rows\)\s*:\s*this\._actionGroupSummary\(rows\)/,
    );
    assert.match(
      extractMember(js, "_actionGroupSummary(rows)"),
      /this\._statusCategories\(false\)/,
    );
    assert.match(
      extractMember(js, "_forecastGroupSummary(rows)"),
      /this\._forecastCategories\(\)/,
    );
  });

  test("the Total pills are buttons at the end of the switch line, and the promotion bar lost its counter", () => {
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
    const button = (line.match(/<button[^>]*data-key=\{pill\.key\}[^>]*>/) || [
      "",
    ])[0];
    for (const attribute of [
      'type="button"',
      'class="da-status-toggle"',
      "aria-pressed={pill.pressed}",
      "title={pill.toggleTitle}",
      "onclick={handleActionTotalToggle}",
    ]) {
      assert.ok(button.includes(attribute), `Total pill button: ${attribute}`);
    }
    assert.match(html, /<template if:true=\{everyActionHidden\}>/);
    assert.match(html, /\{i18n\.everyActionHiddenByTotal\}/);
    assert.match(css, /\.da-totals \{[^}]*margin-left: auto;/);
    assert.match(
      css,
      /\.da-totals \.hardis-pill\.da-pill-off \{[^}]*text-decoration: line-through;/,
    );
    // The "N to do" counter of the promotion bar: the totals carry it now
    assert.doesNotMatch(html, /promotionToDoLabel|da-promo-todo/);
    assert.doesNotMatch(js, /promotionToDoLabel|forecastToDoCount/);
    assert.doesNotMatch(css, /\.da-promo-todo/);
  });

  test("the labels of the Total row are translated, and the key of the counter is gone", () => {
    assertKeysTranslated([
      "actionSummaryTotal",
      "actionSummaryNotRunYet",
      "actionSummarySkipped",
      "clickToHideTheseActions",
      "clickToShowTheseActions",
      "everyActionHiddenByTotal",
    ]);
    for (const locale of LOCALES) {
      assert.strictEqual(
        loadLocale(locale).forecastToDoCount,
        undefined,
        `forecastToDoCount is still in ${locale}.json`,
      );
    }
  });
});
