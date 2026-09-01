import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT, readModuleFile } from "./lwcSourceUtils";

/**
 * The Documentation Settings panel offers the monitoring auto-deployment
 * targets. They come from the sfdx-hardis JSON schema, which gains new ones
 * over time: docDeployToConfluence existed in the schema for a while but was
 * offered by neither list, so the option was simply unreachable from the UI.
 */
suite("Documentation config fields contract", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "resources", "sfdx-hardis.jsonschema.json"),
      "utf8",
    ),
  );
  const schemaDeployFields = Object.keys(schema.properties || {})
    .filter((key) => key.startsWith("docDeployTo"))
    .sort();

  test("the schema still declares documentation deployment targets", () => {
    assert.ok(
      schemaDeployFields.length > 0,
      "no docDeployTo* property found in the schema",
    );
  });

  test("every deployment target of the schema is loaded by the panel", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src", "commands", "showDocumentationWorkbench.ts"),
      "utf8",
    );
    const missing = schemaDeployFields.filter(
      (field) => !source.includes(`"${field}"`),
    );
    assert.deepStrictEqual(
      missing,
      [],
      "these schema fields are not read by showDocumentationWorkbench.ts",
    );
  });

  test("every deployment target of the schema is displayed by the editor", () => {
    const source = readModuleFile(
      "documentationConfig",
      "documentationConfig.js",
    );
    const missing = schemaDeployFields.filter(
      (field) => !source.includes(`"${field}"`),
    );
    assert.deepStrictEqual(
      missing,
      [],
      "these schema fields are not shown in the Documentation Settings panel",
    );
  });

  test("Confluence is one of the offered targets", () => {
    // Regression guard: deploying documentation to Confluence is supported by
    // the CLI and by the Documentation Workbench, so its monitoring toggle must
    // be reachable too
    assert.ok(
      schemaDeployFields.includes("docDeployToConfluence"),
      "docDeployToConfluence disappeared from the schema",
    );
  });
});
