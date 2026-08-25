import * as assert from "assert";
import { LOCALES, loadLocale, readModuleFile } from "./lwcSourceUtils";

/**
 * Contract tests for the "Target orgs" selector of the deployment action
 * editor (s/deploymentAction).
 *
 * The include and exclude modes share one dual listbox, so nothing but the
 * labels tells the user whether the selected branches are the ones the action
 * runs on, or the ones it skips. These tests verify statically (the LWC bundle
 * cannot be executed in this test host) that:
 *  - both columns are labelled by a mode-aware getter, never by a fixed string
 *  - the two getters always say the opposite of each other
 *  - the summary sentence is rendered under the selector
 *  - every i18n key the selector uses exists in the 9 locales
 */

suite("Deployment action target orgs contract", () => {
  const html = readModuleFile("deploymentAction", "deploymentAction.html");
  const js = readModuleFile("deploymentAction", "deploymentAction.js");

  test("both dual listbox columns are labelled by a mode-aware getter", () => {
    assert.match(
      html,
      /source-label=\{targetBranchesSourceColumnLabel\}/,
      "the available branches column must use the mode-aware getter",
    );
    assert.match(
      html,
      /selected-label=\{targetBranchesSelectedColumnLabel\}/,
      "the selected branches column must use the mode-aware getter",
    );
    // A fixed label on either column would leave the user guessing whether the
    // selected branches are included or excluded
    assert.doesNotMatch(html, /source-label=\{i18n\./);
    assert.doesNotMatch(html, /selected-label=\{i18n\./);
  });

  test("the two column labels always say the opposite of each other", () => {
    for (const getter of [
      "targetBranchesSourceColumnLabel",
      "targetBranchesSelectedColumnLabel",
    ]) {
      const body = js.substring(js.indexOf(`get ${getter}()`));
      const keys = [
        ...body.substring(0, 220).matchAll(/this\.t\("(\w+)"\)/g),
      ].map((match) => match[1]);
      assert.deepStrictEqual(
        keys.slice(0, 2).sort(),
        ["targetBranchesDoesNotRunHere", "targetBranchesRunsHere"],
        `${getter} must pick between the "runs here" and "does not run here" labels`,
      );
    }
    // The exclude mode is what flips them, so the two getters must not resolve
    // the same key for the same mode
    const source = js.substring(
      js.indexOf("get targetBranchesSourceColumnLabel()"),
    );
    assert.match(
      source.substring(0, 220),
      /exclude"\s*\?\s*this\.t\("targetBranchesRunsHere"\)/,
      "in exclude mode the available branches are the ones the action runs on",
    );
  });

  test("the summary sentence is rendered under the selector", () => {
    assert.match(
      html,
      /\{targetBranchesSummary\}/,
      "the selector must be followed by the plain sentence summarizing it",
    );
    assert.match(js, /get targetBranchesSummary\(\)/);
    // An empty restriction list is dropped when saving, so it must read like
    // the "All target orgs" mode instead of naming no branch at all
    assert.match(js, /targetBranchesSummaryAll/);
  });

  test("every i18n key of the target orgs selector exists in all locales", () => {
    const usedKeys = [
      "targetBranchesLabel",
      "targetBranchesHelp",
      "targetBranchesModeAll",
      "targetBranchesModeInclude",
      "targetBranchesModeExclude",
      "targetBranchesIncludedLabel",
      "targetBranchesExcludedLabel",
      "targetBranchesRunsHere",
      "targetBranchesDoesNotRunHere",
      "targetBranchesSummaryAll",
      "targetBranchesSummaryInclude",
      "targetBranchesSummaryExclude",
      "devSandboxesOption",
    ];
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      const missing = usedKeys.filter((key) => !(key in translations));
      assert.deepStrictEqual(
        missing,
        [],
        `Missing target orgs keys in ${locale}.json`,
      );
    }
  });

  test("both summary sentences keep their branches placeholder", () => {
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      for (const key of [
        "targetBranchesSummaryInclude",
        "targetBranchesSummaryExclude",
      ]) {
        assert.ok(
          translations[key].includes("{{branches}}"),
          `${key} lost its {{branches}} placeholder in ${locale}.json`,
        );
      }
    }
  });
});
