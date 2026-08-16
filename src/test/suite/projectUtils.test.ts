import * as assert from "assert";
import { normalizeGlobBase } from "../../utils/projectUtils";

suite("projectUtils Test Suite", () => {
  suite("normalizeGlobBase", () => {
    test("strips a leading './' segment", () => {
      assert.strictEqual(normalizeGlobBase("./force-app"), "force-app");
    });

    test("collapses a bare '.' to an empty string", () => {
      assert.strictEqual(normalizeGlobBase("."), "");
    });

    test("collapses './' to an empty string", () => {
      assert.strictEqual(normalizeGlobBase("./"), "");
    });

    test("converts backslashes to forward slashes", () => {
      assert.strictEqual(
        normalizeGlobBase(".\\force-app\\main"),
        "force-app/main",
      );
    });

    test("trims a trailing slash", () => {
      assert.strictEqual(normalizeGlobBase("force-app/"), "force-app");
    });

    test("leaves an already-normalized path untouched", () => {
      assert.strictEqual(normalizeGlobBase("force-app"), "force-app");
    });

    test("handles empty/undefined input", () => {
      assert.strictEqual(normalizeGlobBase(""), "");
      assert.strictEqual(normalizeGlobBase(undefined as unknown as string), "");
    });
  });
});
