#!/usr/bin/env node
/* eslint-disable */
/**
 * Mock of the Salesforce CLI (`sf`) used by the UI integration tests.
 *
 * Goals:
 *  - Answer instantly to the CLI probes issued by the extension at startup
 *    (`sf --version`, `sf plugins`, `sf org display --json`, ...)
 *  - For `sf hardis:*` commands, behave like the real sfdx-hardis plugin from
 *    the extension's point of view: print "WS Client started", connect to the
 *    extension's WebSocket server (--websocket host:port), send initClient
 *    (reusing SFDX_HARDIS_COMMAND_CONTEXT_ID when provided, like recent
 *    sfdx-hardis versions), stream a few log lines, then close.
 *  - Log every invocation as a JSON line into $SF_MOCK_LOG so tests can assert
 *    that (and when) commands were really executed.
 *
 * Environment variables:
 *  - SF_MOCK_LOG: path of the invocation log file (one JSON object per line)
 *  - SF_MOCK_NODE_MODULES: node_modules folder providing the `ws` package
 *  - SF_MOCK_BOOT_DELAY_MS: optional artificial CLI boot delay
 *  - SFDX_HARDIS_COMMAND_CONTEXT_ID: provisional context id set by the extension
 */
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);

// ---------------------------------------------------------------------------
// "docs" profile: realistic data used by the documentation screenshot harness
// (SFDX_HARDIS_DOC_SCREENSHOTS / src/test/ui/docScreenshots.test.ts), so every
// panel shows plausible content instead of an empty state.
// ---------------------------------------------------------------------------
const DOCS_PROFILE = process.env.SF_MOCK_PROFILE === "docs";
// "ok" (everything installed and up to date) or "missing" (a plugin is absent
// and another one is outdated), to screenshot both states of the Setup panel
const DEPS_STATE = process.env.SF_MOCK_DEPS_STATE || "ok";

// Versions reported by the mock. The screenshot driver
// (scripts/take-doc-screenshots.js) overwrites them with the real npm "latest"
// versions through SF_MOCK_VERSIONS_FILE, so the Setup panel shows every
// dependency as up to date instead of "upgrade available".
const DOCS_VERSIONS = {
  "@salesforce/cli": "2.134.6",
  "sfdx-hardis": "8.1.0",
  "@salesforce/plugin-packaging": "2.27.17",
  sfdmu: "5.6.4",
  "sfdx-git-delta": "6.31.0",
  "sf-git-merge-driver": "1.9.0",
  node: "24.11.1",
};
if (process.env.SF_MOCK_VERSIONS_FILE) {
  try {
    Object.assign(
      DOCS_VERSIONS,
      JSON.parse(fs.readFileSync(process.env.SF_MOCK_VERSIONS_FILE, "utf8")),
    );
  } catch {
    // Keep the defaults when the file is missing or unreadable
  }
}

const DOCS_PLUGINS = [
  "sfdx-hardis",
  "@salesforce/plugin-packaging",
  "sfdmu",
  "sfdx-git-delta",
  "sf-git-merge-driver",
].map((name) => ({ name, version: DOCS_VERSIONS[name] }));

function docsPlugins() {
  if (DEPS_STATE === "missing") {
    return DOCS_PLUGINS.filter((p) => p.name !== "sfdx-git-delta").map((p) =>
      p.name === "sfdmu" ? { name: "sfdmu", version: "5.4.1" } : p,
    );
  }
  return DOCS_PLUGINS;
}

const DOCS_ORGS = {
  nonScratchOrgs: [
    {
      username: "deploy.user@mycompany.com",
      alias: "PRODUCTION",
      orgId: "00D3X0000008aBcUAI",
      instanceUrl: "https://mycompany.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://login.salesforce.com",
      connectedStatus: "Connected",
      isDefaultUsername: false,
      isSandbox: false,
      isScratch: false,
      isDevHub: true,
      isDefaultDevHubUsername: true,
    },
    {
      username: "deploy.user@mycompany.com.preprod",
      alias: "PREPROD",
      orgId: "00D5f0000012XyZEAU",
      instanceUrl: "https://mycompany--preprod.sandbox.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://test.salesforce.com",
      connectedStatus: "Connected",
      isDefaultUsername: false,
      isSandbox: true,
      isScratch: false,
    },
    {
      username: "deploy.user@mycompany.com.uat",
      alias: "UAT",
      orgId: "00D5f0000012XyaEAE",
      instanceUrl: "https://mycompany--uat.sandbox.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://test.salesforce.com",
      connectedStatus: "Connected",
      isDefaultUsername: false,
      isSandbox: true,
      isScratch: false,
    },
    {
      username: "deploy.user@mycompany.com.integ",
      alias: "INTEGRATION",
      orgId: "00D5f0000012XybEAE",
      instanceUrl: "https://mycompany--integ.sandbox.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://test.salesforce.com",
      connectedStatus: "Connected",
      isDefaultUsername: true,
      isSandbox: true,
      isScratch: false,
    },
    {
      username: "alex.martin@mycompany.com.dev",
      alias: "DEV-Alex",
      orgId: "00D5f0000012XycEAE",
      instanceUrl: "https://mycompany--dev.sandbox.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://test.salesforce.com",
      connectedStatus: "Connected",
      isDefaultUsername: false,
      isSandbox: true,
      isScratch: false,
    },
    {
      username: "sam.dubois@mycompany.com.dev2",
      alias: "DEV-Sam",
      orgId: "00D5f0000012XydEAE",
      instanceUrl: "https://mycompany--dev2.sandbox.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://test.salesforce.com",
      connectedStatus:
        "Unable to refresh session due to: expired access/refresh token",
      isDefaultUsername: false,
      isSandbox: true,
      isScratch: false,
    },
    {
      username: "deploy.user@mycompany.com.qa",
      orgId: "00D5f0000012XyfEAE",
      instanceUrl: "https://mycompany--qa.sandbox.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://test.salesforce.com",
      connectedStatus: "Connected",
      isDefaultUsername: false,
      isSandbox: true,
      isScratch: false,
    },
    {
      username: "integration.bot@mycompany.com",
      alias: "TECHNICAL_ORG",
      orgId: "00D5f0000012XygEAE",
      instanceUrl: "https://mycompany-tech.develop.my.salesforce.com",
      instanceApiVersion: "67.0",
      loginUrl: "https://login.salesforce.com",
      connectedStatus: "Connected",
      isDefaultUsername: false,
      isSandbox: false,
      isScratch: false,
    },
  ],
  scratchOrgs: [
    {
      username: "test-9k2mfhqz1x8s@example.com",
      alias: "scratch-CRM-1042",
      orgId: "00D5f0000012XyeEAE",
      instanceUrl: "https://flow-power-3821-dev-ed.scratch.my.salesforce.com",
      instanceApiVersion: "67.0",
      connectedStatus: "Connected",
      isScratch: true,
      isSandbox: false,
      status: "Active",
      createdDate: "2026-08-04T09:12:00.000Z",
      expirationDate: "2026-08-25",
      devHubUsername: "deploy.user@mycompany.com",
    },
  ],
};

// A few metadata items per type, for the Metadata Retriever panel
const DOCS_METADATA = {
  ApexClass: [
    "AccountTriggerHandler",
    "AccountTriggerHandlerTest",
    "OpportunityService",
    "OpportunityServiceTest",
    "QuoteApprovalController",
    "InvoiceBatchScheduler",
    "CaseAssignmentSelector",
    "InvoiceService",
    "InvoiceServiceTest",
    "TimesheetReminderBatch",
    "CustomerPortalController",
  ],
  Flow: [
    "Account_Hierarchy_Sync",
    "Opportunity_Stage_Notification",
    "Quote_Approval_Process",
    "Case_Auto_Escalation",
    "Lead_Conversion_Assistant",
  ],
  CustomObject: [
    "Project__c",
    "Milestone__c",
    "Invoice__c",
    "Account",
    "Opportunity",
    "Contact",
  ],
  PermissionSet: [
    "CRM_Manager",
    "CRM_Sales_User",
    "Billing_Administrator",
    "Service_Agent",
  ],
  Profile: ["System Administrator", "Sales User", "Service User"],
  LightningComponentBundle: [
    "accountHierarchyTree",
    "quoteApprovalCard",
    "invoiceSummary",
  ],
  CustomLabel: ["Quote_Approval_Required", "Invoice_Sent_Message"],
  Layout: ["Account-Account Layout", "Opportunity-Sales Layout"],
};

// Recent changes of the org, as returned by the SourceMember tooling query
// used by the "Recent Changes" mode of the Metadata Retriever
const DOCS_SOURCE_MEMBERS = [
  ["ActionableListDefinition", "General_Contact_List", "Automated Process", "modified"],
  ["ActionableListDefinition", "General_Lead_List", "Automated Process", "modified"],
  ["Bot", "Customer_Support_Agent", "Alex Martin", "modified"],
  ["BotVersion", "Customer_Support_Agent.v3", "Alex Martin", "modified"],
  [
    "GenAiPlannerBundle",
    "Customer_Support_Agent_v3",
    "Alex Martin",
    "modified",
  ],
  ["Profile", "Admin", "Nicolas Vuillamy", "modified"],
  ["ApexClass", "OpportunityService", "Alex Martin", "modified"],
  ["ApexClass", "QuoteApprovalController", "Alex Martin", "created"],
  ["ApexClass", "InvoiceBatchScheduler", "Sam Dubois", "modified"],
  ["Flow", "Quote_Approval_Process", "Sam Dubois", "created"],
  ["Flow", "Account_Hierarchy_Sync", "Alex Martin", "modified"],
  ["CustomField", "Opportunity.Approval_Status__c", "Sam Dubois", "created"],
  ["CustomField", "Account.Segment__c", "Nicolas Vuillamy", "modified"],
  ["PermissionSet", "CRM_Manager", "Nicolas Vuillamy", "modified"],
  ["Layout", "Opportunity-Sales Layout", "Alex Martin", "modified"],
  ["LightningComponentBundle", "quoteApprovalCard", "Sam Dubois", "created"],
  ["CustomLabel", "Quote_Approval_Required", "Alex Martin", "created"],
  ["ValidationRule", "Opportunity.Amount_Required", "Sam Dubois", "modified"],
];

function docsSourceMemberRecords() {
  // The extension queries "... ORDER BY MemberType, MemberName": honor it so
  // the Metadata Retriever results are ordered by type like with a real org
  const sorted = [...DOCS_SOURCE_MEMBERS].sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  return sorted.map(([type, name, author, operation], index) => ({
    attributes: { type: "SourceMember" },
    MemberType: type,
    MemberName: name,
    LastModifiedDate: `2026-08-1${(index % 8) + 1}T0${(index % 9) + 1}:2${index % 9}:00.000+0000`,
    LastModifiedBy: { Name: author },
    IsNewMember: operation === "created",
    IsDeleted: false,
    IsNameObsolete: false,
  }));
}

function docsMetadataFor(type) {
  const names = DOCS_METADATA[type];
  if (!names) {
    return [];
  }
  return names.map((fullName, index) => ({
    createdByName: index % 2 === 0 ? "Alex Martin" : "Sam Dubois",
    createdDate: "2026-05-1" + (index % 9) + "T10:2" + (index % 9) + ":00.000Z",
    fileName: type + "s/" + fullName,
    fullName: fullName,
    id: "0Ab5f00000" + String(index).padStart(6, "0"),
    lastModifiedByName: index % 3 === 0 ? "Nicolas Vuillamy" : "Alex Martin",
    lastModifiedDate:
      "2026-08-0" + (index % 9) + "T14:1" + (index % 9) + ":00.000Z",
    manageableState: "unmanaged",
    type: type,
  }));
}

function logInvocation(extra) {
  const logFile = process.env.SF_MOCK_LOG;
  if (!logFile) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(
      logFile,
      JSON.stringify({
        time: Date.now(),
        args,
        contextId: process.env.SFDX_HARDIS_COMMAND_CONTEXT_ID || null,
        ...extra,
      }) + "\n",
    );
  } catch {
    // Logging must never break the mock
  }
}

function outputJsonIfRequested(jsonValue, plainText) {
  if (args.includes("--json")) {
    console.log(JSON.stringify(jsonValue));
  } else {
    console.log(plainText);
  }
}

async function main() {
  logInvocation({});
  const bootDelay = parseInt(process.env.SF_MOCK_BOOT_DELAY_MS || "0", 10);
  if (bootDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, bootDelay));
  }

  const first = args[0] || "";

  if (first === "--version" || first === "version") {
    console.log(
      DOCS_PROFILE
        ? `@salesforce/cli/${DOCS_VERSIONS["@salesforce/cli"]} win32-x64 node-v${DOCS_VERSIONS.node}`
        : "@salesforce/cli/2.100.0 win32-x64 node-v20.0.0",
    );
    return 0;
  }

  if (first === "plugins") {
    if (DOCS_PROFILE) {
      const plugins = docsPlugins();
      outputJsonIfRequested(
        plugins.map((plugin) => ({ ...plugin, type: "user", tag: "latest" })),
        plugins.map((plugin) => `${plugin.name} ${plugin.version}`).join("\n"),
      );
      return 0;
    }
    outputJsonIfRequested(
      [{ name: "sfdx-hardis", version: "6.0.0", type: "user" }],
      "sfdx-hardis 6.0.0",
    );
    return 0;
  }

  if (first === "org" && args[1] === "list" && args[2] === "metadata") {
    const typeIndex = args.indexOf("--metadata-type");
    const type = typeIndex > -1 ? args[typeIndex + 1] : "";
    outputJsonIfRequested(
      { status: 0, result: DOCS_PROFILE ? docsMetadataFor(type) : [] },
      "",
    );
    return 0;
  }

  if (first === "org" && args[1] === "list") {
    outputJsonIfRequested(
      { status: 0, result: DOCS_PROFILE ? DOCS_ORGS : {} },
      "",
    );
    return 0;
  }

  if (first === "org" && args[1] === "display") {
    outputJsonIfRequested(
      DOCS_PROFILE
        ? {
            status: 0,
            result: {
              id: "00D5f0000012XybEAE",
              username: "deploy.user@mycompany.com.integ",
              instanceUrl: "https://mycompany--integ.sandbox.my.salesforce.com",
              apiVersion: "67.0",
              connectedStatus: "Connected",
              alias: "INTEGRATION",
            },
          }
        : {
            status: 0,
            result: {
              id: "00D000000000001EAA",
              username: "test-user@example.com",
              instanceUrl: "https://dummy-instance.my.salesforce.com",
              apiVersion: "62.0",
              connectedStatus: "Connected",
              alias: "dummy-org",
            },
          },
      DOCS_PROFILE
        ? "deploy.user@mycompany.com.integ (Connected)"
        : "test-user@example.com (Connected)",
    );
    return 0;
  }

  if (first === "data" && args[1] === "query") {
    const query = args[args.indexOf("--query") + 1] || "";
    const records =
      DOCS_PROFILE && query.includes("FROM SourceMember")
        ? docsSourceMemberRecords()
        : [];
    outputJsonIfRequested(
      {
        status: 0,
        result: { totalSize: records.length, done: true, records },
      },
      "",
    );
    return 0;
  }

  if (first === "package" && args[1] === "installed") {
    outputJsonIfRequested(
      {
        status: 0,
        result: DOCS_PROFILE
          ? [
              {
                Id: "0A35f000000TN2ACAW",
                SubscriberPackageName: "Conga Composer",
                SubscriberPackageNamespace: "APXTConga4",
                SubscriberPackageVersionNumber: "8.187.0.1",
                SubscriberPackageVersionName: "Conga Composer 8 Winter 26",
              },
              {
                Id: "0A35f000000TN2BCAW",
                SubscriberPackageName: "DocuSign eSignature",
                SubscriberPackageNamespace: "dsfs",
                SubscriberPackageVersionNumber: "7.6.0.1",
                SubscriberPackageVersionName: "DocuSign for Salesforce",
              },
              {
                Id: "0A35f000000TN2CCAW",
                SubscriberPackageName: "MyCompany Core",
                SubscriberPackageNamespace: "mcc",
                SubscriberPackageVersionNumber: "2.14.0.3",
                SubscriberPackageVersionName: "MyCompany Core 2.14",
              },
            ]
          : [],
      },
      "",
    );
    return 0;
  }

  if (first === "config" && args[1] === "get") {
    const configName = args[2] || "";
    outputJsonIfRequested(
      {
        status: 0,
        result: [
          {
            name: configName,
            value:
              DOCS_PROFILE && configName === "target-org"
                ? "deploy.user@mycompany.com.integ"
                : null,
          },
        ],
      },
      "",
    );
    return 0;
  }

  // Monitoring catalog: answered from a snapshot of the real
  // `sf hardis:config:monitoring-defaults --json` payload, so the Org
  // Monitoring and Monitoring Configuration panels show their full catalog
  if (first === "hardis:config:monitoring-defaults" && DOCS_PROFILE) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(__dirname, "monitoring-defaults.json"), "utf8"),
    );
    outputJsonIfRequested({ status: 0, result: catalog }, "");
    return 0;
  }

  if (first.startsWith("hardis")) {
    return await runHardisCommand(first);
  }

  // Any other sf command: succeed silently
  outputJsonIfRequested({ status: 0, result: {} }, "OK");
  return 0;
}

async function runHardisCommand(commandId) {
  // Commands containing "slow-boot" simulate a real CLI whose boot takes a
  // while: the window during which the user can close the pending panel
  if (commandId.includes("slow-boot")) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  // Same marker as the real sfdx-hardis WebSocketClient constructor
  console.log("WS Client started");

  const websocketArgIndex = args.indexOf("--websocket");
  const websocketHostPort =
    websocketArgIndex > -1 ? args[websocketArgIndex + 1] : null;
  if (!websocketHostPort) {
    console.log(`Executed mock command ${commandId} (no websocket)`);
    return 0;
  }

  let WebSocket;
  try {
    WebSocket = require(
      path.join(process.env.SF_MOCK_NODE_MODULES || "", "ws"),
    );
  } catch (e) {
    console.error("sf-mock: unable to load ws package: " + e.message);
    return 1;
  }

  const contextId =
    process.env.SFDX_HARDIS_COMMAND_CONTEXT_ID || String(process.pid);
  const context = { command: commandId, id: contextId };

  return await new Promise((resolve) => {
    const ws = new WebSocket(`ws://${websocketHostPort}`);
    const safetyTimeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {}
      resolve(0);
    }, 20000);

    const send = (data) => ws.send(JSON.stringify({ ...data, context }));

    // Like the real sfdx-hardis: exit when the extension cancels the command
    // (the user closed the command execution tab)
    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.event === "cancelCommand") {
          logInvocation({ event: "cancelled" });
          process.exit(1);
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    // Showcase scenario: prompts are answered by the extension side, resolve
    // the pending waiter when the response arrives
    const promptWaiters = [];
    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.event === "promptsResponse" && promptWaiters.length > 0) {
          const waiter = promptWaiters.shift();
          waiter(data.promptsResponse);
        }
      } catch {
        // Ignore unparseable messages
      }
    });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const askPrompt = (prompt) => {
      const responsePromise = new Promise((r) => promptWaiters.push(r));
      send({ event: "prompts", prompts: [prompt] });
      // Marker so tests can wait for the prompt before answering it
      logInvocation({ event: "promptAsked", promptName: prompt.name });
      return responsePromise;
    };
    const finish = () => {
      send({ event: "closeClient", status: "success" });
      setTimeout(() => {
        clearTimeout(safetyTimeout);
        try {
          ws.close();
        } catch {}
        logInvocation({ event: "wsClosed" });
        resolve(0);
      }, 300);
    };

    ws.on("open", async () => {
      logInvocation({ event: "wsOpen" });
      send({ event: "initClient" });
      if (commandId.includes("showcase")) {
        // Rich scenario exercising the whole command panel protocol:
        // sections, sub-commands, warning, table, question, progress,
        // multiselect and report files
        clearTimeout(safetyTimeout);
        await runShowcaseScenario(send, askPrompt, sleep);
        finish();
        return;
      }
      // Documentation recordings of the three CI/CD workflow commands
      const docScenario = DOCS_SCENARIOS[commandId];
      if (DOCS_PROFILE && docScenario) {
        clearTimeout(safetyTimeout);
        await docScenario(send, askPrompt, sleep);
        finish();
        return;
      }
      send({
        event: "commandLogLine",
        logType: "log",
        message: `Mock execution of ${commandId}`,
      });
      if (commandId.includes("long-run")) {
        // Long-running command: stays connected until cancelled by the
        // extension or until the safety timeout fires
        return;
      }
      send({
        event: "commandLogLine",
        logType: "success",
        message: "Mock command completed",
      });
      // Leave a little time for the extension to process, then close
      setTimeout(finish, 500);
    });

    ws.on("error", (err) => {
      clearTimeout(safetyTimeout);
      console.error("sf-mock: websocket error: " + err.message);
      resolve(0);
    });
  });
}

/**
 * Streams a realistic sfdx-hardis command over the WebSocket protocol.
 * Used by the command panel UI tests and for visual QA of the panel.
 */
async function runShowcaseScenario(send, askPrompt, sleep) {
  const log = (logType, message, extra) =>
    send({ event: "commandLogLine", logType, message, ...(extra || {}) });

  log(
    "action",
    "This command will save information that must be restored after org refresh, in the following order:\n- Certificates\n- Custom Settings\n- Records\n- Connected Apps",
  );
  await sleep(80);
  log("log", "Detected 4 item types to save before the refresh.");
  log(
    "action",
    "Checking which Connected Apps can be converted to External Client Apps...",
  );
  send({
    event: "commandSubCommandStart",
    data: {
      command: 'sf project generate --name "sfdx-hardis-blank-project"',
      cwd: ".",
    },
  });
  await sleep(350);
  send({
    event: "commandSubCommandEnd",
    data: {
      command: 'sf project generate --name "sfdx-hardis-blank-project"',
      success: true,
    },
  });
  log(
    "warning",
    "3 Connected App(s) have no matching External Client App. Since Spring '26, Connected Apps can not be re-created after a sandbox refresh, so they will probably be LOST after the refresh:",
  );
  log(
    "table",
    JSON.stringify([
      {
        name: "Amalto",
        lastUpdatedDate: "2019-03-28 16:57",
        lastUpdatedBy: "Salesforce Scheduled Jobs",
      },
      {
        name: "Azure_Data_Factory",
        lastUpdatedDate: "2025-10-13 11:13",
        lastUpdatedBy: "Nicolas Vuillamy",
      },
      {
        name: "CustomerInfoAPI",
        lastUpdatedDate: "2023-04-12 10:12",
        lastUpdatedBy: "User Integration",
      },
    ]),
  );
  await sleep(120);

  // Question 1: simple yes/no select
  log("action", "Do you want to set the selected org as your default org?", {
    isQuestion: true,
  });
  await askPrompt({
    name: "setDefault",
    type: "select",
    message: "Do you want to set the selected org as your default org?",
    choices: [
      {
        title: "✅ Yes",
        value: "yes",
        description: "Use this org as the default org of the project",
      },
      {
        title: "❌ No",
        value: "no",
        description: "Keep the current default org",
      },
    ],
  });
  log("log", "✅ Yes");
  await sleep(100);

  // Progress with known number of steps
  send({
    event: "progressStart",
    title: "Describing 149 objects...",
    totalSteps: 149,
  });
  for (let step = 1; step <= 149; step += 8) {
    send({ event: "progressStep", step, totalSteps: 149 });
    await sleep(35);
  }
  send({ event: "progressEnd", totalSteps: 149 });
  log(
    "log",
    "Described 149 objects (115 excluded without local customizations).",
  );
  await sleep(100);

  // Question 2: multiselect with many options
  log("action", "Select the Custom Settings to retrieve", { isQuestion: true });
  const customSettingsResponse = await askPrompt({
    name: "customSettings",
    type: "multiselect",
    message: "Select the Custom Settings to retrieve",
    choices: [
      { title: "APITalenDev__c", value: "APITalenDev__c" },
      { title: "APITalenProd__c", value: "APITalenProd__c" },
      {
        title: "Conga_Composer_Settings__c",
        value: "Conga_Composer_Settings__c",
        description: "APXTCFQ namespace",
      },
      { title: "AmaltoToAdresses__c", value: "AmaltoToAdresses__c" },
      {
        title: "Chargent_Settings__c",
        value: "Chargent_Settings__c",
        description: "ChargentBase namespace",
      },
      { title: "CybersourceSettings__c", value: "CybersourceSettings__c" },
      {
        title: "DefaultOrderItemValues__c",
        value: "DefaultOrderItemValues__c",
      },
      { title: "Languages__c", value: "Languages__c" },
    ],
  });
  // Echo the answer like the real CLI does
  const selection =
    (customSettingsResponse &&
      customSettingsResponse[0] &&
      customSettingsResponse[0].customSettings) ||
    [];
  log(
    "log",
    "☑ " +
      (Array.isArray(selection) ? selection.join(", ") : String(selection)),
  );
  await sleep(100);

  // Question 3: select with many options (rendered as a filterable list)
  log(
    "action",
    "Please select the number of days in the past from today you want to detect suspicious setup activities",
    { isQuestion: true },
  );
  const daysResponse = await askPrompt({
    name: "auditDays",
    type: "select",
    message:
      "Please select the number of days in the past from today you want to detect suspicious setup activities",
    choices: [1, 2, 3, 4, 5, 6, 7, 14, 30, 60, 90, 180].map((days) => ({
      title: String(days),
      value: days,
    })),
  });
  const daysSelected =
    (daysResponse && daysResponse[0] && daysResponse[0].auditDays) || 30;
  log("log", String(daysSelected));
  await sleep(100);

  // Report files + final status
  send({
    event: "reportFile",
    file: "reports/data-dictionary.xlsx",
    title: "Data dictionary (XLSX)",
    type: "report",
  });
  send({
    event: "reportFile",
    file: "reports/data-dictionary.csv",
    title: "Data dictionary (CSV)",
    type: "report",
  });
  send({
    event: "reportFile",
    file: "https://sfdx-hardis.cloudity.com/hardis/org/refresh/before-refresh/",
    title: "Command documentation",
    type: "docUrl",
  });
  log("success", "Data dictionary generated for 34 objects.");
  await sleep(200);
}

/**
 * Scenarios of the CI/CD workflow commands hardis:work:new and
 * hardis:work:save, used by the documentation recordings
 * (docs/assets/images/new-user-story-2026.gif and save-publish-pr-2026.gif).
 * They replay, anonymized, the log lines, questions and report files of real
 * runs of these commands (see hardis-report/commands/*.log of any sfdx-hardis
 * CI/CD project).
 */
const DOCS_REPO_URL = "https://github.com/mycompany/salesforce-crm";
const DOCS_STORY_BRANCH = "feature/CRM-123-Sync-accounts-with-SAP";

const DOCS_SCENARIOS = {
  "hardis:work:new": async (send, askPrompt, sleep) => {
    const log = (logType, message, extra) =>
      send({ event: "commandLogLine", logType, message, ...(extra || {}) });

    log(
      "action",
      "Creating a new User Story (dev or config) with SFDX Hardis CI/CD",
    );
    log("log", "When unsure, press ENTER to use the default value");
    send({
      event: "commandSubCommandStart",
      data: { command: "git stash", cwd: "." },
    });
    await sleep(400);
    send({
      event: "commandSubCommandEnd",
      data: { command: "git stash", success: true },
    });

    log(
      "action",
      "What will be the target branch of your new User Story ? (the branch where you will make your Pull Request after the User Story is completed)",
      { isQuestion: true },
    );
    await askPrompt({
      name: "targetBranch",
      type: "select",
      message:
        "What will be the target branch of your new User Story ? (the branch where you will make your Pull Request after the User Story is completed)",
      choices: [
        {
          title: "integration",
          value: "integration",
          description: "Integration sandbox",
        },
        { title: "uat", value: "uat", description: "User Acceptance Testing" },
        { title: "preprod", value: "preprod", description: "Pre-production" },
      ],
    });
    log("log", "integration");
    await sleep(150);

    log("action", "What type of User Story do you want to create?", {
      isQuestion: true,
    });
    await askPrompt({
      name: "storyType",
      type: "select",
      message: "What type of User Story do you want to create?",
      description:
        "Select the category of work that best describes your User Story",
      choices: [
        {
          title: "\u{1F3D7}️ Feature",
          value: "feature",
          description: "New feature, enhancement or configuration change",
        },
        {
          title: "\u{1F6E0}️ Fix",
          value: "fix",
          description: "Fix a defect found in an org",
        },
      ],
    });
    log("log", "\u{1F3D7}️ Feature");
    await sleep(150);

    log(
      "action",
      "What is the name of your new User Story? Please avoid accents and special characters.",
      { isQuestion: true },
    );
    await askPrompt({
      name: "storyName",
      type: "text",
      message:
        "What is the name of your new User Story? Please avoid accents and special characters. (ex: CRM-1042 Account hierarchy)",
    });
    log("log", "CRM-123 Sync accounts with SAP");
    await sleep(150);

    log(
      "action",
      `Checking out latest version of branch integration from ${DOCS_REPO_URL}.git...`,
    );
    log("action", `Creating new branch ${DOCS_STORY_BRANCH}...`);
    send({
      event: "commandSubCommandStart",
      data: {
        command: `git checkout -b ${DOCS_STORY_BRANCH} --no-track origin/integration`,
        cwd: ".",
      },
    });
    await sleep(900);
    send({
      event: "commandSubCommandEnd",
      data: {
        command: `git checkout -b ${DOCS_STORY_BRANCH} --no-track origin/integration`,
        success: true,
      },
    });
    log("success", `Created and checked out git branch ${DOCS_STORY_BRANCH}`);
    await sleep(200);

    log("action", "Which Salesforce org do you want to work in?", {
      isQuestion: true,
    });
    await askPrompt({
      name: "orgType",
      type: "select",
      message: "Which Salesforce org do you want to work in?",
      description:
        "Choose the type of Salesforce org to use for your development work",
      choices: [
        {
          title: "\u{1F30E} Sandbox org with source tracking",
          value: "sandbox",
          description:
            "Work in a developer sandbox provided by your Release Manager",
        },
        {
          title: "\u{1FA90} Scratch org",
          value: "scratch",
          description:
            "Scratch orgs are configured on my project so I want to create or reuse one",
        },
        {
          title: "\u{1F920} I'm hardcore, I don't need an org !",
          value: "noOrg",
          description: "Work with XML and sfdx-hardis configuration only",
        },
      ],
    });
    log("log", "\u{1F30E} Sandbox org with source tracking");
    await sleep(150);

    log(
      "action",
      `Select a sandbox org to work in branch ${DOCS_STORY_BRANCH}`,
      { isQuestion: true },
    );
    await askPrompt({
      name: "sandboxOrg",
      type: "select",
      message: `Select a sandbox org to work in branch ${DOCS_STORY_BRANCH}`,
      choices: [
        {
          title: "https://mycompany--dev.sandbox.my.salesforce.com",
          value: "dev",
          description: "alex.martin@mycompany.com.dev",
        },
        {
          title: "https://mycompany--dev2.sandbox.my.salesforce.com",
          value: "dev2",
          description: "sam.dubois@mycompany.com.dev2",
        },
        {
          title: "\u{1F517} Connect to another org",
          value: "other",
          description: "Authenticate to an org that is not in the list yet",
        },
      ],
    });
    log("log", "https://mycompany--dev.sandbox.my.salesforce.com");
    await sleep(150);

    log(
      "action",
      "Setting https://mycompany--dev.sandbox.my.salesforce.com (alex.martin@mycompany.com.dev) as default org...",
    );
    send({
      event: "commandSubCommandStart",
      data: {
        command: "sf config set target-org=alex.martin@mycompany.com.dev",
        cwd: ".",
      },
    });
    await sleep(1000);
    send({
      event: "commandSubCommandEnd",
      data: {
        command: "sf config set target-org=alex.martin@mycompany.com.dev",
        success: true,
      },
    });

    log(
      "action",
      "Do you want to open org alex.martin@mycompany.com.dev in your browser?",
      { isQuestion: true },
    );
    await askPrompt({
      name: "openOrg",
      type: "select",
      message:
        "Do you want to open org alex.martin@mycompany.com.dev in your browser?",
      choices: [
        { title: "✅ Yes", value: "yes" },
        { title: "❌ No", value: "no" },
      ],
    });
    log("log", "❌ No");
    await sleep(200);

    log("action", `Ready to work in branch ${DOCS_STORY_BRANCH}`);
    log(
      "log",
      "Use your default org with username alex.martin@mycompany.com.dev",
    );
    log(
      "log",
      "Your current org URL is https://mycompany--dev.sandbox.my.salesforce.com",
    );
    await sleep(600);
  },

  "hardis:work:save": async (send, askPrompt, sleep) => {
    const log = (logType, message, extra) =>
      send({ event: "commandLogLine", logType, message, ...(extra || {}) });

    send({
      event: "commandSubCommandStart",
      data: { command: "git status --porcelain -b -u --null", cwd: "." },
    });
    await sleep(400);
    send({
      event: "commandSubCommandEnd",
      data: { command: "git status --porcelain -b -u --null", success: true },
    });
    log(
      "action",
      `Preparing Pull Request from branch ${DOCS_STORY_BRANCH} to integration`,
    );
    await sleep(150);

    log(
      "action",
      "Have you already committed the updated metadata you want to deploy?",
      { isQuestion: true },
    );
    await askPrompt({
      name: "commitReady",
      type: "select",
      message:
        "Have you already committed the updated metadata you want to deploy?",
      description:
        "Select your current state regarding git commits and metadata updates",
      choices: [
        {
          title:
            "\u{1F60E} Yes, my commit(s) are ready! I staged my files and created one or multiple commits.",
          value: "commitReady",
          description:
            "You have already pulled updates from your org (or locally updated the files), staged your files, and created a commit",
        },
        {
          title:
            "\u{1F610} No, please pull my latest updates from my org so I can commit my metadata",
          value: "pleasePull",
          description:
            "Pull latest updates from org so you can stage files and create your commit",
        },
        {
          title: "\u{1F631} What is a commit? What does pull mean? Help!",
          value: "help",
          description:
            "Don't panic, just click on the link that will appear in the console (CTRL + Click) and you'll learn!",
        },
      ],
    });
    log(
      "log",
      "\u{1F60E} Yes, my commit(s) are ready! I staged my files and created one or multiple commits.",
    );
    await sleep(200);

    log(
      "action",
      "Updating manifest/package.xml and manifest/destructiveChanges.xml using sfdx-git-delta...",
    );
    send({
      event: "commandSubCommandStart",
      data: {
        command: `sf sgd:source:delta --from integration --to ${DOCS_STORY_BRANCH} --ignore-whitespace --source-dir force-app --json`,
        cwd: ".",
      },
    });
    await sleep(1200);
    send({
      event: "commandSubCommandEnd",
      data: {
        command: `sf sgd:source:delta --from integration --to ${DOCS_STORY_BRANCH} --ignore-whitespace --source-dir force-app --json`,
        success: true,
      },
    });
    log(
      "log",
      `Calculating package.xml diff from [integration] to [${DOCS_STORY_BRANCH} - commit]`,
    );
    log(
      "log",
      [
        "Delta package.xml diff to be merged within manifest/package.xml:",
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
        "    <types>",
        "        <members>AccountSyncService</members>",
        "        <name>ApexClass</name>",
        "    </types>",
        "    <types>",
        "        <members>Account.SAP_Reference__c</members>",
        "        <name>CustomField</name>",
        "    </types>",
        "    <types>",
        "        <members>Account_Sync_With_SAP</members>",
        "        <name>Flow</name>",
        "    </types>",
        "    <version>67.0</version>",
        "</Package>",
      ].join("\n"),
    );
    send({
      event: "reportFile",
      file: "manifest/package.xml",
      title: "Git Delta package.xml (3)",
      type: "report",
    });
    await sleep(250);

    log(
      "action",
      "Apply cleaning of references to destructivechanges (DestructiveChanges.xml: Remove source files mentioned in destructiveChanges.xml)...",
    );
    await sleep(400);
    log(
      "action",
      "Run cleaning command flowPositions (Flows: Replace all positions in AutoLayout Flows by 0 to simplify conflicts management) ...",
    );
    send({
      event: "commandSubCommandStart",
      data: { command: "sf hardis:project:clean:flowpositions", cwd: "." },
    });
    await sleep(700);
    send({
      event: "commandSubCommandEnd",
      data: {
        command: "sf hardis:project:clean:flowpositions",
        success: true,
      },
    });
    log("log", "Setting flows as Auto Layout and remove positions...");
    log("log", "Updated 1 flow to remove positions");
    await sleep(250);

    log(
      "action",
      `Do you want to push your commit(s) to the git server? (git push to remote git branch ${DOCS_STORY_BRANCH})`,
      { isQuestion: true },
    );
    await askPrompt({
      name: "pushCommits",
      type: "select",
      message: `Do you want to push your commit(s) to the git server? (git push to remote git branch ${DOCS_STORY_BRANCH})`,
      choices: [
        { title: "✅ Yes", value: "yes" },
        { title: "❌ No", value: "no" },
      ],
    });
    log("log", "✅ Yes");
    await sleep(200);

    log(
      "action",
      `Pushing commit(s) to remote branch origin/${DOCS_STORY_BRANCH}...`,
    );
    send({
      event: "commandSubCommandStart",
      data: {
        command: `git push --set-upstream origin ${DOCS_STORY_BRANCH}`,
        cwd: ".",
      },
    });
    await sleep(1000);
    send({
      event: "commandSubCommandEnd",
      data: {
        command: `git push --set-upstream origin ${DOCS_STORY_BRANCH}`,
        success: true,
      },
    });

    log(
      "action",
      `If your work is completed, create a Pull Request, otherwise push new commits to the ${DOCS_STORY_BRANCH} branch.`,
    );
    log(
      "log",
      `- Repository: ${DOCS_REPO_URL}\n- Source branch: ${DOCS_STORY_BRANCH}\n- Target branch: integration`,
    );
    log(
      "log",
      "When your Pull Request has been merged:\n- DO NOT REUSE THE SAME BRANCH\n- Use New User Story menu (sf hardis:work:new), even if you work in the same sandbox or scratch org \u{1F60A}",
    );
    log(
      "warning",
      "If you have pre-deployment or post-deployment manual actions, record them in https://mycompany.sharepoint.com/sites/crm/ManualActions.xlsx",
    );
    send({
      event: "reportFile",
      file: `${DOCS_REPO_URL}/compare/integration...${encodeURIComponent(DOCS_STORY_BRANCH)}?expand=1`,
      title: "Create Pull Request",
      type: "actionUrl",
    });
    send({
      event: "reportFile",
      file: "https://mycompany.sharepoint.com/sites/crm/ManualActions.xlsx",
      title: "Update Manual Actions file",
      type: "actionUrl",
    });
    send({
      event: "reportFile",
      file: "vscode-sfdx-hardis.showPipeline",
      title: "Update the Deployment Actions of your Pull Request",
      type: "actionCommand",
      commandArgs: [
        {
          focus: "deploymentActions",
          sourceBranch: DOCS_STORY_BRANCH,
          targetBranch: "integration",
        },
      ],
    });
    send({
      event: "reportFile",
      file: "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/#create-merge-request",
      title: "View Pull Request documentation",
      type: "docUrl",
    });
    await sleep(600);
  },
};

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("sf-mock failed: " + (err && err.message));
    process.exit(1);
  },
);
