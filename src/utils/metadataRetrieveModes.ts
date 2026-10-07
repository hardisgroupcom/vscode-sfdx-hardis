// Retrieve modes of the Metadata Retriever, and the pure helpers that route the selected items
// between sf hardis mdapi read (CRUD Metadata API) and sf project retrieve start.

export type RetrieveMode = "auto" | "fullActiveOnly" | "full" | "off";

export const DEFAULT_RETRIEVE_MODE: RetrieveMode = "auto";

export const RETRIEVE_MODES: RetrieveMode[] = [
  "auto",
  "fullActiveOnly",
  "full",
  "off",
];

// Types the Auto mode reads with the CRUD Metadata API. A file-based retrieve returns a Profile with only
// the permissions related to the other components of the same request. Compared type by type against
// sf hardis mdapi read on a real org (API 67): PermissionSet, PermissionSetGroup, RecordType,
// CustomApplication, CustomObject and the translation types come back the same, and the CRUD read even
// writes translations worse (empty tags instead of the untranslated value), so they stay file-based.
export const AUTO_CRUD_TYPES = ["Profile"];

export interface RetrieveItem {
  memberType: string;
  memberName: string;
  deleted?: boolean;
}

export interface RetrieveOutcome {
  success: boolean;
  files: any[];
  messages: any[];
}

// Read the mode sent by the panel. useCrudApi is what panels sent before the modes existed.
export function parseRetrieveMode(
  value: unknown,
  legacyUseCrudApi?: unknown,
): RetrieveMode {
  if (RETRIEVE_MODES.includes(value as RetrieveMode)) {
    return value as RetrieveMode;
  }
  if (legacyUseCrudApi === true) {
    return "full";
  }
  return DEFAULT_RETRIEVE_MODE;
}

export function splitByRetrieveMode<T extends RetrieveItem>(
  items: T[],
  mode: RetrieveMode,
): { crudItems: T[]; standardItems: T[] } {
  if (mode === "off") {
    return { crudItems: [], standardItems: [...items] };
  }
  if (mode === "full" || mode === "fullActiveOnly") {
    // Types the CRUD Metadata API cannot read (Apex, LWC...) are reported as skipped by the CLI
    return { crudItems: [...items], standardItems: [] };
  }
  return {
    crudItems: items.filter((item) =>
      AUTO_CRUD_TYPES.includes(item.memberType),
    ),
    standardItems: items.filter(
      (item) => !AUTO_CRUD_TYPES.includes(item.memberType),
    ),
  };
}

export function toMetadataArgs(items: RetrieveItem[]): string {
  return items
    .map((item) => `--metadata "${item.memberType}:${item.memberName}"`)
    .join(" ");
}

// No --output-dir: with it, the CLI merges only inside that folder and a Profile that lives in another
// package directory would be written twice. The chosen package is made the default one instead, so new
// files land there and existing ones are updated in place, as with sf project retrieve start.
export function buildCrudReadCommand(options: {
  source: string;
  username: string;
  mode: RetrieveMode;
  // false when the installed sfdx-hardis does not know --active-only yet
  activeOnlySupported?: boolean;
}): string {
  const activeOnly =
    options.activeOnlySupported !== false &&
    (options.mode === "auto" || options.mode === "fullActiveOnly");
  return (
    `sf hardis mdapi read ${options.source} --target-org ${options.username}` +
    (activeOnly ? " --active-only" : "") +
    " --agent --ignore-errors --json"
  );
}

// sfdx-hardis older than 8.15.0 rejects --active-only: the read is then run again without it
export function isActiveOnlyFlagUnknown(result: any): boolean {
  const message = `${result?.error?.message || ""} ${result?.message || ""} ${result?.errorMessage || ""}`;
  return (
    message.includes("--active-only") &&
    /nonexistent flag|unknown flag|unexpected argument/i.test(message)
  );
}

// Command that deletes the empty CustomObject files a retrieve just wrote. The CLI keeps any file
// already committed, so only the ones this retrieve created (not in git yet) are removed.
export function buildEmptyObjectsCleaningCommand(): string {
  return "sf hardis:project:clean:emptyitems --metadata-type CustomObject --agent --json";
}

// Object names of the CustomObject files the cleaning removed, from its --json output
export function removedEmptyObjectNames(result: any): string[] {
  const removed = Array.isArray(result?.result?.removed)
    ? result.result.removed
    : [];
  const names = removed
    .filter((item: any) => item?.type === "CustomObject" && item?.file)
    .map((item: any) =>
      String(item.file)
        .replace(/\\/g, "/")
        .split("/")
        .pop()!
        .replace(".object-meta.xml", ""),
    );
  return [...new Set<string>(names)];
}

export function buildStandardRetrieveCommand(options: {
  source: string;
  username: string;
  forceOverwrite: boolean;
}): string {
  return (
    `sf project retrieve start ${options.source} --target-org ${options.username}` +
    (options.forceOverwrite ? " --ignore-conflicts" : "") +
    " --json"
  );
}

// Objects whose .object-meta.xml a retrieve of these items can write: the objects themselves, and the
// parent of every Parent.Child member (a field, list view, record type or validation rule retrieved
// without its object makes Salesforce CLI write an empty <CustomObject></CustomObject> parent file).
export function candidateObjectNames(items: RetrieveItem[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    if (item.memberType === "CustomObject") {
      names.add(item.memberName);
    } else if (item.memberName.includes(".")) {
      names.add(item.memberName.split(".")[0]);
    }
  }
  return [...names].filter((name) => name !== "" && !name.includes("*"));
}

// Outcome of a CLI call that returned no usable result: every requested item failed with its error.
export function failedOutcome(
  items: RetrieveItem[],
  errorMessage: string,
): RetrieveOutcome {
  return {
    success: false,
    files: items.map((item) => ({
      state: "Failed",
      type: item.memberType,
      fullName: item.memberName,
      error: errorMessage,
    })),
    messages: [
      {
        fileName: items
          .map((item) => `${item.memberType}: ${item.memberName}`)
          .join(", "),
        problem: errorMessage,
      },
    ],
  };
}

export function mergeRetrieveOutcomes(
  outcomes: RetrieveOutcome[],
): RetrieveOutcome {
  return {
    success: outcomes.every((outcome) => outcome.success === true),
    files: outcomes.flatMap((outcome) => outcome.files || []),
    messages: outcomes.flatMap((outcome) => outcome.messages || []),
  };
}
