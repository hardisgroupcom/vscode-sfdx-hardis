import * as assert from "assert";
import { CacheManager } from "../../utils/cache-manager";
import { activateExtension } from "./uiTestUtils";

/**
 * CacheManager against the real globalState of a running VS Code.
 *
 * VS Code keeps the whole globalState of an extension in one object inside its
 * Memento and replaces that object every time the main process echoes a storage
 * change back, this window's own writes included. An echo carrying a snapshot
 * taken before a write lands right after it, and the key just written is gone,
 * from memory and from what gets persisted, while update() resolves as if all
 * was well. Two writes one tick apart are enough: that is a panel pushing its
 * state and then saving the choice the user just made.
 */
suite("CacheManager UI tests", function () {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  suiteSetup(async function () {
    await activateExtension();
  });

  test("a preference written right after another one is readable, and kept", async function () {
    this.timeout(60000);
    const written: Array<{ key: string; value: any }> = [];
    for (let round = 0; round < 8; round++) {
      // A first write, whose echo from the main process is on its way back
      void CacheManager.setPreference(`cacheManagerTestOther${round}`, {
        round,
        filler: "x".repeat(2000),
      });
      await sleep(0);
      // The decision a panel saves, written while that echo is in flight
      const key = `cacheManagerTestValue${round}`;
      const value = { savedAt: new Date().toISOString(), round };
      written.push({ key, value });
      void CacheManager.setPreference(key, value);
      // Readable at once and for the whole window an echo can land in
      const start = Date.now();
      while (Date.now() - start < 200) {
        assert.deepStrictEqual(
          CacheManager.getPreference(key),
          value,
          `${key} was lost ${Date.now() - start}ms after it was written`,
        );
        await sleep(0);
      }
    }
    // Long after the writes: globalState itself has to hold them, so that the
    // next VS Code session finds them
    await sleep(3000);
    for (const { key, value } of written) {
      assert.deepStrictEqual(
        CacheManager.getPreference(key),
        value,
        `${key} did not survive in globalState`,
      );
    }
  });
});
