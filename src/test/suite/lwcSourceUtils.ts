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

/**
 * Lifts one member out of an LWC component source, so its logic can be run in the
 * extension test host, where the component itself cannot be instantiated.
 * @param source the component source, read with readModuleFile
 * @param signature the member as written, ex: "get modalPrColumns()" or "_mergeTargetsOf(branchName)"
 */
export function extractMember(source: string, signature: string): string {
  const start = source.indexOf("\n  " + signature);
  assert.ok(
    start > -1,
    `member not found in the component source: ${signature}`,
  );
  return source.slice(start + 1, endOfBlock(source, start, signature) + 1);
}

/**
 * Lifts a top-level function out of an LWC component source, the way
 * extractMember lifts a class member. A component computing one thing in one
 * place, so its pills and its row actions cannot disagree, does it outside the
 * class, and that helper is worth a test of its own.
 * @param source the component source, read with readModuleFile
 * @param name the function name, ex: "orgConnectionState"
 */
export function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > -1, `function not found in the component source: ${name}`);
  return source.slice(start, endOfBlock(source, start, name) + 1);
}

/** The index of the brace closing the first block opened after `start`. */
function endOfBlock(source: string, start: number, what: string): number {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}" && --depth === 0) {
      return index;
    }
  }
  return assert.fail(`unbalanced braces while reading ${what}`);
}

/**
 * Reads a source file of the extension, relative to `src/`.
 * Several contract suites assert a behavior is wired on every dependencies
 * surface by looking for anchors in the sources that feed each UI.
 * @param relative path inside src (ex: "utils/setupUtils.ts")
 */
export function readSourceFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, "src", relative), "utf8");
}
