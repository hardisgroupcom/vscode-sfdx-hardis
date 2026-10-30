import * as assert from "assert";
import {
  BUILT_IN_ACTION_TYPES,
  isBuiltInActionType,
} from "../../utils/prePostCommandsUtils";
import {
  assertDeploymentActionLabelsTranslated,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * An "agent-running-user" deployment action creates the running user of an Agentforce service agent
 * before the deployment, in an org that has none. The CLI does the work: the editor only writes the
 * agent name.
 */

const AGENT_RUNNING_USER_I18N_KEYS = [
  "agentRunningUserType",
  "agentNameHelp",
  "agentNameLabel",
];

suite("Deployment action agent running user", () => {
  test("agent-running-user is a built-in action type", () => {
    assert.ok(BUILT_IN_ACTION_TYPES.includes("agent-running-user"));
    assert.strictEqual(isBuiltInActionType("agent-running-user"), true);
  });

  test("the editor offers the type before the deployment, the deployment check included", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /"agent-running-user": \{[^}]*when: \["pre-deploy"\],\s+context: \["all", "check-deployment-only", "process-deployment-only"\],/,
    );
    assert.match(js, /value: "agent-running-user"/);
    assert.match(
      js,
      /if \(type === "agent-running-user"\) \{\s+return \{ agentName: "" \};/,
    );
    assert.match(
      js,
      /newType === "agent-running-user"\) \{\s+this\.editedAction\.runOnlyOnceByOrg = false;/,
    );
  });

  test("the type has a label, an icon and a pill color", () => {
    const utils = readModuleFile(
      "deploymentActionUtils",
      "deploymentActionUtils.js",
    );
    assert.strictEqual(utils.split('"agent-running-user":').length - 1, 3);
  });

  test("the agent name field is shown for the type, without the version", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /get showAgentNameField\(\) \{[^}]*type === "agent-activate" \|\| type === "agent-running-user";/,
    );
  });

  test("every label of the editor exists in every locale", () => {
    assertDeploymentActionLabelsTranslated(AGENT_RUNNING_USER_I18N_KEYS);
  });
});
