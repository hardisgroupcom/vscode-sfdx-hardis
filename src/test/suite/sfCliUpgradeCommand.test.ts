import * as assert from "assert";
import {
  buildPluginsInstallCommand,
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

  test("falls back to the generic commands when no version is known", () => {
    assert.strictEqual(
      buildSfCliUpgradeCommand(NATIVE_PATH, null),
      "sf update",
    );
    assert.strictEqual(
      buildSfCliUpgradeCommand(NPM_PATH, null),
      "npm install @salesforce/cli@latest -g",
    );
  });
});

suite("buildPluginsInstallCommand", () => {
  const plugins = [
    { name: "sfdx-hardis" },
    { name: "sfdx-browserforce-plugin" },
    { name: "sfdx-git-delta" },
    { name: "sf-git-merge-driver" },
  ];

  test("installs Browserforce last, after the other plugins", () => {
    const command = buildPluginsInstallCommand(plugins, "beta");
    const installs = [
      ...command.matchAll(/sf plugins:install ([^@\s]+)@(\S+)/g),
    ].map((match) => `${match[1]}@${match[2]}`);
    assert.deepStrictEqual(installs, [
      "sfdx-hardis@beta",
      "sfdx-git-delta@latest",
      "sf-git-merge-driver@latest",
      "sfdx-browserforce-plugin@latest",
    ]);
  });

  test("a failed install never skips the next ones", () => {
    const command = buildPluginsInstallCommand(plugins, "latest");
    const steps = command.split(" && ");
    assert.strictEqual(steps.length, plugins.length);
    for (const step of steps) {
      assert.match(
        step,
        /^echo y\|sf plugins:install \S+ \|\| echo \[sfdx-hardis\] Unable to install \S+, continuing with the next steps$/,
      );
    }
  });
});
