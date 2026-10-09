import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ENV_FILE_CREDENTIAL_KEYS,
  PROVIDER_ENV_VAR_NAMES,
  parseEnvFile,
  readEnvFileCredentials,
} from "../../utils/envFileCredentials";
import { SecretsManager } from "../../utils/secretsManager";
import { SECRET_ENV_KEYS } from "../../utils/providerCredentials";

const ALL_KEYS = ENV_FILE_CREDENTIAL_KEYS;

/**
 * The `.env` file at the root of the opened repository is a source of provider
 * credentials. The parser and the resolution order are pure, so they are
 * covered here without a secret store nor a workspace.
 */
suite("Provider credentials of the workspace .env file", () => {
  test("every supported syntax of a line is read", () => {
    const content = [
      "# the git provider",
      "GITHUB_TOKEN=ghp_plain",
      "export CI_SFDX_HARDIS_GITLAB_TOKEN=glpat-exported",
      "",
      "JIRA_EMAIL='single quoted'",
      'JIRA_TOKEN="double quoted"',
      "SERVICENOW_PASSWORD=pass=with=equals",
      "   AHA_API_KEY   =   spaced   ",
      "SERVICENOW_USERNAME=user # a comment after the value",
      "CI_SFDX_HARDIS_BITBUCKET_TOKEN=token#not-a-comment",
    ].join("\n");
    assert.deepStrictEqual(parseEnvFile(content, ALL_KEYS), {
      GITHUB_TOKEN: "ghp_plain",
      CI_SFDX_HARDIS_GITLAB_TOKEN: "glpat-exported",
      JIRA_EMAIL: "single quoted",
      JIRA_TOKEN: "double quoted",
      SERVICENOW_PASSWORD: "pass=with=equals",
      AHA_API_KEY: "spaced",
      SERVICENOW_USERNAME: "user",
      CI_SFDX_HARDIS_BITBUCKET_TOKEN: "token#not-a-comment",
    });
  });

  test("CRLF line endings do not leak into the values", () => {
    const content = 'GITHUB_TOKEN=abc\r\nJIRA_PAT="def"\r\n';
    assert.deepStrictEqual(parseEnvFile(content, ALL_KEYS), {
      GITHUB_TOKEN: "abc",
      JIRA_PAT: "def",
    });
  });

  test("a quoted value keeps its # and its spaces, and \\n is a line break in double quotes", () => {
    const content = [
      "JIRA_TOKEN=' with # inside '",
      'SERVICENOW_PASSWORD="line1\\nline2"',
      "GITHUB_TOKEN='no\\nexpansion'",
    ].join("\n");
    assert.deepStrictEqual(parseEnvFile(content, ALL_KEYS), {
      JIRA_TOKEN: " with # inside ",
      SERVICENOW_PASSWORD: "line1\nline2",
      GITHUB_TOKEN: "no\\nexpansion",
    });
  });

  test("only the credential variables of the providers are kept", () => {
    // A project .env holds many other things that have no business in memory
    const content = [
      "DATABASE_URL=postgres://user:pass@host/db",
      "SF_ORG_ALIAS=myorg",
      "GITHUB_TOKEN=ghp_kept",
      "GITHUB_TOKEN_OTHER=not-a-provider-key",
    ].join("\n");
    assert.deepStrictEqual(parseEnvFile(content, ALL_KEYS), {
      GITHUB_TOKEN: "ghp_kept",
    });
  });

  test("the last definition wins and an empty value is no value", () => {
    const content = ["GITHUB_TOKEN=first", "GITHUB_TOKEN=second"].join("\n");
    assert.deepStrictEqual(parseEnvFile(content, ALL_KEYS), {
      GITHUB_TOKEN: "second",
    });
    assert.deepStrictEqual(
      parseEnvFile("GITHUB_TOKEN=\nJIRA_PAT=''", ALL_KEYS),
      {},
    );
  });

  test("malformed lines are skipped, not fatal", () => {
    const content = [
      "this is not a variable",
      "=orphan",
      "GITHUB_TOKEN",
      "JIRA_PAT=ok",
    ].join("\n");
    assert.deepStrictEqual(parseEnvFile(content, ALL_KEYS), {
      JIRA_PAT: "ok",
    });
  });

  test("a missing file is an empty result", () => {
    assert.deepStrictEqual(
      readEnvFileCredentials(
        path.join(os.tmpdir(), "vscode-sfdx-hardis-no-such-dir", ".env"),
      ),
      {},
    );
  });

  test("the file on disk is read with the allow-list", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sfdx-hardis-env-"));
    const filePath = path.join(dir, ".env");
    try {
      fs.writeFileSync(
        filePath,
        "OTHER=ignored\r\nSERVICENOW_URL=acme.service-now.com\r\n",
      );
      assert.deepStrictEqual(readEnvFileCredentials(filePath), {
        SERVICENOW_URL: "acme.service-now.com",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the allow-list is the union of the provider variables, and every secret one is masked", () => {
    for (const names of Object.values(PROVIDER_ENV_VAR_NAMES)) {
      for (const name of names) {
        assert.ok(ALL_KEYS.has(name), `${name} is not readable from .env`);
      }
    }
    // A variable read from .env travels to the commands the extension launches:
    // the secret ones must never be printed in a terminal command line
    for (const name of [
      ...PROVIDER_ENV_VAR_NAMES.githubToken,
      ...PROVIDER_ENV_VAR_NAMES.gitlabToken,
      ...PROVIDER_ENV_VAR_NAMES.azureToken,
      ...PROVIDER_ENV_VAR_NAMES.bitbucketToken,
      ...PROVIDER_ENV_VAR_NAMES.jiraPat,
      ...PROVIDER_ENV_VAR_NAMES.jiraToken,
      ...PROVIDER_ENV_VAR_NAMES.serviceNowPassword,
      ...PROVIDER_ENV_VAR_NAMES.ahaApiKey,
    ]) {
      assert.ok(SECRET_ENV_KEYS.has(name), `${name} is not in SECRET_ENV_KEYS`);
    }
  });
});

/**
 * Where a credential comes from, once the secret storage had nothing: the
 * process environment, then the `.env` file. The source is what lets a
 * provider stay quiet when credentials the user never entered do not work.
 */
suite("Provider credential resolution order", () => {
  const key = "GITHUB_COM_TOKEN";
  const envNames = PROVIDER_ENV_VAR_NAMES.githubToken;
  const envFileOf = (values: Record<string, string>) => (name: string) =>
    values[name];

  test("the process environment wins over the .env file", () => {
    const resolved = SecretsManager.resolveFromEnvironment(key, envNames, {
      processEnv: { GITHUB_TOKEN: "from-process" },
      envFile: envFileOf({ GITHUB_TOKEN: "from-file" }),
      suppressedKeys: new Set(),
    });
    assert.deepStrictEqual(resolved, {
      value: "from-process",
      source: "process",
    });
  });

  test("the storage key itself is still read from the process environment", () => {
    const resolved = SecretsManager.resolveFromEnvironment(key, envNames, {
      processEnv: { GITHUB_COM_TOKEN: "legacy" },
      envFile: envFileOf({}),
      suppressedKeys: new Set(),
    });
    assert.deepStrictEqual(resolved, { value: "legacy", source: "process" });
  });

  test("the .env file is the last source, under the names the CLI reads", () => {
    const resolved = SecretsManager.resolveFromEnvironment(key, envNames, {
      processEnv: {},
      envFile: envFileOf({ CI_SFDX_HARDIS_GITHUB_TOKEN: "from-file" }),
      suppressedKeys: new Set(),
    });
    assert.deepStrictEqual(resolved, {
      value: "from-file",
      source: "envFile",
    });
  });

  test("a key named like its variable is read from the .env file too", () => {
    // ServiceNow stores its values under the CI/CD variable names themselves
    const resolved = SecretsManager.resolveFromEnvironment(
      "SERVICENOW_URL",
      PROVIDER_ENV_VAR_NAMES.serviceNowUrl,
      {
        processEnv: {},
        envFile: envFileOf({ SERVICENOW_URL: "acme.service-now.com" }),
        suppressedKeys: new Set(),
      },
    );
    assert.deepStrictEqual(resolved, {
      value: "acme.service-now.com",
      source: "envFile",
    });
  });

  test("nothing anywhere is undefined", () => {
    assert.strictEqual(
      SecretsManager.resolveFromEnvironment(key, envNames, {
        processEnv: {},
        envFile: envFileOf({}),
        suppressedKeys: new Set(),
      }),
      undefined,
    );
  });

  test("a key deleted during the session is no longer read from the environment", () => {
    // Otherwise a Disconnect would be undone on the spot by the .env file
    const suppressedKeys = new Set([key]);
    assert.strictEqual(
      SecretsManager.resolveFromEnvironment(key, envNames, {
        processEnv: { GITHUB_TOKEN: "from-process" },
        envFile: envFileOf({ GITHUB_TOKEN: "from-file" }),
        suppressedKeys,
      }),
      undefined,
    );
    // Another key is not affected
    assert.deepStrictEqual(
      SecretsManager.resolveFromEnvironment("GITLAB_COM_TOKEN", envNames, {
        processEnv: {},
        envFile: envFileOf({ GITHUB_TOKEN: "from-file" }),
        suppressedKeys,
      }),
      { value: "from-file", source: "envFile" },
    );
  });
});
