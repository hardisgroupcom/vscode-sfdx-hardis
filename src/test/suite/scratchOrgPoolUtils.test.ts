import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  POOL_ENCRYPTION_KEY_ENV_VAR,
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
  REPO_ROOT,
  assertKeysTranslated,
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
        instanceUrl: "https://acme-1.scratch.my.salesforce.com",
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
          instanceUrl: "",
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
    assert.strictEqual(
      POOL_ENCRYPTION_KEY_ENV_VAR,
      "SFDX_HARDIS_POOL_ENCRYPTION_KEY",
    );
    const envFile = readSourceFile("utils/envFileCredentials.ts");
    assert.ok(
      envFile.includes(`poolEncryptionKey: ["${POOL_ENCRYPTION_KEY_ENV_VAR}"]`),
    );
    const credentials = readSourceFile("utils/providerCredentials.ts");
    // Never printed in a terminal command line
    assert.ok(
      credentials
        .slice(
          credentials.indexOf("SECRET_ENV_KEYS = new Set(["),
          credentials.indexOf("]);", credentials.indexOf("SECRET_ENV_KEYS")),
        )
        .includes(`"${POOL_ENCRYPTION_KEY_ENV_VAR}"`),
    );
    assert.ok(
      credentials.includes(
        `env.${POOL_ENCRYPTION_KEY_ENV_VAR} = poolEncryptionKey;`,
      ),
    );
    assert.ok(credentials.includes("PROVIDER_ENV_VAR_NAMES.poolEncryptionKey"));
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
    const html = readModuleFile("scratchOrgPool", "scratchOrgPool.html");
    const keys = new Set<string>();
    for (const [, key] of html.matchAll(/\{i18n\.(\w+)\}/g)) {
      keys.add(key);
    }
    for (const [, key] of js.matchAll(/this\.i18n\.(\w+)/g)) {
      keys.add(key);
    }
    for (const [, key] of js.matchAll(/this\.t\(\s*"(\w+)"/g)) {
      keys.add(key);
    }
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
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    assert.ok(
      packageJson.contributes.commands.some(
        (command: any) =>
          command.command === "vscode-sfdx-hardis.showScratchOrgPool",
      ),
    );
    assert.ok(
      readSourceFile("commands.ts").includes(
        "registerShowScratchOrgPool(this)",
      ),
    );
    assert.ok(
      readSourceFile("utils/themeUtils.ts").includes(
        '"vscode-sfdx-hardis.showScratchOrgPool"',
      ),
    );
    assert.ok(
      readSourceFile("hardis-commands-provider.ts").includes(
        'command: "vscode-sfdx-hardis.showScratchOrgPool"',
      ),
    );
    assert.ok(
      readSourceFile("webviews/lwc-ui/index.js").includes(
        '"s-scratch-org-pool": () => import("s/scratchOrgPool")',
      ),
    );
    assert.ok(
      readSourceFile("webviews/lwc-ui-panel.ts").includes(
        '"s-scratch-org-pool": t("scratchOrgPoolTitle")',
      ),
    );
    assert.ok(
      readSourceFile("constants.ts").includes(
        '"s-scratch-org-pool": DOCSITE_URL + "/salesforce-devops-setup-scratch-org-pool/"',
      ),
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
