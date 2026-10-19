import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  BUILT_IN_ACTION_TYPES,
  isBuiltInActionType,
} from "../../utils/prePostCommandsUtils";
import { listUserAccessPolicies } from "../../utils/pipeline/deploymentActionPickers";
import {
  LOCALES,
  REPO_ROOT,
  loadLocale,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * A "user-access-policy" deployment action activates User Access Policies after the deployment,
 * which leaves them in Design, and can apply them to all users. The policy list of the editor
 * comes from the default org and the project sources.
 */

const USER_ACCESS_POLICY_I18N_KEYS = [
  "activateUserAccessPoliciesHelp",
  "activateUserAccessPoliciesLabel",
  "applyUserAccessPoliciesToAllHelp",
  "applyUserAccessPoliciesToAllLabel",
  "loadingUserAccessPolicies",
  "noUserAccessPolicyFound",
  "noUserAccessPolicySelected",
  "userAccessPoliciesAvailable",
  "userAccessPoliciesHelp",
  "userAccessPoliciesLabel",
  "userAccessPoliciesSelected",
  "userAccessPoliciesTyped",
  "userAccessPoliciesTypedHelp",
  "userAccessPolicyNothingToDo",
  "userAccessPolicyType",
];

suite("Deployment action user access policies", () => {
  test("user-access-policy is a built-in action type", () => {
    assert.ok(BUILT_IN_ACTION_TYPES.includes("user-access-policy"));
    assert.strictEqual(isBuiltInActionType("user-access-policy"), true);
  });

  test("the picker answers the editor with the policies", () => {
    assert.strictEqual(typeof listUserAccessPolicies, "function");
    const source = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "src",
        "utils",
        "pipeline",
        "deploymentActionPickers.ts",
      ),
      "utf8",
    );
    assert.match(
      source,
      /loadUserAccessPolicies: \{\s+responseType: "returnUserAccessPolicies"/,
    );
    assert.match(source, /FROM UserAccessPolicy/);
  });

  test("the editor offers the type after the deployment, on real deployments only", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /"user-access-policy": \{[^}]*when: \["post-deploy"\],\s+context: \["process-deployment-only"\],/,
    );
    assert.match(js, /value: "user-access-policy"/);
    assert.match(js, /new CustomEvent\("loaduseraccesspolicies"\)/);
  });

  test("a new action activates the policies at every deployment by default", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    assert.match(
      js,
      /if \(type === "user-access-policy"\) \{\s+return \{ policies: \[\], activate: true, applyToAll: false \};/,
    );
    assert.match(
      js,
      /newType === "user-access-policy"\) \{\s+this\.editedAction\.runOnlyOnceByOrg = false;/,
    );
  });

  test("both panels hosting the editor pass it the policies", () => {
    for (const panel of ["pipeline", "pipelineConfig"]) {
      const html = readModuleFile(panel, `${panel}.html`);
      for (const attribute of [
        "user-access-policies={projectUserAccessPolicies}",
        "user-access-policies-loading={userAccessPoliciesLoading}",
        "onloaduseraccesspolicies={handleLoadUserAccessPolicies}",
      ]) {
        assert.ok(
          html.includes(attribute),
          `${panel} must pass ${attribute} to the editor`,
        );
      }
      const js = readModuleFile(panel, `${panel}.js`);
      assert.match(js, /type: "loadUserAccessPolicies"/);
      assert.match(js, /handleReturnUserAccessPolicies\(data\)/);
    }
  });

  test("the type has a label, an icon, a pill color and its own context", () => {
    const utils = readModuleFile(
      "deploymentActionUtils",
      "deploymentActionUtils.js",
    );
    assert.strictEqual(utils.split('"user-access-policy":').length - 1, 3);
    assert.match(
      utils,
      /action\?\.type === "user-access-policy"\) \{\s+return "process-deployment-only";/,
    );
  });

  test("every label of the editor exists in every locale", () => {
    const js = readModuleFile("deploymentAction", "deploymentAction.js");
    const html = readModuleFile("deploymentAction", "deploymentAction.html");
    for (const key of USER_ACCESS_POLICY_I18N_KEYS) {
      assert.ok(
        js.includes(`"${key}"`) || html.includes(`i18n.${key}}`),
        `${key} is not used by the editor`,
      );
      for (const locale of LOCALES) {
        assert.ok(loadLocale(locale)[key], `${key} is missing in ${locale}`);
      }
    }
  });
});
