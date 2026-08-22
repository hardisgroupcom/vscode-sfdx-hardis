import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { MODULES_DIR, REPO_ROOT, readModuleFile } from "./lwcSourceUtils";

/**
 * Contract tests for the colored pills displayed in the datatables
 * (statusPill / typePill cell types of s/hardisDatatable).
 *
 * The LWC webview bundle cannot be executed in this test host, so these tests
 * verify the contract statically from the source files:
 *  - every hue s/pillUtils can produce has a theme-aware rule in
 *    resources/global-theme.css (a missing hue renders an invisible pill)
 *  - the pill templates carry no hardcoded color
 *  - each column bound to a pill field is fed by a row property that the
 *    component actually computes (a typo would render colorless pills)
 */

suite("Datatable colored pills contract", () => {
  const globalTheme = fs.readFileSync(
    path.join(REPO_ROOT, "resources", "global-theme.css"),
    "utf8",
  );

  test("every hue produced by pillUtils is declared in global-theme.css", () => {
    const pillUtils = readModuleFile("pillUtils", "pillUtils.js");
    const deploymentActionUtils = readModuleFile(
      "deploymentActionUtils",
      "deploymentActionUtils.js",
    );
    // Hues are passed to getPillClass() as plain strings: collect them from
    // the fallback list and from every hue map of the shared modules
    const hues = new Set<string>();
    for (const source of [pillUtils, deploymentActionUtils]) {
      const huesBlock = source.match(
        /(FALLBACK_HUES|METADATA_CATEGORY_HUE|TYPE_HUE_BY_CODE|WHEN_HUE_BY_CODE|CONTEXT_HUE_BY_CODE)\s*=\s*[[{][\s\S]*?[\]}];/g,
      );
      assert.ok(huesBlock, "hue declarations should be found in the module");
      for (const block of huesBlock) {
        for (const [, hue] of block.matchAll(/"([a-z]+)"/g)) {
          hues.add(hue);
        }
      }
    }
    // getPillClass() defaults to slate when no hue is given
    hues.add("slate");
    assert.ok(hues.size > 5, "several hues should have been collected");
    for (const hue of hues) {
      assert.ok(
        globalTheme.includes(`.hardis-pill.hardis-hue-${hue} {`),
        `global-theme.css should declare the .hardis-hue-${hue} pill variant`,
      );
    }
  });

  test("pill templates carry no hardcoded color", () => {
    for (const template of ["typePill.html", "statusPill.html"]) {
      const html = readModuleFile("hardisDatatable", template);
      assert.doesNotMatch(
        html,
        /#[0-9a-fA-F]{3,8}\b|rgb\(|color:\s*white/,
        `${template} should get its colors from the theme classes only`,
      );
    }
  });

  test("hardisDatatable exposes the typePill cell type", () => {
    const datatable = readModuleFile("hardisDatatable", "hardisDatatable.js");
    assert.match(
      datatable,
      /typePill:\s*\{[\s\S]*?typeAttributes:\s*\[[^\]]*"pillClass"[^\]]*"iconName"[^\]]*\]/,
      "hardisDatatable should register typePill with its pillClass and iconName attributes",
    );
  });

  test("hardisDatatable shows the full cell value on hover", () => {
    const datatable = readModuleFile("hardisDatatable", "hardisDatatable.js");
    assert.match(
      datatable,
      /addEventListener\("mouseover",\s*this\._onCellMouseOver\)/,
      "hardisDatatable should listen to mouseover to expose cell values",
    );
    assert.match(
      datatable,
      /removeEventListener\("mouseover",\s*this\._onCellMouseOver\)/,
      "hardisDatatable should drop the mouseover listener when disconnected",
    );
    assert.match(
      datatable,
      /cell\.setAttribute\("title",\s*text\)/,
      "hardisDatatable should set the hovered cell title to its full text",
    );
  });

  test("pipeline ticket and deployment action rows compute their pill fields", () => {
    const pipeline = readModuleFile("pipeline", "pipeline.js");
    // Fields referenced by the ticket / action / author columns
    for (const field of [
      "statusPillClass",
      "typePillClass",
      "whenPillClass",
      "authorInitials",
      "authorAvatarClass",
    ]) {
      assert.match(
        pipeline,
        new RegExp(`fieldName:\\s*"${field}"`),
        `a pipeline column should bind the ${field} row field`,
      );
      assert.match(
        pipeline,
        new RegExp(`${field}:\\s`),
        `pipeline.js should compute the ${field} row field`,
      );
    }
  });

  test("pipeline settings deployment action rows compute their pill fields", () => {
    const pipelineConfig = readModuleFile(
      "pipelineConfig",
      "pipelineConfig.js",
    );
    for (const field of ["_typePillClass", "_contextPillClass"]) {
      assert.match(
        pipelineConfig,
        new RegExp(`fieldName:\\s*"${field}"`),
        `a Pipeline Settings column should bind the ${field} row field`,
      );
      assert.match(
        pipelineConfig,
        new RegExp(`rowData\\.${field}\\s*=`),
        `pipelineConfig.js should compute the ${field} row field`,
      );
    }
  });

  test("every datatable of the webviews uses the shared s-hardis-datatable", () => {
    const templates = fs
      .readdirSync(MODULES_DIR)
      .map((module) => path.join(MODULES_DIR, module, `${module}.html`))
      .filter((file) => fs.existsSync(file));
    for (const template of templates) {
      assert.doesNotMatch(
        fs.readFileSync(template, "utf8"),
        /<lightning-datatable/,
        `${path.basename(template)} should use <s-hardis-datatable> so every table shares the same cell types and behaviors`,
      );
    }
  });

  test("metadata retriever marks the change operation with icons, not emoji", () => {
    const retriever = readModuleFile(
      "metadataRetriever",
      "metadataRetriever.js",
    );
    // The created/modified/deleted marker moved in front of the metadata name
    assert.doesNotMatch(
      retriever,
      /ChangeIcon/,
      "the standalone emoji operation column should be gone",
    );
    assert.match(
      retriever,
      /iconName:\s*\{\s*fieldName:\s*"OperationIconName"\s*\}/,
      "the metadata name column should carry the operation icon",
    );
    // Deleted rows drive the retrieval behavior: the flag must be a real
    // boolean, never a comparison against a rendered emoji
    assert.match(
      retriever,
      /IsDeleted:\s/,
      "rows should expose an explicit IsDeleted flag",
    );
    for (const cssClass of [
      "hardis-op-created",
      "hardis-op-modified",
      "hardis-op-deleted",
      "hardis-op-local-yes",
      "hardis-op-local-no",
    ]) {
      assert.ok(
        globalTheme.includes(`.${cssClass} svg {`),
        `global-theme.css should color the ${cssClass} marker icon`,
      );
    }
  });

  test("metadata retriever computes the pill class of each metadata type", () => {
    const retriever = readModuleFile(
      "metadataRetriever",
      "metadataRetriever.js",
    );
    assert.match(
      retriever,
      /pillClass:\s*\{\s*fieldName:\s*"MemberTypePillClass"\s*\}/,
      "the metadata type column should bind MemberTypePillClass",
    );
    assert.match(
      retriever,
      /MemberTypePillClass:\s*getMetadataTypePillClass\(/,
      "metadataRetriever.js should compute MemberTypePillClass from the metadata type",
    );
  });
});
