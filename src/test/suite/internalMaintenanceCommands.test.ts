import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { INTERNAL_MAINTENANCE_COMMAND_PATTERNS } from "../../command-runner";

/**
 * Commands issued by the extension itself must match one of the internal
 * maintenance patterns, otherwise background mode (the default) rejects them
 * with "This command is not allowed. Only SFDX-Hardis and configured
 * custom/plugin commands can be executed."
 */
function isInternalMaintenanceCommand(command: string): boolean {
  return INTERNAL_MAINTENANCE_COMMAND_PATTERNS.some((pattern) =>
    pattern.test(command.trimStart()),
  );
}

suite("Internal Maintenance Commands Test Suite", () => {
  test("allows the local documentation server for every Python launcher", () => {
    // getPythonCommand() probes these four candidates, in this order
    for (const python of ["python", "python3", "py", "py3"]) {
      const command = `${python} -m pip install zensical mdx_truly_sane_lists && ${python} -m zensical serve`;
      assert.strictEqual(
        isInternalMaintenanceCommand(command),
        true,
        `Run Local HTML Doc Pages must be allowed with ${python}`,
      );
    }
  });

  test("allows the dependency maintenance commands", () => {
    const commands = [
      "sf plugins install sfdx-hardis",
      "sf plugins uninstall sfdx-hardis",
      "echo y | sf plugins install sfdx-hardis",
      "npm install @salesforce/cli --global",
      "npm uninstall sfdx-cli --global",
      "sf update",
      "sf git merge driver enable",
    ];
    for (const command of commands) {
      assert.strictEqual(
        isInternalMaintenanceCommand(command),
        true,
        `${command} must be allowed`,
      );
    }
  });

  test("the Dependencies panel attaches no placeholder shell command", () => {
    // A healthy dependency row must carry no command at all: any placeholder
    // (it used to be `echo "Nothing to do here"`) is neither an sf command nor a
    // registered custom/plugin command, so clicking the row raised
    // commandNotAllowedOnlyRegistered in background mode, which is the default.
    const provider = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "src",
        "hardis-plugins-provider.ts",
      ),
      "utf-8",
    );
    const placeholders = provider.match(/command:\s*`?echo\s+"/g) || [];
    assert.deepStrictEqual(
      placeholders,
      [],
      'Use command: "" for a row with nothing to do, not an echo placeholder',
    );
  });

  test("does not open the terminal path to arbitrary commands", () => {
    const commands = [
      "python -m pip install requests",
      "pip install zensical",
      "rm -rf /",
      "npm install some-package",
      "sf hardis:doc:project2markdown",
    ];
    for (const command of commands) {
      assert.strictEqual(
        isInternalMaintenanceCommand(command),
        false,
        `${command} must not be treated as internal maintenance`,
      );
    }
  });
});
