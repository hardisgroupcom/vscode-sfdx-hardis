import * as assert from "assert";
import { DOCSITE_URL, PANEL_DOC_URLS } from "../../constants";
import { PROVIDER_ENV_VAR_NAMES } from "../../utils/envFileCredentials";
import {
  SCRATCH_ORG_POOL_COUNTS_CACHE_KEY,
  buildScratchOrgPoolViewCommand,
  isScratchOrgPoolCommand,
  isScratchOrgPoolConfigured,
  poolEncryptionKeySecretName,
  readScratchOrgPoolCounts,
  readScratchOrgPoolOutcome,
  sanitizeScratchOrgPool,
  scratchOrgPoolCacheKey,
} from "../../utils/scratchOrgPoolUtils";
import {
  LOCALES,
  assertKeysTranslated,
  assertPanelCommandWired,
  collectComponentI18nKeys,
  extractFunction,
  loadLocale,
  readModuleFile,
  readSourceFile,
} from "./lwcSourceUtils";

/**
 * Tests of the Scratch Org Pool panel that need no VS Code window:
 *  - the command the panel reads, and what it makes of its answer
 *  - only the documented fields of the pool reach the webview, never a credential
 *  - the encryption key is a secret of the extension, given to the commands it launches
 *  - the component launches the real pool commands, and every label it shows is translated
 *  - the DevOps Pipeline menu, the commands tree and the status view open the panel
 */

// Keys of the commands tree and of the extension host, which the component does not draw
const KEYS_OUTSIDE_THE_COMPONENT = [
  "scratchOrgPoolTooltip",
  "scratchOrgPoolKeyInputTitle",
  "scratchOrgPoolKeyInputPrompt",
  "scratchOrgPoolKeyStored",
  "scratchOrgPoolKeyNotStored",
  "scratchOrgPoolCredentialsTimeout",
];
// Keys of the scratch org pool authentication command, older than the panel
const KEYS_OF_OTHER_FEATURES = [
  "scratchOrgPoolAuthentication",
  "scratchOrgPoolAuthenticationTooltip",
];

function samplePool(): any {
  return {
    storageService: "gitProvider",
    dashboardUrl: "https://github.com/acme/project/issues/12",
    available: 3,
    max: 5,
    canTake: true,
    keyStatus: "ok",
    orgs: [
      {
        alias: "pool-1",
        username: "pool-1@acme.scratch",
        createdDate: "2026-10-10T08:00:00.000Z",
        expirationDate: "2026-10-17",
        daysLeft: 4,
      },
    ],
    history: [
      {
        date: "2026-10-12T09:30:00.000Z",
        by: "Mariia",
        branch: "features/dev/story-1",
        pullRequest: "#42",
        jobUrl: "https://github.com/acme/project/actions/runs/1",
        alias: "pool-0",
      },
    ],
    failures: [
      {
        date: "2026-10-11T02:00:00.000Z",
        error: "The daily scratch org limit is reached",
        jobUrl: "https://github.com/acme/project/actions/runs/2",
      },
    ],
    lastRefresh: {
      date: "2026-10-12T02:00:00.000Z",
      jobUrl: "https://github.com/acme/project/actions/runs/3",
    },
    devHubLimits: {
      activeScratchOrgs: { used: 12, max: 40 },
      dailyScratchOrgs: { used: 3, max: 80 },
    },
  };
}

function viewAnswer(result: any): any {
  return { status: 0, result };
}

suite("Scratch Org Pool panel", () => {
  test("the panel reads the pool with the view command, without any flag", () => {
    assert.strictEqual(
      buildScratchOrgPoolViewCommand(),
      "sf hardis:scratch:pool:view",
    );
  });

  test("the last result is kept per workspace", () => {
    assert.notStrictEqual(
      scratchOrgPoolCacheKey("/work/a"),
      scratchOrgPoolCacheKey("/work/b"),
    );
    assert.strictEqual(
      scratchOrgPoolCacheKey("/work/a"),
      scratchOrgPoolCacheKey("/work/a"),
    );
  });

  test("the pool is read again when a command that changes it ends", () => {
    for (const command of [
      "hardis:scratch:create",
      "hardis:scratch:pool:refresh",
      "hardis:scratch:pool:reset",
      "hardis:scratch:pool:create",
      "sf hardis:scratch:pool:refresh --agent",
    ]) {
      assert.strictEqual(isScratchOrgPoolCommand(command), true, command);
    }
    for (const command of [
      "hardis:scratch:pool:view",
      "hardis:scratch:pool:localauth",
      "hardis:scratch:delete",
      "hardis:work:save",
      "",
      undefined,
    ]) {
      assert.strictEqual(
        isScratchOrgPoolCommand(command),
        false,
        String(command),
      );
    }
    assert.ok(
      readSourceFile("hardis-websocket-server.ts").includes(
        "emitCommandCompleted(",
      ),
    );
    assert.ok(
      readSourceFile("commands/showScratchOrgPool.ts").includes(
        "isScratchOrgPoolCommand(command)",
      ),
    );
  });

  test("a project has a pool when its configuration names a storage service", () => {
    assert.strictEqual(
      isScratchOrgPoolConfigured({
        poolConfig: { storageService: "gitProvider" },
      }),
      true,
    );
    assert.strictEqual(isScratchOrgPoolConfigured({ poolConfig: {} }), false);
    assert.strictEqual(
      isScratchOrgPoolConfigured({ poolConfig: { storageService: " " } }),
      false,
    );
    assert.strictEqual(isScratchOrgPoolConfigured({}), false);
    assert.strictEqual(isScratchOrgPoolConfigured(undefined), false);
  });

  test("a successful answer is the pool", () => {
    const outcome = readScratchOrgPoolOutcome(
      viewAnswer({
        status: 0,
        storageService: "gitProvider",
        availableScratchOrgs: 3,
        maxScratchOrgs: 5,
        pool: samplePool(),
      }),
    ) as any;
    assert.deepStrictEqual(outcome, { pool: samplePool() });
  });

  test("the kind of failure sfdx-hardis gives is the kind the panel shows", () => {
    assert.deepStrictEqual(
      readScratchOrgPoolOutcome(viewAnswer({ status: 1, errorKind: "noPool" })),
      { error: { kind: "noPool", message: "" } },
    );
    assert.deepStrictEqual(
      readScratchOrgPoolOutcome(
        viewAnswer({
          status: 1,
          errorKind: "noGitProvider",
          errorMessage: "\u001b[33mNo git provider token found\u001b[39m",
          storageService: "gitProvider",
        }),
      ),
      {
        error: {
          kind: "noGitProvider",
          message: "No git provider token found",
        },
      },
    );
    assert.deepStrictEqual(
      readScratchOrgPoolOutcome(
        viewAnswer({
          status: 1,
          errorKind: "storageError",
          errorMessage: "The Dev Hub cannot be reached",
        }),
      ),
      { error: { kind: "other", message: "The Dev Hub cannot be reached" } },
    );
  });

  test("an answer with neither a pool nor a kind of failure comes from an older sfdx-hardis", () => {
    assert.deepStrictEqual(
      readScratchOrgPoolOutcome(
        viewAnswer({
          status: 0,
          availableScratchOrgs: 2,
          maxScratchOrgs: 5,
          poolStorage: { scratchOrgs: [{ authFileJson: "secret" }] },
        }),
      ),
      { error: { kind: "cliTooOld", message: "" } },
    );
    assert.deepStrictEqual(
      readScratchOrgPoolOutcome(
        viewAnswer({ status: 1, outputString: "Pool configuration to create" }),
      ),
      { error: { kind: "cliTooOld", message: "" } },
    );
  });

  test("a command that failed shows the message of sfdx-hardis", () => {
    const outcome = readScratchOrgPoolOutcome({
      status: 1,
      message: "\u001b[31mNot a Salesforce project\u001b[39m",
    }) as any;
    assert.deepStrictEqual(outcome, {
      error: { kind: "other", message: "Not a Salesforce project" },
    });
    // No answer at all is still an error the panel can show
    assert.strictEqual(
      (readScratchOrgPoolOutcome(undefined) as any).error.kind,
      "other",
    );
  });

  test("only the documented fields of the pool reach the webview", () => {
    const pool = samplePool();
    pool.poolStorage = { scratchOrgs: [{ authFileJson: "secret-auth" }] };
    pool.encryptionKey = "secret-key";
    pool.orgs[0].authFileJson = { accessToken: "secret-token" };
    pool.orgs[0].scratchOrgSfdxAuthUrl = "force://secret-url";
    pool.orgs[0].password = "secret-password";
    // The address of a scratch org is not drawn: it stays in the extension
    pool.orgs[0].instanceUrl = "https://secret-1.scratch.my.salesforce.com";
    pool.history[0].payload = "secret-payload";
    pool.failures[0].stack = "secret-stack";
    pool.lastRefresh.token = "secret-refresh";
    pool.devHubLimits.accessToken = "secret-devhub";
    pool.devHubLimits.activeScratchOrgs.raw = "secret-limit";
    const sanitized = sanitizeScratchOrgPool(pool);
    assert.deepStrictEqual(sanitized, samplePool());
    assert.ok(!JSON.stringify(sanitized).includes("secret"));
    // The answer of an older sfdx-hardis, which holds the credentials of the pool
    const outcome = readScratchOrgPoolOutcome(
      viewAnswer({
        status: 0,
        poolStorage: { scratchOrgs: [{ authFileJson: "secret-auth" }] },
        pool,
      }),
    );
    assert.ok(!JSON.stringify(outcome).includes("secret"));
  });

  test("a field of the wrong type becomes an empty one, an address that is not a web one is removed", () => {
    const sanitized = sanitizeScratchOrgPool({
      storageService: 12,
      dashboardUrl: "javascript:alert(1)",
      available: "3",
      max: null,
      canTake: "yes",
      keyStatus: "stolen",
      orgs: [
        null,
        "text",
        {
          alias: { nested: true },
          username: "pool-1@acme.scratch",
          instanceUrl: "file:///etc/passwd",
          daysLeft: "4",
        },
      ],
      history: { length: 1 },
      failures: [{ error: "\u001b[31mFailed\u001b[39m", jobUrl: "vscode://x" }],
      lastRefresh: "yesterday",
      devHubLimits: { activeScratchOrgs: { used: "1" } },
    });
    assert.deepStrictEqual(sanitized, {
      storageService: "",
      dashboardUrl: null,
      available: 0,
      max: 0,
      canTake: false,
      keyStatus: "notNeeded",
      orgs: [
        {
          alias: "",
          username: "pool-1@acme.scratch",
          createdDate: "",
          expirationDate: "",
          daysLeft: null,
        },
      ],
      history: [],
      failures: [{ date: "", error: "Failed", jobUrl: "" }],
      lastRefresh: null,
      devHubLimits: {
        activeScratchOrgs: { used: 0, max: 0 },
        dailyScratchOrgs: { used: 0, max: 0 },
      },
    });
    // Nothing at all is an empty pool, not a crash
    assert.strictEqual(sanitizeScratchOrgPool(undefined).orgs.length, 0);
  });

  test("the status view keeps the two counts of the pool, and nothing else", () => {
    assert.deepStrictEqual(
      readScratchOrgPoolCounts(
        viewAnswer({
          status: 0,
          availableScratchOrgs: 0,
          maxScratchOrgs: 5,
          poolStorage: { scratchOrgs: [{ authFileJson: "secret" }] },
          pool: samplePool(),
        }),
      ),
      { available: 0, max: 5 },
    );
    assert.strictEqual(
      readScratchOrgPoolCounts(viewAnswer({ status: 1, errorKind: "noPool" })),
      null,
    );
    assert.strictEqual(
      readScratchOrgPoolCounts({ status: 1, message: "failed" }),
      null,
    );
    const statusProvider = readSourceFile("hardis-status-provider.ts");
    assert.ok(statusProvider.includes("readScratchOrgPoolCounts(poolViewRes)"));
    assert.ok(!/poolViewRes\s*,/.test(statusProvider));
    assert.ok(!/poolStorage/.test(statusProvider));
  });

  test("the encryption key is stored per repository", () => {
    assert.strictEqual(
      poolEncryptionKeySecretName("github.com/acme/my-project.git"),
      "POOL_ENCRYPTION_KEY_GITHUB_COM_ACME_MY_PROJECT",
    );
    assert.notStrictEqual(
      poolEncryptionKeySecretName("github.com/acme/project-a"),
      poolEncryptionKeySecretName("github.com/acme/project-b"),
    );
    assert.strictEqual(
      poolEncryptionKeySecretName(""),
      "POOL_ENCRYPTION_KEY_DEFAULT",
    );
  });

  test("the encryption key is read from the secrets, the environment and .env, and given to the commands", () => {
    assert.deepStrictEqual(PROVIDER_ENV_VAR_NAMES.poolEncryptionKey, [
      "SFDX_HARDIS_POOL_ENCRYPTION_KEY",
    ]);
    const credentials = readSourceFile("utils/providerCredentials.ts");
    // Never printed in a terminal command line
    assert.ok(
      credentials
        .slice(
          credentials.indexOf("SECRET_ENV_KEYS = new Set(["),
          credentials.indexOf("]);", credentials.indexOf("SECRET_ENV_KEYS")),
        )
        .includes("...PROVIDER_ENV_VAR_NAMES.poolEncryptionKey"),
    );
    assert.ok(
      credentials.includes(
        "env[PROVIDER_ENV_VAR_NAMES.poolEncryptionKey[0]] = poolEncryptionKey;",
      ),
    );
    // The name of the variable is written once, where the provider variables are declared
    for (const file of [
      "utils/providerCredentials.ts",
      "utils/scratchOrgPoolUtils.ts",
      "commands/showScratchOrgPool.ts",
    ]) {
      assert.ok(
        !readSourceFile(file).includes("SFDX_HARDIS_POOL_ENCRYPTION_KEY"),
        `the name of the variable is written again in ${file}`,
      );
    }
  });

  test("a day without a time is shown as it is in every time zone, a moment in the local one", () => {
    const formatPoolDate: (
      value: unknown,
      locale: string,
      withTime: boolean,
    ) => string = new Function(
      `${extractFunction(
        readModuleFile("scratchOrgPool", "scratchOrgPool.js"),
        "formatPoolDate",
      )}; return formatPoolDate;`,
    )();
    const zoneBefore = process.env.TZ;
    try {
      for (const zone of ["America/Los_Angeles", "UTC", "Pacific/Auckland"]) {
        process.env.TZ = zone;
        assert.strictEqual(
          formatPoolDate("2026-10-24", "en", false),
          "Oct 24, 2026",
          `expiration date in ${zone}`,
        );
        assert.strictEqual(
          formatPoolDate("2026-10-24", "en", true),
          "Oct 24, 2026",
          `a day has no time in ${zone}`,
        );
      }
      // A moment is the local one: the evening of the 23rd in Los Angeles
      process.env.TZ = "America/Los_Angeles";
      assert.strictEqual(
        formatPoolDate("2026-10-24T03:12:00.000Z", "en", false),
        "Oct 23, 2026",
      );
      assert.ok(
        formatPoolDate("2026-10-24T03:12:00.000Z", "en", true).startsWith(
          "Oct 23, 2026, 8:12",
        ),
      );
    } finally {
      if (zoneBefore === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = zoneBefore;
      }
    }
    assert.strictEqual(formatPoolDate("", "en", false), "");
    assert.strictEqual(formatPoolDate("not a date", "en", true), "");
    assert.strictEqual(formatPoolDate(undefined, "en", true), "");
  });

  test("a reading never takes the answer of a run started earlier, and one reload at most waits", () => {
    const command = readSourceFile("commands/showScratchOrgPool.ts");
    const utils = readSourceFile("utils.ts");
    assert.ok(command.includes("shareInFlightRun: false"));
    assert.ok(utils.includes("if (options.shareInFlightRun === false) {"));
    // The latest reading only is drawn, and a change during a reading starts another one
    assert.ok(command.includes("loadId !== current.loadCounter"));
    assert.ok(command.includes("current.reloadWanted = true;"));
    assert.ok(
      command.indexOf("if (current.reloadWanted) {") <
        command.indexOf("pushState(current, changes);"),
    );
    // A secret the panel stores itself starts one reading, not two
    assert.strictEqual(
      (command.match(/current\.changingSecret = true;/g) || []).length,
      2,
    );
    assert.ok(command.includes("!current.changingSecret &&"));
  });

  test("credentials not read in time are a retryable error, not a missing connection", () => {
    const command = readSourceFile("commands/showScratchOrgPool.ts");
    const credentials = readSourceFile("utils/providerCredentials.ts");
    assert.ok(credentials.includes("return { env: {}, timedOut: true };"));
    assert.strictEqual(
      (command.match(/await collectCredentials\(\)/g) || []).length,
      2,
      "the collection is tried twice",
    );
    assert.ok(
      command.includes(
        'error: { kind: "other", message: t("scratchOrgPoolCredentialsTimeout") }',
      ),
    );
  });

  test("a pool that no longer exists is forgotten, and Reset waits for the fresh answer", () => {
    const command = readSourceFile("commands/showScratchOrgPool.ts");
    assert.ok(
      command.includes('await CacheManager.delete("project", cacheKey);'),
    );
    const js = readModuleFile("scratchOrgPool", "scratchOrgPool.js");
    const html = readModuleFile("scratchOrgPool", "scratchOrgPool.html");
    assert.ok(js.includes("const resetDisabled = this.loading;"));
    assert.ok(js.includes("this.showResetModal = !this.loading;"));
    assert.ok(js.includes('"hardis-card disabled"'));
    assert.ok(html.includes("class={card.cardClass}"));
    assert.ok(html.includes("aria-disabled={card.ariaDisabled}"));
  });

  test("the pool line of the status view follows the panel and the pool commands", () => {
    assert.strictEqual(SCRATCH_ORG_POOL_COUNTS_CACHE_KEY, "scratchPoolCounts");
    const command = readSourceFile("commands/showScratchOrgPool.ts");
    const statusProvider = readSourceFile("hardis-status-provider.ts");
    assert.ok(command.includes("void updateScratchPoolStatus({"));
    assert.ok(command.includes("void updateScratchPoolStatus(null);"));
    assert.ok(
      statusProvider.includes("export async function updateScratchPoolStatus("),
    );
    assert.ok(
      statusProvider.includes("if (generation !== SCRATCH_POOL_GENERATION) {"),
    );
  });

  test("the end of a command is told to the panels in every userInput mode, and when the CLI dies", () => {
    const server = readSourceFile("hardis-websocket-server.ts");
    const closeClient = server.indexOf('data.event === "closeClient"');
    assert.ok(closeClient > -1);
    // Before the early return of the modes without a command panel
    const ended = server.indexOf("this.commandEnded(ws, String(", closeClient);
    const earlyReturn = server.indexOf(
      'this.config.get("userInput") !== "ui-lwc"',
      closeClient,
    );
    assert.ok(ended > -1 && ended < earlyReturn);
    const initClient = server.indexOf('data.event === "initClient"');
    assert.ok(
      server.indexOf("this.runningCommands.set(ws,", initClient) <
        server.indexOf('this.config.get("userInput") !== "ui-lwc"', initClient),
    );
    assert.ok(server.includes('ws.on("close", () => {'));
    assert.strictEqual(
      (server.match(/emitCommandCompleted\(/g) || []).length,
      1,
      "told once per command",
    );
  });

  test("the key is asked by VS Code in a password box, and never goes through the webview", () => {
    const command = readSourceFile("commands/showScratchOrgPool.ts");
    assert.ok(command.includes("vscode.window.showInputBox({"));
    assert.ok(command.includes("password: true"));
    assert.ok(command.includes("await storePoolEncryptionKey(key)"));
    // The raw answer of sfdx-hardis is only read through the outcome, and never logged
    assert.ok(!/poolStorage/.test(command));
    assert.ok(!/Logger\.log\([^)]*result\b/.test(command));
    const js = readModuleFile("scratchOrgPool", "scratchOrgPool.js");
    assert.ok(
      js.includes('type: "setPoolEncryptionKey", data: {} }'),
      "the component sends no value with the request",
    );
    assert.ok(
      !/lightning-input/.test(
        readModuleFile("scratchOrgPool", "scratchOrgPool.html"),
      ),
    );
  });

  test("the component launches the real pool commands and draws what it receives", () => {
    const js = readModuleFile("scratchOrgPool", "scratchOrgPool.js");
    const html = readModuleFile("scratchOrgPool", "scratchOrgPool.html");
    const commands = [...js.matchAll(/_COMMAND = "([^"]+)"/g)].map(
      ([, command]) => command,
    );
    assert.deepStrictEqual(commands, [
      "sf hardis:scratch:create",
      "sf hardis:scratch:pool:refresh --agent",
      "sf hardis:scratch:pool:reset --agent",
      "sf hardis:scratch:pool:create",
    ]);
    assert.strictEqual((js.match(/type: "runCommand"/g) || []).length, 1);
    // The pool is reset from the confirmation window only
    assert.strictEqual((js.match(/RESET_COMMAND/g) || []).length, 2);
    assert.ok(html.includes("onclick={handleResetConfirm}"));
    assert.ok(html.includes('class="hardis-btn-tinted-red"'));
    assert.ok(!html.includes("lwc:inner-html"));
    assert.ok(!html.includes("lwc:dom"));
    assert.ok(!js.includes("innerHTML"));
    // Links leave the panel through the function that checks the address
    assert.strictEqual((js.match(/type: "openExternal"/g) || []).length, 1);
    assert.ok(js.includes("const safeUrl = httpUrl(url);"));
    // No filled button, the only variant that does not follow the theme
    assert.ok(
      !/<lightning-button[^>]*variant="(brand|success|destructive)/.test(html),
    );
  });

  test("the stylesheet of the panel has no hardcoded color nor font", () => {
    const css = readModuleFile("scratchOrgPool", "scratchOrgPool.css");
    assert.ok(
      !/#[0-9a-fA-F]{3,8}\b|rgba?\(|font-family|font-weight: *[0-9]|data-theme|--vscode-/.test(
        css,
      ),
    );
  });

  test("every label of the panel is translated in the 9 locales", () => {
    const js = readModuleFile("scratchOrgPool", "scratchOrgPool.js");
    const keys = collectComponentI18nKeys("scratchOrgPool");
    for (const [, key] of js.matchAll(/"(scratchOrgPool\w+)"/g)) {
      keys.add(key);
    }
    assert.ok(keys.size > 50, `keys found: ${keys.size}`);
    assertKeysTranslated(keys);
    assertKeysTranslated(KEYS_OUTSIDE_THE_COMPONENT);
    // Every key of the panel in en.json is used, and holds no em-dash
    const used = new Set([
      ...keys,
      ...KEYS_OUTSIDE_THE_COMPONENT,
      ...KEYS_OF_OTHER_FEATURES,
    ]);
    const placeholders = (text: string) =>
      (text.match(/\{\{\w+\}\}/g) || []).sort().join(",");
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      for (const [key, value] of Object.entries(translations)) {
        if (!key.startsWith("scratchOrgPool")) {
          continue;
        }
        assert.ok(used.has(key), `unused i18n key ${key} in ${locale}.json`);
        assert.ok(
          !value.includes(String.fromCharCode(0x2014)),
          `em-dash in ${key} (${locale})`,
        );
        assert.strictEqual(
          placeholders(value),
          placeholders(loadLocale("en")[key]),
          `placeholders of ${key} in ${locale}.json`,
        );
      }
    }
    for (const key of KEYS_OUTSIDE_THE_COMPONENT.slice(1)) {
      assert.ok(
        readSourceFile("commands/showScratchOrgPool.ts").includes(
          `t("${key}")`,
        ),
        `${key} is not used by the panel command`,
      );
    }
  });

  test("the DevOps Pipeline menu opens the panel when the project has a pool", () => {
    const html = readModuleFile("pipeline", "pipeline.html");
    const js = readModuleFile("pipeline", "pipeline.js");
    assert.ok(html.includes("<template if:true={showScratchOrgPool}>"));
    assert.ok(html.includes("label={i18n.scratchOrgPoolTitle}"));
    assert.ok(html.includes("onclick={handleShowScratchOrgPool}"));
    // Right after the DORA metrics item, in the same menu
    assert.ok(
      html.indexOf("onclick={handleShowScratchOrgPool}") >
        html.indexOf("onclick={handleShowDoraMetrics}"),
    );
    assert.ok(
      html.indexOf("onclick={handleShowScratchOrgPool}") <
        html.indexOf("</lightning-button-menu>"),
    );
    assert.ok(js.includes('command: "vscode-sfdx-hardis.showScratchOrgPool"'));
    assert.ok(js.includes("this.pipelineData?.scratchOrgPoolEnabled === true"));
    assert.ok(
      readSourceFile("pipeline-data-provider.ts").includes(
        "scratchOrgPoolEnabled: isScratchOrgPoolConfigured(projectConfig)",
      ),
    );
    assert.strictEqual(
      loadLocale("en").scratchOrgPoolTitle,
      "Scratch Org Pool",
    );
  });

  test("the panel command is declared, registered and has its icon", () => {
    assertPanelCommandWired({
      commandId: "vscode-sfdx-hardis.showScratchOrgPool",
      registerCall: "registerShowScratchOrgPool(this)",
      lwcId: "s-scratch-org-pool",
      module: "scratchOrgPool",
    });
    assert.ok(
      readSourceFile("webviews/lwc-ui-panel.ts").includes(
        '"s-scratch-org-pool": t("scratchOrgPoolTitle")',
      ),
    );
    assert.strictEqual(
      PANEL_DOC_URLS["s-scratch-org-pool"],
      DOCSITE_URL + "/salesforce-devops-setup-scratch-org-pool/",
    );
  });

  test("the pool line of the status view opens the panel", () => {
    const statusProvider = readSourceFile("hardis-status-provider.ts");
    assert.ok(
      statusProvider.includes(
        'command: "vscode-sfdx-hardis.showScratchOrgPool"',
      ),
    );
    assert.ok(
      !statusProvider.includes('command: "sf hardis:scratch:pool:view"'),
    );
  });
});
