export function prettifyFieldName(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .replace("( P M)", "(PM)")
    .replace("S Object", "SObject");
}
