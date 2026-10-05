import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT } from "./lwcSourceUtils";
import { AhaProvider } from "../../utils/ticketProviders/ticketProviderAha";
import { TicketProvider } from "../../utils/ticketProviders/ticketProvider";
import { PROVIDER_BATCH_PROFILES } from "../../utils/concurrency";
import { SfdxHardisConfigHelper } from "../../utils/pipeline/sfdxHardisConfigHelper";

const LOCALES = ["en", "fr", "es", "de", "it", "nl", "ja", "pl", "pt-BR"];

/**
 * Aha! ticketing connector.
 *
 * A feature reference (PROD-12) has the shape of a Jira key, and Aha! only
 * knows it in uppercase: the host normalization and the detection of the
 * references are covered here without any network access.
 */
suite("Aha! ticketing provider", () => {
  /** Provider whose host is already known, so nothing reads the project configuration */
  function providerOn(host: string): AhaProvider {
    const provider = new AhaProvider();
    (provider as any).host = host;
    return provider;
  }

  /** Runs the detection with exactly this AHA_TICKET_REGEX, then restores the variable */
  async function withTicketRegex<T>(
    regex: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = process.env.AHA_TICKET_REGEX;
    if (regex === undefined) {
      delete process.env.AHA_TICKET_REGEX;
    } else {
      process.env.AHA_TICKET_REGEX = regex;
    }
    try {
      return await run();
    } finally {
      if (previous === undefined) {
        delete process.env.AHA_TICKET_REGEX;
      } else {
        process.env.AHA_TICKET_REGEX = previous;
      }
    }
  }

  test("the host is normalized whatever the user typed", () => {
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
    assert.strictEqual(AhaProvider.completeHostUrl(""), "");
  });

  test("a feature link is built in uppercase on the account host", async () => {
    const provider = providerOn("https://acme.aha.io");
    assert.strictEqual(
      await provider.buildTicketUrl("prod-12"),
      "https://acme.aha.io/features/PROD-12",
    );
    assert.strictEqual(
      await provider.getTicketingWebUrl(),
      "https://acme.aha.io",
    );
  });

  test("features are collected from a commit, a branch and a link, once each", async () => {
    const tickets = await withTicketRegex(undefined, () =>
      providerOn("https://acme.aha.io").getTicketsFromString(
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
    const tickets = await withTicketRegex(undefined, () =>
      providerOn("https://acme.aha.io").getTicketsFromString(
        "requirement PROD-12-3, epic PROD-E-4, release PROD-R-2, date 2026-09",
      ),
    );
    assert.deepStrictEqual(tickets, []);
  });

  test("AHA_TICKET_REGEX narrows the detection, and a malformed one costs only its own tickets", async () => {
    const provider = providerOn("https://acme.aha.io");
    const narrowed = await withTicketRegex("(MOBILE-[0-9]+)", () =>
      provider.getTicketsFromString("PROD-12 and MOBILE-8"),
    );
    assert.deepStrictEqual(
      narrowed.map((ticket) => ticket.id),
      ["MOBILE-8"],
    );
    const malformed = await withTicketRegex("([", () =>
      provider.getTicketsFromString(
        "PROD-12 and https://acme.aha.io/features/MOBILE-3",
      ),
    );
    assert.deepStrictEqual(
      malformed.map((ticket) => ticket.id),
      ["MOBILE-3"],
    );
  });

  test("a feature is not read before the connection is established", async () => {
    const ticket = await providerOn(
      "https://acme.aha.io",
    ).completeTicketDetails({
      provider: "AHA",
      id: "PROD-12",
      url: "kept",
    });
    assert.strictEqual(ticket.foundOnServer, undefined);
    assert.strictEqual(ticket.url, "kept");
  });

  test("the API key is only given to commands once the account is connected", async () => {
    const provider = providerOn("https://acme.aha.io");
    (provider as any).apiKey = "secret";
    assert.strictEqual(await provider.getApiKeyForCommands(), "");
    provider.isAuthenticated = true;
    assert.strictEqual(await provider.getApiKeyForCommands(), "secret");
  });

  test("Aha! has its own ladder of batch sizes, the same as the CLI", () => {
    assert.deepStrictEqual(PROVIDER_BATCH_PROFILES.aha, [10, 5, 2, 1]);
    assert.strictEqual(
      providerOn("https://acme.aha.io").batchSizes,
      PROVIDER_BATCH_PROFILES.aha,
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

  test("the Aha! settings are editable in the Ticketing section", () => {
    const configurable = SfdxHardisConfigHelper.CONFIGURABLE_FIELDS.map(
      (field) => field.name,
    );
    const ticketingSection = SfdxHardisConfigHelper.SECTIONS.find(
      (section) => section.label === "ticketing",
    );
    for (const key of ["ahaHost", "ahaTicketRegex"]) {
      assert.ok(configurable.includes(key), `${key} is not configurable`);
      assert.ok(
        ticketingSection?.keys.includes(key),
        `${key} is not in the Ticketing section`,
      );
    }
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
      "createAhaApiKey",
      "enterAhaApiKey",
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
