import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  BROWSERFORCE_PLUGIN_NAME,
  findInstalledBrowserforce,
  getBrowserforceCatalogCacheDir,
  getBrowserforceCatalogFile,
  readBrowserforceCatalogFile,
  writeBrowserforceCatalogFile,
} from "../../utils/browserforceCatalogUtils";

/**
 * The installed Browserforce is read from the sf CLI plugin registry without starting the CLI, and
 * its catalog is cached in the file sfdx-hardis also reads and writes.
 */

const CATALOG = {
  formatVersion: 1,
  browserforceVersion: "7.1.0",
  plugins: [{ key: "densitySettings", fields: [], groups: [], examples: [] }],
  deprecatedSettings: [],
};

function writeJson(filePath: string, content: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(content), "utf8");
}

suite("Browserforce catalog utils", () => {
  let tmpDir: string;
  let previousCacheDir: string | undefined;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-catalog-test-"));
    previousCacheDir = process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR;
    process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR = path.join(tmpDir, "cache");
  });

  teardown(() => {
    if (previousCacheDir === undefined) {
      delete process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR;
    } else {
      process.env.SFDX_HARDIS_BROWSERFORCE_CACHE_DIR = previousCacheDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("a user plugin is read from the node_modules of the sf data folder", () => {
    const dataDir = path.join(tmpDir, "sf");
    writeJson(path.join(dataDir, "package.json"), {
      oclif: { plugins: [{ name: BROWSERFORCE_PLUGIN_NAME, type: "user" }] },
    });
    writeJson(
      path.join(
        dataDir,
        "node_modules",
        BROWSERFORCE_PLUGIN_NAME,
        "package.json",
      ),
      { version: "7.2.0" },
    );
    const installed = findInstalledBrowserforce(dataDir);
    assert.deepStrictEqual(installed, {
      version: "7.2.0",
      root: path.join(dataDir, "node_modules", BROWSERFORCE_PLUGIN_NAME),
      linked: false,
    });
  });

  test("a linked plugin is read from its own folder", () => {
    const dataDir = path.join(tmpDir, "sf");
    const root = path.join(tmpDir, "clone");
    writeJson(path.join(dataDir, "package.json"), {
      oclif: {
        plugins: [{ name: BROWSERFORCE_PLUGIN_NAME, type: "link", root }],
      },
    });
    writeJson(path.join(root, "package.json"), { version: "7.3.0-dev" });
    assert.deepStrictEqual(findInstalledBrowserforce(dataDir), {
      version: "7.3.0-dev",
      root,
      linked: true,
    });
  });

  test("no registry entry, no registry or no package file means not installed", () => {
    const dataDir = path.join(tmpDir, "sf");
    assert.strictEqual(findInstalledBrowserforce(dataDir), null);
    writeJson(path.join(dataDir, "package.json"), {
      oclif: { plugins: [{ name: "sfdmu", type: "user" }] },
    });
    assert.strictEqual(findInstalledBrowserforce(dataDir), null);
    writeJson(path.join(dataDir, "package.json"), {
      oclif: { plugins: [{ name: BROWSERFORCE_PLUGIN_NAME, type: "user" }] },
    });
    assert.strictEqual(findInstalledBrowserforce(dataDir), null);
  });

  test("the cache file is named after the version, in the shared folder", () => {
    assert.strictEqual(
      getBrowserforceCatalogCacheDir(),
      path.join(tmpDir, "cache"),
    );
    assert.strictEqual(
      getBrowserforceCatalogFile("7.1.0"),
      path.join(tmpDir, "cache", "catalog-7.1.0.json"),
    );
    assert.strictEqual(
      path.basename(getBrowserforceCatalogFile("7.1.0+build/1")),
      "catalog-7.1.0_build_1.json",
    );
  });

  test("writing a catalog removes the files of the other versions", () => {
    const cacheDir = path.join(tmpDir, "cache");
    writeJson(path.join(cacheDir, "catalog-6.0.0.json"), CATALOG);
    writeJson(path.join(cacheDir, "other.json"), {});
    writeBrowserforceCatalogFile("7.1.0", CATALOG as any);
    assert.deepStrictEqual(fs.readdirSync(cacheDir).sort(), [
      "catalog-7.1.0.json",
      "other.json",
    ]);
    assert.deepStrictEqual(readBrowserforceCatalogFile("7.1.0"), CATALOG);
  });

  test("a missing or corrupt cache file is a cache miss", () => {
    assert.strictEqual(readBrowserforceCatalogFile("7.1.0"), null);
    fs.mkdirSync(path.join(tmpDir, "cache"), { recursive: true });
    fs.writeFileSync(
      getBrowserforceCatalogFile("7.1.0"),
      '{"plugins": [',
      "utf8",
    );
    assert.strictEqual(readBrowserforceCatalogFile("7.1.0"), null);
    writeJson(getBrowserforceCatalogFile("7.1.0"), { plugins: [] });
    assert.strictEqual(readBrowserforceCatalogFile("7.1.0"), null);
  });
});
