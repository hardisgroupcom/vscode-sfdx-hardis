import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MAX_ENTRIES_PER_REPOSITORY,
  PIPELINE_CACHE_VERSION,
  getCachedPipelineQuery,
  isPipelineQueryCacheDisabled,
  pipelineCacheFile,
  pruneEntries,
  resetPipelineQueryCacheMemory,
  setCachedPipelineQuery,
} from "../../utils/pipelineQueryCache";

// The set of Pull Requests a go live carried is fixed the moment its merge commit exists, so it is
// worth keeping between sessions: the in-memory map of the provider dies with it, and every reload
// of the pipeline recomputed a commit comparison plus one listing per branch for an answer that
// cannot have changed.
suite("Pipeline query cache", () => {
  const REPO = "dev.azure.com/acme/project/_git/repo";
  const cacheFile = () => pipelineCacheFile(REPO);

  const cleanup = () => {
    resetPipelineQueryCacheMemory();
    delete process.env.NO_CACHE;
    delete process.env.SFDX_HARDIS_NO_PIPELINE_CACHE;
    try {
      fs.unlinkSync(cacheFile());
    } catch {
      // not there
    }
  };

  setup(cleanup);
  suiteTeardown(cleanup);

  test("round-trips a value across a lost memory cache", () => {
    const prs = [{ number: 1, title: "S1" }];
    setCachedPipelineQuery(REPO, "latestMergePrs::main::uat::abc123", prs);

    resetPipelineQueryCacheMemory();
    const read = getCachedPipelineQuery<typeof prs>(
      REPO,
      "latestMergePrs::main::uat::abc123",
    );
    assert.deepStrictEqual(read, prs);
  });

  test("writes the documented shape", () => {
    setCachedPipelineQuery(REPO, "k", { a: 1 });
    const written = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    assert.strictEqual(written.version, PIPELINE_CACHE_VERSION);
    assert.strictEqual(written.repository, REPO);
    assert.deepStrictEqual(written.entries["k"].value, { a: 1 });
    assert.strictEqual(typeof written.entries["k"].cachedAt, "string");
  });

  test("answers nothing for a key it never saw", () => {
    assert.strictEqual(
      getCachedPipelineQuery(REPO, "never-written"),
      undefined,
    );
  });

  test("keeps two repositories apart", () => {
    setCachedPipelineQuery(REPO, "k", "first");
    setCachedPipelineQuery(
      "dev.azure.com/acme/project/_git/other",
      "k",
      "second",
    );
    assert.strictEqual(getCachedPipelineQuery(REPO, "k"), "first");
    try {
      fs.unlinkSync(pipelineCacheFile("dev.azure.com/acme/project/_git/other"));
    } catch {
      // already gone
    }
  });

  test("ignores an entry older than the maximum age", () => {
    setCachedPipelineQuery(REPO, "k", "old");
    const written = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    written.entries["k"].cachedAt = new Date(
      Date.now() - 100 * 24 * 60 * 60 * 1000,
    ).toISOString();
    fs.writeFileSync(cacheFile(), JSON.stringify(written));

    resetPipelineQueryCacheMemory();
    assert.strictEqual(getCachedPipelineQuery(REPO, "k"), undefined);
  });

  test("keeps the entries another window wrote while this one held the file", () => {
    setCachedPipelineQuery(REPO, "mine", 1);
    const onDisk = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    onDisk.entries["theirs"] = { value: 2, cachedAt: new Date().toISOString() };
    fs.writeFileSync(cacheFile(), JSON.stringify(onDisk));

    setCachedPipelineQuery(REPO, "mine-again", 3);

    const merged = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    assert.deepStrictEqual(Object.keys(merged.entries).sort(), [
      "mine",
      "mine-again",
      "theirs",
    ]);
    assert.strictEqual(merged.entries["theirs"].value, 2);
  });

  test("leaves a file written by a newer version alone", () => {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(
      cacheFile(),
      JSON.stringify({
        version: PIPELINE_CACHE_VERSION + 1,
        repository: REPO,
        entries: { k: { value: "future", cachedAt: new Date().toISOString() } },
      }),
    );
    resetPipelineQueryCacheMemory();
    assert.strictEqual(getCachedPipelineQuery(REPO, "k"), undefined);
  });

  test("survives a corrupted file and repairs it on write", () => {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), "{{{ not json");
    resetPipelineQueryCacheMemory();
    assert.strictEqual(getCachedPipelineQuery(REPO, "k"), undefined);

    setCachedPipelineQuery(REPO, "k", "ok");
    const repaired = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
    assert.strictEqual(repaired.entries["k"].value, "ok");
  });

  test("never writes undefined", () => {
    setCachedPipelineQuery(REPO, "k", undefined);
    assert.strictEqual(fs.existsSync(cacheFile()), false);
  });

  test("is bypassed by NO_CACHE and by SFDX_HARDIS_NO_PIPELINE_CACHE", () => {
    for (const variable of ["NO_CACHE", "SFDX_HARDIS_NO_PIPELINE_CACHE"]) {
      cleanup();
      process.env[variable] = "true";
      assert.strictEqual(isPipelineQueryCacheDisabled(), true);
      setCachedPipelineQuery(REPO, "k", "value");
      assert.strictEqual(fs.existsSync(cacheFile()), false, variable);
      assert.strictEqual(getCachedPipelineQuery(REPO, "k"), undefined);
      delete process.env[variable];
    }
  });

  test("lives outside any repository, so it is never committed by accident", () => {
    assert.ok(cacheFile().startsWith(path.join(os.homedir(), ".sfdx")));
  });

  // The two caches share pruneCacheEntries but not the age and the cap they pass it, and those
  // limits are the point of these tests. They read like the ones of the Pull Request description
  // cache on purpose: each cache proves its own limits, on its own entry shape.
  /* jscpd:ignore-start */
  suite("pruneEntries()", () => {
    const entry = (daysAgo: number) => ({
      value: 1,
      cachedAt: new Date(
        Date.now() - daysAgo * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

    test("drops the expired entries", () => {
      assert.deepStrictEqual(
        Object.keys(pruneEntries({ fresh: entry(1), old: entry(90) })),
        ["fresh"],
      );
    });

    test("caps a repository", () => {
      const entries: Record<string, ReturnType<typeof entry>> = {};
      for (let i = 0; i < MAX_ENTRIES_PER_REPOSITORY + 10; i++) {
        entries[String(i)] = entry(i % 10);
      }
      assert.strictEqual(
        Object.keys(pruneEntries(entries)).length,
        MAX_ENTRIES_PER_REPOSITORY,
      );
    });
  });
  /* jscpd:ignore-end */
});
