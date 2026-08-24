import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { ExtraCommands } from "../../utils/extraCommands";
import { LOCALES, loadLocale, REPO_ROOT } from "./lwcSourceUtils";

const EXTRA_COMMANDS_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, "src", "utils", "extraCommands.ts"),
  "utf8",
);

/**
 * Extracts the i18n keys used by each catalog entry, from the sources.
 *
 * The i18n contract is checked on the sources and not on the runtime output of t():
 * the locale files are copied to out/i18n by webpack, so a tsc-only run (as in CI)
 * has no translation loaded and t() falls back to returning the key itself. Reading
 * the sources makes the check independent from the build steps that ran before.
 */
function extractCommandI18nKeys(): {
  id: string;
  labelKey: string;
  tooltipKey: string;
}[] {
  return [
    ...EXTRA_COMMANDS_SOURCE.matchAll(
      /id:\s*"([^"]+)",\s*label:\s*t\("([a-zA-Z0-9_]+)"\),\s*tooltip:\s*t\("([a-zA-Z0-9_]+)"\),/g,
    ),
  ].map((match) => ({
    id: match[1],
    labelKey: match[2],
    tooltipKey: match[3],
  }));
}

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

  test("all commands have a label and a tooltip", () => {
    for (const command of ExtraCommands.getCommands()) {
      assert.ok(
        command.label.length > 0 && command.label !== command.id,
        `Missing label for ${command.id}`,
      );
      assert.ok(
        command.tooltip.length > 0 && command.tooltip !== command.label,
        `Missing tooltip for ${command.id}`,
      );
    }
  });

  test("all commands build their label and tooltip with t()", () => {
    const commandKeys = extractCommandI18nKeys();
    const catalogIds = ExtraCommands.getCommands().map((command) => command.id);
    // Every entry must declare label: t("key") and tooltip: t("key"), never raw strings
    assert.deepStrictEqual(
      commandKeys.map((commandKey) => commandKey.id),
      catalogIds,
      "Some catalog entries do not use t() for their label and tooltip",
    );
    for (const commandKey of commandKeys) {
      assert.notStrictEqual(
        commandKey.labelKey,
        commandKey.tooltipKey,
        `Label and tooltip of ${commandKey.id} use the same i18n key`,
      );
    }
  });

  test("all i18n keys of the catalog are defined in the 9 locales", () => {
    const usedKeys = extractCommandI18nKeys().flatMap((commandKey) => [
      commandKey.labelKey,
      commandKey.tooltipKey,
    ]);
    assert.ok(
      usedKeys.length > 0,
      "No i18n key extracted from extraCommands.ts",
    );
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      const missingKeys = usedKeys.filter(
        (key) =>
          typeof translations[key] !== "string" ||
          translations[key].trim() === "",
      );
      assert.deepStrictEqual(
        missingKeys,
        [],
        `Missing translations in ${locale}.json for the extra commands catalog`,
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
      `${promoted.command} --some-flag value`,
    ]);
    assert.strictEqual(remaining.length, all.length - 1);
    // Unrelated command lines change nothing
    remaining = ExtraCommands.getCommandsNotAlreadyListed([
      "sf hardis:work:save",
      "vscode-sfdx-hardis.showWelcome",
    ]);
    assert.strictEqual(remaining.length, all.length);
  });

  test("the command search feeds on the catalog, through the anti-duplicate filter", () => {
    const commandsSource = fs.readFileSync(
      path.join(REPO_ROOT, "src", "commands.ts"),
      "utf8",
    );
    // Isolate the body of registerSearchCommands(), not its call in registerCommands()
    const searchStart = commandsSource.indexOf("registerSearchCommands() {");
    assert.ok(
      searchStart > -1,
      "registerSearchCommands() not found in commands.ts",
    );
    const searchEnd = commandsSource.indexOf(
      "registerExecuteCommand() {",
      searchStart,
    );
    assert.ok(
      searchEnd > searchStart,
      "registerExecuteCommand() not found after registerSearchCommands()",
    );
    const searchSource = commandsSource.slice(searchStart, searchEnd);
    assert.ok(
      searchSource.includes("ExtraCommands.getCommandsNotAlreadyListed("),
      "The command search must list the extra commands with getCommandsNotAlreadyListed()",
    );
    assert.ok(
      !searchSource.includes("ExtraCommands.getCommands("),
      "The command search must not call getCommands(): commands promoted to the menu would be displayed twice",
    );
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
