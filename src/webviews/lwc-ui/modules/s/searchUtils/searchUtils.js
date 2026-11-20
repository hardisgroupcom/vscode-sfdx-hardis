/**
 * Plain text search, shared by the search bar of the Pull Request window and the components it
 * highlights in. No LWC and no DOM here: the unit tests run this module as it is.
 *
 * A search ignores case and accents, takes the text as typed (no pattern), and starts at
 * SEARCH_MIN_LENGTH characters: one letter matches everywhere in a long comment.
 */

export const SEARCH_MIN_LENGTH = 2;

/**
 * The query to search for, or "" when there is nothing to search yet.
 * @param {string} raw what the user typed
 */
export function normalizeSearchQuery(raw) {
  const query = typeof raw === "string" ? raw.trim() : "";
  return query.length >= SEARCH_MIN_LENGTH ? query : "";
}

/**
 * The text as it is compared, one original character at a time, with where each compared
 * character comes from: lowering a case or dropping an accent can change the length of a
 * character, and a highlight must land on the original text.
 * @param {string} text
 * @returns {{ folded: string, starts: number[], ends: number[] }} for each character of
 * `folded`, the offsets in `text` of the original character it comes from
 */
export function foldForSearch(text) {
  const source = typeof text === "string" ? text : "";
  let folded = "";
  const starts = [];
  const ends = [];
  let index = 0;
  for (const char of source) {
    const piece = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let i = 0; i < piece.length; i++) {
      starts.push(index);
      ends.push(index + char.length);
    }
    folded += piece;
    index += char.length;
  }
  return { folded, starts, ends };
}

/**
 * Where a query is found in a text, in the offsets of the original text. Matches never overlap.
 * @param {string} text
 * @param {string} query an already normalized query (normalizeSearchQuery)
 * @returns {{ start: number, end: number }[]}
 */
export function findMatches(text, query) {
  const needle = foldForSearch(query).folded;
  if (!needle || !text) {
    return [];
  }
  const { folded, starts, ends } = foldForSearch(text);
  const matches = [];
  let position = folded.indexOf(needle);
  while (position !== -1) {
    matches.push({
      start: starts[position],
      end: ends[position + needle.length - 1],
    });
    position = folded.indexOf(needle, position + needle.length);
  }
  return matches;
}

/**
 * How many times a query is found in a list of texts, each one searched on its own: a match
 * never spans two of them, like a highlight never spans two text nodes.
 * @param {string[]} texts
 * @param {string} query an already normalized query
 */
export function countMatches(texts, query) {
  if (!query || !Array.isArray(texts)) {
    return 0;
  }
  let count = 0;
  for (const text of texts) {
    count += findMatches(text, query).length;
  }
  return count;
}

/**
 * The match after (delta 1) or before (delta -1) the current one, going round at both ends.
 * @param {number} index current match
 * @param {number} total number of matches
 * @param {number} delta
 */
export function stepMatch(index, total, delta) {
  if (!(total > 0)) {
    return 0;
  }
  const current = Number.isInteger(index) ? index : 0;
  return (((current + delta) % total) + total) % total;
}

/**
 * The place holding a match, numbered across all the places in their order.
 * @param {number} index the match, counted across all places
 * @param {{ key: string, count: number }[]} counts the places in their order
 * @returns {{ key: string, local: number } | null} the place and the match within it
 */
export function locateMatch(index, counts) {
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(counts)) {
    return null;
  }
  let remaining = index;
  for (const place of counts) {
    if (remaining < place.count) {
      return { key: place.key, local: remaining };
    }
    remaining -= place.count;
  }
  return null;
}

/**
 * The first match of a place, counted across all places, or -1 when it has none.
 * @param {string} key
 * @param {{ key: string, count: number }[]} counts the places in their order
 */
export function firstMatchOf(key, counts) {
  let offset = 0;
  for (const place of counts || []) {
    if (place.key === key) {
      return place.count > 0 ? offset : -1;
    }
    offset += place.count;
  }
  return -1;
}

/**
 * The current match within each part of a place (the comments of one tab), -1 for the parts
 * that do not hold it.
 * @param {number} active the current match within the place, -1 for none
 * @param {number[]} counts the matches of each part, in their order
 */
export function activeMatchByPart(active, counts) {
  let remaining = Number.isInteger(active) ? active : -1;
  return (counts || []).map((count) => {
    if (remaining < 0) {
      return -1;
    }
    if (remaining < count) {
      const local = remaining;
      remaining = -1;
      return local;
    }
    remaining -= count;
    return -1;
  });
}
