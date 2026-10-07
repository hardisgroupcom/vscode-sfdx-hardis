import * as assert from "assert";
import {
  buildCrudReadCommand,
  buildStandardRetrieveCommand,
  candidateObjectNames,
  failedOutcome,
  isActiveOnlyFlagUnknown,
  removedEmptyObjectNames,
  mergeRetrieveOutcomes,
  parseRetrieveMode,
  splitByRetrieveMode,
  toMetadataArgs,
} from "../../utils/metadataRetrieveModes";

const ITEMS = [
  { memberType: "Profile", memberName: "Admin" },
  { memberType: "PermissionSet", memberName: "Crew" },
  { memberType: "CustomField", memberName: "Account.Flag__c" },
  { memberType: "ApexClass", memberName: "MyClass" },
];

suite("metadataRetrieveModes Test Suite", () => {
  test("Auto reads only Profiles with the CRUD Metadata API", () => {
    const { crudItems, standardItems } = splitByRetrieveMode(ITEMS, "auto");
    assert.deepStrictEqual(
      crudItems.map((item) => item.memberName),
      ["Admin"],
    );
    assert.deepStrictEqual(
      standardItems.map((item) => item.memberName),
      ["Crew", "Account.Flag__c", "MyClass"],
    );
  });

  test("the Full modes read everything with the CRUD Metadata API, Off nothing", () => {
    for (const mode of ["full", "fullActiveOnly"] as const) {
      const { crudItems, standardItems } = splitByRetrieveMode(ITEMS, mode);
      assert.strictEqual(crudItems.length, ITEMS.length, mode);
      assert.strictEqual(standardItems.length, 0, mode);
    }
    const off = splitByRetrieveMode(ITEMS, "off");
    assert.strictEqual(off.crudItems.length, 0);
    assert.strictEqual(off.standardItems.length, ITEMS.length);
  });

  test("--active-only is passed in Auto and Full active only, not in Full all tags", () => {
    const build = (mode: any) =>
      buildCrudReadCommand({
        source: toMetadataArgs([ITEMS[0]]),
        username: "me@acme.com",
        mode,
      });
    assert.ok(build("auto").includes(" --active-only"));
    assert.ok(build("fullActiveOnly").includes(" --active-only"));
    assert.ok(!build("full").includes("--active-only"));
    assert.strictEqual(
      build("full"),
      'sf hardis mdapi read --metadata "Profile:Admin" --target-org me@acme.com --agent --ignore-errors --json',
    );
  });

  test("the CRUD read never passes --output-dir, and can leave --active-only out", () => {
    const command = buildCrudReadCommand({
      source: '--manifest "C:/tmp/package.xml"',
      username: "me@acme.com",
      mode: "auto",
    });
    assert.ok(!command.includes("--output-dir"));
    assert.ok(command.includes('--manifest "C:/tmp/package.xml"'));
    assert.ok(
      !buildCrudReadCommand({
        source: "",
        username: "me@acme.com",
        mode: "auto",
        activeOnlySupported: false,
      }).includes("--active-only"),
    );
  });

  test("recognizes an sfdx-hardis that does not know --active-only", () => {
    assert.ok(
      isActiveOnlyFlagUnknown({
        status: 1,
        message: "Nonexistent flag: --active-only\nSee more help with --help",
      }),
    );
    assert.ok(
      !isActiveOnlyFlagUnknown({ status: 1, message: "INVALID_SESSION_ID" }),
    );
  });

  test("the standard retrieve ignores conflicts only when asked", () => {
    const source = toMetadataArgs([ITEMS[1]]);
    assert.strictEqual(
      buildStandardRetrieveCommand({
        source,
        username: "me@acme.com",
        forceOverwrite: false,
      }),
      'sf project retrieve start --metadata "PermissionSet:Crew" --target-org me@acme.com --json',
    );
    assert.ok(
      buildStandardRetrieveCommand({
        source,
        username: "me@acme.com",
        forceOverwrite: true,
      }).includes(" --ignore-conflicts"),
    );
  });

  test("parses the mode sent by the panel, and the legacy useCrudApi flag", () => {
    assert.strictEqual(parseRetrieveMode("fullActiveOnly"), "fullActiveOnly");
    assert.strictEqual(parseRetrieveMode(undefined, true), "full");
    assert.strictEqual(parseRetrieveMode(undefined, false), "auto");
    assert.strictEqual(parseRetrieveMode("unknown"), "auto");
  });

  test("lists the objects whose file a retrieve can write", () => {
    assert.deepStrictEqual(
      candidateObjectNames([
        { memberType: "CustomObject", memberName: "Acme__c" },
        { memberType: "CustomField", memberName: "Account.Flag__c" },
        { memberType: "ListView", memberName: "Account.All" },
        { memberType: "ApexClass", memberName: "MyClass" },
        { memberType: "CustomField", memberName: "*" },
      ]),
      ["Acme__c", "Account"],
    );
  });

  test("reads the objects the empty items cleaning removed", () => {
    assert.deepStrictEqual(
      removedEmptyObjectNames({
        status: 0,
        result: {
          removed: [
            {
              type: "CustomObject",
              file: "C:\\repo\\force-app\\main\\default\\objects\\Account\\Account.object-meta.xml",
            },
            {
              type: "SharingRules",
              file: "force-app/main/default/sharingRules/Acme__c.sharingRules-meta.xml",
            },
          ],
        },
      }),
      ["Account"],
    );
    assert.deepStrictEqual(removedEmptyObjectNames({ status: 1 }), []);
  });

  test("merges two outcomes, and a failed call fails only its own items", () => {
    const merged = mergeRetrieveOutcomes([
      {
        success: true,
        files: [{ state: "Changed", type: "PermissionSet", fullName: "Crew" }],
        messages: [],
      },
      failedOutcome([ITEMS[0]], "boom"),
    ]);
    assert.strictEqual(merged.success, false);
    assert.deepStrictEqual(
      merged.files.map((file) => `${file.state}:${file.fullName}`),
      ["Changed:Crew", "Failed:Admin"],
    );
    assert.strictEqual(merged.messages[0].problem, "boom");
  });
});
