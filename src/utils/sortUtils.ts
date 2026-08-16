// Tiny local replacement for the "sort-array" dependency.
// Replicates the subset of sort-array's behavior used across the codebase:
// multi-key sort, asc/desc order per key, computed fields and custom orders.
// Like sort-array, the array is sorted in place and the same reference is returned.

export interface SortArrayOptions<T> {
  by: string[];
  order?: string[];
  computed?: { [key: string]: (item: T) => any };
  customOrders?: { [orderName: string]: any[] };
  // Rank applied when comparing a null/undefined/NaN value against a defined one.
  // -1 sorts it before defined values, 1 (default) sorts it after.
  nullRank?: number;
  undefinedRank?: number;
  nanRank?: number;
}

function isDefinedValue(value: any): boolean {
  return value !== null && value !== undefined && !Number.isNaN(value);
}

export function sortArray<T>(items: T[], options: SortArrayOptions<T>): T[] {
  const by = options.by || [];
  const order = options.order || [];
  const computed = options.computed || {};
  const customOrders = options.customOrders || {};
  const nullRank = options.nullRank ?? 1;
  const undefinedRank = options.undefinedRank ?? 1;
  const nanRank = options.nanRank ?? 1;

  const getValueAt = (item: T, byIndex: number): any => {
    const key = by[byIndex];
    if (key === undefined) {
      return item;
    }
    const rawValue = (item as any)[key];
    if (rawValue !== undefined) {
      return rawValue;
    }
    return computed[key] ? computed[key](item) : undefined;
  };

  const compareAt = (x: T, y: T, byIndex: number): number => {
    const currentOrder = order[byIndex] || "asc";
    const isKnownOrder =
      currentOrder === "asc" ||
      currentOrder === "desc" ||
      Boolean(customOrders[currentOrder]);
    if (!isKnownOrder) {
      return 0;
    }

    const xValue = by.length ? getValueAt(x, byIndex) : x;
    const yValue = by.length ? getValueAt(y, byIndex) : y;

    let result: number;
    if (customOrders[currentOrder]) {
      result =
        customOrders[currentOrder].indexOf(xValue) -
        customOrders[currentOrder].indexOf(yValue);
    } else if (xValue === yValue) {
      result = 0;
    } else if (xValue === null && yValue === undefined) {
      result = currentOrder === "asc" ? 1 : -1;
    } else if (xValue === undefined && yValue === null) {
      result = currentOrder === "asc" ? -1 : 1;
    } else if (xValue === null && isDefinedValue(yValue)) {
      result = nullRank;
    } else if (xValue === undefined && isDefinedValue(yValue)) {
      result = undefinedRank;
    } else if (Number.isNaN(xValue) && isDefinedValue(yValue)) {
      result = nanRank;
    } else if (yValue === null && isDefinedValue(xValue)) {
      result = -nullRank;
    } else if (yValue === undefined && isDefinedValue(xValue)) {
      result = -undefinedRank;
    } else if (Number.isNaN(yValue) && isDefinedValue(xValue)) {
      result = -nanRank;
    } else {
      result = xValue < yValue ? -1 : xValue > yValue ? 1 : 0;
      if (currentOrder === "desc") {
        result = result * -1;
      }
    }

    if (result === 0 && by[byIndex + 1] !== undefined) {
      result = compareAt(x, y, byIndex + 1);
    }
    return result;
  };

  items.sort((x, y) => compareAt(x, y, 0));
  return items;
}
