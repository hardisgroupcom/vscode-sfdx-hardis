import * as assert from "assert";
import { readModuleFile } from "./lwcSourceUtils";

/**
 * Contract of the commandExecution LWC on a failed sub-command: the row of that
 * sub-command turns red, and the status pill of the run does not. sfdx-hardis
 * runs commands it expects to fail and carries on (hardis:project:promotion:create
 * commits a conflicting git cherry-pick on purpose, an org lookup answers "not
 * found"), so only the completion status the CLI reports when it exits may say
 * whether the run failed. Found by the training course: a promotion assembled
 * with one conflict, exit code 0, read "Failed" in the panel header while its
 * last line said "Command success".
 */
suite("Command Runner sub-command failure contract", () => {
  const componentSource = readModuleFile(
    "commandExecution",
    "commandExecution.js",
  );

  test("a failed sub-command does not flip the run to Failed", () => {
    const start = componentSource.indexOf("addSubCommandEnd(subCommandData)");
    assert.ok(start > -1, "commandExecution must handle sub-command ends");
    const end = componentSource.indexOf(
      "replaceSubCommandLog(subCommandId",
      start,
    );
    const handler = componentSource.slice(start, end);
    assert.ok(
      !/this\.hasError\s*=\s*true/.test(handler),
      "addSubCommandEnd must not set hasError: the completion status decides",
    );
    assert.ok(
      /logType:\s*subCommandData\.success\s*\?\s*"success"\s*:\s*"error"/.test(
        handler,
      ),
      "the failed sub-command row itself must still be shown as an error",
    );
  });

  test("the completion status still flips the run to Failed", () => {
    assert.match(
      componentSource,
      /if \(!success\) \{\s*this\.hasError = true;\s*\}/,
      "a command that exits in error must show the Failed pill",
    );
  });
});
