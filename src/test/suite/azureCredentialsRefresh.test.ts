import * as assert from "assert";
import { BearerCredentialHandler } from "azure-devops-node-api/handlers/bearertoken";
import { SecretsManager } from "../../utils/secretsManager";
import { newAzureProviderStub } from "./azureProviderStub";

// The provider instance lives as long as the window, and the Microsoft session token it was built
// with expires after about an hour: every call then failed with 401 and was answered with an empty
// list while the provider still looked connected. With several windows open, only the one
// initialized last showed Azure DevOps data.
suite("GitProviderAzure credentials refresh", () => {
  // No extension context in the unit tests: no explicit disconnect is stored
  const originalGetSecret = SecretsManager.getSecret;
  setup(() => {
    (SecretsManager as any).getSecret = async () => undefined;
  });
  teardown(() => {
    (SecretsManager as any).getSecret = originalGetSecret;
  });

  const buildProvider = (tokens: (string | null)[]) => {
    const provider = newAzureProviderStub();
    provider.credentialsCheckedAt = 0;
    provider.credentialsCheck = null;
    provider.lastTriedOAuthToken = null;
    provider.usesPersonalAccessToken = false;
    provider.hostKey = "DEV_AZURE_COM";
    provider.resetPullRequestBuildIndex = () => {};
    let call = 0;
    provider.getOAuthAccessToken = async () =>
      tokens[Math.min(call++, tokens.length - 1)];
    return provider;
  };

  test("swaps a renewed session token into the handler the API clients share", async () => {
    const provider = buildProvider(["fresh-token"]);
    const handler = new BearerCredentialHandler("expired-token");
    provider.oauthHandler = handler;
    provider.isActive = true;

    await provider.refreshCredentials();

    assert.strictEqual(handler.token, "fresh-token");
  });

  test("reads the session at most once a minute", async () => {
    const provider = buildProvider(["token-1", "token-2"]);
    const handler = new BearerCredentialHandler("token-0");
    provider.oauthHandler = handler;
    provider.isActive = true;

    await provider.refreshCredentials();
    await provider.refreshCredentials();

    assert.strictEqual(handler.token, "token-1");
  });

  test("never touches a provider connected with a PAT", async () => {
    const provider = buildProvider(["oauth-token"]);
    provider.usesPersonalAccessToken = true;
    provider.isActive = false;
    let initialized = false;
    provider.initialize = async () => {
      initialized = true;
    };

    await provider.refreshCredentials();

    assert.strictEqual(initialized, false);
  });

  test("connects a window that started before the session was there, once per session", async () => {
    const provider = buildProvider(["new-token"]);
    provider.isActive = false;
    let initializations = 0;
    provider.initialize = async () => {
      initializations++;
    };

    await provider.refreshCredentials();
    provider.credentialsCheckedAt = 0;
    await provider.refreshCredentials();

    assert.strictEqual(initializations, 1);
  });
});
