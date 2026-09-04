import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  LOCALES,
  REPO_ROOT,
  loadLocale,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * Contract tests for the READ-ONLY value of a configuration setting
 * (Global Pipeline Settings, branch settings, Extension Settings).
 *
 * The bug they lock down: a setting that WAS configured used to be printed
 * with the SLDS "weak" text color, the very color of the row help text and of
 * the "Not defined" placeholder. Only booleans (status pill) and arrays
 * (chips) were readable, so the panel looked like it had no values at all.
 *
 * The LWC bundle cannot run in the extension test host, so the rendering
 * contract is asserted on the component sources, while the pure helpers of
 * s/configValueUtils are evaluated for real.
 */

/** Loads the pure helpers of s/configValueUtils as a plain object. */
function loadConfigValueUtils(): any {
  const source = readModuleFile("configValueUtils", "configValueUtils.js")
    // The module is authored as an ES module for the LWC compiler; the test
    // host only needs its (side-effect free) function bodies.
    .replace(/^export /gm, "");
  const factory = new Function(
    `${source}
    return { BRANCH_NAME_KEYS, isBranchNameKey, configChipClass, isUrlConfigValue,
             isEmptyConfigValue, isTechnicalConfigValue, formatConfigValue,
             configValueClass, formatConfigDefault };`,
  );
  return factory();
}

suite("Configuration value display contract", () => {
  const html = readModuleFile("pipelineConfig", "pipelineConfig.html");
  const js = readModuleFile("pipelineConfig", "pipelineConfig.js");
  const css = readModuleFile("pipelineConfig", "pipelineConfig.css");
  const globalTheme = fs.readFileSync(
    path.join(REPO_ROOT, "resources", "global-theme.css"),
    "utf8",
  );

  // The read-only branch of a field row: from the view-mode template holding
  // the boolean pill, down to the "inherited" chip that closes it.
  const viewBlockStart = html.lastIndexOf(
    "<template if:false={isEditMode}>",
    html.indexOf("{entry.booleanPillLabel}"),
  );
  const viewBlock = html.substring(
    viewBlockStart,
    html.indexOf("</div>", html.indexOf("{i18n.inherited}", viewBlockStart)),
  );

  test("the read-only block of a field row was located", () => {
    assert.ok(viewBlockStart > 0, "view-mode block not found in the template");
    assert.ok(
      viewBlock.length > 500 && viewBlock.includes("{i18n.notDefined}"),
      "the extracted view-mode block does not look like the value renderer",
    );
  });

  test("a configured value is never printed with the muted help-text color", () => {
    assert.ok(
      !viewBlock.includes("slds-text-color_weak"),
      "a value must not reuse the color of the row help text and of the " +
        '"Not defined" placeholder: it made a configured setting look empty',
    );
    // Text and number values use the strong, theme-aware kit class
    assert.ok(
      viewBlock.includes("class={entry.valueClass}"),
      "scalar values must be rendered with the computed .hardis-field-value class",
    );
    assert.ok(
      globalTheme.includes(".hardis-field-value {"),
      "global-theme.css must declare the shared .hardis-field-value class",
    );
  });

  test("every value type answers with something readable", () => {
    // Booleans keep their status pill, arrays their chips, and enums now get
    // a chip too instead of a line of grey text
    assert.ok(viewBlock.includes("{entry.booleanPillLabel}"), "boolean pill");
    assert.ok(
      viewBlock.includes("class={entry.chipClass} title={item}"),
      "array values must stay rendered as chips",
    );
    assert.ok(
      viewBlock.includes(
        "<span class={entry.chipClass} title={entry.valueTitle}>{entry.valueText}</span>",
      ),
      "an enum value must be rendered as a chip carrying its raw value in the tooltip",
    );
    // A git branch name reuses the monospace branch chip of the branch arrays
    assert.ok(
      viewBlock.includes('<span class="hardis-branch-chip"'),
      "a scalar branch name must reuse the branch chip of the branch arrays",
    );
    // Every value carries the full text in its tooltip, so a wrapped or
    // truncated one stays reachable
    const rendered = (viewBlock.match(/\{entry\.valueText\}/g) || []).length;
    const tooltipped = (viewBlock.match(/title=\{entry\.valueTitle\}/g) || [])
      .length;
    assert.ok(rendered >= 4, "every scalar type must render entry.valueText");
    assert.strictEqual(
      tooltipped,
      rendered,
      "every rendered value must carry its full text in a tooltip",
    );
  });

  test('one single "Not defined" placeholder drives every field type', () => {
    const occurrences = viewBlock.match(/\{i18n\.notDefined\}/g) || [];
    assert.strictEqual(
      occurrences.length,
      1,
      "the empty state must be rendered once, from entry.hasReadOnlyValue",
    );
    assert.ok(
      viewBlock.includes("<template if:false={entry.hasReadOnlyValue}>"),
      "the empty state must be driven by the computed hasReadOnlyValue flag",
    );
    assert.match(
      js,
      /let hasReadOnlyValue = false;/,
      "hasReadOnlyValue must be computed by the component",
    );
  });

  test("a value nobody configured is marked as the default", () => {
    // The panel receives the schema default in place of a missing value
    // (getEditorInput substitutes it), so without this marker a default is
    // indistinguishable from a deliberate choice
    assert.ok(
      viewBlock.includes("{i18n.defaultValueBadge}"),
      "a defaulted value must be marked as such",
    );
    assert.ok(
      viewBlock.includes("<template if:true={entry.isDefaultValue}>"),
      "the marker must be driven by the computed isDefaultValue flag",
    );
    assert.match(
      js,
      /const isDefaultValue =\s*!isBoolean &&\s*hasReadOnlyValue &&\s*configuredValue === undefined &&\s*formatConfigDefault\(schema, enumNames\) !== "";/,
      "a value is a default only when no configuration file carries it",
    );
    assert.match(
      js,
      /branchConfig && branchConfig\[key\] !== undefined/,
      "the branch file must be checked before the global one",
    );
    // The schema really carries the defaults the panel substitutes
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "resources", "sfdx-hardis.jsonschema.json"),
        "utf8",
      ),
    );
    assert.strictEqual(
      schema.properties.apexTestsMinCoverageOrgWide.default,
      75,
      "the JSON schema must expose the defaults the panel recalls",
    );
    const helper = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "src",
        "utils",
        "pipeline",
        "sfdxHardisConfigHelper.ts",
      ),
      "utf8",
    );
    assert.match(
      helper,
      /default: value\.default,/,
      "the config helper must forward the schema default to the webview",
    );
    assert.match(
      helper,
      /config\[key\] = schemaEntry\.default;/,
      "the panel is fed with the schema default when nothing is configured",
    );
  });

  test("every entry property used by the read-only block is computed", () => {
    const used = new Set<string>();
    for (const match of viewBlock.matchAll(/\{entry\.(\w+)\}/g)) {
      used.add(match[1]);
    }
    assert.ok(
      used.size > 8,
      "the read-only block should use several properties",
    );
    for (const property of used) {
      assert.ok(
        new RegExp(`(^|[\\s{,])${property}[,:\\s]`, "m").test(js),
        `the component never computes entry.${property}`,
      );
    }
  });

  test("branch settings never show an inherited value as [object Object]", () => {
    assert.ok(
      html.includes("{i18n.globalValueLabel} {entry.globalValueDisplay}"),
      "the inherited global value must be printed through the shared formatter",
    );
    assert.match(
      js,
      /const globalValueDisplay = formatConfigValue\(globalValue\);/,
    );
  });

  test("Extension Settings recall the default of an empty free-text setting", () => {
    const extensionHtml = readModuleFile(
      "extensionConfig",
      "extensionConfig.html",
    );
    const extensionJs = readModuleFile("extensionConfig", "extensionConfig.js");
    assert.match(
      extensionJs,
      /const defaultPlaceholder = formatConfigValue\(entry\.default\);/,
      "the placeholder must come from the shared formatter",
    );
    assert.strictEqual(
      (extensionHtml.match(/placeholder=\{entry\.defaultPlaceholder\}/g) || [])
        .length,
      2,
      "the text and the number inputs must both show their default",
    );
  });

  suite("s/configValueUtils helpers", () => {
    const utils = loadConfigValueUtils();

    test("an empty value is recognized whatever its shape", () => {
      for (const empty of [undefined, null, "", "   ", [], {}]) {
        assert.strictEqual(
          utils.isEmptyConfigValue(empty),
          true,
          String(empty),
        );
      }
      for (const filled of [0, false, "x", ["a"], { a: 1 }]) {
        assert.strictEqual(
          utils.isEmptyConfigValue(filled),
          false,
          JSON.stringify(filled),
        );
      }
    });

    test("technical strings are the only ones rendered in monospace", () => {
      for (const technical of [
        "^[A-Z]{2,}-\\d+$",
        // A regular expression stays technical even when it holds a space
        "^CRM-[0-9]+ .*",
        "CRM-[0-9]+",
        "force-app/main/default",
        "MyClass.cls",
      ]) {
        assert.strictEqual(
          utils.isTechnicalConfigValue(technical),
          true,
          technical,
        );
        assert.strictEqual(
          utils.configValueClass(technical),
          "hardis-field-value mono",
        );
      }
      for (const prose of [
        "integration",
        "Sandbox Orgs",
        // A sentence holding a parenthesis is prose, not a pattern
        "New features and enhancements (BUILD)",
        "CRM-1042 Account hierarchy",
        42,
        undefined,
      ]) {
        assert.strictEqual(
          utils.isTechnicalConfigValue(prose),
          false,
          String(prose),
        );
        assert.strictEqual(utils.configValueClass(prose), "hardis-field-value");
      }
    });

    test("values are printed, never left as [object Object]", () => {
      assert.strictEqual(utils.formatConfigValue(["a", "b"]), "a, b");
      assert.strictEqual(utils.formatConfigValue({ a: 1 }), '{"a":1}');
      assert.strictEqual(utils.formatConfigValue(0), "0");
      assert.strictEqual(utils.formatConfigValue(false), "false");
      assert.strictEqual(utils.formatConfigValue(undefined), "");
    });

    test("git branch values reuse the monospace branch chip", () => {
      for (const key of [
        "mergeTargets",
        "availableTargetBranches",
        "developmentBranch",
      ]) {
        assert.strictEqual(utils.configChipClass(key), "hardis-branch-chip");
      }
      assert.strictEqual(
        utils.configChipClass("allowedOrgTypes"),
        "hardis-chip",
      );
    });

    test("only a default that tells something is recalled", () => {
      assert.strictEqual(utils.formatConfigDefault({ default: 75 }), "75");
      assert.strictEqual(utils.formatConfigDefault({ default: "" }), "");
      assert.strictEqual(utils.formatConfigDefault({ default: [] }), "");
      assert.strictEqual(utils.formatConfigDefault({ default: { a: 1 } }), "");
      assert.strictEqual(utils.formatConfigDefault(null), "");
      // An enum default is recalled with its human label, not its raw value
      assert.strictEqual(
        utils.formatConfigDefault(
          { default: "externalFile", enum: ["externalFile", "sfdxHardis"] },
          ["External file", "sfdx-hardis"],
        ),
        "External file",
      );
    });

    test("http(s) values are the ones turned into a link", () => {
      assert.strictEqual(utils.isUrlConfigValue("https://example.com"), true);
      assert.strictEqual(utils.isUrlConfigValue(" http://a.b "), true);
      assert.strictEqual(utils.isUrlConfigValue("integration"), false);
      assert.strictEqual(utils.isUrlConfigValue(42), false);
    });
  });

  test("the value classes are declared once, in the shared kit", () => {
    for (const className of [
      "hardis-field-value",
      "hardis-not-set",
      "hardis-field-default",
      "hardis-url-link",
    ]) {
      assert.ok(
        globalTheme.includes(`.${className}`),
        `global-theme.css must own .${className}`,
      );
      assert.ok(
        !css.includes(`.${className} {`),
        `pipelineConfig.css must not redefine .${className}`,
      );
    }
  });

  test("the value styles are theme-aware", () => {
    for (const stylesheet of [
      css,
      readModuleFile("extensionConfig", "extensionConfig.css"),
    ]) {
      assert.doesNotMatch(
        stylesheet,
        /#[0-9a-fA-F]{3,8}\b|rgba?\(|color:\s*(white|black)/,
        "colors must come from the hardis kit, so both VS Code themes render",
      );
    }
    // The shared rules paint with palette tokens and never per theme
    const valueRule = globalTheme.substring(
      globalTheme.indexOf(".hardis-field-value {"),
      globalTheme.indexOf(".hardis-url-link {"),
    );
    assert.ok(valueRule.length > 100, "the value rules were not found");
    assert.doesNotMatch(
      valueRule,
      /#[0-9a-fA-F]{3,8}\b|rgba?\(|\[data-theme=/,
      "the value rules must use palette tokens, not colors nor per-theme copies",
    );
    assert.match(valueRule, /var\(--slds-g-color-neutral-base-10\)/);
  });

  test('the "Default" marker is translated in the 9 locales', () => {
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      for (const key of ["defaultValueBadge", "defaultValueTooltip"]) {
        assert.ok(
          typeof translations[key] === "string" && translations[key].length > 0,
          `missing i18n key "${key}" in ${locale}.json`,
        );
      }
    }
  });

  test("every i18n key of the settings panel exists in the 9 locales", () => {
    const usedKeys = new Set<string>();
    for (const match of html.matchAll(/\{i18n\.(\w+)\}/g)) {
      usedKeys.add(match[1]);
    }
    for (const match of js.matchAll(/this\.i18n\.(\w+)/g)) {
      usedKeys.add(match[1]);
    }
    assert.ok(usedKeys.size > 10, "the panel must be fully translated");
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      for (const key of usedKeys) {
        assert.ok(
          typeof translations[key] === "string" && translations[key].length > 0,
          `missing i18n key "${key}" in ${locale}.json`,
        );
      }
    }
  });
});
