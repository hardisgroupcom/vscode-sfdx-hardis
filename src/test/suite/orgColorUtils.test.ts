import * as assert from "assert";
import {
  buildCustomHue,
  buildOrgColorCustomizations,
  contrastRatio,
  ensureContrast,
  isValidHexColor,
  MANAGED_COLOR_KEYS,
  matchCustomOrgColor,
  mixColors,
  ORG_HUES,
  OrgColorKind,
  readableForegroundFor,
  resolveOrgHue,
  shortenOrgHost,
  ThemeVariant,
} from "../../utils/orgColorUtils";

const ORG_KINDS: OrgColorKind[] = [
  "production",
  "major",
  "sandbox",
  "scratch",
  "dev",
];
const VARIANTS: ThemeVariant[] = ["light", "dark"];

suite("orgColorUtils Test Suite", () => {
  test("parses and validates hexadecimal colors", () => {
    assert.strictEqual(isValidHexColor("#ba0517"), true);
    assert.strictEqual(isValidHexColor("#abc"), true);
    assert.strictEqual(isValidHexColor("ba0517"), false);
    assert.strictEqual(isValidHexColor("#zzzzzz"), false);
    assert.strictEqual(isValidHexColor(""), false);
  });

  test("computes WCAG contrast ratios", () => {
    assert.ok(contrastRatio("#ffffff", "#000000") > 20);
    assert.ok(contrastRatio("#ffffff", "#ffffff") < 1.01);
  });

  test("picks a readable foreground for every org strong color", () => {
    for (const kind of ORG_KINDS) {
      const strong = ORG_HUES[kind].strong;
      const foreground = readableForegroundFor(strong);
      assert.ok(
        contrastRatio(foreground, strong) >= 4.5,
        `${kind} status bar text is not readable`,
      );
    }
  });

  test("every org hue keeps its text readable on its container", () => {
    for (const kind of ORG_KINDS) {
      for (const variant of VARIANTS) {
        const hue = ORG_HUES[kind];
        assert.ok(
          contrastRatio(hue.text[variant], hue.container[variant]) >= 4.5,
          `${kind} ${variant} text is not readable on its container`,
        );
        assert.ok(
          contrastRatio(hue.accent[variant], hue.container[variant]) >= 3,
          `${kind} ${variant} accent is not visible on its container`,
        );
      }
    }
  });

  test("mixes colors and forces contrast when needed", () => {
    assert.strictEqual(mixColors("#000000", "#ffffff", 0.5), "#808080");
    assert.strictEqual(mixColors("#000000", "#ffffff", 0), "#000000");
    const fixed = ensureContrast("#fefefe", "#ffffff", 4.5);
    assert.ok(contrastRatio(fixed, "#ffffff") >= 4.5);
  });

  test("derives a readable hue from a custom color", () => {
    const hue = buildCustomHue("#7526e3");
    assert.ok(hue);
    for (const variant of VARIANTS) {
      assert.ok(
        contrastRatio(hue!.text[variant], hue!.container[variant]) >= 4.5,
        `custom ${variant} text is not readable`,
      );
    }
    assert.strictEqual(buildCustomHue("not-a-color"), null);
  });

  test("custom color takes priority over the org type hue", () => {
    assert.strictEqual(resolveOrgHue("production", "#7526e3")?.strong, "#7526e3");
    assert.strictEqual(
      resolveOrgHue("production", null)?.strong,
      ORG_HUES.production.strong,
    );
    assert.strictEqual(resolveOrgHue(null, null), null);
    // An invalid custom color falls back to the org type hue
    assert.strictEqual(
      resolveOrgHue("dev", "oops")?.strong,
      ORG_HUES.dev.strong,
    );
  });

  test("each mode paints an increasing set of known keys", () => {
    const hue = ORG_HUES.production;
    const off = buildOrgColorCustomizations(hue, "off", "dark");
    const accent = buildOrgColorCustomizations(hue, "accent", "dark");
    const tinted = buildOrgColorCustomizations(hue, "tinted", "dark");
    const full = buildOrgColorCustomizations(hue, "full", "dark");
    assert.deepStrictEqual(off, {});
    assert.ok(Object.keys(accent).length > 0);
    assert.ok(Object.keys(tinted).length > Object.keys(accent).length);
    assert.ok(Object.keys(full).length > Object.keys(tinted).length);
    // accent must not fill the large surfaces
    assert.strictEqual(accent["activityBar.background"], undefined);
    assert.strictEqual(accent["titleBar.activeBackground"], undefined);
    assert.strictEqual(tinted["activityBar.background"], undefined);
    assert.ok(full["activityBar.background"]);
    for (const key of Object.keys(full)) {
      assert.ok(
        MANAGED_COLOR_KEYS.includes(key),
        `${key} is written but not declared as a managed key`,
      );
    }
  });

  test("no background is ever written without a readable foreground", () => {
    const pairs = [
      ["statusBar.background", "statusBar.foreground", 4.5],
      ["activityBarBadge.background", "activityBarBadge.foreground", 4.5],
      ["titleBar.activeBackground", "titleBar.activeForeground", 4.5],
      ["activityBar.background", "activityBar.foreground", 4.5],
      ["activityBar.background", "activityBar.inactiveForeground", 3],
      ["titleBar.inactiveBackground", "titleBar.inactiveForeground", 3],
    ] as [string, string, number][];
    for (const kind of ORG_KINDS) {
      for (const variant of VARIANTS) {
        const colors = buildOrgColorCustomizations(
          ORG_HUES[kind],
          "full",
          variant,
        );
        for (const [backgroundKey, foregroundKey, target] of pairs) {
          const background = colors[backgroundKey];
          const foreground = colors[foregroundKey];
          assert.ok(background, `${backgroundKey} is missing`);
          assert.ok(foreground, `${foregroundKey} is missing`);
          assert.ok(
            contrastRatio(foreground, background) >= target,
            `${kind}/${variant}: ${foregroundKey} unreadable on ${backgroundKey}`,
          );
        }
      }
    }
  });

  test("light and dark variants produce different container colors", () => {
    for (const kind of ORG_KINDS) {
      const light = buildOrgColorCustomizations(ORG_HUES[kind], "full", "light");
      const dark = buildOrgColorCustomizations(ORG_HUES[kind], "full", "dark");
      assert.notStrictEqual(
        light["activityBar.background"],
        dark["activityBar.background"],
        `${kind} does not adapt to the theme kind`,
      );
    }
  });

  test("shortens org hosts for the status bar badge", () => {
    assert.strictEqual(
      shortenOrgHost("https://acme--dev.sandbox.my.salesforce.com"),
      "acme--dev",
    );
    assert.strictEqual(
      shortenOrgHost("https://acme.my.salesforce.com/"),
      "acme",
    );
    assert.strictEqual(
      shortenOrgHost("https://dev-nv.scratch.my.salesforce.com"),
      "dev-nv",
    );
    assert.strictEqual(
      shortenOrgHost("https://acme.lightning.force.com"),
      "acme",
    );
    // Unknown suffixes and malformed urls degrade gracefully
    assert.strictEqual(
      shortenOrgHost("https://my.custom-domain.example.org"),
      "my.custom-domain.example.org",
    );
    assert.strictEqual(shortenOrgHost("acme.my.salesforce.com"), "acme");
    assert.strictEqual(shortenOrgHost(""), "");
  });

  test("matches custom org colors, exact before wildcard", () => {
    const customOrgColors = {
      "https://myorg.my.salesforce.com": "#111111",
      "https://*.scratch.my.salesforce.com": "#222222",
    };
    assert.strictEqual(
      matchCustomOrgColor("https://myorg.my.salesforce.com", customOrgColors)
        .color,
      "#111111",
    );
    assert.strictEqual(
      matchCustomOrgColor(
        "https://dev-nv.scratch.my.salesforce.com/",
        customOrgColors,
      ).color,
      "#222222",
    );
    assert.strictEqual(
      matchCustomOrgColor("https://other.my.salesforce.com", customOrgColors)
        .color,
      null,
    );
    assert.strictEqual(matchCustomOrgColor("", customOrgColors).color, null);
  });

  test("reports invalid custom org color patterns", () => {
    assert.strictEqual(
      matchCustomOrgColor("https://myorg.my.salesforce.com", {
        "not an url": "#111111",
      }).hasInvalidPattern,
      true,
    );
    assert.strictEqual(
      matchCustomOrgColor("https://myorg.my.salesforce.com", {
        "https://myorg.my.salesforce.com": "#111111",
      }).hasInvalidPattern,
      false,
    );
  });
});
