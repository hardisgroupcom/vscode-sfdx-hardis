/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Sorting of the s-hardis-datatable tables: a click on a column header sorts
 * the rows by that column, a second click reverses the order.
 *
 * lightning-datatable only draws the sort arrow and sends a "sort" event: the
 * panel keeps the column and the direction, and gives the table its rows sorted
 * with sortDatatableRows. Columns sort on the text they show (the fieldName of
 * the column, which pill columns also use as their label): numbers in their
 * natural order ("9" before "10", "62.0" before "68.0"), empty cells last.
 */

/** The columns with a value made sortable. Action and button columns stay as they are. */
export function makeColumnsSortable(columns) {
  return (columns || []).map((column) =>
    column &&
    column.fieldName &&
    column.type !== "action" &&
    column.type !== "button"
      ? { ...column, sortable: true }
      : column,
  );
}

/** A copy of the rows sorted by one column, or the rows as they are when no column is chosen */
export function sortDatatableRows(rows, fieldName, direction) {
  const list = Array.isArray(rows) ? [...rows] : [];
  if (!fieldName) {
    return list;
  }
  const factor = direction === "desc" ? -1 : 1;
  return list.sort((rowA, rowB) => {
    const textA = cellText(rowA, fieldName);
    const textB = cellText(rowB, fieldName);
    // Empty cells always go last, whatever the direction
    if (textA === "" && textB === "") {
      return 0;
    }
    if (textA === "") {
      return 1;
    }
    if (textB === "") {
      return -1;
    }
    return (
      factor *
      textA.localeCompare(textB, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  });
}

/** The sort of a table after its "sort" event */
export function sortStateFromEvent(event) {
  const detail = (event && event.detail) || {};
  return {
    fieldName: detail.fieldName || null,
    direction: detail.sortDirection === "desc" ? "desc" : "asc",
  };
}

function cellText(row, fieldName) {
  const value = row ? row[fieldName] : null;
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}
