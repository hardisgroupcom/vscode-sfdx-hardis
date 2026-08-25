import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  findSalesforceCoreDir,
  parseSfCommand,
  tokenizeCommand,
} from "../../utils/sfCoreInProcess";

suite("sfCoreInProcess Test Suite", () => {
  suite("tokenizeCommand", () => {
    test("splits on whitespace and honors quotes", () => {
      assert.deepStrictEqual(
        tokenizeCommand('sf org display --target-org "my alias" --json'),
        ["sf", "org", "display", "--target-org", "my alias", "--json"],
      );
      assert.deepStrictEqual(tokenizeCommand("sf  config   get  target-org"), [
        "sf",
        "config",
        "get",
        "target-org",
      ]);
      assert.deepStrictEqual(tokenizeCommand("sf org display -o 'a b'"), [
        "sf",
        "org",
        "display",
        "-o",
        "a b",
      ]);
    });
  });

  suite("parseSfCommand", () => {
    test("recognizes org display shapes", () => {
      assert.deepStrictEqual(parseSfCommand("sf org display --json"), {
        kind: "org-display",
        targetOrg: null,
      });
      assert.deepStrictEqual(
        parseSfCommand('sf org display --target-org "user@ex.com" --json'),
        { kind: "org-display", targetOrg: "user@ex.com" },
      );
      assert.deepStrictEqual(
        parseSfCommand("sf org display -o myAlias --json"),
        { kind: "org-display", targetOrg: "myAlias" },
      );
      assert.deepStrictEqual(
        parseSfCommand("sf org display --target-org=myAlias"),
        { kind: "org-display", targetOrg: "myAlias" },
      );
    });

    test("recognizes config get shapes", () => {
      assert.deepStrictEqual(
        parseSfCommand("sf config get target-dev-hub --json"),
        { kind: "config-get", keys: ["target-dev-hub"] },
      );
      assert.deepStrictEqual(
        parseSfCommand("sf config get target-org target-dev-hub --verbose"),
        { kind: "config-get", keys: ["target-org", "target-dev-hub"] },
      );
    });

    test("leaves every other shape to the real CLI", () => {
      assert.strictEqual(parseSfCommand("sf org display --verbose --json"), null);
      assert.strictEqual(
        parseSfCommand("sf org display --api-version 60.0"),
        null,
      );
      assert.strictEqual(parseSfCommand("sf org display --target-org"), null);
      assert.strictEqual(parseSfCommand("sf config get"), null);
      assert.strictEqual(parseSfCommand("sf config get --global x"), null);
      assert.strictEqual(parseSfCommand("sf config set target-org=x"), null);
      assert.strictEqual(parseSfCommand("sf org list --json"), null);
      assert.strictEqual(parseSfCommand("sf hardis:org:select"), null);
      assert.strictEqual(parseSfCommand("sfdx force:org:display"), null);
      assert.strictEqual(parseSfCommand("git status"), null);
    });
  });

  suite("findSalesforceCoreDir", () => {
    let tempDir: string;

    setup(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfdx-hardis-core-"));
    });

    teardown(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function createCore(dir: string): string {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "@salesforce/core", version: "0.0.0-test" }),
      );
      return dir;
    }

    test("finds the core nested in the npm global @salesforce/cli install", () => {
      // <prefix>/sf.cmd + <prefix>/node_modules/@salesforce/cli/node_modules/@salesforce/core
      const shim = path.join(tempDir, "sf.cmd");
      fs.writeFileSync(shim, "@echo off\r\n");
      const core = createCore(
        path.join(
          tempDir,
          "node_modules",
          "@salesforce",
          "cli",
          "node_modules",
          "@salesforce",
          "core",
        ),
      );
      assert.strictEqual(findSalesforceCoreDir(shim), core);
    });

    test("finds a hoisted core from the cli bin script (unix symlink layout)", () => {
      // <prefix>/lib/node_modules/@salesforce/cli/bin/run.js + <prefix>/lib/node_modules/@salesforce/core
      const cliDir = path.join(
        tempDir,
        "lib",
        "node_modules",
        "@salesforce",
        "cli",
      );
      fs.mkdirSync(path.join(cliDir, "bin"), { recursive: true });
      const bin = path.join(cliDir, "bin", "run.js");
      fs.writeFileSync(bin, "");
      const core = createCore(
        path.join(tempDir, "lib", "node_modules", "@salesforce", "core"),
      );
      assert.strictEqual(findSalesforceCoreDir(bin), core);
    });

    test("finds the core of a standalone installer (<root>/bin/sf + <root>/node_modules)", () => {
      fs.mkdirSync(path.join(tempDir, "bin"), { recursive: true });
      const bin = path.join(tempDir, "bin", "sf");
      fs.writeFileSync(bin, "");
      const core = createCore(
        path.join(tempDir, "node_modules", "@salesforce", "core"),
      );
      assert.strictEqual(findSalesforceCoreDir(bin), core);
    });

    test("returns null when no core is reachable", () => {
      const bin = path.join(tempDir, "sf");
      fs.writeFileSync(bin, "");
      assert.strictEqual(findSalesforceCoreDir(bin), null);
    });
  });
});
