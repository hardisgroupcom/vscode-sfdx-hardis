// cspell:ignore gpgsign
import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import { completePullRequestsWithActions } from "../../utils/prePostCommandsUtils";
import { PullRequest } from "../../utils/gitProviders/types";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function actionsFile(labels: string[], testClasses: string[] = []): string {
  return yaml.dump({
    commandsPreDeploy: labels.map((label, index) => ({
      id: `id-${index}`,
      label,
      type: "command",
      command: "echo hi",
    })),
    ...(testClasses.length ? { deploymentApexTestClasses: testClasses } : {}),
  });
}

function commitActions(
  repo: string,
  prNumber: number,
  content: string,
  message: string,
): void {
  const dir = path.join(repo, "scripts", "actions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `.sfdx-hardis.${prNumber}.yml`), content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
}

function pullRequest(overrides: Partial<PullRequest>): PullRequest {
  return {
    id: String(overrides.number ?? ""),
    title: "Story",
    authorLabel: "someone",
    jobsStatus: "unknown",
    state: "open",
    ...overrides,
  } as PullRequest;
}

suite("Actions of a Pull Request whose branch is not checked out", () => {
  let tmp: string;
  let work: string;
  let other: string;

  const load = async (pr: PullRequest, fetch = false) =>
    (
      await completePullRequestsWithActions([pr], {
        workspaceRoot: work,
        currentBranch: "integration",
        fetch,
      })
    )[0];

  setup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfdx-hardis-pr-actions-"));
    const origin = path.join(tmp, "origin.git");
    work = path.join(tmp, "work");
    other = path.join(tmp, "other");
    fs.mkdirSync(origin);
    git(origin, "init", "-q", "--bare", "-b", "integration");
    git(tmp, "clone", "-q", origin, "work");
    git(work, "checkout", "-q", "-b", "integration");
    fs.writeFileSync(path.join(work, "README.md"), "project");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "init");
    git(work, "push", "-q", "-u", "origin", "integration");
    // The story branch holds the actions of Pull Request 505, and uat already received them
    git(work, "checkout", "-q", "-b", "feature/story");
    commitActions(
      work,
      505,
      actionsFile(["First", "Second"], ["StoryTest"]),
      "actions",
    );
    git(work, "push", "-q", "-u", "origin", "feature/story");
    git(work, "checkout", "-q", "-b", "uat");
    git(work, "push", "-q", "-u", "origin", "uat");
    git(work, "checkout", "-q", "integration");
    git(tmp, "clone", "-q", origin, "other");
  });

  teardown(() => {
    // git writes its objects read-only, which stops the removal on Windows
    const makeWritable = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          makeWritable(full);
        } else {
          fs.chmodSync(full, 0o666);
        }
      }
    };
    makeWritable(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("an open Pull Request is read from its source branch, without any checkout", async () => {
    const pr = await load(
      pullRequest({ number: 505, sourceBranch: "feature/story" }),
    );
    assert.deepStrictEqual(
      (pr.deploymentActions || []).map((action) => action.label),
      ["First", "Second"],
    );
    assert.deepStrictEqual(pr.deploymentApexTestClasses, ["StoryTest"]);
    assert.strictEqual(pr.deploymentActionsSource, "branch");
    assert.strictEqual(pr.deploymentActionsBranch, "feature/story");
    assert.strictEqual(pr.deploymentActions?.[0].when, "pre-deploy");
    assert.strictEqual(pr.deploymentActions?.[0].pullRequest?.number, 505);
    // Nothing moved in the working tree
    assert.strictEqual(
      git(work, "rev-parse", "--abbrev-ref", "HEAD").trim(),
      "integration",
    );
    assert.strictEqual(git(work, "status", "--porcelain").trim(), "");
  });

  test("the file of the checked out branch wins, and stays editable", async () => {
    const dir = path.join(work, "scripts", "actions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".sfdx-hardis.505.yml"),
      actionsFile(["Local"]),
    );
    const pr = await load(
      pullRequest({ number: 505, sourceBranch: "feature/story" }),
    );
    assert.deepStrictEqual(
      (pr.deploymentActions || []).map((action) => action.label),
      ["Local"],
    );
    assert.strictEqual(pr.deploymentActionsSource, "workingTree");
    assert.strictEqual(pr.deploymentActionsBranch, undefined);
  });

  test("the Pull Request of the checked out branch without actions yet can receive some", async () => {
    const pr = await load(
      pullRequest({ number: 600, sourceBranch: "integration" }),
    );
    assert.deepStrictEqual(pr.deploymentActions, []);
    assert.strictEqual(pr.deploymentActionsSource, "workingTree");
  });

  test("an open Pull Request without actions names its branch as the place to add some", async () => {
    const pr = await load(
      pullRequest({ number: 506, sourceBranch: "feature/story" }),
    );
    assert.deepStrictEqual(pr.deploymentActions, []);
    assert.strictEqual(pr.deploymentActionsSource, "branch");
    assert.strictEqual(pr.deploymentActionsBranch, "feature/story");
  });

  test("an open Pull Request whose branch is not in the repository is unreadable", async () => {
    const pr = await load(
      pullRequest({ number: 507, sourceBranch: "someone/fork-branch" }),
    );
    assert.deepStrictEqual(pr.deploymentActions, []);
    assert.strictEqual(pr.deploymentActionsSource, "unreadable");
  });

  test("a merged Pull Request is read from its target branch", async () => {
    const pr = await load(
      pullRequest({
        number: 505,
        state: "merged",
        sourceBranch: "feature/deleted-since",
        targetBranch: "uat",
      }),
    );
    assert.strictEqual((pr.deploymentActions || []).length, 2);
    assert.strictEqual(pr.deploymentActionsSource, "branch");
    assert.strictEqual(pr.deploymentActionsBranch, "uat");
  });

  test("a merged Pull Request without actions anywhere behaves as before", async () => {
    for (const targetBranch of ["uat", "integration", "gone"]) {
      const pr = await load(
        pullRequest({ number: 700, state: "merged", targetBranch }),
      );
      assert.deepStrictEqual(pr.deploymentActions, []);
      assert.strictEqual(pr.deploymentActionsSource, "workingTree");
    }
  });

  test("a fetch brings what was pushed to the branch since the last one", async () => {
    git(other, "checkout", "-q", "feature/story");
    commitActions(
      other,
      505,
      actionsFile(["First", "Second", "Third"]),
      "third",
    );
    git(other, "push", "-q");
    const open = () =>
      pullRequest({ number: 505, sourceBranch: "feature/story" });
    assert.strictEqual((await load(open())).deploymentActions?.length, 2);
    assert.strictEqual((await load(open(), true)).deploymentActions?.length, 3);
  });

  test("a clone limited to one branch reads the other one once fetched", async () => {
    const single = path.join(tmp, "single");
    git(
      tmp,
      "clone",
      "-q",
      "--single-branch",
      "--branch",
      "integration",
      path.join(tmp, "origin.git"),
      "single",
    );
    const read = async (fetch: boolean) =>
      (
        await completePullRequestsWithActions(
          [pullRequest({ number: 505, sourceBranch: "feature/story" })],
          { workspaceRoot: single, currentBranch: "integration", fetch },
        )
      )[0];
    assert.strictEqual(
      (await read(false)).deploymentActionsSource,
      "unreadable",
    );
    const fetched = await read(true);
    assert.strictEqual(fetched.deploymentActionsSource, "branch");
    assert.strictEqual(fetched.deploymentActions?.length, 2);
  });

  test("a project in a subfolder of the repository reads its own actions file", async () => {
    git(work, "checkout", "-q", "-b", "feature/sub");
    commitActions(work, 900, actionsFile(["Root"]), "root actions");
    commitActions(
      path.join(work, "sub"),
      900,
      actionsFile(["Project"]),
      "project actions",
    );
    git(work, "push", "-q", "-u", "origin", "feature/sub");
    git(work, "checkout", "-q", "integration");
    const project = path.join(work, "sub");
    fs.mkdirSync(project, { recursive: true });
    const [pr] = await completePullRequestsWithActions(
      [pullRequest({ number: 900, sourceBranch: "feature/sub" })],
      { workspaceRoot: project, currentBranch: "integration" },
    );
    assert.deepStrictEqual(
      (pr.deploymentActions || []).map((action) => action.label),
      ["Project"],
    );
  });

  test("a list reads each branch once", async () => {
    const prs = [505, 801, 802, 803].map((number) =>
      pullRequest({ number, state: "merged", targetBranch: "uat" }),
    );
    await completePullRequestsWithActions(prs, {
      workspaceRoot: work,
      currentBranch: "integration",
    });
    assert.deepStrictEqual(
      prs.map((pr) => pr.deploymentActionsSource),
      ["branch", "workingTree", "workingTree", "workingTree"],
    );
  });
});
