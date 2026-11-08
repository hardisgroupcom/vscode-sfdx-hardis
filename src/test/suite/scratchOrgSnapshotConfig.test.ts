import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";

/**
 * The two scratch org snapshot keys of sfdx-hardis (useScratchOrgSnapshot,
 * scratchOrgSnapshotKeep) are read from the branch config only: the CLI
 * looks them up in config/branches/.sfdx-hardis.<branch>.yml.
 */

suite("Scratch org snapshot configuration", () => {
  const keys = ["useScratchOrgSnapshot", "scratchOrgSnapshotKeep"];

  test("both keys are branch-scoped fields of the Dev Hub section", () => {
    const section = SfdxHardisConfigHelper.SECTIONS.find(
      (entry) => entry.label === "devHub",
    );
    assert.ok(section, "a Dev Hub section must exist");
    for (const key of keys) {
      const field = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.find(
        (entry) => entry.name === key,
      );
      assert.ok(field, `${key} must be a configurable field`);
      assert.deepStrictEqual(
        field!.scopes,
        ["branch"],
        `${key} is read from the branch config only`,
      );
      assert.ok(section!.keys.includes(key), `the Dev Hub section must hold ${key}`);
    }
  });

  test("saving writes the branch file with typed values, and an emptied number is removed", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "sfdx-hardis-snapshot-config-"),
    );
    const globalPath = path.join(workspaceRoot, "config", ".sfdx-hardis.yml");
    const branchPath = path.join(
      workspaceRoot,
      "config",
      "branches",
      ".sfdx-hardis.integration.yml",
    );
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(globalPath, "developmentBranch: integration\n", "utf8");
    const helper = new SfdxHardisConfigHelper(workspaceRoot);
    await SfdxHardisConfigHelper.loadSchema();

    await helper.saveConfigFromEditor({
      config: { useScratchOrgSnapshot: "true", scratchOrgSnapshotKeep: "3" },
      isBranch: true,
      branchName: "integration",
    });
    const saved: any = yaml.load(fs.readFileSync(branchPath, "utf8"));
    assert.strictEqual(saved.useScratchOrgSnapshot, true);
    assert.strictEqual(saved.scratchOrgSnapshotKeep, 3);
    const global: any = yaml.load(fs.readFileSync(globalPath, "utf8"));
    for (const key of keys) {
      assert.ok(!(key in global), `${key} must not be written to the project config`);
    }

    // An emptied number is removed, so the CLI default (2) applies
    await helper.saveConfigFromEditor({
      config: { useScratchOrgSnapshot: true, scratchOrgSnapshotKeep: "" },
      isBranch: true,
      branchName: "integration",
    });
    const reset: any = yaml.load(fs.readFileSync(branchPath, "utf8"));
    assert.ok(
      !("scratchOrgSnapshotKeep" in reset),
      "an emptied scratchOrgSnapshotKeep must be removed, not written as null",
    );
    assert.strictEqual(reset.useScratchOrgSnapshot, true);
  });
});
