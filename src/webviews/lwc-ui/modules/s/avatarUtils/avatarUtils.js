/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Shared helpers for the initials avatars displayed in datatables
 * (avatarText cell type).
 *
 * Kept in a single service module so every component renders the same
 * initials and the same stable color variant for a given name.
 */

// Number of avatar color variants declared in global-theme.css
// (.hardis-avatar-c0 ... .hardis-avatar-c5).
const AVATAR_COLOR_VARIANTS = 6;

/**
 * Deterministic hash used to pick a stable avatar color variant per name.
 * @param {string} str value to hash
 * @returns {number} positive hash
 */
export function hashString(str) {
  let hash = 0;
  const value = str || "";
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * CSS classes for an initials avatar, with a color variant stable per name.
 * @param {string} name value driving the color variant
 * @returns {string} avatar CSS classes
 */
export function getAvatarClass(name) {
  return `hardis-avatar hardis-avatar-c${hashString(name) % AVATAR_COLOR_VARIANTS}`;
}

/**
 * Two initials derived from a display name (e.g. "Nicolas Vuillamy" -> "NV").
 * Returns an empty string when the name is unknown: call sites that need a
 * placeholder can fall back to "?" themselves.
 * @param {string} name display name
 * @returns {string} initials, or "" when unknown
 */
export function getInitials(name) {
  if (!name) {
    return "";
  }
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

/**
 * Two initials derived from a username
 * (e.g. "nicolas.vuillamy@cloudity.com" -> "NV").
 * @param {string} username username or login
 * @returns {string} initials, or "?" when unknown
 */
export function getUsernameInitials(username) {
  if (!username) {
    return "?";
  }
  const namePart = username.toString().split("@")[0];
  const words = namePart.split(/[.\-_]+/).filter(Boolean);
  if (words.length === 0) {
    return namePart.slice(0, 2).toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}
