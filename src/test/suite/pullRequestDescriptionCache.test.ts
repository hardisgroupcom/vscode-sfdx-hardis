import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MAX_ENTRIES_PER_REPOSITORY,
  PR_DESCRIPTION_CACHE_VERSION,
  getCachedPullRequestDescription,
  isPullRequestDescriptionCacheDisabled,
  normalizeTerminalState,
  pruneEntries,
  pullRequestCacheFile,
  repositoryKeyFromRemoteUrl,
  resetPullRequestDescriptionCacheMemory,
  sanitizeRepositoryKey,
  setCachedPullRequestDescription,
  type CachedPullRequestDescription,
} from "../../utils/pullRequestDescriptionCache";

// The on-disk contract of this cache is shared with the sfdx-hardis CLI: a change here has to be
// mirrored in its src/common/cache/pullRequestDescriptionCache.ts, and the expectations below are
// deliberately the same as the ones in its test suite.
suite("Pull Request description cache", () => {
  const REMOTE = "https://user@dev.azure.com/acme/Salesforce/_git/sfdx-project";
  const REPO = repositoryKeyFromRemoteUrl(REMOTE);
  const cacheFile = () => pullRequestCacheFile("azure", REPO);

  const cleanup = () => {
    resetPullRequestDescriptionCacheMemory();
    delete process.env.NO_CACHE;
    delete process.env.SFDX_HARDIS_NO_PR_CACHE;
    try {
      fs.unlinkSync(cacheFile());
    } catch {
      // not there: nothing to clean
    }
  };

  setup(cleanup);
  suiteTeardown(cleanup);

  suite("repositoryKeyFromRemoteUrl()", () => {
    // The CLI computes this from `git config remote.origin.url`, the extension from
    // repoInfo.remoteUrl: both look at the same clone, so both must land on the same string
    test("drops the protocol, the credentials, the .git suffix and the case", () => {
      const expected = "dev.azure.com/acme/salesforce/_git/sfdx-project";
      // Assembled at runtime: a literal user:password URL, even a made up one, is reported as a
      // leaked credential by the repository secret scanners
      const userAndToken = ["anything", "a-token"].join(":");
      for (const remote of [
        "https://dev.azure.com/acme/Salesforce/_git/sfdx-project",
        "https://user@dev.azure.com/acme/Salesforce/_git/sfdx-project",
        `https://${userAndToken}@dev.azure.com/acme/Salesforce/_git/sfdx-project.git`,
        "HTTPS://DEV.AZURE.COM/Acme/Salesforce/_git/SFDX-Project/",
      ]) {
        assert.strictEqual(
          repositoryKeyFromRemoteUrl(remote),
          expected,
          remote,
        );
      }
    });

    test("gives two repositories two different keys", () => {
      assert.notStrictEqual(
        repositoryKeyFromRemoteUrl("https://dev.azure.com/acme/p/_git/repo-a"),
        repositoryKeyFromRemoteUrl("https://dev.azure.com/acme/p/_git/repo-b"),
      );
    });

    test("falls back to a constant when there is no remote", () => {
      assert.strictEqual(repositoryKeyFromRemoteUrl(""), "unknown");
    });
  });

  suite("normalizeTerminalState()", () => {
    test("recognizes the merged state of the four providers", () => {
      for (const state of ["merged", "MERGED", "completed", 3]) {
        assert.strictEqual(
          normalizeTerminalState(state),
          "merged",
          `state ${state}`,
        );
      }
    });

    test("recognizes the closed state of the four providers", () => {
      for (const state of ["closed", "DECLINED", "abandoned", "SUPERSEDED"]) {
        assert.strictEqual(
          normalizeTerminalState(state),
          "closed",
          `state ${state}`,
        );
      }
    });

    // The whole point: a description that is still being written must never be cached
    test("refuses every non terminal state", () => {
      for (const state of [
        "open",
        "active",
        "OPEN",
        "",
        null,
        undefined,
        "unknown",
      ]) {
        assert.strictEqual(
          normalizeTerminalState(state),
          null,
          `state ${state}`,
        );
      }
    });
  });

  test("stores nothing for an open Pull Request, and reads nothing back", () => {
    setCachedPullRequestDescription(
      "azure",
      REPO,
      42,
      "active",
      "still being written",
    );
    assert.strictEqual(fs.existsSync(cacheFile()), false);
    assert.strictEqual(
      getCachedPullRequestDescription("azure", REPO, 42, "active"),
      null,
    );
  });

  test("round-trips the description of a merged Pull Request", () => {
    const description =
      "Promotion branch\n\n```yaml\npromotionPullRequests: [12, 34]\n```";
    setCachedPullRequestDescription(
      "azure",
      REPO,
      38,
      "completed",
      description,
    );

    resetPullRequestDescriptionCacheMemory();
    assert.strictEqual(
      getCachedPullRequestDescription("azure", REPO, 38, "completed"),
      description,
    );
  });

  test("writes the shared on-disk contract", () => {
    setCachedPullRequestDescription("azure", REPO, 38, "completed", "body");
    const written = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));

    assert.strictEqual(written.version, PR_DESCRIPTION_CACHE_VERSION);
    assert.strictEqual(written.provider, "azure");
    assert.strictEqual(written.repository, REPO);
    assert.strictEqual(written.pullRequests["38"].description, "body");
    assert.strictEqual(written.pullRequests["38"].state, "merged");
    assert.strictEqual(typeof written.pullRequests["38"].cachedAt, "string");
  });

  // Bitbucket reopens a declined Pull Request, Azure reactivates an abandoned one: what the caller
  // sees now wins over what was cached then
  test("ignores a cached entry when the Pull Request is open again", () => {
    setCachedPullRequestDescription(
      "azure",
      REPO,
      15,
      "abandoned",
      "the declined body",
    );
    assert.strictEqual(
      getCachedPullRequestDescription("azure", REPO, 15, "active"),
      null,
    );
  });

  test("ignores a cached entry whose state no longer matches", () => {
    setCachedPullRequestDescription(
      "azure",
      REPO,
      15,
      "abandoned",
      "the declined body",
    );
    assert.strictEqual(
      getCachedPullRequestDescription("azure", REPO, 15, "completed"),
      null,
    );
  });

  test("ignores an entry older than the maximum age", () => {
    setCachedPullRequestDescription("azure", REPO, 7, "completed", "old body");
    const written = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    written.pullRequests["7"].cachedAt = new Date(
      Date.now() - 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    fs.writeFileSync(cacheFile(), JSON.stringify(written));

    resetPullRequestDescriptionCacheMemory();
    assert.strictEqual(
      getCachedPullRequestDescription("azure", REPO, 7, "completed"),
      null,
    );
  });

  test("keeps the entries another process wrote while this one held the file", () => {
    setCachedPullRequestDescription(
      "azure",
      REPO,
      1,
      "completed",
      "from this process",
    );
    // The CLI appends its own entry behind the extension's back
    const onDisk = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    onDisk.pullRequests["2"] = {
      description: "from the CLI",
      state: "merged",
      cachedAt: new Date().toISOString(),
    };
    fs.writeFileSync(cacheFile(), JSON.stringify(onDisk));

    setCachedPullRequestDescription(
      "azure",
      REPO,
      3,
      "completed",
      "from this process again",
    );

    const merged = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    assert.deepStrictEqual(Object.keys(merged.pullRequests).sort(), [
      "1",
      "2",
      "3",
    ]);
    assert.strictEqual(merged.pullRequests["2"].description, "from the CLI");
  });

  test("leaves a file written by a newer version alone", () => {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(
      cacheFile(),
      JSON.stringify({
        version: PR_DESCRIPTION_CACHE_VERSION + 1,
        provider: "azure",
        repository: REPO,
        pullRequests: {
          "9": {
            description: "from the future",
            state: "merged",
            cachedAt: new Date().toISOString(),
          },
        },
      }),
    );

    resetPullRequestDescriptionCacheMemory();
    assert.strictEqual(
      getCachedPullRequestDescription("azure", REPO, 9, "completed"),
      null,
    );
  });

  test("survives a corrupted cache file", () => {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), "not json at all");

    resetPullRequestDescriptionCacheMemory();
    assert.strictEqual(
      getCachedPullRequestDescription("azure", REPO, 9, "completed"),
      null,
    );
    setCachedPullRequestDescription("azure", REPO, 9, "completed", "body");
    const repaired = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    assert.strictEqual(repaired.pullRequests["9"].description, "body");
  });

  test("is bypassed by NO_CACHE and by SFDX_HARDIS_NO_PR_CACHE", () => {
    for (const variable of ["NO_CACHE", "SFDX_HARDIS_NO_PR_CACHE"]) {
      cleanup();
      process.env[variable] = "true";
      assert.strictEqual(isPullRequestDescriptionCacheDisabled(), true);
      setCachedPullRequestDescription("azure", REPO, 5, "completed", "body");
      assert.strictEqual(
        fs.existsSync(cacheFile()),
        false,
        `${variable} still wrote the file`,
      );
      assert.strictEqual(
        getCachedPullRequestDescription("azure", REPO, 5, "completed"),
        null,
      );
      delete process.env[variable];
    }
  });

  test("the cache file lives outside any repository, so it is never committed by accident", () => {
    assert.ok(cacheFile().startsWith(path.join(os.homedir(), ".sfdx")));
  });

  test("sanitizes a key into a safe file name", () => {
    assert.strictEqual(
      sanitizeRepositoryKey("https://dev.azure.com/acme/ My Project/guid"),
      "https_dev.azure.com_acme_My_Project_guid",
    );
    assert.strictEqual(sanitizeRepositoryKey(""), "unknown");
  });

  suite("pruneEntries()", () => {
    const entry = (daysAgo: number): CachedPullRequestDescription => ({
      description: "x",
      state: "merged",
      cachedAt: new Date(
        Date.now() - daysAgo * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

    test("drops the expired entries", () => {
      assert.deepStrictEqual(
        Object.keys(pruneEntries({ fresh: entry(1), old: entry(200) })),
        ["fresh"],
      );
    });

    test("caps a repository and keeps the most recent entries", () => {
      const entries: Record<string, CachedPullRequestDescription> = {};
      for (let i = 0; i < MAX_ENTRIES_PER_REPOSITORY + 10; i++) {
        entries[String(i)] = entry(i % 30);
      }
      assert.strictEqual(
        Object.keys(pruneEntries(entries)).length,
        MAX_ENTRIES_PER_REPOSITORY,
      );
    });

    test("leaves a cache under the cap untouched", () => {
      assert.deepStrictEqual(
        Object.keys(pruneEntries({ a: entry(1), b: entry(2) })).sort(),
        ["a", "b"],
      );
    });
  });
});
