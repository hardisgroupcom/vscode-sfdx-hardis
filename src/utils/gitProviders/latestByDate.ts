/**
 * The item carrying the latest date, or null for an empty list.
 *
 * Used to find the last merge between two major branches, which is where the window of a branch
 * starts. The providers were asked for "the most recently updated, take one" instead, and a
 * comment written on an old merge made it the most recently updated: the window then started at
 * that old merge, months too early.
 *
 * An item without a readable date never wins over a dated one. When no item has a date, the first
 * one is returned, which leaves the order of the provider in charge.
 */
export function pickLatestByDate<T>(
  items: readonly T[],
  dateOf: (item: T) => string | Date | null | undefined,
): T | null {
  let latest: T | null = null;
  let latestTime = -Infinity;
  for (const item of items) {
    const date = dateOf(item);
    const time = date ? new Date(date).getTime() : NaN;
    if (latest === null || (!isNaN(time) && time > latestTime)) {
      latest = item;
      latestTime = isNaN(time) ? -Infinity : time;
    }
  }
  return latest;
}
