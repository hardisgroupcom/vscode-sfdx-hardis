import * as assert from "assert";
import { extractFunction, readModuleFile } from "./lwcSourceUtils";

/**
 * Contract of the Org Manager connection state.
 *
 * The LWC bundle cannot run in the extension test host, so the helper is lifted
 * out of the source and executed on its own, the way the other LWC contract
 * suites do it.
 */
function loadOrgConnectionState(): (org: any) => string {
  const source = readModuleFile("orgManager", "orgManager.js");
  const body = extractFunction(source, "orgConnectionState");
  return new Function(`${body}; return orgConnectionState;`)();
}

suite("Org Manager connection state", () => {
  const orgConnectionState = loadOrgConnectionState();

  test("a scratch org the Dev Hub reports Active is connected", () => {
    // `sf org list` never probes a scratch org: it asks the Dev Hub, and the
    // answer lands in `status`. Reading only `connectedStatus` made every
    // scratch org of the list read as disconnected.
    assert.strictEqual(
      orgConnectionState({
        orgType: "scratch",
        isScratch: true,
        status: "Active",
      }),
      "connected",
    );
  });

  test("an expired or deleted scratch org is disconnected", () => {
    for (const status of ["Expired", "Deleted"]) {
      assert.strictEqual(
        orgConnectionState({ orgType: "scratch", isScratch: true, status }),
        "disconnected",
      );
    }
  });

  test("connectedStatus still decides when the org was probed", () => {
    assert.strictEqual(
      orgConnectionState({ connectedStatus: "Connected" }),
      "connected",
    );
    assert.strictEqual(
      orgConnectionState({ connectedStatus: "Authorized" }),
      "connected",
    );
    assert.strictEqual(
      orgConnectionState({ connectedStatus: "RefreshTokenAuthError" }),
      "disconnected",
    );
  });

  test("a probed scratch org trusts the probe over the Dev Hub answer", () => {
    assert.strictEqual(
      orgConnectionState({
        orgType: "scratch",
        status: "Active",
        connectedStatus: "RefreshTokenAuthError",
      }),
      "disconnected",
    );
  });

  test("a row that arrived before the probe is pending", () => {
    assert.strictEqual(
      orgConnectionState({ connectionStatusPending: true, status: "Active" }),
      "pending",
    );
  });

  test("an org with neither status is disconnected", () => {
    assert.strictEqual(orgConnectionState({}), "disconnected");
  });
});
