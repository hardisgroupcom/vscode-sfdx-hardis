import * as assert from "assert";
import { BearerCredentialHandler } from "azure-devops-node-api/handlers/bearertoken";
import { SecretsManager } from "../../utils/secretsManager";
import { GitProvider } from "../../utils/gitProviders/gitProvider";
import { newAzureProviderStub } from "./azureProviderStub";

// What getOAuthSession() answers: a session, no session, or a read failure
type SessionRead =
  { id: string; accessToken: string } | null | { failed: true };

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

  const buildProvider = (reads: SessionRead[]) => {
    const provider = newAzureProviderStub();
    provider.credentialsCheckedAt = 0;
    provider.credentialsCheck = null;
    provider.lastTriedOAuthSessionId = null;
    provider.usesPersonalAccessToken = false;
    provider.hostKey = "DEV_AZURE_COM";
    provider.resetPullRequestBuildIndex = () => {};
    let call = 0;
    provider.getOAuthSession = async () => {
      const read = reads[Math.min(call++, reads.length - 1)];
      if (read && "failed" in read) {
        return { session: null, failed: true };
      }
      return { session: read, failed: false };
    };
    return provider;
  };

  test("swaps a renewed session token into the handler the API clients share", async () => {
    const provider = buildProvider([
      { id: "session-1", accessToken: "fresh-token" },
    ]);
    const handler = new BearerCredentialHandler("expired-token");
    provider.oauthHandler = handler;
    provider.isActive = true;

    await provider.refreshCredentials();

    assert.strictEqual(handler.token, "fresh-token");
  });

  test("reads the session at most once a minute", async () => {
    const provider = buildProvider([
      { id: "session-1", accessToken: "token-1" },
      { id: "session-1", accessToken: "token-2" },
    ]);
    const handler = new BearerCredentialHandler("token-0");
    provider.oauthHandler = handler;
    provider.isActive = true;

    await provider.refreshCredentials();
    await provider.refreshCredentials();

    assert.strictEqual(handler.token, "token-1");
  });

  test("never touches a provider connected with a PAT", async () => {
    const provider = buildProvider([
      { id: "session-1", accessToken: "oauth-token" },
    ]);
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
    const provider = buildProvider([
      { id: "session-1", accessToken: "new-token" },
    ]);
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

  test("does not retry a failed session when only its token was renewed", async () => {
    const provider = buildProvider([
      { id: "session-1", accessToken: "token-renewed" },
    ]);
    provider.isActive = false;
    provider.lastTriedOAuthSessionId = "session-1";
    let initializations = 0;
    provider.initialize = async () => {
      initializations++;
    };

    await provider.refreshCredentials();

    assert.strictEqual(initializations, 0);
  });

  test("shows a signed out session as not connected, and connects again at the next sign in", async () => {
    const provider = buildProvider([
      null,
      { id: "session-2", accessToken: "token-2" },
    ]);
    provider.oauthHandler = new BearerCredentialHandler("token-1");
    provider.isActive = true;
    provider.lastTriedOAuthSessionId = "session-1";
    let initializations = 0;
    provider.initialize = async () => {
      initializations++;
    };

    await provider.refreshCredentials();
    assert.strictEqual(provider.isActive, false);
    assert.strictEqual(provider.oauthHandler, null);

    provider.credentialsCheckedAt = 0;
    await provider.refreshCredentials();
    assert.strictEqual(initializations, 1);
  });

  test("keeps the connection when the session cannot be read", async () => {
    const provider = buildProvider([{ failed: true }]);
    const handler = new BearerCredentialHandler("token-1");
    provider.oauthHandler = handler;
    provider.isActive = true;

    await provider.refreshCredentials();

    assert.strictEqual(provider.isActive, true);
    assert.strictEqual(handler.token, "token-1");
  });
});

suite("GitProvider.getInstance credentials refresh", () => {
  const originalInstance = (GitProvider as any).instance;
  const originalPromise = (GitProvider as any).instancePromise;
  teardown(() => {
    (GitProvider as any).instance = originalInstance;
    (GitProvider as any).instancePromise = originalPromise;
  });

  test("hands out the cached instance when its credentials check fails", async () => {
    const cached = {
      refreshCredentials: async () => {
        throw new Error("secret storage unavailable");
      },
    };
    (GitProvider as any).instance = cached;
    (GitProvider as any).instancePromise = null;

    assert.strictEqual(await GitProvider.getInstance(), cached);
  });

  test("waits for the first initialization instead of checking credentials during it", async () => {
    let checks = 0;
    const building = {
      refreshCredentials: async () => {
        checks++;
      },
    };
    (GitProvider as any).instance = building;
    (GitProvider as any).instancePromise = Promise.resolve(building);

    assert.strictEqual(await GitProvider.getInstance(), building);
    assert.strictEqual(checks, 0);
  });
});
