import * as assert from "assert";
import {
  comparePluginVersions,
  getPluginInstallKindFromInfo,
  getPluginInstallKindFromText,
  mustUpgradeSfdxHardisPlugin,
  parsePluginsJson,
  stripAnsiCodes,
} from "../../utils/pluginsVersionUtils";

// Real `sf plugins` output samples (Windows, Salesforce CLI 2.146.3)
const PLUGINS_TEXT_LINKED = [
  "code-analyzer 5.6.1",
  "packaging 3.0.5",
  "sf-git-merge-driver 2.0.0",
  "sfdmu 5.8.0",
  "sfdx-git-delta 6.45.1",
  "sfdx-hardis 7.23.0 (link) C:\\git\\sfdx-hardis",
].join("\n");

// Same output as displayed when the CLI colorizes it (dim version and tag)
const PLUGINS_TEXT_LINKED_ANSI =
  "sfdx-hardis \u001b[2m7.23.0\u001b[22m \u001b[2m(link) C:\\git\\sfdx-hardis\u001b[22m";

const PLUGINS_JSON_LINKED = JSON.stringify([
  {
    name: "sfdx-hardis",
    version: "7.23.0",
    type: "link",
    tag: null,
    root: "C:\\git\\sfdx-hardis",
  },
  {
    name: "sfdmu",
    version: "5.8.0",
    type: "user",
    tag: "latest",
    root: "C:\\Users\\me\\AppData\\Local\\sf\\node_modules\\sfdmu",
  },
]);

const PLUGINS_JSON_USER = JSON.stringify([
  {
    name: "sfdx-hardis",
    version: "7.23.0",
    type: "user",
    tag: "latest",
    root: "C:\\Users\\me\\AppData\\Local\\sf\\node_modules\\sfdx-hardis",
  },
]);

suite("pluginsVersionUtils", () => {
  suite("stripAnsiCodes", () => {
    test("removes color codes added by the Salesforce CLI", () => {
      assert.strictEqual(
        stripAnsiCodes(PLUGINS_TEXT_LINKED_ANSI),
        "sfdx-hardis 7.23.0 (link) C:\\git\\sfdx-hardis",
      );
    });
  });

  suite("getPluginInstallKindFromText", () => {
    test("detects a locally developed plugin", () => {
      assert.strictEqual(
        getPluginInstallKindFromText("7.23.0 (link) C:\\git\\sfdx-hardis"),
        "localdev",
      );
    });
    test("detects a locally developed plugin through ANSI colors", () => {
      const detail = PLUGINS_TEXT_LINKED_ANSI.replace("sfdx-hardis ", "");
      assert.strictEqual(getPluginInstallKindFromText(detail), "localdev");
    });
    test("detects an alpha install from its tag", () => {
      assert.strictEqual(
        getPluginInstallKindFromText("7.24.0 (alpha)"),
        "preview",
      );
    });
    test("detects a beta install from its tag", () => {
      assert.strictEqual(
        getPluginInstallKindFromText("7.24.0 (beta)"),
        "preview",
      );
    });
    test("detects a preview install from its version suffix", () => {
      assert.strictEqual(
        getPluginInstallKindFromText("7.24.0-alpha.3"),
        "preview",
      );
      assert.strictEqual(
        getPluginInstallKindFromText("7.24.0-beta.1"),
        "preview",
      );
    });
    test("considers a plain version as a standard install", () => {
      assert.strictEqual(getPluginInstallKindFromText("7.23.0"), "standard");
    });
    test("considers an empty detail as missing", () => {
      assert.strictEqual(getPluginInstallKindFromText(""), "missing");
      assert.strictEqual(getPluginInstallKindFromText("   "), "missing");
    });
    test("is not fooled by a local path containing the word alpha", () => {
      assert.strictEqual(
        getPluginInstallKindFromText("7.23.0 (link) C:\\git\\alpha-project"),
        "localdev",
      );
    });
  });

  suite("parsePluginsJson + getPluginInstallKindFromInfo", () => {
    test("parses a plain array and detects a linked plugin", () => {
      const plugins = parsePluginsJson(PLUGINS_JSON_LINKED);
      assert.strictEqual(plugins["sfdx-hardis"].version, "7.23.0");
      assert.strictEqual(
        getPluginInstallKindFromInfo(plugins["sfdx-hardis"]),
        "localdev",
      );
      assert.strictEqual(
        getPluginInstallKindFromInfo(plugins["sfdmu"]),
        "standard",
      );
    });
    test("parses a { status, result } envelope", () => {
      const plugins = parsePluginsJson(
        JSON.stringify({ status: 0, result: JSON.parse(PLUGINS_JSON_USER) }),
      );
      assert.strictEqual(
        getPluginInstallKindFromInfo(plugins["sfdx-hardis"]),
        "standard",
      );
    });
    test("ignores warning lines printed before the JSON payload", () => {
      const plugins = parsePluginsJson(
        `Warning: @salesforce/cli update available.\n${PLUGINS_JSON_LINKED}`,
      );
      assert.strictEqual(
        getPluginInstallKindFromInfo(plugins["sfdx-hardis"]),
        "localdev",
      );
    });
    test("detects preview installs from the tag or the version", () => {
      assert.strictEqual(
        getPluginInstallKindFromInfo({
          name: "sfdx-hardis",
          version: "7.24.0",
          type: "user",
          tag: "alpha",
        }),
        "preview",
      );
      assert.strictEqual(
        getPluginInstallKindFromInfo({
          name: "sfdx-hardis",
          version: "7.24.0-beta.2",
          type: "user",
          tag: "latest",
        }),
        "preview",
      );
    });
    test("returns missing for an unknown plugin and unusable output", () => {
      assert.strictEqual(getPluginInstallKindFromInfo(null), "missing");
      assert.deepStrictEqual(parsePluginsJson("not json at all"), {});
      assert.deepStrictEqual(parsePluginsJson(""), {});
    });
  });

  suite("mustUpgradeSfdxHardisPlugin - pre-release extension", () => {
    const preRelease = {
      isExtensionPreRelease: true,
      minimalVersion: "8.0.0",
    };
    test("accepts a locally developed plugin", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...preRelease,
          kind: "localdev",
          installedVersion: "7.23.0",
        }),
        false,
      );
    });
    test("accepts an alpha or beta plugin", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...preRelease,
          kind: "preview",
          installedVersion: "7.24.0-alpha.1",
        }),
        false,
      );
    });
    test("requires an upgrade for a standard install", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...preRelease,
          kind: "standard",
          installedVersion: "7.23.0",
        }),
        true,
      );
    });
    test("requires an upgrade even when the standard install is recent", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...preRelease,
          kind: "standard",
          installedVersion: "99.0.0",
        }),
        true,
      );
    });
  });

  suite("mustUpgradeSfdxHardisPlugin - released extension", () => {
    const released = {
      isExtensionPreRelease: false,
      minimalVersion: "8.0.0",
    };
    test("accepts a locally developed plugin, even an old one", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...released,
          kind: "localdev",
          installedVersion: "1.0.0",
        }),
        false,
      );
    });
    test("requires the latest version instead of an alpha or a beta", () => {
      // A released extension only accepts published versions and local dev
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...released,
          kind: "preview",
          installedVersion: "7.0.0-beta.1",
        }),
        true,
      );
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...released,
          kind: "preview",
          installedVersion: "99.0.0-alpha.1",
        }),
        true,
      );
    });
    test("requires an upgrade below the minimal version", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...released,
          kind: "standard",
          installedVersion: "7.23.0",
        }),
        true,
      );
    });
    test("accepts a version equal to or above the minimal version", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...released,
          kind: "standard",
          installedVersion: "8.0.0",
        }),
        false,
      );
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...released,
          kind: "standard",
          installedVersion: "8.1.2",
        }),
        false,
      );
    });
    test("requires a preview build when the minimal version is 'beta'", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          isExtensionPreRelease: false,
          minimalVersion: "beta",
          kind: "standard",
          installedVersion: "8.0.0",
        }),
        true,
      );
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          isExtensionPreRelease: false,
          minimalVersion: "beta",
          kind: "preview",
          installedVersion: "8.0.0-beta.1",
        }),
        false,
      );
    });
    test("never warns when the plugin is not installed", () => {
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          ...released,
          kind: "missing",
          installedVersion: null,
        }),
        false,
      );
    });
  });

  suite("end to end from real CLI outputs", () => {
    // Reproduces what the extension does: extract the plugin line, then decide
    const extractDetail = (stdout: string, pluginName: string): string => {
      const match = new RegExp(`^\\s*${pluginName}\\s+(.*)$`, "m").exec(
        stripAnsiCodes(stdout),
      );
      return match ? match[1] : "";
    };

    test("linked plugin + pre-release extension: no upgrade prompt", () => {
      const kind = getPluginInstallKindFromText(
        extractDetail(PLUGINS_TEXT_LINKED, "sfdx-hardis"),
      );
      assert.strictEqual(kind, "localdev");
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          kind,
          installedVersion: "7.23.0",
          isExtensionPreRelease: true,
          minimalVersion: "8.0.0",
        }),
        false,
      );
    });

    test("plain install + pre-release extension: upgrade prompt", () => {
      const kind = getPluginInstallKindFromText(
        extractDetail("sfdx-hardis 7.23.0", "sfdx-hardis"),
      );
      assert.strictEqual(kind, "standard");
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          kind,
          installedVersion: "7.23.0",
          isExtensionPreRelease: true,
          minimalVersion: "8.0.0",
        }),
        true,
      );
    });

    test("beta plugin + pre-release extension: no upgrade prompt", () => {
      // Real output of `sf plugins` after `sf plugins install sfdx-hardis@beta`
      const realBetaOutput =
        "sfdx-hardis \u001b[2m7.23.1-beta202608161651.0\u001b[22m\u001b[2m (beta)\u001b[22m";
      const kind = getPluginInstallKindFromText(
        extractDetail(realBetaOutput, "sfdx-hardis"),
      );
      assert.strictEqual(kind, "preview");
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          kind,
          installedVersion: "7.23.1-beta202608161651.0",
          isExtensionPreRelease: true,
          minimalVersion: "8.0.0",
        }),
        false,
      );
      // Same conclusion from the JSON source
      const info = parsePluginsJson(
        JSON.stringify([
          {
            name: "sfdx-hardis",
            version: "7.23.1-beta202608161651.0",
            type: "user",
            tag: "beta",
            root: "C:\\Users\\me\\AppData\\Local\\sf\\node_modules\\sfdx-hardis",
          },
        ]),
      )["sfdx-hardis"];
      assert.strictEqual(getPluginInstallKindFromInfo(info), "preview");
    });

    test("beta plugin + released extension: upgrade to latest is required", () => {
      const realBetaOutput =
        "sfdx-hardis [2m7.23.1-beta202608161651.0[22m[2m (beta)[22m";
      const kind = getPluginInstallKindFromText(
        extractDetail(realBetaOutput, "sfdx-hardis"),
      );
      assert.strictEqual(kind, "preview");
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          kind,
          installedVersion: "7.23.1-beta202608161651.0",
          isExtensionPreRelease: false,
          minimalVersion: "8.0.0",
        }),
        true,
      );
    });

    test("linked plugin + released extension: no upgrade prompt", () => {
      const kind = getPluginInstallKindFromText(
        extractDetail(PLUGINS_TEXT_LINKED, "sfdx-hardis"),
      );
      assert.strictEqual(kind, "localdev");
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          kind,
          installedVersion: "7.23.0",
          isExtensionPreRelease: false,
          minimalVersion: "8.0.0",
        }),
        false,
      );
    });

    test("json wins over text when the CLI hides the link marker", () => {
      const info = parsePluginsJson(PLUGINS_JSON_LINKED)["sfdx-hardis"];
      assert.strictEqual(getPluginInstallKindFromInfo(info), "localdev");
      assert.strictEqual(
        mustUpgradeSfdxHardisPlugin({
          kind: getPluginInstallKindFromInfo(info),
          installedVersion: info.version,
          isExtensionPreRelease: true,
          minimalVersion: "8.0.0",
        }),
        false,
      );
    });
  });

  suite("comparePluginVersions", () => {
    test("compares numerically and ignores prerelease identifiers", () => {
      assert.strictEqual(comparePluginVersions("7.23.0", "8.0.0"), -1);
      assert.strictEqual(comparePluginVersions("8.0.0", "8.0.0"), 0);
      assert.strictEqual(comparePluginVersions("10.0.0", "9.9.9"), 1);
      assert.strictEqual(comparePluginVersions("", "8.0.0"), 0);
      // A prerelease of the required version satisfies it (not below minimum)
      assert.ok(comparePluginVersions("8.0.0-beta.1", "8.0.0") >= 0);
      assert.ok(comparePluginVersions("8.0.0-alpha.2", "8.0.1") < 0);
    });
  });
});
