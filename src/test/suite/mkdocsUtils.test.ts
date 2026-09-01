import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  checkMkDocsConfig,
  findLegacyNavMenus,
  parseMkDocsYml,
} from "../../utils/mkdocsUtils";

/**
 * The local documentation preview used to spin on "Starting..." for ever when
 * Zensical could not read mkdocs.yml. These checks cover what is detected
 * before the server is started.
 */
suite("mkdocsUtils Test Suite", () => {
  test("parses a mkdocs.yml holding python tags js-yaml cannot resolve", () => {
    const content = [
      "site_name: My Project",
      "markdown_extensions:",
      "  - pymdownx.emoji:",
      "      emoji_index: !!python/name:zensical.extensions.emoji.twemoji",
      "      emoji_generator: !!python/name:zensical.extensions.emoji.to_svg",
      "  - pymdownx.superfences:",
      "      custom_fences:",
      "        - format: !!python/name:pymdownx.superfences.fence_code_format",
      "nav:",
      "  - Home: index.md",
    ].join("\n");
    const parsed = parseMkDocsYml(content);
    assert.strictEqual(parsed.site_name, "My Project");
    assert.deepStrictEqual(parsed.nav, [{ Home: "index.md" }]);
  });

  test("detects a sub-menu written as a mapping, which Zensical rejects", () => {
    const nav = [
      { Home: "index.md" },
      {
        Objects: {
          "All objects": "objects/index.md",
          Account: "objects/Account.md",
        },
      },
    ];
    assert.deepStrictEqual(findLegacyNavMenus({ nav }), ["Objects"]);
  });

  test("accepts the list shape Zensical requires", () => {
    const nav = [
      { Home: "index.md" },
      { Objects: [{ Account: "objects/Account.md" }] },
    ];
    assert.deepStrictEqual(findLegacyNavMenus({ nav }), []);
  });

  test("reports every affected menu, including nested ones", () => {
    const nav = [
      { Objects: { Account: "objects/Account.md" } },
      { Code: [{ Apex: { MyClass: "apex/MyClass.md" } }] },
    ];
    assert.deepStrictEqual(findLegacyNavMenus({ nav }).sort(), [
      "Apex",
      "Objects",
    ]);
  });

  test("handles a project with no nav at all", () => {
    assert.deepStrictEqual(findLegacyNavMenus({}), []);
    assert.deepStrictEqual(findLegacyNavMenus({ nav: null }), []);
  });

  test("reports a missing mkdocs.yml instead of starting the server", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocs-check-"));
    try {
      assert.strictEqual((await checkMkDocsConfig(dir)).status, "missing");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports a legacy nav with the menus at fault", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocs-check-"));
    try {
      fs.writeFileSync(
        path.join(dir, "mkdocs.yml"),
        ["nav:", "  - Objects:", "      Account: objects/Account.md"].join(
          "\n",
        ),
        "utf-8",
      );
      const result = (await checkMkDocsConfig(dir));
      assert.strictEqual(result.status, "legacyNav");
      if (result.status === "legacyNav") {
        assert.deepStrictEqual(result.menus, ["Objects"]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts a valid config", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocs-check-"));
    try {
      fs.writeFileSync(
        path.join(dir, "mkdocs.yml"),
        ["nav:", "  - Objects:", "      - Account: objects/Account.md"].join(
          "\n",
        ),
        "utf-8",
      );
      assert.strictEqual((await checkMkDocsConfig(dir)).status, "ok");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports an unparseable mkdocs.yml rather than throwing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocs-check-"));
    try {
      fs.writeFileSync(
        path.join(dir, "mkdocs.yml"),
        "nav:\n  - Home: index.md\n   bad indentation: [",
        "utf-8",
      );
      assert.strictEqual((await checkMkDocsConfig(dir)).status, "unreadable");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
