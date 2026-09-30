import * as assert from "assert";
import {
  buildMetadataDepsCommand,
  lastResultKey,
  quote,
} from "../../commands/showMetadataDependencies";

suite("Metadata Dependencies command line", () => {
  test("quotes values for cmd.exe on Windows", () => {
    assert.strictEqual(quote("unfiled$public", "win32"), '"unfiled$public"');
    assert.strictEqual(quote('My "Report"', "win32"), '"My \\"Report\\""');
  });

  test("quotes values in single quotes elsewhere, so $ and backticks stay literal", () => {
    assert.strictEqual(quote("unfiled$public", "linux"), "'unfiled$public'");
    assert.strictEqual(quote("a`b`", "darwin"), "'a`b`'");
    assert.strictEqual(quote("it's", "linux"), "'it'\\''s'");
  });

  test("passes the direction and the report switch as flags", () => {
    const command = buildMetadataDepsCommand(
      { type: "ApexClass", name: "MyClass", direction: "uses" },
      "user@acme.com",
      { skipReport: true },
    );
    assert.ok(command.startsWith("sf hardis:doc:metadata-deps "));
    assert.ok(command.includes("--direction uses"));
    assert.ok(command.includes("--agent"));
    assert.ok(command.includes("--skip-report"));
    const usedBy = buildMetadataDepsCommand(
      { type: "ApexClass", name: "MyClass" },
      null,
      { skipReport: false },
    );
    assert.ok(!usedBy.includes("--direction"));
    assert.ok(!usedBy.includes("--target-org"));
    assert.ok(!usedBy.includes("--skip-report"));
  });

  test("keys the last result on the org, the component and the direction", () => {
    const query = { type: "ApexClass", name: "MyClass" };
    assert.strictEqual(lastResultKey(query, null), null);
    assert.strictEqual(
      lastResultKey(query, "user@acme.com"),
      lastResultKey({ ...query, direction: "used-by" }, "user@acme.com"),
    );
    assert.notStrictEqual(
      lastResultKey(query, "user@acme.com"),
      lastResultKey({ ...query, direction: "uses" }, "user@acme.com"),
    );
    assert.notStrictEqual(
      lastResultKey(query, "user@acme.com"),
      lastResultKey(query, "other@acme.com"),
    );
  });
});
