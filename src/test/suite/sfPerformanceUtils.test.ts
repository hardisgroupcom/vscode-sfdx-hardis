import * as assert from "assert";
import {
  applySfPerformanceEnv,
  getLinkedSfdxHardisPreloadArg,
  getSfPerformanceTerminalEnv,
  isSfHardisCommand,
  setLinkedPluginPreloadScript,
  setNodeCompileCacheDir,
} from "../../utils/sfPerformanceUtils";

suite("sfPerformanceUtils Test Suite", () => {
  test("adds the three sf flags when enhancements are enabled", () => {
    const env = applySfPerformanceEnv(
      { PATH: "x" },
      "sf org display --json",
      false,
    );
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
    // cspell:ignore hardisx
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
        getSfPerformanceTerminalEnv({}, false, null).NODE_COMPILE_CACHE,
        "/cache/dir",
      );
    } finally {
      setNodeCompileCacheDir(null);
    }
  });

  test("terminal env only holds the flags the extension decides", () => {
    assert.deepStrictEqual(
      getSfPerformanceTerminalEnv({ PATH: "x" }, false, null),
      {
        SF_DISABLE_LOG_FILE: "true",
        SF_SKIP_NEW_VERSION_CHECK: "true",
        SF_DISABLE_AUTOUPDATE: "true",
      },
    );
    assert.deepStrictEqual(
      getSfPerformanceTerminalEnv(
        { SF_DISABLE_LOG_FILE: "false" },
        false,
        null,
      ),
      {
        SF_SKIP_NEW_VERSION_CHECK: "true",
        SF_DISABLE_AUTOUPDATE: "true",
      },
    );
    assert.deepStrictEqual(getSfPerformanceTerminalEnv({}, true, null), {
      SFDX_HARDIS_ENHANCE_PERFORMANCE: "false",
    });
  });
  test("linked plugin preload lands in NODE_OPTIONS, appended and deduplicated", () => {
    const arg = "--import file:///ext/resources/disable-auto-transpile.mjs";
    // Fresh env: the preload is the whole value
    const env = applySfPerformanceEnv({}, "sf hardis:work:new", false, arg);
    assert.strictEqual(env.NODE_OPTIONS, arg);
    // Existing NODE_OPTIONS (e.g. the debugger bootloader) is preserved
    const merged = applySfPerformanceEnv(
      { NODE_OPTIONS: "--require /bootloader.js" },
      "sf hardis:work:new",
      false,
      arg,
    );
    assert.strictEqual(merged.NODE_OPTIONS, `--require /bootloader.js ${arg}`);
    // Never appended twice
    const again = applySfPerformanceEnv(
      { ...merged },
      "sf org display",
      false,
      arg,
    );
    assert.strictEqual(again.NODE_OPTIONS, `--require /bootloader.js ${arg}`);
    // Ignored when performance enhancements are disabled
    const disabled = applySfPerformanceEnv({}, "sf hardis:work:new", true, arg);
    assert.strictEqual(disabled.NODE_OPTIONS, undefined);
  });

  test("terminal env hands over the merged NODE_OPTIONS only when it changed", () => {
    const arg = "--import file:///ext/resources/disable-auto-transpile.mjs";
    const withPreload = getSfPerformanceTerminalEnv(
      { NODE_OPTIONS: "--require /bootloader.js" },
      false,
      arg,
    );
    assert.strictEqual(
      withPreload.NODE_OPTIONS,
      `--require /bootloader.js ${arg}`,
    );
    const noPreload = getSfPerformanceTerminalEnv(
      { NODE_OPTIONS: "--require /bootloader.js" },
      false,
      null,
    );
    assert.strictEqual(noPreload.NODE_OPTIONS, undefined);
  });

  test("no preload arg without a registered script or with auto-transpile wanted", () => {
    setLinkedPluginPreloadScript(null);
    assert.strictEqual(getLinkedSfdxHardisPreloadArg(false), null);
    setLinkedPluginPreloadScript("/ext/resources/disable-auto-transpile.mjs");
    try {
      assert.strictEqual(getLinkedSfdxHardisPreloadArg(true), null);
    } finally {
      setLinkedPluginPreloadScript(null);
    }
  });
});
