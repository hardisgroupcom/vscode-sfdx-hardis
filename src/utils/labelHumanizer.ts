// Humanizes camelCase configuration keys into readable labels, keeping
// well-known acronyms uppercase (e.g. "userInputCommandLineIfLWC" ->
// "User input command line if LWC") instead of the naive per-uppercase-letter
// split that produces "User Input Command Line If L W C".

// Acronyms are matched case-insensitively against a whole camelCase "word".
const KNOWN_ACRONYMS = [
  "LWC",
  "MCP",
  "TLS",
  "CLI",
  "URL",
  "API",
  "SFDX",
  "AI",
  "WS",
  "JSON",
  "YAML",
];

const ACRONYM_LOOKUP = new Set(KNOWN_ACRONYMS.map((acronym) => acronym.toUpperCase()));

/**
 * Splits a camelCase (or PascalCase) identifier into its constituent words,
 * keeping consecutive uppercase letters (acronyms) grouped together, e.g.
 * "userInputCommandLineIfLWC" -> ["user", "Input", "Command", "Line", "If", "LWC"]
 */
function splitCamelCaseWords(key: string): string[] {
  const words: string[] = [];
  let current = "";
  for (let i = 0; i < key.length; i++) {
    const char = key[i];
    const prevChar = key[i - 1];
    const nextChar = key[i + 1];
    const isUpper = /[A-Z]/.test(char);
    if (isUpper && current.length > 0) {
      const prevIsUpper = !!prevChar && /[A-Z]/.test(prevChar);
      const nextIsLower = !!nextChar && /[a-z]/.test(nextChar);
      // Start a new word unless this uppercase letter continues an acronym
      // run (previous char is also uppercase and the next one is not lowercase)
      if (!prevIsUpper || nextIsLower) {
        words.push(current);
        current = "";
      }
    }
    current += char;
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words;
}

/**
 * Humanizes a camelCase configuration key (or its last dot-separated segment)
 * into a sentence-case label, uppercasing known acronyms wherever they occur.
 */
export function humanizeConfigKeyLabel(key: string): string {
  if (!key) {
    return "";
  }
  const words = splitCamelCaseWords(key);
  return words
    .map((word, index) => {
      if (ACRONYM_LOOKUP.has(word.toUpperCase())) {
        return word.toUpperCase();
      }
      const lower = word.toLowerCase();
      if (index === 0) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      return lower;
    })
    .join(" ");
}
