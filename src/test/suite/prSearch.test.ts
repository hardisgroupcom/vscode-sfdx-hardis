// cspell:ignore Déploiement Deploiement échoué ECHOUE İstanbul
import * as assert from "assert";
import * as path from "path";
import {
  assertKeysTranslated,
  extractMember,
  readModuleFile,
  readSourceFile,
} from "./lwcSourceUtils";

/**
 * Tests of the search bar of the Pull Request window: the description and the comments of the
 * Validation, Code Quality and Deployment tabs, searched with Ctrl+F.
 *
 * s/searchUtils holds no LWC and no DOM import, so the whole module is run for real. The
 * navigation of the pipeline component is lifted out of its source with extractMember and run
 * on a plain object, with the counts of each tab given.
 */

const SEARCH_EXPORTS = [
  "SEARCH_MIN_LENGTH",
  "normalizeSearchQuery",
  "foldForSearch",
  "findMatches",
  "countMatches",
  "stepMatch",
  "locateMatch",
  "firstMatchOf",
  "activeMatchByPart",
];

function loadSearchUtils(): any {
  const source = readModuleFile("searchUtils", "searchUtils.js").replace(
    /^export /gm,
    "",
  );
  return new Function(`${source}\nreturn { ${SEARCH_EXPORTS.join(", ")} };`)();
}

const PIPELINE_MEMBERS = [
  "get modalSearchTotal()",
  "get modalSearchPositionLabel()",
  "_followSearchToTab(value)",
  "_clampedSearchIndex()",
  "_activeMatchOf(key)",
  "_applyModalSearch()",
  "_moveModalSearch(delta)",
  "_goToSearchMatch(index)",
  "_clearModalSearch()",
  "_closeModalSearch()",
];

/**
 * A pipeline component reduced to its search: the counts of each tab are given instead of
 * being read from the comments.
 */
function searchComponent(counts: { key: string; count: number }[]): any {
  const utils = loadSearchUtils();
  const js = readModuleFile("pipeline", "pipeline.js");
  const members = PIPELINE_MEMBERS.map((member) => extractMember(js, member));
  const component = new Function(
    "firstMatchOf",
    "locateMatch",
    "normalizeSearchQuery",
    "stepMatch",
    `return { ${members.join(",\n")} };`,
  )(
    utils.firstMatchOf,
    utils.locateMatch,
    utils.normalizeSearchQuery,
    utils.stepMatch,
  );
  Object.assign(component, {
    modalSearchInput: "",
    modalSearchQuery: "",
    modalSearchIndex: 0,
    modalActiveTabValue: "general",
    i18n: { prSearchNoMatch: "No match" },
    t: (key: string, values: any) => `${values.current} / ${values.total}`,
  });
  component._searchDebounce = null;
  component._modalSearchCounts = () =>
    component.modalSearchQuery ? counts : [];
  return component;
}

suite("Pull Request window search", () => {
  const utils = loadSearchUtils();

  suite("matching", () => {
    test("searches from two characters, as typed", () => {
      assert.strictEqual(utils.normalizeSearchQuery(" a "), "");
      assert.strictEqual(utils.normalizeSearchQuery(" ab "), "ab");
      assert.strictEqual(utils.normalizeSearchQuery(null), "");
    });

    test("ignores case and accents, and highlights the original text", () => {
      const text = "Déploiement FAILED: Deploiement échoué";
      const matches = utils.findMatches(text, "deploiement");
      assert.deepStrictEqual(
        matches.map((m: any) => text.slice(m.start, m.end)),
        ["Déploiement", "Deploiement"],
      );
      assert.deepStrictEqual(
        utils
          .findMatches(text, "ECHOUE")
          .map((m: any) => text.slice(m.start, m.end)),
        ["échoué"],
      );
    });

    test("keeps the offsets when a character changes length once folded", () => {
      // A decomposed accent folds to nothing: the match after it must still land on the original
      const text = "Café İstanbul Account";
      const [match] = utils.findMatches(text, "account");
      assert.strictEqual(text.slice(match.start, match.end), "Account");
      const [city] = utils.findMatches(text, "istanbul");
      assert.strictEqual(text.slice(city.start, city.end), "İstanbul");
      const [cafe] = utils.findMatches(text, "café");
      assert.strictEqual(cafe.start, 0);
    });

    test("never overlaps two matches, nor spans two texts", () => {
      assert.strictEqual(utils.findMatches("aaaa", "aa").length, 2);
      // A highlight never spans two text nodes: neither does a count
      assert.strictEqual(
        utils.countMatches(["deploy", "ment"], "deployment"),
        0,
      );
      assert.strictEqual(
        utils.countMatches(["Error in Account", "error", ""], "error"),
        2,
      );
      assert.strictEqual(utils.countMatches(["error"], ""), 0);
    });
  });

  suite("moving between matches", () => {
    const counts = [
      { key: "general", count: 0 },
      { key: "validation", count: 2 },
      { key: "megalinter", count: 0 },
      { key: "deployment", count: 3 },
    ];

    test("goes round at both ends", () => {
      assert.strictEqual(utils.stepMatch(4, 5, 1), 0);
      assert.strictEqual(utils.stepMatch(0, 5, -1), 4);
      assert.strictEqual(utils.stepMatch(2, 0, 1), 0);
    });

    test("finds the tab holding a match, and the first match of a tab", () => {
      assert.deepStrictEqual(utils.locateMatch(0, counts), {
        key: "validation",
        local: 0,
      });
      assert.deepStrictEqual(utils.locateMatch(3, counts), {
        key: "deployment",
        local: 1,
      });
      assert.strictEqual(utils.locateMatch(5, counts), null);
      assert.strictEqual(utils.locateMatch(-1, counts), null);
      assert.strictEqual(utils.firstMatchOf("deployment", counts), 2);
      assert.strictEqual(utils.firstMatchOf("megalinter", counts), -1);
      assert.strictEqual(utils.firstMatchOf("tickets", counts), -1);
    });

    test("gives the current match to the comment holding it only", () => {
      assert.deepStrictEqual(
        utils.activeMatchByPart(3, [2, 0, 4]),
        [-1, -1, 1],
      );
      assert.deepStrictEqual(utils.activeMatchByPart(1, [2, 4]), [1, -1]);
      assert.deepStrictEqual(utils.activeMatchByPart(-1, [2, 4]), [-1, -1]);
      assert.deepStrictEqual(utils.activeMatchByPart(9, [2, 4]), [-1, -1]);
    });

    test("typing never switches tabs, Enter goes to the tab of the match", () => {
      const view = searchComponent(counts);
      view.modalActiveTabValue = "deployment";
      view.modalSearchInput = "error";
      assert.strictEqual(view._applyModalSearch(), true);
      // The first match of the tab shown, not the first one at all
      assert.strictEqual(view.modalSearchIndex, 2);
      assert.strictEqual(view.modalActiveTabValue, "deployment");
      assert.strictEqual(view.modalSearchPositionLabel, "3 / 5");
      assert.strictEqual(view._activeMatchOf("deployment"), 0);
      assert.strictEqual(view._activeMatchOf("validation"), -1);
      // Next, next, next: round to the Validation tab
      view._moveModalSearch(1);
      view._moveModalSearch(1);
      view._moveModalSearch(1);
      assert.strictEqual(view.modalSearchIndex, 0);
      assert.strictEqual(view.modalActiveTabValue, "validation");
      // Previous goes back round
      view._moveModalSearch(-1);
      assert.strictEqual(view.modalActiveTabValue, "deployment");
      assert.strictEqual(view._activeMatchOf("deployment"), 2);
    });

    test("a tab opened by hand shows its own first match", () => {
      const view = searchComponent(counts);
      view.modalSearchInput = "error";
      view._applyModalSearch();
      // No match in General: the current match is the first one at all
      assert.strictEqual(view.modalSearchIndex, 0);
      view._followSearchToTab("deployment");
      assert.strictEqual(view.modalSearchIndex, 2);
      // A tab without a match keeps the current one
      view._followSearchToTab("megalinter");
      assert.strictEqual(view.modalSearchIndex, 2);
    });

    test("says when nothing matches, and clears", () => {
      const view = searchComponent([{ key: "general", count: 0 }]);
      view.modalSearchInput = "zz";
      view._applyModalSearch();
      assert.strictEqual(view.modalSearchPositionLabel, "No match");
      view._moveModalSearch(1);
      assert.strictEqual(view.modalSearchIndex, 0);
      view._clearModalSearch();
      assert.strictEqual(view.modalSearchQuery, "");
      assert.strictEqual(view.modalSearchPositionLabel, "");
    });

    test("closing the bar clears the search and gives its room back", () => {
      const view = searchComponent([{ key: "validation", count: 2 }]);
      view.modalSearchOpen = true;
      view.modalSearchInput = "error";
      view._applyModalSearch();
      view._closeModalSearch();
      assert.strictEqual(view.modalSearchOpen, false);
      assert.strictEqual(view.modalSearchQuery, "");
      assert.strictEqual(view.modalSearchInput, "");
    });
  });

  suite("wiring", () => {
    test("the search of a window is kept with it, and starts empty elsewhere", () => {
      const defaults = readModuleFile(
        "pullRequestUtils",
        "pullRequestUtils.js",
      );
      for (const field of [
        'modalSearchInput: ""',
        'modalSearchQuery: ""',
        "modalSearchIndex: 0",
        "modalSearchFilter: false",
        "modalSearchOpen: false",
      ]) {
        assert.ok(defaults.includes(field), field);
      }
    });

    test("Ctrl+F opens the find bar of VS Code, and the search bar in a Pull Request", () => {
      assert.match(
        readSourceFile("webviews/lwc-ui-panel.ts"),
        /enableFindWidget: true/,
      );
      const js = readModuleFile("pipeline", "pipeline.js");
      assert.match(
        js,
        /window\.addEventListener\("keydown", this\._boundSearchShortcut, true\)/,
      );
      assert.match(
        js,
        /window\.removeEventListener\("keydown", this\._boundSearchShortcut, true\)/,
      );
      const shortcut = extractMember(js, "_handleSearchShortcut(event)");
      assert.match(shortcut, /!this\.canSearchModal/);
      assert.match(shortcut, /event\.stopImmediatePropagation\(\)/);
      assert.match(shortcut, /this\._openModalSearch\(\)/);
      // The bar takes room: closed until Ctrl+F or the search button of the header opens it
      const html = readModuleFile("pipeline", "pipeline.html");
      assert.match(
        html,
        /<template if:true=\{modalSearchOpen\}>\s*<div class="pr-search-bar"/,
      );
      assert.match(html, /onclick=\{handleModalSearchToggle\}/);
    });

    test("every tab searched gets the search, and counts from the same comments", () => {
      const html = readModuleFile("pipeline", "pipeline.html");
      for (const label of [
        "generalTabLabel",
        "validationTabLabel",
        "megaLinterTabLabel",
        "deploymentTabLabel",
      ]) {
        assert.ok(html.includes(`label={${label}}`), label);
      }
      assert.strictEqual(
        (html.match(/search-query=\{modalSearchQuery\}/g) || []).length,
        4,
      );
      const runs = readModuleFile("workflowRuns", "workflowRuns.js");
      assert.match(runs, /countMarkdownMatches\(run\.body/);
      assert.match(
        readModuleFile("workflowRuns", "workflowRuns.html"),
        /search-query=\{searchQuery\} active-match=\{row\.searchActiveMatch\}/,
      );
    });

    test("the highlights follow the theme", () => {
      const css = readSourceFile(
        path.join("..", "resources", "global-theme.css"),
      );
      const start = css.indexOf(".hardis-search-hit {");
      assert.ok(start > -1, ".hardis-search-hit is in the kit");
      const rules = css.slice(
        start,
        css.indexOf("}", css.indexOf(".hardis-search-hit.active {")) + 1,
      );
      assert.match(rules, /var\(--slds-g-color-palette-yellow-/);
      assert.ok(!/#[0-9a-f]{3,6}\b|rgb\(/i.test(rules), "no hardcoded color");
    });

    test("the labels of the search are translated in every locale", () => {
      assertKeysTranslated([
        "prSearchFilter",
        "prSearchMatchCount",
        "prSearchNext",
        "prSearchNoMatch",
        "prSearchNoMatchInTab",
        "prSearchClose",
        "prSearchOpen",
        "prSearchPlaceholder",
        "prSearchPosition",
        "prSearchPrevious",
        "prSearchTabCount",
      ]);
    });
  });
});
