import * as assert from "assert";
import {
  applySfPerformanceEnv,
  getSfPerformanceTerminalEnv,
  isSfHardisCommand,
  setNodeCompileCacheDir,
} from "../../utils/sfPerformanceUtils";

suite("sfPerformanceUtils Test Suite", () => {
  test("adds the three sf flags when enhancements are enabled", () => {
    const env = applySfPerformanceEnv({ PATH: "x" }, "sf org display --json", false);
    assert.strictEqual(env.SF_DISABLE_LOG_FILE, "true");
    assert.strictEqual(env.SF_SKIP_NEW_VERSION_CHECK, "true");
    assert.strictEqual(env.SF_DISABLE_AUTOUPDATE, "true");
    assert.strictEqual(env.SF_DISABLE_TELEMETRY, undefined);
    assert.strictEqual(env.SFDX_HARDIS_ENHANCE_PERFORMANCE, undefined);
    assert.strictEqual(env.PATH, "x");
  });

  test("never overrides a value already defined by the user", () => {
    const env = applySfPerformanceEnv(
      { SF_DISABLE_AUTOUPDATE: "false" },
      "sf org display --json",
      false,
    );
    assert.strictEqual(env.SF_DISABLE_AUTOUPDATE, "false");
    assert.strictEqual(env.SF_DISABLE_LOG_FILE, "true");
  });

  test("when disabled, adds no sf flag and tells sfdx-hardis to stop enhancing", () => {
    const hardisEnv = applySfPerformanceEnv({}, "sf hardis:work:new", true);
    assert.deepStrictEqual(hardisEnv, {
      SFDX_HARDIS_ENHANCE_PERFORMANCE: "false",
    });
    const sfEnv = applySfPerformanceEnv({}, "sf org display --json", true);
    assert.deepStrictEqual(sfEnv, {});
  });

  test("when disabled, keeps a user-defined SFDX_HARDIS_ENHANCE_PERFORMANCE", () => {
    const env = applySfPerformanceEnv(
      { SFDX_HARDIS_ENHANCE_PERFORMANCE: "true" },
      "sf hardis:work:new",
      true,
    );
    assert.strictEqual(env.SFDX_HARDIS_ENHANCE_PERFORMANCE, "true");
  });

  test("recognizes sf hardis commands, with or without env prefixes", () => {
    assert.strictEqual(isSfHardisCommand("sf hardis:org:select"), true);
    assert.strictEqual(isSfHardisCommand("  sf hardis:org:select"), true);
    assert.strictEqual(
      isSfHardisCommand("SFDX_HARDIS_LANG=fr sf hardis:org:select"),
      true,
    );
    assert.strictEqual(isSfHardisCommand("sf org display --json"), false);
    assert.strictEqual(isSfHardisCommand("sf hardisx"), false);
    assert.strictEqual(isSfHardisCommand(undefined), false);
  });

  test("adds the node compile cache dir once configured, never over a user value", () => {
    setNodeCompileCacheDir("/cache/dir");
    try {
      const env = applySfPerformanceEnv({}, "sf hardis:work:new", false);
      assert.strictEqual(env.NODE_COMPILE_CACHE, "/cache/dir");
      const userEnv = applySfPerformanceEnv(
        { NODE_COMPILE_CACHE: "/mine" },
        "sf hardis:work:new",
        false,
      );
      assert.strictEqual(userEnv.NODE_COMPILE_CACHE, "/mine");
      const disabledEnv = applySfPerformanceEnv({}, "sf org display", true);
      assert.strictEqual(disabledEnv.NODE_COMPILE_CACHE, undefined);
      assert.strictEqual(
        getSfPerformanceTerminalEnv({}, false).NODE_COMPILE_CACHE,
        "/cache/dir",
      );
    } finally {
      setNodeCompileCacheDir(null);
    }
  });

  test("terminal env only holds the flags the extension decides", () => {
    assert.deepStrictEqual(getSfPerformanceTerminalEnv({ PATH: "x" }, false), {
      SF_DISABLE_LOG_FILE: "true",
      SF_SKIP_NEW_VERSION_CHECK: "true",
      SF_DISABLE_AUTOUPDATE: "true",
    });
    assert.deepStrictEqual(
      getSfPerformanceTerminalEnv({ SF_DISABLE_LOG_FILE: "false" }, false),
      {
        SF_SKIP_NEW_VERSION_CHECK: "true",
        SF_DISABLE_AUTOUPDATE: "true",
      },
    );
    assert.deepStrictEqual(getSfPerformanceTerminalEnv({}, true), {
      SFDX_HARDIS_ENHANCE_PERFORMANCE: "false",
    });
  });
});
