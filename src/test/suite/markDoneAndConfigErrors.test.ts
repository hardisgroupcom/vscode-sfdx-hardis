import * as assert from "assert";
import {
  assertKeysTranslated,
  extractMember,
  readModuleFile,
  readSourceFile,
} from "./lwcSourceUtils";

/**
 * Two things a user was left waiting or guessing on:
 *  - Mark as done ran sfdx-hardis twice, once to write and once to read back what it had just
 *    written. Each run starts the CLI, which is most of its time: the write now answers with
 *    the statuses, and the panel shows them.
 *  - A project configuration that cannot be read (git conflict markers after a merge) silently
 *    turned off whatever it enabled. It is now said in an error message.
 */
suite("Mark as done and unreadable configuration", () => {
  const js = readModuleFile("pipeline", "pipeline.js");

  function panel(state: Record<string, any> = {}): any {
    const requests: any[] = [];
    const view = Object.assign(
      new Function(
        `return { ${extractMember(js, "handleDeploymentActionMarkDoneResult(data)")} };`,
      )(),
      {
        modalActionStatuses: { 486: [{ actionId: "a", status: "manual" }] },
        markingDoneKeys: ["486|a|preprod", "12|b|uat"],
        markDoneRefreshingKeys: [] as string[],
        isPromotionModeShown: false,
        ["_requestActionStatuses"]: (options: any) => requests.push(options),
      },
      state,
    );
    return { view, requests };
  }

  test("the statuses the command answered are shown without asking for them again", () => {
    const { view, requests } = panel();
    view.handleDeploymentActionMarkDoneResult({
      key: "486|a|preprod",
      ok: true,
      statuses: { 486: [{ actionId: "a", status: "success" }] },
    });
    assert.deepStrictEqual(view.modalActionStatuses[486], [
      { actionId: "a", status: "success" },
    ]);
    // Its button stops spinning, the other one keeps going
    assert.deepStrictEqual(view.markingDoneKeys, ["12|b|uat"]);
    assert.deepStrictEqual(requests, []);
  });

  test("the statuses of the other Pull Requests of the window are kept", () => {
    const { view } = panel({
      modalActionStatuses: { 486: [], 490: [{ actionId: "z" }] },
    });
    view.handleDeploymentActionMarkDoneResult({
      key: "486|a|preprod",
      ok: true,
      statuses: { 486: [{ actionId: "a", status: "success" }] },
    });
    assert.deepStrictEqual(view.modalActionStatuses[490], [{ actionId: "z" }]);
  });

  test("an older sfdx-hardis answers without statuses: the panel reads them", () => {
    const { view, requests } = panel();
    view.handleDeploymentActionMarkDoneResult({
      key: "486|a|preprod",
      ok: true,
    });
    assert.deepStrictEqual(requests, [{ refresh: true }]);
    assert.deepStrictEqual(view.markDoneRefreshingKeys, ["486|a|preprod"]);
    // Still spinning until the statuses are back
    assert.ok(view.markingDoneKeys.includes("486|a|preprod"));
  });

  test("in Next promotion mode the forecast has to be read again", () => {
    const { view, requests } = panel({ isPromotionModeShown: true });
    view.handleDeploymentActionMarkDoneResult({
      key: "486|a|preprod",
      ok: true,
      statuses: { 486: [] },
    });
    assert.deepStrictEqual(requests, [{ refresh: true }]);
  });

  test("a failed command stops the button and changes nothing", () => {
    const { view, requests } = panel();
    view.handleDeploymentActionMarkDoneResult({
      key: "486|a|preprod",
      ok: false,
    });
    assert.deepStrictEqual(view.markingDoneKeys, ["12|b|uat"]);
    assert.deepStrictEqual(requests, []);
    assert.deepStrictEqual(view.modalActionStatuses[486], [
      { actionId: "a", status: "manual" },
    ]);
  });

  test("the extension hands the statuses of the command to the panel", () => {
    const host = readSourceFile("commands/showPipeline.ts");
    assert.match(host, /const statuses = result\?\.result\?\.statuses;/);
    assert.match(host, /data: \{ key: data\?\.key, \.\.\.outcome \}/);
  });

  test("a configuration that cannot be read is said in an error message, once", () => {
    const source = readSourceFile("utils/pipeline/sfdxHardisConfig.ts");
    // Run for real, with the message box replaced
    const shown: string[] = [];
    const run = new Function(
      "vscode",
      `const REPORTED_UNREADABLE_CONFIGS = new Map();
       ${source
         .slice(
           source.indexOf("function reportUnreadableConfig("),
           source.indexOf(
             "/** Configuration files holding git conflict markers",
           ),
         )
         .replace(/: (string|void)/g, "")}
       return { reportUnreadableConfig, REPORTED_UNREADABLE_CONFIGS };`,
    )({
      window: { showErrorMessage: (message: string) => shown.push(message) },
    });
    run.reportUnreadableConfig("files", "conflict markers");
    run.reportUnreadableConfig("files", "conflict markers");
    assert.deepStrictEqual(shown, ["conflict markers"]);
    // Another reason, or the same one after the file was read again, is said again
    run.reportUnreadableConfig("files", "bad indentation");
    run.REPORTED_UNREADABLE_CONFIGS.delete("files");
    run.reportUnreadableConfig("files", "bad indentation");
    assert.deepStrictEqual(shown, [
      "conflict markers",
      "bad indentation",
      "bad indentation",
    ]);
    // Both ways out of a failed read report it, and a good read clears what was said
    assert.match(source, /reportUnreadableConfig\(cacheKey, usingPrevious\);/);
    assert.match(
      source,
      /reportUnreadableConfig\(\s*cacheKey,\s*t\("configFileUnreadable", \{ message: detail \}\),\s*\);\s*throw new Error\(/,
    );
    assert.match(source, /REPORTED_UNREADABLE_CONFIGS\.delete\(cacheKey\);/);
    assertKeysTranslated(
      new Set([
        "configFileUnreadable",
        "configFileUnreadableUsingPrevious",
        "configFileConflictMarkers",
      ]),
    );
  });
});
