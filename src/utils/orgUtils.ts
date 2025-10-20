import { execSfdxJson } from "../utils";

export type SalesforceOrg = {
  username?: string;
  alias?: string;
  orgType?: "production" | "sandbox" | "scratch" | "other";
  isDefaultUsername?: boolean;
  isDevHub?: boolean;
  isDefaultDevHubUsername?: boolean;
  isScratch?: boolean;
  isSandbox?: boolean;
  instanceUrl?: string;
  instanceApiVersion?: string;
  loginUrl?: string;
  orgId?: string;
  createdDate?: string;
  expirationDate?: string | null;
  connectedStatus?: string;
  name?: string;
};

export async function listAllOrgs(all = false): Promise<SalesforceOrg[]> {
  // List all orgs
  const orgListRes = await execSfdxJson(`sf org list${all ? " --all" : ""}`);

  // orgListRes.result may contain several arrays grouped by type (other, sandboxes, nonScratchOrgs, devHubs, scratchOrgs, ...)
  // We want to return a single flattened list of orgs. Deduplicate by orgId when present, otherwise by username.
  const result = orgListRes?.result || {};

  // Collect candidate arrays from the result object. If result is an array (older formats), use it directly.
  const buckets: any[] = [];
  if (Array.isArray(result)) {
    buckets.push(...result);
  } else if (typeof result === "object" && result !== null) {
    for (const val of Object.values(result)) {
      if (Array.isArray(val)) {
        buckets.push(...val);
      }
    }
  }
  const seen = new Map<string, SalesforceOrg>();
  for (const org of buckets) {
    if (!org) {
      continue;
    }
    const key =
      org.orgId || org.username || org.instanceUrl || JSON.stringify(org);
    if (seen.has(key)) {
      // already added (avoid duplicates)
      continue;
    }
    // Determine org type
    let orgType: "production" | "sandbox" | "scratch" | "other" = "other";
    if (org.isScratch) {
      orgType = "scratch";
    } else if (
      org.isSandbox ||
      (org.instanceUrl && org.instanceUrl.includes(".sandbox"))
    ) {
      orgType = "sandbox";
    } else if (
      !org.instanceUrl.includes("dev-ed") &&
      !org.instanceUrl.includes("test") &&
      !org.instanceUrl.includes("sandbox")
    ) {
      orgType = "production";
    }
    const normalized: SalesforceOrg = {
      username: org.username,
      alias: org.alias,
      orgType: orgType,
      isDefaultUsername: !!org.isDefaultUsername,
      isDefaultDevHubUsername: !!org.isDefaultDevHubUsername,
      isDevHub: !!org.isDevHub,
      isScratch: !!org.isScratch,
      isSandbox: !!org.isSandbox,
      instanceUrl: org.instanceUrl,
      loginUrl: org.loginUrl,
      orgId: org.orgId,
      createdDate: org.createdDate,
      expirationDate: org.expirationDate || org.trailExpirationDate,
      connectedStatus: org.connectedStatus,
      name: org.name,
    };
    seen.set(key, normalized);
  }

  // Sort by orgType (production, sandbox, other, scratch), then by instanceUrl
  const orgTypeOrder = { production: 0, sandbox: 1, other: 2, scratch: 3 };
  return Array.from(seen.values()).sort((a, b) => {
    const aType = orgTypeOrder[a.orgType || "other"];
    const bType = orgTypeOrder[b.orgType || "other"];
    if (aType !== bType) {
      return aType - bType;
    }
    const aUrl = a.instanceUrl || "";
    const bUrl = b.instanceUrl || "";
    return aUrl.localeCompare(bUrl);
  });
}

export async function forgetOrgs(orgUsernames: string[]) {
  const results = await Promise.allSettled(
    orgUsernames.map((username) =>
      execSfdxJson(`sf org logout --target-org ${username} --noprompt`),
    ),
  );
  const successUsernames: string[] = [];
  const errorUsernames: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      successUsernames.push(orgUsernames[index]);
    } else {
      errorUsernames.push(orgUsernames[index]);
    }
  });
  return { successUsernames, errorUsernames };
}
