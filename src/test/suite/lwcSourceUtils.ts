import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

/**
 * Shared helpers for the LWC "contract" test suites.
 *
 * The LWC webview bundle cannot be executed in the extension test host, so
 * several suites assert their contracts statically by reading the component
 * sources. They all need the same anchors, factorized here.
 */

/** Repository root, resolved from the compiled test location (out/test/suite). */
export const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Folder hosting the LWC components of the `s` namespace. */
export const MODULES_DIR = path.join(
  REPO_ROOT,
  "src",
  "webviews",
  "lwc-ui",
  "modules",
  "s",
);

/**
 * Reads a source file of an LWC component.
 * @param module component folder name (ex: "pipeline")
 * @param file file name inside that folder (ex: "pipeline.js")
 */
export function readModuleFile(module: string, file: string): string {
  return fs.readFileSync(path.join(MODULES_DIR, module, file), "utf8");
}

/** The 9 locales every user-facing string must be translated into. */
export const LOCALES = [
  "en",
  "fr",
  "es",
  "de",
  "it",
  "nl",
  "ja",
  "pl",
  "pt-BR",
];

/** Reads one locale file of src/i18n as a flat key -> translation map. */
export function loadLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "src", "i18n", `${locale}.json`),
      "utf8",
    ),
  );
}

/**
 * Asserts that every given key is translated in the 9 locales.
 * The LWC contract suites all end with this same check.
 */
export function assertKeysTranslated(keys: Iterable<string>): void {
  const keyList = [...keys];
  for (const locale of LOCALES) {
    const translations = loadLocale(locale);
    for (const key of keyList) {
      assert.ok(
        typeof translations[key] === "string" && translations[key].length > 0,
        `missing i18n key "${key}" in ${locale}.json`,
      );
    }
  }
}
