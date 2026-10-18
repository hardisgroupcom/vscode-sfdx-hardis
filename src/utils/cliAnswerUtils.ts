import { stripAnsiCodes } from "./ansiColors";

/**
 * Readers of the answer of an sfdx-hardis --json command, for the panels that show it.
 * The answer comes from another process: nothing in it is trusted, every value is checked
 * and cut before it reaches a webview.
 */

/**
 * Message of a failed --json command, as sfdx-hardis wrote it: the first message that is not
 * blank, else stderr when it is not JSON, else "".
 * @param result the parsed answer of execSfdxJson
 * @param maxLength the longest message kept
 * @param otherMessages where else the command can put its message, tried after result.message
 */
export function failedCommandMessage(
  result: any,
  maxLength: number,
  otherMessages: unknown[] = [],
): string {
  for (const message of [result?.message, ...otherMessages]) {
    if (typeof message === "string" && message.trim() !== "") {
      return cleanAnswerText(message, maxLength);
    }
  }
  const stderr = String(result?.stderr || "").trim();
  if (stderr !== "" && !stderr.startsWith("{")) {
    return cleanAnswerText(stderr, maxLength);
  }
  return "";
}

/** The objects of a list of the answer, at most maxRows. Anything else is dropped. */
export function asAnswerObjects(value: unknown, maxRows: number): any[] {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object")
    .slice(0, maxRows);
}

/** A count of the answer, 0 when it is not a finite number */
export function asAnswerCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A text of the answer, trimmed, without ANSI codes, cut at maxLength. Not a string: "". */
export function cleanAnswerText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return stripAnsiCodes(value.trim()).slice(0, maxLength);
}
