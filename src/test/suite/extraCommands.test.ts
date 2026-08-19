import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { ExtraCommands } from "../../utils/extraCommands";
import { REPO_ROOT } from "./lwcSourceUtils";

const EN_TRANSLATIONS: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "src", "i18n", "en.json"), "utf8"),
);

suite("extraCommands Test Suite", () => {
  test("catalog is not empty", () => {
    assert.ok(ExtraCommands.getCommands().length > 0);
  });

  test("all commands have a unique id", () => {
    const ids = ExtraCommands.getCommands().map((command) => command.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test("all commands run a sfdx-hardis command line matching their id", () => {
    for (const command of ExtraCommands.getCommands()) {
      assert.strictEqual(
        command.command,
        `sf ${command.id}`,
        `Unexpected command line for ${command.id}`,
      );
    }
  });

  test("all commands have translated label and tooltip", () => {
    const translatedValues = Object.values(EN_TRANSLATIONS);
    for (const command of ExtraCommands.getCommands()) {
      assert.ok(
        command.label.length > 0 && command.label !== command.id,
        `Missing label for ${command.id}`,
      );
      assert.ok(
        command.tooltip.length > 0 && command.tooltip !== command.label,
        `Missing tooltip for ${command.id}`,
      );
      // Labels and tooltips must come from the i18n files, not from raw strings
      assert.ok(
        translatedValues.includes(command.label),
        `Label of ${command.id} is not defined in en.json`,
      );
      assert.ok(
        translatedValues.includes(command.tooltip),
        `Tooltip of ${command.id} is not defined in en.json`,
      );
    }
  });

  test("all commands have a documentation url built from their id", () => {
    for (const command of ExtraCommands.getCommands()) {
      const expectedPath = `/${command.id.replace(/:/g, "/")}/`;
      assert.ok(
        command.helpUrl.endsWith(expectedPath),
        `Unexpected help url for ${command.id}: ${command.helpUrl}`,
      );
    }
  });

  test("getCommand returns the matching command", () => {
    const first = ExtraCommands.getCommands()[0];
    assert.strictEqual(ExtraCommands.getCommand(first.id)?.id, first.id);
    assert.strictEqual(ExtraCommands.getCommand("hardis:nope:nope"), undefined);
  });

  test("isExtraCommand only matches catalog commands", () => {
    assert.ok(ExtraCommands.isExtraCommand("hardis:cache:clear"));
    // Commands displayed in the tree menu must not be duplicated in the catalog
    assert.strictEqual(
      ExtraCommands.isExtraCommand("hardis:org:monitor:backup"),
      false,
    );
  });

  test("no catalog command is already displayed in the tree menu", () => {
    const providerSource = fs.readFileSync(
      path.join(REPO_ROOT, "src", "hardis-commands-provider.ts"),
      "utf8",
    );
    const menuCommandLines = [
      ...providerSource.matchAll(/command:\s*"(sf hardis:[^"]+)"/g),
    ].map((match) => match[1]);
    assert.ok(
      menuCommandLines.length > 50,
      `Suspiciously few commands extracted from the tree menu (${menuCommandLines.length})`,
    );
    const remainingIds = new Set(
      ExtraCommands.getCommandsNotAlreadyListed(menuCommandLines).map(
        (command) => command.id,
      ),
    );
    const duplicates = ExtraCommands.getCommands()
      .map((command) => command.id)
      .filter((id) => !remainingIds.has(id));
    assert.deepStrictEqual(
      duplicates,
      [],
      "These commands are both in the tree menu and in the extra commands catalog: remove them from extraCommands.ts",
    );
  });

  test("getCommandsNotAlreadyListed filters out commands promoted to the menu", () => {
    const all = ExtraCommands.getCommands();
    const promoted = all[0];
    // Same command line
    let remaining = ExtraCommands.getCommandsNotAlreadyListed([
      promoted.command,
    ]);
    assert.strictEqual(remaining.length, all.length - 1);
    assert.ok(!remaining.some((command) => command.id === promoted.id));
    // Same command line with flags added by the menu entry
    remaining = ExtraCommands.getCommandsNotAlreadyListed([
      `${promoted.command} --someflag value`,
    ]);
    assert.strictEqual(remaining.length, all.length - 1);
    // Unrelated command lines change nothing
    remaining = ExtraCommands.getCommandsNotAlreadyListed([
      "sf hardis:work:save",
      "vscode-sfdx-hardis.showWelcome",
    ]);
    assert.strictEqual(remaining.length, all.length);
  });

  test("getCommandsByTopic filters on the suggested topic", () => {
    const monitoringCommands =
      ExtraCommands.getCommandsByTopic("org-monitoring");
    assert.ok(monitoringCommands.length > 0);
    assert.ok(
      monitoringCommands.every(
        (command) => command.suggestedTopic === "org-monitoring",
      ),
    );
  });
});
