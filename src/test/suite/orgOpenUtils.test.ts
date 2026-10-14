import * as assert from "assert";
import { isOrgOpenCommand, withUrlOnly } from "../../utils/orgUtils";

suite("orgUtils open org Test Suite", () => {
  test("recognizes a sf org open command, with or without flags", () => {
    assert.strictEqual(isOrgOpenCommand("sf org open"), true);
    assert.strictEqual(
      isOrgOpenCommand("sf org open --target-org acme@example.com"),
      true,
    );
    assert.strictEqual(
      isOrgOpenCommand(
        "  sf org open --path lightning/setup/SetupOneHome/home",
      ),
      true,
    );
    assert.strictEqual(isOrgOpenCommand("sf org display"), false);
    assert.strictEqual(isOrgOpenCommand("sf hardis:org:select"), false);
    assert.strictEqual(isOrgOpenCommand("sf org open-something"), false);
  });

  test("asks for the link instead of a browser, once", () => {
    assert.strictEqual(
      withUrlOnly("sf org open --target-org acme"),
      "sf org open --target-org acme --url-only",
    );
    assert.strictEqual(
      withUrlOnly("sf org open --url-only"),
      "sf org open --url-only",
    );
    assert.strictEqual(
      withUrlOnly("sf org open -r --target-org acme"),
      "sf org open -r --target-org acme",
    );
    assert.strictEqual(withUrlOnly("  sf org open  "), "sf org open --url-only");
  });
});
