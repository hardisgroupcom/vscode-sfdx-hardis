import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findExecutable } from "../../utils/executableUtils";

suite("executableUtils Test Suite", () => {
  const originalPath = process.env.PATH;
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfdx-hardis-which-test-"));
  });

  teardown(() => {
    process.env.PATH = originalPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("finds an executable prepended to PATH", async () => {
    const isWindows = process.platform === "win32";
    const fileName = isWindows ? "fake-tool.cmd" : "fake-tool";
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, isWindows ? "@echo off\r\n" : "#!/bin/sh\necho hi\n");
    if (!isWindows) {
      fs.chmodSync(filePath, 0o755);
    }
    process.env.PATH = `${tempDir}${path.delimiter}${originalPath || ""}`;

    const found = await findExecutable("fake-tool");
    // On Windows, the extension casing follows PATHEXT (e.g. ".CMD"), while the
    // filesystem itself is case-insensitive: compare case-insensitively there.
    if (isWindows) {
      assert.strictEqual(found.toLowerCase(), filePath.toLowerCase());
    } else {
      assert.strictEqual(found, filePath);
    }
  });

  test("rejects when the executable cannot be found", async () => {
    process.env.PATH = tempDir;
    await assert.rejects(() => findExecutable("this-tool-does-not-exist"));
  });
});
