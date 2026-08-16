import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  listPrePostCommandsForPullRequest,
  savePrePostCommand,
} from "../../utils/prePostCommandsUtils";
import { PullRequest } from "../../utils/gitProviders/types";

// Minimal PullRequest-shaped object: only `number` is read by the functions
// under test.
function pr(number: number): PullRequest {
  return { id: String(number), title: "Test PR", number } as PullRequest;
}

function actionsFilePath(workspaceRoot: string, prNumber: number): string {
  const fileName =
    prNumber === -1 ? ".sfdx-hardis.draft.yml" : `.sfdx-hardis.${prNumber}.yml`;
  return path.join(workspaceRoot, "scripts", "actions", fileName);
}

function writeActionsFile(
  workspaceRoot: string,
  prNumber: number,
  content: Record<string, unknown>,
): void {
  const filePath = actionsFilePath(workspaceRoot, prNumber);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(content), "utf8");
}

function readActionsFile(workspaceRoot: string, prNumber: number): any {
  const filePath = actionsFilePath(workspaceRoot, prNumber);
  return yaml.load(fs.readFileSync(filePath, "utf8"));
}

suite("prePostCommandsUtils Test Suite", () => {
  let workspaceRoot: string;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "sfdx-hardis-preposttest-"),
    );
  });

  teardown(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  suite("runOnlyOnceByOrg default (BUG 1)", () => {
    test("defaults a missing value to true when listing, matching the CLI default", async () => {
      writeActionsFile(workspaceRoot, 42, {
        commandsPreDeploy: [
          { id: "a1", label: "No explicit value", type: "command", command: "echo hi" },
        ],
      });

      const commands = await listPrePostCommandsForPullRequest(
        pr(42),
        workspaceRoot,
      );

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].runOnlyOnceByOrg, true);
    });

    test("preserves an explicit false value when listing", async () => {
      writeActionsFile(workspaceRoot, 42, {
        commandsPreDeploy: [
          {
            id: "a1",
            label: "Explicit false",
            type: "command",
            command: "echo hi",
            runOnlyOnceByOrg: false,
          },
        ],
      });

      const commands = await listPrePostCommandsForPullRequest(
        pr(42),
        workspaceRoot,
      );

      assert.strictEqual(commands[0].runOnlyOnceByOrg, false);
    });

    test("writes the value explicitly (not dropped) when saving true or false", async () => {
      await savePrePostCommand(
        -1,
        {
          id: "keep-true",
          label: "Keep true",
          type: "command",
          command: "echo true",
          when: "pre-deploy",
          context: "all",
          runOnlyOnceByOrg: true,
        } as any,
        null,
        workspaceRoot,
      );
      await savePrePostCommand(
        -1,
        {
          id: "keep-false",
          label: "Keep false",
          type: "command",
          command: "echo false",
          when: "pre-deploy",
          context: "all",
          runOnlyOnceByOrg: false,
        } as any,
        null,
        workspaceRoot,
      );

      const saved = readActionsFile(workspaceRoot, -1);
      const byId = (id: string) =>
        saved.commandsPreDeploy.find((cmd: any) => cmd.id === id);

      assert.strictEqual(byId("keep-true").runOnlyOnceByOrg, true);
      assert.strictEqual(byId("keep-false").runOnlyOnceByOrg, false);
    });
  });

  suite("editing an id-less (hand-written) action (BUG 2)", () => {
    test("updates the matching entry instead of duplicating it when renamed", async () => {
      writeActionsFile(workspaceRoot, -1, {
        commandsPreDeploy: [
          {
            label: "Old label",
            type: "command",
            command: "echo old",
            context: "all",
          },
        ],
      });

      // Simulate the editor: it generates a fresh id since the hand-written
      // entry has none, and the fields have already been edited by the user.
      await savePrePostCommand(
        -1,
        {
          id: "freshly-generated-id",
          label: "New label",
          type: "command",
          command: "echo new",
          when: "pre-deploy",
          context: "all",
        } as any,
        // Snapshot of the action BEFORE the edit
        {
          id: "",
          label: "Old label",
          type: "command",
          command: "echo old",
          when: "pre-deploy",
        },
        workspaceRoot,
      );

      const saved = readActionsFile(workspaceRoot, -1);
      assert.strictEqual(saved.commandsPreDeploy.length, 1);
      assert.strictEqual(saved.commandsPreDeploy[0].label, "New label");
      assert.strictEqual(saved.commandsPreDeploy[0].command, "echo new");
      assert.strictEqual(
        saved.commandsPreDeploy[0].id,
        "freshly-generated-id",
      );
    });

    test("still appends a genuinely new action when no snapshot is provided", async () => {
      writeActionsFile(workspaceRoot, -1, {
        commandsPreDeploy: [
          {
            label: "Existing",
            type: "command",
            command: "echo existing",
            context: "all",
          },
        ],
      });

      await savePrePostCommand(
        -1,
        {
          id: "new-action-id",
          label: "Brand new",
          type: "command",
          command: "echo brand new",
          when: "pre-deploy",
          context: "all",
        } as any,
        null,
        workspaceRoot,
      );

      const saved = readActionsFile(workspaceRoot, -1);
      assert.strictEqual(saved.commandsPreDeploy.length, 2);
    });

    test("updates in place when a second edit renames the entry again", async () => {
      writeActionsFile(workspaceRoot, -1, {
        commandsPreDeploy: [
          { label: "Original", type: "command", command: "echo v1", context: "all" },
        ],
      });

      // First edit: label and command change, an id is assigned
      await savePrePostCommand(
        -1,
        {
          id: "id-1",
          label: "Renamed once",
          type: "command",
          command: "echo v2",
          when: "pre-deploy",
          context: "all",
        } as any,
        { id: "", label: "Original", type: "command", command: "echo v1", when: "pre-deploy" },
        workspaceRoot,
      );

      // Second edit: now matched by id, content can change freely
      await savePrePostCommand(
        -1,
        {
          id: "id-1",
          label: "Renamed twice",
          type: "command",
          command: "echo v3",
          when: "pre-deploy",
          context: "all",
        } as any,
        {
          id: "id-1",
          label: "Renamed once",
          type: "command",
          command: "echo v2",
          when: "pre-deploy",
        },
        workspaceRoot,
      );

      const saved = readActionsFile(workspaceRoot, -1);
      assert.strictEqual(saved.commandsPreDeploy.length, 1);
      assert.strictEqual(saved.commandsPreDeploy[0].label, "Renamed twice");
    });
  });

  suite("switching when between pre-deploy and post-deploy (BUG 3)", () => {
    test("moves the action instead of copying it", async () => {
      writeActionsFile(workspaceRoot, 7, {
        commandsPreDeploy: [
          {
            id: "move-me",
            label: "Runs before",
            type: "command",
            command: "echo before",
            context: "all",
          },
        ],
        commandsPostDeploy: [],
      });

      await savePrePostCommand(
        7,
        {
          id: "move-me",
          label: "Runs before",
          type: "command",
          command: "echo before",
          when: "post-deploy",
          context: "all",
        } as any,
        {
          id: "move-me",
          label: "Runs before",
          type: "command",
          command: "echo before",
          when: "pre-deploy",
        },
        workspaceRoot,
      );

      const saved = readActionsFile(workspaceRoot, 7);
      assert.strictEqual(saved.commandsPreDeploy.length, 0);
      assert.strictEqual(saved.commandsPostDeploy.length, 1);
      assert.strictEqual(saved.commandsPostDeploy[0].id, "move-me");
    });

    test("moves a hand-written (id-less) action matched by content", async () => {
      writeActionsFile(workspaceRoot, 7, {
        commandsPreDeploy: [
          {
            label: "Hand written",
            type: "command",
            command: "echo hand written",
            context: "all",
          },
        ],
        commandsPostDeploy: [],
      });

      await savePrePostCommand(
        7,
        {
          id: "generated-id",
          label: "Hand written",
          type: "command",
          command: "echo hand written",
          when: "post-deploy",
          context: "all",
        } as any,
        {
          id: "",
          label: "Hand written",
          type: "command",
          command: "echo hand written",
          when: "pre-deploy",
        },
        workspaceRoot,
      );

      const saved = readActionsFile(workspaceRoot, 7);
      assert.strictEqual(saved.commandsPreDeploy.length, 0);
      assert.strictEqual(saved.commandsPostDeploy.length, 1);
    });

    test("leaves both lists untouched when when is not changed", async () => {
      writeActionsFile(workspaceRoot, 7, {
        commandsPreDeploy: [
          {
            id: "stay-here",
            label: "Stays",
            type: "command",
            command: "echo stays",
            context: "all",
          },
        ],
        commandsPostDeploy: [],
      });

      await savePrePostCommand(
        7,
        {
          id: "stay-here",
          label: "Stays edited",
          type: "command",
          command: "echo stays",
          when: "pre-deploy",
          context: "all",
        } as any,
        {
          id: "stay-here",
          label: "Stays",
          type: "command",
          command: "echo stays",
          when: "pre-deploy",
        },
        workspaceRoot,
      );

      const saved = readActionsFile(workspaceRoot, 7);
      assert.strictEqual(saved.commandsPreDeploy.length, 1);
      assert.strictEqual(saved.commandsPostDeploy.length, 0);
      assert.strictEqual(saved.commandsPreDeploy[0].label, "Stays edited");
    });
  });
});
