import * as assert from "assert";
import { guessMetadataFromSourceFile } from "../../utils/metadataTypes";

suite("Metadata type and name of a source file", () => {
  const root = "C:\\repo\\force-app\\main\\default";
  const guess = (relative: string) =>
    guessMetadataFromSourceFile(`${root}\\${relative.replace(/\//g, "\\")}`);

  test("reads a field as Object.Field", () => {
    assert.deepStrictEqual(
      guess("objects/Contact/fields/CloudityTerritory__c.field-meta.xml"),
      { type: "CustomField", name: "Contact.CloudityTerritory__c" },
    );
    assert.deepStrictEqual(
      guess("objects/Account/validationRules/My_Rule.validationRule-meta.xml"),
      { type: "ValidationRule", name: "Account.My_Rule" },
    );
  });

  test("reads an object from its own folder", () => {
    assert.deepStrictEqual(
      guess("objects/Invoice__c/Invoice__c.object-meta.xml"),
      { type: "CustomObject", name: "Invoice__c" },
    );
  });

  test("reads Apex, Flows and layouts, from the source or the meta file", () => {
    assert.deepStrictEqual(guess("classes/MyClass.cls"), {
      type: "ApexClass",
      name: "MyClass",
    });
    assert.deepStrictEqual(guess("classes/MyClass.cls-meta.xml"), {
      type: "ApexClass",
      name: "MyClass",
    });
    assert.deepStrictEqual(guess("flows/My_Flow.flow-meta.xml"), {
      type: "Flow",
      name: "My_Flow",
    });
    assert.deepStrictEqual(
      guess("layouts/Account-Account Layout.layout-meta.xml"),
      { type: "Layout", name: "Account-Account Layout" },
    );
  });

  test("reads a bundle from its folder and a report from its folder path", () => {
    assert.deepStrictEqual(guess("lwc/invoiceSummary/invoiceSummary.js"), {
      type: "LightningComponentBundle",
      name: "invoiceSummary",
    });
    assert.deepStrictEqual(guess("reports/Sales/Pipeline.report-meta.xml"), {
      type: "Report",
      name: "Sales/Pipeline",
    });
  });

  test("returns null for a file that is not metadata", () => {
    assert.strictEqual(
      guessMetadataFromSourceFile("C:\\repo\\README.md"),
      null,
    );
    assert.strictEqual(guessMetadataFromSourceFile("/repo/package.json"), null);
  });
});
