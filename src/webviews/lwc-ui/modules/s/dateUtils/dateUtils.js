/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * A date as the panels show it: day, short month and year in the locale of VS Code ("Nov 7, 2026").
 * Empty for no value, the value itself when it is not a date, and the ISO day when the locale is
 * refused by the webview.
 */
export function formatShortDate(value, locale) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  try {
    return date.toLocaleDateString(locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}
