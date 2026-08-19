import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { WELCOME_NAVIGATION_TARGETS } from "../../commands/showWelcome";
import { REPO_ROOT } from "./lwcSourceUtils";

/**
 * Contract tests for the Welcome page (v8 design).
 *
 * The LWC webview bundle cannot be executed in this test host, so these tests
 * verify the contracts between the LWC sources, the i18n files and the
 * extension-side navigation whitelist:
 *  - every i18n key referenced by the welcome LWC exists in all 9 locales
 *  - every locale file stays ASCII-sorted (case-sensitive, JS default sort)
 *  - every feature card id is whitelisted in WELCOME_NAVIGATION_TARGETS
 *  - the "essentials" featured row keeps the heavy-use features
 */

const I18N_DIR = path.join(REPO_ROOT, "src", "i18n");
const WELCOME_DIR = path.join(
  REPO_ROOT,
  "src",
  "webviews",
  "lwc-ui",
  "modules",
  "s",
  "welcome",
);

const LOCALES = ["en", "fr", "es", "de", "it", "nl", "ja", "pl", "pt-BR"];

function loadLocale(locale: string): Record<string, string> {
  const filePath = path.join(I18N_DIR, `${locale}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function extractWelcomeI18nKeys(): string[] {
  const html = fs.readFileSync(path.join(WELCOME_DIR, "welcome.html"), "utf8");
  const js = fs.readFileSync(path.join(WELCOME_DIR, "welcome.js"), "utf8");
  const keys = new Set<string>();
  for (const match of html.matchAll(/\{i18n\.([a-zA-Z0-9_]+)\}/g)) {
    keys.add(match[1]);
  }
  for (const match of js.matchAll(/this\.t\("([a-zA-Z0-9_]+)"[,)]/g)) {
    keys.add(match[1]);
  }
  // Keys resolved dynamically through this.t(<variable>) in welcome.js
  const jsKeyProperties = [
    ...js.matchAll(/(?:labelKey|descriptionKey):\s*"([a-zA-Z0-9_]+)"/g),
  ].map((match) => match[1]);
  // Explanation keys resolved dynamically through this.t(explanationKey) via
  // PREREQUISITE_EXPLANATION_KEYS (missing-prerequisites modal)
  const explanationBlockStart = js.indexOf(
    "const PREREQUISITE_EXPLANATION_KEYS",
  );
  const explanationBlockEnd = js.indexOf("};", explanationBlockStart);
  if (explanationBlockStart > -1 && explanationBlockEnd > -1) {
    for (const match of js
      .substring(explanationBlockStart, explanationBlockEnd)
      .matchAll(/:\s*"([a-zA-Z0-9_]+)"/g)) {
      keys.add(match[1]);
    }
  }
  jsKeyProperties.forEach((key) => keys.add(key));
  return [...keys];
}

suite("Welcome page contracts", () => {
  test("all locale files are ASCII-sorted", () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(loadLocale(locale));
      assert.deepStrictEqual(
        keys,
        [...keys].sort(),
        `${locale}.json keys are not ASCII-sorted`,
      );
    }
  });

  test("all locale files have exactly the same keys as en.json", () => {
    const enKeys = Object.keys(loadLocale("en"));
    for (const locale of LOCALES) {
      const localeKeys = new Set(Object.keys(loadLocale(locale)));
      const missing = enKeys.filter((key) => !localeKeys.has(key));
      const extra = [...localeKeys].filter((key) => !enKeys.includes(key));
      assert.deepStrictEqual(
        { missing, extra },
        { missing: [], extra: [] },
        `${locale}.json keys differ from en.json`,
      );
    }
  });

  test("every i18n key used by the welcome page exists in all locales", () => {
    const usedKeys = extractWelcomeI18nKeys();
    assert.ok(
      usedKeys.length > 20,
      `Suspiciously few i18n keys extracted from the welcome LWC (${usedKeys.length})`,
    );
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      const missing = usedKeys.filter((key) => !(key in translations));
      assert.deepStrictEqual(
        missing,
        [],
        `Missing welcome page keys in ${locale}.json`,
      );
    }
  });

  test("every feature card id is whitelisted for navigation", () => {
    const js = fs.readFileSync(path.join(WELCOME_DIR, "welcome.js"), "utf8");
    const cardsBlock = js.substring(
      js.indexOf("const FEATURE_CARDS"),
      js.indexOf("const LANGUAGES"),
    );
    const cardIds = [...cardsBlock.matchAll(/id:\s*"([a-zA-Z0-9_]+)"/g)].map(
      (match) => match[1],
    );
    assert.ok(
      cardIds.length >= 8,
      `Expected at least 8 feature cards, found ${cardIds.length}`,
    );
    // Toolbar buttons also navigate through the same whitelist
    const allTargets = [...cardIds, "setup", "extensionConfig"];
    const notWhitelisted = allTargets.filter(
      (target) => !(target in WELCOME_NAVIGATION_TARGETS),
    );
    assert.deepStrictEqual(
      notWhitelisted,
      [],
      "Welcome page navigation targets missing from WELCOME_NAVIGATION_TARGETS",
    );
  });

  test("the featured 'essentials' row keeps the heavy-use features", () => {
    const js = fs.readFileSync(path.join(WELCOME_DIR, "welcome.js"), "utf8");
    const cardsBlock = js.substring(
      js.indexOf("const FEATURE_CARDS"),
      js.indexOf("const LANGUAGES"),
    );
    const essentialIds: string[] = [];
    for (const match of cardsBlock.matchAll(
      /id:\s*"([a-zA-Z0-9_]+)"[\s\S]*?group:\s*"([a-zA-Z0-9_]+)"/g,
    )) {
      if (match[2] === "essentials") {
        essentialIds.push(match[1]);
      }
    }
    assert.deepStrictEqual(
      essentialIds.sort(),
      ["documentationWorkbench", "orgMonitoring", "pipeline"].sort(),
      "The featured row must contain DevOps Pipeline, Org Monitoring and Documentation Workbench",
    );
  });

  test("only the actionable dependencies state is tinted", () => {
    const js = fs.readFileSync(path.join(WELCOME_DIR, "welcome.js"), "utf8");
    const getterStart = js.indexOf("get dependenciesButtonClass()");
    assert.ok(
      getterStart !== -1,
      "dependenciesButtonClass getter not found in welcome.js",
    );
    const getter = js.substring(
      getterStart,
      js.indexOf("get dependenciesButtonDisabled()", getterStart),
    );
    assert.ok(
      getter.includes("hardis-btn-tinted-amber"),
      "The 'upgrades required' state must stay visually distinct (amber tint)",
    );
    // "All up to date" and "checking" must remain discrete: nothing needs the
    // user's attention, so no color should compete with the rest of the page.
    for (const tint of ["green", "blue", "red"]) {
      assert.ok(
        !getter.includes(`hardis-btn-tinted-${tint}`),
        `The dependencies button must not use the ${tint} tint: only the actionable state is colored`,
      );
    }
  });
});
