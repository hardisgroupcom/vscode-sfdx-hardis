import { execSfdxJson } from "../../utils";
import { Logger } from "../../logger";

/**
 * Lists proposed in the deployment action editor that are read from the default org.
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
): Promise<string[]> {
  const result = await execSfdxJson(command, {
    fail: false,
    output: false,
  });
  const records = Array.isArray(result?.result?.records)
    ? result.result.records
    : [];
  const filtered = filter ? records.filter(filter) : records;
  const values = filtered
    .map((record: any) => String(record?.Name || "").trim())
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

export async function listSchedulableClassesFromDefaultOrg(): Promise<
  string[]
> {
  const orgKey = await getDefaultOrgUsername();
  const now = Date.now();
  const cached = schedulableClassesByOrgCache.get(orgKey);
  if (cached && cached.expiresAt > now) {
    return cached.values;
  }
  const query =
    "SELECT Name, Body FROM ApexClass WHERE ManageableState = 'unmanaged' ORDER BY Name";
  const command = `sf data query --query "${query}" --use-tooling-api --json`;
  return fetchAndCacheOrgNames(
    schedulableClassesByOrgCache,
    orgKey,
    now,
    command,
    (record: any) =>
      String(record?.Body || "")
        .toLowerCase()
        .includes("schedulable"),
  );
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
  return fetchAndCacheOrgNames(communitiesByOrgCache, orgKey, now, command);
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
    { responseType: string; list: () => Promise<string[]> }
  > = {
    loadSchedulableClasses: {
      responseType: "returnSchedulableClasses",
      list: listSchedulableClassesFromDefaultOrg,
    },
    loadCommunities: {
      responseType: "returnCommunities",
      list: listCommunitiesFromDefaultOrg,
    },
  };
  const picker = pickers[type];
  if (!picker) {
    return false;
  }
  const requestId = data?.requestId || null;
  let values: string[] = [];
  try {
    values = await picker.list();
  } catch (error: any) {
    Logger.log(
      `Error loading ${type} for the deployment action editor: ${error?.message || error}`,
    );
  }
  panel.sendMessage({
    type: picker.responseType,
    data: { requestId, values },
  });
  return true;
}
