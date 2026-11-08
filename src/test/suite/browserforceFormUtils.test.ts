import * as assert from "assert";
import { readModuleFile } from "./lwcSourceUtils";

/**
 * The form model of the Browserforce setting editor (s/browserforceFormUtils): built from the
 * fields and groups of the catalog, and turned back into the setting value. The module has no
 * import: its source is evaluated here and run for real.
 */

function loadFormUtils(): any {
  const source = readModuleFile(
    "browserforceFormUtils",
    "browserforceFormUtils.js",
  );
  assert.ok(!/^import /m.test(source), "the module must stay free of imports");
  const exported = [
    ...source.matchAll(/^export (?:function|const) (\w+)/gm),
  ].map((match) => match[1]);
  const body =
    source.replace(/^export /gm, "") + `\nreturn { ${exported.join(", ")} };`;
  return new Function(body)();
}

const PORTAL_ENTRY = {
  key: "customerPortal",
  groups: [{ path: "portals[]", kind: "array" }],
  fields: [
    {
      path: "enabled",
      type: "boolean",
      required: false,
      isPassword: false,
      isIrreversible: true,
    },
    {
      path: "portals[].name",
      group: "portals[]",
      type: "string",
      required: true,
      isPassword: false,
      isIrreversible: false,
    },
    {
      path: "portals[].maxUsers",
      group: "portals[]",
      type: "integer",
      required: false,
      isPassword: false,
      isIrreversible: false,
    },
  ],
  examples: [{ enabled: true, portals: [{ name: "Customer" }] }],
};

const AUTH_ENTRY = {
  key: "authProviders",
  groups: [{ path: "*", kind: "record", keyPattern: "^[A-Za-z_]+$" }],
  fields: [
    {
      path: "*.consumerKey",
      group: "*",
      type: "string",
      required: true,
      isPassword: false,
      isIrreversible: false,
    },
    {
      path: "*.consumerSecret",
      group: "*",
      type: "string",
      required: true,
      isPassword: true,
      isIrreversible: false,
    },
  ],
  examples: [],
};

const ROOT_ARRAY_ENTRY = {
  key: "communities",
  groups: [{ path: "[]", kind: "array" }],
  fields: [
    {
      path: "[].name",
      group: "[]",
      type: "string",
      required: true,
      isPassword: false,
      isIrreversible: false,
    },
    {
      path: "[].tags",
      group: "[]",
      type: "string[]",
      required: false,
      isPassword: false,
      isIrreversible: false,
    },
  ],
  examples: [],
};

suite("Browserforce form utils", () => {
  const utils = loadFormUtils();

  test("a value goes through the form unchanged, unknown keys included", () => {
    const config = {
      enabled: true,
      portals: [{ name: "Customer", maxUsers: 10, extra: "kept" }],
      other: { a: 1 },
    };
    const model = utils.configToFormModel(PORTAL_ENTRY, config);
    const { config: back, errors } = utils.formModelToConfig(
      PORTAL_ENTRY,
      model,
    );
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(back, config);
  });

  test("array items are added, edited and removed", () => {
    let model = utils.configToFormModel(PORTAL_ENTRY, { portals: [] });
    model = utils.addGroupItem(PORTAL_ENTRY, model, "portals[]");
    model = utils.updateFieldState(
      model,
      utils.fieldStateKey("portals[]", 0, "name"),
      { text: "Partners" },
    );
    model = utils.updateFieldState(
      model,
      utils.fieldStateKey("portals[]", 0, "maxUsers"),
      { text: "25" },
    );
    assert.deepStrictEqual(
      utils.formModelToConfig(PORTAL_ENTRY, model).config,
      {
        portals: [{ name: "Partners", maxUsers: 25 }],
      },
    );
    model = utils.removeGroupItem(model, "portals[]", 0);
    assert.deepStrictEqual(
      utils.formModelToConfig(PORTAL_ENTRY, model).config,
      {
        portals: [],
      },
    );
  });

  test("an invalid number is reported and keeps the previous value", () => {
    let model = utils.configToFormModel(PORTAL_ENTRY, {
      portals: [{ name: "A", maxUsers: 3 }],
    });
    const key = utils.fieldStateKey("portals[]", 0, "maxUsers");
    model = utils.updateFieldState(model, key, { text: "2.5" });
    const { config, errors } = utils.formModelToConfig(PORTAL_ENTRY, model);
    assert.deepStrictEqual(errors, [{ key, code: "invalidNumber" }]);
    assert.deepStrictEqual(config.portals[0].maxUsers, 3);
  });

  test("a setting keyed by name keeps its entries, and a password is a CI/CD variable", () => {
    const config = {
      MyProvider: { consumerKey: "abc", consumerSecret: "${MY_SECRET}" },
    };
    let model = utils.configToFormModel(AUTH_ENTRY, config);
    assert.deepStrictEqual(
      utils.formModelToConfig(AUTH_ENTRY, model).config,
      config,
    );
    model = utils.setEntryName(model, "*", 0, "Other_Provider");
    model = utils.updateFieldState(
      model,
      utils.fieldStateKey("*", 0, "consumerSecret"),
      { variable: "OTHER_SECRET" },
    );
    assert.deepStrictEqual(utils.formModelToConfig(AUTH_ENTRY, model).config, {
      Other_Provider: { consumerKey: "abc", consumerSecret: "${OTHER_SECRET}" },
    });
    const sections = utils.buildFormSections(AUTH_ENTRY, model, []);
    const secretField = sections[0].items[0].fields[1];
    assert.strictEqual(secretField.showVariableInput, true);
    assert.strictEqual(secretField.canToggleVariable, false);
  });

  test("entry names are checked against the pattern and for duplicates", () => {
    let model = utils.configToFormModel(AUTH_ENTRY, {
      A: { consumerKey: "1" },
      B: { consumerKey: "2" },
    });
    model = utils.setEntryName(model, "*", 1, "A");
    model = utils.addGroupItem(AUTH_ENTRY, model, "*");
    model = utils.setEntryName(model, "*", 2, "not valid!");
    const codes = utils
      .formModelToConfig(AUTH_ENTRY, model)
      .errors.map((error: any) => error.code);
    assert.deepStrictEqual(codes, ["duplicateEntryName", "invalidEntryName"]);
  });

  test("any field can become a value per org, and a bad variable name is reported", () => {
    let model = utils.configToFormModel(PORTAL_ENTRY, { enabled: false });
    const key = utils.fieldStateKey("", -1, "enabled");
    model = utils.updateFieldState(model, key, {
      isVariable: true,
      variable: "PORTAL_ENABLED",
    });
    assert.deepStrictEqual(
      utils.formModelToConfig(PORTAL_ENTRY, model).config,
      {
        enabled: "${PORTAL_ENABLED}",
      },
    );
    model = utils.updateFieldState(model, key, { variable: "1BAD" });
    assert.strictEqual(
      utils.formModelToConfig(PORTAL_ENTRY, model).errors[0].code,
      "invalidVariableName",
    );
  });

  test("a setting that is itself an array, with a list of strings", () => {
    const config = [{ name: "Portal", tags: ["a", "b"] }];
    let model = utils.configToFormModel(ROOT_ARRAY_ENTRY, config);
    assert.deepStrictEqual(
      utils.formModelToConfig(ROOT_ARRAY_ENTRY, model).config,
      config,
    );
    model = utils.updateFieldState(
      model,
      utils.fieldStateKey("[]", 0, "tags"),
      { text: "a\n\n c \n" },
    );
    assert.deepStrictEqual(
      utils.formModelToConfig(ROOT_ARRAY_ENTRY, model).config,
      [{ name: "Portal", tags: ["a", "c"] }],
    );
    assert.deepStrictEqual(utils.defaultConfigOf(ROOT_ARRAY_ENTRY), []);
  });

  test("an emptied optional field is removed with the objects it leaves empty", () => {
    const entry = {
      key: "nested",
      groups: [],
      fields: [
        {
          path: "a.b.c",
          type: "string",
          required: false,
          isPassword: false,
          isIrreversible: false,
        },
      ],
      examples: [],
    };
    let model = utils.configToFormModel(entry, { a: { b: { c: "x" } }, d: 1 });
    model = utils.updateFieldState(
      model,
      utils.fieldStateKey("", -1, "a.b.c"),
      { text: "" },
    );
    assert.deepStrictEqual(utils.formModelToConfig(entry, model).config, {
      d: 1,
    });
  });

  test("an optional field never set keeps the objects that were already empty", () => {
    const entry = {
      key: "nested",
      groups: [],
      fields: [
        {
          path: "a.b.c",
          type: "string",
          required: false,
          isPassword: false,
          isIrreversible: false,
        },
        {
          path: "e.f",
          type: "string",
          required: false,
          isPassword: false,
          isIrreversible: false,
        },
      ],
      examples: [],
    };
    const model = utils.configToFormModel(entry, {
      a: { b: {} },
      e: {},
      d: 1,
    });
    assert.deepStrictEqual(utils.formModelToConfig(entry, model).config, {
      a: { b: {} },
      e: {},
      d: 1,
    });
  });

  test("a new setting starts from its first example", () => {
    const config = utils.defaultConfigOf(PORTAL_ENTRY);
    assert.deepStrictEqual(config, PORTAL_ENTRY.examples[0]);
    assert.notStrictEqual(config, PORTAL_ENTRY.examples[0]);
  });

  test("labels are readable words, known acronyms in capitals", () => {
    assert.strictEqual(
      utils.humanizeKey("authProviderApiName"),
      "Auth provider API name",
    );
    assert.strictEqual(
      utils.humanizeKey("services[].objectApiName"),
      "Object API name",
    );
    assert.strictEqual(utils.humanizeKey("SSOEnabled"), "SSO enabled");
    assert.strictEqual(utils.humanizeKey("loginUrl"), "Login URL");
    assert.strictEqual(utils.humanizeKey(""), "");
    const sections = utils.buildFormSections(
      PORTAL_ENTRY,
      utils.configToFormModel(PORTAL_ENTRY, { portals: [{ name: "B2B" }] }),
      [],
    );
    const nameField = sections[1].items[0].fields[0];
    assert.strictEqual(nameField.label, "Name");
    assert.strictEqual(nameField.rawKey, "name");
    // An item is told apart by the first text it holds
    assert.strictEqual(sections[1].items[0].summary, "B2B");
  });

  test("fields of nested objects get a section per object", () => {
    const entry = {
      key: "cpq",
      groups: [],
      fields: [
        "enabled",
        "lineEditor.wrapButtons",
        "quote.allowOptionDeletion",
      ].map((path) => ({
        path,
        type: "boolean",
        required: false,
        isPassword: false,
        isIrreversible: false,
      })),
      examples: [],
    };
    const sections = utils.buildFormSections(
      entry,
      utils.configToFormModel(entry, {}),
      [],
    );
    assert.deepStrictEqual(
      sections.map((section: any) => [section.isSubsection, section.title]),
      [
        [false, ""],
        [true, "Line editor"],
        [true, "Quote"],
      ],
    );
  });

  test("a field help says its type, its example and whether it can stay empty", () => {
    const entry = {
      ...PORTAL_ENTRY,
      examples: [{ portals: [{ name: "Customer", maxUsers: 10 }] }],
    };
    const sections = utils.buildFormSections(
      entry,
      utils.configToFormModel(entry, { portals: [{}] }),
      [],
    );
    const [enabled] = sections[0].items[0].fields;
    const [name, maxUsers] = sections[1].items[0].fields;
    assert.strictEqual(enabled.typeHelp, "boolean");
    assert.strictEqual(enabled.isSet, false);
    assert.strictEqual(enabled.canClear, false);
    assert.strictEqual(name.example, "Customer");
    assert.strictEqual(name.required, true);
    assert.strictEqual(maxUsers.typeHelp, "integer");
    assert.strictEqual(maxUsers.example, "10");
  });

  test("a suggested ENV variable name follows the entry name, a typed one stays", () => {
    assert.strictEqual(
      utils.suggestVariableName(
        AUTH_ENTRY,
        AUTH_ENTRY.groups[0],
        { name: "MyProvider" },
        0,
        "consumerSecret",
      ),
      "AUTH_PROVIDERS_MYPROVIDER_CONSUMER_SECRET",
    );
    assert.strictEqual(
      utils.suggestVariableName(
        PORTAL_ENTRY,
        PORTAL_ENTRY.groups[0],
        {},
        1,
        "maxUsers",
      ),
      "CUSTOMER_PORTAL_PORTALS_2_MAX_USERS",
    );
    let model = utils.configToFormModel(AUTH_ENTRY, {});
    model = utils.addGroupItem(AUTH_ENTRY, model, "*");
    model = utils.setEntryName(model, "*", 0, "Partner", AUTH_ENTRY);
    assert.deepStrictEqual(utils.formModelToConfig(AUTH_ENTRY, model).config, {
      Partner: { consumerSecret: "${AUTH_PROVIDERS_PARTNER_CONSUMER_SECRET}" },
    });
    const secretKey = utils.fieldStateKey("*", 0, "consumerSecret");
    model = utils.updateFieldState(model, secretKey, {
      variable: "MY_SECRET",
      variableAuto: false,
    });
    model = utils.setEntryName(model, "*", 0, "Other", AUTH_ENTRY);
    assert.deepStrictEqual(utils.formModelToConfig(AUTH_ENTRY, model).config, {
      Other: { consumerSecret: "${MY_SECRET}" },
    });
  });

  test("ENV variable names are written in capitals", () => {
    assert.strictEqual(utils.isValidVariableName("MY_SECRET_2"), true);
    assert.strictEqual(utils.isValidVariableName("my_secret"), false);
    assert.strictEqual(utils.isValidVariableName("2SECRET"), false);
  });

  test("variables are listed once, in order", () => {
    assert.deepStrictEqual(
      utils.listVariableNames({
        a: "${ONE}",
        b: ["${TWO}", "$${NOT_ONE}", { c: "${ONE}" }],
        d: "text ${THREE}",
      }),
      ["ONE", "TWO"],
    );
  });

  test("settings Browserforce removed are not offered", () => {
    const catalog = {
      plugins: [{ key: "communities" }, { key: "densitySettings" }],
      deprecatedSettings: [
        { path: "communities", reason: "metadata-api", message: "m" },
      ],
    };
    assert.deepStrictEqual(
      utils.listSelectableSettings(catalog).map((plugin: any) => plugin.key),
      ["densitySettings"],
    );
    assert.strictEqual(
      utils.findDeprecatedSetting(catalog, "communities").message,
      "m",
    );
  });
});
