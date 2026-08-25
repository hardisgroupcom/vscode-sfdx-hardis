import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildOrgListResult,
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

    test("unescapes \\\" and \\\\ inside double quotes only", () => {
      assert.deepStrictEqual(
        tokenizeCommand('--query "WHERE Name IN (\\"A\\", \\"B\\") AND X = \'\\\\\'"'),
        ["--query", "WHERE Name IN (\"A\", \"B\") AND X = '\\'"],
      );
      // Backslashes outside quotes (Windows paths) are kept as-is
      assert.deepStrictEqual(tokenizeCommand("--file C:\\tmp\\q.soql"), [
        "--file",
        "C:\\tmp\\q.soql",
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

    test("recognizes org list shapes", () => {
      assert.deepStrictEqual(parseSfCommand("sf org list --json"), {
        kind: "org-list",
        all: false,
        skipConnectionStatus: false,
      });
      assert.deepStrictEqual(parseSfCommand("sf org list --all --json"), {
        kind: "org-list",
        all: true,
        skipConnectionStatus: false,
      });
      assert.deepStrictEqual(
        parseSfCommand("sf org list --all --skip-connection-status --json"),
        { kind: "org-list", all: true, skipConnectionStatus: true },
      );
      assert.strictEqual(parseSfCommand("sf org list --clean --json"), null);
      assert.strictEqual(parseSfCommand("sf org list --verbose --json"), null);
      assert.strictEqual(
        parseSfCommand("sf org list metadata-types --target-org u --json"),
        null,
      );
    });

    test("recognizes org list metadata shapes", () => {
      assert.deepStrictEqual(
        parseSfCommand(
          "sf org list metadata --metadata-type ApexClass --target-org u@x.com --json",
        ),
        {
          kind: "list-metadata",
          metadataType: "ApexClass",
          folder: null,
          targetOrg: "u@x.com",
        },
      );
      assert.deepStrictEqual(
        parseSfCommand(
          'sf org list metadata --metadata-type Report --folder "My \\"Folder\\"" --target-org u --json',
        ),
        {
          kind: "list-metadata",
          metadataType: "Report",
          folder: 'My "Folder"',
          targetOrg: "u",
        },
      );
      assert.deepStrictEqual(
        parseSfCommand("sf org list metadata -m Flow --json"),
        { kind: "list-metadata", metadataType: "Flow", folder: null, targetOrg: null },
      );
      assert.strictEqual(parseSfCommand("sf org list metadata --json"), null);
      assert.strictEqual(
        parseSfCommand(
          "sf org list metadata --metadata-type Flow --api-version 60.0 --json",
        ),
        null,
      );
      assert.strictEqual(
        parseSfCommand(
          "sf org list metadata --metadata-type Flow --output-file f.json --json",
        ),
        null,
      );
    });

    test("recognizes data query shapes", () => {
      assert.deepStrictEqual(
        parseSfCommand(
          "sf data query --query \"SELECT Id FROM User WHERE Username = 'a@b.c' LIMIT 1\" --json",
        ),
        {
          kind: "data-query",
          query: "SELECT Id FROM User WHERE Username = 'a@b.c' LIMIT 1",
          targetOrg: null,
          useToolingApi: false,
        },
      );
      assert.deepStrictEqual(
        parseSfCommand(
          'sf data query --query "SELECT Id FROM SourceMember WHERE MemberType IN (\\"ApexClass\\")" --target-org u --use-tooling-api --json',
        ),
        {
          kind: "data-query",
          query: 'SELECT Id FROM SourceMember WHERE MemberType IN ("ApexClass")',
          targetOrg: "u",
          useToolingApi: true,
        },
      );
      assert.deepStrictEqual(
        parseSfCommand(
          'sf data query --use-tooling-api --query "SELECT Id FROM DebugLevel" --json',
        ),
        {
          kind: "data-query",
          query: "SELECT Id FROM DebugLevel",
          targetOrg: null,
          useToolingApi: true,
        },
      );
      assert.strictEqual(parseSfCommand("sf data query --json"), null);
      assert.strictEqual(
        parseSfCommand('sf data query --query "SELECT Id FROM A" --all-rows --json'),
        null,
      );
      assert.strictEqual(
        parseSfCommand(
          'sf data query --query "SELECT Id FROM A" --result-format csv --json',
        ),
        null,
      );
      assert.strictEqual(parseSfCommand("sf data query --file q.soql --json"), null);
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
      assert.strictEqual(parseSfCommand("sf data create record --json"), null);
      assert.strictEqual(parseSfCommand("sf hardis:org:select"), null);
      assert.strictEqual(parseSfCommand("sfdx force:org:display"), null);
      assert.strictEqual(parseSfCommand("git status"), null);
    });
  });

  suite("buildOrgListResult", () => {
    test("buckets, marks defaults and sorts like sf org list --json", () => {
      const prod = {
        username: "prod@x.com",
        alias: "prod",
        isDefaultUsername: true,
        isDevHub: true,
      };
      const sandbox = {
        username: "sb@x.com",
        alias: undefined,
        isSandbox: true,
        isDefaultDevHubUsername: true,
      };
      const other = { username: "other@x.com", alias: "aaa" };
      const active = { username: "s1@x.com", status: "Active", expirationDate: "2030-01-01" };
      const expired = { username: "s2@x.com", status: "Deleted", expirationDate: "2020-01-01" };

      const result = buildOrgListResult([sandbox, prod, other], [expired, active], false);
      assert.deepStrictEqual(
        result.nonScratchOrgs.map((o: any) => o.username),
        ["other@x.com", "prod@x.com", "sb@x.com"],
        "sorted by alias, then username, empty aliases last",
      );
      assert.deepStrictEqual(result.other.map((o: any) => o.username), ["other@x.com"]);
      assert.deepStrictEqual(result.sandboxes.map((o: any) => o.username), ["sb@x.com"]);
      assert.deepStrictEqual(result.devHubs.map((o: any) => o.username), ["prod@x.com"]);
      assert.strictEqual(result.nonScratchOrgs[1].defaultMarker, "(U)");
      assert.strictEqual(result.nonScratchOrgs[2].defaultMarker, "(D)");
      assert.strictEqual(result.nonScratchOrgs[0].defaultMarker, undefined);
      assert.deepStrictEqual(result.scratchOrgs.map((o: any) => o.username), ["s1@x.com"]);

      const withAll = buildOrgListResult([], [expired, active], true);
      assert.strictEqual(withAll.scratchOrgs.length, 2);
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
