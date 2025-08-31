import { execSfdxJson } from "../utils";

export async function listOrgs() {
    // List all orgs
    const orgList = await execSfdxJson("sf org list --all");
    // For each org, add the org type (Production, Sandbox, Developer, Scratch), without calling SF Cli again
    for (const org of orgList) {
        if (org.isScratch) {
            org.orgType = "Scratch";
        } else if (org.instanceUrl.includes(".sandbox")) {
            org.orgType = "Sandbox";
        } else {
            org.orgType = "Production";
        }
    }
    return orgList;
}

export async function forgetOrgs(orgUsernames: string[]) {
    const results = await Promise.allSettled(
        orgUsernames.map((username) => execSfdxJson(`sf org logout --target-org ${username} --noprompt`))
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