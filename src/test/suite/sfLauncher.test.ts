import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildSfDirectSpawn, findSfRunJs } from "../../utils/sfLauncher";

suite("sfLauncher Test Suite", () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfdx-hardis-launcher-"));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createCli(cliDir: string, name = "@salesforce/cli"): string {
    fs.mkdirSync(path.join(cliDir, "bin"), { recursive: true });
    fs.writeFileSync(path.join(cliDir, "package.json"), JSON.stringify({ name }));
    const runJs = path.join(cliDir, "bin", "run.js");
    fs.writeFileSync(runJs, "");
    return runJs;
  }

  suite("findSfRunJs", () => {
    test("finds run.js of the npm global install from the sf shim", () => {
      const shim = path.join(tempDir, "sf.cmd");
      fs.writeFileSync(shim, "@echo off\r\n");
      const runJs = createCli(
        path.join(tempDir, "node_modules", "@salesforce", "cli"),
      );
      assert.strictEqual(findSfRunJs(shim), runJs);
    });

    test("finds run.js of a standalone installer (<root>/bin/sf)", () => {
      const runJs = createCli(tempDir);
      const sfBin = path.join(tempDir, "bin", "sf");
      fs.writeFileSync(sfBin, "");
      assert.strictEqual(findSfRunJs(sfBin), runJs);
    });

    test("ignores a bin/run.js that is not the Salesforce CLI", () => {
      createCli(tempDir, "some-other-cli");
      const bin = path.join(tempDir, "bin", "sf");
      fs.writeFileSync(bin, "");
      assert.strictEqual(findSfRunJs(bin), null);
    });
  });

  suite("buildSfDirectSpawn", () => {
    const launch = { nodePath: "/usr/bin/node", runJsPath: "/cli/bin/run.js" };

    test("turns an sf command line into node + run.js argv", () => {
      assert.deepStrictEqual(
        buildSfDirectSpawn(
          'sf hardis:work:new --websocket 2702 --target-org "my alias"',
          launch,
        ),
        {
          file: "/usr/bin/node",
          args: [
            "--no-deprecation",
            "/cli/bin/run.js",
            "hardis:work:new",
            "--websocket",
            "2702",
            "--target-org",
            "my alias",
          ],
        },
      );
    });

    test("keeps the shell launch when it can not be avoided", () => {
      assert.strictEqual(buildSfDirectSpawn("sf hardis:work:new", null), null);
      assert.strictEqual(
        buildSfDirectSpawn("npm install @salesforce/cli", launch),
        null,
      );
      assert.strictEqual(
        buildSfDirectSpawn("sf hardis:work:new | tee log.txt", launch),
        null,
      );
      assert.strictEqual(
        buildSfDirectSpawn("sf hardis:work:new --path ~/x", launch),
        null,
      );
      assert.strictEqual(buildSfDirectSpawn("sf", launch), null);
    });
  });
});
