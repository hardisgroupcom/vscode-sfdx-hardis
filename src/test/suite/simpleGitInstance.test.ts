import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
// A bare instance is needed here to prove what createSimpleGit adds
// eslint-disable-next-line no-restricted-imports
import { simpleGit } from "simple-git";
import { createSimpleGit } from "../../utils/simpleGitInstance";

// simple-git v4 removes inherited GIT_* variables (and EDITOR, VISUAL, PAGER, SSH_ASKPASS, PREFIX)
// from the git process unless they are allowed. These tests run real git in throwaway repositories
// and check that createSimpleGit still passes them through, as simple-git v3 did, with the guards
// still on. Nothing here needs the VS Code API.

// Variables a test sets in process.env, put back to their original value afterwards
const TEST_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "hardis.inherited",
  GIT_CONFIG_VALUE_0: "from-ci-runner",
  // An alias printing the environment git gives to its child processes
  GIT_CONFIG_KEY_1: "alias.hardis-env",
  GIT_CONFIG_VALUE_1: "!env",
  GIT_ASKPASS: "hardis-askpass-test",
  SSH_ASKPASS: "hardis-ssh-askpass-test",
  GIT_SSL_CAINFO: "hardis-ca-test.pem",
  GIT_EDITOR: "hardis-editor-test",
  GIT_PAGER: "hardis-pager-test",
};

const sandboxes: string[] = [];

function makeSandbox(name: string): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `hardis-${name}-`)),
  );
  sandboxes.push(dir);
  return dir;
}

async function initRepo(dir: string): Promise<void> {
  const git = createSimpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "hardis-test@example.com");
  await git.addConfig("user.name", "Hardis Test");
  await git.addConfig("commit.gpgsign", "false");
  await git.checkoutLocalBranch("main");
}

async function writeAndCommit(
  dir: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
  const git = createSimpleGit(dir);
  await git.add([file]);
  await git.commit(message);
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e: any) {
    return String(e?.message || e);
  }
  return "";
}

suite("simpleGitInstance Test Suite", function () {
  this.timeout(60000);
  const originalEnv: Record<string, string | undefined> = {};

  suiteSetup(() => {
    for (const key of Object.keys(TEST_ENV)) {
      originalEnv[key] = process.env[key];
    }
  });

  teardown(() => {
    for (const key of Object.keys(TEST_ENV)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    for (const dir of sandboxes.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // A temp folder left behind does not fail the test
      }
    }
  });

  suite("inherited environment", () => {
    let repo: string;
    setup(async () => {
      repo = makeSandbox("sg-env");
      await initRepo(repo);
      Object.assign(process.env, TEST_ENV);
    });

    test("passes GIT_CONFIG_COUNT/KEY/VALUE to git", async () => {
      const value = await createSimpleGit(repo).raw([
        "config",
        "--get",
        "hardis.inherited",
      ]);
      assert.strictEqual(value.trim(), "from-ci-runner");
    });

    test("passes GIT_ASKPASS, SSH_ASKPASS and GIT_SSL_CAINFO to git and its child processes", async () => {
      const envOutput = await createSimpleGit(repo).raw(["hardis-env"]);
      assert.ok(envOutput.includes("GIT_ASKPASS=hardis-askpass-test"));
      assert.ok(envOutput.includes("SSH_ASKPASS=hardis-ssh-askpass-test"));
      assert.ok(envOutput.includes("GIT_SSL_CAINFO=hardis-ca-test.pem"));
    });

    test("passes GIT_EDITOR and GIT_PAGER, read back by git var", async () => {
      const editor = await createSimpleGit(repo).raw(["var", "GIT_EDITOR"]);
      assert.strictEqual(editor.trim(), "hardis-editor-test");
      const pager = await createSimpleGit(repo).raw(["var", "GIT_PAGER"]);
      assert.strictEqual(pager.trim(), "hardis-pager-test");
    });

    test("a bare simple-git instance does not see them: createSimpleGit is what keeps them", async () => {
      // --default makes git exit 0 with the sentinel when the key is not set, so any other failure rejects
      const configGetArgs = [
        "config",
        "--default",
        "hardis-not-set",
        "--get",
        "hardis.inherited",
      ];
      const bareValue = await simpleGit(repo).raw(configGetArgs);
      assert.strictEqual(bareValue.trim(), "hardis-not-set");
      const value = await createSimpleGit(repo).raw(configGetArgs);
      assert.strictEqual(value.trim(), "from-ci-runner");
    });
  });

  suite("guards kept on", () => {
    let repo: string;
    setup(async () => {
      repo = makeSandbox("sg-guards");
      await initRepo(repo);
      await writeAndCommit(repo, "a.txt", "a\n", "first");
    });

    test("refuses an abbreviated long option that git alone would accept", async () => {
      // --dry is an unambiguous abbreviation of --dry-run: git accepts it unless GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS is set
      const args = ["commit", "--allow-empty", "--dry", "-m", "x"];
      const message = await rejectionMessage(createSimpleGit(repo).raw(args));
      assert.ok(message.includes("allowAbbreviatedOptions"), message);
      assert.ok(message.includes("disallowed abbreviated"), message);

      const output = await createSimpleGit(repo, {
        unsafe: { allowAbbreviatedOptions: true },
      }).raw(args);
      assert.ok(output.includes("nothing to commit"), output);
    });

    test("refuses an unsafe config key unless the instance allows it", async () => {
      const message = await rejectionMessage(
        createSimpleGit(repo).addConfig(
          "difftool.vscode.cmd",
          "code --wait --diff $LOCAL $REMOTE",
        ),
      );
      assert.ok(message.includes("allowUnsafeDiffExternal"), message);

      await createSimpleGit(repo, {
        unsafe: { allowUnsafeDiffExternal: true },
      }).addConfig("difftool.vscode.cmd", "code --wait --diff $LOCAL $REMOTE");
      const value = await createSimpleGit(repo).raw([
        "config",
        "--get",
        "difftool.vscode.cmd",
      ]);
      assert.strictEqual(value.trim(), "code --wait --diff $LOCAL $REMOTE");
    });
  });

  suite("git operations the extension runs", () => {
    test("every git call of the extension works with the arguments it passes", async () => {
      // A bare origin, a clone of it, and a branch pushed from a second clone
      const root = makeSandbox("sg-ops");
      const seed = path.join(root, "seed");
      fs.mkdirSync(seed);
      await initRepo(seed);
      await writeAndCommit(
        seed,
        "config/.sfdx-hardis.yml",
        "monitoringCommands: []\n",
        "first",
      );
      const origin = path.join(root, "origin.git");
      await createSimpleGit(root).clone(seed, origin, ["--bare"]);

      // showOrgMonitoring: clone, then read the origin of the folder
      const work = path.join(root, "work");
      await createSimpleGit(root).clone(origin, work);
      const originUrl = await createSimpleGit(work).remote([
        "get-url",
        "origin",
      ]);
      assert.strictEqual(path.resolve((originUrl || "").trim()), origin);
      const workGit = createSimpleGit(work);
      await workGit.addConfig("user.email", "hardis-test@example.com");
      await workGit.addConfig("user.name", "Hardis Test");
      await workGit.addConfig("commit.gpgsign", "false");

      // A new commit on origin/main and a new branch, pushed from another clone
      const other = path.join(root, "other");
      await createSimpleGit(root).clone(origin, other);
      const otherGit = createSimpleGit(other);
      await otherGit.addConfig("user.email", "hardis-test@example.com");
      await otherGit.addConfig("user.name", "Hardis Test");
      await otherGit.addConfig("commit.gpgsign", "false");
      await writeAndCommit(other, "b.txt", "b\n", "add b");
      await otherGit.push("origin", "main");
      await otherGit.checkoutLocalBranch("monitoring_acme");
      await writeAndCommit(other, "c.txt", "c\n", "add c");
      await otherGit.push(["--set-upstream", "origin", "monitoring_acme"]);

      // status provider, git provider, sfdxHardisConfig
      assert.strictEqual(await workGit.checkIsRepo(), true);
      const remotes = await workGit.getRemotes(true);
      assert.deepStrictEqual(
        remotes.map((remote) => remote.name),
        ["origin"],
      );
      const inside = await workGit.raw(["rev-parse", "--is-inside-work-tree"]);
      assert.strictEqual(inside.trim(), "true");
      assert.strictEqual((await workGit.branchLocal()).current, "main");
      const abbrevRef = await createSimpleGit(work, { trimmed: true }).raw(
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      );
      assert.strictEqual(abbrevRef, "main");

      // showPipeline: ls-remote, fetch, revparse, rev-list --left-right --count
      const heads = await workGit.raw([
        "ls-remote",
        "--heads",
        "origin",
        "monitoring_acme",
      ]);
      assert.ok(heads.includes("refs/heads/monitoring_acme"), heads);
      await workGit.raw(["fetch", "origin", "main"]);
      const remoteHead = (await workGit.revparse(["origin/main"])).trim();
      assert.strictEqual(remoteHead.length, 40);
      const counts = (
        await workGit.raw([
          "rev-list",
          "--left-right",
          "--count",
          "HEAD...origin/main",
        ])
      )
        .trim()
        .split(/\s+/);
      assert.deepStrictEqual(counts, ["0", "1"]);

      // gitFileReader: fetch with a full refspec and a timeout, ls-tree, show
      await createSimpleGit(work, { timeout: { block: 10000 } }).raw([
        "fetch",
        "origin",
        "+refs/heads/monitoring_acme:refs/remotes/origin/monitoring_acme",
      ]);
      const listed = await workGit.raw([
        "ls-tree",
        "--name-only",
        "origin/monitoring_acme",
        "config/",
      ]);
      assert.strictEqual(listed.trim(), "config/.sfdx-hardis.yml");
      const shown = await workGit.raw([
        "show",
        "origin/monitoring_acme:./config/.sfdx-hardis.yml",
      ]);
      assert.strictEqual(shown, "monitoringCommands: []\n");

      // monitoringConfigUtils: for-each-ref with a format
      const refs = await workGit.raw([
        "for-each-ref",
        "--format=%(refname:short)|%(committerdate:unix)",
        "refs/heads",
        "refs/remotes/origin",
      ]);
      assert.ok(refs.includes("origin/monitoring_acme|"), refs);

      // status provider: fetch, rev-list --count, log -n
      await workGit.fetch("origin", "main");
      const behind = await workGit.raw([
        "rev-list",
        "--count",
        "main..origin/main",
      ]);
      assert.strictEqual(behind.trim(), "1");
      const log = await workGit.log(["-n", "100", "main"]);
      assert.deepStrictEqual(
        log.all.map((commit) => commit.message),
        ["first"],
      );

      // utils.getGitParentBranch
      const showBranch = await createSimpleGit(work, { trimmed: true }).raw(
        "show-branch",
        "-a",
      );
      assert.ok(showBranch.includes("[main]"), showBranch);

      // showBackpromote: status, stash, checkout, stash list / pop, merge
      fs.writeFileSync(path.join(work, "local.txt"), "local\n");
      await workGit.add(["local.txt"]);
      assert.strictEqual((await workGit.status()).isClean(), false);
      await workGit.stash(["push", "-m", "hardis-backpromote-test"]);
      assert.strictEqual((await workGit.status()).isClean(), true);
      await workGit.checkoutLocalBranch("feature/one");
      await workGit.checkout("main");
      const stashes = await workGit.stashList();
      const index = stashes.all.findIndex((entry) =>
        (entry.message || "").includes("hardis-backpromote-test"),
      );
      assert.strictEqual(index, 0);
      await workGit.stash(["pop", `stash@{${index}}`]);
      assert.ok(fs.existsSync(path.join(work, "local.txt")));
      await workGit.merge(["origin/main"]);
      assert.ok(fs.existsSync(path.join(work, "b.txt")));
    });
  });
});
