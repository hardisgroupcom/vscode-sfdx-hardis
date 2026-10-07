import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { activateExtension, recordSentMessages, waitFor } from "./uiTestUtils";
import { CdpWindow } from "./cdpWindow";

/**
 * The Metadata Retriever against a REAL org, with the REAL Salesforce CLI: the retrieve modes and
 * the empty CustomObject cleaning are about what Salesforce returns, which no mock can tell.
 *
 * It never changes the org: it only retrieves. It rewrites files of the workspace, so give it a
 * throwaway SFDX project that is a git repository, never a project you work in.
 *
 *   SFDX_HARDIS_REAL_RETRIEVER=true
 *   SFDX_HARDIS_LAB_WORKSPACE         the throwaway project, opened as the workspace
 *   SFDX_HARDIS_REAL_RETRIEVER_ORG    username or alias of the org to retrieve from
 *   SFDX_HARDIS_REAL_RETRIEVER_ITEMS  optional "Profile:Admin,CustomField:Obj__c.Field__c,PermissionSet:X":
 *                                     one Profile, one field of an object that is NOT in the workspace,
 *                                     and one component of another type
 *   SFDX_HARDIS_REAL_RETRIEVER_SHOTS  optional folder for captures of the panel
 *
 *   yarn dev && yarn compile && node ./out/test/runUiTest.js
 */

const REAL_MODE = process.env.SFDX_HARDIS_REAL_RETRIEVER === "true";
const LWC_ID = "s-metadata-retriever";
const RETRIEVE_TIMEOUT_MS = 600000;

function parseItems(): { memberType: string; memberName: string }[] {
  const raw =
    process.env.SFDX_HARDIS_REAL_RETRIEVER_ITEMS ||
    "Profile:Admin,CustomField:Installation__c.Panels_Required__c,PermissionSet:Helios_Delivery_Crew";
  return raw.split(",").map((entry) => {
    const [memberType, ...rest] = entry.trim().split(":");
    return { memberType, memberName: rest.join(":") };
  });
}

function findFiles(dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findFiles(full, suffix);
    }
    return entry.name.endsWith(suffix) ? [full] : [];
  });
}

// Entries of a permission file whose boolean values are all false: what --active-only leaves out
function countInactiveEntries(xml: string): number {
  const blocks = xml.match(/^ {4}<(\w+)>[\s\S]*?^ {4}<\/\1>/gm) || [];
  return blocks.filter(
    (block) => />false</.test(block) && !/>true</.test(block),
  ).length;
}

suite("Metadata Retriever on a real org", function () {
  this.timeout(RETRIEVE_TIMEOUT_MS * 4);

  let panelManager: any;
  let workspaceRoot = "";
  const org = process.env.SFDX_HARDIS_REAL_RETRIEVER_ORG || "";
  const shotsDir = process.env.SFDX_HARDIS_REAL_RETRIEVER_SHOTS || "";
  const items = parseItems();
  const profile = items.find((item) => item.memberType === "Profile");
  const field = items.find((item) => item.memberType === "CustomField");
  // What the file-based retrieve of the Profile alone returned, to compare the CRUD read with
  let fileBasedTabSettings = -1;

  const countTag = (xml: string, tag: string) =>
    (xml.match(new RegExp(`<${tag}>`, "g")) || []).length;

  async function shoot(name: string): Promise<void> {
    const port = CdpWindow.portFromEnv();
    if (!shotsDir || !port) {
      return;
    }
    fs.mkdirSync(shotsDir, { recursive: true });
    const driver = new CdpWindow(port);
    try {
      await driver.capture(path.join(shotsDir, `${name}.png`), { top: 0 });
    } catch (error: any) {
      console.log(`      [shot] ${name}: FAILED ${error?.message || error}`);
    } finally {
      driver.close();
    }
  }

  async function openPanel(): Promise<any> {
    await vscode.commands.executeCommand(
      "vscode-sfdx-hardis.showMetadataRetriever",
    );
    return await waitFor(
      () => panelManager.getPanel(LWC_ID),
      60000,
      "the Metadata Retriever panel to open",
    );
  }

  // Sends what the panel sends when Retrieve is clicked, and waits for the retrieve to end
  async function retrieve(
    panel: any,
    retrieveMode: string,
    metadata: { memberType: string; memberName: string }[],
  ): Promise<any[]> {
    const sent = recordSentMessages(panel);
    panel.simulateWebviewMessage({
      type: "retrieveSelectedMetadata",
      data: { username: org, localPackage: null, retrieveMode, metadata },
    });
    await waitFor(
      () =>
        sent.find(
          (message) =>
            message?.type === "retrieveState" &&
            message?.data?.isRetrieving === false,
        ),
      RETRIEVE_TIMEOUT_MS,
      `the ${retrieveMode} retrieve to end`,
    );
    return sent;
  }

  function profileFile(): string {
    const files = findFiles(
      workspaceRoot,
      `${profile!.memberName}.profile-meta.xml`,
    ).filter((file) => !file.includes("node_modules"));
    assert.strictEqual(files.length, 1, `one ${profile!.memberName} Profile`);
    return files[0];
  }

  suiteSetup(async function () {
    if (!REAL_MODE) {
      this.skip();
    }
    assert.ok(org, "SFDX_HARDIS_REAL_RETRIEVER_ORG must name the org");
    assert.ok(profile && field, "the items need a Profile and a CustomField");
    workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  // First, while the Profile is not in the workspace yet: on a source tracked org, a standard retrieve
  // of a file the CRUD read rewrote raises the conflict prompt, which waits for a click
  test("Off: the Profile retrieved alone is the file-based one", async () => {
    const panel = await openPanel();
    await new Promise((resolve) => setTimeout(resolve, 25000));
    await shoot("retriever-real-org-opened");
    await retrieve(panel, "off", [profile!]);
    // How much comes back depends on the org (nothing but user permissions on a sandbox, the custom
    // components on a scratch org): keep the count, the Auto test must bring back more
    const profileXml = fs.readFileSync(profileFile(), "utf8");
    fileBasedTabSettings = countTag(profileXml, "tabVisibilities");
    console.log(
      `      file-based Profile alone: ${countTag(profileXml, "fieldPermissions")} field permissions, ${fileBasedTabSettings} tab settings`,
    );
  });

  test("Auto: the Profile comes back whole without inactive entries, and no empty object is left", async () => {
    const objectName = field!.memberName.split(".")[0];
    assert.strictEqual(
      findFiles(workspaceRoot, `${objectName}.object-meta.xml`).length,
      0,
      `${objectName} must not be in the workspace before the retrieve`,
    );
    const panel = await openPanel();
    const sent = await retrieve(panel, "auto", items);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await shoot("retriever-real-org-after-auto");

    // The Profile was read with the CRUD Metadata API: field permissions are there although no
    // object was retrieved with it, and nothing in it grants nothing
    const profileXml = fs.readFileSync(profileFile(), "utf8");
    assert.ok(
      /<fieldPermissions>/.test(profileXml),
      "a Profile retrieved alone by a file-based retrieve has no fieldPermissions: the CRUD read was not used",
    );
    assert.strictEqual(
      countInactiveEntries(profileXml),
      0,
      "entries that grant nothing must be left out in Auto",
    );
    const tabSettings = countTag(profileXml, "tabVisibilities");
    console.log(
      `      CRUD read Profile: ${countTag(profileXml, "fieldPermissions")} field permissions, ${tabSettings} tab settings`,
    );
    assert.ok(
      tabSettings > fileBasedTabSettings,
      "the CRUD read brings back the tab settings the file-based retrieve leaves out",
    );

    // The field came through the standard retrieve, and its empty parent object was removed
    const fieldName = field!.memberName.split(".")[1];
    assert.strictEqual(
      findFiles(workspaceRoot, `${fieldName}.field-meta.xml`).length,
      1,
      "the field was retrieved",
    );
    assert.strictEqual(
      findFiles(workspaceRoot, `${objectName}.object-meta.xml`).length,
      0,
      "the empty CustomObject file must have been removed",
    );

    // The panel is told about every requested component, and not about the removed object
    const localCheck = sent
      .filter((message) => message?.type === "postRetrieveLocalCheck")
      .flatMap((message) => message?.data?.files || []);
    for (const item of items) {
      assert.ok(
        localCheck.some(
          (file: any) =>
            file.MemberType === item.memberType &&
            file.MemberName === item.memberName,
        ),
        `${item.memberType}:${item.memberName} is reported to the panel`,
      );
    }
    assert.ok(
      !localCheck.some((file: any) => file.MemberType === "CustomObject"),
      "the removed empty object is not reported as retrieved",
    );
  });

  test("Full, all tags keeps the inactive entries that Full, active only leaves out", async () => {
    const panel = await openPanel();
    await retrieve(panel, "full", [profile!]);
    const allTags = countInactiveEntries(
      fs.readFileSync(profileFile(), "utf8"),
    );
    await retrieve(panel, "fullActiveOnly", [profile!]);
    const activeOnly = countInactiveEntries(
      fs.readFileSync(profileFile(), "utf8"),
    );
    console.log(
      `      inactive entries: ${allTags} with all tags, ${activeOnly} active only`,
    );
    assert.ok(allTags > 0, "the CRUD read returns entries that grant nothing");
    assert.strictEqual(activeOnly, 0);
  });
});
