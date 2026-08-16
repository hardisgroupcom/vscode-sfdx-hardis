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

    ws.on("open", () => {
      logInvocation({ event: "wsOpen" });
      send({ event: "initClient" });
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
      setTimeout(() => {
        send({ event: "closeClient", status: "success" });
        setTimeout(() => {
          clearTimeout(safetyTimeout);
          try {
            ws.close();
          } catch {}
          logInvocation({ event: "wsClosed" });
          resolve(0);
        }, 300);
      }, 500);
    });

    ws.on("error", (err) => {
      clearTimeout(safetyTimeout);
      console.error("sf-mock: websocket error: " + err.message);
      resolve(0);
    });
  });
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("sf-mock failed: " + (err && err.message));
    process.exit(1);
  },
);
