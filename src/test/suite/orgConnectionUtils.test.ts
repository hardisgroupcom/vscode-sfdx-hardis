import * as assert from "assert";
import {
  buildOrgOpenCommand,
  buildOrgReconnectCommand,
  isOrgConnected,
  isSafeUsername,
} from "../../utils/orgConnectionUtils";
import { quote } from "../../utils/shellQuote";
import { extractFunction, readModuleFile } from "./lwcSourceUtils";

/**
 * Whether an org can be used, and the commands that log in to it again or open it: one rule and
 * one command line for the Status tree, the Orgs Manager, the Metadata Retriever, Metadata
 * Dependencies and the development orgs of the DevOps Pipeline.
 */

const URL = "https://acme--dev.sandbox.my.salesforce.com";

suite("Org connection", () => {
  suite("isOrgConnected", () => {
    test("a probed org is connected when the probe answered Connected or Authorized", () => {
      assert.ok(isOrgConnected({ connectedStatus: "Connected" }));
      assert.ok(isOrgConnected({ connectedStatus: "Authorized" }));
      assert.ok(!isOrgConnected({ connectedStatus: "RefreshTokenAuthError" }));
      // A word that only contains "connected" or "authorized" is not an answer of the probe
      assert.ok(!isOrgConnected({ connectedStatus: "Unauthorized" }));
      assert.ok(!isOrgConnected({ connectedStatus: "Disconnected" }));
    });

    test("a scratch org is connected while its Dev Hub says Active, never once it ended", () => {
      assert.ok(isOrgConnected({ status: "Active" }));
      assert.ok(!isOrgConnected({ status: "Expired" }));
      assert.ok(!isOrgConnected({ status: "Deleted" }));
      assert.ok(
        !isOrgConnected({ status: "Expired", connectedStatus: "Connected" }),
      );
    });

    test("an org with neither answer is not connected", () => {
      assert.ok(!isOrgConnected({}));
      assert.ok(!isOrgConnected(null));
    });

    test("the Orgs Manager webview copy answers the same", () => {
      const source = readModuleFile("orgManager", "orgManager.js");
      const orgConnectionState: (org: any) => string = new Function(
        `${extractFunction(source, "orgConnectionState")}; return orgConnectionState;`,
      )();
      for (const org of [
        { connectedStatus: "Connected" },
        { connectedStatus: "Authorized" },
        { connectedStatus: "RefreshTokenAuthError" },
        { connectedStatus: "Unauthorized" },
        { status: "Active" },
        { status: "Expired" },
        { status: "Deleted", connectedStatus: "Connected" },
        { status: "Active", connectedStatus: "RefreshTokenAuthError" },
        {},
      ]) {
        assert.strictEqual(
          orgConnectionState(org) === "connected",
          isOrgConnected(org),
          JSON.stringify(org),
        );
      }
    });
  });

  suite("buildOrgReconnectCommand", () => {
    test("a new web login at the instance URL, replacing the login of the username", () => {
      assert.strictEqual(
        buildOrgReconnectCommand({
          username: "me@acme.com.dev",
          instanceUrl: `${URL}/`,
        }),
        `sf hardis:org:select --reconnect --instance-url ${quote(URL)} --username ${quote("me@acme.com.dev")}`,
      );
    });

    test("set-default: the Status tree sets it, the Orgs Manager does not, the others ask", () => {
      const base = { username: "me@acme.com", instanceUrl: URL };
      assert.match(
        buildOrgReconnectCommand({ ...base, setDefault: true }),
        / --set-default$/,
      );
      assert.match(
        buildOrgReconnectCommand({ ...base, setDefault: false }),
        / --no-set-default$/,
      );
      assert.doesNotMatch(buildOrgReconnectCommand(base), /set-default/);
      assert.match(
        buildOrgReconnectCommand({ ...base, devHub: true, setDefault: true }),
        / --devhub --set-default$/,
      );
    });

    test("without a usable instance URL, sfdx-hardis checks the org of the username, or lists the orgs", () => {
      // --reconnect without --instance-url is refused by sfdx-hardis
      assert.strictEqual(
        buildOrgReconnectCommand({
          username: "me@acme.com",
          setDefault: false,
        }),
        `sf hardis:org:select --username ${quote("me@acme.com")} --no-set-default`,
      );
      assert.strictEqual(
        buildOrgReconnectCommand({ instanceUrl: "" }),
        "sf hardis:org:select",
      );
    });

    test("a value that is not an https instance URL or a username is left out", () => {
      for (const instanceUrl of [
        "http://acme.my.salesforce.com",
        'https://acme.my.salesforce.com" && calc',
        "https://acme.my.salesforce.com/$(calc)",
        "javascript:alert(1)",
      ]) {
        assert.doesNotMatch(
          buildOrgReconnectCommand({ instanceUrl }),
          /--reconnect|--instance-url/,
          instanceUrl,
        );
      }
      for (const username of ['me@acme.com" --x "', "me $x", "", null]) {
        assert.doesNotMatch(
          buildOrgReconnectCommand({ instanceUrl: URL, username }),
          /--username/,
          String(username),
        );
      }
    });
  });

  suite("buildOrgOpenCommand", () => {
    test("a username or an alias, and a page, quoted", () => {
      assert.strictEqual(
        buildOrgOpenCommand("me@acme.com.dev"),
        `sf org open --target-org ${quote("me@acme.com.dev")}`,
      );
      assert.strictEqual(
        buildOrgOpenCommand("my alias", { path: "/lightning/setup/Home" }),
        `sf org open --target-org ${quote("my alias")} --path ${quote("/lightning/setup/Home")}`,
      );
    });
  });

  test("a username is an email address shape, nothing a shell reads", () => {
    assert.ok(isSafeUsername("jane.o'neil+dev@acme.com.uat"));
    assert.ok(!isSafeUsername("me@acme.com; calc"));
    assert.ok(!isSafeUsername("me $x"));
    assert.ok(!isSafeUsername(undefined));
  });
});
