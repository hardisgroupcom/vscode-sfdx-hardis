import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT, readModuleFile } from "./lwcSourceUtils";
import { ServiceNowProvider } from "../../utils/ticketProviders/ticketProviderServiceNow";
import { TicketProvider } from "../../utils/ticketProviders/ticketProvider";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";

const LOCALES = ["en", "fr", "es", "de", "it", "nl", "ja", "pl", "pt-BR"];

/**
 * ServiceNow ticketing connector.
 *
 * A ServiceNow record number carries its own table (INC -> incident), so the
 * mapping and the regex built from it are what decides whether a record is
 * detected at all, and where it is read from. They are covered here without
 * any network access.
 */
suite("ServiceNow ticketing provider", () => {
  test("the instance URL is normalized whatever the user typed", () => {
    assert.strictEqual(
      ServiceNowProvider.completeInstanceUrl("acme.service-now.com"),
      "https://acme.service-now.com",
    );
    assert.strictEqual(
      ServiceNowProvider.completeInstanceUrl("https://acme.service-now.com/"),
      "https://acme.service-now.com",
    );
    assert.strictEqual(
      ServiceNowProvider.completeInstanceUrl(
        "  https://acme.service-now.com  ",
      ),
      "https://acme.service-now.com",
    );
    assert.strictEqual(ServiceNowProvider.completeInstanceUrl(""), "");
  });

  test("built-in prefixes resolve to their ServiceNow table", () => {
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("INC0012345"),
      "incident",
    );
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("chg0042000"),
      "change_request",
    );
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("SCTASK0010001"),
      "sc_task",
    );
    // Not a record number: no table, so no dead link is ever built
    assert.strictEqual(ServiceNowProvider.tableOfTicketId("INC123"), null);
    assert.strictEqual(ServiceNowProvider.tableOfTicketId("CRM-1101"), null);
    assert.strictEqual(ServiceNowProvider.tableOfTicketId(""), null);
  });

  test("serviceNowTablePrefixes adds and overrides tables", () => {
    const config = {
      serviceNowTablePrefixes: "STRY:x_acme_story, DEFECT:x_acme_defect",
    };
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("DEFECT0001", config),
      "x_acme_defect",
    );
    // A declared prefix wins over the built-in mapping of the same name
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("STRY0009", config),
      "x_acme_story",
    );
    // The built-in mapping is left untouched for the other prefixes
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("INC0012345", config),
      "incident",
    );
  });

  test("the default regex collects record numbers, alone or inside a URL", () => {
    const regex = new RegExp(ServiceNowProvider.numberRegexSource(), "gim");
    const text = [
      "Fix INC0012345 and CHG0042000",
      "https://acme.service-now.com/incident.do?sysparm_query=number=INC0099887",
      "SCTASK0010001 done",
    ].join("\n");
    const found = [...text.matchAll(regex)].map((match) => match[1]);
    assert.deepStrictEqual(found, [
      "INC0012345",
      "CHG0042000",
      "INC0099887",
      // Longest prefix first, otherwise SCTASK would be read as TASK0010001
      "SCTASK0010001",
    ]);
  });

  test("the default regex ignores words that only look like record numbers", () => {
    const regex = new RegExp(ServiceNowProvider.numberRegexSource(), "gim");
    // Fewer than 4 digits, and an unmapped prefix: neither is a record number
    assert.deepStrictEqual([..."INC123 and ACME0012345".matchAll(regex)], []);
  });

  test("the ambiguous prefixes are only scanned once the project declares them", () => {
    // TASK, REQ, STORY and KB are ordinary words followed by digits, and what is
    // collected here gets a work note written on it at the next deployment
    const defaultScan = ServiceNowProvider.scanPrefixes();
    for (const prefix of ["TASK", "REQ", "STORY", "KB"]) {
      assert.ok(
        !defaultScan.includes(prefix),
        `${prefix} must not be scanned by default`,
      );
      // Routing an identifier a user typed still reads the full mapping
      assert.ok(
        ServiceNowProvider.tableOfTicketId(`${prefix}0001234`),
        `${prefix} must still resolve to a table`,
      );
    }
    const branchText = "feature/task0001 sees KB0001 REQ1234 story12345";
    assert.deepStrictEqual(
      [
        ...branchText.matchAll(
          new RegExp(ServiceNowProvider.numberRegexSource(), "gim"),
        ),
      ],
      [],
    );
    // Declaring one opts it into scanning
    const config = { serviceNowTablePrefixes: "TASK:task" };
    assert.ok(ServiceNowProvider.scanPrefixes(config).includes("TASK"));
    assert.ok(
      new RegExp(ServiceNowProvider.numberRegexSource(config), "i").test(
        "TASK0001234",
      ),
    );
  });

  test("SERVICENOW_TABLE_PREFIXES wins over the project configuration", () => {
    // The CLI connector reads `getEnvVar(name) || config?.property`: reading only
    // the config here would make the extension collect different records than the
    // commands it launches on the same project
    const config = { serviceNowTablePrefixes: "DEFECT:from_config" };
    const previous = process.env.SERVICENOW_TABLE_PREFIXES;
    process.env.SERVICENOW_TABLE_PREFIXES = "DEFECT:from_env";
    try {
      assert.strictEqual(
        ServiceNowProvider.tableOfTicketId("DEFECT0001", config),
        "from_env",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.SERVICENOW_TABLE_PREFIXES;
      } else {
        process.env.SERVICENOW_TABLE_PREFIXES = previous;
      }
    }
    // Without the variable, the project configuration is used
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("DEFECT0001", config),
      "from_config",
    );
  });

  test("a prefix coming from the configuration cannot break the regex", () => {
    // serviceNowTablePrefixes is free text: an unescaped metacharacter would make
    // new RegExp() throw, and take every ticket of the Pull Request load with it
    const config = { serviceNowTablePrefixes: "X(:x_acme, A.B:x_other" };
    const source = ServiceNowProvider.numberRegexSource(config);
    assert.doesNotThrow(() => new RegExp(source, "gim"));
    // "A.B" matches a literal dot, not any character
    assert.ok(new RegExp(source, "i").test("A.B0001234"));
    assert.ok(!new RegExp(source, "i").test("AXB0001234"));
    // What is scanned must also be resolvable, or the setting silently does
    // nothing: the record is collected and then dropped for want of a table
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("A.B0001234", config),
      "x_other",
    );
  });

  test("a declared prefix holding a digit resolves to its table", () => {
    // A fixed [A-Z_]+ prefix class would scan SN20001234 and never resolve it
    const config = { serviceNowTablePrefixes: "SN2:x_sn_story" };
    assert.ok(
      new RegExp(ServiceNowProvider.numberRegexSource(config), "i").test(
        "SN20001234",
      ),
    );
    assert.strictEqual(
      ServiceNowProvider.tableOfTicketId("SN20001234", config),
      "x_sn_story",
    );
  });

  test("the record number is capture group 1, as the CLI expects", () => {
    const source = ServiceNowProvider.numberRegexSource();
    const match = "INC0012345".match(new RegExp(source));
    assert.ok(match, "the regex should match a record number");
    assert.strictEqual(match[1], "INC0012345");
  });
});

/**
 * What the connector picks up in a commit message or a Pull Request body, once
 * the regexes have run. Both hooks that reach outside (the stored credentials
 * and the project regexes) are stubbed, so nothing here touches the network nor
 * the secret store.
 */
suite("ServiceNow records collected from a string", () => {
  function buildProvider(options: {
    connected: boolean;
    regexes: RegExp[];
  }): ServiceNowProvider {
    const provider = new ServiceNowProvider();
    (provider as any).loadStoredCredentials = async () => options.connected;
    provider.getTicketIdentifierRegexes = async () => options.regexes;
    provider.buildTicketUrl = async (ticketId: string) =>
      `https://acme.service-now.com/incident.do?sysparm_query=number=${ticketId}`;
    return provider;
  }

  test("a project regex that splits the prefix still yields the record number", async () => {
    // `(INC|CHG)([0-9]{4,})` leaves "INC" in capture group 1 and the whole number
    // in the match: taking group 1 blindly would produce an unroutable "INC"
    const provider = buildProvider({
      connected: true,
      regexes: [/(INC|CHG)([0-9]{4,})/gim],
    });
    const tickets = await provider.getTicketsFromString("fix INC0012345 now");
    assert.deepStrictEqual(
      tickets.map((ticket) => ticket.id),
      ["INC0012345"],
    );
    assert.ok(tickets[0].url.endsWith("number=INC0012345"));
  });

  test("the documented regex shape yields the record number too", async () => {
    const provider = buildProvider({
      connected: true,
      regexes: [/((?:INC|CHG|RITM)[0-9]{4,})/gim],
    });
    const tickets = await provider.getTicketsFromString(
      "INC0012345 and INC0012345 and CHG0042000",
    );
    assert.deepStrictEqual(
      tickets.map((ticket) => ticket.id),
      ["INC0012345", "CHG0042000"],
    );
  });

  test("a match that is not a record number is dropped, not linked", async () => {
    const provider = buildProvider({
      connected: true,
      regexes: [/(ACME[0-9]{4,})/gim],
    });
    assert.deepStrictEqual(
      await provider.getTicketsFromString("see ACME0012345"),
      [],
    );
  });

  test("nothing is collected while the connector is not configured", async () => {
    // TASK1234 and REQ1234 are ordinary words followed by digits: a project that
    // has not connected must never see them turn into tickets
    const provider = buildProvider({
      connected: false,
      regexes: [/((?:INC|TASK)[0-9]{4,})/gim],
    });
    assert.deepStrictEqual(
      await provider.getTicketsFromString("INC0012345 and TASK1234"),
      [],
    );
  });
});

/**
 * The identifiers collected from commits and Pull Requests come from the
 * regexes of the active provider. sfdx-hardis reads the FIRST CAPTURING GROUP
 * of those regexes, so a project regex whose context is not part of the ticket
 * id (`(?:CHG|INC)([0-9]+)`) must not turn that context into the id.
 */
suite("Ticket identifiers collected from a string", () => {
  class RegexTicketProvider extends TicketProvider {
    constructor(private regexes: RegExp[]) {
      super();
      this.providerName = "GENERIC";
    }
    async getTicketIdentifierRegexes(): Promise<RegExp[]> {
      return this.regexes;
    }
    async buildTicketUrl(ticketId: string): Promise<string> {
      return `https://tickets.example.com/${ticketId}`;
    }
  }

  test("a regex capturing an alternation still yields the whole identifier", async () => {
    // The sfdx-hardis CLI keeps capture group 1, but doing that for every
    // provider would turn an existing "(ABC|DEF)-([0-9]+)" into the id "ABC" and
    // link to an issue that does not exist
    const provider = new RegexTicketProvider([/(ABC|DEF)-([0-9]+)/g]);
    const tickets = await provider.getTicketsFromString("fixes ABC-123 today");
    assert.deepStrictEqual(
      tickets.map((ticket) => ticket.id),
      ["ABC-123"],
    );
    assert.strictEqual(tickets[0].url, "https://tickets.example.com/ABC-123");
  });

  test("a regex without a capturing group still yields the whole match", async () => {
    const provider = new RegexTicketProvider([/[A-Z]{3}-[0-9]+/g]);
    const tickets = await provider.getTicketsFromString("ABC-12 and ABC-12");
    assert.deepStrictEqual(
      tickets.map((ticket) => ticket.id),
      ["ABC-12"],
    );
  });

  test("a regex that can match nothing does not hang", async () => {
    const provider = new RegexTicketProvider([/([A-Z]*)/g]);
    const tickets = await provider.getTicketsFromString("nothing here");
    assert.ok(Array.isArray(tickets));
  });
});

/**
 * A setting that only applies to one ticketing provider must not be shown on a
 * project using another one. The JSON schema says so with `visible-conditions`,
 * which the panel used to drop on the floor: every serviceNow* setting, and the
 * Jira and Generic ones before them, were listed whatever the provider.
 */
suite("Provider-specific settings visibility", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "resources", "sfdx-hardis.jsonschema.json"),
      "utf8",
    ),
  );

  test("the schema conditions reach the panel", () => {
    const helperSource = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "src",
        "utils",
        "pipeline",
        "sfdxHardisConfigHelper.ts",
      ),
      "utf8",
    );
    assert.ok(
      helperSource.includes('visibleConditions: value["visible-conditions"]'),
      "loadSchema drops the visible-conditions of the JSON schema",
    );
  });

  test("every conditional setting of the schema is a setting the panel offers", () => {
    // A condition on a setting nobody can reach would hide it for ever
    const conditional = Object.entries<any>(schema.properties || {}).filter(
      ([, property]) => Array.isArray(property["visible-conditions"]),
    );
    assert.ok(conditional.length > 0, "no conditional setting in the schema");
    const configurable = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.map(
      (field) => field.name,
    );
    for (const [key, property] of conditional) {
      if (!configurable.includes(key)) {
        continue;
      }
      for (const condition of property["visible-conditions"]) {
        assert.ok(
          configurable.includes(condition.property),
          `${key} is shown depending on ${condition.property}, which the panel does not offer`,
        );
      }
    }
  });

  test("the four ServiceNow settings depend on the ticketing provider", () => {
    for (const key of [
      "serviceNowTicketRegex",
      "serviceNowTablePrefixes",
      "serviceNowCommentField",
      "serviceNowAddDeploymentTag",
    ]) {
      assert.deepStrictEqual(
        schema.properties?.[key]?.["visible-conditions"],
        [
          {
            property: "ticketingProvider",
            operator: "equals",
            value: "SERVICENOW",
          },
        ],
        `${key} is not conditioned on ticketingProvider=SERVICENOW`,
      );
    }
  });

  test("the panel evaluates the conditions, on the pending edits too", () => {
    const source = readModuleFile("pipelineConfig", "pipelineConfig.js");
    assert.ok(
      source.includes("if (!this.isFieldVisible(schema)) continue;"),
      "the sections getter does not filter on the conditions",
    );
    // Reading the pending edits is what makes a setting appear as soon as the
    // provider is picked, instead of only after a save
    assert.ok(
      source.includes("configValueOf(key)") &&
        source.includes("this.editedConfig[key]"),
      "the conditions are not evaluated against the pending edits",
    );
    assert.ok(
      source.includes("isVisibilityDriver(key)"),
      "changing the driving setting does not re-render the section",
    );
    // An operator this version does not know must not hide a setting
    const evaluator = source.slice(
      source.indexOf("isFieldVisible(schema)"),
      source.indexOf("get configSections()"),
    );
    assert.ok(
      /default:\s*\n?\s*return true;/.test(evaluator),
      "an unknown operator should leave the setting visible",
    );
  });
});

/**
 * ServiceNow must be reachable from the same places as Jira: the DevOps
 * Pipeline connect button, the Pipeline Settings and the CLI environment.
 */
suite("ServiceNow integration contract", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "resources", "sfdx-hardis.jsonschema.json"),
      "utf8",
    ),
  );
  const serviceNowFields = Object.keys(schema.properties || {}).filter((key) =>
    key.startsWith("serviceNow"),
  );

  test("the ticketing provider list holds ServiceNow", () => {
    const source = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "src",
        "utils",
        "ticketProviders",
        "ticketProvider.ts",
      ),
      "utf8",
    );
    assert.ok(
      source.includes("ServiceNowProvider,"),
      "ServiceNowProvider is not registered in allTicketProviders",
    );
  });

  test("every provider has a brand label and an icon", () => {
    for (const [providerName, iconKey] of [
      ["JIRA", "jira"],
      ["AZURE", "azureboards"],
      ["SERVICENOW", "servicenow"],
    ]) {
      const provider = new TicketProvider();
      provider.providerName = providerName as any;
      assert.notStrictEqual(
        provider.getProviderLabel(),
        "Ticketing",
        `${providerName} has no brand label`,
      );
      assert.strictEqual(provider.getProviderIconKey(), iconKey);
      assert.ok(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            "resources",
            "webviews",
            "icons",
            `${iconKey}.svg`,
          ),
        ),
        `missing icon ${iconKey}.svg`,
      );
    }
  });

  test("the pipeline panel serves the ServiceNow icon", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src", "commands", "showPipeline.ts"),
      "utf8",
    );
    assert.ok(
      source.includes('servicenow: ["icons", "servicenow.svg"]'),
      "servicenow.svg is not declared in the pipeline imagePaths",
    );
    assert.ok(
      source.includes("ticketProviderKey: ticketProviderKey"),
      "the icon key is not sent to the pipeline webview",
    );
  });

  test("the pipeline webview picks the icon from the provider key", () => {
    const source = readModuleFile("pipeline", "pipeline.js");
    assert.ok(
      source.includes("this.ticketProviderKey"),
      "the pipeline component ignores ticketProviderKey",
    );
  });

  test("the ServiceNow settings are offered in Pipeline Settings", () => {
    // Tolerated while the schema synced from upstream sfdx-hardis has not
    // shipped them yet: what must never happen is a field known to the schema
    // that the panel does not offer.
    const configurable = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.map(
      (field) => field.name,
    );
    const ticketingSection = SfdxHardisConfigHelper.SECTIONS.find(
      (section) => section.label === "ticketing",
    );
    assert.ok(ticketingSection, "no ticketing section in Pipeline Settings");
    const missing = serviceNowFields.filter(
      (field) =>
        !configurable.includes(field) ||
        !(ticketingSection.keys as string[]).includes(field),
    );
    assert.deepStrictEqual(
      missing,
      [],
      "these ServiceNow schema fields are not offered in Pipeline Settings",
    );
  });

  test("SERVICENOW is selectable whenever the schema knows its settings", () => {
    // `yarn sync:schema` replaces this file with the upstream one on every build,
    // so the assertion is on the CONSISTENCY of the two halves rather than on
    // ServiceNow being there: a schema that offers the serviceNow* settings must
    // also offer the provider they belong to, and the other way round.
    const providerEnum = schema.properties?.ticketingProvider?.enum || [];
    assert.strictEqual(
      providerEnum.includes("SERVICENOW"),
      serviceNowFields.length > 0,
      "the ticketingProvider enum and the serviceNow* settings of the schema disagree",
    );
  });

  test("the ServiceNow credentials are forwarded to the CLI and masked", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src", "utils", "providerCredentials.ts"),
      "utf8",
    );
    for (const variable of [
      "SERVICENOW_URL",
      "SERVICENOW_USERNAME",
      "SERVICENOW_PASSWORD",
    ]) {
      assert.ok(
        source.includes(`"${variable}"`),
        `${variable} is not forwarded to the sfdx-hardis CLI`,
      );
    }
    // The URL is not a secret, the credentials are
    const secretsBlock = source.slice(
      source.indexOf("SECRET_ENV_KEYS"),
      source.indexOf("credentialEnvCache"),
    );
    assert.ok(secretsBlock.includes('"SERVICENOW_USERNAME"'));
    assert.ok(secretsBlock.includes('"SERVICENOW_PASSWORD"'));
  });

  test("every ServiceNow label exists in the 9 locales", () => {
    const keys = [
      "enterServiceNowUrl",
      "enterServiceNowUsername",
      "enterServiceNowPassword",
      "serviceNowUrlPlaceholder",
      "serviceNowAuthInfo",
    ];
    for (const locale of LOCALES) {
      const translations = JSON.parse(
        fs.readFileSync(
          path.join(REPO_ROOT, "src", "i18n", `${locale}.json`),
          "utf8",
        ),
      );
      for (const key of keys) {
        assert.ok(
          translations[key],
          `missing i18n key "${key}" in ${locale}.json`,
        );
      }
    }
  });
});
