// Finds the field (or object) a selection points at inside a SOQL query, so that
// "Find where this field is used" can open the Metadata Dependencies panel on it.
// No VS Code API here: the questions about the org schema (where a relationship points,
// the exact case of a name) go through SoqlSchema, which the command implements.

export interface SoqlSchema {
  // Lookup field behind a parent relationship: Account on Contact is AccountId, pointing to Account
  parentRelationship(
    objectName: string,
    relationshipName: string,
  ): Promise<{ field: string; target: string | null } | null>;
  // Object of a child relationship: Contacts on Account is Contact
  childRelationship(
    objectName: string,
    relationshipName: string,
  ): Promise<string | null>;
  // API name with its exact case (SOQL ignores case, the dependency lookup does not), null if unknown
  objectName(name: string): Promise<string | null>;
  fieldName(objectName: string, fieldName: string): Promise<string | null>;
}

export type SoqlSelectionTarget =
  | {
      kind: "field";
      objectName: string;
      fieldName: string;
      // Object.Field, the name the Metadata Dependencies panel looks up
      apiName: string;
      // Salesforce dependency data only holds custom fields
      custom: boolean;
    }
  | { kind: "object"; objectName: string };

export type SoqlResolveErrorCode =
  "noQuery" | "notAField" | "unsupportedTypeof" | "unresolvedRelationship";

export class SoqlResolveError extends Error {
  constructor(
    public readonly code: SoqlResolveErrorCode,
    public readonly details: Record<string, string> = {},
  ) {
    super(`${code} ${JSON.stringify(details)}`);
    this.name = "SoqlResolveError";
  }
}

export interface SoqlRange {
  start: number;
  end: number;
}

interface Token {
  type: "ident" | "string" | "number" | "punct";
  value: string;
  start: number;
  end: number;
  // Parenthesis depth the token is written at (a parenthesis has the depth outside it)
  depth: number;
}

interface Scope {
  // Index of the SELECT token
  select: number;
  // Index of the token after the last one of the scope (its closing parenthesis, or the end)
  end: number;
  depth: number;
  parent: Scope | null;
  // Index of the FROM token, -1 if the query is not finished yet
  from: number;
}

const CLAUSE_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "with",
  "group",
  "having",
  "order",
  "limit",
  "offset",
  "for",
  "using",
  "update",
]);

// Clauses where a name is a field of the object of the query
const FIELD_CLAUSES = new Set(["select", "where", "group", "having", "order"]);

// Words of the language that look like names: never fields
const SOQL_WORDS = new Set([
  "select",
  "from",
  "where",
  "with",
  "group",
  "by",
  "having",
  "order",
  "limit",
  "offset",
  "for",
  "using",
  "update",
  "view",
  "reference",
  "tracking",
  "viewstat",
  "scope",
  "and",
  "or",
  "not",
  "in",
  "like",
  "includes",
  "excludes",
  "asc",
  "desc",
  "nulls",
  "first",
  "last",
  "null",
  "true",
  "false",
  "rollup",
  "cube",
  "typeof",
  "when",
  "then",
  "else",
  "end",
  "security_enforced",
  "user_mode",
  "system_mode",
  "data",
  "category",
  "at",
  "above",
  "below",
  "above_or_below",
  "all",
  "rows",
  "yesterday",
  "today",
  "tomorrow",
]);

// LAST_N_DAYS, THIS_FISCAL_QUARTER, NEXT_WEEK...
const DATE_LITERAL = /^(last|this|next)_\w+$|^n_\w+_ago$/i;

/**
 * Range of the SOQL query around an offset of a document: an inline Apex query between
 * brackets, a query in an Apex or JavaScript string, or a query alone in a .soql file.
 */
export function findSoqlQueryRange(
  text: string,
  offset: number,
): SoqlRange | null {
  const selectPattern = /\bselect\b/gi;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = selectPattern.exec(text)) !== null) {
    if (match.index > offset) {
      break;
    }
    starts.push(match.index);
  }
  // The nearest SELECT before the offset that does not open a subquery starts the query
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i];
    const opener = previousNonSpaceCharacter(text, start);
    if (opener === "(") {
      continue;
    }
    const end = scanQueryEnd(text, start, opener);
    if (offset < end || (offset === end && end === text.length)) {
      return { start, end };
    }
    return null;
  }
  return null;
}

/**
 * The field (or object) the selection points at in the query around it.
 * selectionStart and selectionEnd are offsets in text; an empty selection uses the word under the cursor.
 * Throws a SoqlResolveError when the selection is not a field of a SOQL query.
 */
export async function resolveSoqlSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  schema: SoqlSchema,
): Promise<SoqlSelectionTarget> {
  // Spaces and dots around the selection are not part of the name
  let start = Math.min(selectionStart, selectionEnd);
  let end = Math.max(selectionStart, selectionEnd);
  while (start < end && /[\s.]/.test(text[start])) {
    start++;
  }
  while (end > start && /[\s.]/.test(text[end - 1])) {
    end--;
  }
  const selectedText = text.slice(start, end);

  const range = findSoqlQueryRange(text, start);
  if (!range || end > range.end) {
    throw new SoqlResolveError("noQuery");
  }
  const tokens = tokenize(text, range.start, range.end);
  const tokenIndex = findSelectedToken(tokens, start, end);
  if (tokenIndex < 0) {
    throw new SoqlResolveError("notAField", { text: selectedText });
  }
  const path = readPath(tokens, tokenIndex);
  // A selection running over several names (Id, Name) is not one field
  if (start < tokens[path.first].start || end > tokens[path.last].end) {
    throw new SoqlResolveError("notAField", { text: selectedText });
  }
  const pathText = text.slice(tokens[path.first].start, tokens[path.last].end);
  const notAField = () =>
    new SoqlResolveError("notAField", { text: selectedText || pathText });

  const scopes = buildScopes(tokens);
  const scope = innermostScope(scopes, tokenIndex);
  if (!scope || scope.from < 0 || tokens[scope.from + 1]?.type !== "ident") {
    throw notAField();
  }

  const clause = clauseOf(tokens, scope, path.first);
  const before = tokens[path.first - 1];
  const after = tokens[path.last + 1];
  // A function (COUNT, toLabel...) or a bind variable (:accountIds)
  if (after?.value === "(" || before?.value === ":") {
    throw notAField();
  }

  // The object after FROM: find where the object is used
  if (clause === "from") {
    if (path.first !== scope.from + 1) {
      throw notAField();
    }
    const objectName = await scopeObject(tokens, scope, schema);
    return {
      kind: "object",
      objectName: (await schema.objectName(objectName)) || objectName,
    };
  }
  if (!FIELD_CLAUSES.has(clause)) {
    throw notAField();
  }
  if (clause === "select" && isInTypeof(tokens, scope, path.first)) {
    throw new SoqlResolveError("unsupportedTypeof", { text: pathText });
  }
  const segments = path.segments.slice();
  let selected = path.selected;
  if (
    segments.length === 1 &&
    (SOQL_WORDS.has(segments[0].toLowerCase()) ||
      DATE_LITERAL.test(segments[0]) ||
      aggregateAliases(tokens, scope).has(segments[0].toLowerCase()))
  ) {
    throw notAField();
  }

  const objectName = await scopeObject(tokens, scope, schema);
  // A name prefixed with the alias or the object of the query: a.Name, Account.Name FROM Account
  const prefixes = [
    tokens[scope.from + 1].value,
    objectName,
    fromAlias(tokens, scope),
  ]
    .filter((prefix): prefix is string => !!prefix)
    .map((prefix) => prefix.toLowerCase());
  if (segments.length > 1 && prefixes.includes(segments[0].toLowerCase())) {
    segments.shift();
    if (selected === 0) {
      return {
        kind: "object",
        objectName: (await schema.objectName(objectName)) || objectName,
      };
    }
    selected--;
  }

  // Each name before the selected one is a relationship to follow
  let currentObject = objectName;
  for (let i = 0; i < selected; i++) {
    const relationship = await schema.parentRelationship(
      currentObject,
      segments[i],
    );
    if (!relationship?.target) {
      throw new SoqlResolveError("unresolvedRelationship", {
        object: currentObject,
        relationship: segments[i],
      });
    }
    currentObject = relationship.target;
  }

  // The selected name is the field, or the lookup field of a relationship (Owner in Owner.Name)
  let fieldName = segments[selected];
  if (selected < segments.length - 1) {
    const relationship = await schema.parentRelationship(
      currentObject,
      fieldName,
    );
    fieldName = relationship?.field || relationshipFieldName(fieldName);
  }
  const custom = /__c$/i.test(fieldName);
  if (custom) {
    fieldName = (await schema.fieldName(currentObject, fieldName)) || fieldName;
    currentObject = (await schema.objectName(currentObject)) || currentObject;
  }
  return {
    kind: "field",
    objectName: currentObject,
    fieldName,
    apiName: `${currentObject}.${fieldName}`,
    custom,
  };
}

// The lookup field of a relationship, by the Salesforce naming rules: Account -> AccountId, Invoice__r -> Invoice__c
export function relationshipFieldName(relationshipName: string): string {
  if (/__r$/i.test(relationshipName)) {
    return relationshipName.replace(/__r$/i, "__c");
  }
  return `${relationshipName}Id`;
}

function previousNonSpaceCharacter(text: string, index: number): string {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(text[i])) {
      return text[i];
    }
  }
  return "";
}

// End of a query: the closing quote of the string holding it, else the closing bracket,
// semicolon or parenthesis that is not part of it
function scanQueryEnd(text: string, start: number, opener: string): number {
  const inString = opener === "'" || opener === '"';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const character = text[i];
    if (character === "\\") {
      i++;
      continue;
    }
    if (inString) {
      if (character === opener) {
        return i;
      }
      continue;
    }
    if (character === "'") {
      i = skipString(text, i);
      continue;
    }
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      if (depth === 0) {
        return i;
      }
      depth--;
    } else if ((character === "]" || character === ";") && depth === 0) {
      return i;
    }
  }
  return text.length;
}

// Index of the closing quote of the SOQL string starting at index
function skipString(text: string, index: number): number {
  for (let i = index + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
    } else if (text[i] === "'") {
      return i;
    }
  }
  return text.length;
}

function tokenize(text: string, start: number, end: number): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let i = start;
  while (i < end) {
    const character = text[i];
    if (/\s/.test(character)) {
      i++;
      continue;
    }
    let tokenEnd: number;
    let type: Token["type"];
    if (/[A-Za-z_]/.test(character)) {
      type = "ident";
      tokenEnd = i + 1;
      while (tokenEnd < end && /\w/.test(text[tokenEnd])) {
        tokenEnd++;
      }
    } else if (/\d/.test(character)) {
      // Numbers and date literals: 100, 2026-01-31, 2026-01-31T00:00:00Z
      type = "number";
      tokenEnd = i + 1;
      while (tokenEnd < end && /[\w\-:.+]/.test(text[tokenEnd])) {
        tokenEnd++;
      }
    } else if (character === "'") {
      type = "string";
      tokenEnd = Math.min(skipString(text, i) + 1, end);
    } else {
      type = "punct";
      tokenEnd = i + 1;
    }
    const value = text.slice(i, tokenEnd);
    if (value === ")") {
      depth--;
    }
    tokens.push({ type, value, start: i, end: tokenEnd, depth });
    if (value === "(") {
      depth++;
    }
    i = tokenEnd;
  }
  return tokens;
}

// The name token holding the last selected character, or the one under the cursor
function findSelectedToken(
  tokens: Token[],
  start: number,
  end: number,
): number {
  const position = end > start ? end - 1 : start;
  let index = tokens.findIndex(
    (token) =>
      token.type === "ident" && token.start <= position && position < token.end,
  );
  // Cursor right after a name: Name|
  if (index < 0 && end === start) {
    index = tokens.findIndex(
      (token) => token.type === "ident" && token.end === start,
    );
  }
  return index;
}

// The dotted name around a token: Account.Owner.Name, and which part of it is selected
function readPath(
  tokens: Token[],
  index: number,
): { first: number; last: number; segments: string[]; selected: number } {
  let first = index;
  while (
    tokens[first - 1]?.value === "." &&
    tokens[first - 2]?.type === "ident"
  ) {
    first -= 2;
  }
  let last = index;
  while (
    tokens[last + 1]?.value === "." &&
    tokens[last + 2]?.type === "ident"
  ) {
    last += 2;
  }
  const segments: string[] = [];
  for (let i = first; i <= last; i += 2) {
    segments.push(tokens[i].value);
  }
  return { first, last, segments, selected: (index - first) / 2 };
}

function buildScopes(tokens: Token[]): Scope[] {
  const scopes: Scope[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== "ident" || token.value.toLowerCase() !== "select") {
      return;
    }
    let end = tokens.length;
    for (let i = index + 1; i < tokens.length; i++) {
      if (tokens[i].depth < token.depth) {
        end = i;
        break;
      }
    }
    const from = tokens.findIndex(
      (other, i) =>
        i > index &&
        i < end &&
        other.depth === token.depth &&
        other.type === "ident" &&
        other.value.toLowerCase() === "from",
    );
    // Scopes are found in order: the parent is the last one still open
    const parent =
      [...scopes]
        .reverse()
        .find((other) => other.select < index && index < other.end) || null;
    scopes.push({ select: index, end, depth: token.depth, parent, from });
  });
  return scopes;
}

function innermostScope(scopes: Scope[], index: number): Scope | null {
  let found: Scope | null = null;
  for (const scope of scopes) {
    if (scope.select <= index && index < scope.end) {
      found = scope;
    }
  }
  return found;
}

// The clause (select, from, where...) a token of the scope belongs to
function clauseOf(tokens: Token[], scope: Scope, index: number): string {
  let clause = "select";
  for (let i = scope.select; i <= index; i++) {
    const token = tokens[i];
    const value = token.value.toLowerCase();
    // Order.Name FROM OrderItem: a relationship, not the ORDER BY clause
    const isName = tokens[i - 1]?.value === "." || tokens[i + 1]?.value === ".";
    const needsBy = value === "group" || value === "order";
    if (
      token.type === "ident" &&
      token.depth === scope.depth &&
      CLAUSE_KEYWORDS.has(value) &&
      !isName &&
      (!needsBy || tokens[i + 1]?.value.toLowerCase() === "by")
    ) {
      clause = value;
    }
  }
  return clause;
}

// Inside TYPEOF ... END, a name is a field of one of the objects of a polymorphic relationship
function isInTypeof(tokens: Token[], scope: Scope, index: number): boolean {
  let open = false;
  for (let i = scope.select; i < index; i++) {
    const value = tokens[i].value.toLowerCase();
    if (tokens[i].depth !== scope.depth || tokens[i].type !== "ident") {
      continue;
    }
    if (value === "typeof") {
      open = true;
    } else if (value === "end") {
      open = false;
    }
  }
  return open;
}

// Names given to aggregates: COUNT(Id) total
function aggregateAliases(tokens: Token[], scope: Scope): Set<string> {
  const aliases = new Set<string>();
  const selectEnd = scope.from < 0 ? scope.end : scope.from;
  for (let i = scope.select + 1; i < selectEnd; i++) {
    if (
      tokens[i].type === "ident" &&
      tokens[i].depth === scope.depth &&
      tokens[i - 1].value === ")"
    ) {
      aliases.add(tokens[i].value.toLowerCase());
    }
  }
  return aliases;
}

// FROM Account a: the alias a
function fromAlias(tokens: Token[], scope: Scope): string | null {
  const alias = tokens[scope.from + 2];
  if (
    alias?.type === "ident" &&
    alias.depth === scope.depth &&
    !CLAUSE_KEYWORDS.has(alias.value.toLowerCase())
  ) {
    return alias.value;
  }
  return null;
}

// A subquery in the field list reads a child relationship of its parent query (FROM Contacts),
// any other subquery reads an object (WHERE Id IN (SELECT AccountId FROM Contact))
async function scopeObject(
  tokens: Token[],
  scope: Scope,
  schema: SoqlSchema,
): Promise<string> {
  const fromName = tokens[scope.from + 1].value;
  const parent = scope.parent;
  if (parent && parent.from >= 0 && scope.select < parent.from) {
    const parentObject = await scopeObject(tokens, parent, schema);
    const childObject = await schema.childRelationship(parentObject, fromName);
    if (!childObject) {
      throw new SoqlResolveError("unresolvedRelationship", {
        object: parentObject,
        relationship: fromName,
      });
    }
    return childObject;
  }
  return fromName;
}
