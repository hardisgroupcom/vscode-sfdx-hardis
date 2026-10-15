import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isMergeDriverEnabled } from "../../utils/gitMergeDriverUtils";

suite("gitMergeDriverUtils Test Suite", () => {
  let tmpRoot: string;

  setup(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "merge-driver-"));
  });

  teardown(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("returns null without a git repository", async () => {
    assert.strictEqual(await isMergeDriverEnabled(tmpRoot), null);
  });

  test("reads info/attributes of a regular repository", async () => {
    writeAttributes(path.join(tmpRoot, ".git"));
    assert.strictEqual(await isMergeDriverEnabled(tmpRoot), true);
  });

  test("reads info/attributes of the common dir in a linked worktree", async () => {
    const mainGitDir = path.join(tmpRoot, "main", ".git");
    const worktreeGitDir = path.join(mainGitDir, "worktrees", "feature");
    fs.mkdirSync(worktreeGitDir, { recursive: true });
    fs.writeFileSync(path.join(worktreeGitDir, "commondir"), "../..\n");
    const worktreeRoot = path.join(tmpRoot, "feature");
    fs.mkdirSync(worktreeRoot);
    fs.writeFileSync(
      path.join(worktreeRoot, ".git"),
      `gitdir: ${worktreeGitDir}\n`,
    );
    assert.strictEqual(await isMergeDriverEnabled(worktreeRoot), false);
    writeAttributes(mainGitDir);
    assert.strictEqual(await isMergeDriverEnabled(worktreeRoot), true);
  });
});

function writeAttributes(gitDir: string): void {
  fs.mkdirSync(path.join(gitDir, "info"), { recursive: true });
  fs.writeFileSync(
    path.join(gitDir, "info", "attributes"),
    "*.xml merge=salesforce-source\n",
  );
}
