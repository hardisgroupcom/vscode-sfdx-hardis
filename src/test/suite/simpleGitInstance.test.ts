import * as assert from "assert";
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSimpleGit } from "../../utils/simpleGitInstance";

// simple-git v4 removes inherited GIT_* variables (and EDITOR, VISUAL, PAGER, SSH_ASKPASS, PREFIX)
// from the git process unless they are allowed. These tests run real git in throwaway repositories
// and check that createSimpleGit still passes them through, as simple-git v3 did, with the guards
// still on. Nothing here needs the VS Code API.
// The fake GIT_ASKPASS, GIT_CONFIG_*... never go into process.env of the test host, where the
// extension is running: the tests that need them run the factory in a node process of its own.

// Variables given to the child node process only
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

// Runs in a child node process, with TEST_ENV added to its environment: it creates the instances
// the way the extension does and prints the output of each git call as JSON. The bare instance
// proves what createSimpleGit adds.
const CHILD_SCRIPT = `
const [factoryPath, simpleGitPath, repo] = process.argv.slice(2);
const { createSimpleGit } = require(factoryPath);
const { simpleGit } = require(simpleGitPath);
const configGetArgs = ["config", "--default", "hardis-not-set", "--get", "hardis.inherited"];
(async () => {
  const git = createSimpleGit(repo);
  const result = {
    inheritedConfig: await git.raw(["config", "--get", "hardis.inherited"]),
    aliasEnv: await git.raw(["hardis-env"]),
    editor: await git.raw(["var", "GIT_EDITOR"]),
    pager: await git.raw(["var", "GIT_PAGER"]),
    bareConfig: await simpleGit(repo).raw(configGetArgs),
    factoryConfig: await git.raw(configGetArgs),
  };
  process.stdout.write(JSON.stringify(result));
})().catch((e) => {
  process.stderr.write(String((e && e.stack) || e));
  process.exit(1);
});
`;

type ChildGitResult = {
  inheritedConfig: string;
  aliasEnv: string;
  editor: string;
  pager: string;
  bareConfig: string;
  factoryConfig: string;
};

function runGitCallsInChildProcess(
  sandbox: string,
  repo: string,
): Promise<ChildGitResult> {
  const scriptFile = path.join(sandbox, "child-git-calls.js");
  fs.writeFileSync(scriptFile, CHILD_SCRIPT);
  // The test file runs from out/test/suite, next to the compiled factory in out/utils
  const factoryPath = path.resolve(__dirname, "../../utils/simpleGitInstance");
  const simpleGitPath = require.resolve("simple-git");
  return new Promise((resolve, reject) => {
    execFile(
      // In the VS Code test host this is the Electron binary, run as plain node
      process.execPath,
      [scriptFile, factoryPath, simpleGitPath, repo],
      {
        env: { ...process.env, ...TEST_ENV, ELECTRON_RUN_AS_NODE: "1" },
        timeout: 30000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message} ${stderr}`));
          return;
        }
        resolve(JSON.parse(stdout));
      },
    );
  });
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

  teardown(() => {
    for (const dir of sandboxes.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // A temp folder left behind does not fail the test
      }
    }
  });

  suite("inherited environment", () => {
    let result: ChildGitResult;
    suiteSetup(async () => {
      const sandbox = makeSandbox("sg-env");
      const repo = path.join(sandbox, "repo");
      fs.mkdirSync(repo);
      await initRepo(repo);
      result = await runGitCallsInChildProcess(sandbox, repo);
    });

    test("leaves process.env of the test host untouched", () => {
      for (const key of Object.keys(TEST_ENV)) {
        assert.notStrictEqual(process.env[key], TEST_ENV[key], key);
      }
    });

    test("passes GIT_CONFIG_COUNT/KEY/VALUE to git", () => {
      assert.strictEqual(result.inheritedConfig.trim(), "from-ci-runner");
    });

    test("passes GIT_ASKPASS, SSH_ASKPASS and GIT_SSL_CAINFO to git and its child processes", () => {
      const envOutput = result.aliasEnv;
      assert.ok(envOutput.includes("GIT_ASKPASS=hardis-askpass-test"));
      assert.ok(envOutput.includes("SSH_ASKPASS=hardis-ssh-askpass-test"));
      assert.ok(envOutput.includes("GIT_SSL_CAINFO=hardis-ca-test.pem"));
    });

    test("passes GIT_EDITOR and GIT_PAGER, read back by git var", () => {
      assert.strictEqual(result.editor.trim(), "hardis-editor-test");
      assert.strictEqual(result.pager.trim(), "hardis-pager-test");
    });

    test("a bare simple-git instance does not see them: createSimpleGit is what keeps them", () => {
      // --default makes git exit 0 with the sentinel when the key is not set, so any other failure rejects
      assert.strictEqual(result.bareConfig.trim(), "hardis-not-set");
      assert.strictEqual(result.factoryConfig.trim(), "from-ci-runner");
    });

    test("refuses an empty folder instead of running git in process.cwd()", () => {
      assert.throws(() => createSimpleGit(""), /needs the folder/);
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
