import * as assert from "assert";
import { GitProvider } from "../../utils/gitProviders/gitProvider";
import { SecretsManager } from "../../utils/secretsManager";
import { TicketProvider } from "../../utils/ticketProviders/ticketProvider";
import {
  collectProviderCredentialEnvVars,
  collectProviderCredentialEnvVarsWithStatus,
  getAccessTokenExpiresAt,
  invalidateProviderCredentialEnvCache,
  refreshProviderCredentialEnvCache,
} from "../../utils/providerCredentials";

// The credentials sent to the commands are cached, and a stale cache is served at once while it is
// refreshed in the background. That is right for a stored token, which does not expire on its own,
// and wrong for the token of a Microsoft session: about an hour after it was issued, the command
// got a token Azure DevOps rejects. The session token is therefore read again at each launch, and
// the rest of the cache is still served at once.
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
  let sessionTokens: (string | null)[];
  let sessionReads: number;
  // Number of full collections (each one checks the git provider credentials)
  let collections: number;
  // Set to hold the full collections until it is called
  let holdCollections: Promise<void> | null;
  const nextOf = <T>(values: T[]): T =>
    values.length > 1 ? (values.shift() as T) : values[0];

  setup(() => {
    storedTokens = [];
    sessionTokens = [];
    sessionReads = 0;
    collections = 0;
    holdCollections = null;
    (GitProvider as any).instancePromise = null;
    (GitProvider as any).instance = {
      isActive: true,
      hostKey: HOST_KEY,
      repoInfo: { providerName: "azure" },
      refreshCredentials: async () => {
        collections++;
        if (holdCollections) {
          await holdCollections;
        }
      },
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

  // A JWT whose exp claim is the given time (ms since epoch)
  const jwtExpiringAt = (expiresAtMs: number) => {
    const part = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${part({ alg: "none" })}.${part({ exp: Math.floor(expiresAtMs / 1000) })}.sig`;
  };

  test("a Microsoft session token is read again at each launch, even from a fresh cache", async () => {
    sessionTokens = ["token-1", "token-renewed"];

    const first = await collectProviderCredentialEnvVars();
    assert.strictEqual(first.CI_SFDX_HARDIS_AZURE_TOKEN, "token-1");
    assert.strictEqual(first.SYSTEM_ACCESSTOKEN, "token-1");

    // Still fresh: served from the cache, but the session token is read again
    const cached = await collectProviderCredentialEnvVars();
    assert.strictEqual(cached.CI_SFDX_HARDIS_AZURE_TOKEN, "token-renewed");
    assert.strictEqual(cached.SYSTEM_ACCESSTOKEN, "token-renewed");
    assert.strictEqual(collections, 1);
  });

  test("a stale cache holding a session token is served at once, never waiting on a slow collection", async () => {
    sessionTokens = ["token-1", "token-renewed"];
    await collectProviderCredentialEnvVars();

    letTheCacheGoStale();
    // The background refresh hangs, like an unreachable ticketing host
    let release = () => {};
    holdCollections = new Promise<void>((resolve) => (release = resolve));
    const started = originalDateNow();
    const stale = await collectProviderCredentialEnvVarsWithStatus();
    assert.ok(
      originalDateNow() - started < 1000,
      "the launch waited for the collection",
    );
    assert.strictEqual(stale.timedOut, false);
    assert.strictEqual(stale.env.CI_SFDX_HARDIS_AZURE_TOKEN, "token-renewed");
    assert.strictEqual(collections, 2);
    release();
    await refreshProviderCredentialEnvCache();
  });

  test("a signed-out session gives the command no token, not the cached one", async () => {
    sessionTokens = ["token-1", null];
    await collectProviderCredentialEnvVars();

    const signedOut = await collectProviderCredentialEnvVars();
    assert.strictEqual(signedOut.CI_SFDX_HARDIS_AZURE_TOKEN, undefined);
    assert.strictEqual(signedOut.SYSTEM_ACCESSTOKEN, undefined);
  });

  test("launches that find no cache share one collection", async () => {
    sessionTokens = ["token-1"];
    let release = () => {};
    holdCollections = new Promise<void>((resolve) => (release = resolve));

    const launches = Promise.all([
      collectProviderCredentialEnvVars(),
      collectProviderCredentialEnvVars(),
      refreshProviderCredentialEnvCache(),
    ]);
    release();
    const [first, second] = await launches;

    assert.strictEqual(collections, 1);
    assert.strictEqual(first.CI_SFDX_HARDIS_AZURE_TOKEN, "token-1");
    assert.strictEqual(second.CI_SFDX_HARDIS_AZURE_TOKEN, "token-1");
  });

  test("tells when the session token given to the command expires", async () => {
    const expiresAt = originalDateNow() + 10 * 60 * 1000;
    sessionTokens = [jwtExpiringAt(expiresAt)];

    const collected = await collectProviderCredentialEnvVarsWithStatus();
    const cached = await collectProviderCredentialEnvVarsWithStatus();

    // exp is in seconds
    const expected = Math.floor(expiresAt / 1000) * 1000;
    assert.strictEqual(collected.sessionTokenExpiresAt, expected);
    assert.strictEqual(cached.sessionTokenExpiresAt, expected);
  });

  test("reads the expiry of a JWT, and none from a Personal Access Token", () => {
    assert.strictEqual(
      getAccessTokenExpiresAt(jwtExpiringAt(1_700_000_000_000)),
      1_700_000_000_000,
    );
    assert.strictEqual(
      getAccessTokenExpiresAt(
        "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop",
      ),
      null,
    );
    assert.strictEqual(getAccessTokenExpiresAt("a.not-base64-json.c"), null);
  });

  test("a stored token is served stale at once, and refreshed in the background", async () => {
    storedTokens = ["pat-1", "pat-2"];
    sessionTokens = ["session-token"];

    const first = await collectProviderCredentialEnvVarsWithStatus();
    assert.strictEqual(first.env.CI_SFDX_HARDIS_AZURE_TOKEN, "pat-1");
    assert.strictEqual(first.sessionTokenExpiresAt, null);

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
