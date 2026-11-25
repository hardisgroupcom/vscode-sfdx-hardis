import * as assert from "assert";
import { GitProvider } from "../../utils/gitProviders/gitProvider";
import { SecretsManager } from "../../utils/secretsManager";
import { TicketProvider } from "../../utils/ticketProviders/ticketProvider";
import {
  collectProviderCredentialEnvVars,
  invalidateProviderCredentialEnvCache,
  refreshProviderCredentialEnvCache,
} from "../../utils/providerCredentials";

// The credentials sent to the commands are cached, and a stale cache is served at once while it is
// refreshed in the background. That is right for a stored token, which does not expire on its own,
// and wrong for the token of a Microsoft session: about an hour after it was issued, the command
// got a token Azure DevOps rejects.
suite("Provider credentials cache", () => {
  const HOST_KEY = "DEV_AZURE_COM";
  const PAST_CACHE_LIFETIME_MS = 10 * 60 * 1000;

  const originalInstance = (GitProvider as any).instance;
  const originalPromise = (GitProvider as any).instancePromise;
  const originalDetectRepoInfo = GitProvider.detectRepoInfo;
  const originalGetSecret = SecretsManager.getSecret;
  const originalTicketGetInstance = TicketProvider.getInstance;
  const originalDateNow = Date.now;

  // What the secret storage and the Microsoft session answer, read after read
  let storedTokens: string[];
  let sessionTokens: string[];
  let sessionReads: number;
  const nextOf = (values: string[]) =>
    values.length > 1 ? (values.shift() as string) : values[0];

  setup(() => {
    storedTokens = [];
    sessionTokens = [];
    sessionReads = 0;
    (GitProvider as any).instancePromise = null;
    (GitProvider as any).instance = {
      isActive: true,
      hostKey: HOST_KEY,
      repoInfo: { providerName: "azure" },
      refreshCredentials: async () => {},
      getNativeSessionToken: async () => {
        sessionReads++;
        return sessionTokens.length ? nextOf(sessionTokens) : null;
      },
    };
    (GitProvider as any).detectRepoInfo = async () => null;
    (SecretsManager as any).getSecret = async (key: string) =>
      key === HOST_KEY + "_TOKEN" && storedTokens.length
        ? nextOf(storedTokens)
        : undefined;
    (TicketProvider as any).getInstance = async () => null;
    invalidateProviderCredentialEnvCache();
  });

  teardown(() => {
    Date.now = originalDateNow;
    (GitProvider as any).instance = originalInstance;
    (GitProvider as any).instancePromise = originalPromise;
    (GitProvider as any).detectRepoInfo = originalDetectRepoInfo;
    (SecretsManager as any).getSecret = originalGetSecret;
    (TicketProvider as any).getInstance = originalTicketGetInstance;
    invalidateProviderCredentialEnvCache();
  });

  const letTheCacheGoStale = () => {
    const now = originalDateNow();
    Date.now = () => now + PAST_CACHE_LIFETIME_MS;
  };

  test("a Microsoft session token is read again once the cache is stale", async () => {
    sessionTokens = ["token-1", "token-renewed"];

    const first = await collectProviderCredentialEnvVars();
    assert.strictEqual(first.CI_SFDX_HARDIS_AZURE_TOKEN, "token-1");
    assert.strictEqual(first.SYSTEM_ACCESSTOKEN, "token-1");

    // Still fresh: served from the cache, the session is not read again
    const cached = await collectProviderCredentialEnvVars();
    assert.strictEqual(cached.CI_SFDX_HARDIS_AZURE_TOKEN, "token-1");
    assert.strictEqual(sessionReads, 1);

    letTheCacheGoStale();
    const afterExpiry = await collectProviderCredentialEnvVars();
    assert.strictEqual(afterExpiry.CI_SFDX_HARDIS_AZURE_TOKEN, "token-renewed");
    assert.strictEqual(afterExpiry.SYSTEM_ACCESSTOKEN, "token-renewed");
  });

  test("a stored token is served stale at once, and refreshed in the background", async () => {
    storedTokens = ["pat-1", "pat-2"];
    sessionTokens = ["session-token"];

    const first = await collectProviderCredentialEnvVars();
    assert.strictEqual(first.CI_SFDX_HARDIS_AZURE_TOKEN, "pat-1");

    letTheCacheGoStale();
    const stale = await collectProviderCredentialEnvVars();
    assert.strictEqual(stale.CI_SFDX_HARDIS_AZURE_TOKEN, "pat-1");

    // The refresh the stale read started
    await refreshProviderCredentialEnvCache();
    const refreshed = await collectProviderCredentialEnvVars();
    assert.strictEqual(refreshed.CI_SFDX_HARDIS_AZURE_TOKEN, "pat-2");
    // The stored token wins: the Microsoft session is never read
    assert.strictEqual(sessionReads, 0);
  });
});
