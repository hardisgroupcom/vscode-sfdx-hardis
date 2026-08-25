import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  GLOB_IGNORE_PATTERNS,
  PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS,
} from "../../utils/projectUtils";
import { getMetadataType, getMetadataTypes } from "../../utils/metadataTypes";

/**
 * Guards of the source-walking pass.
 *
 * vscode.workspace.findFiles() takes `null` as "no exclude at all", which
 * disables even the default ones and walks node_modules. Every call site must
 * pass one of the shared ignore lists instead, and the two lists must stay
 * consistent with what they promise: everything that never holds Salesforce
 * sources for a walk starting at the repository root, and only what really sits
 * inside a package directory for a walk already scoped to one.
 */

const SOURCE_ROOT = path.resolve(__dirname, "..", "..", "..", "src");

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "node_modules") {
        continue;
      }
      files.push(...listTypeScriptFiles(entryPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

suite("Source walking: glob ignore patterns", () => {
  test("no findFiles() call disables the excludes with null", () => {
    const offenders: string[] = [];
    for (const filePath of listTypeScriptFiles(SOURCE_ROOT)) {
      const content = fs.readFileSync(filePath, "utf8");
      if (!content.includes("findFiles(")) {
        continue;
      }
      // findFiles(<pattern>, null) — the second argument on its own line too
      if (/findFiles\([\s\S]{0,400}?,\s*null\s*[,)]/.test(content)) {
        offenders.push(path.relative(SOURCE_ROOT, filePath));
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      "these files pass null as the findFiles() exclude, which walks node_modules: " +
        "pass GLOB_IGNORE_PATTERNS or PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS instead",
    );
  });

  test("the repository root ignore list holds the folders that never hold sources", () => {
    for (const folder of ["node_modules", ".git", ".sf", ".sfdx", "out"]) {
      assert.ok(
        GLOB_IGNORE_PATTERNS.includes(folder),
        `${folder} should be excluded from a walk starting at the repository root`,
      );
    }
  });

  test("the AI assistant folders are excluded, they can hold example metadata", () => {
    // A skill or an instruction file can carry a sample Apex class or object,
    // which must never be listed as a source of the project
    for (const folder of [".claude", ".cursor"]) {
      assert.ok(
        GLOB_IGNORE_PATTERNS.includes(folder),
        `${folder} should be excluded: its example metadata is not project source`,
      );
    }
  });

  test("the package directory ignore list stays minimal", () => {
    // Every ignore pattern is tested against every walked path, so the root
    // folders must NOT be repeated here: they never sit inside force-app
    assert.strictEqual(
      PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS,
      "**/node_modules/**",
    );
  });

  test("the package directory ignore list keeps the metadata folders walkable", () => {
    // staticresources bundles are big, but excluding them would hide the local
    // files of the StaticResource type from the Metadata Retriever
    const staticResource = getMetadataType("StaticResource");
    assert.ok(staticResource, "StaticResource should exist in the registry");
    assert.ok(
      !PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS.includes(
        staticResource.directoryName,
      ),
      "the directory of a metadata type must never be excluded from a package directory walk",
    );
  });
});

suite("Metadata registry memoization", () => {
  test("the registry is built once and shared", () => {
    const first = getMetadataTypes();
    const second = getMetadataTypes();
    assert.strictEqual(
      first,
      second,
      "getMetadataTypes() should return the cached array, not rebuild it",
    );
    assert.ok(
      first.length > 100,
      "the registry should hold the metadata types",
    );
  });

  test("a type is resolved by its xmlName", () => {
    const apexClass = getMetadataType("ApexClass");
    assert.strictEqual(apexClass?.directoryName, "classes");
    assert.strictEqual(apexClass?.suffix, "cls");
    assert.strictEqual(getMetadataType("NotAMetadataType"), undefined);
  });
});
