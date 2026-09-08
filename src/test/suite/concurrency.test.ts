import * as assert from "assert";
import {
  DEFAULT_CONCURRENCY,
  mapWithConcurrency,
  mapWithConcurrencySettled,
} from "../../utils/concurrency";

suite("Bounded parallelism", () => {
  // Records how many calls were in flight at the same time
  const trackingMapper = (delays: number[]) => {
    const state = { inFlight: 0, peak: 0 };
    const mapper = async (value: number) => {
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[value] ?? 1));
      state.inFlight--;
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

  test("never exceeds the ceiling", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { state, mapper } = trackingMapper(items.map(() => 5));
    await mapWithConcurrency(items, mapper, 3);
    assert.ok(state.peak <= 3, `peak concurrency was ${state.peak}`);
  });

  test("actually runs in parallel up to the ceiling", async () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    const { state, mapper } = trackingMapper(items.map(() => 5));
    await mapWithConcurrency(items, mapper, 4);
    assert.strictEqual(state.peak, 4, "the ceiling should be reached");
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

  test("never starts more workers than there are items", async () => {
    const items = [0, 1];
    const { state, mapper } = trackingMapper([5, 5]);
    await mapWithConcurrency(items, mapper, 50);
    assert.ok(state.peak <= 2, `peak concurrency was ${state.peak}`);
  });

  test("treats a limit below one as one", async () => {
    const items = [0, 1, 2];
    const { state, mapper } = trackingMapper([5, 5, 5]);
    await mapWithConcurrency(items, mapper, 0);
    assert.strictEqual(state.peak, 1);
  });

  test("rejects on the first error, like Promise.all", async () => {
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
    test("keeps the good results and reports the failures", async () => {
      const seen: unknown[] = [];
      const results = await mapWithConcurrencySettled(
        [1, 2, 3],
        async (value) => {
          if (value === 2) {
            throw new Error("one Pull Request the provider refuses");
          }
          return value * 10;
        },
        2,
        (error) => seen.push(error),
      );
      assert.deepStrictEqual(results, [10, undefined, 30]);
      assert.strictEqual(seen.length, 1);
    });

    test("does not need an error callback", async () => {
      const results = await mapWithConcurrencySettled([1], async () => {
        throw new Error("ignored");
      });
      assert.deepStrictEqual(results, [undefined]);
    });
  });

  test("has a sane default ceiling", () => {
    assert.ok(DEFAULT_CONCURRENCY >= 4 && DEFAULT_CONCURRENCY <= 16);
  });
});
