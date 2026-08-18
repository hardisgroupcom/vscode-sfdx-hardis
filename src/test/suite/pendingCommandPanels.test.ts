import * as assert from "assert";
import {
  extractCommandId,
  extractTargetOrgUsername,
} from "../../utils/pendingCommandPanels";

suite("pendingCommandPanels Test Suite", () => {
  test("extracts the oclif command id", () => {
    assert.strictEqual(
      extractCommandId(
        "sf hardis:org:diagnose:audittrail --outputfile ./x.csv",
      ),
      "hardis:org:diagnose:audittrail",
    );
    assert.strictEqual(extractCommandId("sf org display"), null);
  });

  test("returns null when no org is forced", () => {
    assert.strictEqual(
      extractTargetOrgUsername("sf hardis:org:monitor:all"),
      null,
    );
    assert.strictEqual(extractTargetOrgUsername(""), null);
    assert.strictEqual(extractTargetOrgUsername(undefined), null);
  });

  test("extracts the org forced with each supported flag", () => {
    const cases: [string, string][] = [
      [
        "sf hardis:org:diagnose:audittrail -u my.user@org.com",
        "my.user@org.com",
      ],
      [
        "sf hardis:org:diagnose:audittrail -o my.user@org.com",
        "my.user@org.com",
      ],
      [
        "sf hardis:org:diagnose:audittrail --target-org my.user@org.com",
        "my.user@org.com",
      ],
      [
        "sf hardis:org:diagnose:audittrail --targetusername my.user@org.com",
        "my.user@org.com",
      ],
    ];
    for (const [commandLine, expected] of cases) {
      assert.strictEqual(extractTargetOrgUsername(commandLine), expected);
    }
  });

  test("handles the equal notation and quoted values", () => {
    assert.strictEqual(
      extractTargetOrgUsername(
        "sf hardis:org:test:apex --target-org=my.user@org.com",
      ),
      "my.user@org.com",
    );
    assert.strictEqual(
      extractTargetOrgUsername(
        'sf hardis:org:test:apex --target-org "my alias"',
      ),
      "my alias",
    );
    assert.strictEqual(
      extractTargetOrgUsername("sf hardis:org:test:apex -u 'my.user@org.com'"),
      "my.user@org.com",
    );
  });

  test("ignores flags without a value and other flags", () => {
    assert.strictEqual(
      extractTargetOrgUsername("sf hardis:org:test:apex --target-org --json"),
      null,
    );
    assert.strictEqual(
      extractTargetOrgUsername(
        "sf hardis:org:create --target-dev-hub my.hub@org.com",
      ),
      null,
    );
    assert.strictEqual(
      extractTargetOrgUsername(
        "sf hardis:work:new --outputfile ./targetusername.csv",
      ),
      null,
    );
  });

  test("keeps the first forced org when several flags are present", () => {
    assert.strictEqual(
      extractTargetOrgUsername(
        "sf hardis:org:test:apex -u first@org.com -o second@org.com",
      ),
      "first@org.com",
    );
  });
});
