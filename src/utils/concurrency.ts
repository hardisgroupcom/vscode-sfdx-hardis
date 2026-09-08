/*
Bounded parallelism for the fan-outs of the DevOps Pipeline.

`Promise.all(items.map(...))` starts every call at once. On a repository with hundreds of Pull
Requests that is hundreds of simultaneous HTTP requests to the git provider, which throttles them
(Azure DevOps answers 429 and spends the rest of the budget queueing) and usually ends up SLOWER
than a bounded queue, on top of being invisible in the logs when it happens.

These helpers keep the same shape as Promise.all / Promise.allSettled, with a ceiling.
*/

// Enough to keep the network busy, low enough that no provider treats it as a burst
export const DEFAULT_CONCURRENCY = 8;

/**
 * Map over `items` with at most `limit` calls in flight, preserving input order in the result.
 * Rejects on the first error, like Promise.all.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) {
    return results;
  }
  const ceiling = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const workers = Array.from({ length: ceiling }, async () => {
    // Each worker pulls the next index until the queue is empty, so a slow call
    // never holds back the ones behind it
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Same as mapWithConcurrency, but a rejected call yields `undefined` for that item instead of
 * failing the whole batch: one Pull Request the provider refuses must not empty the diagram.
 */
export async function mapWithConcurrencySettled<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY,
  onError?: (error: unknown, item: T, index: number) => void,
): Promise<(R | undefined)[]> {
  return await mapWithConcurrency(
    items,
    async (item, index) => {
      try {
        return await mapper(item, index);
      } catch (error) {
        onError?.(error, item, index);
        return undefined;
      }
    },
    limit,
  );
}
