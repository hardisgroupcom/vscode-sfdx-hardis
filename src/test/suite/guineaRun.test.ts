import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WELCOME_NAVIGATION_TARGETS } from "../../commands/showWelcome";
import {
  allowedGameLink,
  deleteGuineaRunSave,
  GUINEA_RUN_SAVE_MAX_BYTES,
  GUINEA_RUN_SITE,
  guineaRunPlayUrl,
  guineaRunSaveFile,
  guineaRunSiteOrigin,
  readGuineaRunSave,
  writeGuineaRunSave,
} from "../../utils/guineaRunUtils";
import {
  assertKeysTranslated,
  readSourceFile,
  REPO_ROOT,
} from "./lwcSourceUtils";

/**
 * Guinea Run, the game hidden in the training site, opened from the Welcome
 * page in a panel that frames the game page of the site.
 */
suite("Guinea Run", () => {
  suite("links the game may open", () => {
    test("accepts https links to the training site and the Cloudity sites", () => {
      for (const url of [
        "https://sfdx-hardis-training.cloudity.com/en/level-1/",
        "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/",
        "https://cloudity.com/?utm_source=sfdx-hardis-training",
        "https://www.cloudity.com/fr/services/",
      ]) {
        assert.strictEqual(allowedGameLink(url), url);
      }
    });

    test("returns the parsed address, which is what was checked", () => {
      assert.strictEqual(
        allowedGameLink("https://CLOUDITY.com/services/"),
        "https://cloudity.com/services/",
      );
      // A backslash is a slash for the parser: the host stays cloudity.com
      assert.strictEqual(
        allowedGameLink("https://cloudity.com\\evil.com/"),
        "https://cloudity.com/evil.com/",
      );
    });

    test("refuses any other host", () => {
      for (const url of [
        "https://example.com/",
        "https://evilcloudity.com/",
        "https://cloudity.com.example.com/",
        "https://training.cloudity.com/",
        "https://github.com/hardisgroupcom/sfdx-hardis",
      ]) {
        assert.strictEqual(allowedGameLink(url), null, url);
      }
    });

    test("refuses http and other protocols", () => {
      for (const url of [
        "http://sfdx-hardis-training.cloudity.com/",
        "javascript:alert(1)",
        "JavaScript:alert(document.domain)",
        "file:///C:/Windows/System32/calc.exe",
        "vscode://settings/",
        "data:text/html,<script>alert(1)</script>",
      ]) {
        assert.strictEqual(allowedGameLink(url), null, url);
      }
    });

    test("refuses credentials and explicit ports", () => {
      assert.strictEqual(allowedGameLink("https://user@cloudity.com/"), null);
      const userAndPassword = ["user", "not-a-password"].join(":");
      assert.strictEqual(
        allowedGameLink(`https://${userAndPassword}@cloudity.com/`),
        null,
      );
      assert.strictEqual(
        allowedGameLink("https://example.com@cloudity.com/"),
        null,
      );
      assert.strictEqual(allowedGameLink("https://cloudity.com:8443/"), null);
    });

    test("refuses malformed values", () => {
      for (const value of [
        "",
        "not a url",
        "https://",
        "//cloudity.com/",
        "cloudity.com",
        undefined,
        null,
        42,
        { href: "https://cloudity.com/" },
      ]) {
        assert.strictEqual(allowedGameLink(value), null, String(value));
      }
    });
  });

  suite("where the frame points", () => {
    test("the training site, unless a loopback copy is named", () => {
      assert.strictEqual(guineaRunSiteOrigin(undefined), GUINEA_RUN_SITE);
      assert.strictEqual(guineaRunSiteOrigin(""), GUINEA_RUN_SITE);
      assert.strictEqual(
        guineaRunSiteOrigin("http://127.0.0.1:8765/some/path"),
        "http://127.0.0.1:8765",
      );
      assert.strictEqual(
        guineaRunSiteOrigin("http://localhost:8000"),
        "http://localhost:8000",
      );
    });

    test("ignores an override that is not a loopback address", () => {
      for (const value of [
        "https://example.com",
        "http://192.168.1.10:8765",
        "javascript:alert(1)",
        "file:///C:/temp/",
        "not a url",
      ]) {
        assert.strictEqual(guineaRunSiteOrigin(value), GUINEA_RUN_SITE, value);
      }
    });

    test("the game page in French or English, told it runs in VS Code", () => {
      assert.strictEqual(
        guineaRunPlayUrl(GUINEA_RUN_SITE, "fr"),
        "https://sfdx-hardis-training.cloudity.com/theme/javascripts/guinea-run/play.html?lang=fr&from=vscode&save=host",
      );
      assert.strictEqual(
        guineaRunPlayUrl(GUINEA_RUN_SITE, "en"),
        "https://sfdx-hardis-training.cloudity.com/theme/javascripts/guinea-run/play.html?lang=en&from=vscode&save=host",
      );
      // The game speaks English and French only
      for (const locale of ["de", "ja", "pt-BR", ""]) {
        assert.ok(
          guineaRunPlayUrl(GUINEA_RUN_SITE, locale).includes("?lang=en&"),
          locale,
        );
      }
    });
  });

  suite("the save every project shares", () => {
    let home: string;

    setup(() => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), "guinea-run-save-"));
    });

    teardown(() => {
      fs.rmSync(home, { recursive: true, force: true });
    });

    test("lives in the home folder, the same for every project", () => {
      assert.strictEqual(
        guineaRunSaveFile(home),
        path.join(home, ".sfdx-hardis", "guinea-run-save.json"),
      );
      assert.ok(
        guineaRunSaveFile().startsWith(path.join(os.homedir(), ".sfdx-hardis")),
      );
    });

    test("is null before the first save", async () => {
      assert.strictEqual(
        await readGuineaRunSave(guineaRunSaveFile(home)),
        null,
      );
    });

    test("is written as sent and read back the same", async () => {
      const file = guineaRunSaveFile(home);
      const blob = '{"v":1,"k":1,"text":"{}","sg":"abc"}';
      assert.strictEqual(await writeGuineaRunSave(file, blob), true);
      assert.strictEqual(await readGuineaRunSave(file), blob);
      // A later save replaces it, and no temporary file is left
      assert.strictEqual(await writeGuineaRunSave(file, blob + " "), true);
      assert.strictEqual(await readGuineaRunSave(file), blob + " ");
      assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), [
        "guinea-run-save.json",
      ]);
    });

    test("refuses anything but a non-empty string under the size limit", async () => {
      const file = guineaRunSaveFile(home);
      for (const blob of [undefined, null, 42, {}, ""]) {
        assert.strictEqual(await writeGuineaRunSave(file, blob), false);
      }
      assert.strictEqual(
        await writeGuineaRunSave(
          file,
          "x".repeat(GUINEA_RUN_SAVE_MAX_BYTES + 1),
        ),
        false,
      );
      assert.strictEqual(fs.existsSync(file), false);
    });

    test("a file too big to be a save is not read", async () => {
      const file = guineaRunSaveFile(home);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "x".repeat(GUINEA_RUN_SAVE_MAX_BYTES + 1));
      assert.strictEqual(await readGuineaRunSave(file), null);
    });

    test("is deleted when the game refuses it, and deleting twice is fine", async () => {
      const file = guineaRunSaveFile(home);
      await writeGuineaRunSave(file, "saved");
      await deleteGuineaRunSave(file);
      assert.strictEqual(fs.existsSync(file), false);
      await deleteGuineaRunSave(file);
    });

    test("the panel relays the save between the game and the extension", () => {
      const panel = readSourceFile("webviews/guineaRunPanel.ts");
      for (const type of ["loadSave", "storeSave", "clearSave"]) {
        assert.ok(panel.includes(`"${type}"`), type);
      }
      // The save goes to the game's site only
      assert.ok(
        panel.includes(
          'frame.contentWindow.postMessage({ source: "vscode-sfdx-hardis", type: "save", blob: blob }, GAME_ORIGIN)',
        ),
      );
    });
  });

  suite("wiring", () => {
    test("the Welcome page may open it", () => {
      assert.strictEqual(
        WELCOME_NAVIGATION_TARGETS.guineaRun,
        "vscode-sfdx-hardis.openGuineaRun",
      );
      assert.ok(
        readSourceFile("webviews/lwc-ui/modules/s/welcome/welcome.js").includes(
          'target: "guineaRun"',
        ),
      );
    });

    test("the command is declared and hidden from the command palette", () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
      );
      assert.ok(
        packageJson.contributes.commands.some(
          (command: any) =>
            command.command === "vscode-sfdx-hardis.openGuineaRun",
        ),
      );
      assert.ok(
        packageJson.contributes.menus.commandPalette.some(
          (entry: any) =>
            entry.command === "vscode-sfdx-hardis.openGuineaRun" &&
            entry.when === "false",
        ),
      );
      assert.ok(
        !JSON.stringify(packageJson.activationEvents).includes("GuineaRun"),
        "Guinea Run must not add an activation event",
      );
      assert.ok(
        readSourceFile("commands.ts").includes("registerOpenGuineaRun(this)"),
      );
    });

    test("the panel module is only imported when the command runs", () => {
      const command = readSourceFile("commands/openGuineaRun.ts");
      assert.ok(command.includes('await import("../webviews/guineaRunPanel")'));
      assert.ok(!/^import .*guineaRunPanel/m.test(command));
      for (const file of ["commands.ts", "extension.ts"]) {
        assert.ok(
          !readSourceFile(file).includes("guineaRunPanel"),
          `${file} must not import the Guinea Run panel`,
        );
      }
    });

    test("the panel keeps its strict Content Security Policy", () => {
      const panel = readSourceFile("webviews/guineaRunPanel.ts");
      for (const directive of [
        "default-src 'none'",
        "frame-src ${siteOrigin}",
        "script-src 'nonce-${nonce}'",
      ]) {
        assert.ok(panel.includes(directive), directive);
      }
      assert.ok(!panel.includes("unsafe-inline"));
      assert.ok(!panel.includes("unsafe-eval"));
      // Only the game, from its site and its frame, is heard
      assert.ok(panel.includes("event.origin !== GAME_ORIGIN"));
      assert.ok(panel.includes("event.source !== frame.contentWindow"));
      assert.ok(panel.includes('data.source !== "guinea-run"'));
    });

    test("its strings are translated in every locale", () => {
      assertKeysTranslated([
        "guineaRunEggHint",
        "guineaRunOfflineMessage",
        "guineaRunOfflineTitle",
        "tryAgainLabel",
      ]);
    });
  });
});
