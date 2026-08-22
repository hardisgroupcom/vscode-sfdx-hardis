import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CacheManager } from "../../utils/cache-manager";

// Minimal vscode.Memento stand-in backed by a Map
class FakeMemento {
  private map = new Map<string, any>();
  keys(): readonly string[] {
    return [...this.map.keys()];
  }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.map.has(key) ? this.map.get(key) : defaultValue;
  }
  update(key: string, value: any): Thenable<void> {
    if (value === undefined) {
      this.map.delete(key);
    } else {
      this.map.set(key, value);
    }
    return Promise.resolve();
  }
}

// Above the offload threshold (100k chars serialized)
function bigValue() {
  return { data: "x".repeat(200_000), nested: { ok: true } };
}

suite("CacheManager large value offload", () => {
  let fakeStore: FakeMemento;
  let tmpDir: string;
  let savedStore: any;
  let savedDir: any;
  let savedMemo: any;

  function largeCacheDir(): string {
    return path.join(tmpDir, "large-cache");
  }

  function listLargeCacheFiles(): string[] {
    return fs.existsSync(largeCacheDir()) ? fs.readdirSync(largeCacheDir()) : [];
  }

  setup(() => {
    // CacheManager is a static singleton initialized by the activated
    // extension: save its state and restore it in teardown
    savedStore = (CacheManager as any).store;
    savedDir = (CacheManager as any).largeValueDir;
    savedMemo = (CacheManager as any).largeValueMemo;
    fakeStore = new FakeMemento();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardis-cache-test-"));
    CacheManager.init(fakeStore as any, tmpDir);
  });

  teardown(() => {
    (CacheManager as any).store = savedStore;
    (CacheManager as any).largeValueDir = savedDir;
    (CacheManager as any).largeValueMemo = savedMemo;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("small values stay inline in the memento", async () => {
    await CacheManager.set("app", "small", { a: 1 }, 60_000);
    const entry: any = fakeStore.get("app:small");
    assert.deepStrictEqual(entry.value, { a: 1 });
    assert.strictEqual(entry.largeValueFile, undefined);
    assert.deepStrictEqual(CacheManager.get("app", "small"), { a: 1 });
    assert.strictEqual(listLargeCacheFiles().length, 0);
  });

  test("large values are offloaded to a file, memento keeps only its name", async () => {
    const value = bigValue();
    await CacheManager.set("app", "big", value, 60_000);
    const entry: any = fakeStore.get("app:big");
    assert.strictEqual(entry.value, undefined);
    assert.ok(entry.largeValueFile, "entry must reference a file");
    assert.strictEqual(listLargeCacheFiles().length, 1);
    assert.deepStrictEqual(CacheManager.get("app", "big"), value);
  });

  test("large value survives a memo reset (read back from the file)", async () => {
    const value = bigValue();
    await CacheManager.set("app", "big", value, 60_000);
    (CacheManager as any).largeValueMemo.clear();
    assert.deepStrictEqual(CacheManager.get("app", "big"), value);
  });

  test("a removed file behaves as a cache miss and cleans the entry", async () => {
    await CacheManager.set("app", "big", bigValue(), 60_000);
    (CacheManager as any).largeValueMemo.clear();
    for (const f of listLargeCacheFiles()) {
      fs.unlinkSync(path.join(largeCacheDir(), f));
    }
    assert.strictEqual(CacheManager.get("app", "big"), undefined);
  });

  test("delete removes the file", async () => {
    await CacheManager.set("app", "big", bigValue(), 60_000);
    assert.strictEqual(listLargeCacheFiles().length, 1);
    await CacheManager.delete("app", "big");
    assert.strictEqual(listLargeCacheFiles().length, 0);
    assert.strictEqual(CacheManager.get("app", "big"), undefined);
  });

  test("expired large value is cleaned up with its file", async () => {
    await CacheManager.set("app", "big", bigValue(), -1);
    assert.strictEqual(CacheManager.get("app", "big"), undefined);
    assert.strictEqual(listLargeCacheFiles().length, 0);
  });

  test("clearExpired removes expired large value files", async () => {
    await CacheManager.set("app", "big", bigValue(), -1);
    await CacheManager.set("app", "keep", bigValue(), 60_000);
    await CacheManager.clearExpired();
    assert.strictEqual(listLargeCacheFiles().length, 1);
    assert.deepStrictEqual(CacheManager.get("app", "keep"), bigValue());
  });

  test("overwriting a large value with a small one removes the old file", async () => {
    await CacheManager.set("app", "key", bigValue(), 60_000);
    assert.strictEqual(listLargeCacheFiles().length, 1);
    await CacheManager.set("app", "key", { small: true }, 60_000);
    assert.strictEqual(listLargeCacheFiles().length, 0);
    assert.deepStrictEqual(CacheManager.get("app", "key"), { small: true });
  });

  test("values above the absolute cap are not cached at all", async () => {
    await CacheManager.set("app", "huge", "y".repeat(21_000_000), 60_000);
    assert.strictEqual(fakeStore.get("app:huge"), undefined);
    assert.strictEqual(listLargeCacheFiles().length, 0);
    assert.strictEqual(CacheManager.get("app", "huge"), undefined);
  });
});
