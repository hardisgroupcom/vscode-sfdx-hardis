import { execSfdxJson } from "../../utils";
import { Logger } from "../../logger";
import {
  BATCHABLE_APEX_CLASS_REGEX,
  listProjectBatchableClasses,
  listProjectSchedulableClasses,
} from "../prePostCommandsUtils";

/**
 * Lists proposed in the deployment action editor that are read from the default org.
 * The schedulable and the batchable classes are also read from the project sources.
 * Shared by the DevOps Pipeline panel and the Pipeline Settings panel, which both
 * open the same deployment action editor.
 */

const ORG_NAMES_CACHE_TTL_MS = 15 * 60 * 1000;

const schedulableClassesByOrgCache = new Map<
  string,
  { expiresAt: number; values: string[] }
>();
const batchableClassesByOrgCache = new Map<
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
  return cacheOrgNames(
    cache,
    orgKey,
    now,
    result.result.records,
    filter,
    nameOf,
  );
}

function cacheOrgNames(
  cache: Map<string, { expiresAt: number; values: string[] }>,
  orgKey: string,
  now: number,
  records: any[],
  filter?: (record: any) => boolean,
  nameOf: (record: any) => string = (record) => String(record?.Name || ""),
): string[] {
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

/**
 * Same rule as the schedulable classes: the body must be readable, which leaves
 * out the classes of a managed package that are not global, and it must mention
 * Database.Batchable. Such a class can be run by a "run-batch" action.
 */
export function isBatchableApexClass(record: any): boolean {
  const body = String(record?.Body || "");
  return body !== HIDDEN_APEX_BODY && BATCHABLE_APEX_CLASS_REGEX.test(body);
}

type ApexClassKind = "schedulable" | "batchable";

const APEX_CLASS_KINDS: Record<
  ApexClassKind,
  {
    cache: Map<string, { expiresAt: number; values: string[] }>;
    filter: (record: any) => boolean;
  }
> = {
  schedulable: {
    cache: schedulableClassesByOrgCache,
    filter: isSchedulableApexClass,
  },
  batchable: {
    cache: batchableClassesByOrgCache,
    filter: isBatchableApexClass,
  },
};

/**
 * Splits the Apex classes read from an org into the names each picker lists.
 * A class implementing both interfaces is in both lists.
 */
export function splitApexClassesByKind(
  records: any[],
): Record<ApexClassKind, string[]> {
  const namesOf = (filter: (record: any) => boolean) =>
    [
      ...new Set<string>(
        records
          .filter(filter)
          .map((record) => schedulableApexClassName(record).trim())
          .filter((name) => name.length > 0),
      ),
    ].sort((a, b) => a.localeCompare(b));
  return {
    schedulable: namesOf(isSchedulableApexClass),
    batchable: namesOf(isBatchableApexClass),
  };
}

// Org queries in progress, so that two pickers asking together share one
const apexClassQueriesInProgress = new Map<string, Promise<any[] | null>>();

async function queryApexClassesOfOrg(orgKey: string): Promise<any[] | null> {
  const inProgress = apexClassQueriesInProgress.get(orgKey);
  if (inProgress) {
    return inProgress;
  }
  const query =
    "SELECT Name, NamespacePrefix, ManageableState, Body FROM ApexClass ORDER BY Name";
  const command = `sf data query --query "${query}" --use-tooling-api --json`;
  const promise = (async () => {
    const result = await execSfdxJson(command, { fail: false, output: false });
    // No records array: the org could not be read, which is not an empty list
    return Array.isArray(result?.result?.records)
      ? (result.result.records as any[])
      : null;
  })();
  apexClassQueriesInProgress.set(orgKey, promise);
  try {
    return await promise;
  } finally {
    apexClassQueriesInProgress.delete(orgKey);
  }
}

/**
 * The Apex classes of the default org are read once for both pickers: the same
 * result fills the schedulable and the batchable cache, whichever asks first.
 * null when the org could not be read.
 */
async function listApexClassesFromDefaultOrg(
  kind: ApexClassKind,
): Promise<string[] | null> {
  const orgKey = await getDefaultOrgUsername();
  const cached = APEX_CLASS_KINDS[kind].cache.get(orgKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.values;
  }
  const records = await queryApexClassesOfOrg(orgKey);
  if (records === null) {
    return null;
  }
  const namesByKind = splitApexClassesByKind(records);
  const expiresAt = Date.now() + ORG_NAMES_CACHE_TTL_MS;
  for (const key of Object.keys(APEX_CLASS_KINDS) as ApexClassKind[]) {
    // An empty list is not cached, so that the org is asked again next time
    if (namesByKind[key].length > 0) {
      APEX_CLASS_KINDS[key].cache.set(orgKey, {
        expiresAt,
        values: namesByKind[key],
      });
    }
  }
  return namesByKind[kind];
}

// null when the org could not be read
export async function listSchedulableClassesFromDefaultOrg(): Promise<
  string[] | null
> {
  return listApexClassesFromDefaultOrg("schedulable");
}

// null when the org could not be read
export async function listBatchableClassesFromDefaultOrg(): Promise<
  string[] | null
> {
  return listApexClassesFromDefaultOrg("batchable");
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

/**
 * Merges the batchable classes of the default org with those of the project,
 * with the same rules as the schedulable ones. A class found in the project
 * only is still listed: a post-deployment action finds it in the target org
 * once the metadata is deployed. A pre-deployment action does not, and the
 * editor warns about it.
 */
export function mergeBatchableClasses(
  orgClasses: string[] | null,
  projectClasses: string[],
): PickerValues {
  return mergeSchedulableClasses(orgClasses, projectClasses);
}

export async function listBatchableClasses(): Promise<PickerValues> {
  // One source failing must not hide the other
  const [orgClasses, projectClasses] = await Promise.all([
    listBatchableClassesFromDefaultOrg().catch(() => null),
    listProjectBatchableClasses().catch(() => [] as string[]),
  ]);
  return mergeBatchableClasses(orgClasses, projectClasses);
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
    loadBatchableClasses: {
      responseType: "returnBatchableClasses",
      list: listBatchableClasses,
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
