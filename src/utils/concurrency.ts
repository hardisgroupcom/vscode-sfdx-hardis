/*
Parallel calls to a git provider or a ticketing provider, in adaptive batches.

`Promise.all(items.map(...))` starts every call at once. On a repository with hundreds of Pull
Requests that is hundreds of simultaneous HTTP requests to the provider, which throttles them
(Azure DevOps answers 429 and spends the rest of the budget queueing) and usually ends up SLOWER
than a bounded queue, on top of being invisible in the logs when it happens.

A batch of 20 calls leaves at once. When one of them fails, the failed items are tried again in
batches of 10, then 5, then one by one, and the smaller size is kept for the rest of the run. The
same rule lives in sfdx-hardis (src/common/utils/adaptiveBatch.ts).
*/

/** The batch sizes tried, in order: the pattern every parallel provider call follows */
export const PROVIDER_BATCH_SIZES: readonly number[] = [20, 10, 5, 1];

/** The first batch size, also the fan-out ceiling below which a provider batch call is not worth it */
export const DEFAULT_CONCURRENCY = PROVIDER_BATCH_SIZES[0];

/** The sizes to try when a caller asks for a ceiling: the ceiling, then the smaller standard sizes */
function sizesFor(limit?: number): readonly number[] {
  if (limit === undefined || limit >= DEFAULT_CONCURRENCY) {
    return PROVIDER_BATCH_SIZES;
  }
  const ceiling = Math.max(1, Math.floor(limit));
  return [ceiling, ...PROVIDER_BATCH_SIZES.filter((size) => size < ceiling)];
}

async function runAdaptiveBatches<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  sizes: readonly number[],
  onError: ((error: unknown, item: T, index: number) => void) | null,
  settled: boolean,
): Promise<(R | undefined)[]> {
  const results = new Array<R | undefined>(items.length);
  const queue = items.map((_, index) => index);
  let sizeIndex = 0;
  while (queue.length > 0) {
    const batch = queue.splice(0, Math.max(1, sizes[sizeIndex]));
    const outcomes = await Promise.allSettled(
      batch.map((index) => mapper(items[index], index)),
    );
    const retry: number[] = [];
    for (let position = 0; position < batch.length; position++) {
      const index = batch[position];
      const outcome = outcomes[position];
      if (outcome.status === "fulfilled") {
        results[index] = outcome.value;
      } else if (sizeIndex < sizes.length - 1) {
        retry.push(index);
      } else if (settled) {
        onError?.(outcome.reason, items[index], index);
        results[index] = undefined;
      } else {
        throw outcome.reason;
      }
    }
    if (retry.length > 0) {
      sizeIndex++;
      queue.unshift(...retry);
    }
  }
  return results;
}

/**
 * Map over `items` in adaptive batches (20, then 10, 5 and 1 after a failure), preserving input
 * order in the result. `limit` caps the first batch. Rejects like Promise.all when an item still
 * fails at the smallest size.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  return (await runAdaptiveBatches(items, mapper, sizesFor(limit), null, false)) as R[];
}

/**
 * Same as mapWithConcurrency, but an item that still fails at the smallest size yields
 * `undefined` instead of failing the whole batch: one Pull Request the provider refuses must not
 * empty the diagram.
 */
export async function mapWithConcurrencySettled<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY,
  onError?: (error: unknown, item: T, index: number) => void,
): Promise<(R | undefined)[]> {
  return runAdaptiveBatches(items, mapper, sizesFor(limit), onError ?? null, true);
}
