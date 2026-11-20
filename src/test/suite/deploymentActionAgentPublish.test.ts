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
 * An "agent-publish" deployment action publishes the authoring bundle of an Agentforce agent in
 * the target org after the deployment, and activates the version this creates. The CLI does the
 * work: the editor only writes the agent name.
 */

const AGENT_PUBLISH_I18N_KEYS = [
  "agentPublishType",
  "agentNameHelp",
  "agentNameLabel",
];

suite("Deployment action agent publication", () => {
  test("agent-publish is a built-in action type", () => {
    assert.ok(BUILT_IN_ACTION_TYPES.includes("agent-publish"));
    assert.strictEqual(isBuiltInActionType("agent-publish"), true);
  });

  test("the editor offers the type after the deployment, on real deployments only", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /"agent-publish": \{[^}]*when: \["post-deploy"\],\s+context: \["process-deployment-only"\],/,
    );
    assert.match(js, /value: "agent-publish"/);
  });

  test("a new action asks for the agent name only, and runs once by org by default", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /if \(type === "agent-publish"\) \{\s+return \{ agentName: "" \};/,
    );
    assert.match(
      js,
      /newType === "agent-publish"\) \{\s+this\.editedAction\.runOnlyOnceByOrg = true;/,
    );
    assert.match(js, /currentType === "agent-publish" \|\|/);
  });

  test("the type has a label, an icon, a pill color and its own context", () => {
    const utils = readModuleFile(
      "deploymentActionUtils",
      "deploymentActionUtils.js",
    );
    assert.strictEqual(utils.split('"agent-publish":').length - 1, 3);
    assert.match(
      utils,
      /action\?\.type === "agent-publish" \|\| action\?\.type === "agent-activate"\) \{\s+return "process-deployment-only";/,
    );
  });

  test("every label of the editor exists in every locale", () => {
    assertDeploymentActionLabelsTranslated(AGENT_PUBLISH_I18N_KEYS);
  });
});
