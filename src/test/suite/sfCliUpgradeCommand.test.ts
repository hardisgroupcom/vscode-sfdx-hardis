import * as assert from "assert";
import {
  buildSfCliUpgradeCommand,
  isNativeSfCliInstall,
} from "../../utils/setupUtils";

// A native installer path (Windows MSI) and an npm global path
const NATIVE_PATH = "C:/Program Files/sf/bin/sf.cmd";
const NPM_PATH = "C:/Users/me/AppData/Roaming/npm/sf.cmd";

suite("buildSfCliUpgradeCommand", () => {
  test("detects native vs npm installs", () => {
    assert.strictEqual(isNativeSfCliInstall(NATIVE_PATH), true);
    assert.strictEqual(isNativeSfCliInstall(NPM_PATH), false);
    assert.strictEqual(isNativeSfCliInstall("missing"), false);
  });

  test("pins the recommended version on npm installs", () => {
    assert.strictEqual(
      buildSfCliUpgradeCommand(NPM_PATH, "2.151.6"),
      "npm install @salesforce/cli@2.151.6 -g",
    );
  });

  test("pins the recommended version on native installs too", () => {
    assert.strictEqual(
      buildSfCliUpgradeCommand(NATIVE_PATH, "2.151.6"),
      "sf update --version 2.151.6",
    );
  });

  test("falls back to the untargeted commands when no version is known", () => {
    assert.strictEqual(buildSfCliUpgradeCommand(NATIVE_PATH, null), "sf update");
    assert.strictEqual(
      buildSfCliUpgradeCommand(NPM_PATH, null),
      "npm install @salesforce/cli@latest -g",
    );
  });
});
