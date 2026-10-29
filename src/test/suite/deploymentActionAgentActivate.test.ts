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
 * An "agent-activate" deployment action activates a version of an Agentforce agent after the
 * deployment. The CLI does the work: the editor only writes the agent name and the version.
 */

const AGENT_ACTIVATE_I18N_KEYS = [
  "agentActivateType",
  "agentNameHelp",
  "agentNameLabel",
  "agentVersionHelp",
  "agentVersionLabel",
];

suite("Deployment action agent activation", () => {
  test("agent-activate is a built-in action type", () => {
    assert.ok(BUILT_IN_ACTION_TYPES.includes("agent-activate"));
    assert.strictEqual(isBuiltInActionType("agent-activate"), true);
  });

  test("the editor offers the type after the deployment, on real deployments only", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /"agent-activate": \{[^}]*when: \["post-deploy"\],\s+context: \["process-deployment-only"\],/,
    );
    assert.match(js, /value: "agent-activate"/);
  });

  test("a new action activates the latest version at every deployment by default", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /if \(type === "agent-activate"\) \{\s+return \{ agentName: "", agentVersion: "latest" \};/,
    );
    assert.match(
      js,
      /newType === "agent-activate"\) \{\s+this\.editedAction\.runOnlyOnceByOrg = false;/,
    );
  });

  test("the type has a label, an icon, a pill color and its own context", () => {
    const utils = readModuleFile(
      "deploymentActionUtils",
      "deploymentActionUtils.js",
    );
    assert.strictEqual(utils.split('"agent-activate":').length - 1, 3);
    assert.match(
      utils,
      /action\?\.type === "agent-activate"\) \{\s+return "process-deployment-only";/,
    );
  });

  test("every label of the editor exists in every locale", () => {
    assertDeploymentActionLabelsTranslated(AGENT_ACTIVATE_I18N_KEYS);
  });
});
