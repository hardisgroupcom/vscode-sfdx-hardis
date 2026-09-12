import * as assert from "assert";
import {
  DEFAULT_CONCURRENCY,
  PROVIDER_BATCH_PROFILES,
  isThrottlingError,
  mapWithConcurrency,
  mapWithConcurrencySettled,
  retryAfterMs,
} from "../../utils/concurrency";

const throttled = (retryAfter?: string) =>
  Object.assign(new Error("API rate limit exceeded"), {
    status: 429,
    response: { headers: retryAfter ? { "retry-after": retryAfter } : {} },
  });
const notFound = () =>
  Object.assign(new Error("Issue does not exist"), { status: 404 });
const noSleep = { sleep: async () => undefined };

suite("Adaptive batches of provider calls", () => {
  // Records how many calls were in flight at the same time; an item listed in failures rejects
  // with the given error that many times before answering
  const trackingMapper = (
    delays: number[],
    failures: Map<number, { times: number; error: () => Error }> = new Map(),
  ) => {
    const state = { inFlight: 0, peak: 0, calls: 0 };
    const mapper = async (value: number) => {
      state.calls++;
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[value] ?? 1));
      state.inFlight--;
      const failure = failures.get(value);
      if (failure && failure.times > 0) {
        failure.times--;
        throw failure.error();
      }
      return value * 2;
    };
    return { state, mapper };
  };

  test("has one ladder per provider", () => {
    assert.deepStrictEqual([...PROVIDER_BATCH_PROFILES.github], [50, 20, 10, 5, 1]);
    assert.deepStrictEqual([...PROVIDER_BATCH_PROFILES.gitlab], [50, 20, 10, 5, 1]);
    assert.deepStrictEqual([...PROVIDER_BATCH_PROFILES.azure], [10, 5, 2, 1]);
    assert.deepStrictEqual([...PROVIDER_BATCH_PROFILES.bitbucket], [10, 5, 1]);
    assert.deepStrictEqual([...PROVIDER_BATCH_PROFILES.jiraCloud], [5, 2, 1]);
    assert.deepStrictEqual([...PROVIDER_BATCH_PROFILES.jiraServer], [20, 10, 5, 1]);
    assert.deepStrictEqual([...PROVIDER_BATCH_PROFILES.serviceNow], [4, 2, 1]);
    assert.strictEqual(DEFAULT_CONCURRENCY, 50);
  });

  test("tells a throttling from the answer of the provider", () => {
    assert.strictEqual(isThrottlingError(throttled()), true);
    assert.strictEqual(
      isThrottlingError(
        Object.assign(new Error("secondary rate limit"), { status: 403 }),
      ),
      true,
    );
    assert.strictEqual(
      isThrottlingError(
        Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
      ),
      true,
    );
    assert.strictEqual(isThrottlingError(notFound()), false);
    assert.strictEqual(
      isThrottlingError(Object.assign(new Error("Forbidden"), { status: 403 })),
      false,
    );
    assert.strictEqual(retryAfterMs(throttled("3")), 3000);
    assert.strictEqual(retryAfterMs(notFound()), null);
  });

  test("keeps the results in the order of the input", async () => {
    // Reversed delays: the last item finishes first, the result must not follow completion order
    const { mapper } = trackingMapper([30, 20, 10, 0]);
    const results = await mapWithConcurrency([0, 1, 2, 3], mapper, 4);
    assert.deepStrictEqual(results, [0, 2, 4, 6]);
  });

  test("reads a full batch of the ladder at a time", async () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const { state, mapper } = trackingMapper(items.map(() => 5));
    const results = await mapWithConcurrency(
      items,
      mapper,
      PROVIDER_BATCH_PROFILES.github,
    );
    assert.deepStrictEqual(results, items.map((value) => value * 2));
    assert.strictEqual(state.peak, 50);
  });

  test("never exceeds the ceiling a caller asks for", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { state, mapper } = trackingMapper(items.map(() => 5));
    await mapWithConcurrency(items, mapper, 3);
    assert.ok(state.peak <= 3, `peak concurrency was ${state.peak}`);
  });

  test("backs off to the smaller sizes on a throttling and waits the delay asked for", async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    // Item 3 is throttled at 50 and at 20, item 7 three times (down to size 5 where it passes)
    const { state, mapper } = trackingMapper(
      items.map(() => 1),
      new Map([
        [3, { times: 2, error: () => throttled("1") }],
        [7, { times: 3, error: () => throttled() }],
      ]),
    );
    const backoffs: Array<[number, number]> = [];
    const results = await mapWithConcurrency(
      items,
      mapper,
      PROVIDER_BATCH_PROFILES.github,
      {
        sleep: async () => undefined,
        onBackoff: (size, _error, waitMs) => backoffs.push([size, waitMs]),
      },
    );
    assert.deepStrictEqual(results, items.map((value) => value * 2));
    assert.deepStrictEqual(backoffs, [
      [20, 1000],
      [10, 1000],
      [5, 0],
    ]);
    assert.strictEqual(state.peak, 30);
    // 30 first calls, then 2 retries at 20, 2 at 10, 1 at 5
    assert.strictEqual(state.calls, 35);
  });

  test("never shrinks the batch for an error that is not a throttling", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const failures: number[] = [];
    const backoffs: number[] = [];
    const { state, mapper } = trackingMapper(
      items.map(() => 1),
      new Map([[4, { times: 99, error: notFound }]]),
    );
    const results = await mapWithConcurrencySettled(
      items,
      mapper,
      [5, 2, 1],
      (_error, item) => failures.push(item),
      { ...noSleep, onBackoff: (size) => backoffs.push(size) },
    );
    assert.strictEqual(results[4], undefined);
    assert.strictEqual(results[5], 10);
    assert.deepStrictEqual(failures, [4]);
    assert.deepStrictEqual(backoffs, []);
    assert.strictEqual(state.calls, 12);
    await assert.rejects(
      mapWithConcurrency(
        [1, 2],
        trackingMapper([1, 1], new Map([[2, { times: 99, error: notFound }]]))
          .mapper,
        5,
        noSleep,
      ),
      /Issue does not exist/,
    );
  });

  test("gives a throttled item one last try at the smallest size, then reports it", async () => {
    const failures: number[] = [];
    const { state, mapper } = trackingMapper(
      [1, 1, 1],
      new Map([[2, { times: 99, error: () => throttled() }]]),
    );
    const results = await mapWithConcurrencySettled(
      [1, 2, 3],
      mapper,
      [5, 1],
      (_error, item) => failures.push(item),
      noSleep,
    );
    assert.deepStrictEqual(results, [2, undefined, 6]);
    assert.deepStrictEqual(failures, [2]);
    assert.strictEqual(state.calls, 5);
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
    const { state, mapper } = trackingMapper([5, 5, 5]);
    await mapWithConcurrency([0, 1, 2], mapper, 0);
    assert.strictEqual(state.peak, 1);
  });

  test("does not need an error callback", async () => {
    const results = await mapWithConcurrencySettled([1], async () => {
      throw new Error("ignored");
    });
    assert.deepStrictEqual(results, [undefined]);
  });
});
