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
