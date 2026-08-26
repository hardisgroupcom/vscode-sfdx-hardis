import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT, readModuleFile } from "./lwcSourceUtils";

/**
 * Contract between the WebSocket server and the commandExecution LWC for the
 * connection-time "Running" flip: a CLI process opens its WebSocket connection
 * well before it sends initClient (sfdx-hardis versions without the
 * HIDDEN_PANEL_COMMANDS fast path import the command class in between), so the
 * extension pushes a commandCliConnected message to the single pending panel
 * as soon as the connection opens, and the LWC clears its "Starting" badge.
 */
suite("Command Runner cliConnected contract", () => {
  const componentSource = readModuleFile(
    "commandExecution",
    "commandExecution.js",
  );
  const serverSource = fs.readFileSync(
    path.join(REPO_ROOT, "src", "hardis-websocket-server.ts"),
    "utf8",
  );

  test("the WebSocket server pushes commandCliConnected on connection", () => {
    assert.ok(
      serverSource.includes('type: "commandCliConnected"'),
      "hardis-websocket-server must send the commandCliConnected message",
    );
    assert.ok(
      serverSource.includes("peekSinglePendingCommandPanel()"),
      "the flip must only target an unambiguous single pending panel",
    );
  });

  test("the commandExecution LWC clears the Starting badge on commandCliConnected", () => {
    assert.ok(
      componentSource.includes('case "commandCliConnected":'),
      "commandExecution must handle the commandCliConnected message",
    );
    assert.match(
      componentSource,
      /handleCliConnected\(\)\s*\{[^}]*this\.isStarting = false/,
      "handleCliConnected must clear isStarting so the pill shows Running",
    );
  });
});
