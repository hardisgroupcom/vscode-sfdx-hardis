import { execSfdxJson } from "../../utils";
import { Logger } from "../../logger";
import { listProjectSchedulableClasses } from "../prePostCommandsUtils";

/**
 * Lists proposed in the deployment action editor that are read from the default org.
 * The schedulable classes are also read from the project sources.
 * Shared by the DevOps Pipeline panel and the Pipeline Settings panel, which both
 * open the same deployment action editor.
 */

const ORG_NAMES_CACHE_TTL_MS = 15 * 60 * 1000;

const schedulableClassesByOrgCache = new Map<
  string,
  { expiresAt: number; values: string[] }
>();
const communitiesByOrgCache = new Map<
  string,
  { expiresAt: number; values: string[] }
>();

async function getDefaultOrgUsername(): Promise<string> {
  try {
    const orgDisplay = await execSfdxJson("sf org display --json", {
      fail: false,
      output: false,
    });
    return (
      orgDisplay?.result?.username || orgDisplay?.result?.alias || "default"
    );
  } catch {
    return "default";
  }
}

async function fetchAndCacheOrgNames(
  cache: Map<string, { expiresAt: number; values: string[] }>,
  orgKey: string,
  now: number,
  command: string,
  filter?: (record: any) => boolean,
  nameOf: (record: any) => string = (record) => String(record?.Name || ""),
): Promise<string[] | null> {
  const result = await execSfdxJson(command, {
    fail: false,
    output: false,
  });
  // No records array: the org could not be read, which is not an empty list
  if (!Array.isArray(result?.result?.records)) {
    return null;
  }
  const records = result.result.records;
  const filtered = filter ? records.filter(filter) : records;
  const values = filtered
    .map((record: any) => nameOf(record).trim())
    .filter((v: string) => v.length > 0);
  const uniqueSorted: string[] = [...new Set<string>(values)].sort(
    (a: string, b: string) => a.localeCompare(b),
  );
  if (uniqueSorted.length > 0) {
    cache.set(orgKey, {
      expiresAt: now + ORG_NAMES_CACHE_TTL_MS,
      values: uniqueSorted,
    });
  }
  return uniqueSorted;
}

// What the Tooling API returns as the body of a managed class that is not global
const HIDDEN_APEX_BODY = "(hidden)";

/**
 * A managed package shows the signature of its global classes and hides every
 * other one, so a body that is readable and mentions Schedulable is a class
 * that can be scheduled from here, whichever package it comes from.
 */
export function isSchedulableApexClass(record: any): boolean {
  const body = String(record?.Body || "");
  return (
    body !== HIDDEN_APEX_BODY && body.toLowerCase().includes("schedulable")
  );
}

/**
 * The name sfdx-hardis schedules the class under: a class of a managed package
 * carries its namespace, a class of the org or of the project does not.
 */
export function schedulableApexClassName(record: any): string {
  const name = String(record?.Name || "");
  const namespace = String(record?.NamespacePrefix || "");
  return namespace && record?.ManageableState !== "unmanaged"
    ? `${namespace}.${name}`
    : name;
}

// null when the org could not be read
export async function listSchedulableClassesFromDefaultOrg(): Promise<
  string[] | null
> {
  const orgKey = await getDefaultOrgUsername();
  const now = Date.now();
  const cached = schedulableClassesByOrgCache.get(orgKey);
  if (cached && cached.expiresAt > now) {
    return cached.values;
  }
  const query =
    "SELECT Name, NamespacePrefix, ManageableState, Body FROM ApexClass ORDER BY Name";
  const command = `sf data query --query "${query}" --use-tooling-api --json`;
  return fetchAndCacheOrgNames(
    schedulableClassesByOrgCache,
    orgKey,
    now,
    command,
    isSchedulableApexClass,
    schedulableApexClassName,
  );
}

export interface PickerValues {
  values: string[];
  // Values found in the project sources and not in the default org
  projectOnlyValues?: string[];
}

/**
 * Merges the schedulable classes of the default org with those of the project.
 * A class merged in git and not deployed to the default org yet is only in the
 * project: it can still be scheduled, as the deployment brings it to the target
 * org before the action runs, so it is listed and reported as project only.
 * When the org could not be read (null), nothing is known about what it holds:
 * the project classes are listed and none is reported as project only.
 */
export function mergeSchedulableClasses(
  orgClasses: string[] | null,
  projectClasses: string[],
): PickerValues {
  if (orgClasses === null) {
    return { values: [...projectClasses], projectOnlyValues: [] };
  }
  const orgKeys = new Set(orgClasses.map((name) => name.toLowerCase()));
  const projectOnlyValues = projectClasses.filter(
    (name) => !orgKeys.has(name.toLowerCase()),
  );
  const values = [...orgClasses, ...projectOnlyValues].sort((a, b) =>
    a.localeCompare(b),
  );
  return { values, projectOnlyValues };
}

export async function listSchedulableClasses(): Promise<PickerValues> {
  // One source failing must not hide the other
  const [orgClasses, projectClasses] = await Promise.all([
    listSchedulableClassesFromDefaultOrg().catch(() => null),
    listProjectSchedulableClasses().catch(() => [] as string[]),
  ]);
  return mergeSchedulableClasses(orgClasses, projectClasses);
}

export async function listCommunitiesFromDefaultOrg(): Promise<string[]> {
  const orgKey = await getDefaultOrgUsername();
  const now = Date.now();
  const cached = communitiesByOrgCache.get(orgKey);
  if (cached && cached.expiresAt > now) {
    return cached.values;
  }
  const query = "SELECT Name FROM Network ORDER BY Name";
  const command = `sf data query --query "${query}" --json`;
  return (
    (await fetchAndCacheOrgNames(
      communitiesByOrgCache,
      orgKey,
      now,
      command,
    )) ?? []
  );
}

/**
 * Answers the lazy-load messages sent by the deployment action editor.
 * Returns true when the message has been handled, so that callers can keep
 * their own handling for the other message types.
 */
export async function handleDeploymentActionPickerMessage(
  panel: { sendMessage: (message: any) => void },
  type: string,
  data: any,
): Promise<boolean> {
  const pickers: Record<
    string,
    { responseType: string; list: () => Promise<PickerValues> }
  > = {
    loadSchedulableClasses: {
      responseType: "returnSchedulableClasses",
      list: listSchedulableClasses,
    },
    loadCommunities: {
      responseType: "returnCommunities",
      list: async () => ({ values: await listCommunitiesFromDefaultOrg() }),
    },
  };
  const picker = pickers[type];
  if (!picker) {
    return false;
  }
  const requestId = data?.requestId || null;
  let result: PickerValues = { values: [] };
  try {
    result = await picker.list();
  } catch (error: any) {
    Logger.log(
      `Error loading ${type} for the deployment action editor: ${error?.message || error}`,
    );
  }
  panel.sendMessage({
    type: picker.responseType,
    data: { requestId, ...result },
  });
  return true;
}
