import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT, readModuleFile } from "./lwcSourceUtils";
import { AhaProvider } from "../../utils/ticketProviders/ticketProviderAha";
import { TicketProvider } from "../../utils/ticketProviders/ticketProvider";
import { PROVIDER_BATCH_PROFILES } from "../../utils/concurrency";
import { HttpError } from "../../utils/httpUtils";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";

const LOCALES = ["en", "fr", "es", "de", "it", "nl", "ja", "pl", "pt-BR"];

/**
 * Aha! ticketing connector.
 *
 * A feature reference (PROD-12) has the shape of a Jira key, and Aha! only
 * knows it in uppercase: the host normalization, the detection of the
 * references and the handling of the answers of Aha! are covered here, the
 * network being replaced by a stubbed fetch.
 */
suite("Aha! ticketing provider", () => {
  const realFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = realFetch;
  });

  /** Runs with exactly these Aha! variables, then restores what was there before */
  async function withAha<T>(
    vars: { AHA_HOST?: string; AHA_TICKET_REGEX?: string },
    run: () => Promise<T>,
  ): Promise<T> {
    const names = ["AHA_HOST", "AHA_TICKET_REGEX"] as const;
    const previous = names.map((name) => process.env[name]);
    for (const name of names) {
      if (vars[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = vars[name];
      }
    }
    try {
      return await run();
    } finally {
      names.forEach((name, index) => {
        if (previous[index] === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = previous[index];
        }
      });
    }
  }

  /** Answers every request from the handler, which returns [status, body, headers] */
  function stubFetch(
    handler: (url: string) => [number, any, Record<string, string>?],
  ): string[] {
    const urls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      urls.push(url);
      const [status, body, headers] = handler(url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(headers || {}) },
      });
    }) as any;
    return urls;
  }

  /** Provider connected with a key, without going through the secret storage */
  async function connectedProvider(): Promise<AhaProvider> {
    const provider = new AhaProvider();
    await provider.getTicketingWebUrl();
    (provider as any).apiKey = "secret";
    provider.isAuthenticated = true;
    return provider;
  }

  test("the host is normalized whatever the user typed, and always https", () => {
    assert.strictEqual(
      AhaProvider.completeHostUrl("acme.aha.io"),
      "https://acme.aha.io",
    );
    assert.strictEqual(
      AhaProvider.completeHostUrl("https://acme.euw4.aha.io/"),
      "https://acme.euw4.aha.io",
    );
    assert.strictEqual(
      AhaProvider.completeHostUrl("  https://acme.aha.io/products/PROD  "),
      "https://acme.aha.io",
    );
    // The API key must never travel in clear text
    assert.strictEqual(
      AhaProvider.completeHostUrl("http://acme.aha.io"),
      "https://acme.aha.io",
    );
    // An account name may start with "http"
    assert.strictEqual(
      AhaProvider.completeHostUrl("http-tools.aha.io"),
      "https://http-tools.aha.io",
    );
    assert.strictEqual(AhaProvider.completeHostUrl(""), "");
  });

  test("the regional host of an account is the same account, another account is not", () => {
    const project = "https://acme.aha.io";
    assert.ok(AhaProvider.isSameAccount("acme.aha.io", project));
    assert.ok(AhaProvider.isSameAccount("acme.euw4.aha.io", project));
    assert.ok(!AhaProvider.isSameAccount("partner.aha.io", project));
    assert.ok(!AhaProvider.isSameAccount("acme.aha.io.example.com", project));
  });

  test("a feature link is built in uppercase on the account host", async () => {
    await withAha({ AHA_HOST: "acme.aha.io" }, async () => {
      const provider = new AhaProvider();
      assert.strictEqual(
        await provider.buildTicketUrl("prod-12"),
        "https://acme.aha.io/features/PROD-12",
      );
      assert.strictEqual(
        await provider.getTicketingWebUrl(),
        "https://acme.aha.io",
      );
    });
  });

  test("features are collected from a commit, a branch and a link, once each", async () => {
    const tickets = await withAha({ AHA_HOST: "acme.aha.io" }, () =>
      new AhaProvider().getTicketsFromString(
        [
          "PROD-12 block a past close date",
          "branch features/dev/prod-12",
          "see https://acme.euw4.aha.io/features/MOBILE-3",
        ].join("\n"),
      ),
    );
    assert.deepStrictEqual(tickets.map((ticket) => ticket.id).sort(), [
      "MOBILE-3",
      "PROD-12",
    ]);
    assert.ok(tickets.every((ticket) => ticket.provider === "AHA"));
    // A link is kept as it was written, a bare reference gets the account host
    assert.strictEqual(
      tickets.find((ticket) => ticket.id === "MOBILE-3")?.url,
      "https://acme.euw4.aha.io/features/MOBILE-3",
    );
    assert.strictEqual(
      tickets.find((ticket) => ticket.id === "PROD-12")?.url,
      "https://acme.aha.io/features/PROD-12",
    );
  });

  test("requirements, epics, releases and dates are not features", async () => {
    const tickets = await withAha({ AHA_HOST: "acme.aha.io" }, () =>
      new AhaProvider().getTicketsFromString(
        "requirement PROD-12-3, epic PROD-E-4, release PROD-R-2, date 2026-09",
      ),
    );
    assert.deepStrictEqual(tickets, []);
  });

  test("nothing is collected in a project that does not name its Aha! account", async () => {
    const tickets = await withAha({}, () =>
      new AhaProvider().getTicketsFromString(
        "PROD-12 and https://acme.aha.io/features/MOBILE-3",
      ),
    );
    assert.deepStrictEqual(tickets, []);
  });

  test("a link to a feature of another account is left alone", async () => {
    const tickets = await withAha({ AHA_HOST: "acme.aha.io" }, () =>
      new AhaProvider().getTicketsFromString(
        "see https://partner.aha.io/features/APP-7, and PROD-12",
      ),
    );
    assert.deepStrictEqual(
      tickets.map((ticket) => ticket.url),
      ["https://acme.aha.io/features/PROD-12"],
    );
  });

  test("a project regex gives the reference in its capture group, like in the CLI", async () => {
    const collect = (regex: string, text: string) =>
      withAha({ AHA_HOST: "acme.aha.io", AHA_TICKET_REGEX: regex }, () =>
        new AhaProvider().getTicketsFromString(text),
      );
    const narrowed = await collect("(MOBILE-[0-9]+)", "PROD-12 and MOBILE-8");
    assert.deepStrictEqual(
      narrowed.map((ticket) => ticket.id),
      ["MOBILE-8"],
    );
    // What surrounds the group is not part of the reference
    const prefixed = await collect(
      "feature[: ](PROD-[0-9]+)",
      "feature:PROD-12 done",
    );
    assert.deepStrictEqual(prefixed, [
      {
        id: "PROD-12",
        provider: "AHA",
        url: "https://acme.aha.io/features/PROD-12",
      },
    ]);
    // A regex without a group still gives its whole match
    const ungrouped = await collect("MOBILE-[0-9]+", "MOBILE-8");
    assert.deepStrictEqual(
      ungrouped.map((ticket) => ticket.id),
      ["MOBILE-8"],
    );
  });

  test("a malformed project regex costs only its own tickets", async () => {
    const tickets = await withAha(
      { AHA_HOST: "acme.aha.io", AHA_TICKET_REGEX: "([" },
      () =>
        new AhaProvider().getTicketsFromString(
          "PROD-12 and https://acme.aha.io/features/MOBILE-3",
        ),
    );
    assert.deepStrictEqual(
      tickets.map((ticket) => ticket.id),
      ["MOBILE-3"],
    );
  });

  test("a feature is not read before the connection is established", async () => {
    await withAha({ AHA_HOST: "acme.aha.io" }, async () => {
      const urls = stubFetch(() => [200, {}]);
      const ticket = await new AhaProvider().completeTicketDetails({
        provider: "AHA",
        id: "PROD-12",
        url: "kept",
      });
      assert.strictEqual(ticket.foundOnServer, undefined);
      assert.strictEqual(ticket.url, "kept");
      assert.deepStrictEqual(urls, []);
    });
  });

  test("a feature is read with its name, status, owner and canonical link", async () => {
    await withAha({ AHA_HOST: "acme.euw4.aha.io" }, async () => {
      const urls = stubFetch(() => [
        200,
        {
          feature: {
            name: "Block a past close date",
            url: "https://acme.aha.io/features/PROD-12",
            workflow_status: { id: "700", name: "In development" },
            assigned_to_user: null,
            created_by_user: { id: "22", name: "Alex Martin" },
            description: { body: "<p>The rule &amp; its message.</p>" },
          },
        },
      ]);
      const provider = await connectedProvider();
      const ticket = await provider.completeTicketDetails({
        provider: "AHA",
        id: "prod-12",
        url: "",
      });
      assert.ok(
        urls[0].startsWith(
          "https://acme.euw4.aha.io/api/v1/features/PROD-12?fields=",
        ),
      );
      assert.strictEqual(ticket.foundOnServer, true);
      assert.strictEqual(ticket.subject, "Block a past close date");
      assert.strictEqual(ticket.statusLabel, "In development");
      assert.strictEqual(ticket.authorLabel, "Alex Martin");
      assert.strictEqual(ticket.body, "The rule & its message.");
      assert.strictEqual(ticket.url, "https://acme.aha.io/features/PROD-12");
    });
  });

  test("a reference Aha! does not know stays a bare link, a throttling goes back to the batches", async () => {
    await withAha({ AHA_HOST: "acme.aha.io" }, async () => {
      const provider = await connectedProvider();
      stubFetch(() => [404, { error: "Record not found." }]);
      const unknown = await provider.completeTicketDetails({
        provider: "AHA",
        id: "UTF-8",
        url: "kept",
      });
      assert.strictEqual(unknown.foundOnServer, false);

      stubFetch(() => [429, { error: "Rate limit" }, { "retry-after": "7" }]);
      let thrown: any = null;
      try {
        await provider.completeTicketDetails({
          provider: "AHA",
          id: "PROD-12",
          url: "",
        });
      } catch (error) {
        thrown = error;
      }
      // Thrown with its headers, so the batches shrink and wait the delay asked for
      assert.ok(thrown instanceof HttpError);
      assert.strictEqual(thrown.status, 429);
      assert.strictEqual(thrown.headers["retry-after"], "7");
    });
  });

  test("only a refused key is a refused key", async () => {
    await withAha({ AHA_HOST: "acme.aha.io" }, async () => {
      const provider = new AhaProvider();
      await provider.getTicketingWebUrl();
      const check = () => (provider as any).checkCredentials();
      stubFetch(() => [200, { user: { name: "CI" } }]);
      assert.strictEqual(await check(), "accepted");
      stubFetch(() => [401, {}]);
      assert.strictEqual(await check(), "refused");
      // A typo in the host, a throttling or a server error say nothing about the key
      for (const status of [404, 429, 503]) {
        stubFetch(() => [status, {}]);
        assert.strictEqual(await check(), "unreachable", `HTTP ${status}`);
      }
    });
  });

  test("the API key never follows a change of account", async () => {
    await withAha({ AHA_HOST: "acme.aha.io" }, async () => {
      const provider = new AhaProvider();
      (provider as any).apiKey = "secret";
      await provider.getTicketingWebUrl();
      assert.strictEqual(await provider.getApiKeyForCommands(), "");
      provider.isAuthenticated = true;
      assert.strictEqual(await provider.getApiKeyForCommands(), "secret");
      // ahaHost edited in Pipeline Settings while the provider is alive
      process.env.AHA_HOST = "other.aha.io";
      assert.strictEqual(await provider.getApiKeyForCommands(), "");
      assert.strictEqual(provider.isAuthenticated, false);
      assert.strictEqual(
        await provider.getTicketingWebUrl(),
        "https://other.aha.io",
      );
    });
  });

  test("Aha! has its own ladder of batch sizes, the same as the CLI", () => {
    assert.deepStrictEqual(PROVIDER_BATCH_PROFILES.aha, [10, 5, 2, 1]);
    assert.strictEqual(
      new AhaProvider().batchSizes,
      PROVIDER_BATCH_PROFILES.aha,
    );
  });

  test("the default workflow statuses of Aha! get the color of their meaning", () => {
    const moduleSource = readModuleFile("pillUtils", "pillUtils.js");
    // The same class names are used by other pills of the module, above this table
    const source = moduleSource.slice(
      moduleSource.indexOf("const TICKET_STATUS_KEYWORDS"),
    );
    const family = (statusClass: string) =>
      source.slice(
        source.indexOf(`statusClass: "${statusClass}"`),
        source.indexOf("]", source.indexOf(`statusClass: "${statusClass}"`)),
      );
    assert.ok(family("hardis-status-failed").includes('"will not implement"'));
    assert.ok(family("hardis-status-success").includes('"shipped"'));
    assert.ok(family("hardis-status-pending").includes('"consideration"'));
    assert.ok(family("hardis-status-info").includes('"design"'));
    // First family wins: "Will not implement" must be refused before "implement" is in progress
    assert.ok(
      source.indexOf('"will not implement"') < source.indexOf('"implement"'),
    );
  });

  test("the provider is registered, with a brand label and an icon", () => {
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
      source.includes("AhaProvider,"),
      "AhaProvider is not registered in allTicketProviders",
    );
    const provider = new TicketProvider();
    provider.providerName = "AHA";
    assert.strictEqual(provider.getProviderLabel(), "Aha!");
    assert.strictEqual(provider.getProviderIconKey(), "aha");
    assert.ok(
      fs.existsSync(
        path.join(REPO_ROOT, "resources", "webviews", "icons", "aha.svg"),
      ),
      "missing icon aha.svg",
    );
    const pipelineSource = fs.readFileSync(
      path.join(REPO_ROOT, "src", "commands", "showPipeline.ts"),
      "utf8",
    );
    assert.ok(
      pipelineSource.includes('aha: ["icons", "aha.svg"]'),
      "aha.svg is not declared in the pipeline imagePaths",
    );
  });

  test("the Aha! settings are editable in the Ticketing section, and known to the bundled schema", () => {
    const configurable = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.map(
      (field) => field.name,
    );
    const ticketingSection = SfdxHardisConfigHelper.SECTIONS.find(
      (section) => section.label === "ticketing",
    );
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "resources", "sfdx-hardis.jsonschema.json"),
        "utf8",
      ),
    );
    for (const key of ["ahaHost", "ahaTicketRegex"]) {
      assert.ok(configurable.includes(key), `${key} is not configurable`);
      assert.ok(
        ticketingSection?.keys.includes(key),
        `${key} is not in the Ticketing section`,
      );
      assert.deepStrictEqual(
        schema.properties[key]?.["visible-conditions"],
        [{ property: "ticketingProvider", operator: "equals", value: "AHA" }],
        `${key} is missing from the bundled schema`,
      );
    }
    assert.ok(schema.properties.ticketingProvider.enum.includes("AHA"));
  });

  test("the API key is forwarded to the CLI and masked", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src", "utils", "providerCredentials.ts"),
      "utf8",
    );
    assert.ok(
      source.includes("env.AHA_API_KEY"),
      "AHA_API_KEY is not forwarded to the sfdx-hardis CLI",
    );
    const secretsBlock = source.slice(
      source.indexOf("SECRET_ENV_KEYS"),
      source.indexOf("credentialEnvCache"),
    );
    assert.ok(secretsBlock.includes('"AHA_API_KEY"'));
  });

  test("every Aha! label exists in the 9 locales", () => {
    const keys = [
      "ahaAuthInfo",
      "ahaHostNotConfigured",
      "ahaHostUnreachable",
      "createAhaApiKey",
      "enterAhaApiKey",
    ];
    /* jscpd:ignore-start */
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
    /* jscpd:ignore-end */
  });
});
