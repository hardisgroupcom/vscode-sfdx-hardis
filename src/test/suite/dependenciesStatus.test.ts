import * as assert from "assert";
import {
  applyRichInfoToPrerequisites,
  buildCheckingSummary,
  buildDependenciesStatusSummary,
  PluginsDetailSnapshot,
  PrerequisiteId,
  PrerequisiteStatus,
} from "../../utils/dependenciesStatus";

// Small builder to keep test cases readable
function prereq(
  overrides: Partial<PrerequisiteStatus> & Pick<PrerequisiteStatus, "id">,
): PrerequisiteStatus {
  return {
    label: overrides.id,
    status: "ok",
    installed: true,
    version: "1.0.0",
    recommended: null,
    helpUrl: "https://example.com",
    ...overrides,
  };
}

const ALL_OK: PrerequisiteStatus[] = [
  prereq({ id: "node" }),
  prereq({ id: "git" }),
  prereq({ id: "sf" }),
  prereq({ id: "sfdxHardis" }),
  prereq({ id: "vscodeExtensionPack" }),
];

// Applies overrides on top of ALL_OK for a single (or a few) prerequisites,
// keeping the rest healthy — avoids repeating the full 5-item list per test
function withOverrides(
  overrides: Partial<Record<PrerequisiteId, Partial<PrerequisiteStatus>>>,
): PrerequisiteStatus[] {
  return ALL_OK.map((p) =>
    overrides[p.id] ? { ...p, ...overrides[p.id] } : p,
  );
}

suite("dependenciesStatus", () => {
  suite("buildCheckingSummary", () => {
    test("reports the checking state with all 5 prerequisites pending", () => {
      const summary = buildCheckingSummary();
      assert.strictEqual(summary.state, "checking");
      assert.strictEqual(summary.prerequisites.length, 5);
      assert.ok(summary.prerequisites.every((p) => p.status === "checking"));
      assert.strictEqual(summary.missingCount, 0);
      assert.strictEqual(summary.outdatedCount, 0);
      assert.strictEqual(summary.actionableCount, 0);
    });

    test("every prerequisite has a real help URL", () => {
      const summary = buildCheckingSummary();
      for (const p of summary.prerequisites) {
        assert.ok(
          p.helpUrl.startsWith("https://") || p.helpUrl.startsWith("http://"),
          `${p.id} should have a real help URL`,
        );
      }
    });
  });

  suite("buildDependenciesStatusSummary — state mapping", () => {
    test("all prerequisites ok and no rich info -> allUpToDate", () => {
      const summary = buildDependenciesStatusSummary(ALL_OK, null);
      assert.strictEqual(summary.state, "allUpToDate");
      assert.strictEqual(summary.actionableCount, 0);
      assert.deepStrictEqual(summary.missingPrerequisites, []);
    });

    test("a single missing prerequisite -> upgradesRequired", () => {
      const prerequisites = withOverrides({
        node: { status: "missing", installed: false },
      });
      const summary = buildDependenciesStatusSummary(prerequisites, null);
      assert.strictEqual(summary.state, "upgradesRequired");
      assert.strictEqual(summary.missingCount, 1);
      assert.strictEqual(summary.outdatedCount, 0);
      assert.strictEqual(summary.actionableCount, 1);
      assert.deepStrictEqual(
        summary.missingPrerequisites.map((p) => p.id),
        ["node"],
      );
    });

    test("a single outdated prerequisite -> upgradesRequired, not counted as missing", () => {
      const prerequisites = withOverrides({
        node: { status: "outdated", version: "18.0.0", recommended: "24.0" },
      });
      const summary = buildDependenciesStatusSummary(prerequisites, null);
      assert.strictEqual(summary.state, "upgradesRequired");
      assert.strictEqual(summary.missingCount, 0);
      assert.strictEqual(summary.outdatedCount, 1);
      assert.strictEqual(summary.actionableCount, 1);
      assert.deepStrictEqual(summary.missingPrerequisites, []);
    });

    test("missing and outdated prerequisites both add up in actionableCount", () => {
      const prerequisites = withOverrides({
        node: { status: "missing", installed: false },
        git: { status: "missing", installed: false },
        sf: { status: "outdated", recommended: "2.90.0" },
      });
      const summary = buildDependenciesStatusSummary(prerequisites, null);
      assert.strictEqual(summary.state, "upgradesRequired");
      assert.strictEqual(summary.missingCount, 2);
      assert.strictEqual(summary.outdatedCount, 1);
      assert.strictEqual(summary.actionableCount, 3);
    });

    test("outdated plugins count from the rich info is added to outdatedCount", () => {
      const richInfo: PluginsDetailSnapshot = {
        outdatedPluginsCount: 3,
        sfCliMissing: false,
        sfdxHardisMissing: false,
      };
      const summary = buildDependenciesStatusSummary(ALL_OK, richInfo);
      assert.strictEqual(summary.state, "upgradesRequired");
      assert.strictEqual(summary.missingCount, 0);
      assert.strictEqual(summary.outdatedCount, 3);
      assert.strictEqual(summary.actionableCount, 3);
    });

    test("zero outdated plugins from rich info keeps allUpToDate", () => {
      const richInfo: PluginsDetailSnapshot = {
        outdatedPluginsCount: 0,
        sfCliMissing: false,
        sfdxHardisMissing: false,
      };
      const summary = buildDependenciesStatusSummary(ALL_OK, richInfo);
      assert.strictEqual(summary.state, "allUpToDate");
      assert.strictEqual(summary.actionableCount, 0);
    });
  });

  suite(
    "applyRichInfoToPrerequisites — missing detection independent of npm latest",
    () => {
      test("flags sf as missing when the rich pass resolved it as missing", () => {
        const richInfo: PluginsDetailSnapshot = {
          outdatedPluginsCount: 0,
          sfCliMissing: true,
          sfdxHardisMissing: false,
        };
        const merged = applyRichInfoToPrerequisites(ALL_OK, richInfo);
        const sf = merged.find((p) => p.id === "sf");
        assert.strictEqual(sf?.status, "missing");
        assert.strictEqual(sf?.installed, false);
      });

      test("flags sfdx-hardis as missing even though the naive check reported it ok (cold npm cache)", () => {
        const richInfo: PluginsDetailSnapshot = {
          outdatedPluginsCount: 0,
          sfCliMissing: false,
          sfdxHardisMissing: true,
        };
        const merged = applyRichInfoToPrerequisites(ALL_OK, richInfo);
        const sfdxHardis = merged.find((p) => p.id === "sfdxHardis");
        assert.strictEqual(sfdxHardis?.status, "missing");
        assert.strictEqual(sfdxHardis?.installed, false);
      });

      test("is idempotent: re-applying the same info twice does not change the result", () => {
        const richInfo: PluginsDetailSnapshot = {
          outdatedPluginsCount: 2,
          sfCliMissing: true,
          sfdxHardisMissing: true,
        };
        const once = applyRichInfoToPrerequisites(ALL_OK, richInfo);
        const twice = applyRichInfoToPrerequisites(once, richInfo);
        assert.deepStrictEqual(once, twice);
      });

      test("leaves node, git and the extension pack untouched", () => {
        const richInfo: PluginsDetailSnapshot = {
          outdatedPluginsCount: 0,
          sfCliMissing: true,
          sfdxHardisMissing: true,
        };
        const merged = applyRichInfoToPrerequisites(ALL_OK, richInfo);
        assert.strictEqual(merged.find((p) => p.id === "node")?.status, "ok");
        assert.strictEqual(merged.find((p) => p.id === "git")?.status, "ok");
        assert.strictEqual(
          merged.find((p) => p.id === "vscodeExtensionPack")?.status,
          "ok",
        );
      });
    },
  );

  suite(
    "buildDependenciesStatusSummary + rich info — end to end missing gap fix",
    () => {
      test("sf CLI and sfdx-hardis genuinely missing surface in missingPrerequisites and drive upgradesRequired", () => {
        const richInfo: PluginsDetailSnapshot = {
          outdatedPluginsCount: 0,
          sfCliMissing: true,
          sfdxHardisMissing: true,
        };
        const summary = buildDependenciesStatusSummary(ALL_OK, richInfo);
        assert.strictEqual(summary.state, "upgradesRequired");
        assert.strictEqual(summary.missingCount, 2);
        assert.deepStrictEqual(
          summary.missingPrerequisites.map((p) => p.id).sort(),
          ["sf", "sfdxHardis"],
        );
      });
    },
  );
});
