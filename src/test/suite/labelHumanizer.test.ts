import * as assert from "assert";
import { humanizeConfigKeyLabel } from "../../utils/labelHumanizer";

suite("labelHumanizer Test Suite", () => {
  test("humanizes a camelCase key ending with a known acronym", () => {
    assert.strictEqual(
      humanizeConfigKeyLabel("userInputCommandLineIfLWC"),
      "User input command line if LWC",
    );
  });

  test("uppercases acronyms found in the middle of a key", () => {
    assert.strictEqual(
      humanizeConfigKeyLabel("ignoreSfdxCliRecommendedVersion"),
      "Ignore SFDX CLI recommended version",
    );
  });

  test("humanizes a simple camelCase key with no acronym", () => {
    assert.strictEqual(
      humanizeConfigKeyLabel("showWelcomeAtStartup"),
      "Show welcome at startup",
    );
  });

  test("humanizes a single word key", () => {
    assert.strictEqual(humanizeConfigKeyLabel("theme"), "Theme");
  });

  test("returns an empty string for an empty key", () => {
    assert.strictEqual(humanizeConfigKeyLabel(""), "");
  });

  test("keeps a trailing acronym uppercase even when the whole key is an acronym", () => {
    assert.strictEqual(humanizeConfigKeyLabel("autoStartSalesforceCliMcp"), "Auto start Salesforce CLI MCP");
  });

  test("keeps brand names capitalized anywhere in the label", () => {
    assert.strictEqual(humanizeConfigKeyLabel("disableGitBashCheck"), "Disable Git Bash check");
    assert.strictEqual(humanizeConfigKeyLabel("disableGitMergeRequiredCheck"), "Disable Git merge required check");
  });
});
