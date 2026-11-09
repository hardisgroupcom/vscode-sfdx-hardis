import * as assert from "assert";
import * as path from "path";
import { agentNamesFromSourcePaths } from "../../utils/prePostCommandsUtils";
import {
  assertDeploymentActionLabelsTranslated,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * The agent of an agent deployment action is picked from the agents of the project sources,
 * loaded when the editor opens: authoring bundles for a publication, bundles and bots otherwise.
 */

const AGENT_PICKER_I18N_KEYS = [
  "agentNotInSources",
  "loadingAgents",
  "noAgentFound",
  "selectAnAgent",
];

suite("Deployment action agent picker", () => {
  test("the agent API name is the folder holding the source file", () => {
    const names = agentNamesFromSourcePaths([
      path.join(
        "force-app",
        "main",
        "default",
        "aiAuthoringBundles",
        "Helpdesk",
        "Helpdesk.bundle-meta.xml",
      ),
      path.join(
        "force-app",
        "main",
        "default",
        "bots",
        "Concierge",
        "Concierge.bot-meta.xml",
      ),
      path.join("other-app", "bots", "Concierge", "Concierge.bot-meta.xml"),
    ]);
    assert.deepStrictEqual(names, ["Concierge", "Helpdesk"]);
  });

  test("the agent name is a picklist loaded when the editor opens", () => {
    const html = readModuleFile("deploymentAction", "deploymentAction.html");
    assert.match(
      html,
      /<lightning-combobox\s+label=\{i18n\.agentNameLabel\}[^>]*options=\{agentOptions\}/,
    );
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(js, /new CustomEvent\("loadagents"\)/);
    assert.match(js, /type === "agent-publish"\s+\? agents\.authoringBundles/);
  });

  test("both panels hosting the editor answer the agent list request", () => {
    for (const host of ["pipeline", "pipelineConfig"]) {
      const html = readModuleFile(host, `${host}.html`);
      assert.match(html, /onloadagents=\{handleLoadAgents\}/);
      assert.match(html, /agents=\{projectAgents\}/);
      const js = readModuleFile(host, `${host}.js`);
      assert.match(js, /type: "loadAgents"/);
      assert.match(js, /"returnAgents"/);
    }
  });

  test("every label of the picker exists in every locale", () => {
    assertDeploymentActionLabelsTranslated(AGENT_PICKER_I18N_KEYS);
  });
});
