// Tiny local replacement for the "chalk" dependency.
// Only the styles actually used across the codebase are implemented.
// Colors are applied with raw ANSI escape codes, matching chalk's output.
// The escape character is built from its char code to avoid embedding a raw
// control character in the source file.

const ESC = String.fromCharCode(27);
const ANSI_RED_OPEN = `${ESC}[31m`;
const ANSI_YELLOW_OPEN = `${ESC}[33m`;
const ANSI_GREY_OPEN = `${ESC}[90m`;
const ANSI_BOLD_OPEN = `${ESC}[1m`;
const ANSI_COLOR_CLOSE = `${ESC}[39m`;
const ANSI_BOLD_CLOSE = `${ESC}[22m`;

export function red(text: string): string {
  return `${ANSI_RED_OPEN}${text}${ANSI_COLOR_CLOSE}`;
}

export function yellow(text: string): string {
  return `${ANSI_YELLOW_OPEN}${text}${ANSI_COLOR_CLOSE}`;
}

export function grey(text: string): string {
  return `${ANSI_GREY_OPEN}${text}${ANSI_COLOR_CLOSE}`;
}

export function bold(text: string): string {
  return `${ANSI_BOLD_OPEN}${text}${ANSI_BOLD_CLOSE}`;
}
