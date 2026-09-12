import * as assert from "assert";
import {
  DEFAULT_CONCURRENCY,
  PROVIDER_BATCH_SIZES,
  mapWithConcurrency,
  mapWithConcurrencySettled,
} from "../../utils/concurrency";

suite("Adaptive batches of provider calls", () => {
  // Records how many calls were in flight at the same time; an item listed in failuresLeft
  // rejects that many times before answering
  const trackingMapper = (
    delays: number[],
    failuresLeft: Map<number, number> = new Map(),
  ) => {
    const state = { inFlight: 0, peak: 0, calls: 0 };
    const mapper = async (value: number) => {
      state.calls++;
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[value] ?? 1));
      state.inFlight--;
      const left = failuresLeft.get(value) || 0;
      if (left > 0) {
        failuresLeft.set(value, left - 1);
        throw new Error(`too many requests for ${value}`);
      }
      return value * 2;
    };
    return { state, mapper };
  };

  test("keeps the results in the order of the input", async () => {
    // Reversed delays: the last item finishes first, the result must not follow completion order
    const delays = [30, 20, 10, 0];
    const { mapper } = trackingMapper(delays);
    const results = await mapWithConcurrency([0, 1, 2, 3], mapper, 4);
    assert.deepStrictEqual(results, [0, 2, 4, 6]);
  });

  test("reads 20 at a time by default", async () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const { state, mapper } = trackingMapper(items.map(() => 5));
    const results = await mapWithConcurrency(items, mapper);
    assert.deepStrictEqual(results, items.map((value) => value * 2));
    assert.strictEqual(state.peak, 20);
    assert.deepStrictEqual([...PROVIDER_BATCH_SIZES], [20, 10, 5, 1]);
    assert.strictEqual(DEFAULT_CONCURRENCY, 20);
  });

  test("never exceeds the ceiling a caller asks for", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { state, mapper } = trackingMapper(items.map(() => 5));
    await mapWithConcurrency(items, mapper, 3);
    assert.ok(state.peak <= 3, `peak concurrency was ${state.peak}`);
  });

  test("backs off to 10, then 5, then one by one after a failure", async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    // Item 3 fails at 20 and at 10, item 7 fails three times (down to size 1 where it passes)
    const { state, mapper } = trackingMapper(
      items.map(() => 1),
      new Map([
        [3, 2],
        [7, 3],
      ]),
    );
    const results = await mapWithConcurrency(items, mapper);
    assert.deepStrictEqual(results, items.map((value) => value * 2));
    assert.strictEqual(state.peak, 20);
    // 30 first calls, then 2 retries at 10, 2 at 5, 1 at 1
    assert.strictEqual(state.calls, 35);
  });

  test("handles an empty list without calling the mapper", async () => {
    let called = false;
    const results = await mapWithConcurrency([], async () => {
      called = true;
      return 1;
    });
    assert.deepStrictEqual(results, []);
    assert.strictEqual(called, false);
  });

  test("treats a limit below one as one", async () => {
    const items = [0, 1, 2];
    const { state, mapper } = trackingMapper([5, 5, 5]);
    await mapWithConcurrency(items, mapper, 0);
    assert.strictEqual(state.peak, 1);
  });

  test("rejects when an item still fails at the smallest size, like Promise.all", async () => {
    await assert.rejects(
      mapWithConcurrency([1, 2, 3], async (value) => {
        if (value === 2) {
          throw new Error("boom");
        }
        return value;
      }),
      /boom/,
    );
  });

  suite("mapWithConcurrencySettled()", () => {
    test("keeps the good results and reports the failures once, after the back-off", async () => {
      const seen: unknown[] = [];
      let attempts = 0;
      const results = await mapWithConcurrencySettled(
        [1, 2, 3],
        async (value) => {
          if (value === 2) {
            attempts++;
            throw new Error("one Pull Request the provider refuses");
          }
          return value * 10;
        },
        2,
        (error) => seen.push(error),
      );
      assert.deepStrictEqual(results, [10, undefined, 30]);
      assert.strictEqual(seen.length, 1);
      // Tried at 2, then at 1
      assert.strictEqual(attempts, 2);
    });

    test("does not need an error callback", async () => {
      const results = await mapWithConcurrencySettled([1], async () => {
        throw new Error("ignored");
      });
      assert.deepStrictEqual(results, [undefined]);
    });
  });
});
