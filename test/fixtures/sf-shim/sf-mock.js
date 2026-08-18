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
    console.log("@salesforce/cli/2.100.0 win32-x64 node-v20.0.0");
    return 0;
  }

  if (first === "plugins") {
    outputJsonIfRequested(
      [{ name: "sfdx-hardis", version: "6.0.0", type: "user" }],
      "sfdx-hardis 6.0.0",
    );
    return 0;
  }

  if (first === "org" && args[1] === "display") {
    outputJsonIfRequested(
      {
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
      "test-user@example.com (Connected)",
    );
    return 0;
  }

  if (first === "config" && args[1] === "get") {
    outputJsonIfRequested(
      { status: 0, result: [{ name: args[2] || "", value: null }] },
      "",
    );
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

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("sf-mock failed: " + (err && err.message));
    process.exit(1);
  },
);
