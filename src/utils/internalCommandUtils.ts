import { stripAnsiCodes } from "./ansiColors";

const MAX_REASON_LENGTH = 500;

/**
 * Why a command run by a panel through `runInternalCommand` failed, or null when it did not.
 * execCommand never throws for such a command: a failure comes back as a result with a status
 * above 0, and a panel that only reads the result of a success shows nothing at all.
 * @param result What execCommand / execSfdxJson returned, or null when the call itself threw
 */
export function getInternalCommandFailureReason(result: any): string | null {
  if (result === null || result === undefined) {
    return "";
  }
  if (!(Number(result.status) > 0)) {
    return null;
  }
  const candidates = [
    result.message,
    result.stderr,
    result.error?.message,
    result.stdout,
  ];
  for (const candidate of candidates) {
    const text = stripAnsiCodes(String(candidate ?? "")).trim();
    if (text !== "") {
      return text.length > MAX_REASON_LENGTH
        ? text.slice(0, MAX_REASON_LENGTH) + "..."
        : text;
    }
  }
  return "";
}
