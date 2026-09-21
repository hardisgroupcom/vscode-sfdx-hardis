import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  EXTENSION_ID,
  buildMarketplaceQueryBody,
  parseMarketplaceLatestReleaseVersion,
  parseOpenVsxLatestReleaseVersion,
  resolveExtensionUpdateStatus,
} from "../../utils/extensionVersionUtils";
import { REPO_ROOT, assertKeysTranslated } from "./lwcSourceUtils";

// Shape returned by the Marketplace gallery query, trimmed to the fields read
// here. The gallery returns the versions newest first and mixes the
// pre-releases published from the alpha branch in with the releases.
function marketplacePayload(
  versions: { version: string; preRelease?: boolean }[],
): any {
  return {
    results: [
      {
        extensions: [
          {
            extensionName: "vscode-sfdx-hardis",
            versions: versions.map((entry) => ({
              version: entry.version,
              properties: entry.preRelease
                ? [
                    {
                      key: "Microsoft.VisualStudio.Code.PreRelease",
                      value: "true",
                    },
                  ]
                : [{ key: "Microsoft.VisualStudio.Code.Engine", value: "^1.95" }],
            })),
          },
        ],
      },
    ],
  };
}

suite("extensionVersionUtils", () => {
  suite("buildMarketplaceQueryBody", () => {
    test("asks the gallery for the extension versions and their properties", () => {
      const body = buildMarketplaceQueryBody();
      assert.deepStrictEqual(body.filters[0].criteria, [
        { filterType: 7, value: EXTENSION_ID },
      ]);
      // 1 = IncludeVersions, 16 = IncludeVersionProperties: without the
      // properties, a pre-release version can not be told from a release
      assert.strictEqual(body.flags, 17);
    });
  });

  suite("parseMarketplaceLatestReleaseVersion", () => {
    test("returns the newest version when no pre-release is published", () => {
      const payload = marketplacePayload([
        { version: "8.7.0" },
        { version: "8.6.1" },
      ]);
      assert.strictEqual(parseMarketplaceLatestReleaseVersion(payload), "8.7.0");
    });

    test("skips the pre-release versions published from the alpha branch", () => {
      const payload = marketplacePayload([
        { version: "8.8.0", preRelease: true },
        { version: "8.7.1", preRelease: true },
        { version: "8.7.0" },
      ]);
      assert.strictEqual(parseMarketplaceLatestReleaseVersion(payload), "8.7.0");
    });

    test("returns null when the payload carries no usable version", () => {
      assert.strictEqual(parseMarketplaceLatestReleaseVersion(null), null);
      assert.strictEqual(parseMarketplaceLatestReleaseVersion({}), null);
      assert.strictEqual(
        parseMarketplaceLatestReleaseVersion(marketplacePayload([])),
        null,
      );
      assert.strictEqual(
        parseMarketplaceLatestReleaseVersion(
          marketplacePayload([{ version: "8.8.0", preRelease: true }]),
        ),
        null,
      );
    });
  });

  suite("parseOpenVsxLatestReleaseVersion", () => {
    test("reads the version of the Open VSX payload", () => {
      assert.strictEqual(
        parseOpenVsxLatestReleaseVersion({ version: "8.7.0" }),
        "8.7.0",
      );
    });

    test("returns null when the payload has no version", () => {
      assert.strictEqual(parseOpenVsxLatestReleaseVersion(null), null);
      assert.strictEqual(parseOpenVsxLatestReleaseVersion({}), null);
      assert.strictEqual(parseOpenVsxLatestReleaseVersion({ version: "" }), null);
    });
  });

  suite("resolveExtensionUpdateStatus", () => {
    test("a release left behind by the published one is outdated", () => {
      const status = resolveExtensionUpdateStatus({
        installedVersion: "8.6.1",
        latestVersion: "8.7.0",
        isPreRelease: false,
      });
      assert.strictEqual(status.state, "outdated");
      assert.strictEqual(status.latestVersion, "8.7.0");
      assert.strictEqual(status.isPreviewAhead, false);
    });

    test("the published release itself is up to date", () => {
      const status = resolveExtensionUpdateStatus({
        installedVersion: "8.7.0",
        latestVersion: "8.7.0",
        isPreRelease: false,
      });
      assert.strictEqual(status.state, "ok");
      assert.strictEqual(status.isPreviewAhead, false);
    });

    test("a pre-release ahead of the latest release is not reported", () => {
      const status = resolveExtensionUpdateStatus({
        installedVersion: "8.8.0",
        latestVersion: "8.7.0",
        isPreRelease: true,
      });
      assert.strictEqual(status.state, "ok");
      assert.strictEqual(status.isPreviewAhead, true);
    });

    test("a pre-release the releases have gone past is outdated", () => {
      const status = resolveExtensionUpdateStatus({
        installedVersion: "8.5.0",
        latestVersion: "8.7.0",
        isPreRelease: true,
      });
      assert.strictEqual(status.state, "outdated");
      assert.strictEqual(status.isPreviewAhead, false);
    });

    test("a pre-release of the published version is neither ahead nor behind", () => {
      const status = resolveExtensionUpdateStatus({
        installedVersion: "8.7.0",
        latestVersion: "8.7.0",
        isPreRelease: true,
      });
      assert.strictEqual(status.state, "ok");
      assert.strictEqual(status.isPreviewAhead, false);
    });

    test("an unknown published version never reports an upgrade", () => {
      for (const latestVersion of [null, undefined, ""]) {
        const status = resolveExtensionUpdateStatus({
          installedVersion: "8.7.0",
          latestVersion,
          isPreRelease: false,
        });
        assert.strictEqual(status.state, "unknown");
        assert.strictEqual(status.isPreviewAhead, false);
      }
    });

    test("an unknown installed version never reports an upgrade", () => {
      const status = resolveExtensionUpdateStatus({
        installedVersion: null,
        latestVersion: "8.7.0",
        isPreRelease: false,
      });
      assert.strictEqual(status.state, "unknown");
    });
  });

  suite("the check is wired on every dependencies surface", () => {
    // The same question ("is the extension itself up to date?") is answered in
    // three places, each feeding a different UI. A fix in one of them is
    // worthless if the other two keep reporting a stale build as fine.
    const readSource = (relative: string): string =>
      fs.readFileSync(path.join(REPO_ROOT, "src", relative), "utf8");

    test("the Dependencies tree view flags it", () => {
      const source = readSource("hardis-plugins-provider.ts");
      assert.ok(
        source.includes("resolveExtensionUpdateStatus"),
        "the tree view must compare the running extension to the published one",
      );
      assert.ok(
        source.includes("clickToUpdateVsCodeExtension"),
        "the tree row must offer the update",
      );
    });

    test("the Setup panel flags it", () => {
      const source = readSource("utils/setupUtils.ts");
      assert.ok(
        source.includes("resolveExtensionUpdateStatus"),
        "the Setup LWC must compare the running extension to the published one",
      );
      assert.ok(
        source.includes("depVsCodeExtensionOutdatedMessage"),
        "the Setup card must say which published version is expected",
      );
    });

    test("the Welcome page dependencies aggregate counts it", () => {
      const source = readSource("utils/dependenciesStatus.ts");
      assert.ok(
        source.includes("resolveExtensionUpdateStatus"),
        "the aggregate must compare the running extension to the published one",
      );
      assert.ok(
        source.includes("vscodeSfdxHardis"),
        "the aggregate must carry the extension as a prerequisite",
      );
    });

    test("none of them compares a version built from sources", () => {
      // An extension started with F5 or by the tests runs the version of the
      // local package.json, which has nothing to do with what is published
      for (const relative of [
        "hardis-plugins-provider.ts",
        "utils/setupUtils.ts",
        "utils/dependenciesStatus.ts",
      ]) {
        assert.ok(
          readSource(relative).includes("isExtensionProductionMode"),
          `${relative} must skip the check outside a production install`,
        );
      }
    });
  });

  test("the messages are translated in the 9 locales", () => {
    assertKeysTranslated([
      "clickToUpdateVsCodeExtension",
      "depVsCodeExtensionExplanation",
      "depVsCodeExtensionOutdatedMessage",
      "depVsCodeExtensionPreviewNote",
      "reloadWindow",
      "vsCodeExtensionUpToDate",
      "vsCodeExtensionUpdatedReload",
    ]);
  });
});
